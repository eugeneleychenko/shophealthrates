// Vercel cron — runs daily at 9am ET (13:00 UTC).
// Reads last 24h of lead logs from Sheety, posts summary to Telegram group.
// Also health-checks the ClickFlare postback URL.

const SHEETY_URL = process.env.SHEETY_URL;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = (process.env.ALLOWED_CHAT_IDS || "").split(",")[0].trim();

module.exports = async (req, res) => {
  // 1. Fetch all rows from Sheety
  let rows = [];
  try {
    const resp = await fetch(SHEETY_URL);
    const json = await resp.json();
    rows = json.sheet1 || json.sheet1S || json.sheet1s || [];
  } catch (err) {
    console.error("Sheety fetch failed:", err.message);
  }

  // 2. Filter to last 24 hours
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const recent = rows.filter(function(r) {
    if (!r.timestamp) return false;
    return new Date(r.timestamp).getTime() >= oneDayAgo;
  });

  const leads = recent.filter(function(r) { return r.event === "lead_submitted"; });
  const withClickId = leads.filter(function(r) { return r.clickId && r.clickId.length > 5; });
  const missingClickId = leads.filter(function(r) { return !r.clickId || r.clickId.length <= 5; });

  // 3. Health-check ClickFlare postback URL
  let cfHealthy = false;
  try {
    const cfResp = await fetch("https://leosourceclick.com/cf/cv?click_id=healthcheck&payout=0&txid=healthcheck");
    cfHealthy = cfResp.ok;
  } catch (_) {}

  // 4. Build summary message
  const lines = [
    "📊 Lead Log Summary (last 24h)",
    "—",
    "Total leads submitted: " + leads.length,
    "With ClickFlare click_id: " + withClickId.length + " ✅",
    "Missing click_id: " + missingClickId.length + (missingClickId.length > 0 ? " ⚠️" : ""),
    "—",
    "ClickFlare postback URL: " + (cfHealthy ? "✅ responding (200)" : "🔴 NOT responding"),
  ];

  // List leads missing click_id
  if (missingClickId.length > 0) {
    lines.push("");
    lines.push("Leads missing click_id:");
    missingClickId.slice(0, 5).forEach(function(r) {
      lines.push("  • " + r.timestamp + " — " + (r.rawQuery || "no details"));
    });
  }

  const msg = lines.join("\n");

  // 5. Send to Telegram
  if (TG_TOKEN && CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
      });
    } catch (_) {}
  }

  return res.status(200).json({ summary: msg });
};
