#!/usr/bin/env node
// Reconcile the Sheety lead log with Boberdoo. For each submit-row that Boberdoo
// has since accepted, back-fill: txid (Boberdoo lead_id), boberdooStatus
// (Matched/Unmatched), trustedForm (cert URL or "no"). Turns the submit log into
// a lifecycle ledger and surfaces dropped leads (submitted, never in Boberdoo).
//
// Runs in CI through Fixie (getLeadDetails is IP-whitelisted). QUOTA-FRIENDLY:
// matches by Email (one getLeadDetails per unreconciled row), so Fixie requests
// scale with NEW leads, not an id range. Matching is EXACT on sub_id
// (clickId.slice(0,30) === lead sub_id, since Boberdoo truncates to 30 chars);
// no fuzzy fallback — a non-match is a dropped-lead candidate, never a guessed txid.
// Idempotent: only rows with an empty txid are candidates. Stale unmatched rows
// (older than STALE_HOURS) get a 'no-match' sentinel so they stop being re-queried.
//
// env: BOBERDOO_ADMIN_KEY, FIXIE_URL, SHEETY_URL (required), LEAD_TYPE (33),
//      MAX_RECONCILE (50), STALE_HOURS (48), DRY_RUN (1 = report only),
//      PROBE_LEAD_ID, SHEET_KEY (sheet1).

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const API = `https://${HOST}/new_api/api.php`;
// vercel env pull escapes the stored trailing newline as a literal "\n"; strip it.
const SHEETY_URL = (process.env.SHEETY_URL || '').replace(/\\n$/, '').trim();
const SHEET_KEY = process.env.SHEET_KEY || 'sheet1';   // POST/PUT body root key (matches log-lead.js)
const MAX = Number.isFinite(+process.env.MAX_RECONCILE) && +process.env.MAX_RECONCILE > 0 ? +process.env.MAX_RECONCILE : 50;
const STALE_HOURS = +(process.env.STALE_HOURS || 48);
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const PROBE_LEAD_ID = process.env.PROBE_LEAD_ID || '17232825';
const NO_MATCH = 'no-match';   // sentinel written to txid for stale dropped rows
if (!KEY) { console.error('BOBERDOO_ADMIN_KEY required'); process.exit(2); }
if (!SHEETY_URL) { console.error('SHEETY_URL required'); process.exit(2); }

let FETCH = globalThis.fetch;
let DISPATCHER = null;
async function setupProxy() {
  const proxy = (process.env.FIXIE_URL || process.env.HTTPS_PROXY || '').replace(/\\n$/, '').trim();
  if (!proxy) { console.log('PROXY: none (direct egress).'); return; }
  const u = await import('undici');     // undici's own fetch + ProxyAgent (version-matched)
  FETCH = u.fetch; DISPATCHER = new u.ProxyAgent(proxy);
  console.log('PROXY: routing Boberdoo calls through the static-IP proxy.');
}

async function callGLD(extra) {
  const body = new URLSearchParams(Object.assign({ Format: 'JSON', Key: KEY, API_Action: 'getLeadDetails', Lead_Type: LEAD_TYPE }, extra));
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) };
  if (DISPATCHER) opts.dispatcher = DISPATCHER;
  const res = await FETCH(API, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`non-JSON (HTTP ${res.status})`); }
  const r = json.response || json;
  if ((r.status || '').toString().toLowerCase() === 'error' || r.error || r.errors) throw new Error('API error: ' + JSON.stringify(r.error || r.errors || r).slice(0, 140));
  const leads = r && r.leads && r.leads.lead;
  return !leads ? [] : (Array.isArray(leads) ? leads : [leads]);
}
const gldSoft = async (extra) => { for (let a = 0; a < 2; a++) { try { return await callGLD(extra); } catch { if (a === 0) continue; return []; } } return []; };
const dataOf = (L) => (Array.isArray(L.lead_data) ? L.lead_data[0] : L.lead_data) || {};

// Hard connectivity check: distinguishes "Boberdoo says no lead" from "we can't
// reach Boberdoo" (so an outage isn't silently reported as every row dropped).
async function connectivityProbe() {
  try { const L = await callGLD({ Lead_ID: PROBE_LEAD_ID }); if (!L.length) throw new Error('probe returned no lead'); }
  catch (e) { console.error(`CONNECTIVITY FAIL: ${e.message} — key rejected, runner IP not whitelisted, or proxy down. Aborting (no rows touched).`); process.exit(1); }
  console.log(`CONNECTIVITY: OK (probe lead ${PROBE_LEAD_ID}).`);
}

async function getSheetRows() {
  const res = await globalThis.fetch(SHEETY_URL);  // Sheety returns all rows; ?page unsupported here
  if (!res.ok) throw new Error(`Sheety GET ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  const key = Object.keys(j).find((k) => Array.isArray(j[k]));  // Sheety pluralizes the sheet name on GET
  return key ? j[key] : [];
}

// Read-modify-write: Sheety PUT REPLACES the whole row, so resend every existing
// column (minus the id) and layer the new fields on top — never blank a column.
async function putRow(row, fields) {
  const { id, ...rest } = row;
  const res = await globalThis.fetch(`${SHEETY_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [SHEET_KEY]: { ...rest, ...fields } }),
  });
  if (!res.ok) throw new Error(`Sheety PUT ${id} -> ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const back = await res.json().catch(() => null);
  const wrote = back && back[SHEET_KEY] ? back[SHEET_KEY] : null;
  if (wrote && fields.txid && String(wrote.txid) !== String(fields.txid)) throw new Error(`PUT ${id} echo txid mismatch (root key '${SHEET_KEY}' wrong?)`);
}

(async () => {
  try {
    await setupProxy();
    await connectivityProbe();
    const rows = await getSheetRows();
    const done = rows.filter((r) => r.txid);
    const claimed = new Set(done.map((r) => String(r.txid)).filter((t) => t && t !== NO_MATCH));  // double-count guard
    const noEmail = rows.filter((r) => !r.txid && r.clickId && !r.email);

    // candidates: empty txid + clickId + email; de-dup by clickId (keep first/earliest)
    const seen = new Set();
    const candidates = rows
      .filter((r) => !r.txid && r.clickId && r.email)
      .filter((r) => { const k = String(r.clickId); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, MAX);

    console.log(`Sheety rows: ${rows.length} · reconciled: ${done.length} · candidates: ${candidates.length} · skipped(no email): ${noEmail.length}${DRY_RUN ? ' · DRY_RUN' : ''}`);

    let reconciled = 0, noMatch = 0, dup = 0, staleMarked = 0, errors = 0;
    const dropped = [];
    for (const r of candidates) {
      const want = String(r.clickId).slice(0, 30);   // Boberdoo sub_id is truncated to 30 chars
      if (!want) { noMatch++; continue; }
      const leads = await gldSoft({ Email: r.email });
      const lead = leads.find((L) => { const s = dataOf(L).sub_id; return s && s === want; });  // EXACT match only
      if (!lead) {
        noMatch++;
        const ageH = (Date.now() - Date.parse(r.timestamp || 0)) / 3.6e6;
        const otherLeads = leads.length;  // email exists in Boberdoo but under a different click_id?
        dropped.push({ ts: r.timestamp, clickId: r.clickId, hadOtherLeads: otherLeads });
        if (ageH > STALE_HOURS && !DRY_RUN) {
          try { await putRow(r, { txid: NO_MATCH, boberdooStatus: 'not-found' }); staleMarked++; }
          catch (e) { errors++; console.error(`  sentinel PUT failed row ${r.id}: ${e.message}`); }
        }
        continue;
      }
      if (claimed.has(String(lead.lead_id))) { dup++; continue; }  // another row already owns this lead
      claimed.add(String(lead.lead_id));
      const d = dataOf(lead);
      const fields = { txid: String(lead.lead_id), boberdooStatus: lead.lead_status || '', trustedForm: d.trusted_form_url || 'no' };
      if (DRY_RUN) { console.log(`  WOULD patch row ${r.id}: txid=${fields.txid} status=${fields.boberdooStatus} tf=${d.trusted_form_url ? 'yes' : 'no'}`); reconciled++; }
      else {
        try { await putRow(r, fields); reconciled++; console.log(`  patched row ${r.id} -> lead ${fields.txid} (${fields.boberdooStatus}, tf=${d.trusted_form_url ? 'yes' : 'no'})`); }
        catch (e) { errors++; console.error(`  PUT failed row ${r.id}: ${e.message}`); }
      }
    }

    console.log(`\nRESULT: reconciled ${reconciled}/${candidates.length}${DRY_RUN ? ' (dry-run)' : ''} · no-match ${noMatch} (sentinel-marked ${staleMarked}) · dup-skipped ${dup} · errors ${errors}`);
    if (dropped.length) {
      console.log('Dropped-lead candidates (submitted, no exact Boberdoo match):');
      for (const x of dropped.slice(0, 10)) console.log(`  ${x.ts} clickId=${x.clickId}${x.hadOtherLeads ? ` (email has ${x.hadOtherLeads} other Boberdoo lead(s) under different click_id)` : ''}`);
    }
  } catch (e) {
    console.error('FATAL:', e && e.stack || e);
    process.exit(1);
  }
})();
