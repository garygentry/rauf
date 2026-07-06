# Loop Observability — Progress Log

## Item 001 — health block + statusSchemaVersion (Phase 1)

- Added `HealthSchema`/`Health` and amended `DerivedStatusSchema` with
  `statusSchemaVersion: z.literal("1")` + `health: HealthSchema.nullable()` in
  `packages/core/src/schemas.ts`. Both are REQUIRED (not optional) — existing
  DerivedStatus literals/parses in tests had to gain both fields.
- `status.ts`: added `STATUS_SCHEMA_VERSION`, private `buildHealth`, and the
  shared-read refactor (`isLoopLive` is now a pure predicate over an
  already-read `IterationStatus`; `deriveFromStateJson` reads
  `readIterationStatus` once near the top and captures `now` once).

### Learnings

- **ESM can't `vi.spyOn(fs, "readFileSync")`** ("Module namespace is not
  configurable in ESM"). To assert the ≤1-read invariant, mock the module
  instead: `vi.mock("./iteration-status.js", …)` wrapping the real
  `readIterationStatus` with a `vi.hoisted()` counter. The wrapper delegates to
  `importOriginal`, so all other tests behave normally.
- The 6 `packages/loop/src/runner.test.ts` usage-limit/budget tests fail LOCALLY
  ONLY (they hit the live Anthropic usage API → 429/timeout); CI is green. Not
  related to core changes.

## Item 002 — resolveTarget() core resolver + contract types (Phase 2a)

- Added `ResolveTargetOptions`/`ResolvedTarget`/`TargetErrorCode`/`TargetError`
  and `resolveTarget()` to `packages/core/src/backlog-root.ts` (co-located with
  the containment seam, per 03 §2). A private `resolveConcrete(pathArg,
  backlogFlag)` runs branch-1 logic (delegate `resolveBacklogRoot` +
  `resolveBacklogPaths`, map `PATH_VIOLATION→outside_sandbox`,
  `FILE_NOT_FOUND→not_found`) and is reused by the TTY single-loop and cwd paths.

### Learnings

- **Only new import is `listActiveLoops` from `./loop-registry.js`** — this
  creates a `core→core` cycle (loop-registry imports `LOCK_FILENAME` back from
  backlog-root). SAFE because both sides use the imported symbols only inside
  function bodies, never at module top-level init.
- For the single-active-loop branch, delegating `resolveConcrete(entry.projectPath,
  entry.backlogRoot)` works even though `backlogRoot` is ABSOLUTE:
  `path.resolve(projectPath, absBacklogRoot)` returns the absolute path and
  `validatePath` still enforces containment.
- Tests: `vi.mock("./loop-registry.js", () => ({ listActiveLoops: vi.fn(...) }))`
  + `vi.mocked()` gives a deterministic enumeration and a call-spy to prove the
  machine-context path never enumerates; `vi.spyOn(process, "cwd")` both asserts
  cwd is NOT read in machine context and stubs the cwd default on the TTY-zero path.
