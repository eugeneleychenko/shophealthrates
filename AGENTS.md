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

- **thank-you.html / thank-you-v2.html** — Lightbox auto-opens on page load. Requires `?phone=<digits>` query param (passed from quiz.html on form submit).
- **index.html** — Commented out. Connect Streams requires a valid phone number to render (it's a callback widget that rings the user's phone). No phone is available on the homepage since the user hasn't submitted the form yet. To add a homepage popup, build a custom click-to-call modal instead.

### Testing the Lightbox

The lightbox only works on **thank-you pages** because Connect Streams needs a phone number.

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

## Boberdoo ↔ ClickFlare Integration

### Overview

Connecting **Boberdoo** (lead distribution) to **ClickFlare** (ad tracking) so that when a lead is sold in Boberdoo, a server-to-server postback fires to ClickFlare to record the conversion and revenue.

### Accounts

| Platform | URL | Account |
|----------|-----|---------|
| Boberdoo | `leosourceinsurance.leadportal.com` | Eugene Leychenko (admin) |
| ClickFlare | `app.clickflare.com` | MA workspace |

### ClickFlare Setup (discovered)

- **Tracking domain**: `flarehitlog.com` (shared/dedicated — no custom domain configured yet)
- **Campaign**: "Google - Search - Main" (ID: `6a04cfc67e76d10012a65767`)
- **Offer**: "LeoSource - ShopHealthRates.com"
- **Offer URL**: `https://shophealthrates.com/?gclid={gclid}&wbraid={wbraid}&gbraid={gbraid}&campaignid={campaignid}&adgroupid={adgroupid}&loc_physicall_ms={loc_physical_ms}&loc_interest_ms={loc_interest_ms}&matchtype={matchtype}&network={network}&creative={creative}&keyword={keyword}&placement={placement}&targetid={targetid}&cpid=6a04cfc67e76d10012a65767`
- **Campaign uses**: Tag-based tracking (ClickFlare JS script on the landing page, not redirect)
- **Postback URL format**: `https://flarehitlog.com/cf/cv?click_id=REPLACE&payout=OPTIONAL&txid=OPTIONAL`

### Boberdoo Setup (discovered)

- **Lead Types**: Health Insurance (ID 33, pingpost), Inbound Phone (ID 9, pingpost), Test (ID 32)
- **Webhooks page**: Settings → Webhooks (`pageID=165`)
- **Webhook created**: "ClickFlare Postback" — Event: `New Lead - Matched`, Type: `Post / Get` (GET)
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

**ClickFlare tracking script** — installed on both `index.html` and `quiz.html` (replaces the placeholder comment). The script registers visits with `flarehitlog.com/cf/tags/...` and sets a `cf_click_id` cookie.

**quiz.html Sub_ID logic** — updated to read `cf_click_id` cookie first, falling back to `cpid` from sessionStorage:
```js
var cfClickId = (document.cookie.match(/(^| )cf_click_id=([^;]+)/) || [])[2] || '';
var subId = cfClickId || sessionStorage.getItem('utm_cpid') || '';
```

### Status

- **Deployed** to Vercel (live on shophealthrates.com)
- **Boberdoo webhook ID 53**: Active
- **ClickFlare tracking script**: Live on index.html and quiz.html

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
- **URL**: `https://flarehitlog.com/cf/cv?click_id=[connectionTag:cpid]&payout=[publisherPayoutAmount]&txid=[callId]&ct=phone_call`
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
      https://flarehitlog.com/cf/cv?click_id=[connectionTag:cpid]&payout=[publisherPayoutAmount]&txid=[callId]&ct=phone_call
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

## Commit Guidelines

- Keep commit messages short and descriptive (e.g., `fix form method to get`)
- Commit on `main` branch directly
