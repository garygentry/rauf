# Architecture — Command Grammar & Contract Flip (v0.5.0)

How the v0.5.0 change is built, and why. The throughline: **this is a surface + contract refactor; the
execution engine is reused as-is.** No change to `LoopRunner`'s loop, the server daemon's lifecycle, or the
Phase-1 file-backed observation substrate.

## The problem it solves

Pre-0.5.0, the command surface leaked implementation detail and the machine contract was internally
inconsistent:

1. **Execution mode leaked into the verb names.** `loop run` (in-process) and `loop start` (server-owned)
   were synonyms to a human — nothing signalled the distinction that matters (survives a server bounce?
   runs without my terminal?). Phase 1 made the two modes observationally identical (everything reads from
   files), so the surface can finally describe *intent* (foreground vs detached) instead of *mechanism*.
2. **Exit codes disagreed.** `status` used `1=running, 2=paused_human, 3=limit_reached`; `loop run` used
   `6=paused_human`. `status`'s `1=running` even collided with the conventional `1=error`. A tool branching
   on rauf's exit status had to special-case which command produced the code.
3. **`signal_parsed` lied about reviews.** A `RAUF_REVIEW` outcome was collapsed to `signal:"done"` at the
   event-emit site, so a review was indistinguishable from completion on the wire (and a work item emitting
   `RAUF_REVIEW` was mislabelled `done` while actually being retried).
4. **`events.ndjson` had no versioning discipline** despite being promoted to a real observation surface in
   Phase 1.

These are breaking to fix, so they land together as one v0.5.0 flip (canon §6) — exactly one moment of
breakage, with feature-forge bumped to require `≥ 0.5.0` in lockstep.

## Decisions

### D1 — `loop run --detached` reuses the `loop start` server path

The detached mode is **not** a new execution mechanism. `loop run --detached` delegates to the exact path
`loop start` used: `ensureServerRunning(ctx)` (auto-starts the daemon) → `POST /api/projects/:id/loop/start`
with the same request body → return immediately. The server still runs the loop in-process via
`LoopManager`. The old `handleLoopStart` body was folded into a shared `runDetached` helper invoked by
`handleLoopRun`'s `--detached` branch; bare `loop run` keeps the unchanged in-process
`LoopRunner.create().start()` path.

- **`--detached --follow`** attaches the top-level `follow` view *CLI-side, after* the POST returns —
  `--follow` is never part of the server request body. Interrupting the attached view (Ctrl-C) detaches the
  view only; the loop keeps running server-side (stop it with `loop stop`).
- **Rationale:** zero execution-semantics change; the engine is reused; the grammar just renames intent.
- **Alternative considered:** having the server spawn a detached `rauf loop run` subprocess — rejected
  (changes execution semantics for no grammar-phase benefit).

### D2 — Unified `ExitCode`, redefined in place

`ExitCode` (in `packages/cli/src/commands.ts`) was redefined to one canon table and **every CLI call site
re-pointed in one atomic commit** (a hard compile break — the old member keys are gone, so any missed site
fails the build). The old→new remap folded the non-loop-state codes into `USAGE(2)`:

| Old member (value) | New |
|--------------------|-----|
| `INVALID_ARGS` (2) | `USAGE` (2) — rename |
| `NOT_FOUND` (3) | `USAGE` (2) |
| `VALIDATION` (4) | `USAGE` (2) |
| `CONFLICT` (5) — incl. loop-already-running 409 | `USAGE` (2) |
| `PAUSED_HUMAN` (6) | `NEEDS_HUMAN` (3) |

`loop run`'s terminal mapping and `status`'s `statusExitCode` were both rewritten to the unified table (see
[API Reference](./api-reference.md#exit-codes)). `RUNNING(6)` is query-time-only (`status`) — never a
`loop run` terminal code. `backlog validate` keeps its own coherent `0`/`1`/`2` triad.

- **Alternative considered:** a parallel `ExitCodeV2` enum + gradual migration — rejected: parallel schemes
  are the inconsistency we're removing, and zero external users make an in-place remap safe.

### D3 — Explicit `review` signal (minimal fix)

`"review"` was added to the `SignalParsedSchema.signal` enum (`packages/core/src/schemas.ts`), and the
`review → done` downcast at the `signal_parsed` emit site (`packages/loop/src/runner.ts`) was removed, so the
event reports `"review"` truthfully. The internal `SignalType` and `exit-classifier` already handled
`review` — this only aligns the on-wire event. **Review *handling* semantics (review-pass routing, item
status) are unchanged** — out of scope.

### D4 — `events.ndjson` versioning discipline (documentation, no bump)

The shapes already aligned (Phase 1): the live `--ndjson` stream and the persisted log share the
`LoopEvent` discriminated union; the persisted record is that ∩ `{seq, schemaVersion}`. v0.5.0 formalizes
the *discipline* (in `docs/SCHEMAS.md` + `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`): additive-only within a major
version, readers ignore unknown types/fields, and `EVENTS_SCHEMA_VERSION` is bumped only on a breaking
change. Adding `"review"` to `signal_parsed` is additive, so the version **stays `"1"`** — this is the first
*formal* version, not a breaking change.

- **Alternative considered:** bump to `"2"` to mark the formalization — rejected: no shape change, so a bump
  would force every consumer to re-gate for nothing.

### D5 — Removed-command remediation (not aliases)

Invoking a removed verb/flag exits `USAGE(2)` with a targeted message naming the replacement, **executing
nothing** — an error message, not an alias. A lookup table (`REMOVED_SUBCOMMAND_MESSAGES` in `commands.ts`,
`REMOVED_FLAG_MESSAGES` in `parser.ts`) is intercepted in `main.ts` *before* the generic
unknown-subcommand/flag error, so the targeted message wins.

## Data flow (unchanged from Phase 1)

```
  loop run            → in-process LoopRunner.create().start()  ┐
  loop run --detached → ensureServerRunning → POST /loop/start  ┘→ LoopRunner (one writer)
                                                                      │ emitEvent → events.ndjson, state.json
   observers (CLI status/log/follow, web) ── read files ◀────────────┘
```

The grammar change only affects *which CLI entry point* starts the loop; both feed the same engine and the
same file-backed substrate, so observation parity (Phase 1) is preserved by construction — the `--detached`
branch adds no new observation path.

## What changed, by package

| Package | Change |
|---------|--------|
| `@rauf/cli` | `ExitCode` redefined + all call sites re-pointed; `loop run --detached` + removal of `loop start`; shared `runDetached` / `applyCreateLoopBranch` / `unblockIfRequested` helpers; `statusExitCode` rewrite; removed-command remediation; flag-help + `--help`/usage |
| `@rauf/core` | `SignalParsedSchema.signal` += `"review"`; `version.ts` → `0.5.0` |
| `@rauf/loop` | removed the `review → done` collapse at the `signal_parsed` emit site; `loop run` terminal exit mapping |
| `@rauf/web` | unchanged — `POST /loop/start` is retained as the detached-run backend (URL/contract unchanged) |
| docs | all 6 `docs/SPEC-*.md` updated to the v0.5.0 surface |
| feature-forge (separate repo) | **0.10.0** — `minRunnerVersion → 0.5.0`, `followCommand`/`watchCommand` defaults re-pointed (out-of-loop lockstep edit) |

## Cutover & dogfood

The implementation was dogfooded on the **frozen `rauf-stable` binary**, never the dev `rauf` whose command
surface was being rewritten — so the loop rewriting `loop run` couldn't disrupt the run. At cutover:
`rauf-stable` was re-frozen at 0.5.0 (rebuilt from the merged `main`), and feature-forge bumped to
`minRunnerVersion ≥ 0.5.0`, so the version gate stays consistent. See the
[Migration Guide](./guides/migration.md).

## Further Reading

- [API Reference](./api-reference.md) — the exact contract (grammar, exit codes, signal enum, events versioning)
- [Migration Guide](./guides/migration.md)
- `specs/ux-overhaul-grammar/` — the implementation specs (00–06) this was built from
