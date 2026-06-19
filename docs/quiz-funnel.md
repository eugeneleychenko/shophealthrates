# Quiz Funnel Architecture

> Operational runbook extracted from AGENTS.md. **Not deployed** — `*.md` is excluded by `.vercelignore`. Linked from [AGENTS.md](../AGENTS.md).

## Quiz Funnel Architecture (rewritten 2026-06-12)

quiz.html was rewritten after a P0 "0 conversions" investigation (24 Clarity sessions). The reported "redirect to homepage" bug was never a redirect — root causes were a direction-blind `screenHistory.pop()` popstate handler, total progress loss on reload (volatile in-memory state + stale pushState entries → dead back presses → cross-document exit to the landing page), and a 300ms `setTimeout` inside `show()` that raced the Back gesture and made taps feel dead.

Step order (visible steps): `step-8` Gender → `step-5` Household → `step-7` Income → `step-contact` DOB → `step-10` Address+Phone → `step-11` Name+Email/submit. Steps 1/2/3/4/6 are commented-out removed questions.

### Design (do not regress)

- **State-driven history**: every `history.pushState` entry carries `{quizStep, path}`. The `popstate` handler renders `event.state` — it must never infer direction or pop an in-memory array. On load, restore priority is `history.state` (reload/tab restore) → sessionStorage `quiz_step`/`quiz_path` (fresh-navigation resume) → `?step=` param → `step-8`, then `history.replaceState` so the base entry has state.
- **In-quiz Back pushes** a new entry with the previous step's snapshot (NOT `history.back()`) so it works in resumed sessions with no quiz entries in the browser stack.
- **`show()` is synchronous** — no transition `setTimeout`. Guards: ignore same-target calls (label clicks fire twice via radio re-bubble) and a 250ms lockout against ghost double-taps.
- **Answer persistence**: radios saved as `quiz_ans_<name>` (index), fields as `quiz_fld_<id>`; restored on `DOMContentLoaded`; `clearSavedProgress()` runs on successful submit. ZIP saved as `quiz_zip` for resumed sessions. All storage access goes through `ssGet`/`ssSet`/`ssRemove` try/catch helpers — sessionStorage throws in storage-blocked browsers and previously lost the lead entirely.
- **Soft-gate validation**: Continue/submit buttons are **never hard-`disabled`** (a disabled button swallows taps with zero feedback — that was the "dead DOB button"). They carry `.btn-inactive` (grey but clickable); click handlers (`continueDob`, `continueAddress`, `submitLead`) show inline `.field-error` messages and `.input-error` field highlights. Errors clear on edit. `#leadForm` has `novalidate` so the styled errors show instead of native bubbles.
- **DOB**: day list dynamically clamps to the month/year (`rebuildDobDays`); when the clamp removes the selected day it resets to the placeholder — the browser would otherwise silently pick day "01" and submit a wrong DOB. Years run currentYear−18 to currentYear−100 (TCPA text requires 18+; flagged business-rule change). `dobValid()` requires a real, non-future calendar date.
- **Phone mask** (vanilla, document-level `input` on `.phone`): strips a leading US "1" from 11-digit input (used to truncate to a *wrong* number), caps at 10 digits, re-validates and re-persists after masking (the element-level saver runs pre-mask).
- **`submitLead`**: re-validates DOB/address/phone first and routes the user back to the gap (deep links / restore can land on step-11 with earlier steps empty); main body in try/catch with the thank-you redirect OUTSIDE it (never strand "Submitting..."); Boberdoo fetch uses `keepalive: true`. A `pageshow` handler re-validates buttons (browser form-restore fills fields without `change` events) and un-sticks "Submitting..." after bfcache swipe-back from thank-you.
- **Boberdoo payload contract** unchanged: same keys, DOB `MM/DD/YYYY` zero-padded, Household_Size index mapping, income radio values.

### Diagnosing Clarity reports for this funnel

- "Entered text" events on radio-only steps are **instrumentation noise**: radios fire spec-mandated `input` events that Clarity surfaces as text entry. Not a bug signal.
- "Resized page" before an exit is keyboard/URL-bar viewport churn that co-occurs with back gestures — correlation, not cause.
- Back-gesture exits (edge swipe) record **no tap** in Clarity playback, so they look like "silent redirects".
- Jun 10 2026 03:25–04:20 UTC shipped several broken intermediate builds under live traffic — Clarity sessions from that window show bugs that no longer exist.
- Conversion counting: the Sheety log (`/api/log-lead`) is the reliable lead record; the ClickFlare cv pixel is subId-gated (undercounts organic). The Jun 11 0-conversion cliff did not align with any deploy — suspect traffic-side (Google Ads) before suspecting code.

