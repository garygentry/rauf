# Verification Report: ux-overhaul (impl)
Date: 2026-06-13
Pipeline Stage: forge-5-loop (complete) → impl verification
Artifacts Reviewed:
- Specs: PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-event-log.md, 03-active-loop-registry.md, 04-cli-monitoring-surface.md, 05-web-observation-parity.md, 06-agent-commit-rule.md, 07-testing-strategy.md, TRACEABILITY.md, CANON.md, backlog.json (15 items)
- Implementation: git commits `58e7844..72b8100` (`[rauf] 001..014`) across packages/core, packages/loop, packages/cli, packages/web, artifacts/, docs/

Method: 4 parallel `forge-verifier` instances (read-only), one per dimension — (1) requirement coverage, (2) integration correctness, (3) testing, (4) code quality. Findings merged, deduped, and renumbered below.

## Gate Results (evidence)
- `pnpm -s typecheck` → exit 0 (core/loop/cli/web all clean; the `BacklogPaths.eventsLog` churn fixtures in archive/backlog/reset/prompt-builder tests were all updated)
- `pnpm -s lint` → clean (no output)
- `pnpm -s format:check` → "All matched files use Prettier code style!"
- Tests (per-package, all green): core 907/907 (25 files, incl. events-log 12, loop-registry 13, fs-utils 44, lock 15), loop 288/288, cli 418/418, web 198/198

## Summary
- Total findings: 6
- Gaps: 2 (V-004, V-005 — missing spec-required test coverage)
- Inconsistencies: 2 (V-001, V-002 — stale references to removed CLI verbs)
- Improvements: 2 (V-003, V-006)
- Errors: 0

Overall: the shipped code implements every Phase-1 requirement and all 15 backlog acceptance criteria; all quality gates pass. No correctness defects in production code were found. The findings are: two dangling references to the clean-break-removed `loop follow`/`status --watch` verbs (one user-facing CLI hint, one project doc), one dead-code/duplication judgment call, and three test-coverage gaps where the testing-strategy spec names assertions that weren't written.

## Findings

### V-001: Stale `loop follow` hint points users at a removed verb
- **Severity:** inconsistency
- **Location:** packages/cli/src/loop-commands.ts:397
- **Issue:** The item-009b clean break (commit 2b7d834) removed `loop follow` / `loop watch` as dispatchable verbs with no aliases; the canonical live-view command is now the top-level `follow` (and `loop start --follow`). But the `loop start` (non-`--follow`) branch still prints `Follow: rauf loop follow <dir>`. A user who copies that hint hits the unknown-subcommand error. This contradicts the clean-break intent and spec 04 §4 (REQ-MON-02), whose own acceptance check (04-cli-monitoring-surface.md:702/704) asserts "Exactly one canonical live-view command exists: top-level `follow`. `loop follow` is gone." (Caught independently by both the requirement-coverage and integration verifiers.)
- **Suggested fix:** Change the hint string at loop-commands.ts:397 from `` `rauf loop follow ${ctx.args[0] ?? "."}` `` to `` `rauf follow ${ctx.args[0] ?? "."}` `` (drop `loop`). Then grep packages/cli for any other user-facing string referencing `loop follow`/`loop watch` and fix likewise.
- **References:** packages/cli/src/loop-commands.ts:397; packages/cli/src/commands.ts:340; packages/cli/src/follow-command.ts; specs/ux-overhaul/04-cli-monitoring-surface.md §4 (REQ-MON-02), lines 180/186/702/704; PRD.md REQ-MON-02, SC-4; backlog item 009b
- **Checklist:** CHECK-I01, CHECK-I02, CHECK-I05, CHECK-I07

### V-002: `docs/SPEC-CLI.md` still documents the removed `loop follow` / `status --watch` verbs
- **Severity:** inconsistency
- **Location:** docs/SPEC-CLI.md:24, 165, 447–448, 622
- **Issue:** The project CLI spec still lists `loop follow` in its command table (line 24), has a `### rauf loop follow [path]` section (line 165), documents `--watch` and its `--interval` requirement (lines 447–448), and lists `loop follow` among server-requiring commands (line 622) — all of which the ux-overhaul clean break (REQ-MON-02, spec 04 §4) deleted from the code. A reader of SPEC-CLI.md is told to use commands that now error. (Note: docs/SPEC-CLI.md is the repo's general spec, not a `specs/ux-overhaul/` artifact, and the feature specs do not explicitly enumerate it as an edit target — but it is now factually wrong about the shipped surface.)
- **Suggested fix:** Update docs/SPEC-CLI.md to the post-clean-break surface: remove the `loop follow` table row + section and replace with the top-level `follow` command; replace `status --watch` / `--interval (requires --watch)` with `status --follow` / `-f` (with `--interval` under `--follow`); drop `loop follow` from the server-requiring-commands sentence at line 622.
- **References:** docs/SPEC-CLI.md lines 24/165/447–448/622; specs/ux-overhaul/04-cli-monitoring-surface.md §3–§4
- **Checklist:** CHECK-I02

### V-003: Core `surfaceInspectedStatus` helper (item 008) is exported but unused — CLI reimplements the cross-root logic inline
- **Severity:** improvement
- **Location:** packages/core/src/status.ts:390–438 (`surfaceInspectedStatus` / `InspectedStatusContext`) vs packages/cli/src/status-commands.ts:174–207 (`surfaceEmptyNotSilent`)
- **Issue:** Backlog item 008 built `surfaceInspectedStatus(paths, status)` as "the data layer for REQ-DISC-01/02 … the cross-root surfacing the CLI/web render." The functional requirement IS met (REQ-DISC-01 names the inspected dir; REQ-DISC-02 surfaces cross-root live loops filtered to exclude self) — but the CLI bypasses the helper: `surfaceEmptyNotSilent` re-derives the same result by calling `listActiveLoops()` and filtering on `path.resolve` itself, duplicating status.ts:425–438. The purpose-built core helper is now dead code (referenced only by its own tests), and the cross-root logic lives in two places that can drift. This is a judgment call about which surface owns the logic — see User Decisions Required.
- **Suggested fix:** Either (a) have `surfaceEmptyNotSilent` (status-commands.ts) call core `surfaceInspectedStatus(paths, derivedStatus)` and render its `inspectedDir` + `otherLiveLoops` fields, restoring the single-source data layer item 008 intended; OR (b) if the team prefers the inline CLI logic, delete the unused core helper + its `InspectedStatusContext` export and tests. Do not leave both.
- **References:** backlog item 008 (description + notes); 04-cli-monitoring-surface.md §1/§8; PRD.md REQ-DISC-01/02; status.ts:390–438; status-commands.ts:174–207
- **Checklist:** CHECK-I05, CHECK-I07

### V-004: Token coalescing and per-run `seq` assignment are completely untested
- **Severity:** gap
- **Location:** packages/loop/src/runner.ts:1201–1216 (`persistEvent`); no covering test in packages/loop/src/runner.test.ts. Spec: specs/ux-overhaul/07-testing-strategy.md §2.1.
- **Issue:** 07-testing-strategy.md §2.1 explicitly requires a coalescing test ("a burst of `llm_token_update`s inside one `TOKEN_COALESCE_MS` window → exactly one token record is written; structural events interleaved are all written; advancing the clock past the window lets the next token update through … use a fake/injected clock") and a seq-density test ("Records carry `seq` 0,1,2,… with no gaps when no coalescing occurred; the value is assigned only on write"). A grep across all `*.test.ts` for `coalesc|TOKEN_COALESCE|llm_token_update|lastTokenPersist|eventSeq` returns zero matches. The coalescing branch (runner.ts:1202–1209) and `seq: this.eventSeq++` (runner.ts:1212) — REQ-EVT-02 and REQ-EVT-03, both mapped to SC-6 — have no automated coverage. events-log.test.ts only asserts seqs the test itself supplies via its `event(seq)` factory; it never exercises the runner that assigns seq, so a "coalescing consumes no seq" regression would pass silently.
- **Suggested fix:** Add a runner unit test (or extract the coalescing/seq logic into a pure, testable helper) driving `persistEvent` with an injected clock, asserting: (a) a burst of `llm_token_update`s within one `TOKEN_COALESCE_MS` window writes exactly one token line; (b) a structural event interleaved in the same window is always written; (c) advancing the clock past the window lets the next token update through; (d) `seq` is dense (0,1,2,…) across written records and coalesced/dropped token updates consume no seq.
- **References:** 07-testing-strategy.md §2.1 (REQ-EVT-02/03, SC-6); packages/loop/src/runner.ts:1196–1216; packages/core/src/events-log.test.ts
- **Checklist:** CHECK-I12, CHECK-I13

### V-005: Web concurrent-tail torn-trailing-line tolerance (no-500) not tested at the API boundary
- **Severity:** gap
- **Location:** packages/web/src/server/routes/loop.test.ts (describe `GET /:id/loop/events`). Spec: 07-testing-strategy.md §5 (third bullet).
- **Issue:** §5 requires: "Concurrent-tail safety: tailing while a writer appends only ever exposes a torn trailing line, which `readNdjson` tolerates (no 500). (REQ-REL-01)." The web route tests cover replay, missing-file, backlog-resolution-failure, and `/api/loops` reconciliation/self-heal, but a grep of loop.test.ts for `torn|trailing|concurrent|partial|500` returns nothing — no test asserts `/loop/events` stays 200 (does not 500) when `events.ndjson` has a partial trailing line. The underlying `readNdjson` torn-line tolerance IS unit-tested in fs-utils.test.ts, so this is a missing integration assertion at the API boundary (severity gap, not error). Note: the web layer is the only coverage standing in for the un-harnessed frontend, which raises the value of this boundary test.
- **Suggested fix:** Add a routes/loop.test.ts case that seeds `events.ndjson` with valid lines plus a partial trailing fragment (no newline), requests `/api/projects/:id/loop/events`, and asserts status 200 (not 500) and that replayed events contain only the complete records.
- **References:** 07-testing-strategy.md §5 (REQ-REL-01); packages/core/src/fs-utils.test.ts (readNdjson torn-line unit coverage); packages/web/src/server/routes/loop.test.ts:353–433
- **Checklist:** CHECK-I12, CHECK-I13

### V-006: Two explicit spec-required assertions omitted (additive-field tolerance; follow does-not-stitch-archive)
- **Severity:** improvement
- **Location:** packages/core/src/fs-utils.test.ts (`readNdjson` describe, ~lines 452–513) and packages/cli/src/follow-command.test.ts (~lines 90–136). Spec: 07-testing-strategy.md §2.4 and §3.2.
- **Issue:** (1) §2.4 requires `readNdjson` "tolerates unknown future fields (additive-only)"; the test schema `z.object({ id, name })` is non-strict so unknown fields pass implicitly, but no test seeds a line with an extra/future field and asserts the known fields still round-trip — a future accidental `.strict()` on the events schema would not be caught here. (2) §3.2(b) requires the top-level `follow` to "not stitch the archived log"; follow-command.test.ts asserts current-run replay, `--json` NDJSON, missing-file tolerance, and INVALID_ARGS, but never seeds an `archive/{ts}-events.ndjson` and asserts those records are excluded. Both behaviors work today (suite green) but the regression guards the spec calls out are absent.
- **Suggested fix:** (1) Add a `readNdjson` case writing a record with an extra field (e.g. `{ id, name, futureField: 1 }`) and assert the parsed result preserves the known fields without error. (2) Add a `handleFollow` case that writes an `archive/` events file alongside the current `events.ndjson` and asserts the emitted output contains only the current run's records.
- **References:** 07-testing-strategy.md §2.4 (REQ-EVT-06/REQ-REL-01), §3.2 (REQ-OBS-04); packages/core/src/fs-utils.test.ts:452; packages/cli/src/follow-command.test.ts
- **Checklist:** CHECK-I12, CHECK-I13

## Fix Execution Plan

### User Decisions Required
- **V-003 — RESOLVED (2026-06-13, user decision): option (a) — adopt the core `surfaceInspectedStatus` helper in the CLI.** Step 3 below executes option (a): replace `surfaceEmptyNotSilent`'s inline `listActiveLoops()`/filter with a call to `surfaceInspectedStatus(paths, derivedStatus)` rendering `inspectedDir` + `otherLiveLoops`. Do NOT delete the core helper. All other findings can be applied directly.

### Execution Steps

#### Step 1: Purge stale references to the removed `loop follow` / `status --watch` verbs
- **Files:** packages/cli/src/loop-commands.ts (line 397); docs/SPEC-CLI.md (lines 24, 165, 447–448, 622)
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-I01, CHECK-I02, CHECK-I05, CHECK-I07
- **Action:** In loop-commands.ts:397 change the hint to `` `rauf follow ${ctx.args[0] ?? "."}` ``. Grep packages/cli for any remaining `loop follow` / `loop watch` user-facing strings and fix. In docs/SPEC-CLI.md remove the `loop follow` table row + `### rauf loop follow` section, replace with the top-level `follow` command; replace `status --watch` / `--interval (requires --watch)` with `status --follow` / `-f` (+ `--interval` under `--follow`); drop `loop follow` from the server-requiring-commands sentence (line 622).
- **Depends on:** none
- **Rationale:** Pure documentation/string corrections; no behavior change, no test impact. Grouped because both are the same clean-break drift.

#### Step 2: Add the spec-named test assertions
- **Files:** packages/loop/src/runner.test.ts (or extract a pure coalescing/seq helper from runner.ts to test); packages/web/src/server/routes/loop.test.ts; packages/core/src/fs-utils.test.ts; packages/cli/src/follow-command.test.ts
- **Addresses:** V-004, V-005, V-006
- **Checklist:** CHECK-I12, CHECK-I13
- **Action:** (V-004) Add coalescing + seq-density tests via an injected clock per 07-testing-strategy.md §2.1 — exactly-one token record per window, structural events always written, clock-advance lets the next token through, dense gap-free seq with coalesced updates consuming no seq. (V-005) Add a `/loop/events` torn-trailing-line case asserting status 200 (not 500) and only complete records replayed. (V-006) Add a `readNdjson` additive-future-field case and a `handleFollow` archive-not-stitched case.
- **Depends on:** none
- **Rationale:** All additive test coverage for already-correct behavior; closes the §2.1/§2.4/§3.2/§5 coverage gaps the testing-strategy spec mandates. Run `pnpm -s test && pnpm -s typecheck` after.

#### Step 3: Resolve the `surfaceInspectedStatus` ownership (V-003) — after user decision
- **Files:** option (a) packages/cli/src/status-commands.ts (call the core helper); option (b) packages/core/src/status.ts + its test (delete helper + `InspectedStatusContext` export)
- **Addresses:** V-003
- **Checklist:** CHECK-I05, CHECK-I07
- **Action:** Apply the chosen option from "User Decisions Required". (a) Replace `surfaceEmptyNotSilent`'s inline `listActiveLoops()`/filter with a call to `surfaceInspectedStatus(paths, derivedStatus)`, rendering `inspectedDir` + `otherLiveLoops`. (b) Remove the unused helper, its export from index.ts, and its dedicated tests.
- **Depends on:** Step 1 (same CLI file region as V-001 in option (a)) and the user decision
- **Rationale:** Eliminates either the duplication or the dead code; ordered last because it needs a human choice and may touch the same CLI file as Step 1.

## Fix Progress
- Step 1: [APPLIED] 2026-06-13 — V-001: loop-commands.ts:397 hint `rauf loop follow` → `rauf follow` (grep confirms no other CLI refs). V-002: docs/SPEC-CLI.md — removed `loop follow` table row + section, added top-level `### rauf follow` section (file-backed, current-run-only), changed `status --watch`→`--follow`/`-f` + added `--all`, fixed server-requiring-commands sentence (line 626).
- Step 2: [APPLIED] 2026-06-13 — V-004: added "event persistence: coalescing + seq density" describe to runner.test.ts (2 tests via vi fake timers on private persistEvent: burst-coalesced-to-one + structural-always-written + dense seq skips coalesced; gapless seq with no coalescing). V-005: added torn-trailing-line no-500 test to web loop.test.ts (GET /loop/events stays 200, replays only complete records). V-006: added additive-future-field tolerance test to fs-utils.test.ts (readNdjson) + archive-not-stitched test to follow-command.test.ts. All green: loop runner.test.ts 55, web loop.test.ts 18, core fs-utils.test.ts 45, cli follow-command.test.ts 5.
- Step 3: [APPLIED] 2026-06-13 — V-003 (option a, user-chosen): adopted the core data layer. Extracted core `surfaceInspectedDir(inspectedDir, empty)` from `surfaceInspectedStatus` (which now delegates) so the registry read + exclude-self filter live in ONE place (status.ts). CLI `surfaceEmptyNotSilent` (which duplicated that filter) replaced by pure presenter `renderInspectedStatus(InspectedStatusContext, json)`; all 3 status call sites now feed it from `surfaceInspectedStatus` (resolved sites) / `surfaceInspectedDir` (not-installed site). Output shape (text + JSON) unchanged. Added 2 core tests for surfaceInspectedDir. core rebuilt. Green: core status-inspect 6, cli status-discovery 6 + status-commands 32; core+cli typecheck exit 0.

All 3 steps applied. Post-fix gate: typecheck/lint/format exit 0; full suite 1818 tests green (core 910, loop 290, cli 419, web 199). Verify stage → findings-applied.
