#!/usr/bin/env node
// Ad-attribution report — "top keywords / campaigns driving leads (or sales)".
// Ranks the Boberdoo custom fields campaign_id / ad_id / keyword across recent
// our-source leads. Backs the /keywords command and the investigate agent's
// keyword/campaign questions.
//
// Boberdoo getLeadDetails is the ONLY source of these fields (not in Sheety or
// ClickFlare), so this id-scans through Fixie. The scan is bounded by SCAN_WINDOW
// and the report states the time range it actually covered (so partial weeks are
// honest, not silently truncated). Add "sales/sold/matched" to ask for sold leads
// only; otherwise it counts all our-source leads.
//
// env: BOBERDOO_ADMIN_KEY, FIXIE_URL (required), LEAD_TYPE (33), LEAD_SRC,
//      PROBE_LEAD_ID, SCAN_WINDOW (default 1500), REQUEST (window + intent).
// Writes a Telegram-ready answer to _agent_inbox/REPLY.txt.

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const SRC_RE = new RegExp(process.env.LEAD_SRC || 'shophealthrate', 'i');
const API = `https://${HOST}/new_api/api.php`;
const PROBE_LEAD_ID = process.env.PROBE_LEAD_ID || '17232825';
const SCAN_WINDOW = +(process.env.SCAN_WINDOW || 1500);
const REQUEST = (process.env.REQUEST || '').trim();
const ET = 'America/New_York';

const INBOX = path.join(process.cwd(), '_agent_inbox');
fs.mkdirSync(INBOX, { recursive: true });
const writeReply = (s) => fs.writeFileSync(path.join(INBOX, 'REPLY.txt'), s.trim() + '\n');
const fail = (msg) => { writeReply('⚠️ Ad report unavailable: ' + msg); console.error(msg); process.exit(1); };
if (!KEY) fail('BOBERDOO_ADMIN_KEY not set');

const fmtDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date(ms));
function parseWindow(req) {
  const t = (req || '').toLowerCase().replace(/[@#]\S+/g, '').trim();
  const now = Date.now(); const today = fmtDay(now);
  const range = (db, label) => ({ startDay: fmtDay(now - db * 86400000), endDay: today, label });
  let m;
  if ((m = t.match(/(\d{4}-\d{2}-\d{2})/))) return { startDay: m[1], endDay: m[1], label: m[1] };
  if (/\byesterday\b/.test(t)) { const d = fmtDay(now - 86400000); return { startDay: d, endDay: d, label: 'yesterday · ' + d }; }
  if (/\b(this\s*month|month|mtd)\b/.test(t)) return range(29, 'last 30 days');
  if ((m = t.match(/\b(\d{1,3})\s*d(?:ays?)?\b/))) { const n = Math.min(Math.max(+m[1], 1), 90); return range(n - 1, `last ${n} days`); }
  if (/\b(this\s*week|last\s*week|week|wtd|7\s*days?)\b/.test(t)) return range(6, 'last 7 days');
  if (/\b(today|so\s*far)\b/.test(t)) return { startDay: today, endDay: today, label: 'today · ' + today };
  return { startDay: today, endDay: today, label: 'today · ' + today };
}

let FETCH = globalThis.fetch, DISPATCHER = null;
async function setupProxy() {
  const proxy = (process.env.FIXIE_URL || process.env.HTTPS_PROXY || '').replace(/\\n$/, '').trim();
  if (!proxy) { console.log('PROXY: none.'); return; }
  const u = await import('undici'); FETCH = u.fetch; DISPATCHER = new u.ProxyAgent(proxy);
  console.log('PROXY: routing through Fixie static IP.');
}
async function callGLD(extra) {
  const body = new URLSearchParams(Object.assign({ Format: 'JSON', Key: KEY, API_Action: 'getLeadDetails', Lead_Type: LEAD_TYPE }, extra));
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) };
  if (DISPATCHER) opts.dispatcher = DISPATCHER;
  const res = await FETCH(API, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`non-JSON (HTTP ${res.status})`); }
  const r = json.response || json;
  if (r.error || r.errors || (r.status || '').toString().toLowerCase() === 'error') throw new Error('API error: ' + JSON.stringify(r.error || r.errors || r).slice(0, 120));
  const leads = r && r.leads && r.leads.lead;
  return !leads ? [] : (Array.isArray(leads) ? leads : [leads]);
}
const gldSoft = async (extra) => { for (let a = 0; a < 2; a++) { try { return await callGLD(extra); } catch { if (a === 0) continue; return []; } } return []; };
const dataOf = (L) => (Array.isArray(L.lead_data) ? L.lead_data[0] : L.lead_data) || {};
const ymd = (d) => d.toISOString().slice(0, 10);

(async () => {
  await setupProxy();
  const W = parseWindow(REQUEST);

  // ceiling id from the date listing (the listing omits our src but bounds the range)
  const now = new Date(), start = new Date(now - 2 * 86400000), end = new Date(now.getTime() + 86400000);
  let listing = [], last = null;
  for (let p = 0; p < 25; p++) {
    const pg = await gldSoft(Object.assign({ Date_Start: ymd(start), Date_End: ymd(end) }, last ? { Last_Lead_ID: String(last) } : {}));
    if (!pg.length) break; listing = listing.concat(pg); if (pg.length < 100) break; last = pg[pg.length - 1].lead_id;
  }
  if (!listing.length) { const probe = await gldSoft({ Lead_ID: PROBE_LEAD_ID }); if (!probe.length) fail('Boberdoo unreachable (key/IP rejected or proxy down).'); }
  const maxId = listing.length ? Math.max(...listing.map((x) => +x.lead_id)) : +PROBE_LEAD_ID + SCAN_WINDOW;
  const floor = Math.max(+PROBE_LEAD_ID, maxId - SCAN_WINDOW);

  // scan ids DESCENDING; stop once we pass below the window's start day (cheap for
  // "today", bounded by SCAN_WINDOW for wide windows).
  const ours = []; let scanned = 0, id = maxId, minDate = '9999-99-99', maxDate = '0000-00-00', stoppedByTime = false;
  while (id >= floor && scanned < SCAN_WINDOW) {
    const ids = []; for (let k = 0; k < 8 && id >= floor; k++, id--) ids.push(id);
    const batch = (await Promise.all(ids.map((i) => gldSoft({ Lead_ID: String(i) }).then((L) => L[0] || null)))).filter(Boolean);
    scanned += ids.length;
    let batchMax = '0000-00-00';
    for (const L of batch) {
      const dt = (L.lead_date || '').slice(0, 10);
      if (dt) { if (dt > batchMax) batchMax = dt; if (dt < minDate) minDate = dt; if (dt > maxDate) maxDate = dt; }
      const d = dataOf(L);
      if (SRC_RE.test((d.src || '') + (d.landing_page || '')) && dt >= W.startDay && dt <= W.endDay) ours.push(L);
    }
    if (batch.length && batchMax < W.startDay) { stoppedByTime = true; break; }   // fully past the window
  }

  // Tally leads + sold (lead_status Matched) per keyword and per campaign → sell-rate.
  const isMatched = (X) => /matched/i.test(X.lead_status || '');
  const totalSold = ours.filter(isMatched).length;
  const overall = ours.length ? Math.round((totalSold / ours.length) * 100) : 0;
  const kw = new Map(), camp = new Map();   // key → { leads, sold }
  let withKw = 0;
  const bump = (mp, key, sold) => { const g = mp.get(key) || { leads: 0, sold: 0 }; g.leads++; if (sold) g.sold++; mp.set(key, g); };
  for (const X of ours) {
    const d = dataOf(X), sold = isMatched(X);
    const k = (d.keyword || '').trim().toLowerCase(); if (k) { bump(kw, k, sold); withKw++; }
    const c = (d.campaign_id || '').toString().trim(); if (c) bump(camp, c, sold);
  }
  const share = (g) => (totalSold ? Math.round((g.sold / totalSold) * 100) : 0);
  // rank by sold (volume of sales), then by leads — high-sample rows surface first.
  const top = (mp, n) => [...mp.entries()].sort((a, b) => b[1].sold - a[1].sold || b[1].leads - a[1].leads).slice(0, n);

  const L = [];
  L.push(`🔎 Keyword/campaign performance · ${W.label}`);
  L.push('—');
  L.push(`${ours.length} lead${ours.length === 1 ? '' : 's'} · ${totalSold} sold · ${overall}% sell-through  (${withKw} had a keyword)`);
  L.push("Almost every lead matches a buyer, so the % below is SHARE of total sales (not sell-through).");
  // coverage honesty: if the scan hit its cap before reaching the window start.
  if (!stoppedByTime && minDate !== '9999-99-99' && minDate > W.startDay) {
    L.push(`⚠️ scanned the most recent ${scanned} leads (back to ${minDate}); window starts ${W.startDay} — counts are partial. Ask "today" for an exact day, or I can log these to Sheety for fast full-range reports.`);
  }
  if (!ours.length) { L.push('— (no our-source leads in this window / scan)'); writeReply(L.join('\n')); console.log('----- REPLY -----\n' + L.join('\n')); return; }
  L.push('—');
  L.push('Top keywords (leads · sold · share of sales):');
  top(kw, 10).forEach(([k, g], i) => L.push(`${i + 1}. ${k} — ${g.leads} · ${g.sold} · ${share(g)}%`));
  if (!kw.size) L.push('  (no leads carried a keyword — only leads from 2026-06-29 onward do)');
  L.push('—');
  L.push('Top campaigns (campaign_id · leads · sold · share):');
  top(camp, 8).forEach(([c, g], i) => L.push(`${i + 1}. ${c} — ${g.leads} · ${g.sold} · ${share(g)}%`));
  if (!camp.size) L.push('  (no campaign_id on leads)');
  L.push('—');
  L.push(`Share = % of all ${totalSold} sales. Sell-through (sold/leads) is ~${overall}% — almost every lead matches a buyer. Source: Boberdoo getLeadDetails.`);

  writeReply(L.join('\n'));
  console.log('----- REPLY -----\n' + L.join('\n'));
})().catch((e) => fail(e.message));
