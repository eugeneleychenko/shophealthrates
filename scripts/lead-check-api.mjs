#!/usr/bin/env node
// Lead lookup via Boberdoo's getLeadDetails admin API — no browser, no login.
// Backs the telegram-lead-check workflow and writes a Telegram-ready answer to
// _agent_inbox/REPLY.txt.
//
// getLeadDetails is a Boberdoo "sensitive" function that REQUIRES an IP allowlist,
// and hosted runners have no fixed IP — so calls route through a static-IP proxy
// (Fixie) when FIXIE_URL is set; that proxy IP is whitelisted on the read-only key.
//
// AUTH (env, never printed): BOBERDOO_ADMIN_KEY (read-only key), FIXIE_URL/HTTPS_PROXY.
// CONFIG: BOBERDOO_HOST, LEAD_TYPE (default 33), LEAD_SRC (default shophealthrate),
//         PROBE_LEAD_ID, SCAN_WINDOW (default 150).
// INPUT: REQUEST free text. Routing:
//   email          -> lookup by Email
//   10-11 digits   -> lookup by Phone
//   7-9 digits     -> lookup by Lead_ID
//   else           -> recent <src> leads (status + TrustedForm). Answers
//                     "last lead / does it have trustedform / are leads processing".
// Boberdoo's date listing OMITS our source, so "recent" scans recent Lead_IDs.

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const SRC_RE = new RegExp(process.env.LEAD_SRC || 'shophealthrate', 'i');
const REQUEST = (process.env.REQUEST || '').trim();
const API = `https://${HOST}/new_api/api.php`;
const PROBE_LEAD_ID = process.env.PROBE_LEAD_ID || '17232825';
const SCAN_WINDOW = +(process.env.SCAN_WINDOW || 150);

const INBOX = path.join(process.cwd(), '_agent_inbox');
fs.mkdirSync(INBOX, { recursive: true });
const writeReply = (s) => fs.writeFileSync(path.join(INBOX, 'REPLY.txt'), s.trim() + '\n');

function fail(msg, code = 1) {
  console.error('CONNECTIVITY: FAIL — ' + msg);
  writeReply('⚠️ Could not read leads from Boberdoo: ' + msg);
  process.exit(code);
}
if (!KEY) fail('BOBERDOO_ADMIN_KEY is not set.', 2);

// Static-IP egress via Fixie. Use undici's OWN fetch + ProxyAgent (version-matched)
// so it works across Node versions (Node 23's bundled fetch rejects a v7 dispatcher).
let FETCH = globalThis.fetch;
let DISPATCHER = null;
async function setupProxy() {
  const proxy = (process.env.FIXIE_URL || process.env.HTTPS_PROXY || process.env.LEAD_API_PROXY || '').replace(/\\n$/, '').trim();
  if (!proxy) { console.log('PROXY: none (direct egress).'); return; }
  try {
    const u = await import('undici');
    FETCH = u.fetch; DISPATCHER = new u.ProxyAgent(proxy);
    console.log('PROXY: routing Boberdoo calls through the static-IP proxy.');
  } catch (e) { fail(`proxy set but undici unavailable (${e.message}); CI step: npm i undici`); }
}

async function callGLD(extra) {
  const body = new URLSearchParams(Object.assign({ Format: 'JSON', Key: KEY, API_Action: 'getLeadDetails', Lead_Type: LEAD_TYPE }, extra));
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) };
  if (DISPATCHER) opts.dispatcher = DISPATCHER;
  const res = await FETCH(API, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`non-JSON (HTTP ${res.status}): ${text.slice(0, 120).replace(/\s+/g, ' ')}`); }
  const r = json.response || json;
  const status = (r.status || r.Status || '').toString().toLowerCase();
  // Boberdoo returns {response:{errors:{error:"Authentication failed"}}} for a rejected key/IP.
  if (status === 'error' || r.error || r.Error || r.errors) throw new Error('API error: ' + JSON.stringify(r.error || r.Error || r.errors || r).slice(0, 160));
  const leads = r && r.leads && r.leads.lead;
  return !leads ? [] : (Array.isArray(leads) ? leads : [leads]);
}
const gld = async (extra) => { try { return await callGLD(extra); } catch (e) { fail(e.message); } };           // hard: fails the run
const gldSoft = async (extra) => { for (let a = 0; a < 2; a++) { try { return await callGLD(extra); } catch { if (a === 0) continue; return []; } } return []; }; // soft: [] on persistent error

const dataOf = (L) => (Array.isArray(L.lead_data) ? L.lead_data[0] : L.lead_data) || {};
const tfState = (d) => (d.trusted_form_url ? '✅ ' + String(d.trusted_form_url).slice(0, 60) : '❌ MISSING');
function describe(L) {
  const d = dataOf(L);
  const core = ['first_name', 'last_name', 'email', 'primary_phone', 'zip'].filter((k) => d[k]).length;
  return [
    `Lead ${L.lead_id} · ${L.lead_date} CT · ${L.lead_status}`,
    `  TrustedForm: ${tfState(d)}`,
    `  src=${d.src || '?'} · sub_id=${d.sub_id ? 'present' : '—'} · core ${core}/5 · TCPA=${d.tcpa_consent || '—'} · LeadiD=${d.leadid_token ? 'present' : '—'}`,
  ].join('\n');
}

async function connectivityProbe() {
  const leads = await gld({ Lead_ID: PROBE_LEAD_ID });
  if (!leads.length) fail(`probe lead ${PROBE_LEAD_ID} came back empty — key rejected or runner IP not whitelisted.`);
  console.log(`CONNECTIVITY: OK (probe lead ${PROBE_LEAD_ID} returned).`);
}

function ymd(d) { return d.toISOString().slice(0, 10); }
async function recentOurLeads() {
  // ceiling: max type-33 lead id over a recent UTC window (listing omits our src
  // but bounds the id range). Then confirm our leads by Lead_ID in a recent window.
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 86400000), end = new Date(now.getTime() + 86400000);
  let listing = [], last = null;
  for (let p = 0; p < 25; p++) {
    const pg = await gldSoft(Object.assign({ Date_Start: ymd(start), Date_End: ymd(end) }, last ? { Last_Lead_ID: String(last) } : {}));
    if (!pg.length) break; listing = listing.concat(pg); if (pg.length < 100) break; last = pg[pg.length - 1].lead_id;
  }
  const maxId = listing.length ? Math.max(...listing.map((x) => +x.lead_id)) : +PROBE_LEAD_ID + SCAN_WINDOW;
  const from = Math.max(+PROBE_LEAD_ID, maxId - SCAN_WINDOW);
  const ids = []; for (let i = from; i <= maxId; i++) ids.push(i);
  const found = [];
  for (let i = 0; i < ids.length; i += 5) {  // gentle concurrency for the proxy
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (id) => { const L = await gldSoft({ Lead_ID: String(id) }); return L[0] || null; }));
    found.push(...batch.filter(Boolean));
  }
  const ours = found.filter((L) => { const d = dataOf(L); return SRC_RE.test((d.src || '') + (d.landing_page || '')); });
  ours.sort((a, b) => (b.lead_date || '').localeCompare(a.lead_date || ''));
  return ours;
}

(async () => {
  await setupProxy();
  await connectivityProbe();
  const email = (REQUEST.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0];
  const digits = REQUEST.replace(/[^\d]/g, '');
  let reply;

  if (email) {
    const leads = await gld({ Email: email });
    reply = leads.length ? `📋 ${leads.length} lead(s) for ${email}:\n\n` + leads.slice(0, 5).map(describe).join('\n\n') : `No Type-${LEAD_TYPE} leads for ${email}.`;
  } else if (digits.length >= 10 && digits.length <= 11) {
    const phone = digits.slice(-10); const leads = await gld({ Phone: phone });
    reply = leads.length ? `📋 ${leads.length} lead(s) for phone ${phone}:\n\n` + leads.slice(0, 5).map(describe).join('\n\n') : `No Type-${LEAD_TYPE} leads for phone ${phone}.`;
  } else if (digits.length >= 7 && digits.length <= 9) {
    const leads = await gld({ Lead_ID: digits });
    reply = leads.length ? `📋 ${describe(leads[0])}` : `No lead ${digits} (Type ${LEAD_TYPE}).`;
  } else {
    // "last/latest lead", "does it have trustedform", "are leads processing", empty → recent our-source leads
    const ours = await recentOurLeads();
    if (!ours.length) {
      reply = `No ${SRC_RE.source} leads found in the last ~${SCAN_WINDOW} Boberdoo leads.`;
    } else {
      const latest = ours[0], d = dataOf(latest);
      const tfAsked = /trusted|cert/i.test(REQUEST);
      const head = tfAsked
        ? `Last ${d.src} lead ${latest.lead_id} (${latest.lead_date} CT): TrustedForm ${d.trusted_form_url ? '✅ present' : '❌ MISSING'}`
        : `Last ${Math.min(ours.length, 5)} ${d.src} lead(s):`;
      reply = `📋 ${head}\n\n` + ours.slice(0, 5).map(describe).join('\n\n');
    }
  }
  writeReply(reply);
  console.log('----- REPLY -----\n' + reply);
})();
