// POST /api/qs-datapass — QuinStreet "datapass" intake (per-click consumer data PUSH).
//
// QuinStreet's clicks team POSTs one JSON record per click, BEFORE the consumer
// lands on quick-quote.html. We store it under the click key (Upstash, 48h TTL)
// and quick-quote.html fetches it via /api/prefill?ck=<clickKey>. This is the
// push counterpart of the prefill-token pull in api/prefill.js; both feed the
// page the same shape.
//
// Accepted body shapes (JSON):
//   1. OUR flat schema (what we asked QuinStreet to map to — see
//      docs/integrations/quinstreet.md "Datapass"):
//      { clickKey, firstName, lastName, email, phone, address, address2, city,
//        stateCode, zip, dob (YYYY-MM-DD or MM/DD/YYYY), gender, householdSize,
//        householdIncome, source, var1, var2 }
//   2. Their native prefill schema ({ DataPassData: { Contact, Individuals … } }
//      plus a clickKey / ClickKey at top level) — mapped with api/prefill.js's
//      mapPrefill(), so "send us what your prefill API returns" also works.
//
// Auth: header  X-Datapass-Token: <QS_DATAPASS_TOKEN>   (or Authorization: Bearer …)
//       Fail closed: no env → 503, wrong/missing token → 401.
// Response: 200 {"status":"success","clickKey":"…","fieldsReceived":N}
//           400 {"status":"error","message":"…"} for bad JSON / missing clickKey
// PRIVACY: body is PII. Nothing logged except click-key prefix, status, field count.
// Env: QS_DATAPASS_TOKEN, plus the Upstash KV_*/UPSTASH_* pair (shared with _chatlog).

const qs = require("./_quinstreet");
const { mapPrefill } = require("./prefill");

const SECRET = (process.env.QS_DATAPASS_TOKEN || "").trim();
const CLICKKEY_RE = /^[A-Za-z0-9_.-]{6,100}$/;

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const digits = (v) => { let d = str(v).replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 ? d : ""; };

function pick(o) { for (let i = 1; i < arguments.length; i++) { const k = arguments[i]; if (o[k] !== undefined && o[k] !== null && str(o[k]) !== "") return o[k]; } return ""; }

// Case-insensitive key lookup so FirstName / firstName / first_name all work.
function lower(o) { const out = {}; for (const k in o) out[String(k).toLowerCase().replace(/[_\s-]/g, "")] = o[k]; return out; }

function toUsDate(v) {
  const s = str(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[2] + "/" + m[3] + "/" + m[1];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return m[1].padStart(2, "0") + "/" + m[2].padStart(2, "0") + "/" + m[3];
  return "";
}

function mapFlat(body) {
  const b = lower(body);
  const parts = [str(pick(b, "address", "address1", "street")), str(pick(b, "address2")), str(pick(b, "city")),
    [str(pick(b, "statecode", "state")), str(pick(b, "zip", "zipcode", "postalcode"))].filter(Boolean).join(" ")].filter(Boolean);
  const hh = parseInt(str(pick(b, "householdsize")), 10);
  const incomeRaw = str(pick(b, "householdincome", "income")).replace(/[^0-9.]/g, "");
  const g = str(pick(b, "gender"));
  return {
    ok: true, source: "quinstreet-datapass",
    first: str(pick(b, "firstname", "first")), last: str(pick(b, "lastname", "last")),
    email: str(pick(b, "email")), phone: digits(pick(b, "phone", "homephone", "primaryphone")) || digits(pick(b, "workphone")),
    address: parts.join(", "), zip: str(pick(b, "zip", "zipcode", "postalcode")),
    dob: toUsDate(pick(b, "dob", "birthdate", "dateofbirth")),
    gender: /^m/i.test(g) ? "Male" : /^f/i.test(g) ? "Female" : "",
    householdSize: isFinite(hh) && hh > 0 ? String(Math.min(hh, 5)) : "",
    income: incomeRaw, incomeBracket: qs.incomeToBracket(incomeRaw),
    subId: str(pick(b, "source", "subid", "sub_id", "publisherid")), var1: str(pick(b, "var1")), var2: str(pick(b, "var2")),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ status: "error", message: "POST only" });

  if (!SECRET) return res.status(503).json({ status: "error", message: "datapass not configured" });
  const auth = str(req.headers["x-datapass-token"]) || str(req.headers["authorization"]).replace(/^Bearer\s+/i, "");
  if (auth !== SECRET) return res.status(401).json({ status: "error", message: "unauthorized" });

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch (_) { body = null; }
  if (!body || typeof body !== "object") return res.status(400).json({ status: "error", message: "body must be JSON" });

  const clickKey = str(pick(lower(body), "clickkey", "click_key", "ck"));
  if (!CLICKKEY_RE.test(clickKey)) return res.status(400).json({ status: "error", message: "clickKey required (6-100 chars, A-Za-z0-9_.-)" });

  let record;
  try {
    record = body.DataPassData ? mapPrefill(body) : mapFlat(body);
  } catch (_) { return res.status(400).json({ status: "error", message: "could not map payload" }); }
  record.clickKey = clickKey;

  const fieldsReceived = ["first", "last", "email", "phone", "address", "zip", "dob", "gender", "householdSize", "income"]
    .filter((k) => record[k]).length;

  if (!qs.datapassEnabled()) return res.status(503).json({ status: "error", message: "store not configured" });
  const stored = await qs.datapassPut(clickKey, record);
  console.log("qs-datapass: ck " + clickKey.slice(0, 8) + "… fields=" + fieldsReceived + " stored=" + stored);
  if (!stored) return res.status(503).json({ status: "error", message: "store unavailable, retry" });

  return res.status(200).json({ status: "success", clickKey: clickKey, fieldsReceived: fieldsReceived, ttlSeconds: qs.DATAPASS_TTL_SEC });
};
