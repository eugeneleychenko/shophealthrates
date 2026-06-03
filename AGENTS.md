# Repository Guidelines

## Overview

Static marketing site for **LeoSource Insurance Agency** (shophealthrates.com). Built with plain HTML, CSS, and jQuery. Deployed to Vercel.

## Project Structure

```
├── index.html          # Homepage with zip code quote form
├── quiz.html           # Multi-step insurance assessment wizard
├── thank-you.html      # Post-submission confirmation page
├── thank-you-v2.html   # Alternate confirmation page
├── privacy.html        # Privacy policy
├── term.html           # Terms of use
├── css/
│   ├── style.css       # Main site styles
│   ├── quiz.css        # Quiz page styles
│   └── *.woff/.woff2   # Inter & Public Sans font files
├── js/
│   ├── jquery-3.6.0.min.js
│   └── bookmarkscroll.js  # Smooth scroll for anchor links
├── images/             # All site images (webp, png, svg)
└── api_docs/           # API documentation and integration notes
```

## Deployment

Hosted on **Vercel** (project: `vyb/vyb-site`). Deploy with:

```bash
vercel --prod --yes
```

No build step — Vercel serves static files directly.

## Development

No package manager, bundler, or build tools. Edit HTML/CSS/JS files directly. Preview locally by opening `index.html` in a browser or using any static file server.

## Key Technical Notes

- **Forms must use `method="get"`** — all pages are static HTML. Using `method="post"` causes HTTP 405 errors on Vercel's static hosting.
- **Quiz flow**: `index.html` → `quiz.html?zip=<value>` → `thank-you.html`
- **No framework** — vanilla HTML with jQuery 3.6.0 for DOM manipulation and smooth scrolling.
- **Fonts** are self-hosted in `css/` (Inter, Public Sans) via `@font-face` in `style.css`.

## Coding Style

- HTML: 4-space indentation, kebab-case for CSS classes (e.g., `banner_form_box_inner`)
- CSS: Organized by page section, mobile breakpoints via `@media`
- No linter or formatter configured

## Connect Streams Lightbox

Module **1966** (ShopHealthRates.com) from [manage.connectstreams.com](https://manage.connectstreams.com). Renders a "Connect Me Now" callback lightbox powered by Connect Streams (Gen3Ventures).

### Account

| Platform | URL | Account |
|----------|-----|---------|
| Connect Streams | `manage.connectstreams.com` | mandreyev@leosourceinsurance.com (credentials in `.env`) |

### Module 1966 Configuration (verified 2026-05-18)

| Field | Value |
|-------|-------|
| Name | ShopHealthRates.com |
| Phone Number | (844) 494-7060 |
| Destination Number | 8664540418 (Ringba publisher number) |
| Connect Message | Built-in: Connect General Health Insurance |
| Time Zone | EST |
| **Schedule** | **M-F 9:30am - 6:30pm** |
| Hostname | shophealthrates.com |
| Template | Built-in: Agent - Right Align - Lightbox - Minimize |
| Voicemail Detection | On |
| Account Balance | $196.00 (as of 2026-05-18) |

There is also module **1964** (ShopHealthRates.net) — appears to be an older/alternate module.

### Hours of Operation (important)

The lightbox **will NOT appear outside business hours** (M-F 9:30am - 6:30pm EST). The Connect Streams API returns `lightbox: false` when outside the schedule window, and the widget silently suppresses itself. This is by design — no agents are available to take callbacks outside HOO.

If the client reports the banner is missing, **first check the time** before debugging code.

### Pages

- **thank-you.html / thank-you-v2.html** — Lightbox auto-opens on page load. Requires `?phone=<digits>` query param (passed from quiz.html on form submit).
- **index.html** — Commented out. Connect Streams requires a valid phone number to render (it's a callback widget that rings the user's phone). No phone is available on the homepage since the user hasn't submitted the form yet. To add a homepage popup, build a custom click-to-call modal instead.

### Testing the Lightbox

The lightbox only works on **thank-you pages** during **business hours (M-F 9:30am - 6:30pm EST)** because Connect Streams needs both a phone number and an active schedule.

**Quick test URL:**
```
https://shophealthrates.com/thank-you.html?phone=5551234567
```

**To re-test after it's already shown:**
1. Open DevTools → **Application** tab → **Session Storage** → select the site
2. Delete the `cs_shown` key (homepage) or just open a new Incognito window
3. Reload the page

**Via agent-browser:**
```bash
agent-browser open "https://shophealthrates.com/thank-you.html?phone=5551234567"
agent-browser wait --load networkidle
agent-browser wait 5000
agent-browser screenshot test-lightbox.png
```

To re-trigger after a previous test:
```bash
agent-browser eval "sessionStorage.clear()"
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 5000
agent-browser screenshot test-lightbox.png
```

### Debugging the Lightbox

If the lightbox isn't appearing, check the internal widget state in the browser console:

```js
// Find the Connect Streams instance and inspect module state
var cm = null;
for (var key in window) {
  if (window[key] && window[key].classname && window[key].modules) { cm = window[key]; break; }
}
// Key fields to check:
// cm.modules[containerid].loaded    — true if API responded
// cm.modules[containerid].lightbox  — false means API suppressed it (likely HOO)
// cm.modules[containerid].showoninit — should be true
// cm.phonenumber                    — should have the phone from ?phone= param
```

If `lightbox: false` and `loaded: true` → the Connect Streams backend is suppressing it (schedule/HOO). Check `manage.connectstreams.com` → Modules → 1966 → Schedule.

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
**IP Whitelist**: `209.122.209.0/24`
**Expiration**: Unlimited

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

## Ringba ↔ ClickFlare Integration (Phone Calls — U65)

### Overview

Connecting **Ringba** (call tracking/routing) to **ClickFlare** so that when an answered phone call comes in via Ringba, a postback fires to ClickFlare recording it as a `phone_call` custom conversion with revenue. This replaces the old Final Expense campaign setup.

### Accounts

| Platform | URL | Account |
|----------|-----|---------|
| Ringba | `app.ringba.com` | Leosource Insurance Agency, LLC |
| ClickFlare | `app.clickflare.com` | MA workspace |

### Ringba Setup (completed 2026-05-18)

**Campaign**: "U65 LeoSource" (ID: `CA28ed4f20fb83474ba9ae68fe41e6ab78`, Live, US)

**Targets** (both active, Priority routing):

| Target | DID | Purpose | HOO | Priority | Weight |
|--------|-----|---------|-----|----------|--------|
| Internal - U65 - LeoSource | +19185254531 | Connect Me (Connect Streams) | Mon-Fri 9:30am-6:30pm ET | 1 | 20 |
| Internal - U65 - Dialer | +13464497767 | Dialer (top-right corner) | Mon-Fri 9:30am-6:30pm ET | 1 | 20 |

- Both targets convert on **Call Length** (Connected, 120 seconds), Revenue $0, no payout/buffer
- Sunday and Saturday are disabled on both targets
- No state filtering (all 50 states)

**Publisher**: "Google Search" → Phone +18664540418, Number Pool "LeoSource - Main" (5 numbers)

**Call Tracking Tag**: "LeoSource Main"
- Phone: +18664540418
- Publisher: Google Search
- Pool: LeoSource - Main
- **Number to Replace**: +18007581590 (the static `(800) 758-1590` on the website)
- Ringba JS dynamically swaps this number with a tracked pool number

**URL Parameter**: `cpid` (Reporting Menu Name: "ClickFlare ID", Report Name: "cpid")
- Ringba captures the `cpid` query param from the URL as a connection tag
- This carries the ClickFlare click_id through to the postback

**Old campaign**: "Final Expense" (ID: `CA5a12f36d16ca4210a1cdd3cabb997295`) — still exists but no longer in use for U65.

### ClickFlare Custom Conversion

- **Name**: `phone_call`
- **Slot**: 2
- **Parameter**: `phone_call` (passed as `&ct=phone_call` in postback URL)
- **Include in Conversions**: ✅ ON
- **Include in Revenue**: ✅ ON

### Ringba Pixel (linked to U65 campaign)

- **Name**: ClickFlare Phone Call Postback
- **Fire Pixel On**: Connected (Answered)
- **Method**: GET
- **URL**: `https://leosourceclick.com/cf/cv?click_id=[connectionTag:cpid]&payout=[publisherPayoutAmount]&txid=[callId]&ct=phone_call`
- **Linked to**: U65 LeoSource campaign

### Ringba JS Tag (installed on all pages)

```html
<script src="//b-js.ringba.com/CA28ed4f20fb83474ba9ae68fe41e6ab78" async></script>
```

Installed in `<head>` of: `index.html`, `quiz.html`, `thank-you.html`, `thank-you-v2.html`

### How It Works (live)

```
Google Ads click
  → ClickFlare generates click_id, sets cf_click_id cookie, passes cpid in URL
  → User lands on shophealthrates.com (ClickFlare JS tag fires)
  → Ringba JS tag swaps (800) 758-1590 with a tracked pool number
  → Ringba captures cpid from URL as a connection tag
  → User calls the tracked number
  → Ringba routes to Dialer (+13464497767) or ConnectMe (+19185254531)
  → Call is answered (Connected)
  → Ringba fires pixel GET request:
      https://leosourceclick.com/cf/cv?click_id=[connectionTag:cpid]&payout=[publisherPayoutAmount]&txid=[callId]&ct=phone_call
  → ClickFlare records a "phone_call" conversion with revenue
```

### Status

- **Deployed** to Vercel (live on shophealthrates.com) — 2026-05-18
- **Ringba JS tag**: Live on all 4 pages
- **ClickFlare pixel**: Linked to U65 campaign, fires on Connected
- **cpid URL parameter**: Configured on U65 campaign
- **Number to Replace**: Set to +18007581590

### Testing

To test the full flow:
1. Visit `https://shophealthrates.com/?cpid=test123`
2. Verify the `(800) 758-1590` number is swapped with a Ringba tracked number
3. Call the tracked number during HOO (Mon-Fri 9:30am-6:30pm ET)
4. Check ClickFlare Logs for a `phone_call` conversion with `click_id=test123`

## Claude Code on the Web (Remote Management)

This project is configured for remote management via [claude.ai/code](https://claude.ai/code). No local machine required.

### Environment

- **Cloud environment**: Default Cloud Environment
- **Repo**: `eugeneleychenko/shophealthrates` (main branch)
- **Vercel CLI**: Available via `$VERCEL_TOKEN` env var
- **Deploy command**: `vercel --prod --yes --token $VERCEL_TOKEN`

### Workflow

1. Copy client request from Telegram
2. Open [claude.ai/code](https://claude.ai/code) on phone or browser
3. Select `shophealthrates` repo and paste the request
4. Claude edits files, commits, pushes to GitHub, and deploys to Vercel
5. Confirm back in Telegram

### Common Tasks

```
# Deploy to production
vercel --prod --yes --token $VERCEL_TOKEN

# Install Vercel CLI (if not in setup script)
npm i -g vercel
```

## Commit Guidelines

- Keep commit messages short and descriptive (e.g., `fix form method to get`)
- Commit on `main` branch directly
