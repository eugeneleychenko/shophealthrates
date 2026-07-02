// Enrollment (sale/"Closed") intake — the single front door for enrollment signals:
//   • Convoso "Sale" disposition webhook (Workflow → Convoso Connect POST), src=convoso
//   • Boberdoo webhook 57 repoint (GET, truncated Sub_ID), src=boberdoo   [future]
// Deliberately NO manual/Telegram path for marking sales (decision 2026-07-02):
// enrollments enter ONLY via system webhooks so chat can't create/pollute sale data.
//
// WHY this exists instead of pointing dialers straight at ClickFlare: upstream systems
// only carry Boberdoo's Sub_ID, which is the ClickFlare click_id TRUNCATED to 30 chars
// (Varchar(30)); ClickFlare silently drops conversions whose click_id doesn't match a
// known click (returns {"received":"ok"} regardless — proven with lead 17237753). This
// endpoint resolves the truncated id (or an email) to the FULL 36-char click_id via the
// Sheety lead log, dedupes re-fires/redispositions, logs the enrollment, pings Telegram,
// and — once ENROLL_FIRE_CF=1 (Stage 2, after the ct=sale test) — fires the ClickFlare
// sale postback so close rate lands attributed to keyword/campaign.
//
// Self-contained on purpose: .vercelignore excludes scripts/ from deploys, so the key30
// prefix-match here mirrors scripts/lookup.mjs (keep in sync).
//
// Env: ENROLL_SECRET (required; fail closed), SHEETY_URL, TELEGRAM_BOT_TOKEN,
//      ALLOWED_CHAT_IDS, ENROLL_FIRE_CF ("1" enables ClickFlare fire), ENROLL_PAYOUT.
// Rows are written to the existing lead-log sheet with event="enrollment" and a
// non-empty txid sentinel ("enroll-…") so lead-reconcile/daily-summary/sales-report
// (which filter event==="lead_submitted" or skip non-empty txid) never touch them.

const SHEETY_URL = (process.env.SHEETY_URL || "").replace(/\\n$/, "").trim();
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = (process.env.ALLOWED_CHAT_IDS || "").split(",")[0].trim();
const SECRET = (process.env.ENROLL_SECRET || "").trim();
const FIRE_CF = process.env.ENROLL_FIRE_CF === "1";
const DEFAULT_PAYOUT = process.env.ENROLL_PAYOUT || "0";

// Both a 30-char Boberdoo Sub_ID and a full 36-char click_id share their first 30
// literal chars (mirrors scripts/lookup.mjs key30 — keep in sync).
function key30(s) { return String(s || "").toLowerCase().slice(0, 30); }
const FULL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pick(bag) {
  for (var i = 1; i < arguments.length; i++) {
    var v = bag[arguments[i]];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  // Merge query + body (Convoso Connect posts form-encoded or JSON; Boberdoo uses GET).
  var bag = {};
  try {
    var q = req.query || {};
    for (var k in q) bag[k.toLowerCase()] = q[k];
    var body = req.body;
    if (typeof body === "string" && body.trim()) {
      try { body = JSON.parse(body); }
      catch (_) {
        var sp = new URLSearchParams(body); body = {};
        sp.forEach(function (v, kk) { body[kk] = v; });
      }
    }
    if (body && typeof body === "object") for (var k2 in body) bag[k2.toLowerCase()] = body[k2];
  } catch (_) { /* keep whatever parsed */ }

  // Auth — fail closed. Secret via ?secret= or x-enroll-secret header.
  if (!SECRET) return res.status(503).json({ ok: false, error: "ENROLL_SECRET not configured" });
  var given = pick(bag, "secret") || req.headers["x-enroll-secret"] || "";
  if (given !== SECRET) return res.status(401).json({ ok: false, error: "bad secret" });

  var src = (pick(bag, "src") || "unknown").toLowerCase();
  var quiet = pick(bag, "quiet") === "1";
  var phone = pick(bag, "phone", "phone_number", "primary_phone").replace(/[^\d]/g, "");
  var last4 = phone.slice(-4);
  var email = pick(bag, "email").toLowerCase();
  var convosoLeadId = pick(bag, "convoso_lead_id", "lead_id");
  var subId = pick(bag, "sub_id", "click_id", "subid", "clickid");
  var status = pick(bag, "status");
  var statusName = pick(bag, "status_name", "statusname", "disposition");
  var campaignId = pick(bag, "campaign_id", "campaignid");
  var adId = pick(bag, "ad_id", "adid");
  var keyword = pick(bag, "keyword");
  var pubId = pick(bag, "pub_id", "pubid");
  var revenue = pick(bag, "revenue", "payout").replace(/[^0-9.]/g, "");
  var firstName = pick(bag, "first_name", "firstname");
  var dispoTime = pick(bag, "disposition_time", "sale_timestamp", "call_date");

  if (!email && !subId && !phone && !convosoLeadId) {
    return res.status(400).json({ ok: false, error: "no identifier (need sub_id, email, phone, or lead_id)" });
  }

  // Load the lead log once — it is both the click_id resolver and the dedupe store.
  var rows = [], sheetErr = "";
  try {
    var resp = await fetch(SHEETY_URL);
    if (!resp.ok) throw new Error("Sheety GET " + resp.status);
    var j = await resp.json();
    var arrKey = Object.keys(j).find(function (x) { return Array.isArray(j[x]); });
    rows = arrKey ? j[arrKey] : [];
  } catch (e) { sheetErr = e.message; }
  var leads = rows.filter(function (r) { return r.event === "lead_submitted"; });
  var enrolls = rows.filter(function (r) { return r.event === "enrollment"; });

  // Resolution ladder: full id → truncated-prefix → email. Phone-only stays unresolved
  // (Sheety keeps last-4 only; full-phone lookup is Boberdoo/Fixie = CI-only).
  var clickId = "", resolution = "unresolved";
  if (subId && FULL_ID.test(subId)) { clickId = subId; resolution = "param"; }
  if (!clickId && subId) {
    var want = key30(subId);
    var hit = leads.find(function (r) { return r.clickId && key30(r.clickId) === want; });
    if (hit) { clickId = hit.clickId; resolution = "sub_id-prefix"; if (!email && hit.email) email = String(hit.email).toLowerCase(); }
  }
  if (!clickId && email) {
    var byEmail = leads.filter(function (r) { return r.email && String(r.email).toLowerCase() === email && r.clickId; });
    if (byEmail.length) { clickId = byEmail[byEmail.length - 1].clickId; resolution = "email"; }
  }

  // Dedupe: same Convoso lead or same resolved click already recorded as an enrollment.
  var dupe = enrolls.find(function (r) {
    return (convosoLeadId && String(r.txid) === "enroll-" + convosoLeadId) || (clickId && r.clickId === clickId);
  });
  if (dupe) return res.status(200).json({ ok: true, dedupe: true, clickId: clickId || "", resolution: resolution });

  // Stage 2 only: fire the ClickFlare sale conversion with the FULL click_id.
  var cfStatus = "", cfResponse = "";
  if (FIRE_CF && clickId && FULL_ID.test(clickId)) {
    try {
      var cfUrl = "https://leosourceclick.com/cf/cv?click_id=" + encodeURIComponent(clickId) +
        "&payout=" + encodeURIComponent(revenue || DEFAULT_PAYOUT) +
        "&txid=" + encodeURIComponent("enroll-" + (convosoLeadId || last4 || "x")) + "&ct=sale";
      var cf = await fetch(cfUrl);
      cfStatus = String(cf.status);
      cfResponse = (await cf.text()).slice(0, 100);
    } catch (e) { cfStatus = "error"; cfResponse = String(e.message).slice(0, 100); }
  }

  // Log the enrollment row (existing sheet, event="enrollment", txid sentinel).
  var logged = false;
  var rawQuery = "src=" + src + "&dispo=" + (status || "") + "/" + (statusName || "") +
    "&phone=***" + last4 + "&name=" + firstName +
    "&campaign_id=" + campaignId + "&ad_id=" + adId + "&keyword=" + keyword +
    "&pub_id=" + pubId + "&convoso_lead_id=" + convosoLeadId +
    "&dispo_time=" + dispoTime + "&resolution=" + resolution;
  try {
    var post = await fetch(SHEETY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheet1: {
          timestamp: new Date().toISOString(),
          event: "enrollment",
          clickId: clickId,
          gclid: "",
          income: "",
          email: email,
          payout: revenue || "",
          txid: "enroll-" + (convosoLeadId || Date.now()),
          ct: "sale",
          cfStatus: cfStatus,
          cfResponse: cfResponse,
          boberdooStatus: "",
          trustedForm: "",
          rawQuery: rawQuery
        }
      })
    });
    logged = post.ok;
  } catch (e) { sheetErr = sheetErr || e.message; }

  // Telegram ping (skipped for quiet=1 test calls).
  if (!quiet && TG_TOKEN && CHAT_ID) {
    var lines = [
      "🎉 Enrollment (" + (statusName || status || "Sale") + ") — " + (firstName || "?") + " · ***" + (last4 || "????"),
      (keyword ? "kw “" + keyword + "” · " : "") + (campaignId ? "campaign " + campaignId : ""),
      "click_id " + (clickId ? "✅ (" + resolution + ")" : "❌ unresolved") +
        (FIRE_CF ? " · ClickFlare " + (cfStatus || "skipped") : "") + " · via " + src,
    ].filter(Boolean);
    try {
      await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: lines.join("\n") })
      });
    } catch (_) {}
  }

  return res.status(200).json({
    ok: true, dedupe: false, logged: logged, resolution: resolution,
    clickId: clickId || "", cf: FIRE_CF ? (cfStatus || "no-fire") : "off",
    sheetErr: sheetErr || undefined
  });
};
