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

### 009 — Update LoopRunner to use BacklogPaths and lock lifecycle (2026-03-25)
- Static factory pattern (`LoopRunner.create()`) works cleanly — returns `Result<LoopRunner>` so callers handle errors via standard Result pattern
- Replaced ~60 occurrences of `defaultBacklogPaths(this.projectPath)` with `this.paths` using `replace_all` — very mechanical
- `startReviewOnly()` also needs `this.instructionPaths` set before calling `runReviewPass()` — easy to miss since it's a separate entry point
- Test that created `LoopRunner` without `setupProject()` first failed because `create()` validates directory existence — added `setupProject` call
- Prompt-builder signatures updated to `(paths, instructionPaths, ...)` with internal bridge `const projectPath = paths.projectPath` — full internal refactor deferred to item 010
- CLI callers needed `return 1` (not bare `return`) since handler functions return `Promise<number>`
- The `defaultBacklogPaths` import was cleanly removed from runner.ts — no longer needed since `this.paths` is resolved in `create()`

### 018 — Single-gate review: suppress per-iteration review hooks in child sessions (2026-06-10)
- Generic mechanism, not plugin-hardcoded: `spawnClaude` gained an optional `env` override (merged over `process.env` only when present, so default behavior — child inherits parent env — is untouched). `packages/loop/src/review-hooks.ts` holds `REVIEW_HOOK_SUPPRESSION_ENV` (currently `ENABLE_CODE_SECURITY_REVIEW=0`) + `resolveChildEnv()`; the map is the extension point and `childEnv` lets callers suppress any env-opt-out hook.
- Two new LoopStartOptions fields: `suppressIterationReview` (friendly opt-in → suppression set) and `childEnv` (generic override, wins over the set). Runner computes `this.childEnv` once in the constructor and passes it to BOTH spawnClaude calls (iteration + review pass).
- CLI flag `--suppress-iteration-review` on `rauf loop run`; also threaded through `rauf loop start` body → web `StartLoopBodySchema` → `LoopStartOptions` for server-mode parity.
- Testing child env through the runner: mock-claude writes `$ENABLE_CODE_SECURITY_REVIEW` to an abs file under tmpDir, then `echo RAUF_DONE`. The default-behavior test must `delete process.env.ENABLE_CODE_SECURITY_REVIEW` first (parent may carry it) — child inherits parent env, so the assertion of "unset" is only deterministic after clearing it.
- The "review at the gate" model is documented in `docs/SPEC-CLI.md` (loop run → "Single-gate review") and `docs/DOGFOODING.md`. Gate = `git diff main..HEAD` / PR hook / `rauf loop review`, never per item. See [[rauf_loop_security_review_altitude]].
