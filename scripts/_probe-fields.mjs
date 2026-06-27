#!/usr/bin/env node
// TEMPORARY one-shot probe (safe to delete). Read-only: calls Boberdoo
// getLeadDetails for a few known Matched leads via Fixie and dumps the field map
// (PII masked) so we can identify the exact per-lead PRICE field name for the
// /sales revenue feature. Prints to the CI log only — writes nothing, posts nothing.
//
// env: BOBERDOO_ADMIN_KEY, FIXIE_URL (same secrets the reconcile jobs use),
//      PROBE_IDS (comma list), LEAD_TYPE (33).

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const API = `https://${HOST}/new_api/api.php`;
const PROBE_IDS = (process.env.PROBE_IDS || '17235943,17235941,17235929,17235927').split(',').map((s) => s.trim()).filter(Boolean);

if (!KEY) { console.error('BOBERDOO_ADMIN_KEY missing'); process.exit(2); }

let FETCH = globalThis.fetch;
let DISPATCHER = null;
async function setupProxy() {
  const proxy = (process.env.FIXIE_URL || process.env.HTTPS_PROXY || '').replace(/\\n$/, '').trim();
  if (!proxy) { console.log('PROXY: none (direct egress — will likely fail the IP allowlist).'); return; }
  const u = await import('undici');
  FETCH = u.fetch; DISPATCHER = new u.ProxyAgent(proxy);
  console.log('PROXY: routing through Fixie static IP.');
}

async function gld(extra) {
  const body = new URLSearchParams(Object.assign({ Format: 'JSON', Key: KEY, API_Action: 'getLeadDetails', Lead_Type: LEAD_TYPE }, extra));
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) };
  if (DISPATCHER) opts.dispatcher = DISPATCHER;
  const res = await FETCH(API, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}`); }
  return json;
}
function leadsOf(json) {
  const r = json.response || json;
  if (r.error || r.errors || (r.status || '').toString().toLowerCase() === 'error') throw new Error('API error: ' + JSON.stringify(r.error || r.errors || r).slice(0, 160));
  const leads = r && r.leads && r.leads.lead;
  return !leads ? [] : (Array.isArray(leads) ? leads : [leads]);
}

const PII = /first_name|last_name|^name$|email|phone|address|street|city|^dob$|ssn|ip_address|primary_phone|caller/i;
const PRICE = /price|amount|revenue|payout|sale|cost|sold|paid|profit|margin|commission|^bid$|value|earn|charg/i;

// flatten every leaf path; collect price-candidate paths separately
function walk(obj, prefix, out, prices) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, path, out, prices); continue; }
    if (Array.isArray(v)) {
      out.push(`${path} = [array len ${v.length}]`);
      v.slice(0, 2).forEach((el, i) => { if (el && typeof el === 'object') walk(el, `${path}[${i}]`, out, prices); else out.push(`${path}[${i}] = ${el}`); });
      continue;
    }
    const shown = PII.test(k) ? '***' : v;
    out.push(`${path} = ${shown}`);
    if (PRICE.test(k)) prices.push(`${path} = ${v}`);
  }
}

(async () => {
  await setupProxy();

  // 1) Per-lead detail for known Matched leads — find the price field.
  let dumped = false;
  for (const id of PROBE_IDS) {
    let json;
    try { json = await gld({ Lead_ID: id }); } catch (e) { console.log(`Lead ${id}: ${e.message}`); continue; }
    let leads; try { leads = leadsOf(json); } catch (e) { console.log(`Lead ${id}: ${e.message}`); continue; }
    if (!leads.length) { console.log(`Lead ${id}: empty/not found`); continue; }
    const L = leads[0];
    const out = [], prices = [];
    walk(L, '', out, prices);
    console.log(`\n=== Lead ${id} · status=${L.lead_status} · date=${L.lead_date} ===`);
    console.log('TOP-LEVEL KEYS: ' + Object.keys(L).join(', '));
    console.log('--- full field map (PII masked) ---');
    console.log(out.join('\n'));
    console.log('--- PRICE CANDIDATES ---');
    console.log(prices.length ? prices.join('\n') : '(none matched the price regex — inspect the full map above)');
    dumped = true;
    break; // one good Matched lead is enough
  }
  if (!dumped) console.log('\nNo probe lead authenticated/returned — check the key/IP.');

  // 2) Date-range listing entry — does the listing carry price (cheaper than per-id scan)?
  try {
    const listJson = await gld({ Date_Start: '2026-06-26', Date_End: '2026-06-26' });
    const list = leadsOf(listJson);
    console.log(`\n=== Date listing 2026-06-26: ${list.length} entries (lead type ${LEAD_TYPE}) ===`);
    if (list.length) {
      const out = [], prices = [];
      walk(list[0], '', out, prices);
      console.log('FIRST ENTRY TOP-LEVEL KEYS: ' + Object.keys(list[0]).join(', '));
      console.log('PRICE CANDIDATES in listing: ' + (prices.length ? prices.join(' | ') : '(none)'));
    }
  } catch (e) { console.log('Date listing: ' + e.message); }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
