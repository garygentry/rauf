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
