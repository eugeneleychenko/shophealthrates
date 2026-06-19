# Call-Conversion Check (/check)

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../AGENTS.md).

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
| `scripts/clickflare-api.mjs` | ClickFlare **internal-API** client (no paid tier): login → `jwt` header → `eventLogs`/`postbackStatus`. The fast path imports `eventLogs` for the destination-side cross-check. Also a CLI: `node scripts/clickflare-api.mjs conversions\|postbacks [YYYY-MM-DD]`. |
| `scripts/ringba-totp.js` | TOTP generator for the **fallback** 2FA only. `.vercelignore`d. |

### Secrets (GitHub Actions)

Fast path: **`RINGBA_API_TOKEN`** (required), `RINGBA_ACCOUNT_ID` (optional — `RA7a01677bfe7a4ed59ad998a84bfcef13`, else auto-resolved), **`CLICKFLARE_USERNAME` / `CLICKFLARE_PASSWORD`** (optional cross-check via the internal API — no paid tier, no MFA), `CLICKFLARE_ORG_ID` (optional, default `174149434`). Fallback (kept until the fast path is proven over a week, then deletable): `RINGBA_USERNAME`, `RINGBA_PASSWORD`, `RINGBA_TOTP_SECRET` (or pulled from Vercel via `VERCEL_TOKEN`). `CLAUDE_CODE_OAUTH_TOKEN` + `TELEGRAM_BOT_TOKEN` already exist. (`CLICKFLARE_API_KEY` for the Public API is unused — that tier 403s.)

> ⚠️ The two API tokens bypass MFA and (Ringba) never expire — treat as high-value secrets: repo-scoped (not org), no `pull_request_target`, rotate on a calendar.

### Live findings from the API (validated 2026-06-17, **corrected**)

The phone-call conversion pipeline is **largely healthy** — connected calls DO register end-to-end (Ringba pixel 200 → ClickFlare conversion matched → Google Ads "Call" upload 200). An earlier reading of this was wrong; the corrected picture:

- ✅ **click_id is CORRECT.** The pixel sends `click_id=<the "clickid" connection tag>`, a UUID like `309b4d01-…` — and that **is** ClickFlare's actual `ClickID`; ClickFlare matches on it (verified: conversions exist under those click_ids). **`cpid` is NOT a click id** — it equals ClickFlare's `CampaignID` (e.g. `6a04cfc67e76d10012a65767`). So `click_id ≠ cpid` is EXPECTED, not a bug. Do not "fix" the pixel to send cpid.
- ⚠️ **`txid` was empty on older/morning calls** (`[Call:InboundCallId]` not resolving) but appears **populated on afternoon calls** (e.g. txid `…V3QP301`/`…V3CSC01` carrying the Ringba callId) — looks like the txid mapping was fixed midday 6/17. Empty txid is a traceability gap, not a "didn't register."
- ⚠️ **Duplicate calls leak a conversion.** A short re-dial (e.g. 2s, Ringba `isDuplicate=true`, `hasConverted=false`) still fires the pixel on connect, so ClickFlare + Google Ads record an extra conversion Ringba doesn't count → ClickFlare/GAds can show MORE conversions than Ringba.
- `payout=` empty is fine (U65 targets pay $0 by design).

The **separate** broken thing is the **lead/Qualified → Google Ads** path ("Too short./empty gclid") — see the ClickFlare→Google Ads section above. That is NOT the phone-call path.

### Notes / risks

- The fast path is read-only REST — no credentials printed, no browser, ~1s vs minutes; eliminates the datacenter-IP-login-block risk for the normal case.
- ClickFlare cross-check now uses the **internal API** (`scripts/clickflare-api.mjs`) since the Public API tier 403s — so `/check` confirms the conversion landed in ClickFlare (matched `click_id`, `txid`) with no paid tier. The internal API is undocumented and can change; if it starts 4xx-ing, re-capture (`.b2a/`) and re-check field names. Degrades to Ringba's pixel-fire 200 if creds/login fail.
- The script uses defensive, case-insensitive field lookup and exits non-zero on any unexpected shape, so vendor schema drift falls back to the browser rather than emitting a wrong verdict.

### How the ClickFlare internal API was discovered (browser-to-api, 2026-06-17)

Since the Public API tier is out, we reverse-engineered the dashboard's own API with the browserbase **`browser-to-api`** skill:
1. `.b2a/cdp-capture.mjs` — a zero-dep CDP tap attaches to the agent-browser Chrome and records `requests/responses/bodies` in the skill's input format while a logged-in session navigates Event Logs + Postback Status.
2. `.b2a/skill/scripts/discover.mjs --run .b2a/run` → OpenAPI spec + `client.mjs` + report (saved under `.b2a/run/api-spec/` (git-ignored, regenerable)).
3. Key endpoints: `POST api.clickflare.io/api/event-logs` (conversions), `POST .../api/postback-status/logs` (Conversion-API send results incl. Google Ads errors), `GET .../api/integration`. Re-run the capture to refresh if the API drifts.

### Answering "are these calls registered as conversions?" — reply format (agreed 2026-06-17)

There is **no single "conversion"** — a phone call passes a 5-hop chain, and the answer differs at each hop. Always report the chain, never one ✅/❌:

```
① Ringba converted ─▶ ② Pixel fired ─▶ ③ Payload valid ─▶ ④ ClickFlare recorded ─▶ ⑤ Google Ads uploaded
   (connected ≥120s)    (HTTP 200)        (right click_id)     (phone_call conv)        (CF→GAds "Call" 200)
```

Agreed scope:
- **Identifier = time window** ("the 3 calls ~2pm"), not last-4/callId. (Filter Ringba calls by `callDt`.)
- **"Conversion" = full chain** — must land in ClickFlare **and** upload to Google Ads. Anything short of ⑤ is *not* a confirmed conversion.

Output shape: **verdict line → scannable table (one row per call, columns ①–⑤) → a trace block only for calls with a problem**, each hop printing the **actual ID** so it's traceable to the source dashboard.

```
"the 3 calls ~2pm" · today (ET) · window 1:45–2:15 PM
Verdict (full-chain): ⚠️ 0 of 3 confirmed end-to-end.

  time     caller            ①Ring ②Pix ③Pay ④CF  ⑤GAds
  1:52 PM  (346) 449-7767     ✅    ✅   ❌   ❌   — n/a

📞 1:52 PM · (346) 449-7767 · InboundCallId abc123
   ① Ringba      ✅ connected 168s → Converted · payout $0 (by design)
   ② Pixel       ✅ HTTP 200 → leosourceclick.com/cf/cv?…&ct=phone_call
   ③ Payload     ❌ click_id=<google-uuid> (expected cpid 6a04cfc…5767) · txid=∅ · payout=∅
   ④ ClickFlare  ❌ no phone_call conversion for that click_id (internal API)
   ⑤ Google Ads  — not checked yet
   ↳ Break at ③→④. Fix: U65 pixel tokens [connectionTag:cpid]/[Call:InboundCallId]/[publisherPayoutAmount].
```

Rules: first ❌ left-to-right is the **break point**; clean calls stay one table row; `$0` payout is **by design** (U65 targets pay $0) — never flag it; a hop we didn't check prints `—`, **never a fake ✅**.

**Two gaps vs. this spec** (in `scripts/call-check-api.mjs` as of `0ae9aa3`, which confirms hops ①–④):
1. **Time-window filter not implemented** — only phone-digit filter or all-of-today; needs to parse a time range and filter calls by `callDt`.
2. **Hop ⑤ (Google Ads) not wired** — `postbackStatus()` exists in `clickflare-api.mjs` but is never called. To confirm: after a ClickFlare match, `postbackStatus({date})` filtered to `ClickID === sent click_id` **and** `IntegrationID === 6a0c88591da37d00129e5412` (LeoSource-Call), then report `IsError`/`StatusCode`. Until wired, the full-chain verdict tops out at "landed in ClickFlare" and ⑤ stays unverified.

---

