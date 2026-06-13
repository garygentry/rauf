# Progress — ux-overhaul-grammar

## Learnings

- **Item 005 (statusExitCode):** Widened `statusExitCode(state, derived?)` per 00 §2b — preferred
  widening path, no deferral needed. Exported it (+ a shared `genuineBlockedCount` helper reused by the
  status summary) so the it.each table test can hit it directly. The four call sites in `handleStatus`
  pass the full `DerivedStatus`. BLOCKED(5) derives only for a clean terminal state (IDLE/COMPLETE/PAUSED)
  with genuine-blocked > 0 (blocked minus deferred). Updated the existing `handleStatus` integration tests
  that asserted the OLD codes (RUNNING 1→6, PAUSED_HUMAN 2→3, LIMIT_REACHED 3→4, SLEEPING/WEEKLY 0→4).

- **Pre-existing format debt (for item 014 full-gate):** `pnpm format:check` already fails on 5 committed
  files NOT touched by item 005: `packages/loop/src/runner.test.ts` (items 002/004) and four
  `docs/architecture/ux-overhaul/*.md`. They are Prettier violations baked into earlier commits — run
  `pnpm format` (write) during the final integration item to clear them.
