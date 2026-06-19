# Remote Management & Telegram Agent

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../AGENTS.md).

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

