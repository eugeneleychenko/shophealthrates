# LeoSource ↔ QuinStreet — Integration Spec

**From:** Eugene (LeoSource / shophealthrates.com) · **To:** Lindsy Mueller, QuinStreet · **2026-08-20**

Following up on today's call. Landing page is live at **https://shophealthrates.com/quick-quote.html** — single page, one submit button, built for prefilled click-wall traffic.

## 1. Click-through URL

Please configure our listing URL as:

```
https://shophealthrates.com/quick-quote.html?token=$prefilltoken$&click_key=<CLICK KEY MACRO>&sub_id=<SUB ID MACRO>&utm_source=quinstreet&utm_medium=clickwall&utm_campaign=insure_com
```

Please keep the UTM values exactly as written — that's how we segment your traffic in reporting.

We read these parameter names (any spelling below works, case-insensitive), so pick whichever matches your macros:

| What | Parameter names we accept |
|---|---|
| Prefill token | `token`, `pf`, `prefilltoken`, `prefill_token` |
| Click key | `click_key`, `clickkey`, `ck` |
| Sub id / source id | `sub_id`, `subid`, `src_id`, `source_id` |
| Source label | `source` |

Feel free to append any other non-PII macros — extra params are harmless, and once we see your full macro list we'll tell you which additional ones we'd like stored.

## 2. Prefill — we'll pull, no endpoint needed on our side

On the call we discussed building a POST endpoint for you to send PII to. **Reading your Prefill API spec, that isn't necessary** — you send `$prefilltoken$` in the URL, and we call:

```
GET https://www.nextinsure.com/listingdisplay/prefill?pf=<token>
```

…to pull first/last, email, phone, address, DOB, gender, household size and income, then prefill the form. **Please confirm this is the intended flow** and that no inbound endpoint is expected from us. If you'd rather push, tell us and we'll build it — but pull looks simpler for both of us, and it keeps PII out of the URL entirely.

Notes on our field handling, so nothing gets rejected:
- **Address** — send it as one string; no need to break out street/city/state/zip.
- **Income** — our field accepts free text as well as ranges, so top-of-range values (e.g. `39999`) and text inputs both work.
- **Date of birth** — free text, we parse the common formats. `YYYY-MM-DD` per your spec is ideal.
- Any missing field is fine — we prefill what you have and the consumer fills the rest.

## 3. Conversion reporting

We'll use your **Server-to-Server Conversion API** (`/listingdisplay/handlers/conversion.ashx`), posting the click key you send us:

- **`quote`** — fired the moment the consumer submits the form.
- **`sale`** — fired when the policy closes, with **policy revenue in `qualityValue1`** so you can optimize toward the sources producing real policies.

Both use a stable `clientUniqueConversionId` (`quote-<clickKey>` / `sale-<lead id>`) so retries can't double-count.

**Fallback:** if S2S access takes time to set up, we can email a **weekly CSV** — click key, conversion date, quote (1/0), sale (1/0), policy revenue. Happy to do both while we validate.

## 4. What we need from you

1. **`X-Tenant-Id`** for the conversion API — nothing can fire without it.
2. **Staging access** (`nextinsure.quinstage.com`) plus a **test prefill token** that returns sample data, so we can validate before going live.
3. **The macro list** you mentioned — specifically the **click-key** and **sub-id** macro names, plus anything else worth passing.
4. **Phone-validation vendor** you or your publishers use — and whether it screens out **VoIP** numbers. We want to avoid paying twice for the same check.

Once we have (1) and (2) we can be testing the same day. Thanks!
