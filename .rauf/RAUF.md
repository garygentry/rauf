# Rauf — Per-Iteration Instructions

<!-- rauf:managed:start -->

## Verification Commands

Before marking any task as complete, run the full verification pipeline:

```
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format:check
```

Individual commands:
- Test: `pnpm test`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Build: `pnpm build`
- Format: `pnpm format:check`

If any command is not configured (empty), skip it.
<!-- rauf:managed:end -->

## Workflow

1. You are one iteration of an autonomous coding loop
2. Read `.rauf/backlog.json` — your current task is the `in_progress` item
3. Read the item's `acceptanceCriteria` — each must pass
4. Read `.rauf/progress.md` for context from previous iterations
5. Implement the task
6. Run verification: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format:check`
7. Leave your changes in the working tree — do NOT commit. The loop runner commits automatically with `[rauf] <id>: <title>` after you signal `RAUF_DONE`.
8. Output your exit signal:
   - `RAUF_DONE` — all criteria met, verification passes
   - `RAUF_BLOCKED:<reason>` — cannot proceed, explain why
   - `RAUF_NEEDS_HUMAN:<reason>` — need human decision or input

## Important Rules

- Work on ONE item only — the current `in_progress` item
- Do NOT run `git commit` or `git add` — the loop runner stages and commits your work automatically. Committing yourself causes a duplicate commit and triggers per-iteration commit hooks.
- Do NOT modify `.rauf/backlog.json` status — the loop runner manages it
- Do NOT modify `.rauf/state.json` — the loop runner manages it
- DO read `.rauf/progress.md` for accumulated learnings
- DO append new learnings to `.rauf/progress.md` if you discover important patterns
- The backlog.json file is your source of truth for what to work on
- Claude Code Tasks (if you use them internally) are your own planning — they don't affect the backlog

## Project-Specific Instructions
<!-- Add custom instructions below this line — they survive rauf update -->
