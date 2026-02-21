# Ralph — Per-Iteration Instructions

<!-- ralph:managed:start -->
## Verification Commands

Before marking any task as complete, run the full verification pipeline:

```
pnpm test && pnpm -r typecheck
```

Individual commands:
- Test: `pnpm test`
- Typecheck: `pnpm -r typecheck`
- Lint: `pnpm -r lint`
- Build: `pnpm build`
- Format: `pnpm run format:check`

If any command is not configured (empty), skip it.
<!-- ralph:managed:end -->

## Workflow

1. You are one iteration of an autonomous coding loop
2. Read `.ralph/backlog.json` — your current task is the `in_progress` item
3. Read the item's `acceptanceCriteria` — each must pass
4. Read `.ralph/progress.md` for context from previous iterations
5. Implement the task
6. Run verification: `pnpm test && pnpm -r typecheck`
7. Commit with: `[ralph] <id>: <title>`
8. Output your exit signal:
   - `RALPH_DONE` — all criteria met, verification passes
   - `RALPH_BLOCKED:<reason>` — cannot proceed, explain why
   - `RALPH_NEEDS_HUMAN:<reason>` — need human decision or input

## Important Rules

- Work on ONE item only — the current `in_progress` item
- Do NOT modify `.ralph/backlog.json` status — the loop runner manages it
- Do NOT modify `.ralph/state.json` — the loop runner manages it
- DO read `.ralph/progress.md` for accumulated learnings
- DO append new learnings to `.ralph/progress.md` if you discover important patterns
- The backlog.json file is your source of truth for what to work on
- Claude Code Tasks (if you use them internally) are your own planning tool — they don't affect the backlog

## Project-Specific Instructions

### Architecture
- This is a pnpm monorepo with packages/core, packages/cli, packages/web
- **core has ZERO imports from cli or web** — it is the shared foundation
- All filesystem logic lives in core
- Both cli and web import from core

### Key Patterns
- All core functions return Result<T, RalphError> — never throw for expected errors
- All file writes use atomic pattern: write .tmp → rename (with .bak for backlog)
- Path validation before any write: resolve + startsWith check
- Zod schemas are the single source of truth for data shapes
- Reference docs/ for specifications before implementing

### Documentation
Before starting work, read the relevant spec document:
- `docs/ARCHITECTURE.md` — system overview
- `docs/SCHEMAS.md` — all data types
- `docs/SPEC-CORE.md` — core package logic
- `docs/SPEC-CLI.md` — CLI commands
- `docs/SPEC-WEB.md` — API + frontend
- `docs/SPEC-ARTIFACTS.md` — artifact templates
- `docs/CLAUDE-CODE-TASKS.md` — Tasks vs backlog relationship
