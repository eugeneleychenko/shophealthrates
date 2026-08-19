# Shared Telegram helpers for the telegram-*.yml workflows.
#
# Sourced, not executed:   . .github/scripts/tg.sh
# Every workflow already runs actions/checkout@v4, so this file is on disk by
# the time the report step runs. Source it on the FIRST line of the `run:` block
# — telegram-agent.yml does `git rebase origin/main` mid-step, and sourcing
# beforehand pins these functions in memory regardless of what the rebase brings.
#
# WHY a sourced .sh and not a composite action: telegram-agent.yml calls send/
# react 12 times interleaved with git rebase, git push, vercel deploy and
# exit 0/exit 1 control flow, including inside `||` fallbacks. Turning those into
# `uses:` steps would mean inventing step-level `if:` conditions for every branch
# — a rewrite, not a refactor. Sourcing costs one line and preserves control flow
# byte-for-byte.
#
# Bonus: .github/scripts/ is NOT .github/workflows/, so the default GITHUB_TOKEN
# can push changes here. The bot can iterate on its own send logic; it cannot
# edit workflow YAML without a `workflows`-scoped PAT.
#
# Reads from env: TELEGRAM_BOT_TOKEN, CHAT_ID, MESSAGE_ID
# Optional knobs:
#   TG_NO_CHAT_HEADER  banner printed before the text when CHAT_ID is empty
#                      (telegram-call-check.yml prints "----- REPLY -----";
#                      telegram-agent.yml prints nothing)
#
# Every function returns 0. Under Actions' default `bash -e`, a helper that can
# return non-zero silently kills the whole step.

TG_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
TG_INGEST="https://shophealthrates.com/api/chatlog-ingest"

# _record <text>  — remember what the bot just said.
#
# These replies are the whole reason the bot had no memory: they are posted by a
# runner curling Telegram directly, they never pass through Vercel, and Telegram
# does not echo a bot's own messages back to its webhook. So "the url does not
# work" had nothing to resolve against.
#
# DUAL-WRITE, deliberately not a proxy: Telegram is called first and
# unconditionally by the callers below, and this only runs afterwards. Delivery
# therefore never depends on Vercel — which matters because telegram-agent.yml
# deploys Vercel and THEN reports the outcome. Routing that through Vercel would
# mean a bad deploy silences the message announcing the bad deploy.
_record() {
  { [ -z "${CHATLOG_SECRET:-}" ] || [ -z "$1" ] || [ -z "$CHAT_ID" ]; } && return 0
  curl -s --max-time 4 -X POST "$TG_INGEST" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg c "$CHAT_ID" --arg t "$1" --arg s "$CHATLOG_SECRET" \
      '{chat_id:$c, text:$t, secret:$s}')" >/dev/null 2>&1 || true
  return 0
}

# send <text>
send() {
  if [ -z "$CHAT_ID" ]; then
    [ -n "${TG_NO_CHAT_HEADER:-}" ] && echo "$TG_NO_CHAT_HEADER"
    echo "$1"
    return 0
  fi
  curl -s -X POST "$TG_API/sendMessage" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg c "$CHAT_ID" --arg t "$1" '{chat_id:$c, text:$t}')" >/dev/null
  _record "$1"
  return 0
}

# react <emoji>  — reactions are not conversational turns, so they are never recorded
react() {
  { [ -z "$CHAT_ID" ] || [ -z "${MESSAGE_ID:-}" ]; } && return 0
  curl -s -X POST "$TG_API/setMessageReaction" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg c "$CHAT_ID" --arg m "$MESSAGE_ID" --arg e "$1" \
      '{chat_id:$c, message_id:($m|tonumber), reaction:[{type:"emoji",emoji:$e}]}')" >/dev/null
  return 0
}

# send_photo <path> <caption>
# The [ ! -f ] guard is load-bearing: without it a missing file becomes
# `-F photo=@missing.png`, which posts nothing while reporting success.
# telegram-call-check.yml had this guard; telegram-agent.yml did not.
send_photo() {
  { [ -z "$CHAT_ID" ] || [ ! -f "$1" ]; } && return 0
  curl -s -X POST "$TG_API/sendPhoto" \
    -F "chat_id=$CHAT_ID" -F "photo=@$1" -F "caption=$2" >/dev/null
  # Caption only. The image bytes cost Redis space and give the agent nothing it
  # can read; the caption ("✅ '<commit>' is live on …") is the part a follow-up
  # like "that screenshot looks wrong" needs to resolve against.
  _record "$2"
  return 0
}
