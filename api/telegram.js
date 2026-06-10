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

  let mode = null;
  if (/^\/change\b/i.test(text)) mode = "change";
  else if (/^\/(ask|q)\b/i.test(text)) mode = "ask";
  else if (botUser && text.includes("@" + botUser)) mode = "auto";
  if (!mode) return res.status(200).send("not addressed");

  // Fast-path: @mention questions about lead status are answered directly from
  // the Sheety log without spinning up GitHub Actions. This avoids the "I can't
  // query directly" response Claude Code gives when it lacks the env vars.
  if (mode === "auto" && isLeadStatusQuestion(text)) {
    await handleDiagnose(chatId, "recent");
    return res.status(200).send("lead-status handled");
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

// Detect whether an @mention message is asking about lead status so we can
// answer directly from Sheety instead of going through GitHub Actions.
function isLeadStatusQuestion(text) {
  const t = text.toLowerCase();
  return (
    /lead.{0,30}(post|came|come|submitt|sent|went|go|through|correct|work|fire|log|track)/i.test(t) ||
    /did.{0,20}lead/i.test(t) ||
    /(last|latest|recent|new).{0,20}lead/i.test(t) ||
    /lead.{0,20}(last|latest|recent)/i.test(t) ||
    /postback.{0,30}(fire|work|sent|correct)/i.test(t) ||
    /(click.*id|click_id).{0,30}(present|there|missing|found|empty)/i.test(t)
  );
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
