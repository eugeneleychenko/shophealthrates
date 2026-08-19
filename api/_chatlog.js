// Rolling conversation memory for the Telegram bot.
//
// WHY this exists (2026-08-18): the bot posted "Done — added a new page at
// shophealthrates.com/quick-quote.html", Misha replied "@leosource_bot The url
// does not work", and the investigate agent answered "I don't have chat history
// to see what link was shared." The bot was stateless — api/telegram.js handled
// every webhook message in isolation and stored nothing, and the bot could not
// even see its OWN messages (workflow replies curl Telegram directly and never
// pass through Vercel; Telegram never echoes a bot's own output back to it).
//
// Underscore prefix = Vercel does NOT route this file. It is a shared library
// imported by api/telegram.js and api/chatlog-ingest.js.
//
// DESIGN RULE — this module must NEVER throw and must NEVER block the bot.
// Memory is strictly additive: if Upstash is slow, down, or unconfigured, every
// function degrades to a no-op and the bot behaves exactly as it did before this
// existed. Callers do not need try/catch.
//
// Storage: Upstash Redis over its HTTP REST API — plain fetch(), no npm package,
// which keeps this repo dependency-free (see AGENTS.md "no package manager").
//
// Env (Vercel production) — BOTH namings are accepted:
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Upstash's own naming)
//   KV_REST_API_URL        / KV_REST_API_TOKEN          (what Vercel's Upstash
//                                                        Marketplace integration
//                                                        actually injects)
// Accepting both avoids a confusing "why is nothing being stored" session when
// the integration provisions the KV_* names and the code only looks for UPSTASH_*.
//
// Provision the database in the SAME REGION as the function (Vercel defaults to
// iad1 → create the Redis in AWS us-east-1). Cross-region turns a ~15 ms round
// trip into ~90 ms, and this runs on every group message.
//
// Key layout:
//   tg:chat:<chatId>   list, newest first, LTRIM'd to WINDOW. No TTL — the last
//                      WINDOW messages persist indefinitely (rolling window, not
//                      an archive: older messages are discarded, not expired).
//   tg:seen:<updateId> short-lived idempotency marker (Telegram redelivers an
//                      update if the webhook is slow; without this a redelivery
//                      re-fires the whole pipeline including repository_dispatch).

const URL_BASE = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

const WINDOW = 25;        // messages kept per chat
const STORE_MAX = 1500;   // chars persisted per message
const LINE_MAX = 400;     // chars per message when rendering a transcript
const TIMEOUT_MS = 2000;  // hard cap — this runs on EVERY group message
const SEEN_TTL = 300;     // seconds an update_id stays "seen"

const enabled = () => Boolean(URL_BASE && TOKEN);

// Circuit breaker. Each webhook makes up to two calls (seenUpdate + record),
// so an unreachable store would otherwise cost 2 × TIMEOUT_MS on EVERY group
// message. After one failure, skip all calls for BREAKER_MS — the store is
// optional, and a dead store must not slow the bot down. Module scope, so it
// persists across invocations on a warm Vercel instance and resets on a cold one.
const BREAKER_MS = 30000;
let trippedAt = 0;

// Run a pipeline of Redis commands. Returns an array of results (one per
// command) or null on any failure — never throws.
async function upstash(commands) {
  if (!enabled() || !commands.length) return null;
  if (trippedAt && Date.now() - trippedAt < BREAKER_MS) return null; // fast-fail
  try {
    const resp = await fetch(URL_BASE + "/pipeline", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      // Vercel freezes the function after res.send(), so these calls are
      // awaited inline. The timeout is what keeps that from hurting.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) { trippedAt = Date.now(); return null; }
    const out = await resp.json();
    trippedAt = 0; // healthy again
    return Array.isArray(out) ? out.map((r) => (r && "result" in r ? r.result : null)) : null;
  } catch (_) {
    trippedAt = Date.now();
    return null; // network error, timeout, bad JSON — memory is optional
  }
}

const chatKey = (chatId) => "tg:chat:" + String(chatId);

// Append one turn to a chat's rolling window.
//   role: "user" | "bot"
async function record(chatId, entry) {
  if (!enabled() || !chatId) return false;
  const text = String((entry && entry.text) || "").trim();
  if (!text) return false; // photos with no caption, service messages, etc.

  const row = JSON.stringify({
    t: Math.floor(Date.now() / 1000),
    r: entry.role === "bot" ? "bot" : "user",
    n: String(entry.name || (entry.role === "bot" ? "leo_bot" : "someone")).slice(0, 64),
    m: entry.messageId || null,
    x: text.slice(0, STORE_MAX),
  });

  const key = chatKey(chatId);
  const res = await upstash([
    ["LPUSH", key, row],
    ["LTRIM", key, "0", String(WINDOW - 1)],
  ]);
  return res !== null;
}

// Render the chat's recent turns as an oldest-first plain-text transcript.
// Returns "" when disabled, empty, or on any failure.
async function history(chatId, limit) {
  if (!enabled() || !chatId) return "";
  const n = Math.min(limit || WINDOW, WINDOW);
  const res = await upstash([["LRANGE", chatKey(chatId), "0", String(n - 1)]]);
  const rows = res && Array.isArray(res[0]) ? res[0] : [];
  if (!rows.length) return "";

  // Sort by timestamp, NOT by list position. Two independent writers append
  // here — Vercel records inbound, GitHub Actions runners record outbound via
  // /api/chatlog-ingest — so LPUSH arrival order is only approximately
  // chronological. A workflow that takes 5 minutes to answer would otherwise
  // appear BEFORE the messages sent while it was running.
  return rows
    .map((raw) => { try { return JSON.parse(raw); } catch (_) { return null; } })
    .filter((e) => e && e.x)
    .sort((a, b) => (a.t || 0) - (b.t || 0))
    .map((e) => {
      // Render in ET, not UTC. The business runs on ET (the cron is "9am ET",
      // reports say "today · ET"), and an agent reading [02:40] for a message
      // everyone saw at 10:40 PM will misjudge "this morning" / "yesterday".
      let clock;
      try {
        clock = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(new Date((e.t || 0) * 1000));
      } catch (_) {
        clock = new Date((e.t || 0) * 1000).toISOString().slice(11, 16);
      }
      const body = e.x.length > LINE_MAX ? e.x.slice(0, LINE_MAX) + " …" : e.x;
      return "[" + clock + "] " + e.n + ": " + body.replace(/\s*\n\s*/g, " ");
    })
    .join("\n");
}

// True if this update_id was already processed. Fails OPEN (returns false) when
// disabled or unreachable, so a store outage can never silence the bot.
async function seenUpdate(updateId) {
  if (!enabled() || !updateId) return false;
  const res = await upstash([
    ["SET", "tg:seen:" + String(updateId), "1", "NX", "EX", String(SEEN_TTL)],
  ]);
  if (res === null) return false;        // store unreachable → process it
  return res[0] === null;                // NX returned null → key existed → duplicate
}

// Purge a chat's stored window. The manual override for "someone just pasted
// something that shouldn't be retained" — see the PII note in the header.
// Returns true only if the delete actually reached the store.
async function forget(chatId) {
  if (!enabled() || !chatId) return false;
  const res = await upstash([["DEL", chatKey(chatId)]]);
  return res !== null;
}

module.exports = { record, history, seenUpdate, forget, enabled, WINDOW };
