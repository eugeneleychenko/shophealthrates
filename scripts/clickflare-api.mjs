#!/usr/bin/env node
// ClickFlare data client via the INTERNAL app API (api.clickflare.io) — no paid
// "Public API" tier required (that one 403s for our plan), no browser at runtime.
//
// Discovered by reverse-engineering the dashboard's own network traffic with the
// browserbase `browser-to-api` skill (capture harness in .b2a/; spec in
// api_docs/clickflare-internal-api.*). Auth = username/password login → a JWT that
// is sent back in a header literally named `jwt`, plus `x-organization-id`.
//
// AUTH (env — never printed):
//   CLICKFLARE_USERNAME / CLICKFLARE_PASSWORD   (no MFA)
//   CLICKFLARE_ORG_ID    (optional, default 174149434)
//
// ⚠️ This is an UNDOCUMENTED internal API and can change without notice. If a call
// starts returning 4xx/odd shapes, re-capture (see .b2a/) and re-check field names.
//
// Library:  import { login, eventLogs, postbackStatus } from './clickflare-api.mjs'
// CLI:      node scripts/clickflare-api.mjs conversions [YYYY-MM-DD]
//           node scripts/clickflare-api.mjs postbacks   [YYYY-MM-DD]
//
// Node 18+ (global fetch). No dependencies.

const LOGIN_URL = 'https://user-manager-v2.clickflare.io/api/login';
const API = 'https://api.clickflare.io';
const ORG = process.env.CLICKFLARE_ORG_ID || '174149434';
const ORIGIN = 'https://app.clickflare.com';
const TZ = 'America/New_York';

let _token = null;

export async function login() {
  if (_token) return _token;
  const user = process.env.CLICKFLARE_USERNAME, pass = process.env.CLICKFLARE_PASSWORD;
  if (!user || !pass) throw new Error('CLICKFLARE_USERNAME / CLICKFLARE_PASSWORD not set');
  const r = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!r.ok) throw new Error(`ClickFlare login failed: HTTP ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error('ClickFlare login returned no token');
  _token = j.token;
  return _token;
}

async function post(path, body) {
  const token = await login();
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'x-organization-id': ORG, jwt: token },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { _raw: t }; }
  if (!r.ok) { const e = new Error(`ClickFlare ${path} -> HTTP ${r.status}`); e.status = r.status; e.body = j; throw e; }
  return j;
}

function dayStr(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() - offsetDays * 86400000));
}
function dayRange(date, days = 0) {
  const end = date || dayStr(0);
  const start = days > 0 ? dayStr(days) : end;
  return { startDate: `${start} 00:00:00`, endDate: `${end} 23:59:59`, timezone: TZ, _date: end };
}

// Conversions (and other events). Pass {clickId} to match a specific click;
// {days} widens the window to the last N days (default = single day = today/date).
export async function eventLogs({ date, days = 0, clickId, eventType = 'conversion', pageSize = 100 } = {}) {
  const { startDate, endDate, timezone } = dayRange(date, days);
  const metricsFilters = [];
  if (eventType) metricsFilters.push({ name: 'EventType', operator: '=', value: eventType });
  if (clickId) metricsFilters.push({ name: 'ClickID', operator: '=', value: clickId });
  const r = await post('/api/event-logs', {
    startDate, endDate, timezone,
    metrics: ['EventType', 'ClickID', 'ConversionTransaction', 'ConversionDate', 'ConversionPayout', 'CustomConversionNumber'],
    ...(metricsFilters.length ? { metricsFilters } : {}),
    sortBy: 'ConversionDate', orderType: 'desc', page: 1, pageSize,
  });
  return r.items || [];
}

// Outbound postback / Conversion-API send results (incl. Google Ads errors).
export async function postbackStatus({ date, pageSize = 100 } = {}) {
  const { startDate, endDate, timezone } = dayRange(date);
  const r = await post('/api/postback-status/logs', {
    startDate, endDate, timezone,
    metrics: ['ClickID', 'IsError', 'ErrorMessage', 'StatusCode', 'PostbackUrl', 'IntegrationID', 'Ct', 'Event', 'CustomConversionIndex', 'PostbackTime'],
    sortBy: 'ClickTime', orderType: 'desc', page: 1, pageSize,
  });
  return r.items || [];
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'conversions', date] = process.argv.slice(2);
  try {
    if (cmd === 'conversions' || cmd === 'event-logs') {
      const items = await eventLogs({ date });
      console.log(`${items.length} conversion(s) ${date || 'today'}:`);
      for (const i of items) console.log(`  • ${i.ConversionDate}  click ${i.ClickID}  txid ${i.ConversionTransaction || '∅'}  payout ${i.ConversionPayout}`);
    } else if (cmd === 'postbacks' || cmd === 'postback-status') {
      const items = await postbackStatus({ date });
      const bad = items.filter(i => i.IsError);
      console.log(`${items.length} postback(s) ${date || 'today'} — ${bad.length} failing:`);
      for (const i of items) console.log(`  • ${i.IsError ? '❌' : '✅'} code ${i.StatusCode}  ${i.ErrorMessage || 'ok'}  action ${(i.PostbackUrl || '').split('/').pop()}  int ${i.IntegrationID}`);
    } else {
      console.error('usage: clickflare-api.mjs [conversions|postbacks] [YYYY-MM-DD]'); process.exit(2);
    }
  } catch (e) {
    console.error('FAILED:', e.message); if (e.status) console.error('  HTTP', e.status, JSON.stringify(e.body || {}).slice(0, 300));
    process.exit(1);
  }
}
