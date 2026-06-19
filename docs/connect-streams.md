# Connect Streams Lightbox

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../AGENTS.md).

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

