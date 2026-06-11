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

> **Already tracking a runtime file?** If `.rauf/.loop.lock` (or another runtime file) was committed before the `.gitignore` was in place, untrack it once with:
>
> ```
> git rm --cached .rauf/.loop.lock
> ```
>
> Repeat for any other runtime files that appear in `git status`. The install/update warning lists all of them.

## Loop Runner

The autonomous loop is implemented in `packages/loop` as a TypeScript LoopRunner class, replacing the legacy shell scripts. The loop is started via:

- **`rauf loop start`** — server mode (via LoopManager)
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
   - No signal → reset item to pending, log warning, continue
   - Claude exits non-zero with usage limit message in stderr → see Usage Limit Handling below

6. **Crash cleanup:** `try/finally` resets any `in_progress` item back to `pending` so it's not left stranded.

7. **Git commit:** After RAUF_DONE, the loop commits with `[rauf] <id>: <title>`.

8. **DONE file + rauf.log:** Written on all terminal exit paths for status derivation.

### Model Resolution

The loop runner resolves which Claude model to use at each iteration using a 3-tier priority cascade:

```
Resolution priority (highest to lowest):
  1. BacklogItem.model  — per-task override (read from the selected backlog item's .model field)
  2. options.model      — per-run override (from CLI --model flag or project MarkerOptions.model)
  3. Claude default     — no --model flag passed; Claude CLI uses its configured default
```

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
10. Commit your changes with message: `[rauf] <item-id>: <title>`

### Rules

- ONE item per iteration — do not work on multiple items
- Do not modify `.rauf/backlog.json` — the loop runner manages status
- Do not modify `.rauf/state.json` — the loop runner manages state
- Read `.rauf/progress.md` for accumulated project learnings
- Append new learnings to `.rauf/progress.md` if you discover important patterns
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

...same content as CLAUDE_ADDON.md...

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
2. Read `.rauf/backlog.json` — your current task is the `in_progress` item
3. Read the item's `acceptanceCriteria` — each must pass
4. Read `.rauf/progress.md` for context from previous iterations
5. Implement the task
6. Run verification: `{{verifyCommand}}`
7. Commit with: `[rauf] <id>: <title>`
8. Output your exit signal:
   - `RAUF_DONE` — all criteria met
   - `RAUF_BLOCKED:<reason>` — cannot proceed
   - `RAUF_NEEDS_HUMAN:<reason>` — need human input

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

<!-- Patterns discovered during development will be logged here -->

## Session Log

<!-- Each iteration appends its learnings here -->
```
