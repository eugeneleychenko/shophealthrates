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
  const addressed =
    /^\/change\b/i.test(text) || (botUser && text.includes("@" + botUser));
  if (!addressed) return res.status(200).send("not addressed");

  const request = text
    .replace(/^\/change(@\w+)?/i, "")
    .split("@" + botUser).join("")
    .trim();

  if (!request) {
    await tgSend(chatId, 'Tell me what to change, e.g. "/change make the red box clickable to step 2 of the quiz"');
    return res.status(200).send("empty request");
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

  await tgSend(chatId, "👍 On it — making the change and deploying. I'll confirm here when it's live.");
  return res.status(200).send("dispatched");
};

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
