---
title: Artifact Templates
description: Canonical template files installed into target projects — RAUF.md, CLAUDE.md blocks, backlog schema.
---

Reference: `artifacts/variants/backlog-json/`

These are the canonical template files that get installed into target projects. They live in the rauf tool's repo under `artifacts/variants/backlog-json/` and are embedded into the compiled binary.

## File Inventory

```
artifacts/variants/backlog-json/
├── CLAUDE_ADDON.md              # Block to merge into existing CLAUDE.md
├── CLAUDE_GREENFIELD.md.tmpl    # Full CLAUDE.md template for new projects
└── .rauf/
    ├── RAUF.md.tmpl            # Per-iteration agent prompt (template)
    ├── REVIEW.md.tmpl           # Post-loop review prompt (template)
    ├── backlog.json              # Empty backlog template
    ├── backlog.schema.json       # JSON Schema for backlog.json
    └── progress.md               # Empty progress template
```

## .gitignore Entries

During `install()` and `update()`, the installer appends rauf runtime entries to the target project's `.gitignore` (idempotently — never duplicated). The set mirrors `RUNTIME_EXCLUDE_PATHSPECS` in `packages/loop/src/git-commit.ts`:

```
**/.rauf/.loop.lock
**/.rauf/state.json
**/.rauf/DONE
**/.rauf/CANCEL
**/.rauf/iteration-status.json
**/.rauf/rauf.log
**/backlog.json.bak
```

These cover the root `.rauf/` directory as well as nested backlog dirs (`specs/<feature>/.rauf/`). The intentionally-tracked files (`backlog.json`, `progress.md`, `RAUF.md`, `REVIEW.md`, `archive/`) are **not** listed.

> **Already tracking a runtime file?** If a runtime file was committed before the `.gitignore` was in place (common for projects installed before rauf's `.gitignore` deployment), untrack it once. The most commonly tracked files are `state.json` (written on every loop run) and `.loop.lock` (written while a loop is active):
>
> ```
> git rm --cached .rauf/state.json
> git rm --cached .rauf/.loop.lock
> ```
>
> Run `git status` to see which other runtime files are tracked and repeat as needed. The `rauf install`/`rauf update` warning lists all of them. After untracking, git will ignore these files on future loop runs.

## Loop Runner

The autonomous loop is implemented in `packages/loop` as a TypeScript LoopRunner class, replacing the legacy shell scripts. The loop is started via:

- **`rauf loop run --detached`** — server mode (via LoopManager)
- **`rauf loop run`** — direct mode (in-process, no server)

### Design Principle: Loop Runner Owns Status

**The loop runner manages ALL backlog status transitions.** Claude does NOT modify `backlog.json`. This is the fundamental design decision that enables safe concurrent access — the manager tool can add items to backlog.json while the loop runs, because the loop uses core's `updateItem()` for atomic status transitions.

### Critical Requirements

1. **Atomic writes for status management:** The loop runner selects items, marks them `in_progress`, runs Claude, then marks them `done`/`blocked` based on the exit signal. Each write goes through core's `updateItem()` which uses atomic write (write .tmp → rename) with .bak backup.

2. **state.json writes:** Write `.rauf/state.json` on every major state change via `writeLoopState()`.

3. **Dependency-aware item selection:** `selectNextItem()` returns the highest-priority pending item where all items in `dependsOn` have status `done`. Returns null if no eligible items.

4. **Focused prompt:** Claude receives RAUF.md + the specific item JSON + full backlog as read-only context. The prompt explicitly states: "Do NOT modify .rauf/backlog.json or .rauf/state.json."

5. **Exit signal detection:** Parse Claude's stdout for:
   - `RAUF_DONE` → mark item done, commit changes
   - `RAUF_BLOCKED:reason` → mark item blocked, continue to next
   - `RAUF_NEEDS_HUMAN:reason` → pause loop, leave item in_progress
   - `RAUF_REVIEW:{"items":[...],"summary":"..."}` → review found issues, runner creates fix items
   - No signal → **not auto-blocked**; outcome classified by exit context (clean / non-zero / timeout / usage-limit), already-committed work reconciled (see the Signal placement note below)
   - Claude exits non-zero with usage limit message in stderr → see Usage Limit Handling below

   > **Signal placement (canon §4.5):** the runner scans **backwards from the end**
   > of Claude's stdout and uses the **last** signal line, so trailing summaries or
   > commit text after the signal do not break detection (`signal-parser.ts:27-69`).
   > A signal must be the whole trimmed line. **No signal is not auto-blocked** — the
   > outcome is classified by exit context (clean / non-zero / timeout / usage-limit)
   > and already-committed work is reconciled (`runner.ts:677-705`).

6. **Crash cleanup:** `try/finally` resets any `in_progress` item back to `pending` so it's not left stranded.

7. **Git commit:** After RAUF_DONE, the loop commits with `[rauf] <id>: <title>`.

8. **DONE file + rauf.log:** Written on all terminal exit paths for status derivation.

### Model Resolution

The loop runner resolves which model to use at each iteration. Resolution priority (highest to lowest), per CANON §4.6:

```
item.model  >  --model / run options  >  project default  >  provider default

  1. item.model        — the selected backlog item's `model` field (per-task override)
  2. --model / options — per-run override (CLI `--model`, or run options)
  3. project default   — the project's configured default model (MarkerOptions.model)
  4. provider default  — none set → no `--model` passed; provider/CLI uses its default
```

Implementation: `item.model ?? options.model ?? projectModel` (`runner.ts:493-494`); the `--model` flag is only passed when set (`claude-process.ts:78-79`), so an unset cascade falls through to the provider default.

Model IDs follow Anthropic conventions: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`.

### Auto-Sweep

The loop runner checks `.rauf.json` for `options.autoSweep` on startup (before the main loop). If `true`, it calls core's `sweepBacklog()` (optionally with `sweepMinAgeDays` from marker options) before the first iteration. This keeps the active backlog clean automatically.

```
Auto-sweep behavior:
  - Triggered by: options.autoSweep = true in .rauf.json
  - Optional age filter: options.sweepMinAgeDays (integer, default 0 = sweep all done)
  - Failure is NON-FATAL — loop continues regardless of sweep result
  - .rauf/archive/ files are NOT auto-gitignored — users may add to .gitignore if preferred
```

MarkerOptions fields:

- `autoSweep?: boolean` — default `false`
- `sweepMinAgeDays?: number` — default `0` (sweep all done items)

### Session Timeout

Claude sessions can stall indefinitely — the process stays alive but stops making progress. The loop runner wraps the `claude -p` invocation with a configurable timeout.

```
Session timeout behavior:
  - Default: 60 minutes per Claude session
  - Configurable via: sessionTimeoutMinutes in LoopStartOptions or options.sessionTimeout in .rauf.json
  - Uses SIGTERM first, then SIGKILL after 30s grace period
  - Timeout triggers the retry flow (same as no-signal)
```

When a timeout fires:

```
1. Claude receives SIGTERM (graceful shutdown)
2. If still alive after 30s, receives SIGKILL
3. Item retry count is incremented
4. If retries < maxRetries: reset to pending, retry next iteration
5. If retries >= maxRetries: mark as blocked with reason
```

MarkerOptions field:

- `sessionTimeout?: number` — default `60` (minutes). Must be a positive integer.

### Graceful Cancel

The loop runner supports graceful cancellation via both AbortController (programmatic) and `.rauf/CANCEL` signal file:

```
Cancel mechanism:
  - Programmatic: call runner.cancel() (triggers AbortController)
  - File-based: create .rauf/CANCEL (e.g., via rauf loop stop)
  - Loop checks for cancellation at iteration boundaries and during sleep
  - On detection:
      1. Remove .rauf/CANCEL (if file-based)
      2. Write state.json: status=paused
      3. Write DONE file with content "cancel"
      4. Return with cancelled=true in LoopResult
  - Item currently in progress is NOT reset — cancel only fires at iteration boundary
```

### Review Pass

The loop runner supports a post-loop review pass to catch issues in completed work:

```
Review lifecycle:
  - Triggered by: --review flag on rauf loop run, or rauf loop review standalone command
  - Git baseline captured at loop start; diff computed for review context (baseCommit..HEAD)
  - Review prompt built from REVIEW.md template (or embedded REVIEW.md.tmpl)
  - Claude outputs RAUF_DONE (clean) or RAUF_REVIEW:{json} (issues found)
  - Review items created with source: "review" and reviewBatch: <ISO timestamp>
  - If not --review-only, loop re-enters to process fix items (no recursive review)
  - Runner methods: runReviewPass(), startReviewOnly(), buildReviewPrompt()
```

### REVIEW.md.tmpl — Post-Loop Review Prompt

Template for the review pass sent to Claude after the main loop completes.

- **Template variables:** `verifyCommand`, `completedItemsDetail`, `gitDiff`, `progressContent`
- **User-customizable:** if `.rauf/REVIEW.md` exists locally, it's used instead of the embedded template
- **Expected outputs:** `RAUF_DONE` (clean — no issues) or `RAUF_REVIEW:{json}` (issues found, JSON matches `ReviewPayload` schema)
- **Installed during:** `install()` and re-rendered during `update()`, removed during `uninstall()`

### Usage Limit Handling

When `claude -p` exits non-zero with a usage limit message in stderr (matching "usage limit", "rate limit", "Claude AI Usage Limit", or "too many requests"), the loop:

```
1. Reads OAuth credentials from ~/.config/claude-code/credentials.json
2. Queries GET https://api.anthropic.com/api/oauth/usage to determine limit type
3. Resets current item back to "pending" so it is retried after recovery

5-hour window exhausted (seven_day.utilization < 100%):
  - Writes state.json: status=sleeping_limit, sleepUntil=<reset timestamp>
  - Sleeps until reset time via interruptibleSleep (checks abort signal every ~30s)
  - On wake: continues loop with next iteration

7-day weekly cap exhausted (seven_day.utilization >= 100%):
  - Writes state.json: status=weekly_limit, sleepUntil=<weekly reset timestamp>
  - Writes DONE file: "weekly_limit:<reset timestamp>"
  - Returns from loop

API unreachable:
  - Falls back to 60-second sleep, then resumes (assumes transient issue)

CANCEL during sleep:
  - interruptibleSleep checks AbortController signal every ~30s
  - rauf loop stop triggers cancel which aborts the sleep
```

## CLAUDE_ADDON.md — Merge Block

The content between sentinels that gets merged into an existing CLAUDE.md:

```markdown
<!-- rauf:start -->

## Autonomous Loop (Rauf)

When running as a rauf loop iteration, follow these operational rules:

### Reading Your Task

1. Read `.rauf/RAUF.md` for detailed per-iteration instructions
2. Read `.rauf/backlog.json` — find the current `in_progress` item
3. The item's `acceptanceCriteria` define "done" for this iteration

### Working

4. Implement the changes described in the item's description
5. Follow acceptance criteria precisely — each one must pass
6. Run the verification command before considering work complete

### Completing

7. If all acceptance criteria pass: output `RAUF_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RAUF_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RAUF_NEEDS_HUMAN:<reason>`
10. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. Leave your changes in the working tree.

> Output the signal on a line by itself, as your final line — that's the safest
> habit. The runner scans backwards from the end and uses the **last** signal
> line, so trailing text after it (a commit message, a summary) does **not** break
> detection.
>
> `RAUF_REVIEW:<json>` is emitted only by a review pass, not a normal work
> iteration. If you emit no recognized signal, the runner does **not** auto-block
> the item — it classifies the outcome by exit context and reconciles committed
> work.

### Rules

- ONE item per iteration — do not work on multiple items
- Do not modify `.rauf/backlog.json` — the loop runner manages status
- Do not modify `.rauf/state.json` — the loop runner manages state
- Read `.rauf/progress.md` for accumulated project learnings
- Append new learnings to `.rauf/progress.md` if you discover important patterns

### Model Selection

The runner picks the model by precedence (highest wins):
`item.model` > `--model` / options > project default > provider default.

<!-- rauf:end -->
```

## CLAUDE_GREENFIELD.md.tmpl — Full Template

For greenfield projects where no CLAUDE.md exists:

```markdown
# {{projectName}}

## Overview

{{projectDescription}}

## Tech Stack

{{stackDescription}}

## Project Structure

<!-- Describe the intended project structure here, or let the agent establish it -->

## Key Requirements

{{requirements}}

## Development Conventions

<!-- Add coding style, naming conventions, architectural decisions here -->

## Verification Commands

- Test: `{{testCommand}}`
- Typecheck: `{{typecheckCommand}}`
- Lint: `{{lintCommand}}`
- Build: `{{buildCommand}}`
- Full verify: `{{verifyCommand}}`

---

<!-- rauf:start -->

## Autonomous Loop (Rauf)

When running as a rauf loop iteration, follow these operational rules:

### Reading Your Task

1. Read `RAUF.md` for detailed per-iteration instructions
2. Read the backlog — find the current `in_progress` item
3. The item's `acceptanceCriteria` define "done" for this iteration

### Working

4. Implement the changes described in the item's description
5. Follow acceptance criteria precisely — each one must pass
6. Run the verification command before considering work complete

### Completing

7. If all acceptance criteria pass: output `RAUF_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RAUF_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RAUF_NEEDS_HUMAN:<reason>`
10. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. Leave your changes in the working tree.

> Emit the signal on a line by itself. The runner scans backwards from the end and
> uses the **last** signal line, so trailing text (a commit message, a summary)
> does **not** break detection.
>
> `RAUF_REVIEW:<json>` is emitted only by a review pass. If you emit no recognized
> signal, the runner does **not** auto-block — it classifies by exit context and
> reconciles committed work.

### Rules

- ONE item per iteration — do not work on multiple items
- Do not modify `backlog.json` — the loop runner manages status
- Do not modify `state.json` — the loop runner manages state
- Read `progress.md` for accumulated project learnings
- Append new learnings to `progress.md` if you discover important patterns

### Model Selection

The runner picks the model by precedence (highest wins):
`item.model` > `--model` / options > project default > provider default.

<!-- rauf:end -->
```

## RAUF.md.tmpl — Per-Iteration Prompt

Contains two sections: managed (tool-updated) and user-customizable.

```markdown
# Rauf — Per-Iteration Instructions

<!-- rauf:managed:start -->

## Verification Commands

Before marking any task as complete, run the full verification pipeline:
```

{{verifyCommand}}

```

Individual commands:
- Test: `{{testCommand}}`
- Typecheck: `{{typecheckCommand}}`
- Lint: `{{lintCommand}}`
- Build: `{{buildCommand}}`
- Format: `{{formatCommand}}`

If any command is not configured (empty), skip it.
<!-- rauf:managed:end -->

## Workflow

1. You are one iteration of an autonomous coding loop
2. Read the backlog — find the current `in_progress` item
3. Read the item's `acceptanceCriteria` — each must pass
4. Read `progress.md` for context from previous iterations
5. Implement the task
6. Run verification: `{{verifyCommand}}`
7. Leave your changes in the working tree — do NOT commit. The iteration agent never commits or stages; the loop runner owns the commit (it commits as `[rauf] <id>: <title>` after you signal `RAUF_DONE`).
8. Output your exit signal on a line by itself, as your final line:
   - `RAUF_DONE` — all criteria met, verification passes
   - `RAUF_BLOCKED:<reason>` — cannot proceed, explain why
   - `RAUF_NEEDS_HUMAN:<reason>` — need human decision or input
   - `RAUF_REVIEW:<json>` — review pass only (a normal work iteration does not
     emit this); JSON matching the `ReviewPayload` schema.

   Putting the signal last is the safest habit, but it does not have to be
   strictly the final line: the runner scans backwards from the end and uses the
   **last** signal line, so trailing text after it (a commit message, a summary)
   does **not** break detection.

   If you emit **no** recognized signal, the runner does **not** auto-block the
   item — it classifies the outcome by exit context (clean / non-zero / timeout /
   usage-limit), logs the tail of your output, and reconciles any already-committed
   work. (Emitting a signal is still strongly preferred.)

## Model Selection

The runner resolves which model drives an iteration by this precedence
(highest wins):

`item.model` > `--model` / run options > project default > provider default

- `item.model` — the selected backlog item's `model` field (per-task override).
- `--model` / run options — the per-run override (`rauf loop run --model …`, or
  the project's configured run options).
- project default — the project's configured default model.
- provider default — if none of the above is set, no model is forced and the
  provider/CLI uses its own configured default.

## Project-Specific Instructions
<!-- Add custom instructions below this line — they survive rauf update -->
```

## backlog.json — Empty Template

```json
{
  "project": "",
  "description": "",
  "items": []
}
```

## progress.md — Empty Template

```markdown
# Progress & Learnings

## Codebase Patterns

<!-- Durable, project-wide patterns worth remembering across iterations.
     Append a bullet when you discover a convention, gotcha, or reusable approach. -->

## Session Log

<!-- Append ONE entry per iteration, newest at the bottom. Use this format: -->

<!--
### <item-id> — <short title>
- **Outcome:** done | blocked | needs-human
- **What changed:** one or two lines on the files/areas touched.
- **Learnings:** any gotcha, decision, or pattern a future iteration should know.
- **Follow-ups:** anything intentionally left undone (or "none").
-->
```
