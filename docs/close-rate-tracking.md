# Close / Enrollment Rate Tracking (Boberdoo CRM "Closed")

> Runbook. Not deployed — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../AGENTS.md#further-documentation).

## What "sale" means (Josh, 2026-07-01)

A **sale = an enrollment = a lead whose Boberdoo CRM status is set to `Closed`** — NOT the `lead_status = Matched` we had been reporting. The CRM pipeline (the Status dropdown in the Boberdoo admin) is:

`New → Working Lead → Docs Sent → Docs Signed → Processing → Closed → Dead`

- **Close rate = Closed ÷ total leads.** Last week ≈ **1.5%** (3 enrollments / 206 leads).
- `lead_status = Matched` is ~100% for our leads (0 unmatched) — it is NOT the metric Josh wants. That's why `/sales` and `/keywords` show ~100% "sell-through"; the meaningful number is the close/enrollment rate.

## The blocker: Boberdoo has no CRM-status READ API

Confirmed 2026-06-30/07-01 by a CI probe (`getLeadDetails` on 33 leads) **and** a sweep of Boberdoo's public docs:

- `getLeadDetails` returns only `lead_status` (Matched/Unmatched), `number_of_times_sold`, `matched_partners`, `lead_data` — **no CRM / disposition field**. A key's scope only controls which *functions* it can call; it cannot add a field a function doesn't emit. So **widening the API key scope does NOT unlock this.**
- Every CRM-status API is **write-only**: `setCRMLeadStatus`, `setCRMStatusByPhone`, `setCRMStatusFromGoHighLevel`. There is **no** `getCRMStatus` / `getCRMLeadStatus` / `getLeadStatus` (searched — not found).

Sources: boberdoo.com `/api-keys`, `/whitelisting-restricted-apis`, `/reports`, `/reports-guide`, `/webhooks-notifications-guide`, `/changelog`. See also [[boberdoo-api-surfaces]] memory + the deep API-surface list captured 2026-07-01.

## The path: a scheduled Boberdoo REPORT → Google Sheet

Boberdoo's **Reports** layer *does* expose CRM status ("Lead Status Report (All Partners)", "Lead Status by Source"; CPA Reports are "based on CRM Status by Partner and Source") and can auto-deliver to **Google Sheets / S3 / FTP / email** on a schedule. That is the read path — a report, not a per-lead API action. **Mikhail (Boberdoo admin / partner_id 3 = Leosource Insurance Agency) builds it.**

### Report spec (handed to Misha 2026-07-01)

Scheduled report delivered to a Google Sheet:
- **Per-lead rows, ALL statuses** (New → Closed → Dead) — need the full denominator, not just Closed.
- **Filter:** Lead Type **33** (Health Insurance), Source **`shophealthratescomenew`**. Rolling ~90 days.
- **Columns:** Lead ID · Date · **CRM Status** · **Sub_ID** (= our ClickFlare click_id, join key) · Phone · Email · **Campaign_ID · Ad_ID · Keyword** (custom fields added 2026-06-25/29) · SRC · Lead Cost (+ enrollment $ value if tracked).
- **Deliver DAILY to Google Sheets, shared with `nycspicebo@gmail.com`.**

### Webhook (real-time alternative / to fix)

The real Boberdoo event is **"CRMStatus – Closed"** (fires when a lead is set to Closed), **not** the generic "CRM Status – Changed" that our **webhook #57** is labeled with — a likely reason #57 never fired. Open questions for Boberdoo/Misha:
1. Does setting Closed via **`setCRMStatusByPhone`** (the Convoso dialer path) actually fire the "CRMStatus – Closed" webhook?
2. Why isn't our existing webhook #57 firing? (History: [lead-logging.md](lead-logging.md) §"Sale Postback Not Firing"; config: [integrations/boberdoo-clickflare.md](integrations/boberdoo-clickflare.md) webhook 57.)

## Our side (once the sheet is live)

Read the Google Sheet the same way we read the lead log (Sheety-style GET) → compute **close rate overall + by keyword + by campaign, over time** → post via the Telegram bot and/or a simple dashboard. The join is trivial: the sheet already carries `Keyword`/`Campaign_ID`, or we join by `Sub_ID` (= click_id) to our existing keyword data. **No further Boberdoo work after the report exists.**

## BUILT 2026-07-02: the Convoso→ClickFlare path via `api/enrollment`

The "deferred" alternative became the live path once Misha engaged Hoang (Convoso integrator, hoang@theinnovateadvisors.com) to fire a postback on the **Sale** disposition ("Leosource Data" list; "Connect Me Inbounds" + "Web Inbounds" queues), with 5 new Convoso lead fields created: `campaign_id, ad_id, sub_id, keyword, pub_id` (Misha maps Boberdoo delivery → those fields; only populated on leads from 2026-06-29+).

**`api/enrollment.js`** (Vercel, live, tested end-to-end 2026-07-02) is the shared intake for ALL enrollment signals (Convoso webhook `src=convoso`, future Boberdoo webhook-57 repoint `src=boberdoo`). **Deliberately no manual/Telegram marking path** (decision 2026-07-02): sales enter only via system webhooks, so chat can't create or pollute enrollment data.
- **Auth:** `?secret=<ENROLL_SECRET>` (Vercel env + `.env`) or `x-enroll-secret` header; fails closed.
- **Why not point Convoso straight at ClickFlare:** the `sub_id` reaching Convoso is Boberdoo's **30-char truncated** Sub_ID; ClickFlare silently drops unmatched click_ids (proven with lead 17237753). The endpoint resolves full ids: full-36 param → truncated→`key30` prefix vs Sheety `clickId` → email→Sheety. Phone-only stays unresolved (Sheety keeps last-4; Boberdoo Phone lookup is Fixie/CI-only).
- **Dedupe:** vs existing `event=enrollment` rows (by `txid=enroll-<convoso_lead_id>` or resolved clickId) — absorbs re-fires/redispositions. Rows live in the SAME lead-log sheet with `event="enrollment"` + txid sentinel so reconcile/daily-summary/sales-report (which filter `event==="lead_submitted"`) ignore them. Sheety DELETE is disabled (403) — void bad rows via PUT `event=enrollment-test-void`.
- **Stage 1 (current):** log + Telegram ping only. **Stage 2:** set `ENROLL_FIRE_CF=1` after the ClickFlare `ct=sale` conversion-type test (+ old-click window test) passes → fires `leosourceclick.com/cf/cv?click_id=<full>&payout=…&txid=enroll-…&ct=sale`. Payout defaults 0 (close *rate* is the metric; $50 lead revenue already books on the lead conversion).

**Convoso account facts** (creds in `.env` `CONVOSO_*`; account 105355): dispositions — **SALE "Sale"** (Success=Yes) is the enrollment; **PDATE "POST DATE"** also Success=Yes (ask Josh/Misha if it counts); **CS/CR "Cancel"** = take-backs to watch. An API token named **"Call Logs"** already exists (API → Authorization Tokens) for the future `log/retrieve` reconcile/backfill job; the **"Lead Access"** token works for `POST /v1/leads/search` (form-encoded, undocumented `list_id` filter works).

**Field passthrough VERIFIED 2026-07-06:** Boberdoo→Convoso delivery to list **6523 "LeoSource Data"** flows daily (~44 leads/day, matches our volume) and populates the 5 custom fields on real leads — exposed by the Convoso API as **`field_6`=campaign_id, `field_7`=ad_id, `field_8`=sub_id (30-char truncated click_id), `field_9`=keyword, `field_10`=pub_id** (44/44 populated except pub_id — empty because we never send Pub_ID; expected). Hoang's webhook Adaptor should map these into the postback params.

**Still open:** Hoang wires the Workflow (+ Redisposition event) to the endpoint URL; PDATE decision; Stage-2 ClickFlare tests; weekly reconcile job + historical backfill via the Call Logs token. The Boberdoo report → Google Sheet plan (above) remains the belt-and-suspenders denominator/audit path.
