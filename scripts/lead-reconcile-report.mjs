#!/usr/bin/env node
// Boberdoo ↔ ClickFlare ↔ Sheety reconciliation report. Backs the
// telegram-reconcile workflow and answers "why are there N leads in Boberdoo but
// M in ClickFlare?" with a categorized verdict (not a row dump).
//
// It runs the same 3-way diff a human would:
//   1. ClickFlare conversions today (eventLogs) → split lead vs Ringba phone-call,
//      count UNIQUE lead click_ids (that's the number the dashboard shows).
//   2. Boberdoo leads today (getLeadDetails via Fixie) → live "in Boberdoo" count.
//   3. Sheety log today → every submit + its click_id + reconciled boberdooStatus.
// Then it diffs Sheety click_ids against ClickFlare and buckets the misses:
//   • cpid-fallback  — click_id == the ClickFlare CampaignID (cpid). quiz.html
//     falls back to cpid when the cf_click_id cookie is empty → unattributable.
//   • no-click_id    — submit carried no click_id at all (organic/direct).
//   • genuine-miss   — real click_id, in Boberdoo, but no ClickFlare conversion.
// It also surfaces outbound postback failures (the gclid "Too short" → Google Ads
// leak) which are a separate, higher-impact problem than the lead-count gap.
//
// AUTH (env, never printed): BOBERDOO_ADMIN_KEY + FIXIE_URL (Boberdoo, IP-gated),
//   CLICKFLARE_USERNAME / CLICKFLARE_PASSWORD, SHEETY_URL.
// CONFIG: BOBERDOO_HOST, LEAD_TYPE (33), LEAD_SRC (shophealthrate),
//   PROBE_LEAD_ID, SCAN_WINDOW (300), CPID (ClickFlare CampaignID for fallback).
// Writes a Telegram-ready answer to _agent_inbox/REPLY.txt.

import fs from 'node:fs';
import path from 'node:path';
import { eventLogs, postbackStatus } from './clickflare-api.mjs';

const KEY = process.env.BOBERDOO_ADMIN_KEY;
const HOST = process.env.BOBERDOO_HOST || 'leosourceinsurance.leadportal.com';
const LEAD_TYPE = process.env.LEAD_TYPE || '33';
const SRC_RE = new RegExp(process.env.LEAD_SRC || 'shophealthrate', 'i');
const API = `https://${HOST}/new_api/api.php`;
const PROBE_LEAD_ID = process.env.PROBE_LEAD_ID || '17232825';
const SCAN_WINDOW = +(process.env.SCAN_WINDOW || 300);
const SHEETY_URL = (process.env.SHEETY_URL || '').replace(/\\n$/, '').trim();
const CPID = process.env.CPID || '6a04cfc67e76d10012a65767';   // ClickFlare CampaignID (the cpid quiz.html falls back to)

const INBOX = path.join(process.cwd(), '_agent_inbox');
fs.mkdirSync(INBOX, { recursive: true });
const writeReply = (s) => fs.writeFileSync(path.join(INBOX, 'REPLY.txt'), s.trim() + '\n');

// ET calendar day (matches ClickFlare's America/New_York window).
const ET = 'America/New_York';
const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date());

// ── Boberdoo (via Fixie static IP) ───────────────────────────────────────────
let FETCH = globalThis.fetch;
let DISPATCHER = null;
async function setupProxy() {
  const proxy = (process.env.FIXIE_URL || process.env.HTTPS_PROXY || '').replace(/\\n$/, '').trim();
  if (!proxy) { console.log('PROXY: none (direct egress).'); return; }
  const u = await import('undici');
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
  if ((r.status || '').toString().toLowerCase() === 'error' || r.error || r.errors) throw new Error('Boberdoo API error: ' + JSON.stringify(r.error || r.errors || r).slice(0, 140));
  const leads = r && r.leads && r.leads.lead;
  return !leads ? [] : (Array.isArray(leads) ? leads : [leads]);
}
const gldSoft = async (extra) => { for (let a = 0; a < 2; a++) { try { return await callGLD(extra); } catch { if (a === 0) continue; return []; } } return []; };
const dataOf = (L) => (Array.isArray(L.lead_data) ? L.lead_data[0] : L.lead_data) || {};
function ymd(d) { return d.toISOString().slice(0, 10); }

// Live scan of recent Boberdoo leads from our source (listing omits our src, so
// bound the id range then confirm by Lead_ID — same approach as lead-check-api).
async function boberdooToday() {
  // Connectivity probe: a rejected key / non-whitelisted IP makes gldSoft return
  // [] for everything, which would otherwise look like "0 leads today". Throw
  // instead so the report shows "⚠️ unavailable" rather than a false zero.
  const probe = await callGLD({ Lead_ID: PROBE_LEAD_ID });
  if (!probe.length) throw new Error(`probe lead ${PROBE_LEAD_ID} empty — key rejected or IP not whitelisted`);
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
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (id) => { const L = await gldSoft({ Lead_ID: String(id) }); return L[0] || null; }));
    found.push(...batch.filter(Boolean));
  }
  // our source + today (lead_date is CT "YYYY-MM-DD ..."; compare the date prefix to ET day — they diverge only for the 11pm–midnight CT sliver)
  const ours = found.filter((L) => { const d = dataOf(L); return SRC_RE.test((d.src || '') + (d.landing_page || '')); });
  const today = ours.filter((L) => (L.lead_date || '').slice(0, 10) === etDay);
  return { today, subIds: new Set(today.map((L) => dataOf(L).sub_id).filter(Boolean)) };
}

// ── Sheety ───────────────────────────────────────────────────────────────────
async function sheetyToday() {
  const res = await globalThis.fetch(SHEETY_URL);
  const j = await res.json();
  const k = Object.keys(j).find((x) => Array.isArray(j[x]));
  const rows = (j[k] || []).filter((r) => r.event === 'lead_submitted');
  // Filter to ET today by formatting the UTC timestamp into the ET calendar day.
  return rows.filter((r) => {
    if (!r.timestamp) return false;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date(r.timestamp));
    return day === etDay;
  });
}

(async () => {
  let bob = { today: [], subIds: new Set() }, bobErr = null;
  try {
    await setupProxy();
    bob = await boberdooToday();
  } catch (e) { bobErr = e.message; }

  // ClickFlare conversions + outbound postback failures.
  let cfLeadIds = new Set(), cfPhoneIds = new Set(), cfLeadEvents = 0, gclidFails = 0, cfErr = null;
  try {
    const cf = await eventLogs({});
    const lead = cf.filter((i) => !(i.ConversionTransaction || '').startsWith('RGB'));
    const phone = cf.filter((i) => (i.ConversionTransaction || '').startsWith('RGB'));
    cfLeadEvents = lead.length;
    cfLeadIds = new Set(lead.map((i) => i.ClickID).filter(Boolean));
    cfPhoneIds = new Set(phone.map((i) => i.ClickID).filter(Boolean));
    const pb = await postbackStatus({});
    // Every "Too short." outbound failure is the empty-gclid → Google Ads leak
    // (the error sometimes names "...at gclid" explicitly, sometimes not).
    gclidFails = pb.filter((i) => i.IsError && /too short/i.test(i.ErrorMessage || '')).length;
  } catch (e) { cfErr = e.message; }

  // Sheety + categorize the leads missing from ClickFlare.
  let sheet = [], sheetErr = null;
  try { sheet = await sheetyToday(); } catch (e) { sheetErr = e.message; }
  const withClick = sheet.filter((r) => r.clickId && r.clickId.length > 5);
  const noClick = sheet.filter((r) => !r.clickId || r.clickId.length <= 5);
  const missing = withClick.filter((r) => !cfLeadIds.has(r.clickId));
  const cpidFallback = missing.filter((r) => r.clickId === CPID);
  const genuineMiss = missing.filter((r) => r.clickId !== CPID);
  // Authoritative "our-source in Boberdoo" count from back-filled reconciliation
  // status — the live id-scan undercounts a high-volume shared lead type (type 33).
  const inBoberdooReconciled = sheet.filter(
    (r) => /^(matched|unmatched)$/i.test((r.boberdooStatus || '').trim())
  ).length;

  // ── Build the verdict ──
  const L = [];
  L.push(`📊 Boberdoo ↔ ClickFlare reconciliation · ${etDay}`);
  L.push('—');
  const bobCount = bobErr ? '⚠️ unavailable' : String(bob.today.length);
  L.push(`Submitted (Sheety): ${sheetErr ? '⚠️' : sheet.length}`);
  L.push(`In Boberdoo (reconciled): ${sheetErr ? '⚠️' : inBoberdooReconciled}`);
  L.push(`In Boberdoo (live scan): ${bobCount}`);
  L.push(`ClickFlare lead conv.: ${cfErr ? '⚠️' : cfLeadIds.size + ' unique'}${!cfErr && cfLeadEvents > cfLeadIds.size ? ` (${cfLeadEvents} events, ${cfLeadEvents - cfLeadIds.size} dup re-fires)` : ''}`);
  if (!cfErr) L.push(`ClickFlare phone-call conv.: ${cfPhoneIds.size}`);
  L.push('—');

  if (!sheetErr && !cfErr) {
    L.push(`Gap explained — ${missing.length + noClick.length} submit(s) not a ClickFlare lead conv.:`);
    if (cpidFallback.length) L.push(`  • ${cpidFallback.length} cpid-fallback (cookie empty → sent CampaignID, unattributable — organic)`);
    if (noClick.length) L.push(`  • ${noClick.length} no click_id at all (organic/direct)`);
    if (genuineMiss.length) {
      L.push(`  • ${genuineMiss.length} genuine miss (real click_id, no CF conv.):`);
      genuineMiss.slice(0, 5).forEach((r) => L.push(`      ${r.clickId}  ${r.boberdooStatus || '(pending)'}`));
    }
    if (!missing.length && !noClick.length) L.push('  • none — every submit is attributed ✅');
  }

  // Income breakdown — proves whether the $0-40,000 suppression is actually working.
  if (!sheetErr) {
    const zero = sheet.filter((r) => r.income === '$0-40,000');
    const zeroConverted = zero.filter((r) => r.clickId && cfLeadIds.has(r.clickId));
    L.push('—');
    L.push(`Income mix: ${zero.length}/${sheet.length} submits are $0-40,000 (suppressed bracket)`);
    if (!cfErr && zeroConverted.length) {
      L.push(`  ⚠️ ${zeroConverted.length} of those STILL converted in ClickFlare (server-webhook leak — needs Boberdoo income filter)`);
    }
  }

  // Higher-impact issues worth flagging regardless of the lead-count gap.
  if (!cfErr && gclidFails > 0) {
    L.push('—');
    L.push(`⚠️ Bigger leak: ${gclidFails} outbound postback(s) to Google Ads FAILED today`);
    L.push(`   (gclid empty → "Too short"). ClickFlare→Google Ads attribution is dropping these.`);
  }

  // Surface partial failures so a silent outage isn't read as "all good".
  const errs = [bobErr && `Boberdoo: ${bobErr}`, cfErr && `ClickFlare: ${cfErr}`, sheetErr && `Sheety: ${sheetErr}`].filter(Boolean);
  if (errs.length) { L.push('—'); L.push('Partial data (some sources errored):'); errs.forEach((e) => L.push('  • ' + e)); }

  const reply = L.join('\n');
  writeReply(reply);
  console.log('----- REPLY -----\n' + reply);
})().catch((e) => { writeReply('⚠️ Reconciliation failed: ' + e.message); console.error(e); process.exit(1); });
