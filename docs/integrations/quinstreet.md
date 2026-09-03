# QuinStreet (Next Insure / Insure.com) ↔ `quick-quote.html`

> Internal runbook. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../../AGENTS.md#further-documentation).
> External, email-pasteable version for QuinStreet: [docs/quinstreet-spec-for-lindsy.md](../quinstreet-spec-for-lindsy.md).
>
> Contacts: **Lindsy Mueller** (QuinStreet AM), **Mikhail "Misha" Andreyev** (Boberdoo admin), Eugene (implementation).
> Source of truth: `docs/Quinstreet Prefill Api - Health Insurance.docx` and `docs/Quinstreet Server-to-Server Conversion Api.docx` (both **authoritative over the call transcript** in `call/Lindsy-8-20.md`).

## Overview

QuinStreet owns **Insure.com** and a network of publisher lead forms. A consumer fills out *their* form, lands on a thank-you **click wall**, and clicks the LeoSource listing. QuinStreet's **Next Insure** service carries that consumer's data forward, and the click lands on **`https://shophealthrates.com/quick-quote.html`** — our single-shot, prefilled short form (built for this deal: one page, one button, no multi-step wizard).

**The prefill is a PULL, not a push.** On the 2026-08-20 call we assumed QuinStreet would POST PII into an endpoint we'd build ("you are looking for us to create some sort of postable API endpoint" — *"Yes, you got it."*). **The written spec says otherwise and wins:** QuinStreet puts a **prefill token** (a UUID) in the click-through URL via the `$prefilltoken$` macro, and *we* GET their Prefill API with that token to retrieve the PII.

Consequences:
- **We build no inbound PII endpoint.** Nothing of ours accepts consumer data from QuinStreet. Less attack surface, no TCPA/PII intake to secure, no auth to negotiate.
- PII never travels in the URL (QuinStreet's stated constraint). Only **non-PII** — click key, sub id, source — rides in query params.
- If the consumer arrived at the click wall without stored data (e.g. a direct ad click), `$prefilltoken$` is empty/absent and the page simply renders blank — **prefill is best-effort, never required**.

**ClickFlare is not part of this flow.** ClickFlare tracks paid search only (decided on the call). QuinStreet traffic carries a `qs_click_key`, not a `cf_click_id`, and the missing-click_id alert in `log-lead.js` must not treat that as a fault.

## Flow

```
1.  Consumer fills a publisher form (insure.com or a QuinStreet publisher)
2.  Sees the click wall → clicks the LeoSource listing
3.  Next Insure mints a click key + prefill token, redirects to:
      https://shophealthrates.com/quick-quote.html?token=<uuid>&click_key=<32ch>&sub_id=<pub>&utm_source=quinstreet&...
4.  quick-quote.html captures token / click_key / sub_id / source into sessionStorage
      (qs_token, qs_click_key, qs_sub_id, qs_source), then history.replaceState()s the token out of the URL
5.  Page calls GET /api/prefill?pf=<token>
6.  api/prefill.js → GET https://www.nextinsure.com/listingdisplay/prefill?pf=<token> → normalizes → JSON
7.  Page fills ONLY empty fields (never overwrites typed input); heading flips to
      "Confirm Your Details" when ≥3 fields were prefilled
8.  Consumer confirms → submit:
      a. Boberdoo pingPostLead  (+ QS_Click_Key / QS_Sub_ID / QS_Source / Household_Income_Raw)
      b. sendBeacon('/api/log-lead', …) with qs_click_key / qs_sub_id / qs_source / page:"quick-quote"
      c. log-lead.js → QuinStreet S2S conversion, disposition = "quote"
9.  Lead is dialed; Convoso disposition = SALE/PDATE → webhook → api/enrollment.js
10. enrollment.js finds the lead_submitted row, parses qs_click_key out of its rawQuery
      → QuinStreet S2S conversion, disposition = "sale", qualityValue1 = policy revenue
11. Lindsy sees quote + sale + revenue per source in QMP and optimizes publisher mix toward
      the sources that produce real policies
```

## Click-through URL

What QuinStreet configures on their side (send Lindsy the external doc, not this one):

```
https://shophealthrates.com/quick-quote.html
  ?token=$prefilltoken$
  &click_key=$clickkey$
  &sub_id=$source$
  &qs_var1=$var1$
  &qs_var2=$var2$
  &qs_campaign_id=$campaignid$
  &qs_creative_id=$creativeid$
  &devicetype=$devicetype$
  &bid=$bid$
  &leadid=$leadid$
  &zip=$zc$
  &gender=$gender$
  &income=$household_income$
  &utm_source=quinstreet
  &utm_medium=clickwall
  &utm_campaign=insure_com
```

- `$prefilltoken$` is the only macro name we know for certain (it's in the spec). It is replaced with a UUID **when publisher data exists**; otherwise it may resolve empty or be dropped.
- Macro list received 2026-08-20 (`docs/qs_table.tsv`). Param names are ours; QuinStreet substitutes the macro values. Mapping:

| Our param | QuinStreet macro | Why |
|---|---|---|
| `click_key` | `$clickkey$` | conversion join key |
| `sub_id` | `$source$` | publisher (encrypted affiliate key) — source-level reporting |
| `qs_var1` / `qs_var2` | `$var1$` / `$var2$` | publisher sub-ids |
| `qs_campaign_id` / `qs_creative_id` | `$campaignid$` / `$creativeid$` | QMP campaign / creative |
| `devicetype`, `bid` | `$devicetype$`, `$bid$` | diagnostics |
| `leadid` | `$leadid$` | Jornaya lead id |
| `zip`, `gender`, `income` | `$zc$`, `$gender$`, `$household_income$` | seed the form even without a prefill token |

- Build the URL as long as you like; extra macros are free. Anything we don't recognize is ignored.

### URL param aliases (case-insensitive)

The page accepts any of these spellings and normalizes into one sessionStorage key, so a macro-name surprise from QuinStreet costs a one-line change, not a redeploy scramble.

| Incoming param aliases | sessionStorage key | Meaning |
|---|---|---|
| `token`, `pf`, `prefilltoken`, `prefill_token` | `qs_token` | Prefill token (UUID) |
| `click_key`, `clickkey`, `ck`, `qs_click_key` | `qs_click_key` | **Conversion join key** — the one field we must persist |
| `sub_id`, `subid`, `qs_sub_id`, `src_id`, `source_id` | `qs_sub_id` | Publisher / source id |
| `source`, `qs_source` | `qs_source` | Source label (unused in the URL today) |
| `qs_var1`, `var1`, `utm_content` / `qs_var2`, `var2` | `qs_var1` / `qs_var2` | Publisher sub-ids (`utm_content=$var1$` also accepted, per Lindsy) |
| `qs_campaign_id`, `qs_campaignid` / `qs_creative_id`, `qs_creativeid` | `qs_campaign_id` / `qs_creative_id` | QMP ids — deliberately NOT `utm_campaignid`, which the page already maps to Google Ads `Campaign_ID` |
| `qs_device`, `devicetype` / `qs_bid`, `bid` | `qs_device` / `qs_bid` | Diagnostics |
| `leadid`, `jornaya_leadid`, `qs_leadid` | `qs_leadid` | Jornaya lead id |
| `gender`, `qs_gender` | `qs_gender` | `Male`/`Female` → Boberdoo `Gender` when the prefill API didn't supply one |
| `income`, `household_income`, `qs_income` | `qs_income` | Seeds the income field (raw number) when empty — works with no prefill token |
| `zip` | *(read directly by submit)* | `$zc$` → Boberdoo `Zip` |

The existing UTM/tracking-capture block on `quick-quote.html` (a **protected tracking code** — see [AGENTS.md](../../AGENTS.md#protected-tracking-codes--do-not-modify)) fires only on `gclid`/`cpid`/`utm_source`/`wbraid`/`gbraid`. Its condition is widened minimally (`|| params.has('token') || params.has('click_key') || params.has('clickkey')`) and the QuinStreet capture lives in a **separate new `<script>` immediately after it** — never inside the guard comments.

## `/api/prefill` contract

**Request:** `GET /api/prefill?pf=<token>` — same-origin only (page and API share `shophealthrates.com`; no `Access-Control-Allow-Origin` header is set on purpose).

Upstream: `GET https://www.nextinsure.com/listingdisplay/prefill?pf=<token>` (override with `QS_PREFILL_URL`).

**Response (200):** every key always present; empty string when unknown.

```json
{
  "ok": true,
  "source": "quinstreet",
  "first": "John",
  "last": "Doe",
  "email": "jdoe@yahoo.com",
  "phone": "6503433434",
  "address": "234 Lazy Ave., San Mateo, CA 94404",
  "zip": "94404",
  "dob": "11/11/1981",
  "gender": "Male",
  "householdSize": "4",
  "income": "75000",
  "incomeBracket": "$75,001-100,000"
}
```

Normalization rules (implemented once, in `api/_quinstreet.js` + `api/prefill.js`):

- **address** — `Address` [+ `", " Address2`] + `", " City` + `", " StateCode` + `" " ZipCode`; missing parts are skipped, not rendered as empty commas. Delivered as **one string** because that's what the page's single address input takes (Lindsy on the call: *"you can tell us how you want it formatted"*).
- **phone** — `HomePhone` then `WorkPhone`; digits only; strip a leading `1` if 11 digits. The spec's own example shows both `###-###-####` and bare-digit forms, so never assume punctuation.
- **gender / dob** — from the `Individuals[]` entry with `RelationToApplicant === "Self"`, falling back to `Individuals[0]`. `BirthDate` is `YYYY-MM-DD` upstream; we emit `MM/DD/YYYY` (the Boberdoo contract format).
- **householdSize** — `HouseHoldSize` is `1-9`; the page's select tops out at 5, so ≥5 clamps to `"5"`.
- **income** — `HouseholdIncome` is a **number**, and QuinStreet passes *the top of their range* (Lindsy: a 30,000–39,999 bucket arrives as `39999`). We emit both the raw number (`income`) and the mapped bracket (`incomeBracket`).

**Income bracket mapping** — one implementation in `api/_quinstreet.js` `incomeToBracket(n)`, mirrored in the page JS (the page needs it for typed values too). Keep the two identical:

| Raw income | Bracket |
|---|---|
| ≤ 40000 | `$0-40,000` |
| 40001–50000 | `$40,001-50,000` |
| 50001–60000 | `$50,001-60,000` |
| 60001–75000 | `$60,001-75,000` |
| 75001–100000 | `$75,001-100,000` |
| > 100000 | `$100,001-150,000+` |

**Failure modes** — the page must never break because prefill failed:

| Situation | Response |
|---|---|
| `pf` missing or fails `/^[0-9a-f-]{32,36}$/i` | `400` `{ "ok": false, "error": "bad token" }` |
| Upstream non-200, non-JSON, `Status !== "success"`, or empty `DataPassData` | `200` `{ "ok": false, "error": "…" }` |
| Upstream slow | 5s `AbortSignal` → `200` `{ ok:false, error:"timeout" }` |
| Anything else | caught; `200` `{ ok:false }`. **Never 5xx.** |

Also: `Cache-Control: no-store` on every response, and **never log PII** — log the token and the upstream status, nothing else.

**Mock mode** — `QS_PREFILL_MOCK=1` makes `/api/prefill` return the normalized form of the spec's example response without calling QuinStreet. This is how the page is tested before staging access exists. Set it on **Preview only**; never on Production.

## Conversion reporting (S2S)

| Environment | Endpoint |
|---|---|
| Staging / testing | `https://nextinsure.quinstage.com/listingdisplay/handlers/conversion.ashx` |
| Production | `https://www.nextinsure.com/listingdisplay/handlers/conversion.ashx` |

`POST` JSON with headers `X-Tenant-Id: <provided by QuinStreet>` and `Content-Type: application/json`.

**Quote** — fired server-side from `api/log-lead.js` when the beacon carries a `qs_click_key`:

```json
{ "clickKey": "<32-char click key>", "disposition": "quote", "conversionCount": 1,
  "clientUniqueConversionId": "quote-<clickKey>", "conversionDate": "2026-08-20",
  "productSku": "health" }
```

**Sale** — fired from `api/enrollment.js` after the Convoso SALE/PDATE disposition resolves to a `lead_submitted` row whose `rawQuery` contains `qs_click_key=`:

```json
{ "clickKey": "<32-char click key>", "disposition": "sale", "conversionCount": 1,
  "clientUniqueConversionId": "sale-<convosoLeadId or clickKey>", "conversionDate": "2026-08-20",
  "productSku": "health", "qualityValue1": 480.00 }
```

- **`qualityValue1` = policy revenue.** This is the number Lindsy optimizes on (*"that allows us to then optimize towards the sources that are producing the higher policy sales — we did that for eHealth"*). `qualityValue2..4` and `qualityAttribute1..4` are unused for now; `customText1..4` are free-form and not reported in QMP.
- **`clientUniqueConversionId` convention:** `<disposition>-<stable id>`, ≤100 chars. `quote-<clickKey>` is naturally unique per click; `sale-<convosoLeadId>` survives a Convoso re-disposition, which is exactly the redelivery we want collapsed.
- **Idempotency** is that id: QuinStreet dedupes on `clientUniqueConversionId`, so a retried beacon or a re-fired Convoso webhook records once. We do **not** implement our own conversion dedupe on top — `enrollment.js`'s existing dedupe already suppresses repeat rows, and QuinStreet's id check is the backstop.
- `conversionDate` defaults to today in **America/New_York**, `YYYY-MM-DD`.
- **Never throws.** `postConversion()` in `api/_quinstreet.js` is fully try/catch'd with a 5s timeout. With no `QS_TENANT_ID` set it returns `{ ok:false, skipped:'no QS_TENANT_ID' }` and logs nothing alarming — so the whole integration is inert until ops sets the env var, and a QuinStreet outage can never fail a lead post.
- **Fallback:** if S2S is delayed or disputed, Lindsy will accept a weekly CSV of `clickKey · conversionDate · quote(0/1) · sale(0/1) · revenue`. Revenue exists in Ad Spend IQ (Misha), sourced from Convoso ← Boberdoo.
- **Pixel alternative:** Lindsy also offered a client-side pixel that fires on the quote event. We are not using it — S2S covers quote *and* sale from one code path, and a pixel can't report revenue. Keep it in the back pocket if S2S auth drags.


## Datapass (per-click PUSH) — added 2026-08-21

The call assumed push; the spec doc described pull; QuinStreet's clicks team then offered **"datapass"**, which is push after all: one JSON POST per click, header auth, in a schema **we** define. Both models are live and feed the page the same shape.

- `POST /api/qs-datapass` (`api/qs-datapass.js`) — `X-Datapass-Token` (env `QS_DATAPASS_TOKEN`, we issued it; value in `.env` and Vercel prod). Accepts our flat schema OR their native `DataPassData` shape. Stores the mapped record in Upstash `qs:dp:<clickKey>` with a 48h TTL (helpers in `_quinstreet.js`). Fail-closed auth; never logs PII.
- `GET /api/prefill?ck=<clickKey>` — reads the store. `quick-quote.html` uses `?pf=` when a token is present, else `?ck=` from `qs_click_key`.
- External spec sent to QuinStreet: [`docs/quinstreet-datapass-spec.md`](../quinstreet-datapass-spec.md). Token goes by DM, never in the shared channel.
- Tested live 2026-08-21: 401 no auth, 200 both schemas, read-back OK, miss → `{ok:false}`, bad JSON → 400.
- Still owed by QuinStreet: their staging URL for E2E once they integrate.


## ClickFlare routing (Josh, 2026-08-28)

Josh wants QS clicks to enter through a ClickFlare **redirect** campaign so paid-click reporting lives in ClickFlare:
`https://leosourceclick.com/cf/r/6a848920a4949a0012e4e6c5?bid=$bid$&clickid=$clickkey$&source=$source$&…` (campaign "QuinStreet Clicks", traffic source "QuinStreet" `6a8488f827e1320012dae57b`, flow → offer "Leosource - QS MAIN" `6a91ed896f24880012115754`).

- Traffic-source param map (read via internal API): `bid`→cost, `clickid`→externalId, tf1 source, tf2 gender, tf3 devicetype, tf4 campaignid, tf5 creativeid, tf6 creativename, **tf7 prefilltoken**, tf8 household_income, tf9 tobacco_use, tf10 medical_condition, tf12 position, tf13 city, **tf14 zc**, tf15 ssc, tf16 county. Not captured: `$var1$`, `$var2$`, `$leadid$` (asked Josh to add as tf17-19).
- **Bug found 2026-08-28:** the offer URL was bare `https://shophealthrates.com/quick-quote.html`, so the 302 stripped every param (verified with curl: `location: https://shophealthrates.com/quick-quote.html`). Prefill token and click key never reached the page.
- Fix = offer URL with tokens, using OUR param names (so `campaignid` never collides with the Google `utm_campaignid` → `Campaign_ID` mapping):

```
https://shophealthrates.com/quick-quote.html?token={trackingField7}&click_key={external_id}&sub_id={trackingField1}&gender={trackingField2}&devicetype={trackingField3}&qs_campaign_id={trackingField4}&qs_creative_id={trackingField5}&income={trackingField8}&zip={trackingField14}&qs_var1={trackingField17}&qs_var2={trackingField18}&leadid={trackingField19}&cf_click_id={cf_click_id}&cpid={campaign_id}&utm_source=quinstreet&utm_medium=clickwall&utm_campaign=insure_com
```

- Page hardening for this flow (deployed): `clickid` alias → `qs_click_key`; `zc` alias → `qs_zip` (submit zip chain); `cf_click_id` URL param / `utm_cf_click_id` fallback for Boberdoo `Sub_ID` and the ClickFlare lead pixel.
- Consequence: QS leads now carry a ClickFlare click_id → the lead pixel fires (except $0-40k) and ClickFlare counts them as conversions on the QuinStreet campaign. Josh's call on payout. `log-lead` alert logic is unaffected (qs_click_key present).
- Verify after Josh updates the offer: `curl -sI "https://leosourceclick.com/cf/r/6a848920a4949a0012e4e6c5?clickid=T1&prefilltoken=54f17290-9121-4ba5-bf34-99c111ef9696&zc=30301&source=P1" | grep -i location` must show the params on quick-quote.html.


## LIVE TRAFFIC — findings 2026-08-31

QuinStreet traffic went live today (14 leads by 17:50 ET, most recent `qs_click_key=747c1b2d…`). Two findings:

**1. `cf_click_id` empty on all QS leads (Misha's report) — expected, not a page bug.**
QS traffic is arriving **direct** on `quick-quote.html` (Lindsy still has the original direct URL), not through Josh's ClickFlare redirect. Verified again 2026-08-31: the offer URL on "Leosource - QS MAIN" is still the bare `https://shophealthrates.com/quick-quote.html`, and `curl -sI` on the campaign link still returns a param-less `location:`. With no redirect and no `cpid`, the page's non-redirect CF tag has no campaign to attach to, so no `cf_click_id` cookie is set.
- Consequence: Boberdoo `Sub_ID` is empty for QS leads (`Sub_ID` = cf_click_id), and QS clicks/leads do not appear in ClickFlare.
- **QuinStreet attribution is NOT affected** — `qs_click_key` and `qs_sub_id` (16987200) are present on all 14 rows, which is what the conversion S2S joins on.
- Fix is unchanged: Josh sets the offer URL with tokens, then Lindsy swaps to the `leosourceclick.com/cf/r/…` link. Until then, empty `cf_click_id` on QS leads is the expected state, not a regression.

**2. Quote conversions are going to QuinStreet STAGING.** `QS_CONVERSION_URL` is not set in Vercel production, so `_quinstreet.js` falls back to `nextinsure.quinstage.com`. Every `quote` conversion from today's real leads posted to staging; Lindsy sees nothing in production QMP. Fix: `vercel env add QS_CONVERSION_URL production` = `https://www.nextinsure.com/listingdisplay/handlers/conversion.ashx`, then redeploy.

**Not a bug (checked):** `SHEETY_URL` in Vercel has a trailing newline, and `log-lead.js` does not strip it — harmless, because the WHATWG URL parser strips trailing control characters. It only breaks when read from a `vercel env pull` file, where the newline is written as a literal `\n`; that is why the `scripts/*.mjs` and `enrollment.js` copies carry `.replace(/\\n$/, "")`.


## 2026-09-01 — Josh applied the offer URL; redirect verified

Offer "Leosource - QS MAIN" now carries the token URL. Live `curl -sI` on the campaign link resolves correctly:
`token`, `click_key`, `sub_id`, `gender`, `devicetype`, `qs_campaign_id`, `qs_creative_id`, `income`, `zip`, **`cf_click_id`** (real UUID) and `cpid` all populate. **This closes the empty-`cf_click_id` gap Misha reported** — QS leads will carry a ClickFlare click id and a populated Boberdoo `Sub_ID` once Lindsy swaps her link.

**Still outstanding (Josh):** `var1`/`var2`/`leadid` were never added to the traffic source, so the offer URL's `{trackingField17..19}` do not resolve and arrive as the **literal strings** `{trackingField17}` etc.

**Page hardening (deployed 2026-09-01):** the QS capture block now drops any value that is still an unresolved placeholder — `{...}` (ClickFlare) or `$...$` (QuinStreet, e.g. `$var1$` when a publisher has no value). Verified live: `qs_var1/qs_var2/qs_leadid` are simply absent rather than storing junk, everything else stores normally. This means **Lindsy can safely swap to the ClickFlare link now**; adding tf17-19 later needs no change on our side.

**Watch item for Josh:** the page also runs the non-redirect ClickFlare tag, and traffic now arrives with `cpid`. Confirm the redirect campaign is not double-counting a click/visit per QS lead in ClickFlare reporting.


## 2026-09-01 (pm) — chain complete, conversions on PRODUCTION

Josh finished both halves. Verified live: `token`, `click_key`, `sub_id`, `gender`, `devicetype`, `qs_campaign_id`, `qs_creative_id`, `income`, `zip`, **`qs_var1`, `qs_var2`, `leadid`** (tf17-19 now mapped and enabled) and **`cf_click_id`** all resolve through the redirect. The click-through URL Lindsy should use is the campaign link with `&var1=$var1$&var2=$var2$&leadid=$leadid$` appended.

**Retiring the non-redirect ClickFlare tag.** Josh is right that it is redundant under a redirect campaign and likely double-counts a visit. Confirmed safe: **53 of 53** `quick-quote` leads carry a `qs_click_key` and **zero** carry a `gclid` — the page serves QuinStreet only, so nothing else depends on the tag.
- **Prerequisite done (tracking change, approved):** the ClickFlare→Ringba bridge read `cf_click_id` only from `window.clickflare` or the cookie, neither of which exists once the tag is gone — phone calls from QS traffic would have lost attribution. It now falls back to the `cf_click_id` URL param (and the `utm_cf_click_id` sessionStorage copy). Verified with the tag network-blocked: `_rgba_tags` receives `{type:"User", clickid:"b598f16f-…"}`.
- Boberdoo `Sub_ID` and the lead pixel already had the URL fallback.
- **The tag was ours, not Josh's** (he never placed it — it was in `quick-quote.html`). **Removed 2026-09-01**; a comment block marks where it was and the conditions for restoring it.
- **End-to-end verified through the live redirect with the tag gone:** page prefills, Ringba receives `{type:"User", clickid:"da8b140d-…"}`, Boberdoo `Sub_ID` = that same real ClickFlare click id (the blank-`Sub_ID` complaint is now closed), `QS_Click_Key`/`QS_Var1`/`QS_Var2`/`Jornaya_Lead_ID`/`Zip`/`Gender` all populate, and the ClickFlare lead pixel fires with the correct `click_id`. Zero page errors.
- *Test artifacts:* the verification runs created a handful of real clicks on the QuinStreet campaign and one real lead conversion (click `da8b140d-…`). Boberdoo and Sheety were stubbed, so no test lead reached them.

**`QS_CONVERSION_URL` flipped to production** (`https://www.nextinsure.com/listingdisplay/handlers/conversion.ashx`), set in Vercel and deployed; prod endpoint returns **HTTP 201** with our tenant id. Quote and sale conversions now report to live QMP. Prompted by Misha hand-posting two sales into Slack for Lindsy to map manually — the automation was firing into staging the whole time.


## Prefill diagnostics — "is QuinStreet actually sending DOB / household size?"

`vercel logs` only streams 5 minutes forward, so console logging alone could never answer this. `/api/prefill` now records a **field-presence line** (names only, never values) into an Upstash ring buffer (`qs:diag:prefill`, newest first, capped at 50).

**Read it:**
```bash
curl -s -H "X-Datapass-Token: $QS_DATAPASS_TOKEN" \
  "https://shophealthrates.com/api/qs-datapass?diag=1" | python3 -m json.tool
```
The Upstash credentials come from the Vercel Marketplace integration and are **injected at runtime only** — `vercel env pull` returns them empty — so this authed GET is the only way to read the buffer from outside.

Example (verified 2026-09-03 with a deliberately incomplete record):
```
ck=diagtest… have=[first,last,email,phone,address,zip,income] missing=[dob,gender,householdSize]
```
For the pull path the line also carries `rawContact=[…] individuals=N rawSelf=[…]`, which distinguishes *"QuinStreet omitted the field"* from *"we mapped it wrong"*.

**Where the two fields come from** (per QuinStreet's own schema): `HouseHoldSize` sits on `Contact`, `BirthDate` on the `Individuals[]` entry whose `RelationToApplicant` is `Self`. Our mapper reads exactly those. Note the spec's *own example response omits `HouseHoldSize` entirely*, which is circumstantial evidence QuinStreet may not populate it.


## ANSWERED 2026-09-03 — what QuinStreet actually sends in prefill

Tested two **real** tokens from live leads (Misha posted them in Slack). Both returned `Status: success` with data, so this is not a plumbing failure — it is what QuinStreet has.

```
Contact:     Address:"" Address2:"" City:"Tonto Basin" County:"Gila" State:"Arizona"
             StateCode:"AZ" ZipCode:"85553" FirstName:"" LastName:"" Email:""
             HomePhone:"" WorkPhone:"" HouseholdIncome:60000 HouseholdSize:2
Individuals: [{ BirthDate:"" Gender:"Male" FirstName:"" LastName:"" RelationToApplicant:"Self" }]
```

| Field | Sent? | Notes |
|---|---|---|
| **DOB** | ❌ **`BirthDate` is an empty string** | Confirmed on both tokens. This is the reported symptom, and it is **upstream** — nothing to fix on our side. |
| **Household size** | ✅ **arrives fine** (`2` and `1`) | The report was half right: household size *is* passing. |
| Income | ✅ | 60000 / 35000 |
| Gender, City/State/Zip | ✅ | |
| First, Last, Email, Phone, street Address | ❌ all empty | QuinStreet is sending **almost no PII** — the consumer types name, phone, email, street and DOB themselves. |

**Key-name trap:** the spec doc says `HouseHoldSize` (capital H in "Hold"); the live payload uses **`HouseholdSize`**. Our mapper reads `c.HouseHoldSize || c.HouseholdSize`, so it works — do not "tidy" that to one spelling.

**Known UX consequence:** the form heading flips to "Confirm Your Details" once ≥3 fields prefill. Address + household + income alone trip that, so a consumer is told to *confirm* a form where their name, phone, email and DOB are all still blank. Consider gating the heading on the identity fields instead.

**Ask for Lindsy:** why are `BirthDate`, `FirstName`, `LastName`, `Email` and `HomePhone` empty for these publishers, and can they be populated? She flagged on the 8/20 call that "a couple of publishers don't store all of that information," so this may be publisher-specific rather than universal.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `QS_TENANT_ID` | **set in Vercel prod 2026-08-21** (`F9316F29-0DAC-42BA-B7A4-28502F356C51`, also in `.env`) | `X-Tenant-Id` header. **Unset = conversions silently skipped.** Staging returned HTTP 201 with it. |
| `QS_CONVERSION_URL` | **staging** endpoint | Conversion endpoint. Ships pointed at staging on purpose — ops flips it to the production URL once a staging test passes. |
| `QS_PREFILL_URL` | `https://www.nextinsure.com/listingdisplay/prefill` | Prefill base URL. |
| `QS_DATAPASS_TOKEN` | set (Vercel prod + `.env`) | Header token QuinStreet sends on `/api/qs-datapass`. Unset = 503. |
| `QS_PREFILL_MOCK` | *(unset)* | `1` = return the spec's example payload without calling QuinStreet. **Preview/dev only.** |

```bash
# Set (per environment — repeat for preview if you want mock mode there)
vercel env add QS_TENANT_ID production --token $VERCEL_TOKEN
vercel env add QS_CONVERSION_URL production --token $VERCEL_TOKEN   # the www.nextinsure.com URL when going live
vercel env add QS_PREFILL_MOCK preview --token $VERCEL_TOKEN        # value: 1

vercel env ls --token $VERCEL_TOKEN          # verify
vercel --prod --yes --token $VERCEL_TOKEN    # env changes need a redeploy to take effect
```

## Boberdoo fields Misha must create

Unknown keys are ignored by Boberdoo's `pingPostLead`, so the page can send these before they exist — they just won't be stored. Nothing breaks; they're simply invisible until Misha adds them.

| Field | Carries | Why |
|---|---|---|
| `QS_Click_Key` | QuinStreet click key (32 chars) | The join key for conversion reporting and for any Boberdoo-side report Lindsy asks for. **Do NOT reuse `Sub_ID`** — that holds the ClickFlare `click_id` for paid search. |
| `QS_Sub_ID` | QuinStreet publisher/source id | Lets Misha see performance per publisher inside Boberdoo. |
| `QS_Source` | Source label | Human-readable companion to `QS_Sub_ID`. |
| `QS_Var1`, `QS_Var2` | `$var1$`, `$var2$` | Publisher sub-ids. |
| `QS_Campaign_ID`, `QS_Creative_ID` | QMP campaign / creative ids | Separate from Google's `Campaign_ID`/`Ad_ID`. |
| `QS_Device`, `QS_Bid` | device type, cpc | Diagnostics. |
| `Jornaya_Lead_ID` | `$leadid$` | Placeholder name — Misha to confirm the Boberdoo Jornaya field name. |
| `Household_Income_Raw` | Exactly what the consumer typed / QuinStreet sent (e.g. `55000`, `39999`) | The income input is now free text; `Estimated_Household_Income` still carries the mapped bracket, so agents keep the exact figure alongside it. |

**Optional — a separate SRC source key.** Today every quick-quote lead posts `SRC: "shophealthratescomenew"`. The page holds this in a top-level const `QQ_SRC_QUINSTREET` set to that same value, so **today's behavior is unchanged**. Once Misha creates a dedicated Boberdoo source (e.g. `shophealthratesquinstreet`), flip the const — that one edit segments QuinStreet traffic in every Boberdoo report without touching anything else.

## Data stored on our side

**Google Sheet (Sheety lead log)** — the sheet's columns are fixed; do **not** add columns. QuinStreet fields are appended to the existing `rawQuery` column:

```
phone=1234&zip=60610&name=John&qs_click_key=<key>&qs_sub_id=<sub>&qs_source=<src>&page=quick-quote
```

`page=quick-quote` is what distinguishes these rows from `quiz.html` leads. `enrollment.js` parses `qs_click_key=` back out of that string — that's the whole join, no extra store.

**Enrollment rows** additionally get `&qs=<status>` in their `rawQuery` (`ok`, an HTTP status, or `skipped`), so a failed sale conversion is visible in the sheet without digging through logs. The Telegram enrollment ping gains a `QuinStreet ✅/❌` marker **only when a `qs_click_key` was present** — quiz traffic's ping is untouched.

## Testing checklist

1. **Mock prefill** (no QuinStreet access needed) — set `QS_PREFILL_MOCK=1` on preview, then open:
   `https://<preview>.vercel.app/quick-quote.html?token=54f17290-9121-4ba5-bf34-99c111ef9696&click_key=fe035bd1141ca94c98da12c4603162d1&sub_id=testpub&utm_source=quinstreet&utm_medium=clickwall&utm_campaign=insure_com`
   Expect: fields filled from the spec's John Doe example, heading reads "Confirm Your Details", `?token=` gone from the address bar, `qs_click_key` still in sessionStorage.
2. **`/api/prefill` directly** — `curl -s 'https://<preview>.vercel.app/api/prefill?pf=54f17290-9121-4ba5-bf34-99c111ef9696' | python3 -m json.tool`. Then `?pf=nope` → expect `400 {ok:false}`, not a 5xx.
3. **Don't-clobber test** — type into a field *before* prefill resolves; the typed value must survive.
4. **Staging conversion** — the spec's own example, pointed at staging:
   ```bash
   curl -i --location --request POST 'https://nextinsure.quinstage.com/listingdisplay/handlers/conversion.ashx' \
     --header "X-Tenant-Id: $QS_TENANT_ID" \
     --header 'Content-Type: application/json' \
     --data-raw '{"clickKey":"fe035bd1141ca94c98da12c4603162d1","conversionDate":"2024-12-01","disposition":"quote","conversionCount":1,"clientUniqueConversionId":"123412422","qualityValue1":345.11,"productSku":"health"}'
   ```
   Repeat with the **same** `clientUniqueConversionId` to confirm QuinStreet dedupes rather than double-counting.
5. **End-to-end quote** — submit the preview form with a real-looking `click_key`; confirm the Sheety row's `rawQuery` carries `qs_click_key`/`page=quick-quote`, and that the missing-click_id Telegram alert did **not** fire as a fault.
6. **End-to-end sale** — fire an `api/enrollment` test with the matching email; confirm `&qs=` lands in the enrollment `rawQuery` and the Telegram line shows the QuinStreet marker.
7. **See it in QMP** — per Lindsy, conversions surface in QMP where the click key ties back to the click, and sub id shows the publisher. She offered to walk us through the matching view; ask her to confirm the staging conversions landed before flipping `QS_CONVERSION_URL` to production.

## Open items — waiting on QuinStreet

Slack channel: `#quin-street-clicks` (C0BQCBT1VFU, citadinesgroup.slack.com) — readable from Claude Code via the Slack MCP.

- [x] **`X-Tenant-Id`** — received 2026-08-21, set in Vercel, staging test returned 201. Quote/sale now post to **staging**; flip `QS_CONVERSION_URL` to prod once Lindsy confirms test conversions show in QMP.
- [ ] **Click-key + sub-id macro names**, and the full macro list Lindsy promised (she said she'd put it in Slack / email a spreadsheet). Our aliases are a guess until then.
- [ ] **Staging access + a test prefill token** that returns real-shaped data.
- [x] **Phone-validation vendor** — Lindsy (Slack 2026-08-20): QuinStreet uses **BriteVerify** for address + phone on their leads. Open question for us: does it screen VoIP? Evaluate for non-QuinStreet traffic (task #6, not started).
- [ ] **Pixel alternative** — confirm we're skipping it (S2S covers both events). Revisit only if tenant-id/staging drags.
- [ ] Confirm with Lindsy that the **pull model** is what she intends (the call implied a push).

## Decisions log

**2026-08-20**
- **Pull, not push.** The `.docx` spec beats the call transcript: QuinStreet sends `$prefilltoken$` in the URL and we GET their Prefill API. The transcript's "you'll build a postable endpoint" is superseded.
- **No inbound PII endpoint.** We expose nothing that accepts consumer data from QuinStreet. `/api/prefill` is outbound-only and same-origin.
- **ClickFlare is not part of this flow.** It measures paid search. QuinStreet leads have `qs_click_key`, no `cf_click_id`, and the missing-click_id alert must not flag them.
- **Address as one string.** Lindsy: format it however we want. `quick-quote.html` has a single address input, so `/api/prefill` returns one assembled string.
- **Income is free text + bracket mapping.** Publishers report income inconsistently (top-of-range numbers, text inputs, "over/under" buttons), and rejecting on an unmatched range would drop good leads. The select becomes a text input with a `<datalist>` of the six brackets: agents see the raw figure (`Household_Income_Raw`), Boberdoo still gets a bracket (`Estimated_Household_Income`). QuinStreet already income-filters on their side, so this is display fidelity, not qualification.
- **DOB is free text.** One `MM/DD/YYYY` input replacing three selects — prefill writes into it cleanly, and typed variants (`M/D/YY`, `November 11, 1981`, `1981-11-11`) parse. Validation stays real: calendar-valid, not future, age 18–110.
- **Conversions default to staging.** `QS_CONVERSION_URL` ships pointed at `quinstage.com`; production is a deliberate ops flip after a verified staging test.
