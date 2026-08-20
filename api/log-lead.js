// Log lead submissions from quiz.html / quick-quote.html to Google Sheets (via Sheety.co).
// Sends instant Telegram alert if click_id is missing.
//
// QuinStreet (quick-quote.html click-wall traffic) rides along on the same
// beacon: qs_click_key / qs_sub_id / qs_source / page are appended to the
// rawQuery column (the sheet's columns are fixed — no new ones), and a
// qs_click_key also fires the "quote" server-to-server conversion so QuinStreet
// can optimize which publishers send us form-completers.

const chatlog = require("./_chatlog");
const quinstreet = require("./_quinstreet");
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
  const gclid = data.gclid || "";        // Google Ads click id (links the row to Google)
  const income = data.income || "";      // income bracket (Boberdoo read API can't return it)
  const email = data.email || "";        // identity / join key
  const phone = data.phone || "";
  const zip = data.zip || "";
  const firstName = data.first_name || "";
  const lastName = data.last_name || "";
  const timestamp = data.timestamp || new Date().toISOString();

  // QuinStreet passthrough (absent on quiz.html traffic — everything stays "").
  const qsClickKey = data.qs_click_key || "";
  const qsSubId = data.qs_sub_id || "";
  const qsSource = data.qs_source || "";
  const page = data.page || "";

  // Only non-empty parts are appended, so a normal quiz.html row is byte-for-byte
  // what it was before this existed.
  let qsRaw = "";
  const addRaw = (k, v) => { if (v) qsRaw += "&" + k + "=" + encodeURIComponent(v); };
  addRaw("qs_click_key", qsClickKey);
  addRaw("qs_sub_id", qsSubId);
  addRaw("qs_source", qsSource);
  addRaw("page", page);

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
          gclid: gclid,
          income: income,
          email: email,
          payout: "",
          txid: "",
          ct: "",
          cfStatus: "",
          cfResponse: "",
          boberdooStatus: "",
          trustedForm: "",
          rawQuery: "phone=" + phone.slice(-4) + "&zip=" + zip + "&name=" + firstName + qsRaw
        }
      })
    });
  } catch (err) {
    console.error("Sheety log failed:", err.message);
  }

  // 2. QuinStreet "quote" conversion (form submit). Awaited inside try/catch —
  // Vercel freezes the function after the response, so it cannot be deferred;
  // postConversion() never throws and caps itself at 5s.
  let qsQuote = null;
  if (qsClickKey) {
    try {
      qsQuote = await quinstreet.postConversion({
        clickKey: qsClickKey,
        disposition: "quote",
        clientUniqueConversionId: "quote-" + qsClickKey,
        customText1: qsSource || qsSubId || "",
      });
    } catch (err) {
      qsQuote = { ok: false, status: "error", body: String(err.message).slice(0, 100) };
    }
  }

  // 3. Alert if click_id is missing.
  // NOT for QuinStreet traffic: a qs_click_key means the lead came from the
  // insure.com click wall, which never touches ClickFlare — no click_id is
  // expected there and alerting on it would be pure noise.
  if (!clickId && !qsClickKey && TG_TOKEN && CHAT_ID) {
    const qsTag = (qsSubId || qsSource) ? " (QuinStreet)" : "";
    const msg = "⚠️ Lead submitted with NO ClickFlare click_id" + qsTag + "\n"
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
      await chatlog.record(CHAT_ID, { role: "bot", name: "leo_bot", text: msg });
    } catch (_) {}
  }

  return res.status(200).json(
    qsQuote
      ? { logged: true, qs: qsQuote.skipped || (qsQuote.ok ? "ok" : "fail " + qsQuote.status) }
      : { logged: true }
  );
};
