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

Hosted on **Vercel** — team `vyb` (`team_JRdKsTQV9jopaKxc8wlsdvGz`), project display name `shophealthrates` (`prj_LIvg3Gu0WLw6fhgBAivjIojFR4y9`). Note the linked `.vercel/project.json` still shows the old name `vyb-site` — same project, just renamed. Deploy with:

```bash
vercel --prod --yes --token $VERCEL_TOKEN
```

No build step — Vercel serves static files directly.

- **DNS host**: Namecheap (manages DNS for shophealthrates.com)

- **`.vercelignore`** excludes secrets/internal docs (`.env`, `*.md` incl. this file, `.github`, `screenshots/`, `api_docs/`) from public deploys. **Keep it** — without it, `AGENTS.md` (which contains API keys) and `.env` become publicly fetchable at e.g. `https://shophealthrates.com/AGENTS.md`.
- **Deployment protection is OFF** (`ssoProtection: null`, set 2026-06-03) — every `*.vercel.app` deployment URL is publicly viewable, not just the custom domain. Re-enable via `PATCH /v9/projects/<id>` with `ssoProtection` if you ever want preview URLs gated again.

## Development

No package manager, bundler, or build tools. Edit HTML/CSS/JS files directly. Preview locally by opening `index.html` in a browser or using any static file server.

## Key Technical Notes

- **Forms must use `method="get"`** — all pages are static HTML. Using `method="post"` causes HTTP 405 errors on Vercel's static hosting.
- **Quiz flow**: `index.html` → `quiz.html?zip=<value>` → `thank-you.html`
- **No framework** — vanilla HTML. jQuery 3.6.0 is still loaded on index/thank-you/privacy/term, but **quiz.html is deliberately jQuery-free** (a failed jQuery load used to brick the DOB step — do not reintroduce it there).
- **Fonts** are self-hosted in `css/` (Inter, Public Sans) via `@font-face` in `style.css`.

## Protected Tracking Codes — DO NOT MODIFY

The following tracking scripts are **critical revenue infrastructure**. Removing or altering any of them will silently break paid ad attribution, costing real money with zero visible error. They are wrapped in `<!-- TRACKING CODES — DO NOT MODIFY -->` guard comments in the HTML files.

**Never modify, move, or remove these blocks unless explicitly asked to change tracking:**

| Script | Files | Purpose |
|--------|-------|---------|
| Ringba JS (`//b-js.ringba.com/CA28ed...`) | index.html, quiz.html, thank-you.html, thank-you-v2.html | Call tracking — swaps `(800) 758-1590` with a tracked pool number |
| Microsoft Clarity (`clarity.ms/tag/x0ifuryqyz`) | index.html, quiz.html | Session recording & heatmaps |
| UTM/tracking param capture (sessionStorage) | index.html, quiz.html | Saves `gclid`, `cpid`, `wbraid`, `gbraid` from ad click URL |
| ClickFlare tag (`leosourceclick.com/cf/tags/6a0fb09a...`) | index.html, quiz.html | Ad click attribution — sets `cf_click_id` cookie |
| ClickFlare → Ringba bridge (`_rgba_tags` push) | index.html, quiz.html, thank-you.html, thank-you-v2.html | Passes ClickFlare click_id to Ringba as a connection tag |
| ClickFlare lead conversion pixel (`leosourceclick.com/cf/cv`) | quiz.html (submitLead function) | Fires on form submit to record lead conversion |
| ClickFlare phone_call pixel (`leosourceclick.com/cf/cv?ct=phone_call`) | thank-you.html, thank-you-v2.html | Fires on Connect Streams button click |
| Connect Streams lightbox (module 1966) | index.html, thank-you.html, thank-you-v2.html | "Connect Me Now" callback widget |
| Sheety lead logging (`sendBeacon('/api/log-lead')`) | quiz.html (submitLead function) | Logs every lead to Google Sheet for diagnostics |
| Sub_ID pipeline (`cf_click_id` → Boberdoo `Sub_ID`) | quiz.html (submitLead function) | Passes click_id through to Boberdoo for server-side postback |
| Phone number `+18007581590` | All pages | Static number that Ringba replaces — changing it breaks call tracking |

### Rules for the Telegram agent and all automated edits

1. **Do not rewrite `<head>` sections** — tracking scripts live there. Add new content to `<body>` instead.
2. **Do not replace entire files** — use targeted edits. Full-file rewrites silently drop tracking blocks.
3. **Do not change `tel:+18007581590`** links — Ringba's JS looks for this exact number to swap.
4. **Do not remove or rename `submitLead()`** in quiz.html — the ClickFlare pixel and Sheety beacon are inside it.
5. **If a change touches `<head>` or `submitLead`**, verify all tracking scripts are still present before committing.

## Quiz Funnel Architecture (rewritten 2026-06-12)

quiz.html was rewritten after a P0 "0 conversions" investigation (24 Clarity sessions). The reported "redirect to homepage" bug was never a redirect — root causes were a direction-blind `screenHistory.pop()` popstate handler, total progress loss on reload (volatile in-memory state + stale pushState entries → dead back presses → cross-document exit to the landing page), and a 300ms `setTimeout` inside `show()` that raced the Back gesture and made taps feel dead.

Step order (visible steps): `step-8` Gender → `step-5` Household → `step-7` Income → `step-contact` DOB → `step-10` Address+Phone → `step-11` Name+Email/submit. Steps 1/2/3/4/6 are commented-out removed questions.

### Design (do not regress)

- **State-driven history**: every `history.pushState` entry carries `{quizStep, path}`. The `popstate` handler renders `event.state` — it must never infer direction or pop an in-memory array. On load, restore priority is `history.state` (reload/tab restore) → sessionStorage `quiz_step`/`quiz_path` (fresh-navigation resume) → `?step=` param → `step-8`, then `history.replaceState` so the base entry has state.
- **In-quiz Back pushes** a new entry with the previous step's snapshot (NOT `history.back()`) so it works in resumed sessions with no quiz entries in the browser stack.
- **`show()` is synchronous** — no transition `setTimeout`. Guards: ignore same-target calls (label clicks fire twice via radio re-bubble) and a 250ms lockout against ghost double-taps.
- **Answer persistence**: radios saved as `quiz_ans_<name>` (index), fields as `quiz_fld_<id>`; restored on `DOMContentLoaded`; `clearSavedProgress()` runs on successful submit. ZIP saved as `quiz_zip` for resumed sessions. All storage access goes through `ssGet`/`ssSet`/`ssRemove` try/catch helpers — sessionStorage throws in storage-blocked browsers and previously lost the lead entirely.
- **Soft-gate validation**: Continue/submit buttons are **never hard-`disabled`** (a disabled button swallows taps with zero feedback — that was the "dead DOB button"). They carry `.btn-inactive` (grey but clickable); click handlers (`continueDob`, `continueAddress`, `submitLead`) show inline `.field-error` messages and `.input-error` field highlights. Errors clear on edit. `#leadForm` has `novalidate` so the styled errors show instead of native bubbles.
- **DOB**: day list dynamically clamps to the month/year (`rebuildDobDays`); when the clamp removes the selected day it resets to the placeholder — the browser would otherwise silently pick day "01" and submit a wrong DOB. Years run currentYear−18 to currentYear−100 (TCPA text requires 18+; flagged business-rule change). `dobValid()` requires a real, non-future calendar date.
- **Phone mask** (vanilla, document-level `input` on `.phone`): strips a leading US "1" from 11-digit input (used to truncate to a *wrong* number), caps at 10 digits, re-validates and re-persists after masking (the element-level saver runs pre-mask).
- **`submitLead`**: re-validates DOB/address/phone first and routes the user back to the gap (deep links / restore can land on step-11 with earlier steps empty); main body in try/catch with the thank-you redirect OUTSIDE it (never strand "Submitting..."); Boberdoo fetch uses `keepalive: true`. A `pageshow` handler re-validates buttons (browser form-restore fills fields without `change` events) and un-sticks "Submitting..." after bfcache swipe-back from thank-you.
- **Boberdoo payload contract** unchanged: same keys, DOB `MM/DD/YYYY` zero-padded, Household_Size index mapping, income radio values.

### Diagnosing Clarity reports for this funnel

- "Entered text" events on radio-only steps are **instrumentation noise**: radios fire spec-mandated `input` events that Clarity surfaces as text entry. Not a bug signal.
- "Resized page" before an exit is keyboard/URL-bar viewport churn that co-occurs with back gestures — correlation, not cause.
- Back-gesture exits (edge swipe) record **no tap** in Clarity playback, so they look like "silent redirects".
- Jun 10 2026 03:25–04:20 UTC shipped several broken intermediate builds under live traffic — Clarity sessions from that window show bugs that no longer exist.
- Conversion counting: the Sheety log (`/api/log-lead`) is the reliable lead record; the ClickFlare cv pixel is subId-gated (undercounts organic). The Jun 11 0-conversion cliff did not align with any deploy — suspect traffic-side (Google Ads) before suspecting code.

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

This project is configured for remote management via [claude.ai/code](https://claude.ai/code). No local machine required — works from phone or any browser.

### How It Was Set Up

1. **GitHub App authorized** — the Claude GitHub App was authorized for `eugeneleychenko/shophealthrates` at [claude.ai/code](https://claude.ai/code). This gives cloud sessions read/write access to the repo (clone, push, create PRs).

2. **Cloud environment configured** — "Default Cloud Environment" with:
   - **Network access**: Trusted (allows npm registry, GitHub, Vercel, etc.)
   - **Environment variable**: `VERCEL_TOKEN` — a Vercel Access Token scoped to the **VYB** team (created at `vercel.com/account/tokens`, no expiration). This lets Claude deploy without interactive login.
   - **Setup script**:
     ```bash
     #!/bin/bash
     npm install
     npm i -g vercel
     ```
     This pre-installs the Vercel CLI so it's available immediately in every new session. The setup script output is cached by Anthropic — it only re-runs when the script changes or the cache expires (~7 days).

3. **AGENTS.md in the repo** — Claude Code reads this file automatically when it clones the repo, giving it full context about the project structure, deployment process, integrations (Boberdoo, ClickFlare, Ringba, Connect Streams), and coding conventions.

### Environment Details

| Setting | Value |
|---------|-------|
| Cloud environment | Default Cloud Environment |
| Repo | `eugeneleychenko/shophealthrates` (main branch) |
| Network access | Trusted |
| Env var | `VERCEL_TOKEN` (VYB-scoped, no expiration) |
| Setup script | `npm install && npm i -g vercel` |
| Model | Opus 4.8 (configurable per session) |

### Workflow

1. Client sends request in Telegram (text, screenshots, Clarity links)
2. Open [claude.ai/code](https://claude.ai/code) on phone or browser
3. Select `shophealthrates` repo and paste the request (include screenshots if the client sent any — Claude Code web supports image attachments)
4. Claude edits files, commits, pushes to GitHub, and deploys with `vercel --prod --yes --token $VERCEL_TOKEN`
5. Verify the change on shophealthrates.com, then confirm back in Telegram

### Maintaining the Setup

- **Vercel token expired/revoked?** Create a new one at `vercel.com/account/tokens` scoped to **VYB**, then update the environment variable in Claude Code web (click the cloud environment icon → edit → update `VERCEL_TOKEN`).
- **Need to change the setup script?** Same flow — click the cloud environment icon → edit → update the script. The cached environment rebuilds on next session.
- **New integrations or project context?** Update this AGENTS.md file — Claude reads it at the start of every session.

### Common Tasks

```
# Deploy to production
vercel --prod --yes --token $VERCEL_TOKEN

# Install Vercel CLI (if not in setup script)
npm i -g vercel
```

## Telegram → Code → Deploy Agent (LIVE — built 2026-06-03)

The client (Mikhail) requests site changes directly in the **"Leosource/ Integrations"** Telegram group and they ship to production automatically — no laptop, no VPS, no human relay.

### Flow

```
/change <request> in the group (text + optional screenshot)
  → api/telegram.js          (Vercel serverless webhook — verifies sender, fires dispatch)
  → GitHub repository_dispatch (type: telegram-change-request)
  → .github/workflows/telegram-agent.yml (GitHub Actions)
  → claude-code-action        (reads request + screenshot, edits site, commits to main, pushes)
  → vercel --prod             (deploys)
  → bot replies in the group: "✅ Done — <change> is live on shophealthrates.com"
```

### Triggering

Address the bot explicitly (normal group chatter is ignored):
- `/change <edit>` — make a code change + deploy. e.g. `/change make the hero subheadline say "Save Big on Health Insurance"`
- `/ask <question>` — answer a question about the site/repo (reads code + git history); **no edit, no deploy**. e.g. `/ask where did we add quiz links today?`
- `@leosource_bot <text>` — "auto": the agent decides from the message whether it's a question or a change.
- `/ringba` (or `/mfa`) — returns the current Ringba 6-digit MFA (TOTP) code. Handled locally in `api/telegram.js` (no GitHub Actions, no deploy) — instant reply like `🔐 Ringba MFA: 123456 (valid ~14s)`.
- Attach a screenshot to the same message; the agent reads it as an image (red marks usually flag the target element).
- If a change request is too ambiguous, the bot replies with a clarifying question instead of guessing.

The webhook passes a `mode` hint (`change`/`ask`/`auto`); the workflow classifies question vs. change and, for `ask`, answers via `_agent_inbox/REPLY.txt` and never pushes.

### Key facts

| Thing | Value |
|-------|-------|
| Bot | **@leosource_bot** (privacy mode OFF → reads all group messages) |
| Group | "Leosource/ Integrations", chat id **`-5101729997`** |
| Webhook | `https://shophealthrates.com/api/telegram` |
| Webhook code | `api/telegram.js` (thin relay only — no editing logic lives here) |
| Workflow | `.github/workflows/telegram-agent.yml` |
| Triggers | `repository_dispatch` (`telegram-change-request`) + `workflow_dispatch` (manual) |
| GitHub Actions secrets | `TELEGRAM_BOT_TOKEN`, `VERCEL_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` |
| Vercel env (Production) | `TELEGRAM_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `GITHUB_TOKEN`, `ALLOWED_CHAT_IDS`, `SHEETY_URL`, `RINGBA_TOTP_SECRET` |
| Webhook's `GITHUB_TOKEN` | fine-grained PAT on `shophealthrates`, **Contents: Read & write** |
| Compute cost | runs on the Claude subscription via `CLAUDE_CODE_OAUTH_TOKEN` (not metered API billing) |

### Manual test (no Telegram, no group spam)

```bash
gh workflow run telegram-agent.yml --repo eugeneleychenko/shophealthrates \
  -f request='your change request here'
gh run watch "$(gh run list --workflow=telegram-agent.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Omit `chat_id` and the workflow skips the Telegram reply (echoes instead), so a dry-run won't post in the client group. It still commits + deploys a real change, so revert test edits afterward.

### Gotchas (already fixed in the workflow — do not regress)

- Job needs `permissions: id-token: write` — `claude-code-action` fetches an OIDC token; `contents: write` alone fails with "Could not fetch an OIDC token".
- The push step authenticates via `https://x-access-token:${GITHUB_TOKEN}@github.com/...`; a bare `git push` fails with "password authentication is not supported".
- `repository_dispatch`/`workflow_dispatch` only run from the **default branch** — the workflow file must stay on `main`.
- The webhook's PAT must have **Contents: write**, else the dispatch returns `403 "Resource not accessible by personal access token"`.

### Security

- Only the group (chat `-5101729997`) can trigger changes (allowlist), and every webhook call must carry the `TELEGRAM_SECRET` header.
- Every change is a git commit by `claude[bot]` → undo with `git revert <sha>`.
- **Rotate when convenient**: the bot token, Claude OAuth token, and PAT were pasted into a setup chat; the Boberdoo key in this file may have been publicly served on pre-`.vercelignore` deploys.

Full setup/runbook: **`TELEGRAM-AGENT-SETUP.md`**.

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
| ClickFlare | ⚠️ Public API exists | Key generates at Settings → Security, but our account returns **HTTP 403 "PublicApi access forbidden"** — Public API is a plan/permission gate, not enabled for us yet. Key auths (not 401) but lacks the grant. |
| Ringba | ✅ Long-lived API token | Generated at `app.ringba.com` → Security → API Access Tokens (MFA only at creation, never expires). Header `Authorization: Token <t>`. **In use by `/check`'s fast path.** |

---

## Ringba MFA via Telegram (`/ringba`) — built 2026-06-17

### Overview

Ringba login requires a TOTP MFA code (authenticator-app style). Instead of opening an authenticator app, send `/ringba` (or `/mfa`) in the Telegram group and the bot replies with the current 6-digit code.

### How it works

TOTP codes are a deterministic function of `(secret seed + current time)` — RFC 6238 (HMAC-SHA1, 6 digits, 30s step). With the original base32 seed from the authenticator QR, any code-gen produces the same code Ringba expects. No browser, no 1Password at runtime, no Ringba login automation — this only **generates the code**.

```
/ringba (or /mfa) in the group
  → api/telegram.js (handled locally — like /diagnose, no GitHub Actions)
  → getRingbaMfa(process.env.RINGBA_TOTP_SECRET)  [pure Node crypto, zero deps]
  → bot replies: 🔐 Ringba MFA: 123456 (valid ~14s)
```

### Components

| File | Detail |
|------|--------|
| `api/telegram.js` | `/^\/(ringba\|mfa)\b/` handler → `handleRingbaMfa()` → `getRingbaMfa()` (base32 decode + HMAC-SHA1 TOTP, Node built-in `crypto`, no dependency) |

### Setup

The seed lives **only** in a Vercel env var — never committed to the repo or this file:

```bash
vercel env add RINGBA_TOTP_SECRET production
# paste the base32 secret from the authenticator otpauth:// URI (the secret= value)
```

The `otpauth://` URI has the form `otpauth://totp/<account>?secret=<BASE32>&issuer=Ringba` — only the `secret=` portion is needed. Get it from 1Password (TOTP field) or the original QR setup.

### Security

- The seed grants **permanent** ability to mint Ringba MFA codes. Treat it like a password.
- Stored as a Vercel env var only; `.vercelignore` keeps `.md`/`.env` out of public deploys but **do not** add the seed to either anyway.
- If the seed leaks, regenerate MFA in Ringba (`app.ringba.com` → security settings) to rotate it, then update `RINGBA_TOTP_SECRET`.

### Note

This delivers the **code on demand** — it does not log into Ringba by itself (that would need Playwright to fill username/password + this code). It powers the **browser fallback** in `/check`. The primary `/check` path no longer needs it: Ringba now has a long-lived API token (see updated API Access Gaps table above), so the fast path skips login + TOTP entirely.

---

## Call-conversion check via Telegram (`/check`) — built 2026-06-17

### Overview

Ask the bot whether a phone-call conversion actually landed across our systems. Send `/check` (or `/call`, or just @mention a question like "did the conversion occur today?" / "check the call today") and a cloud agent verifies today's call(s) end-to-end and replies in the group.

### Flow (fast path — official APIs, ~1s, no browser; built 2026-06-17)

```
/check  (or @leosource_bot "did the conversion occur today?")
  → api/telegram.js: isCallConversionQuestion()/`/check` → handleCallCheck()
    → repository_dispatch event_type "telegram-call-check"  (NOT the code-change workflow)
  → .github/workflows/telegram-call-check.yml  (READ-ONLY — never edits/pushes/deploys)
    → STEP 1 (fast): node scripts/call-check-api.mjs
        Ringba REST API (Authorization: Token $RINGBA_API_TOKEN) — NO login, NO 2FA:
          POST /v2/{acct}/calllogs        → today's calls (connected/duration/duplicate)
          POST /v2/{acct}/calllogs/detail → per-call events[] + message-tags[]:
            • the PixelFire event => httpStatusCode (200?), failReason, AND the literal
              fired URL (recordingUrl) — so we read the click_id/txid/payout ACTUALLY sent
            • hasConverted / ConvertedCall event
            • cpid tag (type "ClickFlare ID") vs the clickid tag
        ClickFlare REST API (optional cross-check, header api-key: $CLICKFLARE_API_KEY):
          POST /api/event-logs filtered EventType=conversion AND ClickID=<sent click_id>
          → currently returns HTTP 403 (Public API not enabled for our plan) → degrades
            gracefully; verdict relies on Ringba's pixel-fire 200 + payload.
        → writes verdict to _agent_inbox/REPLY.txt, exit 0.
    → STEP 2 (browser fallback): runs ONLY if step 1 wrote no REPLY.txt
        (e.g. tokens unset or API shape drift). Installs agent-browser, resolves
        RINGBA_TOTP_SECRET, drives the old headless Ringba+ClickFlare scrape.
    → _agent_inbox/REPLY.txt → posted to the group.
```

Each fallback step is gated with `if: hashFiles('_agent_inbox/REPLY.txt') == ''`, so the heavy Chrome/TOTP machinery is skipped whenever the fast path succeeds.

### Components

| File | Detail |
|------|--------|
| `api/telegram.js` | `/^\/(check\|call\|conversion)\b/` + `isCallConversionQuestion()` → `handleCallCheck()` → dispatch `telegram-call-check`. Lead-FORM questions still route to `/diagnose` (Sheety); a `call to action`/`cta` mention is excluded so copy-change requests don't mis-route. |
| `scripts/call-check-api.mjs` | **Fast path.** Node 18+, no deps. Reads `RINGBA_API_TOKEN` (+ optional `RINGBA_ACCOUNT_ID`, `CLICKFLARE_API_KEY`). Resolves "today" in America/New_York → UTC for Ringba; ET string + `timezone` for ClickFlare. On success writes `_agent_inbox/REPLY.txt` + exit 0; on missing token / network / shape error writes nothing + exits non-zero → triggers fallback. `DEBUG=1` dumps shapes; `LOOKBACK_DAYS=N` widens the window for testing. |
| `.github/workflows/telegram-call-check.yml` | Cloud check. `permissions: contents: read`. Step 1 fast API check (`continue-on-error`), gated browser fallback, reply step unchanged. |
| `scripts/ringba-totp.js` | TOTP generator for the **fallback** 2FA only. `.vercelignore`d. |

### Secrets (GitHub Actions)

Fast path: **`RINGBA_API_TOKEN`** (required), `RINGBA_ACCOUNT_ID` (optional — `RA7a01677bfe7a4ed59ad998a84bfcef13`, else auto-resolved), `CLICKFLARE_API_KEY` (optional cross-check). Fallback (kept until the fast path is proven over a week, then deletable): `RINGBA_USERNAME`, `RINGBA_PASSWORD`, `CLICKFLARE_USERNAME`, `CLICKFLARE_PASSWORD`, `RINGBA_TOTP_SECRET` (or pulled from Vercel via `VERCEL_TOKEN`). `CLAUDE_CODE_OAUTH_TOKEN` + `TELEGRAM_BOT_TOKEN` already exist.

> ⚠️ The two API tokens bypass MFA and (Ringba) never expire — treat as high-value secrets: repo-scoped (not org), no `pull_request_target`, rotate on a calendar.

### Live findings from the API (validated 2026-06-17) — REAL BUGS to fix in Ringba

Running the fast path against today's calls surfaced that **every** "ClickFlare Phone Call Postback" pixel fires **HTTP 200** but with a broken payload:

- **`txid=` is EMPTY** on all calls — the `txid=[Call:InboundCallId]` mapping is NOT resolving. (This was the exact thing `/check` was built to confirm; it is currently failing.)
- **`payout=` is EMPTY** — `[publisherPayoutAmount]` not resolving (separate from the by-design $0 revenue).
- **`click_id=` is the Google `clickid` tag (a UUID), NOT the ClickFlare `cpid`** (type "ClickFlare ID", e.g. `6a04cfc67e76d10012a65767`). ClickFlare needs its own click id to attribute — so conversions likely aren't matching. Some calls send `click_id=` empty entirely.

→ Fix is in the **Ringba pixel config** (U65 campaign → ClickFlare Phone Call Postback pixel URL): the token references for `click_id`, `txid`, `payout` are wrong/unresolved. Verify against `[connectionTag:cpid]`, `[Call:InboundCallId]`, `[publisherPayoutAmount]`. The fired URL the API returns is the ground truth for what's actually being sent.

### Notes / risks

- The fast path is read-only REST — no credentials printed, no browser, ~1s vs minutes; eliminates the datacenter-IP-login-block risk for the normal case.
- ClickFlare's Public API is **plan-gated** (HTTP 403 today). To get destination-side conversion confirmation, enable Public API access on the ClickFlare plan/role, then `CLICKFLARE_API_KEY` cross-check activates automatically. Until then, Ringba's pixel-fire 200 + the parsed payload is the proof.
- The script uses defensive, case-insensitive field lookup and exits non-zero on any unexpected shape, so vendor schema drift falls back to the browser rather than emitting a wrong verdict.

---

## Commit Guidelines

- Keep commit messages short and descriptive (e.g., `fix form method to get`)
- Commit on `main` branch directly
