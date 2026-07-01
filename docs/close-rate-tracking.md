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

## Alternative considered (deferred): write sales to ClickFlare directly

We could fire ClickFlare's open postback `https://leosourceclick.com/cf/cv?click_id=<id>&ct=sale&payout=<$>` on each enrollment — no Boberdoo needed — and ClickFlare would attribute it to the keyword automatically. But it still needs an enrollment **trigger** (a Convoso "Closed" disposition webhook, or a manual `/enroll <phone>` Telegram command) plus a click_id lookup (our Sheety log). **Deferred** in favor of the Boberdoo report (no Convoso dependency, sidesteps the admin-UI lockout). Revisit if the report path stalls — the manual `/enroll` command is the fastest fallback.
