#!/usr/bin/env node
// TEMPORARY one-shot probe (safe to delete). Read-only: checks whether recent
// our-source Boberdoo leads carry the new ad-attribution fields (Campaign_ID /
// Ad_ID / Keyword) populated. Routes through Fixie (key #109). Prints to the CI
// log only — writes nothing, posts nothing. PII (name/email/phone) is NOT printed.
//
// env: BOBERDOO_ADMIN_KEY, FIXIE_URL, LEAD_TYPE (33), LEAD_SRC (shophealthrate),
//      PROBE_LEAD_ID, SCAN_WINDOW (default 400), SHOW (default 15).

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const SRC_RE = new RegExp(process.env.LEAD_SRC || 'shophealthrate', 'i');
const API = `https://${HOST}/new_api/api.php`;
const PROBE_LEAD_ID = process.env.PROBE_LEAD_ID || '17232825';
const SCAN_WINDOW = +(process.env.SCAN_WINDOW || 400);
const SHOW = +(process.env.SHOW || 15);
if (!KEY) { console.error('BOBERDOO_ADMIN_KEY missing'); process.exit(2); }

let FETCH = globalThis.fetch, DISPATCHER = null;
async function setupProxy() {
  const proxy = (process.env.FIXIE_URL || process.env.HTTPS_PROXY || '').replace(/\\n$/, '').trim();
  if (!proxy) { console.log('PROXY: none (will likely fail the IP allowlist).'); return; }
  const u = await import('undici');
  FETCH = u.fetch; DISPATCHER = new u.ProxyAgent(proxy);
  console.log('PROXY: routing through Fixie static IP.');
}
async function callGLD(extra) {
  const body = new URLSearchParams(Object.assign({ Format: 'JSON', Key: KEY, API_Action: 'getLeadDetails', Lead_Type: LEAD_TYPE }, extra));
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) };
  if (DISPATCHER) opts.dispatcher = DISPATCHER;
  const res = await FETCH(API, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`non-JSON (HTTP ${res.status}): ${text.slice(0, 140)}`); }
  const r = json.response || json;
  if (r.error || r.errors || (r.status || '').toString().toLowerCase() === 'error') throw new Error('API error: ' + JSON.stringify(r.error || r.errors || r).slice(0, 140));
  const leads = r && r.leads && r.leads.lead;
  return !leads ? [] : (Array.isArray(leads) ? leads : [leads]);
}
const gldSoft = async (extra) => { for (let a = 0; a < 2; a++) { try { return await callGLD(extra); } catch { if (a === 0) continue; return []; } } return []; };
const dataOf = (L) => (Array.isArray(L.lead_data) ? L.lead_data[0] : L.lead_data) || {};
const ymd = (d) => d.toISOString().slice(0, 10);
const isAdField = (k) => /campaign|keyword|creative|adgroup/i.test(k) || /(^|_)ad_?id$/i.test(k);
const val = (v) => (v === undefined || v === null || v === '') ? '—(empty)' : String(v);

(async () => {
  await setupProxy();
  const probe = await callGLD({ Lead_ID: PROBE_LEAD_ID }).catch((e) => { console.error('CONNECTIVITY FAIL:', e.message); process.exit(1); });
  console.log(`CONNECTIVITY: OK (probe lead ${PROBE_LEAD_ID} returned ${probe.length}).`);

  // bound id range from the date listing, then scan back and filter to our src
  const now = new Date();
  const start = new Date(now - 2 * 86400000), end = new Date(now.getTime() + 86400000);
  let listing = [], last = null;
  for (let p = 0; p < 25; p++) {
    const pg = await gldSoft(Object.assign({ Date_Start: ymd(start), Date_End: ymd(end) }, last ? { Last_Lead_ID: String(last) } : {}));
    if (!pg.length) break; listing = listing.concat(pg); if (pg.length < 100) break; last = pg[pg.length - 1].lead_id;
  }
  const maxId = listing.length ? Math.max(...listing.map((x) => +x.lead_id)) : +PROBE_LEAD_ID + SCAN_WINDOW;
  const from = Math.max(+PROBE_LEAD_ID, maxId - SCAN_WINDOW);
  const ids = []; for (let i = from; i <= maxId; i++) ids.push(i);
  console.log(`Scanning lead ids ${from}..${maxId} (${ids.length}) for src /${SRC_RE.source}/ …`);
  const found = [];
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (id) => { const L = await gldSoft({ Lead_ID: String(id) }); return L[0] || null; }));
    found.push(...batch.filter(Boolean));
  }
  const ours = found.filter((L) => { const d = dataOf(L); return SRC_RE.test((d.src || '') + (d.landing_page || '')); })
                    .sort((a, b) => (b.lead_date || '').localeCompare(a.lead_date || ''));
  console.log(`Found ${ours.length} our-source leads in range.\n`);
  if (!ours.length) { console.log('No our-source leads in the scan window.'); return; }

  // Exact custom-field names present on the most recent lead
  const newest = dataOf(ours[0]);
  const adKeys = Object.keys(newest).filter(isAdField);
  console.log(`Ad-field keys present in lead_data (newest lead ${ours[0].lead_id}): ${adKeys.length ? adKeys.join(', ') : '(NONE — fields not attached to the lead record)'}\n`);

  let popCampaign = 0, popAd = 0, popKw = 0, withAny = 0;
  console.log(`--- last ${Math.min(SHOW, ours.length)} our-source leads ---`);
  for (const L of ours.slice(0, SHOW)) {
    const d = dataOf(L);
    const fields = Object.keys(d).filter(isAdField).map((k) => `${k}=${val(d[k])}`);
    const c = d.campaign_id ?? d.campaignid, a = d.ad_id ?? d.adid, kw = d.keyword;
    if (c) popCampaign++; if (a) popAd++; if (kw) popKw++;
    if (c || a || kw) withAny++;
    console.log(`Lead ${L.lead_id} · ${L.lead_date} · ${L.lead_status} · ${fields.length ? fields.join(' · ') : 'no ad fields on record'}`);
  }
  const n = Math.min(SHOW, ours.length);
  console.log(`\nSUMMARY (of last ${n}): Campaign_ID populated ${popCampaign}/${n} · Ad_ID ${popAd}/${n} · Keyword ${popKw}/${n} · any ${withAny}/${n}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
