# Ralph Loop — Append This Section to Your Existing CLAUDE.md
# ==============================================================
# DO NOT replace your existing CLAUDE.md with this file.
# Copy the content below and paste it at the END of your CLAUDE.md.
# ==============================================================

---

## Autonomous Loop (Ralph)

This project uses a shell-driven Ralph loop for autonomous task execution.
When running autonomously (invoked via `claude -p`), follow the instructions
in `.ralph/RALPH.md` exactly.

### Task Tracking

- The backlog lives at `.ralph/backlog.json` — this is the single source of truth
- Do NOT use TodoWrite, TaskCreate, or internal todo lists during Ralph sessions
- Do NOT use markdown TODO comments in code as a substitute for backlog items
- If you discover work that needs doing, add it to `.ralph/backlog.json` directly

### Quality Gates — Non-Negotiable

Before marking any task done, ALL applicable checks must pass:

```bash
# TypeScript / Node.js
npm run typecheck
npm test

# Python
python -m pytest --tb=short
```

Never mark a task done with failing tests. Never skip the quality gate.

### Exit Signals

Your very last line of output must be one of:
- `RALPH_DONE` — task completed successfully
- `RALPH_BLOCKED:<id>` — task cannot proceed, marked blocked in backlog
- `RALPH_NEEDS_HUMAN:<reason>` — requires human decision before continuing

### Commit Convention

```
<type>(<id>): <title>

<one sentence of what was done>

Acceptance criteria verified: all checks passing
```

Types: `fix`, `refactor`, `feat`, `chore`
