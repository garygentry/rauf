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

- **Pre-existing format debt (for item 014 full-gate):** `pnpm format:check` already fails on 5 committed
  files NOT touched by item 005: `packages/loop/src/runner.test.ts` (items 002/004) and four
  `docs/architecture/ux-overhaul/*.md`. They are Prettier violations baked into earlier commits — run
  `pnpm format` (write) during the final integration item to clear them.
