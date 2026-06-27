# Telegram bot — answer eval (canonical questions)

> Not deployed (`*.md` excluded by `.vercelignore`). Run these **log-only** (leave
> `chat_id` blank ⇒ the result prints to the Actions run log and posts nothing to
> Telegram) before/after any change to the router (`api/telegram.js`), the read
> scripts, or the investigate prompt. Read the `----- REPLY -----` block in the log.

A case **passes** when the reply answers the *actual* question and **cites the system(s)**
the facts came from (ClickFlare / Boberdoo / Sheety / Ringba). **Case 1 is the gate** —
the regression that motivated investigate-by-default; it must never return a generic
weekly aggregate.

| # | Question | Run (log-only) | Expected |
|---|----------|----------------|----------|
| 1 | **5:41 regression** — pasted ids + "do you see these sales in boberdoo?" | `gh workflow run "Telegram investigate" -f request="do you see these sales in boberdoo? 337388e0-c4cc-41e1-9a8b-b580a1 and 8336f70d-3fa1-441e-9066-363c9f"` | Per-id verdict (each `✅ MATCHED $50` / `⛔ unmatched $0` / `❓ not found`), citing ClickFlare + Sheety. **NOT** a weekly total. |
| 1b | Same, deterministic path | `gh workflow run "Telegram investigate" -f mode=lookup -f request="337388e0-c4cc-41e1-9a8b-b580a1 8336f70d-3fa1-441e-9066-363c9f"` | `🔎 Lookup · 2 ids` with both matched $50 — no LLM step runs. |
| 2 | "how many sales this week?" | `gh workflow run "Telegram investigate" -f request="how many sales this week?"` | Revenue (ClickFlare) + sold counts (Sheety matched/unmatched). May run `sales-report.mjs`. |
| 3 | "did call …1234 convert today?" | `gh workflow run "Telegram investigate" -f request="did the call from xxx-xxx-1234 convert today?"` | YES/NO with pixel-fire 200 + ClickFlare match; notes U65 $0 is by design. |
| 4 | "why are there more leads in boberdoo than clickflare?" | `gh workflow run "Telegram investigate" -f request="why are there more leads in boberdoo than clickflare today?"` | Bucketed gap (cpid-fallback / no-click_id / genuine-miss). |
| 5 | "does the last lead have a TrustedForm cert?" | `gh workflow run "Telegram investigate" -f request="does the last lead have a trustedform cert?"` | Boberdoo lead status + TrustedForm present/missing (via Fixie). |
| 6 | Change request routes away | `@leosource_bot change the headline to "Save on health insurance"` (in group, or `gh workflow run "Telegram change request" -f request="change the headline to X" -f mode=auto`) | Goes to the **code-change** agent, not investigate (`isChangeRequest` = true). |

## Routing sanity (`api/telegram.js`)

- Free-form @mention **question** → `telegram-investigate` (mode `llm`).
- `/lookup <ids>` → `telegram-investigate` (mode `lookup`, deterministic, instant).
- `/investigate` · `/data <q>` → `telegram-investigate` (mode `llm`).
- `/sales` `/reconcile` `/check` `/diagnose` `/ringba` → unchanged deterministic fast paths.
- Clear **change request** (edit verb + UI noun, not a question) → `telegram-change-request`.

## Notes

- The investigate agent runs **read-only in CI** (`contents: read`, no git/deploy). It
  cannot post to arbitrary chats (`TELEGRAM_BOT_TOKEN` withheld from the agent step).
- The agent's `allowedTools` only permit `node scripts/<whitelisted>.mjs` + `cat/ls/grep`
  — not `node -e`/`printenv`/`curl` — so it cannot exfiltrate the live secrets it holds.
- `repository_dispatch`/`workflow_dispatch` only fire from `main`, so the workflow +
  `scripts/lookup.mjs` must be on `main` before the webhook can reach them.
