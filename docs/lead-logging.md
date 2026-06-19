# Lead Logging & Diagnostics

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../AGENTS.md).

## Lead Logging & Diagnostics (built 2026-06-05)

### Overview

Every quiz.html form submission is logged to a Google Sheet via Sheety.co. Instant Telegram alerts fire when a lead has no ClickFlare click_id. A daily summary posts to the Telegram group at 9am ET. The `/diagnose` command lets you query logs directly from Telegram.

### Architecture

```
quiz.html form submit
  → navigator.sendBeacon('/api/log-lead')
  → api/log-lead.js logs to Google Sheet (via Sheety.co)
  → If click_id is empty → instant ⚠️ alert to Telegram group

Daily at 9am ET (Vercel cron)
  → api/daily-summary.js reads last 24h from Sheety
  → Posts 📊 summary to Telegram group
  → Health-checks ClickFlare postback URL
```

### Components

| File | Purpose |
|------|---------|
| `api/log-lead.js` | Receives lead data from quiz.html, logs to Sheety, alerts if click_id missing |
| `api/daily-summary.js` | Vercel cron — daily 9am ET summary + ClickFlare health check |
| `api/telegram.js` | Extended with `/diagnose` command handler |
| `quiz.html` | Added `sendBeacon` call on form submit |
| `vercel.json` | Cron schedule: `0 13 * * *` (13:00 UTC = 9am ET) |

### Google Sheet

- **Sheet**: "Shophealthrates Logs"
- **Sheety API**: `https://api.sheety.co/7d3474466c41aa304f1754a2bd57b6af/shophealthratesLogs/sheet1`
- **Columns**: `timestamp`, `event`, `clickId`, `payout`, `txid`, `ct`, `cfStatus`, `cfResponse`, `rawQuery`
- **Vercel env var**: `SHEETY_URL` (Production)

### Telegram Commands

| Command | What it does |
|---------|-------------|
| `/diagnose recent` | Shows last 10 logged leads with click_id status |
| `/diagnose <phone_digits>` | Search logs by phone number (last 4 digits work) |
| `/diagnose health` | Checks if ClickFlare postback URL (`leosourceclick.com/cf/cv`) is responding |

### Proactive Alerts

| Alert | When |
|-------|------|
| ⚠️ Missing click_id | Instant — fires the moment a lead submits without a ClickFlare click_id |
| 📊 Daily summary | 9am ET — total leads, click_id coverage, ClickFlare URL health |

### What This Catches vs. What It Can't

| Scenario | Caught? |
|----------|---------|
| Lead submitted with no click_id | ✅ Instant alert |
| ClickFlare domain goes down | ✅ Daily health check + `/diagnose health` |
| Lead data pipeline working | ✅ Logged in sheet with all params |
| Boberdoo sale webhook didn't fire | ❌ Need Boberdoo webhook logs or parallel webhook |
| Dialer not updating CRM status | ❌ Need Boberdoo API access (IP-whitelisted) |

### Known Issue: Sale Postback Not Firing (diagnosed 2026-06-04)

Webhook 57 ("ClickFlare Sale Postback") is Active and correctly configured (`CRM Status - Changed` event, `&ct=sale`). The ClickFlare endpoint is live and accepting requests (200 OK). Sub_ID is populated on leads.

**Root cause**: The dialer sets a "Closed" disposition on the partner/buyer side when a sale happens. This may not be triggering Boberdoo's "CRM Status - Changed" event — the disposition and CRM status may be separate fields in Boberdoo's data model. **Needs confirmation from Mikhail/Boberdoo support.**

### API Access Gaps (for future diagnostics)

| System | Have API? | Blocker |
|--------|-----------|---------|
| Boberdoo | ✅ Key 107 | ❌ IP-whitelisted to `209.122.209.0/24` — remove whitelist to use from CLI |
| ClickFlare | ✅ Internal API (in use) | The paid **Public API** (`public-api.clickflare.io`) returns **HTTP 403** for our plan. Workaround: the **internal app API** `api.clickflare.io` — reverse-engineered with browserbase `browser-to-api` (capture harness in `.b2a/`, spec + client in `.b2a/run/api-spec/` (git-ignored, regenerable)). Auth = `POST user-manager-v2.clickflare.io/api/login` (username/password, no MFA) → JWT sent in a header literally named `jwt` + `x-organization-id`. Wrapped in **`scripts/clickflare-api.mjs`** (`eventLogs`, `postbackStatus`). |
| Ringba | ✅ Long-lived API token | Generated at `app.ringba.com` → Security → API Access Tokens (MFA only at creation, never expires). Header `Authorization: Token <t>`. **In use by `/check`'s fast path.** |

---

