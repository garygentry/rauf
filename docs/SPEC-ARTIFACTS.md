---
title: Artifact Templates
description: Canonical template files installed into target projects — RALPH.md, CLAUDE.md blocks, backlog schema.
---

Reference: `artifacts/variants/backlog-json/`

These are the canonical template files that get installed into target projects. They live in the ralph tool's repo under `artifacts/variants/backlog-json/` and are embedded into the compiled binary.

## File Inventory

```
artifacts/variants/backlog-json/
├── CLAUDE_ADDON.md              # Block to merge into existing CLAUDE.md
├── CLAUDE_GREENFIELD.md.tmpl    # Full CLAUDE.md template for new projects
└── .ralph/
    ├── RALPH.md.tmpl            # Per-iteration agent prompt (template)
    ├── backlog.json              # Empty backlog template
    ├── backlog.schema.json       # JSON Schema for backlog.json
    └── progress.md               # Empty progress template
```

## Loop Runner

The autonomous loop is implemented in `packages/loop` as a TypeScript LoopRunner class, replacing the legacy shell scripts. The loop is started via:

- **`ralph loop start`** — server mode (via LoopManager)
- **`ralph loop run`** — direct mode (in-process, no server)

### Design Principle: Loop Runner Owns Status

**The loop runner manages ALL backlog status transitions.** Claude does NOT modify `backlog.json`. This is the fundamental design decision that enables safe concurrent access — the manager tool can add items to backlog.json while the loop runs, because the loop uses core's `updateItem()` for atomic status transitions.

### Critical Requirements

1. **Atomic writes for status management:** The loop runner selects items, marks them `in_progress`, runs Claude, then marks them `done`/`blocked` based on the exit signal. Each write goes through core's `updateItem()` which uses atomic write (write .tmp → rename) with .bak backup.

2. **state.json writes:** Write `.ralph/state.json` on every major state change via `writeLoopState()`.

3. **Dependency-aware item selection:** `selectNextItem()` returns the highest-priority pending item where all items in `dependsOn` have status `done`. Returns null if no eligible items.

4. **Focused prompt:** Claude receives RALPH.md + the specific item JSON + full backlog as read-only context. The prompt explicitly states: "Do NOT modify .ralph/backlog.json or .ralph/state.json."

5. **Exit signal detection:** Parse Claude's stdout for:
   - `RALPH_DONE` → mark item done, commit changes
   - `RALPH_BLOCKED:reason` → mark item blocked, continue to next
   - `RALPH_NEEDS_HUMAN:reason` → pause loop, leave item in_progress
   - No signal → reset item to pending, log warning, continue
   - Claude exits non-zero with usage limit message in stderr → see Usage Limit Handling below

6. **Crash cleanup:** `try/finally` resets any `in_progress` item back to `pending` so it's not left stranded.

7. **Git commit:** After RALPH_DONE, the loop commits with `[ralph] <id>: <title>`.

8. **DONE file + ralph.log:** Written on all terminal exit paths for status derivation.

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

The loop runner checks `.ralph.json` for `options.autoSweep` on startup (before the main loop). If `true`, it calls core's `sweepBacklog()` (optionally with `sweepMinAgeDays` from marker options) before the first iteration. This keeps the active backlog clean automatically.

```
Auto-sweep behavior:
  - Triggered by: options.autoSweep = true in .ralph.json
  - Optional age filter: options.sweepMinAgeDays (integer, default 0 = sweep all done)
  - Failure is NON-FATAL — loop continues regardless of sweep result
  - .ralph/archive/ files are NOT auto-gitignored — users may add to .gitignore if preferred
```

MarkerOptions fields:

- `autoSweep?: boolean` — default `false`
- `sweepMinAgeDays?: number` — default `0` (sweep all done items)

### Session Timeout

Claude sessions can stall indefinitely — the process stays alive but stops making progress. The loop runner wraps the `claude -p` invocation with a configurable timeout.

```
Session timeout behavior:
  - Default: 60 minutes per Claude session
  - Configurable via: sessionTimeoutMinutes in LoopStartOptions or options.sessionTimeout in .ralph.json
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

The loop runner supports graceful cancellation via both AbortController (programmatic) and `.ralph/CANCEL` signal file:

```
Cancel mechanism:
  - Programmatic: call runner.cancel() (triggers AbortController)
  - File-based: create .ralph/CANCEL (e.g., via ralph loop stop)
  - Loop checks for cancellation at iteration boundaries and during sleep
  - On detection:
      1. Remove .ralph/CANCEL (if file-based)
      2. Write state.json: status=paused
      3. Write DONE file with content "cancel"
      4. Return with cancelled=true in LoopResult
  - Item currently in progress is NOT reset — cancel only fires at iteration boundary
```

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
  - ralph loop stop triggers cancel which aborts the sleep
```

## CLAUDE_ADDON.md — Merge Block

The content between sentinels that gets merged into an existing CLAUDE.md:

```markdown
<!-- ralph:start -->

## Autonomous Loop (Ralph)

When running as a ralph loop iteration, follow these operational rules:

### Reading Your Task

1. Read `.ralph/RALPH.md` for detailed per-iteration instructions
2. Read `.ralph/backlog.json` — find the current `in_progress` item
3. The item's `acceptanceCriteria` define "done" for this iteration

### Working

4. Implement the changes described in the item's description
5. Follow acceptance criteria precisely — each one must pass
6. Run the verification command before considering work complete

### Completing

7. If all acceptance criteria pass: output `RALPH_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RALPH_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RALPH_NEEDS_HUMAN:<reason>`
10. Commit your changes with message: `[ralph] <item-id>: <title>`

### Rules

- ONE item per iteration — do not work on multiple items
- Do not modify `.ralph/backlog.json` — the loop runner manages status
- Do not modify `.ralph/state.json` — the loop runner manages state
- Read `.ralph/progress.md` for accumulated project learnings
- Append new learnings to `.ralph/progress.md` if you discover important patterns
<!-- ralph:end -->
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

<!-- ralph:start -->

## Autonomous Loop (Ralph)

...same content as CLAUDE_ADDON.md...

<!-- ralph:end -->
```

## RALPH.md.tmpl — Per-Iteration Prompt

Contains two sections: managed (tool-updated) and user-customizable.

```markdown
# Ralph — Per-Iteration Instructions

<!-- ralph:managed:start -->

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
<!-- ralph:managed:end -->

## Workflow

1. You are one iteration of an autonomous coding loop
2. Read `.ralph/backlog.json` — your current task is the `in_progress` item
3. Read the item's `acceptanceCriteria` — each must pass
4. Read `.ralph/progress.md` for context from previous iterations
5. Implement the task
6. Run verification: `{{verifyCommand}}`
7. Commit with: `[ralph] <id>: <title>`
8. Output your exit signal:
   - `RALPH_DONE` — all criteria met
   - `RALPH_BLOCKED:<reason>` — cannot proceed
   - `RALPH_NEEDS_HUMAN:<reason>` — need human input

## Project-Specific Instructions
<!-- Add custom instructions below this line — they survive ralph update -->
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
