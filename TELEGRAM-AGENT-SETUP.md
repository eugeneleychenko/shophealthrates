# Telegram → Code → Deploy Agent (Setup)

Lets the client text a change request in Telegram and have it edited, committed,
and deployed to production automatically — no laptop, no VPS.

```
Telegram group "Leosource/ Integrations"
        │  "/change make the red box clickable to step 2"  (+ screenshot)
        ▼
api/telegram.js  (Vercel serverless fn — thin relay, scales to zero, free)
        │  verifies sender → fires repository_dispatch
        ▼
.github/workflows/telegram-agent.yml  (GitHub Actions — the brain)
        │  Claude reads request + screenshot → edits HTML/CSS/JS → commits to main
        ▼
git push origin main  →  vercel --prod  →  live on shophealthrates.com
        │
        ▼
Telegram: "✅ Done — '<commit msg>' is live on shophealthrates.com"
```

The two code pieces (`api/telegram.js`, the workflow) are already in the repo.
Everything below is the one-time wiring of bot + tokens + webhook.

---

## STATUS: LIVE (configured 2026-06-03)

Fully wired and validated end-to-end.

| Thing | Value / location |
|-------|------------------|
| Bot | **@leosource_bot** (privacy mode off → reads all group messages) |
| Group | "Leosource/ Integrations", chat id **`-5101729997`** |
| Webhook | `https://shophealthrates.com/api/telegram` (Vercel fn, project `vyb/shophealthrates`) |
| GitHub Actions secrets | `TELEGRAM_BOT_TOKEN`, `VERCEL_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` |
| Vercel env (Production) | `TELEGRAM_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `GITHUB_TOKEN`, `ALLOWED_CHAT_IDS` |
| Webhook's `GITHUB_TOKEN` | fine-grained PAT on `shophealthrates`, **Contents: Read & write** (required for `repository_dispatch`) |

**Gotchas baked into `.github/workflows/telegram-agent.yml`:**
- `claude-code-action` needs `permissions: id-token: write` (OIDC) — not just `contents`.
- The push-to-main step authenticates via `https://x-access-token:${GITHUB_TOKEN}@github.com/...`; the bare `git push` fails ("password auth not supported").
- `.vercelignore` keeps `.env` and `*.md` (incl. `AGENTS.md`, which holds the Boberdoo key) out of the public deploy.

**Security housekeeping:** the bot token, Claude OAuth token, and PAT were pasted into a chat during setup — rotate them when convenient (`/revoke` in BotFather; regenerate the others). The Boberdoo API key in `AGENTS.md` may have been publicly served on earlier deploys — consider rotating it too.

---

## What you trigger it with

In the group, the bot only reacts when **explicitly addressed** (so normal chatter
never deploys anything):

- `/change <what you want>` — e.g. `/change change the hero headline to "Save on Health Insurance"`
- or `@your_bot_username <what you want>`

Attach a screenshot to the same message and the agent will read it.

---

## One-time setup

### 1. Create the Telegram bot

1. In Telegram, message **@BotFather** → `/newbot` → pick a name and a username
   (the username ends in `bot`, e.g. `leosource_changes_bot`). Save the **bot token**.
2. Let the bot read group messages: BotFather → `/setprivacy` → select the bot →
   **Disable** (so it can see `/change` messages that aren't direct replies to it).
3. Add the bot to the **"Leosource / Integrations"** group.

### 2. Get the group's chat id

Send any message in the group, then:

```bash
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getUpdates" | jq '.result[].message.chat'
```

The group id is negative (e.g. `-1001234567890`). That's your `ALLOWED_CHAT_IDS`.

### 3. Mint the tokens you'll need

| Token | Where | Scope |
|-------|-------|-------|
| **Claude OAuth token** | run `claude setup-token` locally | uses your Claude subscription (no per-token API billing) |
| **GitHub PAT** | github.com → Settings → Developer settings → **Fine-grained tokens** | repo `eugeneleychenko/shophealthrates`, **Contents: Read and write** |
| **Vercel token** | you already have one (`VERCEL_TOKEN`, VYB-scoped) | reuse it |
| **Webhook secret** | `openssl rand -hex 32` | any random string |

### 4. GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret
(or via CLI — see bottom):

- `CLAUDE_CODE_OAUTH_TOKEN` — from `claude setup-token`
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `VERCEL_TOKEN` — your existing VYB token

### 5. Vercel environment variables (for the webhook function)

Vercel → project **vyb-site** → Settings → Environment Variables (Production):

- `TELEGRAM_SECRET` — the `openssl rand` string from step 3
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `TELEGRAM_BOT_USERNAME` — the bot's @username **without** the `@`
- `ALLOWED_CHAT_IDS` — the group chat id from step 2
- `GITHUB_TOKEN` — the fine-grained PAT from step 3

### 6. Deploy so the webhook function goes live

```bash
vercel --prod --yes --token <VERCEL_TOKEN>
```

Confirm it's up (should return `bad secret`, which means it's running and rejecting unauthenticated calls):

```bash
curl -s -X POST https://shophealthrates.com/api/telegram
```

### 7. Register the webhook with Telegram

```bash
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://shophealthrates.com/api/telegram" \
  -d "secret_token=<TELEGRAM_SECRET>"
```

Verify: `curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo" | jq`

### 8. Test

In the group: `/change add a small "Licensed in all 50 states" line under the hero headline`

You should see: instant `👍 On it…` → ~1–2 min later `✅ Done … is live`.
Watch the run at github.com/eugeneleychenko/shophealthrates/actions.

You can also dry-run without Telegram: Actions tab → **Telegram change request**
→ Run workflow → type a request.

---

## Setting secrets via CLI (optional shortcut)

```bash
# GitHub (run inside the repo)
gh secret set CLAUDE_CODE_OAUTH_TOKEN
gh secret set TELEGRAM_BOT_TOKEN
gh secret set VERCEL_TOKEN

# Vercel
vercel env add TELEGRAM_SECRET production
vercel env add TELEGRAM_BOT_TOKEN production
vercel env add TELEGRAM_BOT_USERNAME production
vercel env add ALLOWED_CHAT_IDS production
vercel env add GITHUB_TOKEN production
```

---

## Safety notes

- **Straight to prod by design.** Every `/change` commits to `main` and deploys
  live. The guardrails are: (1) the webhook only accepts requests carrying the
  secret header AND from `ALLOWED_CHAT_IDS`; (2) the bot only acts when addressed
  with `/change` or an @mention; (3) if a request is ambiguous, Claude asks a
  clarifying question instead of guessing; (4) everything is a git commit, so any
  bad change is one `git revert` away.
- **Rotate** the GitHub PAT / Vercel token if they ever leak; both are in secrets,
  never in the repo.

## Troubleshooting

- **Nothing happens** → `getWebhookInfo` shows `last_error_message`? Check the
  secret matches and the function is deployed.
- **`401 bad secret`** in Vercel logs → `TELEGRAM_SECRET` ≠ the `setWebhook` secret_token.
- **Bot doesn't see group messages** → privacy mode still on (BotFather → /setprivacy → Disable), then re-add the bot.
- **Action fails at deploy** → check `VERCEL_TOKEN` secret and that `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` in the workflow still match `.vercel/project.json`.

## Possible v2 upgrades

- **Multi-turn memory** — map each Telegram thread to a GitHub Issue so follow-ups
  ("actually make it blue") carry context.
- **Approve-before-prod** — switch to a PR + Vercel preview URL with an inline
  "Approve & ship" button (we chose straight-to-prod for now).
