#!/usr/bin/env node
// Sales report — answers "how many sales / how much revenue?" for a time window.
// Backs the telegram-sales workflow (/sales command). Combines two sources:
//   • Sheety lead log → submitted / sold (Boberdoo matched) / unmatched / pending,
//     using the boberdooStatus that lead-reconcile.mjs back-fills.
//   • ClickFlare eventLogs → REVENUE (ConversionPayout) + lead-conversion count,
//     split from Ringba phone-call conversions (ConversionTransaction "RGB…").
//
// WHY ClickFlare for revenue: Boberdoo's getLeadDetails exposes NO per-lead price
// (only number_of_times_sold + matched_partners, no $). The lead price reaches
// ClickFlare as the conversion `payout` (Boberdoo webhook `payout={LEAD_PRICE}`),
// so ClickFlare's ConversionPayout is the only readable revenue figure.
//
// No Boberdoo/Fixie call here — counts come from the already-reconciled Sheety log
// (Vercel/CI can reach Sheety + ClickFlare with no IP allowlist).
//
// AUTH (env, never printed): SHEETY_URL, CLICKFLARE_USERNAME / CLICKFLARE_PASSWORD,
//   CLICKFLARE_ORG_ID (optional). INPUT: REQUEST free text (window).
// Writes a Telegram-ready answer to _agent_inbox/REPLY.txt.

import fs from 'node:fs';
import path from 'node:path';
import { allEventLogs } from './clickflare-api.mjs';

const SHEETY_URL = (process.env.SHEETY_URL || '').replace(/\\n$/, '').trim();
const REQUEST = (process.env.REQUEST || '').trim();
const ET = 'America/New_York';

const INBOX = path.join(process.cwd(), '_agent_inbox');
fs.mkdirSync(INBOX, { recursive: true });
const writeReply = (s) => fs.writeFileSync(path.join(INBOX, 'REPLY.txt'), s.trim() + '\n');

const fmtDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date(ms));
const etDayOf = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? fmtDay(t) : ''; };
const money = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Parse the free-text window into ClickFlare opts + an inclusive ET day range.
// Supports: today (default) · yesterday · "7d"/"week" · "Nd" · "30d"/"month" · YYYY-MM-DD.
function parseWindow(req) {
  const t = (req || '').toLowerCase().replace(/[@#]\S+/g, '').trim();
  const now = Date.now();
  const today = fmtDay(now);
  const range = (db, label) => ({ cfOpts: { days: db }, startDay: fmtDay(now - db * 86400000), endDay: today, label });
  let m;
  if ((m = t.match(/(\d{4}-\d{2}-\d{2})/))) return { cfOpts: { date: m[1] }, startDay: m[1], endDay: m[1], label: m[1] };
  if (/\byesterday\b/.test(t)) { const d = fmtDay(now - 86400000); return { cfOpts: { date: d }, startDay: d, endDay: d, label: 'yesterday · ' + d }; }
  if (/\b(this\s*month|month|mtd)\b/.test(t)) return range(29, 'last 30 days');
  if ((m = t.match(/\b(\d{1,3})\s*d(?:ays?)?\b/))) { const n = Math.min(Math.max(+m[1], 1), 90); return range(n - 1, `last ${n} days`); }
  if (/\b(today|so\s*far)\b/.test(t)) return { cfOpts: { date: today }, startDay: today, endDay: today, label: 'today · ' + today };
  // default (incl. empty / "this week") → last 7 days, matching the weekly sales ask.
  return range(6, 'last 7 days');
}

const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
const isPhone = (i) => (i.ConversionTransaction || '').startsWith('RGB');

async function getSheet() {
  const res = await fetch(SHEETY_URL);
  if (!res.ok) throw new Error(`Sheety GET ${res.status}`);
  const j = await res.json();
  const k = Object.keys(j).find((x) => Array.isArray(j[x]));
  return k ? j[k] : [];
}

(async () => {
  const W = parseWindow(REQUEST);
  const inWindow = (iso) => { const d = etDayOf(iso); return d && d >= W.startDay && d <= W.endDay; };

  // ── Sheety: counts (submitted / matched / unmatched / pending) ──
  let sheet = [], sheetErr = null;
  try {
    const rows = await getSheet();
    sheet = rows.filter((r) => r.event === 'lead_submitted' && inWindow(r.timestamp));
  } catch (e) { sheetErr = e.message; }
  const statusIs = (r, s) => (r.boberdooStatus || '').trim().toLowerCase() === s;
  const submitted = sheet.length;
  const matched = sheet.filter((r) => statusIs(r, 'matched')).length;
  const unmatched = sheet.filter((r) => statusIs(r, 'unmatched')).length;
  // pending = not yet reconciled (empty txid, no not-found sentinel) — recent leads.
  const pending = sheet.filter((r) => !r.txid && !statusIs(r, 'not-found')).length;

  // ── ClickFlare: revenue (ConversionPayout) + sold counts ──
  // A "sold" lead = a PAID conversion (payout > 0). Unmatched leads post a $0
  // conversion, so they sum to nothing and aren't counted as sold. Re-fires of the
  // same click inflate the event count (and the ClickFlare-dashboard revenue), so
  // we surface unique-lead vs event counts rather than hide the duplication.
  let revenue = 0, soldEvents = 0, soldUnique = 0, phoneConv = 0, paidVals = [], cfErr = null;
  try {
    const items = await allEventLogs({ ...W.cfOpts, eventType: 'conversion' });
    const leads = items.filter((i) => !isPhone(i));
    const paid = leads.filter((i) => num(i.ConversionPayout) > 0);
    soldEvents = paid.length;
    soldUnique = new Set(paid.map((i) => i.ClickID).filter(Boolean)).size;
    phoneConv = items.filter(isPhone).length;
    paidVals = paid.map((i) => num(i.ConversionPayout));
    revenue = leads.reduce((s, i) => s + num(i.ConversionPayout), 0);
  } catch (e) { cfErr = e.message; }
  const distinctPaid = [...new Set(paidVals)].sort((a, b) => a - b);
  const flatPrice = distinctPaid.length === 1 ? distinctPaid[0] : null;
  const priceTag = flatPrice != null ? ` @ $${flatPrice}` : '';

  // "Sold" = paid conversions. A lead can sell to multiple buyers (each a real
  // $X sale), so when conversions > distinct leads we show "N across M leads"
  // rather than calling the extras duplicates.
  let soldText;
  if (cfErr) soldText = '⚠️';
  else if (!soldEvents) soldText = '0';
  else if (soldEvents === soldUnique) soldText = `${soldEvents} lead${soldEvents === 1 ? '' : 's'}${priceTag}`;
  else soldText = `${soldEvents} conversions across ${soldUnique} lead${soldUnique === 1 ? '' : 's'}${priceTag}`;

  // ── Build the reply ──
  const L = [];
  L.push(`🧾 Sales · ${W.label} (ET)`);
  L.push('—');
  L.push(`💰 Revenue (ClickFlare): ${cfErr ? '⚠️ unavailable' : money(revenue)}`);
  L.push(`✅ Sold: ${soldText}`);
  L.push('—');
  if (!sheetErr) {
    L.push(`Submitted (our site): ${submitted}`);
    L.push(`Boberdoo: ${matched} matched · ${unmatched} unmatched${pending ? ` · ⏳ ${pending} pending reconcile` : ''}`);
  } else {
    L.push('Sheety funnel (submitted / matched): ⚠️ unavailable');
  }
  if (!cfErr) L.push(`📞 Phone-call conv. (Ringba): ${phoneConv}`);

  // Honest cross-check: Boberdoo-matched (Sheety) vs ClickFlare paid conversions
  // measure the same "sold" event in two systems and can diverge (time basis,
  // reconcile lag, re-fires). Surface it rather than imply false agreement.
  if (!sheetErr && !cfErr && soldUnique && Math.abs(matched - soldUnique) > Math.max(2, soldUnique * 0.15)) {
    L.push(`ℹ️ ${matched} Boberdoo-matched vs ${soldUnique} ClickFlare-sold — /reconcile explains the gap.`);
  }

  L.push('—');
  L.push('Revenue & sold from ClickFlare conversions (Boberdoo\'s API exposes no per-lead price). $0 = unmatched.');

  const errs = [sheetErr && `Sheety: ${sheetErr}`, cfErr && `ClickFlare: ${cfErr}`].filter(Boolean);
  if (errs.length) { L.push('—'); L.push('Partial data (some sources errored):'); errs.forEach((e) => L.push('  • ' + e)); }

  const reply = L.join('\n');
  writeReply(reply);
  console.log('----- REPLY -----\n' + reply);
})().catch((e) => { writeReply('⚠️ Sales report failed: ' + e.message); console.error(e); process.exit(1); });
