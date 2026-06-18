#!/usr/bin/env node
// Fast lead lookup via Boberdoo's OFFICIAL admin API (getLeadDetails) — no
// headless browser, no login. Mirrors scripts/call-check-api.mjs: at request
// time this is just fetch() calls, and on success it writes a short,
// Telegram-friendly answer to _agent_inbox/REPLY.txt.
//
// PRIMARY GOAL of the first run: prove that GitHub Actions can reach the admin
// API. The admin key (107) is IP-whitelisted to 209.122.209.0/24; GitHub-hosted
// runners use a rotating Azure IP pool that is NOT in that range. This script
// prints a clear CONNECTIVITY verdict so a workflow_dispatch test reveals whether
// the whitelist blocks CI before we wire anything to Telegram.
//
// AUTH (env — never printed):
//   BOBERDOO_ADMIN_KEY   Admin key (ID 107). Required. Has read perms incl.
//                        getLeadDetails. Store as a GitHub Actions secret.
//   BOBERDOO_HOST        default "leosourceinsurance.leadportal.com"
//   LEAD_TYPE            default "33" (Health Insurance). getLeadDetails REQUIRES it.
//   LEAD_SRC             our source filter (regex), default "shophealthrate"
//
// INPUT (env):
//   REQUEST   teammate's free-text ask. Routing:
//             - contains an email           -> Email lookup
//             - a 10-11 digit run           -> Phone lookup
//             - a 7-9 digit run             -> Lead_ID lookup
//             - "yesterday"                 -> yesterday's summary
//             - else                        -> today's summary
//   DATE_START / DATE_END  optional YYYY-MM-DD overrides for the summary window.
//
// OUTPUT: _agent_inbox/REPLY.txt (created). Exit 0 if the API answered (even
// "no leads"); exit 1 if the API was unreachable / IP-blocked / auth-failed, so
// the workflow can surface that distinctly.

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const SRC_RE = new RegExp(process.env.LEAD_SRC || 'shophealthrate', 'i');
const REQUEST = (process.env.REQUEST || '').trim();
const API = `https://${HOST}/new_api/api.php`;
// A lead known to exist, used to prove auth+IP work. getLeadDetails returns an
// EMPTY result (not an error) for a rejected key or a blocked IP, so "0 leads"
// alone is ambiguous — the probe disambiguates. Override via PROBE_LEAD_ID.
const PROBE_LEAD_ID = process.env.PROBE_LEAD_ID || '17232825';

const INBOX = path.join(process.cwd(), '_agent_inbox');
fs.mkdirSync(INBOX, { recursive: true });
const writeReply = (s) => fs.writeFileSync(path.join(INBOX, 'REPLY.txt'), s.trim() + '\n');

function fail(msg, code = 1) {
  console.error('CONNECTIVITY: FAIL — ' + msg);
  writeReply('⚠️ Could not read leads from Boberdoo: ' + msg);
  process.exit(code);
}
if (!KEY) fail('BOBERDOO_ADMIN_KEY is not set (add it as a GitHub Actions secret).', 2);

// --- date helpers (UTC; widen by a day to dodge portal-timezone boundary) -----
function ymd(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; }

// --- one getLeadDetails call -------------------------------------------------
async function getLeadDetails(extra) {
  const body = new URLSearchParams(Object.assign(
    { Format: 'JSON', Key: KEY, API_Action: 'getLeadDetails', Lead_Type: LEAD_TYPE },
    extra,
  ));
  let res, text;
  try {
    res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    text = await res.text();
  } catch (e) {
    fail(`network error reaching ${HOST} (${e.message}). Likely the runner IP is outside the key's whitelist, or DNS/egress is blocked.`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch {
    // Non-JSON usually means an HTML error/redirect — classic IP-deny or auth wall.
    fail(`API returned non-JSON (HTTP ${res.status}). First 160 chars: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
  const r = json.response || json;
  // Boberdoo signals problems via response.status / response.error.
  const status = (r && (r.status || r.Status) || '').toString().toLowerCase();
  if (status === 'error' || r.error || r.Error) {
    const detail = JSON.stringify(r.error || r.Error || r).slice(0, 200);
    fail(`API error: ${detail}`);
  }
  let leads = r && r.leads && r.leads.lead;
  if (!leads) return [];
  return Array.isArray(leads) ? leads : [leads];
}

const dataOf = (L) => (Array.isArray(L.lead_data) ? L.lead_data[0] : L.lead_data) || {};
const cleanTf = (d) => (d.trusted_form_url ? 'present' : '—');

function summarizeLead(L) {
  const d = dataOf(L);
  return [
    `Lead ${L.lead_id} · ${L.lead_date} · ${L.lead_status}`,
    `  src=${d.src || '?'}  sub_id=${(d.sub_id || '—')}`,
    `  TrustedForm=${cleanTf(d)}  TCPA=${d.tcpa_consent || '—'}  LeadiD=${d.leadid_token ? 'present' : '—'}`,
    `  ${(d.first_name || '')} ${(d.last_name || '')}`.trimEnd() ? `  name=${d.first_name || ''} ${d.last_name || ''}`.trimEnd() : '',
  ].filter(Boolean).join('\n');
}

// --- paginate a date window --------------------------------------------------
async function fetchWindow(dateStart, dateEnd) {
  const all = [];
  let last = null;
  for (let page = 0; page < 30; page++) {
    const extra = { Date_Start: dateStart, Date_End: dateEnd };
    if (last) extra.Last_Lead_ID = String(last);
    const pg = await getLeadDetails(extra);
    if (!pg.length) break;
    all.push(...pg);
    if (pg.length < 100) break;
    last = pg[pg.length - 1].lead_id;
  }
  return all;
}

// Definitive auth+IP check: a known lead MUST come back. Empty => key rejected
// or runner IP outside the 209.122.209.0/24 whitelist.
async function connectivityProbe() {
  const leads = await getLeadDetails({ Lead_ID: PROBE_LEAD_ID });
  if (!leads.length) {
    fail(`API responded but the probe lead ${PROBE_LEAD_ID} came back empty — the admin key was rejected (wrong key, or this runner's IP is outside the key's 209.122.209.0/24 whitelist). AUTH/IP CHECK FAILED.`);
  }
  console.log(`CONNECTIVITY: OK — admin API reachable & authorized (probe lead ${PROBE_LEAD_ID} returned).`);
}

(async () => {
  await connectivityProbe();
  const email = (REQUEST.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0];
  const digits = REQUEST.replace(/[^\d]/g, '');
  const wantsYesterday = /yesterday/i.test(REQUEST);

  let reply;

  if (email) {
    const leads = await getLeadDetails({ Email: email });
    // connectivity already verified by the probe above
    reply = leads.length
      ? `📋 ${leads.length} lead(s) for ${email}:\n` + leads.slice(0, 5).map(summarizeLead).join('\n')
      : `No Type-${LEAD_TYPE} leads found for ${email}.`;
  } else if (digits.length >= 10 && digits.length <= 11) {
    const phone = digits.slice(-10);
    const leads = await getLeadDetails({ Phone: phone });
    // connectivity already verified by the probe above
    reply = leads.length
      ? `📋 ${leads.length} lead(s) for phone ${phone}:\n` + leads.slice(0, 5).map(summarizeLead).join('\n')
      : `No Type-${LEAD_TYPE} leads found for phone ${phone}.`;
  } else if (digits.length >= 7 && digits.length <= 9) {
    const leads = await getLeadDetails({ Lead_ID: digits });
    // connectivity already verified by the probe above
    reply = leads.length ? `📋 ${summarizeLead(leads[0])}` : `No lead ${digits} found (Type ${LEAD_TYPE}).`;
  } else {
    // Summary window. Widen by one day each side of the target to dodge the
    // portal-timezone date boundary (the listing has been observed to omit
    // same-day afternoon leads when queried as a single UTC day).
    const start = process.env.DATE_START || ymd(daysAgo(wantsYesterday ? 2 : 1));
    const end = process.env.DATE_END || ymd(daysAgo(wantsYesterday ? 1 : 0));
    const leads = await fetchWindow(start, end);
    console.log(`Fetched ${leads.length} leads in ${start}..${end}.`);
    const matched = leads.filter((L) => /match/i.test(L.lead_status || '')).length;
    const ours = leads.filter((L) => SRC_RE.test((dataOf(L).src || '') + (dataOf(L).landing_page || '')));
    const oursTf = ours.filter((L) => dataOf(L).trusted_form_url).length;
    // top sources
    const bySrc = {};
    leads.forEach((L) => { const s = dataOf(L).src || '(none)'; bySrc[s] = (bySrc[s] || 0) + 1; });
    const top = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => `  ${s}: ${n}`).join('\n');
    reply = [
      `📊 Type-${LEAD_TYPE} leads ${start}..${end}: ${leads.length} (${matched} matched)`,
      `Our source (${SRC_RE.source}): ${ours.length}${ours.length ? ` · TrustedForm present on ${oursTf}/${ours.length}` : ''}`,
      top ? `Top sources:\n${top}` : '',
      ours.length === 0 && leads.length > 0
        ? `Note: 0 of our leads in this window via the date listing — known quirk; use an email/phone/Lead_ID lookup for our leads.`
        : '',
    ].filter(Boolean).join('\n');
  }

  writeReply(reply);
  console.log('----- REPLY -----\n' + reply);
})();
