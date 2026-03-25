# Progress & Learnings

## Codebase Patterns
<!-- Patterns discovered during development will be logged here -->

## Session Log
<!-- Each iteration appends its learnings here -->

### 001 — Scaffold new core modules (2026-03-25)
- All scaffold files (backlog-root.ts, lock.ts) were already created by previous iterations
- Fixed bug in `resetProject` (`packages/core/src/reset.ts`): clearBacklog was blanking `project` and `description` fields; should preserve metadata and only empty `items[]`
- The core reset.test.ts and CLI backlog-commands.test.ts had contradictory expectations for this behavior — aligned both to preserve metadata
- Pre-existing lint errors in `installer.ts:356` and `schemas.test.ts:204` (unused vars) — not related to multi-backlog work
- Web test `GET /api/config > returns default config` is flaky — fails intermittently with 500 instead of 200
- The barrel export in index.ts uses explicit named re-exports from `./backlog.js` to avoid TS2308 conflicts with constants from `./backlog-root.js` (BACKLOG_FILENAME, STATE_FILENAME)
