# Progress — ux-overhaul-grammar

## Learnings

- **Item 005 (statusExitCode):** Widened `statusExitCode(state, derived?)` per 00 §2b — preferred
  widening path, no deferral needed. Exported it (+ a shared `genuineBlockedCount` helper reused by the
  status summary) so the it.each table test can hit it directly. The four call sites in `handleStatus`
  pass the full `DerivedStatus`. BLOCKED(5) derives only for a clean terminal state (IDLE/COMPLETE/PAUSED)
  with genuine-blocked > 0 (blocked minus deferred). Updated the existing `handleStatus` integration tests
  that asserted the OLD codes (RUNNING 1→6, PAUSED_HUMAN 2→3, LIMIT_REACHED 3→4, SLEEPING/WEEKLY 0→4).

- **Item 006 (loop run --detached):** Renamed exported `handleLoopStart` → non-exported `runDetached`
  in loop-commands.ts (no logic dup); `handleLoopRun` gained an early `--detached` branch that consumes
  the flag via `extractBoolFlag` (so it never leaks into the in-process path/POST body) and delegates to
  `runDetached` then returns. Folded the old follow branch into a `followDetached` helper wired off the
  detached branch (kept `streamEventsUntilDone`/`connectSSE` alive — item 007 formalizes its lifecycle &
  no-follow-in-body tests). 409 already-running → USAGE(2) per 00 §1 (was ERROR). Removed the `loop start`
  registry entry + import in commands.ts. parser.ts gained the `-d`→`--detached` alias block mirroring
  `-f`→`--follow`. Test fallout from removing `loop start`: retargeted `help loop start` tests + the
  `loop start --help` interception tests to `loop run`, and the loop-subcommands list assertion
  (`["start","stop","run","review"]` → `["stop","run","review"]`). Item 010 still owns adding the
  `--detached`/`--follow` flag DOC entries to `run` + the `loop stop` hint reword.

- **Item 007 (--detached --follow lifecycle):** The wiring already existed from 006 — `handleLoopRun`'s
  detached branch calls `followDetached` after `runDetached` returns SUCCESS, and `streamEventsUntilDone`
  registers a SIGINT/SIGTERM handler that only aborts the SSE controller + resolves SUCCESS (never POSTs
  `/loop/stop`). 007 was purely the two invariant tests in `loop-commands.test.ts` (new describe block
  `loop run --detached --follow`): (1) no-follow-in-body — drive the real handler against a mock server that
  streams a terminal `loop_completed` so the view returns on its own, then assert the recorded POST body has
  neither `follow` nor `detached`; (2) Ctrl-C-detaches-only — mock server holds the SSE connection open +
  records any `/loop/stop` POST, poll until `startCalls===1 && eventsConnected`, then `process.emit("SIGINT")`,
  await, assert SUCCESS + `stopCalls.length===0`. Mock server must answer GET `.../loop/events` (SSE) in
  addition to health/start/stop. `process.emit("SIGINT")` (synthetic, not a real signal) is safe in vitest.

- **Pre-existing format debt (for item 014 full-gate):** `pnpm format:check` already fails on 5 committed
  files NOT touched by item 005: `packages/loop/src/runner.test.ts` (items 002/004) and four
  `docs/architecture/ux-overhaul/*.md`. They are Prettier violations baked into earlier commits — run
  `pnpm format` (write) during the final integration item to clear them.

- **Item 011 (signal-placement docs + events versioning):** Reworded
  SPEC-BACKLOG-TOOL-CONTRACT.md §A.2 to the scan-from-end wording (04 §2a verbatim),
  widened the §A.7.1 `signal_parsed` enum row to include `review`, and replaced
  gotcha #1 (no longer "collapses review→done"). Added the events.ndjson
  additive-only versioning discipline (00 §4) to §A.7.3 (SPEC) and next to the
  Event-log constants table (SCHEMAS.md), plus widened the `signal_parsed` enum in
  SCHEMAS.md (table row + TS union) and the §LoopEvent gotcha note. Templates
  (CLAUDE_ADDON.md, RAUF.md.tmpl) kept "signal as final line" as a habit but added a
  note that trailing text doesn't break detection. Landmine confirmed: both templates
  feed embedded-artifacts.ts (lines 362/421), so `pnpm --filter @rauf/core build`
  regenerates it — don't hand-edit. NOTE: docs/ is NOT in .prettierignore (artifacts
  IS), so markdown table edits must be re-run through `prettier --write` — widening a
  table cell shifts column alignment and trips format:check.
