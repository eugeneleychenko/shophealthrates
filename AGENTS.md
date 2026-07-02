# Repository Guidelines

Static marketing site for **LeoSource Insurance Agency** (shophealthrates.com) — plain HTML/CSS/jQuery, deployed to Vercel.

> Deep runbooks (integrations, funnel internals, automation) live in [`docs/`](docs/) and are linked from **[Further Documentation](#further-documentation)**. This file holds only what an agent must always have in context. `docs/` and this file are `*.md`, excluded from public deploys by `.vercelignore` — so the inline API keys below stay private.

## Tech Stack

- **HTML / CSS / vanilla JS** — static marketing site, no framework, no bundler, no package manager.
- **jQuery 3.6.0** — loaded on `index` / `thank-you` / `privacy` / `term` only. **`quiz.html` is deliberately jQuery-free** (a failed jQuery load once bricked the DOB step — do not reintroduce it there).
- **Vercel** — static hosting + serverless functions under `api/*.js` (Node). No build step; files are served directly.
- **Self-hosted fonts** — Inter & Public Sans (`@font-face` in `css/style.css`).

## Common Commands

```bash
# Deploy to production (no build step)
vercel --prod --yes --token $VERCEL_TOKEN

# Local preview — just open the file, or any static server
open index.html            # or: python3 -m http.server

# Manually run the Telegram change agent without spamming the group (dry-run, still commits+deploys)
gh workflow run telegram-agent.yml --repo eugeneleychenko/shophealthrates -f request='your change request'
```

There is no linter, test runner, or build tool.

## Pre-Commit Verification

The required check is **tracking-code integrity** (no automated tests exist). Before committing any change that touches a `<head>` or `submitLead()`:

- Confirm every script in **[Protected Tracking Codes](#protected-tracking-codes--do-not-modify)** is still present and unmodified.
- Confirm all forms still use `method="get"` — `method="post"` causes HTTP 405 on Vercel static hosting.
- Confirm `tel:+18007581590` is unchanged — Ringba's JS swaps this exact number.

Never commit code that drops a tracking block.

## File Organization

```
├── index.html              # Homepage with zip-code quote form
├── quiz.html               # Multi-step insurance assessment wizard (jQuery-free)
├── thank-you.html          # Post-submission confirmation (Connect Streams lightbox)
├── thank-you-v2.html       # Alternate confirmation page
├── privacy.html · term.html
├── css/                    # style.css, quiz.css, + self-hosted Inter/Public Sans fonts
├── js/                     # jquery-3.6.0.min.js, bookmarkscroll.js
├── images/                 # webp/png/svg assets
├── api/                    # Vercel serverless functions
│   ├── telegram.js         # Telegram webhook: /help /change /ask /ringba /diagnose /check /sales /lookup /investigate /keywords; @mention questions → investigate-by-default (see Telegram Bot Commands)
│   ├── log-lead.js         # Logs each lead to Google Sheet (Sheety) + missing-click_id alert
│   ├── enrollment.js       # Sale/enrollment intake (Convoso webhook et al.): resolves truncated Sub_ID/email → full click_id, dedupes, logs event=enrollment + Telegram ping; ClickFlare ct=sale fire behind ENROLL_FIRE_CF
│   └── daily-summary.js    # 9am ET cron: daily lead summary + ClickFlare health check
├── scripts/                # call-check-api.mjs, clickflare-api.mjs, sales-report.mjs, lookup.mjs, ringba-totp.js (not deployed)
├── api_docs/               # Vendor API notes (not deployed)
├── docs/                   # Extracted runbooks (see Further Documentation) + agent-eval.md (not deployed)
├── .github/workflows/      # telegram-agent.yml, telegram-call-check.yml, telegram-investigate.yml, telegram-sales.yml
├── vercel.json             # Cron schedule
└── .vercelignore           # Keeps secrets/*.md/scripts out of public deploys — KEEP IT
```

## Key Technical Notes

- **Forms must use `method="get"`** — every page is static HTML; POST returns HTTP 405 on Vercel.
- **Quiz flow**: `index.html` → `quiz.html?zip=<value>` → `thank-you.html`.
- **No framework** — vanilla HTML/JS. jQuery loads on index/thank-you/privacy/term, but **never on `quiz.html`**.
- **Fonts** are self-hosted in `css/` via `@font-face` in `style.css`.

## Telegram Bot Commands

The bot is `@leosource_bot` in the "Leosource/ Integrations" group; the webhook is `api/telegram.js` (Vercel). **Free-form @mention questions go to the investigate-by-default LLM agent** (`telegram-investigate.yml`), which queries the live systems (Boberdoo · ClickFlare · Sheety · Ringba) and answers; the slash commands below are deterministic shortcuts. **`/help` prints this list in-chat** (keep `handleHelp()` in `telegram.js` in sync with this table).

| Command (aliases) | What it does | Where it runs |
|---|---|---|
| `/help` | List all commands | local (telegram.js) |
| `/sales [today·week·30d·date]` | Sold count + ClickFlare revenue for a window; add "which clients" for the per-buyer roster | telegram-sales.yml → sales-report.mjs |
| `/keywords [window]` (`/ads`) | Top keywords & campaigns by sales — per keyword & campaign_id: leads · sold · **% share of sales**. Sell-through is ~100% (almost all leads match), so the % is share, not rate. Fields exist only on leads from 2026-06-29+; wide windows are a partial live Boberdoo scan | telegram-investigate.yml mode=ad → ad-report.mjs |
| `/lookup <ids·email>` | Per-id verdict — is this click_id/Sub_ID/email matched ($50) or not | telegram-investigate.yml mode=lookup → lookup.mjs |
| `/investigate <q>` (`/data`) | Force the LLM data investigator | telegram-investigate.yml mode=llm |
| `/reconcile` (`/gap`) | Categorized Boberdoo↔ClickFlare count-gap verdict | telegram-reconcile.yml → lead-reconcile-report.mjs |
| `/check [phone]` (`/call`, `/conversion`) | Verify a phone-call conversion end-to-end (Ringba + ClickFlare) | telegram-call-check.yml → call-check-api.mjs |
| `/diagnose [recent·health·<search>]` | Sheety lead log: recent leads / postback health / search | local (telegram.js) |
| `/ringba` (`/mfa`) | Current Ringba 2FA (TOTP) code | local (telegram.js) |
| `/change <edit>` | Edit the website + commit + deploy | telegram-agent.yml |
| `/ask <q>` (`/q`) | Answer a question about the site/code (no change) | telegram-agent.yml |
| `@mention <question>` | Investigate-by-default — LLM queries the live systems and answers | telegram-investigate.yml |
| `stop` / `cancel` | Cancel a running `/change` | local (telegram.js) |

## Protected Tracking Codes — DO NOT MODIFY

The following tracking scripts are **critical revenue infrastructure**. Removing or altering any of them silently breaks paid-ad attribution — real money lost, zero visible error. They are wrapped in `<!-- TRACKING CODES — DO NOT MODIFY -->` guard comments in the HTML.

**Never modify, move, or remove these blocks unless explicitly asked to change tracking:**

| Script | Files | Purpose |
|--------|-------|---------|
| Ringba JS (`//b-js.ringba.com/CA28ed...`) | index, quiz, thank-you, thank-you-v2 | Call tracking — swaps `(800) 758-1590` with a tracked pool number |
| Microsoft Clarity (`clarity.ms/tag/x0ifuryqyz`) | index, quiz | Session recording & heatmaps |
| UTM/tracking param capture (sessionStorage) | index, quiz | Saves `gclid`, `cpid`, `wbraid`, `gbraid` from ad-click URL |
| ClickFlare tag (`leosourceclick.com/cf/tags/6a0fb09a...`) | index, quiz | Ad-click attribution — sets `cf_click_id` cookie |
| ClickFlare → Ringba bridge (`_rgba_tags` push) | index, quiz, thank-you, thank-you-v2 | Passes ClickFlare click_id to Ringba as a connection tag |
| ClickFlare lead conversion pixel (`leosourceclick.com/cf/cv`) | quiz (submitLead) | Fires on form submit to record lead conversion |
| ClickFlare phone_call pixel (`leosourceclick.com/cf/cv?ct=phone_call`) | thank-you, thank-you-v2 | Fires on Connect Streams button click |
| Connect Streams lightbox (module 1966) | index, thank-you, thank-you-v2 | "Connect Me Now" callback widget |
| Sheety lead logging (`sendBeacon('/api/log-lead')`) | quiz (submitLead) | Logs every lead to Google Sheet for diagnostics |
| Sub_ID pipeline (`cf_click_id` → Boberdoo `Sub_ID`) | quiz (submitLead) | Passes click_id through to Boberdoo for server-side postback |
| Phone number `+18007581590` | All pages | Static number that Ringba replaces — changing it breaks call tracking |

### Rules for the Telegram agent and all automated edits

1. **Do not rewrite `<head>` sections** — tracking scripts live there. Add new content to `<body>` instead.
2. **Do not replace entire files** — use targeted edits. Full-file rewrites silently drop tracking blocks.
3. **Do not change `tel:+18007581590`** links — Ringba's JS looks for this exact number to swap.
4. **Do not remove or rename `submitLead()`** in quiz.html — the ClickFlare pixel and Sheety beacon are inside it.
5. **If a change touches `<head>` or `submitLead`**, verify all tracking scripts are still present before committing.

## Quiz Funnel — Do Not Regress

`quiz.html` was rewritten 2026-06-12 after a P0 "0 conversions" investigation. Visible step order: `step-8` Gender → `step-5` Household → `step-7` Income → `step-contact` DOB → `step-10` Address+Phone → `step-11` Name+Email/submit. Keep these invariants — **full rationale in [docs/quiz-funnel.md](docs/quiz-funnel.md)**:

- **State-driven history**: every `pushState` carries `{quizStep, path}`; the `popstate` handler renders `event.state` — never infers direction or pops an in-memory array. In-quiz Back **pushes** the previous step's snapshot (not `history.back()`).
- **`show()` is synchronous** — no transition `setTimeout` (it raced the Back gesture and made taps feel dead).
- **Soft-gate validation**: Continue/submit buttons are never hard-`disabled` (a disabled button swallowed the "dead DOB" tap). They use `.btn-inactive` + inline `.field-error`; `#leadForm` has `novalidate`.
- **Storage** goes through `ssGet`/`ssSet`/`ssRemove` try/catch helpers (sessionStorage throws in storage-blocked browsers); `clearSavedProgress()` runs only on successful submit.
- **DOB** clamps days to month/year, resets to placeholder when the selected day is removed, requires a real non-future 18+ date.
- **`submitLead`** re-validates DOB/address/phone and routes back to the gap; thank-you redirect lives **outside** the try/catch; Boberdoo fetch uses `keepalive: true`. Boberdoo payload contract unchanged (DOB `MM/DD/YYYY`, Household_Size index mapping, income radio values).

## Coding Style

- HTML: 4-space indentation, kebab-case CSS classes (e.g. `banner_form_box_inner`).
- CSS: organized by page section, mobile breakpoints via `@media`.
- No linter or formatter configured.

## Deployment

Hosted on **Vercel** — team `vyb` (`team_JRdKsTQV9jopaKxc8wlsdvGz`), project `shophealthrates` (`prj_LIvg3Gu0WLw6fhgBAivjIojFR4y9`). The linked `.vercel/project.json` still shows the old name `vyb-site` — same project, renamed. DNS is managed by **Namecheap**.

```bash
vercel --prod --yes --token $VERCEL_TOKEN
```

- **`.vercelignore` — KEEP IT.** It excludes `.env`, `.git`, `.github`, `*.md` (incl. this file and `docs/`), `scripts/`, `api_docs/`, `screenshots/`, `_agent_inbox/`, `.b2a/`. Without it, `AGENTS.md` (which holds API keys) and `.env` become publicly fetchable at e.g. `https://shophealthrates.com/AGENTS.md`.
- **Deployment protection is OFF** (`ssoProtection: null`, set 2026-06-03) — every `*.vercel.app` deployment URL is publicly viewable. Re-enable via `PATCH /v9/projects/<id>` with `ssoProtection` if you want preview URLs gated again.

## Gotchas

- **Connect Streams lightbox only appears during business hours** (M-F 9:30am–6:30pm ET) and only on thank-you pages with a `?phone=` param. If the client reports it missing, **check the time first**. See [docs/connect-streams.md](docs/connect-streams.md).
- **`repository_dispatch` / `workflow_dispatch` only run from `main`** — the Telegram workflow files must stay on the default branch.
- **Boberdoo blocks some webhook hosts** in its UI; the Admin API is **IP-whitelisted to `209.122.209.0/24`** (won't work from arbitrary CLIs). See [docs/integrations/boberdoo-clickflare.md](docs/integrations/boberdoo-clickflare.md).
- **`click_id ≠ cpid` is EXPECTED**, not a bug — `cpid` is ClickFlare's CampaignID, not a click id. See [docs/call-check.md](docs/call-check.md).

## Further Documentation

Operational runbooks (not deployed; `*.md` excluded by `.vercelignore`):

- [docs/quiz-funnel.md](docs/quiz-funnel.md) — Quiz funnel architecture, design invariants, Clarity-report diagnosis.
- [docs/connect-streams.md](docs/connect-streams.md) — Connect Streams "Connect Me Now" lightbox (module 1966), HOO, debugging.
- [docs/integrations/boberdoo-clickflare.md](docs/integrations/boberdoo-clickflare.md) — Boberdoo ↔ ClickFlare lead postback; **Boberdoo Admin API key & `getLeadDetails`**; webhooks 53/55/57.
- [docs/integrations/ringba-clickflare.md](docs/integrations/ringba-clickflare.md) — Ringba ↔ ClickFlare phone-call (U65) pixel, targets, campaign config.
- [docs/integrations/clickflare-googleads.md](docs/integrations/clickflare-googleads.md) — ClickFlare → Google Ads "Qualified" failing "Too short." (empty gclid) diagnosis + fix.
- [docs/telegram-agent.md](docs/telegram-agent.md) — Claude Code web remote management, the `/change`·`/ask` deploy agent, and `/ringba` MFA.
- [docs/lead-logging.md](docs/lead-logging.md) — Lead logging to Google Sheet, `/diagnose`, alerts, daily summary, API access gaps.
- [docs/call-check.md](docs/call-check.md) — `/check` call-conversion verification (the 5-hop chain) + reply format.
- [docs/close-rate-tracking.md](docs/close-rate-tracking.md) — Enrollment/close-rate reporting: "sale" = Boberdoo CRM `Closed` (not Matched); no CRM-status read API; the Boberdoo report → Google Sheet plan for Misha.

## Commit Guidelines

- Keep commit messages short and descriptive (e.g. `fix form method to get`).
- Commit on the `main` branch directly.
