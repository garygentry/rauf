# Ralph Loop (Beads Edition) — Append This to Your CLAUDE.md
# ==============================================================
# DO NOT replace your existing CLAUDE.md with this file.
# Copy the content below and paste it at the END of your CLAUDE.md.
# ==============================================================

---

## Autonomous Loop (Ralph + Beads)

This project uses a shell-driven Ralph loop with Beads (bd) for task tracking.
When running autonomously (invoked via `claude -p`), follow the instructions
in `.ralph/RALPH.md` exactly.

### Task Tracking

- Beads is the ONLY source of truth for tasks. Use `bd` CLI exclusively.
- Do NOT use TodoWrite, TaskCreate, or internal todo lists during Ralph sessions.
- Do NOT use markdown TODO comments as substitutes for Beads issues.
- Discovered work: `bd create "Found: ..." --deps discovered-from:<current-id> --json`

### Core Beads Commands

```bash
bd ready --json                         # What's unblocked? (use this to pick work)
bd list --status in_progress --json     # Anything already started?
bd show <id> --json                     # Full issue details including acceptance criteria
bd update <id> --status in_progress     # Claim a task
bd close <id> --reason "..."            # Mark complete
bd sync                                 # Sync to git — ALWAYS run before exit signal
```

### Quality Gates — Non-Negotiable

Before marking any task done, ALL applicable checks must pass:

```bash
# TypeScript / Node.js
npm run typecheck
npm test

# Python
python -m pytest --tb=short
```

### Beads Commit Convention

```
<type>(<beads-id>): <title>

<one sentence of what was done>

Acceptance criteria verified: all checks passing
```

Types: `fix`, `refactor`, `feat`, `chore`

### Exit Signals (last line of response, nothing after)

- `RALPH_DONE` — task completed, verified, committed, pushed, bd sync run
- `RALPH_BLOCKED:<id>` — task blocked, closed with reason, bd sync run
- `RALPH_DECOMPOSED` — task broken into subtasks, bd sync run
- `RALPH_NEEDS_HUMAN:<reason>` — requires human decision
