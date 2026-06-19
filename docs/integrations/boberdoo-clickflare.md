# Boberdoo ↔ ClickFlare Integration

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../../AGENTS.md).

## Boberdoo ↔ ClickFlare Integration

### Overview

Connecting **Boberdoo** (lead distribution) to **ClickFlare** (ad tracking) so that when a lead is sold in Boberdoo, a server-to-server postback fires to ClickFlare to record the conversion and revenue.

### Accounts

| Platform | URL | Account |
|----------|-----|---------|
| Boberdoo | `leosourceinsurance.leadportal.com` | Eugene Leychenko (admin, credentials in `.env`) |
| ClickFlare | `app.clickflare.com` | MA workspace |

### Boberdoo Admin API

**Key ID**: 107 — "Admin Lead & Webhook API"
**Type**: Admin (all 84 permissions)
**Key**: `31b08e7d933d478c3e3359f723ef262454c1b17005b0c27e5db2eca79bdc2634`
**IP Whitelist**: `209.122.209.0/24`, plus the Fixie static-IP proxy egress IPs **`52.5.155.132`** and **`52.87.82.133`** (whitelist BOTH — Fixie egresses from a pool of two, and `getLeadDetails` is rejected with `Authentication failed` from any non-whitelisted IP).
**Expiration**: Unlimited

> **Running `scripts/lead-check-api.mjs` locally or in CI** routes through Fixie (`FIXIE_URL`) so the request comes from one of the two static IPs above. If you see `API error: Authentication failed`, it's the IP allowlist, not the key — confirm both Fixie IPs are whitelisted. The Boberdoo whitelist UI is itself IP-restricted to `209.122.209.0/24`.

**Get leads by date:**
```bash
curl -s -X POST "https://leosourceinsurance.leadportal.com/new_api/api.php" \
  -d "Format=JSON" \
  -d "Key=31b08e7d933d478c3e3359f723ef262454c1b17005b0c27e5db2eca79bdc2634" \
  -d "API_Action=getLeadDetails" \
  -d "Lead_Type=33" \
  -d "Date_Start=2026-05-26" \
  -d "Date_End=2026-05-26"
```

**Useful parameters** (from API spec):
- `Lead_Type` (integer, required): 33 = Health Insurance, 9 = Inbound Phone, 32 = Test
- `Date_Start` / `Date_End` (YYYY-MM-DD): filter by date range
- `Last_Lead_ID` (integer): paginate — returns leads after this ID (100 per page)
- `Lead_ID` (integer): get a specific lead
- `Email` / `Phone` (string): search by contact info
- `By_Transaction_Date` ("Yes"): order by transaction date instead of lead ID

**Response fields per lead**: `lead_id`, `lead_date`, `lead_status` (Matched/Unmatched), `lead_data.sub_id`, `lead_data.src`, `lead_data.first_name`, `lead_data.last_name`, `lead_data.email`, `lead_data.primary_phone`, `lead_data.zip`, etc.

**Note**: There is also a Partner API key (ID 105) with limited permissions (pingPostLead, setCRMLeadStatus only). The Admin key (ID 107) is needed for getLeadDetails and other read operations.

### ClickFlare Setup (discovered)

- **Tracking domain**: `leosourceclick.com` (custom domain, CNAME → cname.flareclickhero.com; previously `flarehitlog.com`)
- **Campaign**: "Google - Search - Main" (ID: `6a04cfc67e76d10012a65767`)
- **Offer**: "LeoSource - ShopHealthRates.com"
- **Offer URL**: `https://shophealthrates.com/?gclid={gclid}&wbraid={wbraid}&gbraid={gbraid}&campaignid={campaignid}&adgroupid={adgroupid}&loc_physicall_ms={loc_physical_ms}&loc_interest_ms={loc_interest_ms}&matchtype={matchtype}&network={network}&creative={creative}&keyword={keyword}&placement={placement}&targetid={targetid}&cpid=6a04cfc67e76d10012a65767`
- **Campaign uses**: Tag-based tracking (ClickFlare JS script on the landing page, not redirect)
- **Postback URL format**: `https://leosourceclick.com/cf/cv?click_id=REPLACE&payout=OPTIONAL&txid=OPTIONAL`

### Boberdoo Setup (discovered)

- **Lead Types**: Health Insurance (ID 33, pingpost), Inbound Phone (ID 9, pingpost), Test (ID 32)
- **Webhooks page**: Settings → Webhooks (`pageID=165`)
- **Webhooks created**:
  - ID 53: "ClickFlare Postback" — Event: `New Lead - Matched`, Type: GET, Host: `leosourceclick.com/cf/cv`
  - ID 55: "ClickFlare Postback - Unmatched" — Event: `New Lead - Unmatched`, Type: GET, Host: `leosourceclick.com/cf/cv`
  - ID 57: "ClickFlare Sale Postback" — Event: `CRM Status - Changed`, Type: GET, Host: `leosourceclick.com/cf/cv` (includes `ct=sale`)
- **Available magic strings for the postback**:
  - `{LEAD_SUBID}` — Lead SUB ID (intended to carry ClickFlare's `click_id`)
  - `{LEAD_PRICE}` — Lead Price (maps to ClickFlare `payout`)
  - `{LEAD_PUBID}` — Lead PUB ID
  - `{LEAD_ID}` — Boberdoo Lead ID (can map to ClickFlare `txid`)
  - `{LEAD_FIELD_fieldname}` — Any custom lead field

### How the Postback Will Work

```
Google Ads click
  → ClickFlare generates click_id, sets cf_click_id cookie
  → User lands on shophealthrates.com (ClickFlare JS tag fires)
  → User fills quiz.html form → lead posts to Boberdoo
  → Boberdoo matches lead to a buyer (New Lead - Matched)
  → Boberdoo webhook fires GET request:
      https://<tracking-domain>/cf/cv?click_id={LEAD_SUBID}&payout={LEAD_PRICE}&txid={LEAD_ID}
  → ClickFlare records the conversion with revenue
```

### Completed Setup

**Boberdoo webhook (ID 53)** — saved and configured:
- Name: ClickFlare Postback
- Event: New Lead - Matched
- Type: GET
- Host: `https://flarehitlog.com/cf/cv`
- Values: `click_id={LEAD_SUBID}`, `payout={LEAD_PRICE}`, `txid={LEAD_ID}`
- Status: **Not Active** (activate after testing)

**ClickFlare tracking script** — installed on both `index.html` and `quiz.html`. The script registers visits with `leosourceclick.com/cf/tags/...` and sets a `cf_click_id` cookie.

**quiz.html Sub_ID logic** — updated to read `cf_click_id` cookie first, falling back to `cpid` from sessionStorage:
```js
var cfClickId = (document.cookie.match(/(^| )cf_click_id=([^;]+)/) || [])[2] || '';
var subId = cfClickId || sessionStorage.getItem('utm_cpid') || '';
```

### ClickFlare Conversion Events (from Josh — 2026-05-20)

Josh confirmed three separate ClickFlare conversion types are needed:

| Conversion | Trigger | Postback URL |
|-----------|---------|-------------|
| Lead (default) | Any new qualified lead (matched + unmatched) | `https://leosourceclick.com/cf/cv?click_id={LEAD_SUBID}&payout={LEAD_PRICE}&txid={LEAD_ID}` |
| Sale | CRM status → Sold | `https://leosourceclick.com/cf/cv?click_id={LEAD_SUBID}&payout={LEAD_PRICE}&txid={LEAD_ID}&ct=sale` |
| Phone call | Ringba connected call | Already handled via Ringba pixel (see below) ✅ |

### Known Issue: flarehitlog.com Blocked in Boberdoo (ticket #209051)

**Boberdoo blocks `flarehitlog.com`** in the webhook creation form ("Host is invalid or restricted!"). Regular admin users cannot create webhooks with this domain. Boberdoo support created webhook 53 as a superadmin to bypass this restriction.

- **Ticket #209051**: "flarehitlog blocked?" — Status: Open, Priority: Very High
- **Action needed**: Reply to ticket asking support to:
  1. Create webhook for **"New Lead - Unmatched"** event (same config as webhook 53)
  2. Create webhook for **"CRM Status - Changed"** event (same host, add `ct=sale` value)
  3. Whitelist `flarehitlog.com` so admin users can manage webhooks themselves

### Why Webhook 53 Wasn't Firing (diagnosed 2026-05-20)

Webhook 53 fires on **"New Lead - Matched"** only — requires a buyer/partner to accept the lead via ping/post. Test leads were entering Boberdoo successfully (Sub_ID populated correctly with ClickFlare click_id), but were not being matched to any buyer, so the webhook never fired.

Josh wants the postback to fire on ANY qualified lead (both matched and unmatched). Fix requires a second webhook with event "New Lead - Unmatched" pointing to the same URL.

### Status

- **Deployed** to Vercel (live on shophealthrates.com)
- **Boberdoo webhooks**: ID 53 (Matched), ID 55 (Unmatched), ID 57 (Sale) — all Active, all using `leosourceclick.com`
- **ClickFlare tracking script**: Live on index.html and quiz.html, using `leosourceclick.com`
- **Ringba pixel**: Updated to `leosourceclick.com`
- **Sub_ID pipeline**: Verified working (cf_click_id cookie → quiz.html Sub_ID → Boberdoo LEAD_SUBID)
- **Custom domain**: `leosourceclick.com` (purchased on Namecheap, CNAME → cname.flareclickhero.com)
- **Pending**: Josh needs to confirm custom domain is fully "Active" in ClickFlare (currently returning 404 on tag requests)

---

