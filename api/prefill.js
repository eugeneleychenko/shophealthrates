// GET /api/prefill?pf=<token> — QuinStreet prefill proxy for quick-quote.html.
//
// QuinStreet's prefill is a PULL model: when a consumer clicks our listing on
// insure.com they arrive at quick-quote.html?token=<uuid>, and WE fetch their
// data from Next Insure. There is no inbound PII endpoint on our side and the
// browser must not call Next Insure directly (cross-origin, and the token would
// be exposed to page scripts we don't control), so this thin server proxy sits
// in the middle and hands the page exactly the six-ish fields the form needs.
//
// Contract (always HTTP 200 except a malformed token → 400; the page must never
// see a 5xx, it just renders empty fields):
//   { ok:true, source:"quinstreet", first, last, email, phone, address, zip,
//     dob, gender, householdSize, income, incomeBracket }
//   { ok:false, error:"..." }
// Every field is present; unknown values are "". The page fills only EMPTY
// inputs from this, so a missing field is harmless.
//
// PRIVACY: this response is pure PII. Nothing here is logged beyond the token
// and an upstream status code — no names, emails, phones, or addresses in logs.
// Cache-Control: no-store so no proxy or CDN ever retains it.
//
// ENV
//   QS_PREFILL_URL   override the upstream base
//                    (default https://www.nextinsure.com/listingdisplay/prefill)
//   QS_PREFILL_MOCK  "1" → serve the example response from the QuinStreet docs
//                    instead of calling upstream. Local/preview testing only;
//                    never set in production.
//
// Docs: docs/"Quinstreet Prefill Api - Health Insurance.docx" (not deployed).

const qs = require("./_quinstreet");

const PREFILL_URL = (process.env.QS_PREFILL_URL || "https://www.nextinsure.com/listingdisplay/prefill").trim();
const MOCK = process.env.QS_PREFILL_MOCK === "1";
const TIMEOUT_MS = 5000;

// QuinStreet's tokens are UUIDs (36 chars); accept the dashless 32-char form too.
const TOKEN_RE = /^[0-9a-f-]{32,36}$/i;

// The example response from the prefill doc, trimmed to the fields we map.
// One deviation, deliberate: the doc's example Contact block omits
// HouseHoldSize (their schema table lists it with example "4"). The mock adds
// it so QS_PREFILL_MOCK=1 exercises every field of our contract.
const MOCK_RESPONSE = {
  Status: "success",
  Message: "",
  DataPassData: {
    Contact: {
      Address: "234 Lazy Ave.",
      Address2: "",
      City: "San Mateo",
      County: "San Mateo",
      State: "California",
      StateCode: "CA",
      ZipCode: "94404",
      FirstName: "John",
      LastName: "Doe",
      Email: "jdoe@yahoo.com",
      HomePhone: "6503433434",
      WorkPhone: "6503433434",
      HouseholdIncome: 75000,
      HouseHoldSize: 4,
    },
    Individuals: [{
      Age: 36,
      BirthDate: "1981-11-11",
      FirstName: "John",
      LastName: "Doe",
      Gender: "Male",
      RelationToApplicant: "Self",
    }],
  },
};

function str(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

// Digits only; drop a leading US "1" from an 11-digit number.
function normPhone(v) {
  let d = str(v).replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.length === 10 ? d : (d || "");
}

// "Address[, Address2], City, ST ZIP" — every part optional.
function joinAddress(c) {
  const street = [str(c.Address), str(c.Address2)].filter(Boolean).join(", ");
  const stateZip = [str(c.StateCode) || str(c.State), str(c.ZipCode)].filter(Boolean).join(" ");
  return [street, str(c.City), stateZip].filter(Boolean).join(", ");
}

// "YYYY-MM-DD" (or the "...T00:00:00" variant) → "MM/DD/YYYY".
function toUsDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
  return m ? m[2] + "/" + m[3] + "/" + m[1] : "";
}

// The applicant themselves — RelationToApplicant "Self", else the first entry.
function selfIndividual(list) {
  if (!Array.isArray(list) || !list.length) return {};
  const self = list.find(function (i) {
    return i && String(i.RelationToApplicant || "").toLowerCase() === "self";
  });
  return self || list[0] || {};
}

// Upstream JSON → our flat contract. Never throws.
function mapPrefill(json) {
  const data = (json && json.DataPassData) || {};
  const c = data.Contact || {};
  const self = selfIndividual(data.Individuals);

  // The page's select tops out at 5 ("5+"); QuinStreet reports 1-9.
  let size = parseInt(str(c.HouseHoldSize || c.HouseholdSize), 10);
  if (!isFinite(size) || size < 1) size = 0;
  if (size > 5) size = 5;

  const incomeNum = parseFloat(str(c.HouseholdIncome).replace(/[^0-9.\-]/g, ""));
  const income = isFinite(incomeNum) && incomeNum > 0 ? String(incomeNum) : "";

  const gender = str(self.Gender);

  return {
    ok: true,
    source: "quinstreet",
    first: str(c.FirstName) || str(self.FirstName),
    last: str(c.LastName) || str(self.LastName),
    email: str(c.Email),
    phone: normPhone(c.HomePhone) || normPhone(c.WorkPhone),
    address: joinAddress(c),
    zip: str(c.ZipCode),
    dob: toUsDate(self.BirthDate || self.BirthDateValue),
    gender: /^m/i.test(gender) ? "Male" : (/^f/i.test(gender) ? "Female" : ""),
    householdSize: size ? String(size) : "",
    income: income,
    incomeBracket: qs.incomeToBracket(income),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  // Same-origin only — the page and this endpoint share shophealthrates.com, so
  // no Access-Control-Allow-Origin header (deliberate: this payload is PII).
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  let token = "";
  try {
    const q = req.query || {};
    token = str(q.pf || q.token || q.prefilltoken || q.prefill_token);
  } catch (_) { token = ""; }

  if (!TOKEN_RE.test(token)) {
    console.log("prefill: bad token (len " + token.length + ")");
    return res.status(400).json({ ok: false, error: "bad token" });
  }

  if (MOCK) {
    console.log("prefill: mock for " + token);
    try {
      return res.status(200).json(mapPrefill(MOCK_RESPONSE));
    } catch (e) {
      return res.status(200).json({ ok: false, error: "mock map failed" });
    }
  }

  try {
    const url = PREFILL_URL + (PREFILL_URL.indexOf("?") === -1 ? "?" : "&") + "pf=" + encodeURIComponent(token);
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    console.log("prefill: " + token + " upstream " + resp.status);
    if (!resp.ok) return res.status(200).json({ ok: false, error: "upstream " + resp.status });

    let json = null;
    try { json = await resp.json(); } catch (_) { json = null; }
    if (!json) return res.status(200).json({ ok: false, error: "bad upstream json" });

    const status = str(json.Status).toLowerCase();
    if (status && status !== "success") {
      // Message can echo back consumer data — log the status word only.
      return res.status(200).json({ ok: false, error: "upstream status " + status });
    }
    if (!json.DataPassData) return res.status(200).json({ ok: false, error: "no data" });

    return res.status(200).json(mapPrefill(json));
  } catch (e) {
    const why = e && e.name === "TimeoutError" ? "timeout" : "fetch failed";
    console.log("prefill: " + token + " " + why);
    return res.status(200).json({ ok: false, error: why });
  }
};

// Exported for tests/reuse; Vercel only calls module.exports itself.
module.exports.mapPrefill = mapPrefill;
module.exports.MOCK_RESPONSE = MOCK_RESPONSE;
