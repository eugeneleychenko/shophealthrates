// Log lead submissions from quiz.html to Google Sheets (via Sheety.co).
// Sends instant Telegram alert if click_id is missing.

const SHEETY_URL = process.env.SHEETY_URL;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = (process.env.ALLOWED_CHAT_IDS || "").split(",")[0].trim();

module.exports = async (req, res) => {
  // Allow sendBeacon (POST) and CORS preflight (OPTIONS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).send("ok");

  let data;
  try {
    data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (_) {
    return res.status(400).send("bad json");
  }

  const clickId = data.click_id || "";
  const phone = data.phone || "";
  const zip = data.zip || "";
  const firstName = data.first_name || "";
  const lastName = data.last_name || "";
  const timestamp = data.timestamp || new Date().toISOString();

  // 1. Log to Sheety
  try {
    await fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheet1: {
          timestamp: timestamp,
          event: "lead_submitted",
          clickId: clickId,
          payout: "",
          txid: "",
          ct: "",
          cfStatus: "",
          cfResponse: "",
          rawQuery: "phone=" + phone.slice(-4) + "&zip=" + zip + "&name=" + firstName
        }
      })
    });
  } catch (err) {
    console.error("Sheety log failed:", err.message);
  }

  // 2. Alert if click_id is missing
  if (!clickId && TG_TOKEN && CHAT_ID) {
    const msg = "⚠️ Lead submitted with NO ClickFlare click_id\n"
      + "Phone: ***" + phone.slice(-4) + " | Zip: " + zip + "\n"
      + "Name: " + firstName + " " + lastName + "\n"
      + "Time: " + timestamp + "\n\n"
      + "This lead won't be attributed in ClickFlare.";
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
      });
    } catch (_) {}
  }

  return res.status(200).json({ logged: true });
};
