// Telegram webhook → GitHub Actions relay.
//
// This is a THIN relay, not the brain. It runs as a Vercel serverless function
// at https://shophealthrates.com/api/telegram (same project as the site, free,
// scales to zero — no VPS). It does three things and nothing else:
//   1. Verifies the request really came from our bot (secret header + chat allowlist).
//   2. Decides whether the message is actually addressed to the bot.
//   3. Fires a GitHub `repository_dispatch`, which wakes up the workflow in
//      .github/workflows/telegram-agent.yml — THAT is where Claude edits the
//      code, commits, and deploys.
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   TELEGRAM_SECRET        - random string; must match the secret_token used in setWebhook
//   TELEGRAM_BOT_TOKEN     - bot token from BotFather (used only for the instant ack reply)
//   TELEGRAM_BOT_USERNAME  - the bot's @username, WITHOUT the @ (e.g. leosource_bot)
//   ALLOWED_CHAT_IDS       - comma-separated chat ids allowed to trigger changes
//   GITHUB_TOKEN           - fine-grained PAT for eugeneleychenko/shophealthrates with Contents: Read & write

const GH_OWNER = "eugeneleychenko";
const GH_REPO = "shophealthrates";

module.exports = async (req, res) => {
  // Telegram only ever POSTs. Anything else is a probe/health check.
  if (req.method !== "POST") return res.status(200).send("ok");

  // 1. Verify the request really came from our Telegram bot.
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (!process.env.TELEGRAM_SECRET || secret !== process.env.TELEGRAM_SECRET) {
    return res.status(401).send("bad secret");
  }

  const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const msg = update && (update.message || update.channel_post);
  if (!msg) return res.status(200).send("ignored"); // edits, joins, reactions, etc.

  // 2. Only act on messages from allowed chats (the Leosource group).
  const allowed = (process.env.ALLOWED_CHAT_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const chatId = String(msg.chat && msg.chat.id);
  if (allowed.length && !allowed.includes(chatId)) {
    return res.status(200).send("chat not allowed");
  }

  // 3. The bot only acts when explicitly addressed, so normal group chatter
  //    never triggers a deploy. Trigger on "/change <request>" or an @mention.
  const text = msg.text || msg.caption || "";
  const botUser = process.env.TELEGRAM_BOT_USERNAME || "";

  // How was the bot addressed? This sets the intent hint passed downstream:
  //   /change <edit>   → make a code change + deploy
  //   /ask <question>  → answer a question, no code changes, no deploy
  //   @mention <text>  → "auto": the agent decides whether to answer or change
  // Handle /diagnose locally — no GitHub Actions needed
  if (/^\/diagnose\b/i.test(text)) {
    const arg = text.replace(/^\/diagnose(@\w+)?/i, "").trim();
    await handleDiagnose(chatId, arg);
    return res.status(200).send("diagnose handled");
  }

  // Handle /ringba (or /mfa) locally — returns the current Ringba MFA code.
  if (/^\/(ringba|mfa)\b/i.test(text)) {
    await handleRingbaMfa(chatId);
    return res.status(200).send("mfa handled");
  }

  // Handle /reconcile (or /gap) — explain a Boberdoo-vs-ClickFlare lead-count gap
  // with a categorized verdict (cloud workflow: Boberdoo + ClickFlare + Sheety diff).
  if (/^\/(reconcile|gap)\b/i.test(text)) {
    const botUserName = process.env.TELEGRAM_BOT_USERNAME || "";
    const arg = text.replace(/^\/(reconcile|gap)(@\w+)?/i, "").split("@" + botUserName).join("").trim();
    const from = (msg.from && (msg.from.username || msg.from.first_name)) || "client";
    await handleReconcile(chatId, msg.message_id, arg, from);
    return res.status(200).send("reconcile handled");
  }

  // Handle /check (or /call, /conversion) — verify a phone-call conversion
  // end-to-end by logging into Ringba + ClickFlare in the cloud. This dispatches
  // the telegram-call-check workflow (NOT the code-change one).
  if (/^\/(check|call|conversion)\b/i.test(text)) {
    const botUserName = process.env.TELEGRAM_BOT_USERNAME || "";
    const arg = text
      .replace(/^\/(check|call|conversion)(@\w+)?/i, "")
      .split("@" + botUserName).join("")
      .trim();
    const from = (msg.from && (msg.from.username || msg.from.first_name)) || "client";
    await handleCallCheck(chatId, msg.message_id, arg, from);
    return res.status(200).send("call-check handled");
  }

  // Handle /sales (or /revenue) — sold-lead count + ClickFlare revenue for a
  // window (today/week/30d/date). Cloud workflow: Sheety counts + ClickFlare $.
  if (/^\/(sales|revenue)\b/i.test(text)) {
    const botUserName = process.env.TELEGRAM_BOT_USERNAME || "";
    const arg = text.replace(/^\/(sales|revenue)(@\w+)?/i, "").split("@" + botUserName).join("").trim();
    const from = (msg.from && (msg.from.username || msg.from.first_name)) || "client";
    await handleSales(chatId, msg.message_id, arg, from);
    return res.status(200).send("sales handled");
  }

  // Handle /lookup <ids|email> — deterministic per-id resolver (ClickFlare + Sheety).
  // Instant, no LLM: answers "do you see these sales?" for specific click_ids/Sub_IDs.
  if (/^\/lookup\b/i.test(text)) {
    const botUserName = process.env.TELEGRAM_BOT_USERNAME || "";
    const arg = text.replace(/^\/lookup(@\w+)?/i, "").split("@" + botUserName).join("").trim();
    const from = (msg.from && (msg.from.username || msg.from.first_name)) || "client";
    await handleInvestigate(chatId, msg.message_id, arg, from, "lookup");
    return res.status(200).send("lookup handled");
  }

  // Handle /investigate (or /data) <question> — force the LLM data investigator to
  // query the live systems and answer coherently (Boberdoo/ClickFlare/Sheety/Ringba).
  if (/^\/(investigate|data)\b/i.test(text)) {
    const botUserName = process.env.TELEGRAM_BOT_USERNAME || "";
    const arg = text.replace(/^\/(investigate|data)(@\w+)?/i, "").split("@" + botUserName).join("").trim();
    const from = (msg.from && (msg.from.username || msg.from.first_name)) || "client";
    await handleInvestigate(chatId, msg.message_id, arg, from, "llm");
    return res.status(200).send("investigate handled");
  }

  // Handle /keywords (or /ads) <window> — deterministic top keyword/campaign ranking
  // from the Boberdoo campaign_id/ad_id/keyword fields (add "sales" for matched-only).
  if (/^\/(keywords?|ads)\b/i.test(text)) {
    const botUserName = process.env.TELEGRAM_BOT_USERNAME || "";
    const arg = text.replace(/^\/(keywords?|ads)(@\w+)?/i, "").split("@" + botUserName).join("").trim();
    const from = (msg.from && (msg.from.username || msg.from.first_name)) || "client";
    await handleInvestigate(chatId, msg.message_id, arg, from, "ad");
    return res.status(200).send("ad-report handled");
  }

  let mode = null;
  if (/^\/change\b/i.test(text)) mode = "change";
  else if (/^\/(ask|q)\b/i.test(text)) mode = "ask";
  else if (botUser && text.includes("@" + botUser)) mode = "auto";
  if (!mode) return res.status(200).send("not addressed");

  // Investigate by default: a free-form @mention question goes to the LLM data
  // investigator, which queries the LIVE systems (Boberdoo/ClickFlare/Sheety/Ringba)
  // and reasons across them — instead of the old brittle keyword classifiers that
  // short-circuited to a canned single-system report (that mis-answered a pasted-id
  // "do you see these sales?" with a weekly aggregate). Only an explicit CHANGE
  // request still falls through to the code-change agent below. Slash commands
  // (/sales, /reconcile, /check, /lookup …) remain the deterministic fast paths.
  if (mode === "auto" && !isChangeRequest(text)) {
    const q = text.split("@" + botUser).join("").trim();
    if (q) {
      const from = (msg.from && (msg.from.username || msg.from.first_name)) || "client";
      await handleInvestigate(chatId, msg.message_id, q, from, "llm");
      return res.status(200).send("investigate (auto) handled");
    }
  }

  const request = text
    .replace(/^\/(change|ask|q)(@\w+)?/i, "")
    .split("@" + botUser).join("")
    .trim();

  if (!request) {
    await tgSend(chatId, 'Tell me what you need — "/change <edit>" to update the site, or "/ask <question>" to ask about it.');
    return res.status(200).send("empty request");
  }

  // "stop" / "cancel" — don't dispatch a new run; cancel queued + in-progress
  // agent runs so a superseded instruction never executes.
  if (/^(stop|cancel)[.!]*$/i.test(request)) {
    const cancelled = await cancelAgentRuns();
    if (cancelled > 0) {
      await tgSend(chatId, `🛑 Stopped — cancelled ${cancelled} pending change${cancelled === 1 ? "" : "s"}.`);
    } else if (cancelled === 0) {
      await tgSend(chatId, "🛑 Nothing was running — no pending changes to stop.");
    } else {
      await tgSend(chatId, "⚠️ Couldn't cancel the running change (token may lack Actions permission) — Eugene will take a look.");
    }
    return res.status(200).send("stop handled");
  }

  // 4. Collect any attached image file_ids (largest photo size + image documents).
  //    The Action downloads the actual bytes — we only pass the ids.
  const photoFileIds = [];
  if (Array.isArray(msg.photo) && msg.photo.length) {
    photoFileIds.push(msg.photo[msg.photo.length - 1].file_id);
  }
  if (msg.document && /^image\//.test(msg.document.mime_type || "")) {
    photoFileIds.push(msg.document.file_id);
  }

  // 5. Hand off to GitHub Actions.
  const dispatch = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "telegram-change-request",
        client_payload: {
          request,
          mode,
          chat_id: chatId,
          message_id: msg.message_id,
          from: (msg.from && (msg.from.username || msg.from.first_name)) || "client",
          photo_file_ids: photoFileIds,
        },
      }),
    }
  );

  if (!dispatch.ok) {
    const body = await dispatch.text();
    await tgSend(chatId, `⚠️ Couldn't start the change (GitHub ${dispatch.status}). Eugene will take a look.`);
    return res.status(200).send("dispatch failed: " + body);
  }

  await tgReact(chatId, msg.message_id, "👀");
  return res.status(200).send("dispatched");
};

async function tgReact(chatId, messageId, emoji) {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setMessageReaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji }],
      }),
    });
  } catch (_) {
    /* best effort — the Action will still report the outcome */
  }
}

async function tgSend(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (_) {
    /* best effort — the Action will still report the outcome */
  }
}

// Cancel all queued + in-progress runs of the telegram-agent workflow.
// Returns the number of runs cancelled, or -1 if the API calls failed
// (e.g. the PAT lacks "Actions: Read & write").
async function cancelAgentRuns() {
  const gh = (path, opts) =>
    fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts && opts.headers),
      },
    });

  try {
    const runs = [];
    for (const status of ["queued", "in_progress"]) {
      const resp = await gh(`/actions/workflows/telegram-agent.yml/runs?status=${status}&per_page=20`);
      if (!resp.ok) return -1;
      const json = await resp.json();
      runs.push(...(json.workflow_runs || []));
    }
    let cancelled = 0;
    for (const run of runs) {
      const resp = await gh(`/actions/runs/${run.id}/cancel`, { method: "POST" });
      if (resp.ok) cancelled++;
      else return -1;
    }
    return cancelled;
  } catch (_) {
    return -1;
  }
}

// Detect a clear CODE/SITE change request, so it still goes to the code-change agent
// while everything else (questions, data asks) is investigated by default. Deliberately
// CONSERVATIVE: requires an edit verb AND a UI/site noun, and never a question — so a
// data ask with an edit-ish word ("add up the sales", "did sales increase?") is NOT
// treated as a change and reaches the investigator. Explicit /change is the reliable
// way to request an edit regardless.
function isChangeRequest(text) {
  const t = text.toLowerCase().trim();
  if (/\?\s*$/.test(t)) return false;                       // a question is never a change
  const verb = /\b(make|change|add|remove|delete|move|fix|update|set|replace|rename|swap|edit|tweak|adjust|hide|redirect|reword|rewrite|capitalize|bold|underline|resize|recolor|re-?color|shrink|enlarge|bigger|smaller)\b/;
  const noun = /\b(headline|title|button|link|text|copy|color|colour|font|image|logo|page|header|footer|form|field|number|phone|cta|banner|section|quiz|step|homepage|home page|site|website|word|wording|spelling|typo|background|menu|nav|css|html|style)\b/;
  return verb.test(t) && noun.test(t);
}

// Dispatch the telegram-reconcile workflow (Boberdoo + ClickFlare + Sheety diff),
// which posts a categorized gap verdict back to the chat itself.
async function handleReconcile(chatId, messageId, request, from) {
  let dispatch;
  try {
    dispatch = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "telegram-reconcile",
          client_payload: { request: request || "", chat_id: chatId, message_id: messageId, from: from || "client" },
        }),
      }
    );
  } catch (err) {
    await tgSend(chatId, "⚠️ Couldn't start the reconciliation (" + err.message + "). Eugene will take a look.");
    return;
  }
  if (!dispatch.ok) {
    await tgSend(chatId, `⚠️ Couldn't start the reconciliation (GitHub ${dispatch.status}). Eugene will take a look.`);
    return;
  }
  await tgSend(chatId, "🔎 Reconciling Boberdoo ↔ ClickFlare (today)… one moment.");
  if (messageId) await tgReact(chatId, messageId, "👀");
}

// Dispatch the telegram-sales workflow (Sheety sold-count + ClickFlare revenue for
// a window), which posts the sales report back to the chat itself.
async function handleSales(chatId, messageId, request, from) {
  let dispatch;
  try {
    dispatch = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "telegram-sales",
          client_payload: { request: request || "", chat_id: chatId, message_id: messageId, from: from || "client" },
        }),
      }
    );
  } catch (err) {
    await tgSend(chatId, "⚠️ Couldn't start the sales report (" + err.message + "). Eugene will take a look.");
    return;
  }
  if (!dispatch.ok) {
    await tgSend(chatId, `⚠️ Couldn't start the sales report (GitHub ${dispatch.status}). Eugene will take a look.`);
    return;
  }
  await tgSend(chatId, "🧾 Pulling sales (" + (request && request.trim() ? request.trim() : "this week") + ")… one moment.");
  if (messageId) await tgReact(chatId, messageId, "👀");
}

// Dispatch the telegram-investigate workflow. mode="lookup" runs the deterministic
// id resolver (scripts/lookup.mjs); mode="llm" (default) runs the read-only LLM data
// investigator, which queries the live systems and reasons across them. It posts the
// answer back to the chat itself.
async function handleInvestigate(chatId, messageId, request, from, mode) {
  let dispatch;
  try {
    dispatch = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "telegram-investigate",
          client_payload: { request: request || "", mode: mode || "llm", chat_id: chatId, message_id: messageId, from: from || "client" },
        }),
      }
    );
  } catch (err) {
    await tgSend(chatId, "⚠️ Couldn't start the investigation (" + err.message + "). Eugene will take a look.");
    return;
  }
  if (!dispatch.ok) {
    await tgSend(chatId, `⚠️ Couldn't start the investigation (GitHub ${dispatch.status}). Eugene will take a look.`);
    return;
  }
  const ack = mode === "lookup" ? "🔎 Looking those up… one moment."
    : mode === "ad" ? "🔎 Ranking keywords/campaigns… one moment."
    : "🔎 Looking into that across the live systems… one moment.";
  await tgSend(chatId, ack);
  if (messageId) await tgReact(chatId, messageId, "👀");
}

// Dispatch the telegram-call-check workflow, which logs into Ringba + ClickFlare
// with a headless browser and verifies a call end-to-end, then replies itself.
async function handleCallCheck(chatId, messageId, request, from) {
  let dispatch;
  try {
    dispatch = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "telegram-call-check",
          client_payload: {
            request: request || "",
            chat_id: chatId,
            message_id: messageId,
            from: from || "client",
          },
        }),
      }
    );
  } catch (err) {
    await tgSend(chatId, "⚠️ Couldn't start the call check (" + err.message + "). Eugene will take a look.");
    return;
  }
  if (!dispatch.ok) {
    await tgSend(chatId, `⚠️ Couldn't start the call check (GitHub ${dispatch.status}). Eugene will take a look.`);
    return;
  }
  if (messageId) await tgReact(chatId, messageId, "👀");
}

// Dispatch the telegram-lead-check workflow, which queries Boberdoo getLeadDetails
// (via the Fixie static IP) and replies with the lead's status + TrustedForm cert.
async function handleLeadCheck(chatId, messageId, request, from) {
  let dispatch;
  try {
    dispatch = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "telegram-lead-check",
          client_payload: { request: request || "", chat_id: chatId, message_id: messageId, from: from || "client" },
        }),
      }
    );
  } catch (err) {
    await tgSend(chatId, "⚠️ Couldn't start the lead check (" + err.message + "). Eugene will take a look.");
    return;
  }
  if (!dispatch.ok) {
    await tgSend(chatId, `⚠️ Couldn't start the lead check (GitHub ${dispatch.status}). Eugene will take a look.`);
    return;
  }
  if (messageId) await tgReact(chatId, messageId, "👀");
}

// Generate the current Ringba MFA (TOTP) code from a base32 secret seed.
// Pure Node crypto — no dependencies. The seed lives in env var
// RINGBA_TOTP_SECRET (never commit it). RFC 6238: HMAC-SHA1, 6 digits, 30s step.
function getRingbaMfa(secret) {
  const crypto = require("crypto");

  // Decode base32 (RFC 4648) secret → bytes.
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(secret).toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = "";
  for (const ch of clean) {
    const val = ALPHABET.indexOf(ch);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);

  // 8-byte big-endian counter = floor(unixTime / 30).
  let counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

// /ringba (or /mfa) command — reply with the live Ringba MFA code.
async function handleRingbaMfa(chatId) {
  const secret = process.env.RINGBA_TOTP_SECRET;
  if (!secret) {
    await tgSend(chatId, "⚠️ RINGBA_TOTP_SECRET not configured.");
    return;
  }
  try {
    const code = getRingbaMfa(secret);
    const secsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
    await tgSend(chatId, "🔐 Ringba MFA: " + code + "\n(valid ~" + secsLeft + "s)");
  } catch (err) {
    await tgSend(chatId, "❌ Couldn't generate MFA code: " + err.message);
  }
}

// /diagnose command — query lead logs from Sheety.co
async function handleDiagnose(chatId, arg) {
  const SHEETY_URL = process.env.SHEETY_URL;
  if (!SHEETY_URL) {
    await tgSend(chatId, "⚠️ SHEETY_URL not configured.");
    return;
  }

  let rows = [];
  try {
    const resp = await fetch(SHEETY_URL);
    const json = await resp.json();
    rows = json.sheet1 || json.sheet1S || json.sheet1s || [];
  } catch (err) {
    await tgSend(chatId, "❌ Failed to fetch logs: " + err.message);
    return;
  }

  // /diagnose health — check ClickFlare postback URL
  if (arg === "health") {
    let status = "❌ unreachable";
    try {
      const r = await fetch("https://leosourceclick.com/cf/cv?click_id=healthcheck&payout=0&txid=healthcheck");
      status = r.ok ? "✅ responding (" + r.status + ")" : "⚠️ returned " + r.status;
    } catch (_) {}
    await tgSend(chatId, "ClickFlare postback URL: " + status);
    return;
  }

  // /diagnose recent — last 10 entries, with a clear verdict on the latest lead
  if (arg === "recent" || !arg) {
    const last10 = rows.slice(-10).reverse();
    if (last10.length === 0) {
      await tgSend(chatId, "📋 No lead logs found yet.");
      return;
    }

    // Lead the response with a clear verdict on the most recent lead
    const newest = last10[0];
    const hasClickId = newest.clickId && newest.clickId.length > 5;
    const verdict = hasClickId
      ? "✅ Latest lead posted correctly — ClickFlare click_id present, postback should have fired."
      : "⚠️ Latest lead is missing a ClickFlare click_id — postback will NOT be attributed in ClickFlare.";

    const lines = [
      verdict,
      "Time: " + (newest.timestamp || "?"),
      "Event: " + (newest.event || "?"),
      "Click ID: " + (hasClickId ? newest.clickId.slice(0, 20) + "..." : "❌ empty"),
      "Raw: " + (newest.rawQuery || "none"),
      "",
      "📋 Last " + last10.length + " leads:",
    ];
    last10.forEach(function(r) {
      const hasId = r.clickId && r.clickId.length > 5 ? "✅" : "❌";
      lines.push("• " + (r.timestamp || "?") + " " + hasId + " " + (r.event || "?"));
    });
    await tgSend(chatId, lines.join("\n"));
    return;
  }

  // /diagnose <phone_last4_or_search> — search by phone digits or any text
  const query = arg.replace(/\D/g, "") || arg;
  const matches = rows.filter(function(r) {
    const raw = (r.rawQuery || "") + (r.clickId || "") + (r.txid || "");
    return raw.includes(query);
  });

  if (matches.length === 0) {
    await tgSend(chatId, '🔍 No logs found matching "' + arg + '".');
    return;
  }

  const lines = ["🔍 Found " + matches.length + ' log(s) for "' + arg + '":', ""];
  matches.slice(-5).forEach(function(r) {
    const hasId = r.clickId && r.clickId.length > 5 ? "✅ " + r.clickId.slice(0, 12) + "..." : "❌ no click_id";
    lines.push("• " + (r.timestamp || "?"));
    lines.push("  Event: " + (r.event || "?"));
    lines.push("  Click ID: " + hasId);
    lines.push("  Details: " + (r.rawQuery || "none"));
    lines.push("");
  });
  await tgSend(chatId, lines.join("\n"));
}
