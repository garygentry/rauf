# 06 — Testing Strategy (ux-overhaul-grammar)

How to verify the v0.5.0 grammar + contract flip. Vitest, colocated `*.test.ts` (project convention). This
feature is surface+contract, so the highest-value tests are the **exit-code mapping table**, the
**`--detached` delegation + lifecycle**, **removed-command remediation**, and the **`review` signal**. The
web frontend has no test harness — lean on backend/CLI tests (the `EventTimeline` change is non-existent:
`review` renders verbatim via string interpolation). Shared contracts: [`00-core-definitions.md`](./00-core-definitions.md).

## Requirement Coverage

| REQ | Test area (section) |
|-----|---------------------|
| REQ-EXIT-01/02/03 | §1 exit-code tables |
| REQ-EXEC-01/02/03 | §2 detached delegation |
| REQ-EXEC-04/06, NFR-PARITY-01 | §3 follow lifecycle + parity |
| REQ-RMV-01 | §4 remediation |
| REQ-SIG-01 | §5 review signal |
| REQ-FLAG-01/02/04 | §6 flag canon |
| REQ-EVT-01/02 | §7 events (mostly doc-level) |
| NFR-PERF-01 | §8 (no new hot-path work) |
| NFR-QUALITY-01 | §8 full gate |

## 1. Exit-code mappings (REQ-EXIT-01/02/03) — the contract

The most important new coverage. Table-driven unit tests asserting **every** terminal outcome / state maps
to the exact `ExitCode` value in [`00-core-definitions.md`](./00-core-definitions.md) §2 / [`03-exit-codes.md`](./03-exit-codes.md).

- **`loop run` terminal mapping** (`packages/cli/src/loop-commands.ts`): for each `LoopResult` shape →
  expected code — failure→`ERROR`(1); `pausedReason:"needs_human"` / `needsHumanCount>0`→`NEEDS_HUMAN`(3);
  limit/sleeping→`LIMIT`(4); `blockedCount>0`→`BLOCKED`(5); clean→`SUCCESS`(0). Assert `RUNNING`(6) never
  occurs as a terminal code.
- **`statusExitCode`** (`packages/cli/src/status-commands.ts`): for each `LoopStateEnum` value → expected
  code (RUNNING→6, PAUSED_HUMAN→3, LIMIT_REACHED/SLEEPING_LIMIT/WEEKLY_LIMIT→4, blocked→5, ERROR→1,
  else→0). Use a parametrized `it.each` over all 10 states.
- **Call-site audit regression (REQ-EXIT-02):** a test (or a CI grep) asserting no source references the
  removed member names `INVALID_ARGS`/`NOT_FOUND`/`VALIDATION`/`CONFLICT`/`PAUSED_HUMAN` — they must not
  exist after the redefinition. Cover the 409/already-running path → `USAGE`(2).
- **`backlog validate` untouched (REQ-EXIT-03):** assert its 0/1/2 codes are unchanged (existing tests
  should still pass with no edits).

## 2. `--detached` delegation (REQ-EXEC-01/02/03)

- `loop run --detached` (and `-d`) delegates to the server path: with the server mocked / `ensureServerRunning`
  stubbed, assert it issues the `POST /api/projects/:id/loop/start` with the same body `handleLoopStart`
  built, and returns immediately (does NOT create an in-process `LoopRunner`).
- Bare `loop run` still runs in-process (`LoopRunner.create().start()`), unchanged.
- `loop start` is no longer dispatchable (covered by §4 remediation).

## 3. `--detached --follow` lifecycle + observation parity (REQ-EXEC-04/06, NFR-PARITY-01)

- `--detached --follow`: after the POST returns, the CLI attaches the top-level `follow` view; assert
  `--follow` is NOT included in the POST request body (body carries only loop options).
- Lifecycle: interrupting the attached view (Ctrl-C) detaches the view only and does not issue a stop
  (no `POST /loop/stop`); stopping requires an explicit `loop stop`.
- **Parity (REQ-EXEC-06):** primary assurance is structural — both branches feed the unchanged Phase-1
  file substrate, so observers see identical data. A focused test: run a backlog in-process and assert the
  resulting `events.ndjson` / derived `status` shape matches what the detached path produces (or, if a full
  detached run is impractical in unit tests, assert both paths write through the same `LoopRunner`/substrate
  and document that parity is inherited, not re-implemented).

## 4. Removed-command remediation (REQ-RMV-01)

- `rauf loop start …` → exits `USAGE`(2) with the message naming `loop run --detached`; asserts it did NOT
  start a loop (no server POST, no `LoopRunner`).
- `--watch` on any command → exits `USAGE`(2) with the message naming `--follow`; executes nothing.
- The remediation fires **before** the generic unknown-subcommand/unknown-flag error (assert the specific
  message, not the generic one).

## 5. `review` signal (REQ-SIG-01)

- `SignalParsedSchema` now accepts `signal:"review"` (schema-validation test).
- The runner emits `signal_parsed` with `signal:"review"` for a `RAUF_REVIEW` parse (no `done` collapse) —
  assert against the emitted/persisted event.
- Regression for the latent bug: a **work** item emitting `RAUF_REVIEW` produces `signal_parsed:"review"`
  (not `"done"`). No change to review *handling* semantics is asserted (out of scope).

## 6. Flag canon (REQ-FLAG-01/02/04)

- `--json` honored under `--follow` (NDJSON output) on `status` (and `loop run --detached --follow` where
  applicable).
- `-d` parses to `--detached`; `-f` to `--follow` (the latter already from Phase 1 — keep green).
- `--interval` accepted under `--follow`.

## 7. Events versioning (REQ-EVT-01/02)

Mostly documentation (no version bump). Light assertions: `EVENTS_SCHEMA_VERSION === "1"` (unchanged);
adding `"review"` to `signal_parsed` is additive (existing persisted-event round-trip tests still pass; a
`signal_parsed:"review"` record validates against `PersistedEventSchema`). The discipline itself
(additive-only, readers ignore unknown) is verified at the doc level, not by a runtime test.

## 8. Full gate (NFR-QUALITY-01)

`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` all green. New behavior (flag parsing,
exit-code mapping, signal value, remediation) covered by the tests above. Dogfood any implementing loop with
the frozen `rauf-stable` binary (NFR-SAFETY-01) — never the dev binary being rewritten; rebuild `dist/`
before testing runner edits.

**Performance (NFR-PERF-01):** no dedicated perf test is warranted — this feature adds no work to any hot
path. Exit-code mapping and flag parsing are O(1) per invocation; the `--detached` branch reuses the
existing server path; the `review` enum + collapse removal touch event emission already on the path. There
is no new file I/O or status-derivation cost, so command startup and file-based status derivation latency
are unchanged by construction. (If ever in doubt, compare `rauf status` wall-clock before/after — but the
change set introduces no new computation there.)

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md), [`02-execution-grammar.md`](./02-execution-grammar.md),
  [`03-exit-codes.md`](./03-exit-codes.md), [`04-signals-and-events.md`](./04-signals-and-events.md).

## Verification

All listed tests exist and pass; the full gate is green; the call-site-audit grep finds no removed
`ExitCode` member names.
