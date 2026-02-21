# Ralph Loop — Setup & Usage Guide

An autonomous Claude Code loop for working through a project backlog
of bugs, refactors, features, and chores. Drop this into an existing project,
configure it, and let Claude work through tasks while you're away.

---

## What's Included

```
ralph.sh              ← Main loop runner (run this)
ralph-status.sh       ← Quick backlog status check
ralph-add.sh          ← Add new backlog items from CLI
CLAUDE_ADDON.md       ← Content to append to your CLAUDE.md
.ralph/
  RALPH.md            ← Agent instructions (injected every iteration)
  backlog.json        ← Your work queue (edit this)
  progress.md        ← Cumulative learnings log (Claude writes to this)
```

---

## Prerequisites

```bash
# Claude Code CLI
curl -fsSL https://claude.ai/install.sh | bash

# jq (JSON processor used by the loop scripts)
sudo apt install jq

# Authenticate Claude
claude auth login
```

---

## Setup (One Time)

### 1. Copy files into your project root

```
your-project/
├── ralph.sh
├── ralph-status.sh
├── ralph-add.sh
├── CLAUDE_ADDON.md
└── .ralph/
    ├── RALPH.md
    ├── backlog.json
    └── progress.md
```

### 2. Make scripts executable

```bash
chmod +x ralph.sh ralph-status.sh ralph-add.sh
```

### 3. Add Ralph section to your existing CLAUDE.md

```bash
cat CLAUDE_ADDON.md >> CLAUDE.md
```

### 4. Add .ralph/ to git

```bash
git add .ralph/ ralph.sh ralph-status.sh ralph-add.sh CLAUDE.md
git commit -m "chore: add ralph autonomous loop setup"
```

### 5. Customize backlog.json

Open `.ralph/backlog.json` and replace the example items with your actual
work. The critical part is writing good `acceptanceCriteria` — this is what
Claude uses to verify a task is complete.

### 6. Customize RALPH.md quality gates

Open `.ralph/RALPH.md` and update the verification commands to match your
project. The defaults cover `npm test`, `npm run typecheck`, and `pytest`.
Remove checks that don't apply. Add any project-specific checks (e.g., `cargo clippy`).

---

## Running the Loop

```bash
# Run up to 20 iterations (default)
./ralph.sh

# Run up to N iterations
./ralph.sh 30

# Dry run a single iteration to test your setup
./ralph.sh 1
```

**Before going fully AFK:** always run `./ralph.sh 1` first and watch what
happens. Verify Claude picks the right task, does reasonable work, and exits
cleanly with `RALPH_DONE`. Then run the full loop.

---

## Monitoring While Running

The loop runs in your current terminal. In a second terminal:

```bash
# Live status
watch -n 10 ./ralph-status.sh

# Tail the log
tail -f .ralph/ralph.log

# Check what's been committed
git log --oneline -10
```

---

## Adding New Items During a Running Loop

You can add new backlog items while the loop is running. The loop reads
`backlog.json` fresh at the start of each iteration, so new items will be
picked up automatically.

```bash
# Interactive
./ralph-add.sh

# Flags (description via --description flag or edit json directly after)
./ralph-add.sh --type bug --priority 1 --title "Fix crash on null input"
```

**Always add acceptance criteria** after using `ralph-add.sh` — open
`.ralph/backlog.json` and fill in the `acceptanceCriteria` array for the
new item. Without criteria, Claude has no way to verify it's done.

---

## Backlog Item Structure

```json
{
  "id": "009",
  "type": "bug",
  "priority": 1,
  "title": "Short descriptive title",
  "description": "Detailed description: what's happening, expected vs actual behavior, how to reproduce, relevant files/functions if known.",
  "acceptanceCriteria": [
    "Specific verifiable outcome 1",
    "Test added: test_name_here",
    "npm test passes"
  ],
  "status": "pending",
  "completedAt": null
}
```

### Types
- `bug` — something broken that needs fixing
- `refactor` — structural improvement without behavior change
- `feature` — new capability
- `chore` — maintenance, deps, docs, tooling

### Priority
- `1` — highest, do first
- `2` — important
- `3` — normal
- `4` — low, do when nothing more urgent

### Status values (managed by Claude during the loop)
- `pending` — waiting to be worked on
- `in_progress` — currently being worked on
- `done` — completed and verified
- `blocked` — cannot proceed, needs human attention

---

## Writing Good Acceptance Criteria

This is the most important part of the whole system. Vague criteria = unreliable loop.

**Bad criteria:**
```json
["Fix the bug", "Make tests pass"]
```

**Good criteria:**
```json
[
  "GET /api/search?q=test returns 200 when 'filter' param is absent",
  "No TypeError in server logs on this request",
  "Regression test added: test_search_without_filter",
  "npm test passes"
]
```

**The test for good criteria:** Can Claude verify each item programmatically
without human judgment? If yes, it's good. If it requires "looks right" or
"seems better," it's too vague.

**Always include a check command as the last criterion:**
- `npm test passes`
- `pytest passes`
- `npm run typecheck passes`

This gives Claude a definitive pass/fail signal.

---

## Exit Signals

The loop watches for these strings in Claude's output:

| Signal | Meaning | Loop action |
|--------|---------|-------------|
| `RALPH_DONE` | Task completed cleanly | Continue to next iteration |
| `RALPH_BLOCKED:<id>` | Task cannot proceed | Mark blocked, continue to next item |
| `RALPH_NEEDS_HUMAN:<reason>` | Human decision required | Stop loop, send notification |
| *(no signal)* | Claude stopped unexpectedly | Log warning, continue anyway |

When all items are `done` or `blocked` (none `pending` or `in_progress`):
- Loop exits cleanly
- Sends a desktop notification (`notify-send`)
- Writes `.ralph/DONE` file with summary
- Exits with code `0`

---

## When the Loop Finishes

```bash
# What got done
./ralph-status.sh

# Detailed commit history
git log --oneline -20

# Full progress log with learnings
cat .ralph/progress.md

# Any blocked items needing attention
jq '.items[] | select(.status == "blocked")' .ralph/backlog.json

# Check the DONE file
cat .ralph/DONE
```

Review blocked items manually and either fix the blocker or break the item
into smaller pieces before running the loop again.

---

## Tips

**Task sizing is critical.** Each item should be completable in one focused
Claude session (roughly: one isolated change with tests). If you find Claude
is consistently timing out or producing poor work on an item, break it into
smaller pieces.

**progress.md compounds.** The Codebase Patterns section is the most
valuable part of the system over time. Claude writes to it after each task.
Review it periodically — it becomes a living guide to your codebase.

**Run `./ralph.sh 1` before AFK.** Always watch the first iteration manually.
Verify the task, the implementation, and the commit look correct before
letting it run unattended.

**Cost awareness.** Each iteration is a full Claude Code session. 20 iterations
on substantive tasks can consume significant API credits. Set a conservative
`--max-iterations` and monitor. Start with 5–10.

**Interrupted loops.** If the loop is interrupted mid-task, the item will be
left as `in_progress`. On next run, Claude detects this and resumes. If the
work is in a bad state, manually set the item back to `pending` in backlog.json.
