# Ralph Loop + Beads — Complete Setup & Usage Guide

Autonomous Claude Code loop using **Beads (bd)** as the task tracker.
Beads replaces the plain `backlog.json` file with a git-native, dependency-aware,
AI-optimized issue tracker that Claude interacts with directly via CLI.

---

## Table of Contents

1. [What's in This Package](#1-whats-in-this-package)
2. [How It Works — Conceptually](#2-how-it-works--conceptually)
3. [Prerequisites](#3-prerequisites)
4. [Installing Beads](#4-installing-beads)
5. [Installing Claude Code](#5-installing-claude-code)
6. [Project Setup (One Time)](#6-project-setup-one-time)
7. [Integrating Beads with Claude Code](#7-integrating-beads-with-claude-code)
8. [Loading Your Backlog into Beads](#8-loading-your-backlog-into-beads)
9. [Running the Loop](#9-running-the-loop)
10. [Scenario: Complete Walkthrough with Example Data](#10-scenario-complete-walkthrough-with-example-data)
11. [Scenario: Resuming an Interrupted Loop](#11-scenario-resuming-an-interrupted-loop)
12. [Scenario: Adding New Work During a Running Loop](#12-scenario-adding-new-work-during-a-running-loop)
13. [Scenario: Discovered Work (Claude Files a Bug During Implementation)](#13-scenario-discovered-work-claude-files-a-bug-during-implementation)
14. [Scenario: A Task Is Too Large — Decomposition](#14-scenario-a-task-is-too-large--decomposition)
15. [Scenario: A Task Is Blocked](#15-scenario-a-task-is-blocked)
16. [Scenario: All Work Is Done](#16-scenario-all-work-is-done)
17. [Monitoring a Running Loop](#17-monitoring-a-running-loop)
18. [Working with Beads Manually (Cheat Sheet)](#18-working-with-beads-manually-cheat-sheet)
19. [Beads vs. backlog.json — Key Differences](#19-beads-vs-backlogjson--key-differences)
20. [Troubleshooting](#20-troubleshooting)
21. [Cost Awareness](#21-cost-awareness)

---

## 1. What's in This Package

```
ralph.sh              ← Main loop runner
ralph-status.sh       ← Quick status check via bd
ralph-add.sh          ← Add new Beads issues from CLI
seed-beads.sh         ← Load example backlog into Beads (run once)
CLAUDE_ADDON.md       ← Content to append to your existing CLAUDE.md
.ralph/
  RALPH.md            ← Agent instructions (injected into every iteration)
  progress.md        ← Cumulative learnings log (Claude writes to this)
```

**Not included but created during setup:**
```
.beads/               ← Beads database (created by bd init)
  beads.jsonl         ← Git-portable issue records
  ...                 ← SQLite + Dolt state
```

---

## 2. How It Works — Conceptually

```
Human sets up Beads backlog
         │
         ▼
ralph.sh starts loop
         │
         ▼
┌────────────────────────────────────────────────┐
│  Iteration N:                                  │
│                                                │
│  1. git pull --rebase                          │
│  2. bd ready --json → is there work?          │
│  3. If none → notify + exit                   │
│  4. bd prime → generate context digest        │
│  5. Inject RALPH.md + bd prime + progress.md │
│  6. claude -p (fresh session, no history)     │
│                                                │
│  Claude:                                       │
│    bd list --status in_progress → resume?     │
│    bd ready --json → pick task                │
│    bd update <id> --status in_progress        │
│    [implement, test, fix]                      │
│    bd close <id> --reason "..."               │
│    git add -A && git commit && git push       │
│    bd sync                                    │
│    Output: RALPH_DONE (last line)             │
│                                                │
│  7. Loop detects RALPH_DONE                    │
│  8. Sleep 3s → next iteration                 │
└────────────────────────────────────────────────┘
         │
         ▼
   (repeat until no ready work or max iterations)
```

**Key difference from backlog.json version:** Beads uses hash-based IDs (e.g. `bd-a3f8`), dependency tracking, and `bd ready` returns only topologically unblocked tasks — Claude never has to reason about dependencies manually.

---

## 3. Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| Linux (Ubuntu/Debian) | ✓ | This guide targets Linux |
| `git` | ✓ | Beads stores state in git |
| `jq` | ✓ | JSON parsing in shell scripts |
| `curl` | ✓ | For install scripts |
| `bd` (Beads) | ✓ | Task tracker |
| `claude` (Claude Code) | ✓ | The AI agent |
| `notify-send` | Optional | Desktop notifications on completion |

---

## 4. Installing Beads

### Option A: Install Script (recommended for Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
```

This installs a pre-built binary to `/usr/local/bin/bd` and handles dependencies.

### Option B: npm

```bash
npm install -g @beads/bd
```

### Option C: Homebrew (if you have it on Linux)

```bash
brew install bd
```

### Option D: Go (if you have Go installed)

```bash
go install github.com/steveyegge/beads/cmd/bd@latest
```

### Verify installation

```bash
bd --version
# Expected: something like "bd version 0.44.x"
```

### Run the health check

```bash
bd doctor
```

If you see warnings, `bd doctor` will tell you what to fix. Most common fix for fresh installs:

```bash
# If bd is not in PATH after install script:
export PATH="$PATH:$HOME/.local/bin"
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.bashrc
source ~/.bashrc
```

---

## 5. Installing Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | bash

# Authenticate
claude auth login
```

Verify:
```bash
claude --version
claude -p "say hello" --output-format text
```

---

## 6. Project Setup (One Time)

Run from your project root:

```bash
# 1. Make scripts executable
chmod +x ralph.sh ralph-status.sh ralph-add.sh seed-beads.sh

# 2. Install jq
sudo apt install jq

# 3. Initialize Beads in your project
#    --quiet runs non-interactively (no prompts)
bd init --quiet

# 4. Run health check to confirm setup
bd doctor
```

Expected `bd doctor` output after `bd init`:
```
Diagnostics
├ Installation: .beads/ directory found
├ Git Hooks: All recommended hooks installed
├ Database: healthy
├ CLI Version: 0.44.x (latest)
├ JSONL Files: Using beads.jsonl
├ DB-JSONL Sync: In sync
├ Permissions: OK
├ Dependency Cycles: None
├ Claude Integration: Not configured ⚠  ← we'll fix this next
└ bd in PATH: OK
```

### What bd init creates

```
.beads/
├── beads.jsonl      ← Human-readable, git-portable issue records
└── ...              ← SQLite + Dolt internal state
```

**Commit `.beads/` to git** so the task state travels with your code:
```bash
git add .beads/ .ralph/ ralph.sh ralph-status.sh ralph-add.sh seed-beads.sh
git commit -m "chore: add ralph-beads loop setup"
```

> **Stealth mode (optional):** If you're working on a shared project and don't
> want to commit Beads files to the main repo, use `bd init --stealth` instead.
> Your task state lives in `~/.beads-planning/` and never appears in the repo.

---

## 7. Integrating Beads with Claude Code

This step makes Beads inject context at the start of every Claude Code session and sync before context compaction.

### Quick setup (recommended)

```bash
bd setup claude
```

This installs two hooks into Claude Code automatically:
- **SessionStart hook** — runs `bd prime` which injects ~1-2k tokens of Beads context
- **PreCompact hook** — runs `bd sync` before Claude's context compacts, preserving state

### Verify the integration

```bash
bd setup claude --check
```

Expected output:
```
Claude Code integration:
  ✓ SessionStart hook installed (bd prime)
  ✓ PreCompact hook installed (bd sync)
  ✓ Integration verified
```

### Manual setup (if bd setup claude fails)

Edit `.claude/settings.json` in your project (create if it doesn't exist):

```json
{
  "hooks": {
    "SessionStart": ["bd prime"],
    "PreCompact": ["bd sync"]
  }
}
```

### Install the optional Claude Code Plugin (enhanced UX)

If you want slash commands in interactive Claude Code sessions:

```bash
# Inside Claude Code terminal:
/plugin marketplace add steveyegge/beads
/plugin install beads
# Restart Claude Code
```

This adds slash commands for manual use:
- `/beads:ready` — show unblocked tasks
- `/beads:create` — create an issue
- `/beads:show <id>` — show issue details
- `/beads:update <id>` — update an issue
- `/beads:close <id>` — close an issue

> **For Ralph loop operation, the plugin is optional.** The shell loop injects
> context directly via `bd prime` output and Claude uses `bd` CLI commands.
> The plugin is most useful for interactive Claude Code sessions.

### Append to your existing CLAUDE.md

```bash
cat CLAUDE_ADDON.md >> CLAUDE.md
```

This tells Claude (in both interactive and headless modes) to use `bd` exclusively
for task tracking and never fall back to TodoWrite or internal todo lists.

---

## 8. Loading Your Backlog into Beads

### Option A: Use the provided seed script (example data)

```bash
./seed-beads.sh
```

This creates 8 example issues in Beads equivalent to the example backlog:
- 2 bugs (priority 1)
- 2 features (priority 2)
- 2 refactors (priority 2-3)
- 2 chores (priority 3-4)

Expected output:
```
Seeding Beads with example Ralph backlog...

Creating bugs...
  ✓ Bug 1: bd-a3f8 — API 500 on missing optional param
  ✓ Bug 2: bd-c2e1 — Data processor crash on empty CSV

Creating features...
  ✓ Feature 1: bd-f7d4 — API pagination
  ✓ Feature 2: bd-b9a3 — Python dry-run flag

Creating refactors...
  ✓ Refactor 1: bd-e5c2 — Extract validator module
  ✓ Refactor 2: bd-d8b1 — Replace console.log with logger

Creating chores...
  ✓ Chore 1: bd-g2h5 — Update npm deps
  ✓ Chore 2: bd-h4k7 — Add Python docstrings

Syncing to git...

============================================
Seeding complete! Summary:

  Bugs (priority 1):     bd-a3f8, bd-c2e1
  Features (priority 2): bd-f7d4, bd-b9a3
  Refactors (p2-3):      bd-e5c2, bd-d8b1
  Chores (p3-4):         bd-g2h5, bd-h4k7

What's ready to work on:
  [1] bd-a3f8: API returns 500 on missing optional query parameter
  [1] bd-c2e1: Python data processor crashes on empty input file
  [2] bd-f7d4: Add pagination to the /api/items list endpoint
  ...

Next step: ./ralph.sh [max_iterations]
============================================
```

> **Note on IDs:** Beads generates hash-based IDs (like `bd-a3f8`) automatically.
> Your actual IDs will differ from examples in this README. Always use
> `bd ready --json` to get the real IDs for your installation.

### Option B: Add your own issues

Use `ralph-add.sh` interactively:
```bash
./ralph-add.sh
```

Or with flags:
```bash
./ralph-add.sh \
  --type bug \
  --priority 1 \
  --title "Login fails with special characters in password" \
  --description "Users with passwords containing & or # cannot log in. Returns 401." \
  --acceptance "Test added for special chars|Login succeeds with & # % in password|npm test passes"
```

Or use `bd create` directly:
```bash
bd create "Fix login with special characters" \
  --description="Users with & or # in passwords get 401. Root cause: URL encoding." \
  -t bug -p 1 --json
```

### View what's in Beads

```bash
bd list                          # All issues (human-readable)
bd list --json                   # All issues (JSON)
bd ready                         # Unblocked, sorted by priority
bd ready --json                  # Same, machine-readable
bd show bd-a3f8 --json           # Full details of one issue
```

---

## 9. Running the Loop

```bash
# Default: up to 20 iterations
./ralph.sh

# Custom max iterations
./ralph.sh 10

# Test a single iteration before going AFK
./ralph.sh 1
```

**Always test with `./ralph.sh 1` first.** Watch the first iteration fully
before running unattended. Verify Claude picks the right task, does reasonable
work, outputs `RALPH_DONE`, and the commit looks correct.

---

## 10. Scenario: Complete Walkthrough with Example Data

This section walks through the entire lifecycle using the example issues from
`seed-beads.sh`. Your actual Beads IDs will differ — substitute accordingly.

### Step 1: Verify the starting state

```bash
$ bd ready
[1] bd-a3f8: API returns 500 on missing optional query parameter
[1] bd-c2e1: Python data processor crashes on empty input file
[2] bd-f7d4: Add pagination to the /api/items list endpoint
[2] bd-b9a3: Add Python CLI flag for dry-run mode
[2] bd-e5c2: Extract inline validation logic into dedicated validator module
[3] bd-d8b1: Replace console.log debug statements with structured logger
[3] bd-g2h5: Update npm dependencies to latest minor/patch versions
[4] bd-h4k7: Add missing docstrings to public Python functions
```

All 8 issues are ready (none have blocking dependencies, so all appear).
Beads returns them sorted by priority: bugs first (p1), then features/refactors
(p2), then lower priorities.

### Step 2: Run the loop (5 iterations to start)

```bash
$ ./ralph.sh 5
[2026-02-20 14:00:00] ============================================
[2026-02-20 14:00:00] Ralph-Beads Loop starting | max=5 iterations
[2026-02-20 14:00:00] Beads status:
[2026-02-20 14:00:00]   [1] bd-a3f8: [bug] API returns 500... [open]
[2026-02-20 14:00:01]   [1] bd-c2e1: [bug] Python data processor... [open]
[2026-02-20 14:00:01]   ...
[2026-02-20 14:00:01]
[2026-02-20 14:00:01] --- Iteration 1 / 5 ---
[2026-02-20 14:00:01] Work available — ready:8  in_progress:0
```

**What Claude does in Iteration 1:**

Claude receives the prompt containing RALPH.md, `bd prime` output, and the
progress log. It runs:

```bash
# Check for interrupted work
bd list --status in_progress --json   # → empty array

# Find next task
bd ready --json
# → Returns bd-a3f8 first (priority 1 bug)

# Read full details
bd show bd-a3f8 --json
# → Shows title, description, acceptance criteria

# Claim it
bd update bd-a3f8 --status in_progress --json
git add .beads/ && git commit -m "chore(ralph): start bd-a3f8 - API 500 on missing param"
git push

# ... runs quality baseline checks ...
# npm run typecheck 2>&1 | tail -5
# npm test -- --passWithNoTests 2>&1 | tail -10

# Reproduces the bug — writes failing test
# Finds the undefined check bug in src/routes/search.ts
# Fixes: adds `const filter = req.query.filter ?? null;`
# Test passes

# Verify
npm run typecheck   # ✓
npm test            # ✓ 15 passing, 0 failing (including new test)

# Close bead
bd close bd-a3f8 --reason "Fixed undefined check in search route, added regression test in test/routes/search.test.ts"

# Commit everything
git add -A
git commit -m "fix(bd-a3f8): API 500 on missing optional query parameter

Added null coalescing for optional 'filter' param in /api/search route.
Added regression test: GET /api/search?q=test now returns 200.

Acceptance criteria verified: all checks passing"
git push

# Sync Beads
bd sync
```

Output (last line): `RALPH_DONE`

**Loop log after Iteration 1:**
```
[2026-02-20 14:07:32] ✓ Clean completion signal received
[2026-02-20 14:07:35] --- Iteration 2 / 5 ---
[2026-02-20 14:07:35] Work available — ready:7  in_progress:0
```

### Step 3: Watch Iteration 2 (second bug)

Claude picks `bd-c2e1` (next priority 1 bug — Python data processor crash).

```bash
# Claude's bd commands in iteration 2:
bd list --status in_progress --json    # → empty
bd ready --json                         # → bd-c2e1 is now first (bd-a3f8 is closed)
bd show bd-c2e1 --json                  # → reads acceptance criteria
bd update bd-c2e1 --status in_progress
git commit -m "chore(ralph): start bd-c2e1 - Python data processor crash"

# Implements fix in data_processor.py
# Adds pytest test: test_empty_input_returns_empty_result
# Runs: python -m pytest --tb=short

bd close bd-c2e1 --reason "Added early return for empty CSV, added pytest test"
git add -A && git commit -m "fix(bd-c2e1): ..." && git push
bd sync
```

Output: `RALPH_DONE`

### Step 4: Continuing through the backlog

By the end of 5 iterations, both bugs are done and Claude is into the features:

```bash
$ bd list --json | jq -r '.[] | "\(.id): \(.status) - \(.title)"'
bd-a3f8: closed - API returns 500 on missing optional query parameter
bd-c2e1: closed - Python data processor crashes on empty input file
bd-f7d4: closed - Add pagination to the /api/items list endpoint
bd-b9a3: in_progress - Add Python CLI flag for dry-run mode  ← iteration 4 started this
bd-e5c2: open - Extract inline validation logic...
bd-d8b1: open - Replace console.log debug statements...
bd-g2h5: open - Update npm dependencies...
bd-h4k7: open - Add missing docstrings...
```

### Step 5: After the loop finishes all work

```bash
$ bd ready
(no output — nothing unblocked and open)

$ bd list --json | jq -r '.[] | "\(.status): \(.title)"'
closed: API returns 500 on missing optional query parameter
closed: Python data processor crashes on empty input file
closed: Add pagination to the /api/items list endpoint
closed: Add Python CLI flag for dry-run mode
closed: Extract inline validation logic into dedicated validator module
closed: Replace console.log debug statements with structured logger
closed: Update npm dependencies to latest minor/patch versions
closed: Add missing docstrings to public Python functions

$ cat .ralph/DONE
All work complete. Iterations used: 8 | Time: 127m

$ git log --oneline -10
a9f3c2b fix(bd-h4k7): Add Python docstrings to public functions
b7e1d4a chore(bd-g2h5): Update npm deps to latest minor/patch
c5a2f9e fix(bd-d8b1): Replace console.log with structured logger
d3c8b6e refactor(bd-e5c2): Extract validation into validator module
e1b4a7d feat(bd-b9a3): Add --dry-run flag to Python CLI
f9e2c3b feat(bd-f7d4): Add cursor-based pagination to /api/items
g7d5e1a fix(bd-c2e1): Handle empty CSV input in data_processor
h4b2f8c fix(bd-a3f8): Fix 500 on missing optional query parameter
```

---

## 11. Scenario: Resuming an Interrupted Loop

The loop was interrupted (Ctrl+C, power loss, SSH disconnect) mid-task.

### What state looks like

```bash
$ bd list --status in_progress --json | jq -r '.[].id'
bd-f7d4
```

There's an issue stuck `in_progress` from the interrupted session.

### Check what was done

```bash
$ git log --oneline -3
c7a3f1b chore(ralph): start bd-f7d4 - Add pagination to /api/items
...

$ bd show bd-f7d4 --json | jq '{title,status,notes}'
{
  "title": "Add pagination to the /api/items list endpoint",
  "status": "in_progress",
  "notes": null
}
```

The start commit was made but no implementation commit.

### Simply restart the loop

```bash
./ralph.sh 10
```

Claude's first action every iteration is:
```bash
bd list --status in_progress --json
```

If it returns an issue, Claude resumes that one. It reads the git log to
understand what was done, checks if any code changes were left uncommitted
(`git status`, `git diff`), and continues from there.

**Claude's Iteration 1 (resume mode):**
```bash
bd list --status in_progress --json   # → bd-f7d4
bd show bd-f7d4 --json                # reads full details
git log --oneline -5                  # sees the start commit
git status                            # checks for partial work
# ... resumes implementation ...
bd close bd-f7d4 --reason "Completed pagination implementation"
git add -A && git commit && git push
bd sync
```

Output: `RALPH_DONE`

You don't need to manually reset anything. Beads' `in_progress` status is
the resume signal.

---

## 12. Scenario: Adding New Work During a Running Loop

The loop is running. You realize there's a bug that needs fixing. Add it
without stopping the loop.

### Terminal 2 (while loop runs in Terminal 1):

```bash
$ ./ralph-add.sh \
  --type bug \
  --priority 1 \
  --title "Rate limiter blocks legitimate users after server restart" \
  --description "The in-memory rate limiter resets on server restart but Redis TTLs persist, causing legitimate users to be blocked. Restart the rate limit store on server boot or use Redis as source of truth." \
  --acceptance "Server restart does not cause erroneous rate limit blocks|Existing blocks are re-evaluated correctly|npm test passes"

Creating issue in Beads...
{
  "id": "bd-k9m2",
  "title": "Rate limiter blocks legitimate users after server restart",
  "status": "open",
  "priority": 1
  ...
}

✓ Created issue bd-k9m2: [bug] Rate limiter blocks legitimate users after server restart
```

**What happens next:** On the next iteration, `bd ready --json` returns
`bd-k9m2` first (priority 1 bug, higher than the current remaining work).
Claude picks it up automatically.

### Direct bd create (fastest):

```bash
bd create "Fix rate limiter on server restart" \
  --description="In-memory store resets but Redis TTLs persist on restart." \
  -t bug -p 1 --json

bd sync  # push to git so it's visible across sessions
```

---

## 13. Scenario: Discovered Work (Claude Files a Bug During Implementation)

Claude is working on the pagination feature (`bd-f7d4`) and discovers that
the database query used by the endpoint has an N+1 query problem.

**What Claude does during implementation:**

```bash
# Claude discovers a related issue
bd create "N+1 query problem in items repository" \
  --description="While implementing pagination for GET /api/items, discovered that fetchItem() calls the DB once per result row instead of batching. At 50 items per page this is 51 queries per request. Needs eager loading or batch fetch." \
  -t bug -p 2 \
  --deps discovered-from:bd-f7d4 --json

# Output: { "id": "bd-n3p8", ... }
```

This creates a dependency link: `bd-n3p8` was discovered from `bd-f7d4`.

### What you see after the iteration:

```bash
$ bd show bd-n3p8 --json | jq '{id,title,deps}'
{
  "id": "bd-n3p8",
  "title": "N+1 query problem in items repository",
  "deps": [
    { "type": "discovered-from", "id": "bd-f7d4" }
  ]
}

$ bd dep tree bd-n3p8
bd-n3p8  N+1 query problem in items repository
  discovered-from: bd-f7d4 (Add pagination to /api/items) [closed]
```

The discovered issue is ready on the next iteration:
```bash
$ bd ready
[2] bd-n3p8: N+1 query problem in items repository
...
```

---

## 14. Scenario: A Task Is Too Large — Decomposition

The loop hits the "Add pagination" feature and Claude determines it's too
large for one session (requires schema changes, migration, TypeScript types,
tests, and documentation updates).

**Claude's decomposition flow:**

```bash
# Create subtasks
bd create "Add pagination schema: nextCursor field to items response" \
  --description="Add nextCursor and total to ItemsResponse type. Update OpenAPI spec." \
  -t task -p 2 \
  --deps discovered-from:bd-f7d4 --json
# → bd-p1q2

bd create "Implement cursor-based pagination logic in items service" \
  --description="Implement the limit/cursor query params. Use opaque base64 cursor encoding. Default limit 50, max 200." \
  -t task -p 2 \
  --deps discovered-from:bd-f7d4 --json
# → bd-q3r4

bd create "Add pagination integration tests for /api/items" \
  --description="Test: default page, explicit limit, cursor nav, limit exceeded, last page." \
  -t task -p 2 \
  --deps discovered-from:bd-f7d4 --json
# → bd-r5s6

# Close the oversized original
bd close bd-f7d4 \
  --reason "Decomposed into bd-p1q2 (schema), bd-q3r4 (logic), bd-r5s6 (tests)"

bd sync
git add .beads/ && git commit -m "chore(ralph): decompose bd-f7d4 into 3 subtasks"
git push
```

Output: `RALPH_DECOMPOSED`

**Next iteration:** `bd ready` returns `bd-p1q2`, `bd-q3r4`, `bd-r5s6` — all
three subtasks, sorted by priority. Claude picks the first one.

```bash
$ bd ready --json | jq -r '.[].id'
bd-p1q2
bd-q3r4
bd-r5s6
bd-c2e1   # (other work still waiting)
...
```

---

## 15. Scenario: A Task Is Blocked

Claude is working on the rate limiter bug and discovers it requires a Redis
connection that isn't configured in the development environment.

**Claude's handling:**

```bash
# Add a clear note to the issue
bd update bd-k9m2 \
  --notes "BLOCKED: Fix requires Redis connection (REDIS_URL env var). Dev environment has no Redis instance configured. Cannot test or implement without Redis available."

# Close with a blocked reason (so the loop knows to move on)
bd close bd-k9m2 \
  --reason "BLOCKED: Needs Redis in dev environment — REDIS_URL not configured. See notes."

bd sync
git push
```

Output: `RALPH_BLOCKED:bd-k9m2`

**Loop behavior:** The loop logs the blocked signal and continues to the next
iteration. The issue is now closed with a blocked reason visible in the notes.

**You fix the blocker:** Set up Redis in your dev environment.

**Reopening the issue:**

```bash
# Beads doesn't have a "blocked" status — we closed it with a reason.
# Create a new issue to retry, or reopen if your bd version supports it:
bd create "Fix rate limiter on server restart (retry — Redis now available)" \
  --description="Original: bd-k9m2. Redis is now configured. Implement fix." \
  -t bug -p 1 --json

# Or check if bd reopen is available in your version:
bd reopen bd-k9m2 2>/dev/null || echo "Use bd create for a new issue"
```

---

## 16. Scenario: All Work Is Done

After 8 iterations (one per issue):

**Loop output:**
```
[2026-02-20 16:07:44] ============================================
[2026-02-20 16:07:44] COMPLETE: All work complete. Iterations used: 8 | Time: 127m
[2026-02-20 16:07:44] NOTIFICATION: All work complete. Iterations used: 8 | Time: 127m
```

A desktop notification fires (if `notify-send` is installed), a terminal bell
rings, and `.ralph/DONE` is written.

**What to do after:**

```bash
# Full status
./ralph-status.sh

# Review what was accomplished
git log --oneline -20

# Read accumulated learnings
cat .ralph/progress.md

# Check if anything got blocked
bd list --status open --json | jq '.[] | "\(.id): \(.title)"'

# Review Beads history
bd list --json | jq -r '.[] | "\(.status): \(.title)"'

# Stats
bd stats 2>/dev/null || bd list --json | jq 'group_by(.status) | .[] | "\(.[0].status): \(length)"'
```

---

## 17. Monitoring a Running Loop

Open a second terminal while the loop runs in the first.

### Quick check

```bash
./ralph-status.sh
```

### Live watch (refreshes every 15 seconds)

```bash
watch -n 15 ./ralph-status.sh
```

### Follow the log

```bash
tail -f .ralph/ralph.log
```

### Watch commits roll in

```bash
watch -n 10 'git log --oneline -10'
```

### Full Beads view

```bash
# All open issues
bd list --status open

# What's in progress right now
bd list --status in_progress --json | jq -r '.[] | "\(.id): \(.title)"'

# Dependency tree for a specific issue
bd dep tree bd-f7d4
```

---

## 18. Working with Beads Manually (Cheat Sheet)

### Creating issues

```bash
# Minimal
bd create "Fix the thing" -t bug -p 1 --json

# Full
bd create "Fix the thing" \
  --description="What's broken and how to reproduce it" \
  -t bug -p 1 --json

# Discovered during another task
bd create "Found: related issue" \
  --description="Context from discovery" \
  -t bug -p 2 \
  --deps discovered-from:<parent-id> --json

# Create an epic (group of related tasks)
bd create "Feature: User Authentication" -t epic -p 1 --json

# Create a task under an epic
bd create "Implement JWT handling" \
  --parent <epic-id> \
  -t task -p 2 --json
```

### Querying

```bash
bd ready                         # What's unblocked, sorted by priority
bd ready --json                  # Same, machine-readable
bd ready --priority 1            # Only priority 1 issues that are ready
bd list                          # All issues
bd list --status open            # Open only
bd list --status closed          # Closed only
bd list --status in_progress     # In progress
bd list --type bug               # Filter by type
bd list --priority 1             # Filter by priority
bd show <id>                     # Human-readable detail
bd show <id> --json              # Machine-readable detail
bd blocked                       # Issues that are blocked by dependencies
bd stale --days 14               # Issues with no activity in 14 days
bd dep tree <id>                 # Visual dependency tree
```

### Updating issues

```bash
bd update <id> --status in_progress --json
bd update <id> --status open --json          # Revert to open
bd update <id> --priority 0 --json           # Escalate to critical
bd update <id> --notes "progress note" --json
bd update <id> --title "New title" --json
bd update <id> --description "New desc" --json
bd update <id> --acceptance "New criteria" --json
```

> **Important:** Never use `bd edit` — it opens an interactive `$EDITOR` which
> doesn't work in headless/agent contexts. Always use `bd update` flags.

### Dependencies

```bash
# a blocks b (b can't start until a is done)
bd dep add <b-id> <a-id> --type blocks

# Discovered from parent
bd dep add <new-id> <parent-id> --type discovered-from

# Related (informational, doesn't affect bd ready)
bd dep add <a-id> <b-id> --type related-to

# View dependencies
bd dep list <id>
bd dep tree <id>
```

### Closing and syncing

```bash
bd close <id> --reason "Implemented in commit abc123"
bd close <id> --reason "BLOCKED: needs Redis — see notes"
bd sync                                       # Always run after mutations
```

### Git integration

```bash
# Install git hooks for automatic JSONL sync
bd hooks install

# Manual sync (export JSONL, commit, pull, push)
bd sync

# Check sync status
bd info
```

---

## 19. Beads vs. backlog.json — Key Differences

| Aspect | backlog.json version | Beads version |
|--------|---------------------|---------------|
| Task IDs | Sequential: `001`, `002` | Hash-based: `bd-a3f8` |
| Status values | `pending`, `in_progress`, `done`, `blocked` | `open`, `in_progress`, `closed` |
| Dependency tracking | None — Claude reasons about order | Native — `bd ready` enforces ordering |
| Discovered work | Claude adds to backlog.json | `bd create --deps discovered-from:...` |
| Claude reads tasks | Loop injects JSON snapshot | `bd prime` generates context digest |
| Human adds tasks | Edit backlog.json directly | `bd create` or `./ralph-add.sh` |
| State travels with code | Yes (JSON file) | Yes (JSONL in .beads/) |
| Conflict resolution | Last-write-wins | Dolt cell-level merge |
| Context window cost | Full JSON every iteration | ~1-2k tokens via `bd prime` |
| "What's ready?" | Loop scans JSON for `pending` | `bd ready` topological sort |
| Blocked detection | Manual `blocked: true` field | Automatic via dependency graph |
| History / audit trail | Git log of backlog.json changes | Dolt + JSONL + git log |

---

## 20. Troubleshooting

### `bd: command not found`

```bash
# Find where it was installed
find ~/.local/bin /usr/local/bin -name "bd" 2>/dev/null

# Add to PATH
export PATH="$PATH:$HOME/.local/bin"
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.bashrc
source ~/.bashrc
```

### `bd doctor` shows Claude integration warnings

```bash
bd setup claude
bd setup claude --check   # Verify
```

### `bd ready` returns nothing but `bd list` shows open issues

The open issues have unfulfilled dependencies. View them:
```bash
bd blocked
bd dep list <id>    # For a specific issue
```

To force an issue ready (remove its blocking dependency):
```bash
bd dep remove <blocked-id> <blocking-id>
```

### `bd sync` fails (network/git errors)

```bash
# Check git remote
git remote -v

# If no remote, sync is a no-op (local only)
# Push manually when you have connectivity:
git push

# Or check sync status
bd info
bd daemons health
```

### Claude doesn't output RALPH_DONE

The loop logs a warning and continues. Check the log:
```bash
tail -100 .ralph/ralph.log | grep -A 20 "Iteration"
```

The Claude session may have timed out, hit an error, or gotten stuck.
Check the most recent Beads state:
```bash
bd list --status in_progress --json
```

If an issue is stuck `in_progress`, the next iteration resumes it.
If you want to reset: close it manually with a note.

```bash
bd close bd-xxxx --reason "Session ended unexpectedly — retry"
bd sync
```

### Loop exits immediately on first check

```bash
$ ./ralph.sh 5
[...] COMPLETE: No ready work — N open issues are all blocked or deferred.
```

This means all open issues have unresolved dependencies. Check:
```bash
bd blocked
bd dep list --json | jq '.'
```

Fix by resolving the dependencies or removing them.

### Beads state diverged from git

```bash
bd sync        # Re-export, commit, pull, push
bd doctor      # Check for issues
```

If JSONL is corrupted:
```bash
# Accept remote version
git checkout --theirs .beads/beads.jsonl
bd import -i .beads/beads.jsonl
```

---

## 21. Cost Awareness

Each iteration of the Ralph loop is a complete Claude Code session. Costs scale
with the number of iterations and the complexity of each task.

**Rough estimates (Claude Sonnet):**
- Simple bug fix: $0.50–2.00
- Moderate refactor: $1.00–4.00
- New feature: $2.00–8.00
- 8-item backlog like the example: $8–30 total

**Tips to manage costs:**

Start conservative: `./ralph.sh 5` before going AFK. Confirm quality is good, then extend.

Set appropriate task sizes. Tasks that require decomposition (`RALPH_DECOMPOSED`)
cost one iteration just for planning — make sure tasks are right-sized before starting the loop.

Monitor with `tail -f .ralph/ralph.log`. You can Ctrl+C the loop at any time — Beads
state is consistent because Claude syncs before exiting each iteration.

The `bd prime` context digest (~1-2k tokens) is more efficient than injecting
the full JSONL every iteration — this is a meaningful saving over the backlog.json
approach when you have many issues.
