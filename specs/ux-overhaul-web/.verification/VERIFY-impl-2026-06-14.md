# Verification Report: ux-overhaul-web (impl)
Date: 2026-06-14
Pipeline Stage: forge-5-loop complete (10/10 items); verifying implementation
Artifacts Reviewed: the landed code on branch forge/ux-overhaul-web (packages/core, packages/loop, packages/cli, packages/web, artifacts/, docs/) against PRD.md + tech-spec.md + specs 00–06
Method: 4 parallel forge-verifier instances (dimensions: requirement-coverage, integration-correctness, testing, code-quality). Parent ran the full gate once: **pnpm typecheck ✓, lint ✓, format:check ✓, test ✓** — core 918, loop 300, web 232 (+33), cli 456, release 60; version.ts = 0.6.0.

## Summary
- Total findings: 4
- Gaps: 0
- Inconsistencies: 0
- Improvements: 4
- Errors: 0

Dimension tallies: requirement-coverage 6/6 pass (0 findings); integration-correctness 11/11 pass (0 findings); testing 8/8 pass (2 improvements); code-quality 12/12 pass (2 improvements). **Gate green; no blocking issues.**

Verified clean (highlights): all 28 PRD REQs map to real implementing code (5 routes present + registered before `/:id/backlog/:itemId`; enum + state-labels + statusExitCode; recovery relocation; agent docs; 0.6.0 + SPEC docs). Rule #1 intact (`grep 'from "@rauf/cli"' packages/web/src` empty; web depends only on @rauf/core + @rauf/loop). Lock model correct (reset/resume acquire-and-hold + finally release; resume releases before relaunch; unblock lightweight checkLock; validate GET ungated). `recoveryErrorStatus` mapping correct; 403 inherited app-level CSRF. OQ-T2 `{itemId,text}` → `updateItem(humanAnswer)`. `deriveFromStateJson` staleness keys on RAW status (TRACEABILITY note #1). embedded-artifacts regenerated (RAUF_REVIEW present). AGENT_ADDON NOT renamed; "Task tool" wording unchanged; minRunnerVersion unchanged; no feature-forge edits. The 409 route tests seed real live `.loop.lock` fixtures.

## Findings

### V-001: state-labels.test.ts drops the per-state tone-pinning table
- **Severity:** improvement
- **Location:** packages/core/src/state-labels.test.ts (vs spec 06 §4.1)
- **Issue:** Spec 06 §4.1 sketches an `it.each` pinning the exact `tone` for every state. The implemented test pins label+tone only for the 3 new/renamed states (REVIEWING, PAUSED_USAGE_LIMIT, PAUSED_HUMAN) and otherwise only asserts each tone ∈ the valid-tone set. A future accidental tone change on an existing state (e.g. ERROR danger→warning) would still pass. Real (small) coverage gap the green gate hides.
- **Suggested fix:** Add the per-state tone `it.each` from spec 06 §4.1 (filtered to drop the out-of-enum `STARTING` row), asserting `STATE_LABELS[state].tone` for every enum member; source the tone values from `packages/core/src/state-labels.ts`.
- **References:** 06-testing-strategy.md §4.1; packages/core/src/state-labels.ts
- **Checklist:** CHECK-I (test coverage & quality)

### V-002: state-labels.test.ts omits the "label is not the SCREAMING_SNAKE machine form" assertion
- **Severity:** improvement
- **Location:** packages/core/src/state-labels.test.ts totality loop (vs spec 06 §4.1, `expect(label).not.toBe(s)`)
- **Issue:** The totality loop asserts each label is a non-empty string but not that it differs from the raw enum/machine form. An entry accidentally set to `label: "REVIEWING"` would pass, defeating the human/Title-Case intent (REQ-VOCAB-06).
- **Suggested fix:** Add `expect(entry.label).not.toBe(state);` inside the totality loop after the length check.
- **References:** 06-testing-strategy.md §4.1
- **Checklist:** CHECK-I (test coverage & quality)

### V-003: `startReviewLoop` is a ~40-line verbatim duplicate of `startLoop`
- **Severity:** improvement
- **Location:** packages/web/src/server/loop-manager.ts (startLoop ~:86-125 vs startReviewLoop ~:132-171)
- **Issue:** `startReviewLoop` is a near-exact copy of `startLoop`, differing only in the runner method (`runner.start()` vs `runner.startReviewOnly()`) and one comment. The shared key/guard/`LoopRunner.create`/event-subscription/promise-cleanup/`activeLoops.set` logic is duplicated, risking drift if start mechanics change. (Linter doesn't catch this; the spec D3.2 described it as "mirrors startLoop," so the duplication is expected-but-improvable.)
- **Suggested fix:** Extract a private `launch(projectPath, options, run: (r: LoopRunner) => Promise<LoopResult>)` holding the shared body; `startLoop` delegates with `(r) => r.start()`, `startReviewLoop` with `(r) => r.startReviewOnly()`. Keep both public signatures unchanged. loop-manager.test.ts covers both paths.
- **References:** tech-spec D3.2; callers loop.ts (review route), projects.ts (resume relaunch)
- **Checklist:** CHECK-I (code quality — DRY/maintainability)

### V-004: `reconciled!` non-null assertion in the resume route relies on an implicit control-flow invariant
- **Severity:** improvement
- **Location:** packages/web/src/server/routes/projects.ts (resume handler, the `{ reconciled: reconciled!, … }` response)
- **Issue:** The handler declares `let reconciled: RecoverySummary | null = null` then asserts non-null at the response site. It is safe today (every path leaving it null returns early inside the `try`), but the safety is a control-flow invariant the compiler can't see; a future non-returning path after the `try` would silently send `reconciled: null`. CLAUDE.md flags `!` non-null abuse.
- **Suggested fix:** Restructure so the type is provably non-null at the response site — capture `const summary = recovery.value` on the success path and build `ResumeResult` from it (or construct the response inside the `try` after the relaunch decision), dropping the `!`.
- **References:** packages/web/src/server/routes/projects.ts (resume handler); CLAUDE.md Coding Conventions
- **Checklist:** CHECK-I (code quality — strict TS)

### Non-finding (recorded so it isn't re-flagged)
- statusExitCode "no longer exits 0" regression: spec 06 §4.3 sketched `…not.toBe(ExitCode.SUCCESS)`; the impl instead asserts the stronger positive `PAUSED_USAGE_LIMIT → ExitCode.LIMIT(4)` in the unified `it.each`, which subsumes it. No action.

## Fix Execution Plan

### User Decisions Required
None — all four are additive, non-blocking improvements; each may be deferred (the code is correct and gate-green as-is).

### Execution Steps

#### Step 1: Strengthen state-labels.test.ts assertions
- **Files:** packages/core/src/state-labels.test.ts
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-I (test coverage)
- **Action:** (a) In the totality loop, add `expect(entry.label).not.toBe(state);` after the length assertion. (b) Add an `it.each<[LoopStateEnum, StateTone]>` pinning the tone for every enum state (from spec 06 §4.1, dropping the out-of-enum `STARTING` row), sourcing the tone values from `packages/core/src/state-labels.ts`. Re-run `pnpm --filter @rauf/core test`.
- **Depends on:** none

#### Step 2: De-duplicate LoopManager start/review launch logic
- **Files:** packages/web/src/server/loop-manager.ts
- **Addresses:** V-003
- **Checklist:** CHECK-I (code quality)
- **Action:** Add `private launch(projectPath, options, run: (r: LoopRunner) => Promise<LoopResult>)` containing the shared body (key resolution, already-running guard, `LoopRunner.create` + error mapping, `LOOP_EVENT_TYPES` subscription, `promise = run(runner).then(...)` cleanup, `activeLoops.set`). Reduce `startLoop` → `return this.launch(projectPath, options, (r) => r.start())` and `startReviewLoop` → `… (r) => r.startReviewOnly())`. Keep both public signatures + doc comments.
- **Depends on:** none

#### Step 3: Remove the `reconciled!` non-null assertion
- **Files:** packages/web/src/server/routes/projects.ts
- **Addresses:** V-004
- **Checklist:** CHECK-I (code quality)
- **Action:** Restructure the resume handler so `reconciled` is provably non-null at the response site (capture `const summary = recovery.value` on the success path / build the `ResumeResult` from it), dropping the `!`. Re-run `pnpm --filter @rauf/web test`.
- **Depends on:** none

#### Step 4: Re-run the full gate
- **Files:** (none — verification)
- **Addresses:** all
- **Checklist:** —
- **Action:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` must stay green after Steps 1–3.
- **Depends on:** Steps 1–3

## Fix Progress

- Step 1: [APPLIED] 2026-06-14 — packages/core/src/state-labels.test.ts: added `expect(entry.label).not.toBe(state)` to the totality loop (V-002) + a full per-state tone-pinning `it.each` over all 12 enum values (V-001). (core tests 918→930.)
- Step 2: [APPLIED] 2026-06-14 — packages/web/src/server/loop-manager.ts: extracted `private launch(projectPath, options, run: (runner) => Promise<LoopResult>)` holding the shared key/guard/create/subscribe/track body; startLoop → `launch(..., r => r.start())`, startReviewLoop → `launch(..., r => r.startReviewOnly())`. Public signatures unchanged (V-003).
- Step 3: [APPLIED] 2026-06-14 — packages/web/src/server/routes/projects.ts: replaced `reconciled: reconciled!` with an explicit `if (!reconciled) return 500 IO_ERROR` guard that narrows the type (no non-null assertion) and defends a future non-returning edit (V-004).
- Step 4: [APPLIED] 2026-06-14 — Full gate re-run GREEN: typecheck ✓ / lint ✓ / format:check ✓ / test ✓ (core 930, loop 300, web 232, cli 456, release 60). (Note: editor LSP showed stale "@rauf/loop has no exported member acquireRecoveryLock/…" on projects.ts — phantom; real tsc passed.)
