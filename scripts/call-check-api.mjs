#!/usr/bin/env node
// Fast call-conversion check via the OFFICIAL Ringba (+ optional ClickFlare) REST
// APIs — no headless browser, no login, no TOTP. Replaces the agent-browser UI
// scrape in .github/workflows/telegram-call-check.yml.
//
// WHY: the slow/fragile part of the old /check was the headless login + 2FA + DOM
// navigation. Ringba exposes a long-lived API token (MFA only once, at creation),
// and its calllogs/detail endpoint returns EVERYTHING we need — including the
// "PixelFire" event with the literal fired ClickFlare URL, its HTTP status, and the
// click_id/txid/payout actually sent. So at request time this is just fetch() calls.
//
// AUTH (env vars — never printed):
//   RINGBA_API_TOKEN     long-lived token: Ringba > Security > API Access Tokens.
//                        Sent as header  Authorization: Token <token>  (Ringba's
//                        scheme keyword is literally "Token", not "Bearer").
//   RINGBA_ACCOUNT_ID    (optional) the RA... account id; resolved via
//                        GET /v2/ringbaaccounts if unset.
//   CLICKFLARE_USERNAME / CLICKFLARE_PASSWORD  (OPTIONAL) for the destination-side
//                        cross-check via ClickFlare's INTERNAL API (no paid tier) —
//                        see scripts/clickflare-api.mjs. If absent we degrade
//                        gracefully and rely on Ringba's pixel-fire 200.
//   CLICKFLARE_ORG_ID    (optional, default 174149434)
//
// INPUT (env):
//   REQUEST        teammate's free-text ask (optional). A run of 4+ digits is treated
//                  as a phone filter (last-4 works); otherwise we check ALL of today.
//   LOOKBACK_DAYS  (optional, default 0) widen the window to today-N..today for
//                  testing/backfill. 0 = just today (America/New_York).
//
// OUTPUT: on SUCCESS writes a short, Telegram-friendly verdict to
//   _agent_inbox/REPLY.txt and exits 0. On ANY failure (missing Ringba token,
//   network, unexpected API shape) it writes NOTHING and exits non-zero, so the
//   workflow's gated browser fallback takes over. DEBUG=1 dumps raw shapes to stderr.
//
// Node 18+ (global fetch). No dependencies.

import { mkdirSync, writeFileSync } from "node:fs";
import { eventLogs } from "./clickflare-api.mjs";

const BIZ_TZ = "America/New_York"; // business timezone for "today" + ClickFlare
const RINGBA_BASE = "https://api.ringba.com/v2";

const DEBUG = !!process.env.DEBUG;
const dbg = (...a) => DEBUG && process.stderr.write(a.map(String).join(" ") + "\n");
const note = (...a) => process.stderr.write(a.map(String).join(" ") + "\n"); // safe (no secrets)

// ── env ──────────────────────────────────────────────────────────────────────
const RINGBA_API_TOKEN = process.env.RINGBA_API_TOKEN;
const CLICKFLARE_ON = !!(process.env.CLICKFLARE_USERNAME && process.env.CLICKFLARE_PASSWORD);
let RINGBA_ACCOUNT_ID = process.env.RINGBA_ACCOUNT_ID;
const REQUEST = (process.env.REQUEST || "").trim();
const LOOKBACK_DAYS = Math.max(0, parseInt(process.env.LOOKBACK_DAYS || "0", 10) || 0);

// ── timezone: resolve "today" in BIZ_TZ, plus UTC bounds for Ringba ──────────
function bizDateParts(d = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: BIZ_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  const [y, m, day] = ymd.split("-").map(Number);
  return { y, m, d: day, ymd };
}
function tzOffsetMs(utcMs) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: BIZ_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(utcMs)).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
    +(p.hour === "24" ? 0 : p.hour), +p.minute, +p.second);
  return asUTC - utcMs;
}
function bizWallToUtc(y, m, d, hh, mm, ss) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  return new Date(guess - tzOffsetMs(guess));
}
function bizTimeStr(epochMs) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BIZ_TZ, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(epochMs));
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function http(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method, headers: { Accept: "application/json", ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
  if (!res.ok) {
    const e = new Error(`${method} ${url} -> ${res.status}`);
    e.status = res.status; e.body = json; throw e;
  }
  return json;
}
const ringba = (path, opts = {}) =>
  http(`${RINGBA_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Token ${RINGBA_API_TOKEN}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
// ── Ringba: resolve account, pull window's calls + per-call detail ───────────
async function resolveAccountId() {
  if (RINGBA_ACCOUNT_ID) return RINGBA_ACCOUNT_ID;
  const data = await ringba(`/ringbaaccounts`);
  const list = data.account || data.accounts || data.records || (Array.isArray(data) ? data : []);
  const first = Array.isArray(list) ? list[0] : list;
  const id = first && (first.id || first.accountId);
  if (!id) throw new Error("could not resolve Ringba account id from /ringbaaccounts");
  RINGBA_ACCOUNT_ID = id;
  dbg("resolved account", id);
  return id;
}

async function ringbaWindowCalls() {
  const acct = await resolveAccountId();
  const { y, m, d, ymd } = bizDateParts();
  const startDay = LOOKBACK_DAYS
    ? bizDateParts(new Date(Date.now() - LOOKBACK_DAYS * 86400000))
    : { y, m, d };
  const reportStart = bizWallToUtc(startDay.y, startDay.m, startDay.d, 0, 0, 0).toISOString();
  const reportEnd = bizWallToUtc(y, m, d, 23, 59, 59).toISOString();
  note(`Ringba call logs ${LOOKBACK_DAYS ? `last ${LOOKBACK_DAYS}d..` : ""}${ymd} (${BIZ_TZ}) -> UTC ${reportStart}..${reportEnd}`);

  const summary = await ringba(`/${acct}/calllogs`, {
    method: "POST",
    body: { reportStart, reportEnd, size: 1000, offset: 0 },
  });
  const records = summary?.report?.records || summary?.records || [];
  if (!Array.isArray(records)) throw new Error("unexpected Ringba calllogs shape (no report.records[])");
  return records;
}

async function ringbaDetail(ids) {
  if (!ids.length) return new Map();
  const data = await ringba(`/${RINGBA_ACCOUNT_ID}/calllogs/detail`, {
    method: "POST",
    body: { InboundCallIds: ids },
  });
  const recs = data?.report?.records || data?.records || [];
  return new Map(recs.map((r) => [String(r.inboundCallId), r]));
}

// Pull the facts we report out of a detail record (the authoritative source).
function analyze(rec) {
  const events = Array.isArray(rec.events) ? rec.events : [];
  const tags = Array.isArray(rec["message-tags"]) ? rec["message-tags"] : [];
  const tagByName = (n) => tags.find((t) => String(t.name).toLowerCase() === n.toLowerCase())?.value;
  const tagByType = (ty) => tags.find((t) => String(t.type).toLowerCase() === ty.toLowerCase())?.value;
  const named = (re) => events.filter((e) => re.test(String(e.name || "")));

  // PixelFire events carry the literal fired URL under `recordingUrl` (field reuse),
  // plus httpStatusCode + failReason. Prefer the "ClickFlare Phone Call Postback" one.
  const pixels = named(/pixelfire/i).map((p) => {
    const url = p.recordingUrl || p.url || p.fireUrl || "";
    let sent = {};
    try { sent = Object.fromEntries(new URL(url).searchParams); } catch { /* keep {} */ }
    return {
      eventName: p.eventName || "",
      eventCode: p.eventCode || "",
      status: Number(p.httpStatusCode || 0),
      reason: p.failReason || "",
      url,
      sent: { click_id: sent.click_id || "", txid: sent.txid || "", payout: sent.payout || "", ct: sent.ct || "" },
    };
  });
  const phonePixel = pixels.find((p) => /phone\s*call/i.test(p.eventName)) || pixels[0] || null;

  return {
    id: rec.inboundCallId,
    dt: rec.callDt,
    phone: rec.inboundPhoneNumber || "",
    connected: !!rec.hasConnected || named(/connectedcall/i).length > 0,
    converted: !!rec.hasConverted || named(/convertedcall/i).length > 0,
    duration: Number(rec.connectedCallLengthInSeconds || rec.callLengthInSeconds || 0),
    duplicate: !!rec.isDuplicate,
    payoutAmount: Number(rec.payoutAmount || 0),
    cpid: tagByType("ClickFlare ID") || tagByName("cpid") || "",
    clickid: tagByName("clickid") || "",
    pixel: phonePixel,
    pixelCount: pixels.length,
  };
}

// ── ClickFlare cross-check via the INTERNAL API (scripts/clickflare-api.mjs).
// Optional; degrades gracefully if creds are missing or the login/call fails.
// Returns {state:'matched'|'none'|'unavailable', reason?, row?}.
async function clickflareCheck(clickId) {
  if (!CLICKFLARE_ON) return { state: "unavailable", reason: "no ClickFlare credentials" };
  if (!clickId) return { state: "unavailable", reason: "no click_id was sent to match on" };
  try {
    const items = await eventLogs({ clickId, days: LOOKBACK_DAYS, eventType: "conversion" });
    if (DEBUG && items[0]) dbg("clickflare item keys:", Object.keys(items[0]).join(","));
    if (!items.length) return { state: "none" };
    const it = items[0];
    return {
      state: "matched",
      row: { clickId: it.ClickID, txid: it.ConversionTransaction, payout: it.ConversionPayout, date: it.ConversionDate },
    };
  } catch (e) {
    return { state: "unavailable", reason: `ClickFlare internal API error (${e.status || e.message})` };
  }
}

// ── build the per-call line + status ─────────────────────────────────────────
function fmtPhone(p) {
  return String(p).replace(/^\+?1?(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") || String(p);
}

async function evaluateCall(a) {
  const issues = [];
  let landed = false;
  let head;

  if (!a.pixel) {
    head = "❌ no ClickFlare pixel fired";
  } else if (a.pixel.status !== 200) {
    head = `❌ pixel fired but HTTP ${a.pixel.status || "?"} (${a.pixel.reason || "no reason"})`;
  } else {
    // pixel fired with 200 — inspect what was actually sent
    const sent = a.pixel.sent;
    if (!sent.click_id) issues.push("click_id EMPTY");
    else if (a.cpid && sent.click_id !== a.cpid) issues.push(`click_id sent is the Google clickid, not the ClickFlare cpid (${a.cpid})`);
    if (!sent.txid) issues.push("txid EMPTY");

    let cf = { state: "unavailable", reason: "skipped" };
    if (sent.click_id) cf = await clickflareCheck(sent.click_id);

    if (cf.state === "matched") {
      const txOk = cf.row.txid ? `txid ${cf.row.txid}` : "txid empty in ClickFlare";
      head = `✅ landed in ClickFlare (${txOk})`;
      landed = !issues.length;
    } else if (cf.state === "none") {
      head = "⚠️ pixel fired 200 but ClickFlare shows NO matching conversion";
      issues.push("no ClickFlare conversion row for the sent click_id");
    } else {
      // ClickFlare couldn't confirm — fall back to Ringba's 200 as interim proof
      head = issues.length
        ? "⚠️ pixel fired 200 but payload looks wrong"
        : "✅ pixel accepted by ClickFlare (HTTP 200)";
      landed = !issues.length;
      if (cf.reason && cf.reason !== "skipped") issues.push(`CF cross-check unavailable: ${cf.reason}`);
    }
  }

  const meta = `${a.connected ? "connected" : "missed"} ${a.duration}s${a.duplicate ? " ·dup" : ""}, Ringba ${a.converted ? "Converted" : "not converted"}`;
  const sentStr = a.pixel
    ? `; sent click_id=${a.pixel.sent.click_id || "∅"} txid=${a.pixel.sent.txid || "∅"} payout=${a.pixel.sent.payout || "∅"}`
    : "";
  const line = `• ${bizTimeStr(a.dt)} ${fmtPhone(a.phone)}: ${meta}. ${head}${sentStr}` +
    (issues.length ? `\n    ↳ ${issues.join("; ")}` : "");
  return { landed, line };
}

// ── main ─────────────────────────────────────────────────────────────────────
function writeReply(text) {
  mkdirSync("_agent_inbox", { recursive: true });
  writeFileSync("_agent_inbox/REPLY.txt", text.trim() + "\n");
  note("call-check-api: wrote verdict to _agent_inbox/REPLY.txt");
  process.stdout.write(text.trim() + "\n");
}

async function main() {
  if (!RINGBA_API_TOKEN) {
    note("call-check-api: missing RINGBA_API_TOKEN — handing off to browser fallback.");
    process.exit(2);
  }

  const phoneFilter = (REQUEST.match(/\d{4,}/) || [])[0];
  let calls = await ringbaWindowCalls();
  if (phoneFilter) calls = calls.filter((c) => String(c.inboundPhoneNumber || "").replace(/\D/g, "").includes(phoneFilter));

  const { ymd } = bizDateParts();
  const scope = LOOKBACK_DAYS ? `last ${LOOKBACK_DAYS}d` : ymd;
  if (!calls.length) {
    writeReply(`No calls logged in Ringba for ${scope} (${BIZ_TZ})${phoneFilter ? ` matching …${phoneFilter}` : ""}. Nothing to verify yet.`);
    return;
  }

  const ids = calls.map((c) => c.inboundCallId).filter(Boolean);
  const detail = await ringbaDetail(ids);

  const reported = [];
  let anyLanded = false;
  for (const c of calls) {
    const rec = detail.get(String(c.inboundCallId));
    if (!rec) continue;
    const a = analyze(rec);
    if (!a.connected && !a.converted) continue; // skip unanswered for brevity
    const { landed, line } = await evaluateCall(a);
    if (landed) anyLanded = true;
    reported.push(line);
    if (reported.length >= 8) { reported.push(`…(+more calls in ${scope})`); break; }
  }

  if (!reported.length) {
    writeReply(`${calls.length} call(s) in ${scope} (${BIZ_TZ}) but none connected — no conversion expected.`);
    return;
  }

  const cfNote = CLICKFLARE_ON ? "" : "\n(ClickFlare creds not set — confirmed via Ringba's pixel-fire 200 only.)";
  const header = anyLanded
    ? `✅ YES — call conversion landed (${scope}, ${BIZ_TZ}).`
    : `⚠️ NOT fully confirmed — pixel fired but payload/attribution looks off (${scope}, ${BIZ_TZ}).`;
  const footer = `Revenue $0 is by design (U65 targets pay $0).${cfNote}`;
  writeReply([header, ...reported, footer].join("\n"));
}

main().catch((e) => {
  note(`call-check-api FAILED: ${e.message}`);
  if (e.status) note(`  HTTP ${e.status}: ${JSON.stringify(e.body || {}).slice(0, 400)}`);
  process.exit(1);
});
