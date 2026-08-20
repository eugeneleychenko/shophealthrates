// QuinStreet (Next Insure / Insure.com) shared helpers.
//
// Underscore prefix = Vercel does NOT route this file. It is a shared library
// imported by api/prefill.js, api/log-lead.js and api/enrollment.js.
//
// WHAT THIS IS
// QuinStreet sends us click-wall traffic (insure.com listings) to
// quick-quote.html. Two things travel with that traffic:
//   • a PREFILL TOKEN ($prefilltoken$ macro) we exchange for the consumer's
//     data — see api/prefill.js;
//   • a CLICK KEY, the join key we report conversions back on so QuinStreet can
//     optimize which publishers/sources send us traffic that actually converts.
// This module owns the second half: the server-to-server conversion post, plus
// the single canonical income→bracket mapping used by the whole integration.
//
// DESIGN RULE — nothing here throws. postConversion() is fired from the
// request path of endpoints whose real job is logging a lead or an enrollment;
// a QuinStreet outage must never turn a logged lead into a 500. Every failure
// mode (no env, bad args, network, timeout, non-2xx) comes back as a plain
// result object the caller can stringify into a sheet cell.
//
// ENV
//   QS_TENANT_ID       required — the X-Tenant-Id header value QuinStreet issues
//                      us. When missing, postConversion() is a no-op returning
//                      { ok:false, skipped:"no QS_TENANT_ID" }. That is the
//                      deliberate off switch: ship the code, flip it on later.
//   QS_CONVERSION_URL  optional — full URL of the conversion handler.
//                      DEFAULT IS **STAGING**:
//                        https://nextinsure.quinstage.com/listingdisplay/handlers/conversion.ashx
//                      Production is
//                        https://www.nextinsure.com/listingdisplay/handlers/conversion.ashx
//                      and ops must set QS_CONVERSION_URL to it explicitly once
//                      QuinStreet signs off on the staging test. Defaulting to
//                      prod would mean a mis-set tenant id silently writing junk
//                      conversions into their live optimizer.
//
// Docs: docs/"Quinstreet Server-to-Server Conversion Api.docx" (not deployed).

const STAGING_CONVERSION_URL =
  "https://nextinsure.quinstage.com/listingdisplay/handlers/conversion.ashx";

const CONVERSION_URL = (process.env.QS_CONVERSION_URL || STAGING_CONVERSION_URL).trim();
const TENANT_ID = (process.env.QS_TENANT_ID || "").trim();
const TIMEOUT_MS = 5000;

// The six bracket strings on quick-quote.html. This list and the thresholds
// below are the SINGLE server-side source of truth; the page carries an
// identical mirror (it must bracket values the user types by hand). If you edit
// one, edit the other — a mismatch shows up as leads whose Boberdoo bracket
// disagrees with the ClickFlare payout suppression.
const BRACKETS = [
  "$0-40,000",
  "$40,001-50,000",
  "$50,001-60,000",
  "$60,001-75,000",
  "$75,001-100,000",
  "$100,001-150,000+",
];

// Map an annual household income to one of the six bracket strings.
// Returns "" when the value is unusable — blank, null, NaN, non-finite, negative.
//
// Blank is checked BEFORE Number(): Number("") === 0, and "$0-40,000" is a
// meaningful value (it is the bracket that suppresses the ClickFlare payout), so
// letting "unknown" coerce into the lowest bracket would suppress real revenue.
// This is a byte-for-byte mirror of incomeToBracket() in quick-quote.html —
// free-text parsing ("55k", "$55,000") lives in the page's qqIncomeBracket().
function incomeToBracket(n) {
  if (n === "" || n === null || n === undefined) return "";
  const v = Number(n);
  if (!isFinite(v) || v < 0) return "";
  if (v <= 40000) return BRACKETS[0];
  if (v <= 50000) return BRACKETS[1];
  if (v <= 60000) return BRACKETS[2];
  if (v <= 75000) return BRACKETS[3];
  if (v <= 100000) return BRACKETS[4];
  return BRACKETS[5];
}

// Today's date in America/New_York as YYYY-MM-DD. The business runs on ET, and
// a UTC date rolls over at 8pm ET — a 9pm sale would be reported to QuinStreet
// as tomorrow's conversion.
function todayET() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

function clip(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}

// Report a conversion to QuinStreet (server-to-server).
//
//   clickKey                  required — the click key captured from the URL
//   disposition               required — "quote" | "sale" | "policy"
//   clientUniqueConversionId  our idempotency key (<=100 chars), e.g. "sale-12345"
//   conversionDate            "YYYY-MM-DD", defaults to today in ET
//   revenue                   decimal → qualityValue1 (omitted when absent)
//   productSku                defaults to "health"
//   customText1               free-form tag (we pass the source/system)
//
// Returns { ok, status, body } — or { ok:false, skipped:"..." } when it did not
// even attempt the call. NEVER throws, NEVER rejects.
async function postConversion(opts) {
  const o = opts || {};
  const clickKey = String(o.clickKey || "").trim();
  const disposition = String(o.disposition || "").trim().toLowerCase();

  if (!TENANT_ID) return { ok: false, skipped: "no QS_TENANT_ID" };
  if (!clickKey) return { ok: false, skipped: "no clickKey" };
  if (!disposition) return { ok: false, skipped: "no disposition" };

  const payload = {
    clickKey: clip(clickKey, 100),
    disposition: disposition,
    conversionCount: 1,
    conversionDate: String(o.conversionDate || "").trim() || todayET(),
    productSku: clip(o.productSku || "health", 100),
  };
  if (o.clientUniqueConversionId) {
    payload.clientUniqueConversionId = clip(o.clientUniqueConversionId, 100);
  }
  const rev = parseFloat(String(o.revenue == null ? "" : o.revenue).replace(/[^0-9.\-]/g, ""));
  if (isFinite(rev)) payload.qualityValue1 = rev;
  if (o.customText1) payload.customText1 = clip(o.customText1, 100);

  try {
    const resp = await fetch(CONVERSION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
      },
      body: JSON.stringify(payload),
      // Vercel freezes the function after the response is sent, so this is
      // awaited inline on the lead/enrollment path. The timeout is what keeps
      // a hung QuinStreet from holding the request open.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body = "";
    try { body = (await resp.text()).slice(0, 200); } catch (_) {}
    return { ok: resp.ok, status: resp.status, body: body };
  } catch (e) {
    return { ok: false, status: "error", body: String((e && e.message) || e).slice(0, 200) };
  }
}

module.exports = {
  incomeToBracket,
  postConversion,
  todayET,
  BRACKETS,
  CONVERSION_URL,
  STAGING_CONVERSION_URL,
};
