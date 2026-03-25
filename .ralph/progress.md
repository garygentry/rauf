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

### 004 — Refactor backlog.ts to accept BacklogPaths (2026-03-25)
- Changing function signatures in core requires updating ALL downstream callers (CLI, loop, web) for typecheck to pass — can't defer to later items
- Added `defaultBacklogPaths(projectPath)` bridge function to `backlog-root.ts` — constructs BacklogPaths for default root without filesystem checks, used by callers not yet migrated to `resolveBacklogPaths`
- Barrel export in index.ts simplified from explicit named re-exports to `export * from "./backlog.js"` since constants removed from backlog.ts eliminated the TS2308 conflict
- CLI loop-commands.test.ts has 3 flaky tests (handleLoopStop, handleLoopFollow, path resolution) that depend on server connectivity timing — pass in isolation, fail intermittently in parallel runs
- Pre-existing format issues in many files (specs, some source files) — not related to this work

### 005 — Refactor status.ts, add scanActiveRoots (2026-03-25)
- Same `defaultBacklogPaths` bridge pattern from item 004 applied to all status function callers
- Multi-line function calls (appendLog with args on separate lines) require separate replace_all passes for each indentation level — single-line replace_all misses them
- Removing NOT_INSTALLED check from deriveStatus (per spec 3.4) cascades to integration and web tests that expected that state — updated both to expect IDLE instead
- Previously exported constants (RALPH_DIR, LOG_FILENAME, DONE_FILENAME, CANCEL_FILENAME) from status.ts now removed; integration.test.ts switched to DEFAULT_ROOT_DIR from backlog-root.ts and inline strings
- scanActiveRoots uses SCAN_SKIP_DIRS cast to `readonly string[]` for `.includes()` compatibility with the `as const` tuple type

### 006 — Refactor iteration-status.ts, archive.ts, reset.ts (2026-03-25)
- Three modules refactored in parallel with agent delegation — worked cleanly since modules are independent
- The `defaultBacklogPaths` bridge pattern continues to work well for downstream callers (CLI, loop, web)
- After core package changes, must run `pnpm build` before `pnpm typecheck` so loop/cli/web packages see updated .d.ts files
- New iteration-status.test.ts file created (didn't exist before); archive.test.ts and reset.test.ts updated
- Pre-existing lint errors (installer.ts:356, schemas.test.ts:204) and format issues (specs/, skills/) still present — not related to this work
