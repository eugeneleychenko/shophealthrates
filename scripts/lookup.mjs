#!/usr/bin/env node
// Look up specific leads/sales by ClickFlare click_id, Boberdoo Sub_ID (the 30-char
// truncated click_id), email — or FIRST NAME (`name:kevin`) — across ClickFlare
// conversions + the Sheety log. Backs the /lookup command AND is the investigate
// agent's first tool. Answers "do you see these sales in boberdoo?" with a per-id
// matched/unmatched/$ verdict instead of a generic aggregate. A name resolves via
// the `name=` field both log-lead and enrollment rows carry in rawQuery (added after
// the 2026-07-13 "what's Kevin's phone number?" miss) and reports the row's email /
// phone last-4 / click_id, then the click verdict; the FULL phone lives only in
// Boberdoo (chase with lead-check-api.mjs <email>).
//
// WHY ClickFlare + Sheety (not Boberdoo): matched status + revenue live in ClickFlare
// ConversionPayout ($50 matched / $0 unmatched); Sheety carries the full clickId and
// the reconciled boberdooStatus/txid. Neither is IP-gated, so this needs NO Fixie or
// Boberdoo key (the agent's live-Boberdoo path is the fallback for ids older than the
// ClickFlare/Sheety window).
//
// AUTH (env, never printed): SHEETY_URL, CLICKFLARE_USERNAME / CLICKFLARE_PASSWORD,
//   CLICKFLARE_ORG_ID (optional). CONFIG: LOOKBACK_DAYS (default 45).
// INPUT: ids/emails/name: tokens from argv (`node scripts/lookup.mjs <id> name:kevin`)
// or REQUEST env. Writes a Telegram-ready answer to _agent_inbox/REPLY.txt.
// Exit: 0 = wrote a verdict · 3 = no id/email/name tokens (let the LLM handle it) ·
//       1 = both data sources failed (let the LLM fallback try, incl. live Boberdoo).

import fs from 'node:fs';
import path from 'node:path';
import { allEventLogs } from './clickflare-api.mjs';

const SHEETY_URL = (process.env.SHEETY_URL || '').replace(/\\n$/, '').trim();
const LOOKBACK_DAYS = +(process.env.LOOKBACK_DAYS || 45);
const RAW = (process.argv.slice(2).join(' ') || process.env.REQUEST || '').trim();
const MAX_IDS = 15;   // Telegram-friendly cap

const INBOX = path.join(process.cwd(), '_agent_inbox');
fs.mkdirSync(INBOX, { recursive: true });
const writeReply = (s) => fs.writeFileSync(path.join(INBOX, 'REPLY.txt'), s.trim() + '\n');

const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
const money = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const isPhone = (i) => (i.ConversionTransaction || '').startsWith('RGB');
// Both a 30-char Sub_ID and a 36-char click_id share their first 30 literal chars.
const key30 = (s) => String(s || '').toLowerCase().slice(0, 30);

// Extract id (UUID or 30-char-truncated UUID), email and name: tokens from the free text.
const ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{0,12}/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const NAME_RE = /(?:^|\s)name:\s*([a-z][a-z'’-]{1,29})/gi;
const ids = [...new Set((RAW.match(ID_RE) || []).map((s) => s.trim()))];
const emails = [...new Set((RAW.match(EMAIL_RE) || []).map((s) => s.toLowerCase()))];
const names = [...new Set([...RAW.matchAll(NAME_RE)].map((m) => m[1].toLowerCase()))];

if (!ids.length && !emails.length && !names.length) process.exit(3);   // no tokens → let the LLM handle it

async function getSheet() {
  if (!SHEETY_URL) throw new Error('SHEETY_URL not set');
  const res = await fetch(SHEETY_URL);
  if (!res.ok) throw new Error(`Sheety GET ${res.status}`);
  const j = await res.json();
  const k = Object.keys(j).find((x) => Array.isArray(j[x]));
  return k ? j[k] : [];
}

// Both log-lead and enrollment rows carry "name=<first name>" (and the enrollment
// row "phone=***<last4>") inside their free-form rawQuery column.
const nameOf = (r) => { const m = String(r.rawQuery || '').match(/(?:^|&)name=([^&]*)/i); return m ? m[1].trim().toLowerCase() : ''; };
const last4Of = (r) => { const m = String(r.rawQuery || '').match(/phone=\**(\d{4})/i); return m ? m[1] : ''; };

const short = (s) => (s.length > 34 ? s.slice(0, 30) + '…' : s);

(async () => {
  let cf = [], all = [], cfErr = null, shErr = null;
  try { cf = await allEventLogs({ days: LOOKBACK_DAYS, eventType: 'conversion' }); } catch (e) { cfErr = e.message; }
  try { all = await getSheet(); } catch (e) { shErr = e.message; }
  if (cfErr && shErr) {   // hard failure on both → let the LLM fallback try (incl. live Boberdoo)
    console.error(`lookup: both sources failed (ClickFlare: ${cfErr}; Sheety: ${shErr})`);
    process.exit(1);
  }
  const rows = all.filter((r) => r.event === 'lead_submitted');
  const enrolls = all.filter((r) => r.event === 'enrollment');

  // Build the target list: each pasted id, plus each email resolved to its clickId.
  const targets = [];
  for (const id of ids) targets.push({ label: id, key: key30(id) });
  for (const em of emails) {
    const r = rows.find((x) => (x.email || '').toLowerCase() === em);
    targets.push({ label: em, key: r && r.clickId ? key30(r.clickId) : null, miss: r ? 'no click_id on its Sheety row' : `no Sheety row (last ${LOOKBACK_DAYS}d)` });
  }

  // Resolve name: tokens via the Sheety name= field — enrollment rows first (that's
  // what a "who is <name>?" right after a sale ping means), then lead rows, newest
  // first. Each hit reports its identifiers and also joins the click-verdict list.
  const nameLines = [];
  for (const nm of names) {
    const hits = [...enrolls, ...rows].filter((r) => nameOf(r) === nm)
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    if (!hits.length) { nameLines.push(`❓ ${nm} — no lead or enrollment row with that first name in the Sheety log`); continue; }
    for (const h of hits.slice(0, 3)) {
      const what = h.event === 'enrollment' ? '🎉 enrollment (sale)' : 'lead';
      nameLines.push([
        `${nm} — ${what} ${String(h.timestamp || '').slice(0, 16)} [Sheety]`,
        h.email ? `email ${h.email}` : '',
        last4Of(h) ? `phone ***${last4Of(h)}` : '',
        h.clickId ? `click_id ${short(String(h.clickId))}` : 'no click_id',
      ].filter(Boolean).join(' · '));
      if (h.clickId && !targets.some((t) => t.key === key30(h.clickId))) {
        targets.push({ label: `${nm}'s click`, key: key30(h.clickId) });
      }
    }
  }
  const shown = targets.slice(0, MAX_IDS);

  const lines = [];
  for (const t of shown) {
    const lbl = short(t.label);
    if (!t.key) { lines.push(`❓ ${lbl} — ${t.miss}`); continue; }
    const cfHit = cf.find((i) => i.ClickID && key30(i.ClickID) === t.key);
    const shHit = rows.find((r) => r.clickId && key30(r.clickId) === t.key);
    if (cfHit) {
      const pay = num(cfHit.ConversionPayout);
      const who = shHit && shHit.email ? ' · ' + shHit.email : '';
      if (pay > 0) {
        const kind = isPhone(cfHit) ? ' phone-call' : '';
        const tx = cfHit.ConversionTransaction ? ' · txid ' + cfHit.ConversionTransaction : '';
        lines.push(`✅ ${lbl} — MATCHED, sold ${money(pay)}${kind} [ClickFlare${tx}]${who}`);
      } else {
        lines.push(`⛔ ${lbl} — unmatched, $0 [ClickFlare: click present, no buyer payout]${who}`);
      }
    } else if (shHit) {
      const st = (shHit.boberdooStatus || '').trim().toLowerCase();
      if (st === 'matched') lines.push(`✅ ${lbl} — matched [Sheety boberdooStatus]; no ClickFlare conv. in last ${LOOKBACK_DAYS}d (reconcile lag?)`);
      else if (st === 'unmatched') lines.push(`⛔ ${lbl} — unmatched, $0 [Sheety boberdooStatus]`);
      else if (st === 'not-found') lines.push(`❌ ${lbl} — submitted but never reached Boberdoo [Sheety: not-found]`);
      else lines.push(`⏳ ${lbl} — submitted ${shHit.timestamp || ''} [Sheety], not yet reconciled / no ClickFlare conv.`);
    } else {
      lines.push(`❓ ${lbl} — not found in ClickFlare or Sheety (last ${LOOKBACK_DAYS}d); may be older or only in Boberdoo`);
    }
  }

  const L = [`🔎 Lookup · ${targets.length || names.length} id${(targets.length || names.length) === 1 ? '' : 's'}`, '—', ...nameLines, ...lines];
  if (targets.length > shown.length) L.push(`…(+${targets.length - shown.length} more — narrow the list)`);
  L.push('—');
  L.push("$50 = matched (sold to a buyer) · $0 = unmatched. Sub_ID = click_id's first 30 chars.");
  L.push('Source: ClickFlare ConversionPayout + Sheety boberdooStatus (Boberdoo read API has no per-lead price).');
  if (names.length) L.push('Sheety keeps phone LAST-4 only — for the full number run lead-check-api.mjs <email> (Boberdoo).');
  if (cfErr) L.push(`⚠️ ClickFlare unavailable (${cfErr})`);
  if (shErr) L.push(`⚠️ Sheety unavailable (${shErr})`);

  writeReply(L.join('\n'));
  console.log('----- REPLY -----\n' + L.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
