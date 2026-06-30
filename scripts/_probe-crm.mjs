#!/usr/bin/env node
// TEMPORARY read-only probe: does getLeadDetails expose the per-lead CRM disposition
// status (New / Working Lead / Docs Sent / Docs Signed / Processing / Closed / Dead)?
// Dumps the full field map of recent our-source leads (PII masked) + flags any
// status/crm/disposition field. Logs only; writes nothing. Delete after use.
//
// env: BOBERDOO_ADMIN_KEY, FIXIE_URL, LEAD_TYPE(33), LEAD_SRC, PROBE_LEAD_ID,
//      SCAN_WINDOW(400), PROBE_IDS (optional comma list to inspect specific leads).

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const SRC_RE = new RegExp(process.env.LEAD_SRC || 'shophealthrate', 'i');
const API = `https://${HOST}/new_api/api.php`;
const PROBE_LEAD_ID = process.env.PROBE_LEAD_ID || '17232825';
const SCAN_WINDOW = +(process.env.SCAN_WINDOW || 400);
const PROBE_IDS = (process.env.PROBE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!KEY) { console.error('BOBERDOO_ADMIN_KEY missing'); process.exit(2); }

let FETCH = globalThis.fetch, DISPATCHER = null;
async function setupProxy() {
  const proxy = (process.env.FIXIE_URL || process.env.HTTPS_PROXY || '').replace(/\\n$/, '').trim();
  if (!proxy) { console.log('PROXY: none.'); return; }
  const u = await import('undici'); FETCH = u.fetch; DISPATCHER = new u.ProxyAgent(proxy);
  console.log('PROXY: Fixie static IP.');
}
async function callGLD(extra) {
  const body = new URLSearchParams(Object.assign({ Format: 'JSON', Key: KEY, API_Action: 'getLeadDetails', Lead_Type: LEAD_TYPE }, extra));
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) };
  if (DISPATCHER) opts.dispatcher = DISPATCHER;
  const res = await FETCH(API, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`non-JSON (HTTP ${res.status}): ${text.slice(0, 150)}`); }
  const r = json.response || json;
  if (r.error || r.errors || (r.status || '').toString().toLowerCase() === 'error') throw new Error('API error: ' + JSON.stringify(r.error || r.errors || r).slice(0, 150));
  const leads = r && r.leads && r.leads.lead;
  return !leads ? [] : (Array.isArray(leads) ? leads : [leads]);
}
const gldSoft = async (e) => { for (let a = 0; a < 2; a++) { try { return await callGLD(e); } catch { if (a === 0) continue; return []; } } return []; };
const dataOf = (L) => (Array.isArray(L.lead_data) ? L.lead_data[0] : L.lead_data) || {};
const ymd = (d) => d.toISOString().slice(0, 10);

const PII = /first_name|last_name|^name$|email|phone|address|street|city|^dob$|ssn|ip_address|primary_phone|secondary_phone|leadid_token|trusted_form/i;
const STATUSY = /status|crm|stage|disposition|enroll|closed|working|docs|processing|dead|sold|sale/i;
function walk(obj, prefix, out, hits) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, path, out, hits); continue; }
    if (Array.isArray(v)) { out.push(`${path} = [array ${v.length}]`); v.slice(0, 2).forEach((el, i) => { if (el && typeof el === 'object') walk(el, `${path}[${i}]`, out, hits); else out.push(`${path}[${i}] = ${el}`); }); continue; }
    const shown = PII.test(k) ? '***' : v;
    out.push(`${path} = ${shown}`);
    if (STATUSY.test(k)) hits.push(`${path} = ${shown}`);
  }
}

(async () => {
  await setupProxy();
  let leadsToShow = [];
  if (PROBE_IDS.length) {
    for (const id of PROBE_IDS) { const L = await gldSoft({ Lead_ID: id }); if (L[0]) leadsToShow.push(L[0]); }
  } else {
    const now = new Date(), start = new Date(now - 2 * 86400000), end = new Date(now.getTime() + 86400000);
    let listing = [], last = null;
    for (let p = 0; p < 25; p++) { const pg = await gldSoft(Object.assign({ Date_Start: ymd(start), Date_End: ymd(end) }, last ? { Last_Lead_ID: String(last) } : {})); if (!pg.length) break; listing = listing.concat(pg); if (pg.length < 100) break; last = pg[pg.length - 1].lead_id; }
    const maxId = listing.length ? Math.max(...listing.map((x) => +x.lead_id)) : +PROBE_LEAD_ID + SCAN_WINDOW;
    const from = Math.max(+PROBE_LEAD_ID, maxId - SCAN_WINDOW);
    const ids = []; for (let i = from; i <= maxId; i++) ids.push(i);
    const found = [];
    for (let i = 0; i < ids.length; i += 6) { const b = (await Promise.all(ids.slice(i, i + 6).map((id) => gldSoft({ Lead_ID: String(id) }).then((L) => L[0] || null)))).filter(Boolean); found.push(...b); }
    leadsToShow = found.filter((L) => SRC_RE.test((dataOf(L).src || '') + (dataOf(L).landing_page || ''))).sort((a, b) => (b.lead_date || '').localeCompare(a.lead_date || ''));
  }
  console.log(`\nInspecting ${leadsToShow.length} lead(s).`);
  if (!leadsToShow.length) { console.log('none found'); return; }

  // 1) FULL field map of the newest lead — so we see every field incl. any CRM status.
  const out = [], hits = [];
  walk(leadsToShow[0], '', out, hits);
  console.log(`\n=== FULL FIELD MAP · lead ${leadsToShow[0].lead_id} (${leadsToShow[0].lead_date}) ===`);
  console.log('TOP-LEVEL KEYS: ' + Object.keys(leadsToShow[0]).join(', '));
  console.log(out.join('\n'));
  console.log('\n--- STATUS/CRM-LIKE FIELDS on this lead ---');
  console.log(hits.length ? hits.join('\n') : '(NONE — getLeadDetails exposes no CRM disposition field)');

  // 2) Across the last N leads: every distinct status-like field + value seen.
  console.log(`\n=== status-like fields across ${Math.min(leadsToShow.length, 30)} recent leads ===`);
  const seen = new Map();
  for (const L of leadsToShow.slice(0, 30)) {
    const o = [], h = []; walk(L, '', o, h);
    for (const line of h) { const key = line.split(' = ')[0]; const val = line.split(' = ').slice(1).join(' = '); if (!seen.has(key)) seen.set(key, new Set()); seen.get(key).add(val); }
  }
  for (const [k, vals] of seen) console.log(`  ${k} → {${[...vals].slice(0, 12).join(', ')}}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
