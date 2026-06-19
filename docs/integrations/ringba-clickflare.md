# Ringba ↔ ClickFlare Integration (Phone Calls — U65)

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../../AGENTS.md).

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

