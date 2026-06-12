# Progress — UX/DX Overhaul Phase 1

## Item 001 (core shared types/constants/IO_ERROR)

- Added `PersistedEventSchema` (first `z.intersection` in the codebase), `ActiveLoopEntrySchema`,
  constants (`EVENTS_SCHEMA_VERSION`, `TOKEN_COALESCE_MS`, `EVENTS_LOG_FILENAME`) to `schemas.ts`;
  `IO_ERROR` to `errors.ts`; `BacklogPaths.eventsLog` to `backlog-root.ts`.
- GOTCHA: adding a required `BacklogPaths` field breaks every full object-literal that builds one.
  Had to add `eventsLog` to `defaultBacklogPaths()` AND five test files
  (core: backlog/iteration-status/reset/archive.test.ts; loop: prompt-builder.test.ts).
- GOTCHA: `errors.test.ts` asserts an exact error-code count ("has exactly N error codes") — bump it
  when adding a code (was 9 → 10; also added the missing LOCK_CONFLICT/IO_ERROR assertions).
- `index.ts` uses `export *` for all touched modules, so new symbols re-export automatically.
- The loop package resolves `@rauf/core` types from `dist`, so rebuild core
  (`pnpm --filter @rauf/core build`) before loop typecheck sees new fields.

## Item 002 (appendLine + readNdjson primitives)

- Added `appendLine` and `readNdjson<T>` to `fs-utils.ts`, copied verbatim from spec 02 §4.1/§4.2.
  Both return `Result` and never throw; `appendLine` → `IO_ERROR` on fs failure, `readNdjson` is
  torn-line tolerant (skip bad line) and missing-file → `ok([])`.
- `readNdjson` uses `z.ZodType<T>` (the existing `import type { z }` already covers it) and calls the
  later-declared `fileExists` (function-declaration hoisting makes order irrelevant).
- Test idiom for the `appendLine` error path: write a regular file, then target a path *under* it
  (`<file>/child`) — appending there fails with ENOTDIR without needing permission tricks.

## Item 003 (events-log.ts core module)

- Added `packages/core/src/events-log.ts` with `appendEvent`/`readEvents`/`rotateEventsLog`/
  `watchEvents`, copied near-verbatim from spec 02 §3. Module-private `eventsArchiveTimestamp()`
  duplicates reset.ts's private `archiveTimestamp` (YYYYMMDD-HHMMSS) — intentional, per spec.
- GOTCHA: `fs.watch(path,…)` throws ENOENT synchronously if the file is absent (same as `watchLog`).
  watchEvents does NOT guard this — callers ensure the file exists. Tests that tail must `touch`
  events.ndjson first (the seed-an-event tests get it for free).
- GOTCHA: truncate-on-fail test — putting a FILE at `paths.archive` makes `ensureDir` fail FIRST
  (returns FILE_NOT_FOUND, before the rename/truncate path). To exercise the real truncate-on-fail
  (IO_ERROR + 0-byte file), make `ensureDir` succeed but `renameSync` fail: `chmod 0o555` the archive
  dir so the rename into it hits EACCES. Restore perms in a finally so afterEach cleanup works.
- `watchEvents` advances `lastOffset` only past the last `\n` in each chunk (re-reads partial trailing
  line next fire); `fs.watch` is async/platform-dependent so tail tests poll with a wait loop.
- Editor flags a false `rootDir` diagnostic on the new test importing events-log.ts; `pnpm --filter
  @rauf/core typecheck` is clean — ignore the editor LSP noise, trust the package tsc.

## Item 005 (loop-registry.ts core module)

- Added `packages/core/src/loop-registry.ts` (`registerLoop`/`deregisterLoop`/`updateLoopStatus`/
  `listActiveLoops`/`registryEntryPath`), near-verbatim from spec 03 §3. Item 004's `checkLockFile`
  was already extracted — imported, not redefined.
- GOTCHA: `ACTIVE_DIR` derives from `TOOL_CONFIG_DIR` (`os.homedir()/.rauf`), bound at import. Tests
  must NOT touch the real `~/.rauf`. Redirect it with `vi.hoisted` (mkdtemp a fake HOME) +
  `vi.mock("./config.js", ...)` spreading the original and overriding only `TOOL_CONFIG_DIR`. This is
  the first core test that mocks the config module for sandbox isolation.
- Liveness in tests: `acquireLock`-style lock with `process.pid` = live; a high dead pid
  (2147483646) or no lock file = not-live → self-heal prune. `process.kill(pid,0)` is the gate.
- Added `export * from "./loop-registry.js"` to index.ts (events-log neighbor).
- Editor LSP shows a false `rootDir` diagnostic on the test importing the new module; package
  `tsc --noEmit` is clean — ignore the IDE noise (same as item 003).

## Item 006 (wire event-log persistence into runner)

- Added `persistEvent(event)` called from `emitEvent` (before `this.emit`): coalesces
  `llm_token_update` to <=1/`TOKEN_COALESCE_MS` in the FILE only (still emitted in-memory), builds
  `PersistedEvent = {...event, seq: eventSeq++, schemaVersion: EVENTS_SCHEMA_VERSION}`, then
  `void appendEvent(this.paths, record)` (Result discarded, never throws). seq is dense/per-run —
  assigned only when a record is written, so coalesced token updates consume no seq.
- `start()` calls `rotateEventsLog(this.paths)` + `this.eventSeq = 0` immediately after `ensureStateDir`
  and BEFORE any emit (placed before acquireLock, whose failure path emits loop_error). First emit is
  `loop_started` -> seq 0 (verified in sandbox: 13 lines, seq 0..12, 1 token_update line).
- Added `:(exclude,glob)**/.rauf/events.ndjson` to RUNTIME_EXCLUDE_PATHSPECS in git-commit.ts.
- RIPPLE: events.ndjson is a NEW runtime file the loop writes mid-run, so it dirties the working tree.
  Three tests that assert a clean tree / reconciliation after a real loop run had to add
  `.rauf/events.ndjson` to their RUNTIME gitignore lists: runner.test.ts (commit-reconciliation),
  loop-commands.test.ts (makeProject's two gitignore blocks). Real installs gitignore it via item 014.
- Pre-existing lint debt from item 005 (loop-registry.test.ts require() in vi.hoisted, which only ran
  test+typecheck) surfaced here since 006 runs the full pipeline. Fixed with a scoped eslint-disable
  (require is the genuine pattern: vi.hoisted runs before ESM imports resolve).
