// Ingest endpoint for bot messages sent from GitHub Actions.
//
// WHY: the bot's own replies are posted by workflow shell scripts that curl the
// Telegram API directly (.github/workflows/telegram-*.yml). They never pass
// through Vercel, and Telegram does not echo a bot's own messages back to its
// webhook — so without this endpoint the bot has no record of what it said, and
// a follow-up like "the url does not work" has nothing to resolve against.
//
// The workflows DUAL-WRITE: they still curl Telegram first and unconditionally,
// then post here. Telegram delivery therefore never depends on Vercel being up —
// deliberately not a proxy, which would have made a Vercel outage mute the bot.
//
// Env: CHATLOG_SECRET (shared with the workflows via a GitHub secret).

const chatlog = require("./_chatlog");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — read the transcript back. Exists so every rollout phase is verifiable
  // with one curl, and so a wrong-looking agent answer can be diagnosed by
  // looking at exactly what it was given. Same secret as the write path.
  if (req.method === "GET") {
    const expectedGet = (process.env.CHATLOG_SECRET || "").trim();
    const givenGet = String((req.query && req.query.secret) || req.headers["x-chatlog-secret"] || "").trim();
    if (!expectedGet) return res.status(503).json({ ok: false, error: "CHATLOG_SECRET not configured" });
    if (givenGet !== expectedGet) return res.status(401).json({ ok: false, error: "bad secret" });
    const cid = String((req.query && req.query.chat_id) || "").trim();
    if (!cid) return res.status(400).json({ ok: false, error: "chat_id required" });
    const transcript = await chatlog.history(cid);
    return res.status(200).json({
      ok: true,
      chat_id: cid,
      lines: transcript ? transcript.split("\n").length : 0,
      transcript: transcript,
    });
  }

  if (req.method !== "POST") return res.status(200).send("ok");

  let data = {};
  try {
    data = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (_) {
    return res.status(400).json({ ok: false, error: "bad json" });
  }

  // Fail closed on auth: without a configured secret this would be an open
  // write endpoint that anyone could use to poison what the agents read.
  const expected = (process.env.CHATLOG_SECRET || "").trim();
  if (!expected) return res.status(503).json({ ok: false, error: "CHATLOG_SECRET not configured" });
  const given = String(data.secret || req.headers["x-chatlog-secret"] || "").trim();
  if (given !== expected) return res.status(401).json({ ok: false, error: "bad secret" });

  const chatId = String(data.chat_id || "").trim();
  const text = String(data.text || "").trim();
  if (!chatId || !text) return res.status(200).json({ ok: true, skipped: "empty" });

  const stored = await chatlog.record(chatId, {
    role: "bot",
    name: data.name || "leo_bot",
    text: text,
    messageId: data.message_id || null,
  });

  // Always 200 once authenticated — a workflow must never hang or fail because
  // logging did. `stored:false` just means the store was unreachable.
  return res.status(200).json({ ok: true, stored: stored });
};
