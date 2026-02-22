# Artifact Templates Specification

Reference: `artifacts/variants/backlog-json/`

These are the canonical template files that get installed into target projects. They live in the ralph tool's repo under `artifacts/variants/backlog-json/` and are embedded into the compiled binary.

## File Inventory

```
artifacts/variants/backlog-json/
├── ralph.sh                     # Main loop runner
├── ralph-status.sh              # Quick status snapshot
├── ralph-add.sh                 # Add items to backlog
├── ralph-stop.sh                # Request graceful loop cancellation (creates .ralph/CANCEL)
├── CLAUDE_ADDON.md              # Block to merge into existing CLAUDE.md
├── CLAUDE_GREENFIELD.md.tmpl    # Full CLAUDE.md template for new projects
└── .ralph/
    ├── RALPH.md.tmpl            # Per-iteration agent prompt (template)
    ├── backlog.json              # Empty backlog template
    └── progress.md               # Empty progress template
```

## ralph.sh — Main Loop Runner

### Design Principle: Loop Runner Owns Status

**ralph.sh manages ALL backlog status transitions.** Claude does NOT modify `backlog.json`. This is the fundamental design decision that enables safe concurrent access — the manager tool can add items to backlog.json while the loop runs, because the loop only touches individual items via targeted jq writes by ID.

### Critical Requirements

1. **Targeted jq writes for status management:** ralph.sh selects items, marks them `in_progress`, runs Claude, then marks them `done`/`blocked` based on the exit signal. Each write modifies only the specific item by ID.

```bash
# Mark item in_progress
jq --arg id "$ITEM_ID" \
  '(.items[] | select(.id == $id)) |= (.status = "in_progress")' \
  .ralph/backlog.json > .ralph/backlog.json.tmp && mv .ralph/backlog.json.tmp .ralph/backlog.json

# Mark item done
jq --arg id "$ITEM_ID" --arg ts "$(date -Iseconds)" \
  '(.items[] | select(.id == $id)) |= (.status = "done" | .completedAt = $ts)' \
  .ralph/backlog.json > .ralph/backlog.json.tmp && mv .ralph/backlog.json.tmp .ralph/backlog.json

# Mark item blocked with reason
jq --arg id "$ITEM_ID" --arg reason "$REASON" \
  '(.items[] | select(.id == $id)) |= (.status = "blocked" | .blockedReason = $reason)' \
  .ralph/backlog.json > .ralph/backlog.json.tmp && mv .ralph/backlog.json.tmp .ralph/backlog.json
```

2. **state.json writes:** Write `.ralph/state.json` on every major state change (see §6.7).

3. **Item selection:** Select the highest-priority pending item using `jq` sort:

```bash
jq -r '[.items[] | select(.status == "pending")] | sort_by(.priority) | .[0].id // empty' .ralph/backlog.json
```

Also checks for existing `in_progress` items (resume from interrupted loop).

4. **Focused prompt:** Claude receives RALPH.md + the specific item JSON + full backlog as read-only context. The prompt explicitly states: "Do NOT modify .ralph/backlog.json or .ralph/state.json."

5. **Exit signal detection:** Parse Claude's output for:
   - `RALPH_DONE` → mark item done, commit changes
   - `RALPH_BLOCKED:reason` → mark item blocked, continue to next
   - `RALPH_NEEDS_HUMAN:reason` → pause loop, leave item in_progress
   - No signal → reset item to pending, log warning, continue
   - Claude exits non-zero with usage limit message in stderr → see Usage Limit Handling below

6. **Cleanup trap:** On unexpected exit (SIGTERM, error), resets any `in_progress` item back to `pending` so it's not left stranded.

7. **Git commit:** After RALPH_DONE, ralph.sh commits with `[ralph] <id>: <title>`.

8. **DONE file + ralph.log:** Backward-compatible markers.

### Model Resolution

ralph.sh resolves which Claude model to use at each iteration using a 4-tier priority cascade:

```
Resolution priority (highest to lowest):
  1. BacklogItem.model  — per-task override (read from the selected backlog item's .model field)
  2. CLI arg $3         — per-run override (e.g., ./ralph.sh 20 3 claude-opus-4-6)
  3. MarkerOptions.model — project-level default (from .ralph.json options.model)
  4. Claude default     — no --model flag passed; Claude CLI uses its configured default

Implementation:
  CLI_MODEL="${3:-}"
  PROJECT_MODEL=$(jq -r '.options.model // empty' .ralph.json 2>/dev/null || echo "")
  ITEM_MODEL=$(echo "$ITEM_JSON" | jq -r '.model // empty')
  RESOLVED_MODEL="${ITEM_MODEL:-${CLI_MODEL:-$PROJECT_MODEL}}"

Invocation:
  if [ -n "$RESOLVED_MODEL" ]; then
    MODEL_FLAG="--model $RESOLVED_MODEL"
  fi
  claude -p --dangerously-skip-permissions --output-format text $MODEL_FLAG
```

Model IDs follow Anthropic conventions: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`.

### Auto-Sweep

ralph.sh checks `.ralph.json` for `options.autoSweep` on startup (before the main loop). If `true`, it runs `ralph backlog sweep . --yes` (optionally with `--min-age-days` from `options.sweepMinAgeDays`) before the first iteration. This keeps the active backlog clean automatically.

```
Auto-sweep behavior:
  - Triggered by: options.autoSweep = true in .ralph.json
  - Optional age filter: options.sweepMinAgeDays (integer, default 0 = sweep all done)
  - Requires 'ralph' in PATH — skips with a warning log line if not found
  - Failure is NON-FATAL — loop continues regardless of sweep exit code
  - Output is appended to .ralph/ralph.log
  - .ralph/archive/ files are NOT auto-gitignored — users may add to .gitignore if preferred
```

MarkerOptions fields:
- `autoSweep?: boolean` — default `false`
- `sweepMinAgeDays?: number` — default `0` (sweep all done items)

### Graceful Cancel

ralph.sh supports graceful cancellation via a `.ralph/CANCEL` signal file:

```
Cancel mechanism:
  - Create .ralph/CANCEL to request stop (ralph-stop.sh does this automatically)
  - Loop checks for .ralph/CANCEL at the START of each iteration (before item selection)
  - On detection:
      1. Remove .ralph/CANCEL
      2. Write state.json: status=paused, lastSignal=clean
      3. Write DONE file with content "cancel"
      4. Exit 0
  - Item currently in progress is NOT reset — cancel only fires at iteration boundary,
    after the previous item was already resolved

ralph-stop.sh behaviour:
  - Creates .ralph/CANCEL
  - Outputs: "Cancel requested. Loop will stop after current iteration."
  - Root symlink: ralph-stop.sh -> artifacts/variants/backlog-json/ralph-stop.sh
```

### Behavior Flow

```
1. Parse args (max_iterations default 20, retries default 3, model default empty)
2. Preflight: require backlog.json, RALPH.md, claude, jq
3. Resolve project-level model from .ralph.json options.model
4. Write state.json: starting
5. Set cleanup trap for unexpected exits
6. Loop:
   a. Check for .ralph/CANCEL → if found: remove, write state paused, write DONE "cancel", exit 0
   b. Check for existing in_progress items (resume case)
   c. If none, select first pending item by priority
   d. If no items available → COMPLETE
   e. Resolve item-level model (item.model > CLI arg > project model)
   f. Mark item in_progress (targeted jq write)
   g. Write state.json: running, iteration N, currentItem
   h. Build prompt: RALPH.md + focused item + backlog context
   i. Spawn claude -p [--model <model>], capture output
   j. Check for Claude usage limit (before signal parsing):
      - If Claude exits non-zero AND stderr contains "usage limit"/"rate limit" → see Usage Limit Handling
   k. Parse exit signal:
      - RALPH_DONE → mark done, git commit, add to completedItems
      - RALPH_BLOCKED → mark blocked with reason, add to blockedItems
      - RALPH_NEEDS_HUMAN → write state paused_human, exit 2
      - No signal → reset to pending, log warning
   l. Clear current item, print status
   m. Sleep 3s between iterations
7. If max iterations reached → write state limit_reached
8. Write DONE file, disarm cleanup trap, exit 1
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Graceful completion, all items done, or CANCEL signal received |
| 1 | Max iterations reached (`limit_reached` state) |
| 2 | `RALPH_NEEDS_HUMAN` — loop paused for human input |
| 3 | Weekly Claude usage limit exhausted (`weekly_limit` state) |

### Usage Limit Handling

When `claude -p` exits non-zero with a usage limit message in stderr (matching "usage limit", "rate limit", "Claude AI Usage Limit", or "too many requests"), the loop:

```
1. Reads OAuth credentials from ~/.config/claude-code/credentials.json
2. Queries GET https://api.anthropic.com/api/oauth/usage to determine limit type
3. Resets current item back to "pending" so it is retried after recovery

5-hour window exhausted (seven_day.utilization < 100%):
  - Writes state.json: status=sleeping_limit, sleepUntil=<reset timestamp>
  - Sleeps until reset time (checking for CANCEL signal every 5 minutes)
  - On wake: writes state.json: status=running, continues loop with next iteration

7-day weekly cap exhausted (seven_day.utilization >= 100%):
  - Writes state.json: status=weekly_limit, sleepUntil=<weekly reset timestamp>
  - Writes DONE file: "weekly_limit:<reset timestamp>"
  - Exits with code 3

API unreachable:
  - Falls back to 30-minute sleep, then resumes (assumes 5-hour limit)

CANCEL during sleep:
  - sleep_with_cancel() polls for .ralph/CANCEL every 5 minutes
  - On detection: removes CANCEL, writes state paused, exits 0
  - ralph-stop.sh continues to work during usage limit sleep
```

## ralph-status.sh — Quick Status

Reads state.json (preferred) and backlog.json directly. Outputs:

- Backlog summary (pending/in_progress/blocked/done counts)
- Loop state from state.json if available (status, iteration, current item, staleness check)
- Falls back to log mtime heuristics if no state.json
- Pending/in_progress/blocked item lists
- Last few log lines

## ralph-add.sh — Add Item

Interactive or flag-driven script to add an item to backlog.json:

- Prompts for: type, priority, title, description (or accepts --flags)
- **Validates** type (must be bug/refactor/feature/chore) and priority (must be 1-4)
- Auto-assigns ID using **max of all existing IDs** + 1 (handles gaps from deletions)
- Uses **atomic write** (jq → .tmp → mv) — never echo > overwrite
- Reports the new item and suggests adding acceptance criteria

## ralph-stop.sh — Graceful Cancel

Creates `.ralph/CANCEL` to signal the running loop to stop at the next iteration boundary:

- Requires `.ralph/` directory to exist (ralph must be installed)
- Creates `.ralph/CANCEL` (empty file or with timestamp content)
- Outputs: `"Cancel requested. Loop will stop after current iteration."`
- The loop detects this file at the top of each iteration and exits cleanly with `status=paused`
- Root symlink: `ralph-stop.sh -> artifacts/variants/backlog-json/ralph-stop.sh`

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
