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
