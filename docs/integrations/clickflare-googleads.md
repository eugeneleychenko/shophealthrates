# ClickFlare → Google Ads Forwarding

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../../AGENTS.md).

## ClickFlare → Google Ads forwarding — "Qualified" failing "Too short." (diagnosed 2026-06-17)

### The alert
ClickFlare "Integration Health Monitor" emailed: **"1 Integration Failure Detected — LeoSource - Qualified conversions failing to send to Google Ads / Unrecognized error from the ad platform."**

### What it is
ClickFlare forwards conversions back to Google Ads (for bid optimization) via **Integrations → Conversion API**. Three Google Ads integrations exist (ClickFlare account `174149434`, Google account "Josh Goins", Manager "Leo Source MCC", customer `8052531545`):

| Integration | ClickFlare ID | Google conversion action | Status |
|---|---|---|---|
| LeoSource - Qualified | `6a0c88929f220b001270313a` | Qualified Lead — `…/conversionActions/7616727115` | ❌ fails **"Too short."** |
| LeoSource - Call | `6a0c88591da37d00129e5412` | Call — `…/conversionActions/7616715306` | ✅ 200 |
| LeoSource - Sale | `6a0c88308280fe00135ed64c` | Sale | (untested) |

Where to look: app.clickflare.com → **Logs → Postback Status** (`…/activity?range=last_30_days&activeTab=postback-status`). Per row, **View payload** = exact Google Ads body; **View error details** = the error. (ClickFlare **Public API is 403/plan-gated**, so this is browser-only for now.)

### Root cause (evidence-backed) — NOT a token/reconnect issue
Google rejects every "Qualified" send with **`StringLengthError: "Too short."`** = a required string field is empty. The email's "reconnect/expired token" advice is a **red herring**:
- The **same visit** (Visit `6a04cfc6…`, Click `6a04cefa…`) both calls and submits a lead. The **Call** upload succeeds (200) on the same account/token; only **Qualified** fails.
- Working **Call payload** is **gclid-based**: `{gclid:"Cj0KCQjwi8nRBhD…", conversion_action:".../7616715306", conversion_value:0, consent:{adUserData:GRANTED}}` → 200. So OAuth/token/customer/gclid are healthy.
- **Qualified** = ClickFlare **base conversion (Custom Conversion Index 0)**, fired by the quiz form (`quiz.html:1249` → `cf/cv?click_id=subId`) and/or Boberdoo — it **never touches Ringba**. Failing rows show Conversion Type EMPTY, Event EMPTY; the integration's **Event Data Configuration is EMPTY**.
- ⇒ The empty field is almost certainly the **gclid**: the lead/base conversion arrives via `click_id=subId`, which isn't resolving to a gclid-bearing ClickFlare click → empty gclid uploaded → "Too short." (Phone calls carry the real gclid from the ad click, so they pass.)

### It was NOT caused by the Ringba pixel edit
Verified (3 independent agents + adjudicator, "effectively none"). The Ringba "ClickFlare Phone Call Postback" pixel writes only the **phone_call custom conversion (Index 2 → the Call integration, which works)** and shares no writable field/dedup key with the base-conversion Qualified upload. The Qualified integration was **created/last-updated "a month ago"** with an empty config and fails on **every** send (failures span Jun 12–17), so it predates the Ringba change; the Health-Monitor email is just a threshold alert firing now.

### Where to fix (in order — do NOT reconnect Google Ads, connection is fine)
1. Make the **lead/Qualified conversions carry a valid gclid** — the quiz→ClickFlare conversion must key off the real ClickFlare click (the one with the gclid), not a bare `subId` that loses it.
2. OR switch the "Qualified Lead" Google Ads action to **Enhanced Conversions for Leads** (hashed email/phone — form leads often have no gclid), then map email/phone in "LeoSource - Qualified" → Event Data Configuration (currently empty); confirm the quiz/Boberdoo data carries email/phone.
3. Use **"LeoSource - Call"** as the working reference; diff Call vs Qualified before saving anything.
4. **Open item**: confirm in Google Ads (Goals → Conversions → "Qualified Lead") whether it's gclid-based or Enhanced-Conversions-for-Leads — that decides fix #1 vs #2.

Same identifier-plumbing theme as the Ringba pixel bug (IDs dropping between hops), but an **independent** break.

