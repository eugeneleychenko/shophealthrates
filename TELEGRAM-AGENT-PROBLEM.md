# Problem: Telegram → Code Changes → Deploy, Without a Laptop

## The Situation

Eugene runs a static marketing site (shophealthrates.com) for a client — LeoSource Insurance Agency. The client (Mikhail) and Eugene communicate in a Telegram group called "Leosource/ Integrations."

Mikhail sends requests like:
- "Make what I marked in red clickable. That link should take them to step 2 of the quiz flow." (with a screenshot)
- "Can we change the headline text?"
- "The form isn't working on mobile"
- Links to Clarity session recordings showing user behavior issues

These are small HTML/CSS/JS changes to a static site deployed on Vercel.

## The Problem

Right now, every change requires Eugene to:
1. Read the Telegram message
2. Open his laptop
3. Open a terminal or IDE
4. Make the code change
5. Push to GitHub
6. Deploy to Vercel
7. Go back to Telegram and confirm

Eugene wants to **eliminate the laptop from this loop entirely**. The ideal workflow:

1. Client sends a request in Telegram (text, screenshots, links)
2. An AI agent picks it up, understands the request, asks clarifying questions if needed
3. The agent makes the code changes, pushes to GitHub, deploys to Vercel
4. The agent replies in Telegram confirming the change is live

All of this should happen **without Eugene's laptop being open** — from his phone, or even fully autonomously.

## Constraints

- **No VPS** — Eugene doesn't want to manage server infrastructure
- **No laptop required** — the solution must work from a phone or run autonomously
- **Telegram is the interface** — the client already communicates there; switching to Slack/Discord/email is not an option
- **The site is simple** — plain HTML/CSS/JS, no build step, deployed to Vercel with `vercel --prod`
- **Screenshots matter** — many client requests include annotated screenshots showing what needs to change

## What Exists Today (MVP)

Claude Code on the web (claude.ai/code) is configured with:
- The `shophealthrates` repo connected via GitHub App
- A cloud environment with Vercel CLI and a deploy token
- AGENTS.md in the repo providing full project context

**Current workflow:** Eugene reads Telegram → copies the request → opens claude.ai/code on his phone → pastes it → Claude makes the change and deploys → Eugene confirms in Telegram.

This works but has two gaps:
1. **Eugene is still the middleman** — he has to manually relay every message
2. **No direct Telegram ↔ Claude connection** — the client can't talk to the agent directly

## The Ideal End State

A Telegram bot in the "Leosource/ Integrations" group (or a separate channel) that:
- Listens to client messages
- Understands what code change is needed (including interpreting screenshots)
- Asks clarifying questions in Telegram if the request is ambiguous
- Makes the change on a branch, creates a PR for review (or pushes directly to main)
- Deploys to Vercel
- Replies in Telegram with confirmation and a link to the live change

All running in the cloud — no VPS, no laptop.

## Approaches Explored

| Approach | Pros | Cons | Status |
|----------|------|------|--------|
| **Claude Code on the web (MVP)** | No infra, works today | Eugene is the middleman, no Telegram integration | ✅ Working |
| **Claude Code Channels + VPS** | Official Anthropic plugin, full Claude Code capabilities, bi-directional Telegram | Requires a VPS running 24/7 | Rejected (no VPS) |
| **Claude Code Routines + API trigger** | No VPS, runs on Anthropic cloud, triggered by HTTP POST | Needs a tiny serverless function as bridge, can't natively reply to Telegram | Not yet built |
| **Telegram MCP + Claude Code web** | Claude can read/write Telegram directly from cloud sessions | Requires my.telegram.org API credentials (site was broken/unresponsive) | Blocked |
| **claude-code-telegram on VPS** | Battle-tested open source project, full Telegram integration | Requires a VPS | Rejected (no VPS) |
| **Claude Managed Agents + custom bot** | Fully cloud, Anthropic-managed sandbox | Requires custom code for Telegram bridge, more DIY | Not yet built |
| **n8n / Make.com** | No-code, easy webhook setup | Limited — can't really edit code or deploy | Not explored |

## Most Promising Path Forward

**Claude Code Routines with an API trigger**, bridged to Telegram via a free serverless function (Cloudflare Worker or Vercel Edge Function):

```
Client → Telegram bot → Webhook → Serverless function → Routine API /fire → Claude Code cloud session → edits, pushes, deploys
```

Open questions:
- How does the agent reply back to Telegram? (May need Telegram Bot API call from the serverless function after the session completes, or a Telegram MCP connector in the routine)
- Can the routine handle multi-turn clarifying questions, or is it one-shot?
- How are screenshots/images passed through the pipeline?
