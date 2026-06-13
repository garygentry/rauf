# Verification Report: ux-overhaul-grammar (impl)
Date: 2026-06-13
Pipeline Stage: forge-6-docs (impl verification)
Artifacts Reviewed:
- Specs: PRD.md, tech-spec.md, 00-core-definitions.md … 06-testing-strategy.md, TRACEABILITY.md, backlog.json
- Implementation: git commits 636686b..efb2c5d (`[rauf] 001..014`) across packages/cli, core, loop, web + docs
- Cross-cutting canon: specs/ux-overhaul/CANON.md

Method: 4 parallel `forge-verifier` instances — (1) requirement coverage, (2) integration correctness,
(3) testing, (4) code quality. Findings merged + renumbered.

## Gate Results (independently re-run)
- `pnpm typecheck` → PASS (exit 0, all 5 packages)
- `pnpm lint` → PASS · `pnpm format:check` → PASS
- `pnpm test` → PASS: @rauf/core 910, @rauf/cli 459, @rauf/loop 291, @rauf/web 199, release 60 — all green
- ExitCode call-site audit: `grep -rE 'ExitCode\.(INVALID_ARGS|NOT_FOUND|VALIDATION|CONFLICT|PAUSED_HUMAN)' packages/*/src` → **0 matches** (the atomic redefine + re-point is complete)

## Summary
- Total findings: 6
- Errors: 0
- Gaps: 0
- Inconsistencies: 2 (V-001, V-002)
- Improvements: 4 (V-003, V-004, V-005, V-006)

Overall: a clean, correct implementation. All in-scope requirements are implemented (REQ-EXEC/FLAG/EXIT/SIG/EVT/RMV/CONTRACT/DOC), every architectural invariant holds, the gate is green, and spec-06 test coverage is complete and meaningful. REQ-CONTRACT-04/05 (feature-forge edits + v0.5.0 tag/release) are correctly absent (out-of-loop). The findings are doc/surface-accuracy polish — none affect runtime correctness; two are worth fixing before the merge/cutover (V-001 contract-doc, V-002 run-flag help).

## Findings

### V-001: Supervisor-pattern docs cite the stale exit code `6` for paused_human (now `3`)
- **Severity:** inconsistency
- **Location:** docs/SPEC-CLI.md:527 and docs/SPEC-BACKLOG-TOOL-CONTRACT.md:244
- **Issue:** Both supervisor-pattern paragraphs tell a machine consumer to detect a `paused_human` `loop run` halt by "detecting the exit code `6`". Under v0.5.0 `loop run` exits **`3` (NEEDS_HUMAN)** for PAUSED_HUMAN (confirmed in code: loop-commands.ts ~:653 `return ExitCode.NEEDS_HUMAN`), and `6` is now `RUNNING` — "query-time only (`status`); never a `loop run` terminal code". So the doc instructs consumers to branch on a code `loop run` will never return, and `6` would be misread as "running". This is exactly the disagreement REQ-EXIT-02 exists to remove; it survived because commits 6c130c1/2118e91 updated the exit-code *tables* (SPEC-CLI §Exit-Codes correctly maps 3→NEEDS_HUMAN) but missed these two inline sentences.
- **Suggested fix:** In docs/SPEC-CLI.md:527 and docs/SPEC-BACKLOG-TOOL-CONTRACT.md:244, change "the exit code `6`" → "the exit code `3` (NEEDS_HUMAN)". Then `grep -rn "exit code .6." docs/` to confirm none remain in a `loop run` context.
- **References:** SPEC-CLI.md:166/:435 (already correct); 00-core-definitions.md §1/§2a; 03-exit-codes.md §3; loop-commands.ts:650-661
- **Checklist:** CHECK-I03 (spec-vs-code contradiction), CHECK-I02 (REQ-DOC-01)

### V-002: `loop run` help advertises `--json`/`--interval` but the handler reads `--ndjson` and ignores `--interval`
- **Severity:** inconsistency
- **Location:** packages/cli/src/commands.ts (`run` subcommand `flags` array, ~:181-186) vs packages/cli/src/loop-commands.ts `handleLoopRun` (~:694 reads `ndjson`; `--interval` read nowhere in the run path)
- **Issue:** Item 008's flag-canon work rewrote the `loop run` help: it removed the `--ndjson` entry and added `--json` ("machine-readable") and `--interval <seconds>`. But the run handler's per-event NDJSON stream still keys off `--ndjson` (`extractBoolFlag(ctx.flags,"ndjson")`), not `--json` (global `--json` only changes the final result line). So: (a) `loop run --json` is advertised as the stream switch but does NOT enable the event stream — only `--ndjson` does; (b) `--interval` is dead help text for `run` (meaningful only for follow/status polling); (c) `--ndjson` — the flag the handler actually depends on, and the one **feature-forge's `eventStreamCommand` uses** (`loop run … --ndjson`) — is now undocumented. The handler is correct (this very loop ran via `--ndjson`); the **help table** over-applied the read-command flag canon to the execution command. *Note: REQ-FLAG-02's `--json`-on-every-read canon targets read/monitor commands (status/log/follow); `loop run` is an execution command whose stream flag is `--ndjson`.*
- **Suggested fix:** Reconcile help with the handler (USER DECISION — see Fix Execution Plan). Recommended (handler-correct, forge-5-loop-safe): restore `--ndjson` to the `run` help, remove the `--interval` entry from `run`, and either drop `--json` from `run` or clarify it only affects the final result line. Do NOT silently repoint the handler off `--ndjson` without aliasing — feature-forge depends on `loop run … --ndjson`.
- **References:** commands.ts run flags (commit f379b9a/008); loop-commands.ts:690-1001; parser.ts:64 (global --json); docs/SPEC-CLI.md; feature-forge eventStreamCommand default
- **Checklist:** CHECK-I05/I06 (advertised-vs-implemented surface coherence)

### V-003: `--create-branch` + `--retry-blocked` setup duplicated between `runDetached` and `handleLoopRun`
- **Severity:** improvement
- **Location:** packages/cli/src/loop-commands.ts — `runDetached` (~:308-335) and `handleLoopRun` (~:731, ~:803)
- **Issue:** Item 006's fold of `handleLoopStart` into `runDetached` left near-identical copies of two pre-run blocks in both paths: the `--create-branch` resolve/switch and the `--retry-blocked` unblock. They differ only trivially. Future edits must touch both and will drift. The fold was the natural extraction point.
- **Suggested fix:** Extract the create-branch and retry-blocked blocks into a shared helper (e.g. `applyPreRunBranchAndUnblock(ctx, projectPath)`) called from both `runDetached` and the in-process branch of `handleLoopRun`; preserve the existing `ExitCode.USAGE` returns and info messages (~25 fewer duplicated lines, single edit point).
- **References:** loop-commands.ts runDetached + handleLoopRun; commit bc1b2b8 (item 006)
- **Checklist:** CHECK-I07 (maintainability / DRY)

### V-004: Stale comment in status-commands.ts describes the OLD exit-code scheme
- **Severity:** improvement
- **Location:** packages/cli/src/status-commands.ts:~38
- **Issue:** A comment still describes the pre-v0.5.0 scheme ("1=running, 2=blocked/needs_human, 3=limit_reached"). Functionally inert (the code below is the new unified mapping), but misleading to a future reader.
- **Suggested fix:** Update the comment to the unified scheme (or delete it and rely on the `statusExitCode` mapping + 00 §2b reference).
- **References:** status-commands.ts:38; 00-core-definitions.md §2b
- **Checklist:** CHECK-I07

### V-005: Stale `loop start` in the deferred Part-B (provider) section of SPEC-BACKLOG-TOOL-CONTRACT
- **Severity:** improvement
- **Location:** docs/SPEC-BACKLOG-TOOL-CONTRACT.md:375 (FR-12) and :880 (docs-change table)
- **Issue:** FR-12 says "the CLI MUST accept a `--provider` flag on `rauf loop run` and `rauf loop start`"; `loop start` was removed in v0.5.0. NOT an in-scope gap — both references live in the Part-B provider-architecture section that PRD §5/§7 explicitly defers as a separate effort, so this feature was not obligated to rewrite it. But it now names a removed verb.
- **Suggested fix:** Low priority — defer to the Part-B work (drop `loop start` from FR-12 + the :880 table; `--provider` attaches to `loop run` only). Optionally add a one-line "`loop start` removed in v0.5.0" note now so the deferred section isn't mistaken for current grammar.
- **References:** PRD §5/§7; REQ-EXEC-02; 02-execution-grammar.md §1
- **Checklist:** CHECK-I02

### V-006: `loop run` LIMIT(4) terminal reachability not fully asserted end-to-end
- **Severity:** improvement
- **Location:** packages/cli/src/loop-commands.ts:~639-641 (`isLimitTerminal`); packages/loop/src/runner.ts (`limitReached`/`limitTerminal` at the terminal-write sites)
- **Issue:** The impl added the optional `limitReached` carrier to `LoopResult` and the ordered `loopRunExitCode` mapping (the `loop-commands.test.ts` it.each covers limit→4, so the mapping IS tested). The residual is whether `this.limitTerminal` is set on *every* real limit/usage-paused/sleeping terminal path in the runner (vs only some) — a runner-internal completeness question not fully traced. Plausibly complete; flagged for confidence only.
- **Suggested fix:** No code change required for DoD. Optionally add/confirm a runner test that a usage-paused / weekly-limit / sleeping terminal each sets `limitTerminal` so `loop run` returns `4`, matching `status`'s LIMIT mapping; otherwise document which limit terminals surface only via `status`.
- **References:** 03-exit-codes.md §3; 00-core-definitions.md §2a; runner.ts limit terminals
- **Checklist:** CHECK-I04

## Fix Execution Plan

### User Decisions Required
- **V-002 — RESOLVED (2026-06-13, user): keep `--ndjson` as the run event-stream flag; help-table-only fix.** The handler is unchanged. Step 2 restores `--ndjson` to the `run` help, removes the `--interval` entry from `run`, and drops/clarifies `--json` (final-line only). Do NOT repoint the handler.

### Execution Steps

#### Step 1: Fix the stale exit-code `6` in the contract docs
- **Files:** docs/SPEC-CLI.md (:527), docs/SPEC-BACKLOG-TOOL-CONTRACT.md (:244)
- **Addresses:** V-001
- **Checklist:** CHECK-I03, CHECK-I02
- **Action:** Change "the exit code `6`" → "the exit code `3` (NEEDS_HUMAN)" in both supervisor-pattern paragraphs; grep `docs/` to confirm no other `loop run`-context "exit code 6" remains.
- **Depends on:** none

#### Step 2: Reconcile the `loop run` flag help with the handler
- **Files:** packages/cli/src/commands.ts (run flags), packages/cli/src/loop-commands.ts (+ parser.ts if aliasing), docs/SPEC-CLI.md
- **Addresses:** V-002
- **Checklist:** CHECK-I05, CHECK-I06
- **Action:** Per the user decision. Recommended (help-only): restore `--ndjson` to the `run` help entry, remove the `--interval` entry from `run`, and drop or clarify `--json` (final-line only). Ensure the advertised flags match what `handleLoopRun` reads; keep feature-forge's `loop run … --ndjson` working. Re-run the help/usage no-stale-token test + the gate.
- **Depends on:** V-002 decision

#### Step 3: Code-quality cleanups (DRY + stale comment)
- **Files:** packages/cli/src/loop-commands.ts, packages/cli/src/status-commands.ts
- **Addresses:** V-003, V-004
- **Checklist:** CHECK-I07
- **Action:** Extract the shared `--create-branch` / `--retry-blocked` pre-run blocks into a helper used by both `runDetached` and `handleLoopRun` (V-003). Update the stale exit-scheme comment at status-commands.ts:~38 to the unified scheme (V-004). Re-run the gate.
- **Depends on:** none

#### Step 4 (optional / defer): low-priority docs + LIMIT reachability
- **Files:** docs/SPEC-BACKLOG-TOOL-CONTRACT.md (FR-12/:880), packages/loop/src/runner.test.ts
- **Addresses:** V-005, V-006
- **Checklist:** CHECK-I02, CHECK-I04
- **Action:** V-005 — optionally note `loop start` removed in the deferred Part-B section (or leave for the Part-B effort). V-006 — optionally add a runner test asserting each limit/usage-paused/sleeping terminal sets `limitReached` so `loop run`→4. Both are non-blocking.
- **Depends on:** none

## Fix Progress
- Step 1: [APPLIED] 2026-06-13 — V-001: docs/SPEC-CLI.md:527 + docs/SPEC-BACKLOG-TOOL-CONTRACT.md:244 supervisor-pattern "exit code 6" → "exit code 3 (NEEDS_HUMAN)".
- Step 2: [APPLIED] 2026-06-13 — V-002 (decision: keep --ndjson, fix help): loop run flag help — restored --ndjson entry (the event-stream flag the handler reads + feature-forge uses), removed the spurious --interval entry, clarified --json as "final result summary as JSON". Handler unchanged.
- Step 3: [APPLIED] 2026-06-13 — V-003: extracted shared applyCreateLoopBranch() + unblockIfRequested() helpers in loop-commands.ts; runDetached + handleLoopRun now both call them (removed the duplicated create-branch + retry-blocked blocks + the now-unused retryBlocked locals). V-004: status-commands.ts:38 comment updated to the unified v0.5.0 exit scheme.
- Step 4: [PARTIAL] 2026-06-13 — V-005: SPEC-BACKLOG-TOOL-CONTRACT FR-12 annotated (loop start removed in v0.5.0; re-scope to loop run when Part-B is specced). V-006: DEFERRED (non-blocking) — loopRunExitCode it.each already covers limit→4; runner-internal limit-terminal reachability tests are scope creep on a green build, left for a future pass.
- Post-fix gate: typecheck/lint/format exit 0; tests 1859 green (core 910, loop 291, cli 459, web 199). (LSP threw repeated PHANTOM diagnostics during edits — old/new ExitCode members, pausedReason/limitReached — all contradicted by real tsc exit 0; disregarded.)

All findings applied or explicitly deferred (V-006). Verify stage → findings-applied.
