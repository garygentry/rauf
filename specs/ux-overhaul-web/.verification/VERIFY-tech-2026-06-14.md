# Verification Report: ux-overhaul-web (tech)
Date: 2026-06-14
Pipeline Stage: forge-3-specs (verifying forge-2-tech output)
Artifacts Reviewed: specs/ux-overhaul-web/tech-spec.md, specs/ux-overhaul-web/PRD.md (against live source in packages/core, packages/loop, packages/cli, packages/web, and specs/ux-overhaul/CANON.md)
Checks Executed: 17 of 17 (11 pass, 6 fail, 0 not-applicable)

## Summary
- Total findings: 7
- Gaps: 1
- Inconsistencies: 1
- Improvements: 2
- Errors: 3

(Note: severity counts adjusted from the verifier's draft — V-003 reclassified context below; the 4 source-mismatch findings V-001/V-002/V-003/V-004 are the priority regardless of label.)

## Findings

### V-001: `checkLock` signature cited wrong — takes `BacklogPaths`, not `lockPath`
- **Severity:** error
- **Location:** tech-spec.md §3.4 and §6 "Integration Points"
- **Issue:** Both cite `checkLock(lockPath): Result<LockStatus>`. The actual export is `checkLock(paths: BacklogPaths): Result<LockStatus>` (packages/core/src/lock.ts:243), which internally calls `checkLockFile(paths.lock)`. There is a separate `checkLockFile(lockPath: string)` (lock.ts:198) — the spec conflates the two. An impl agent wiring `assertNoLiveLoop` would pass the wrong argument type. (The cross-process / PID-based reasoning in §3.4 is itself correct.)
- **Suggested fix:** Change both occurrences to `checkLock(paths: BacklogPaths): Result<LockStatus>`. Note `LockStatus = { locked, pid?, startedAt?, stale? }` and that "live" = `locked === true && stale !== true`. The route guard builds/resolves `BacklogPaths` (it already does via `resolveBacklogPathsFromParam`) and passes that.
- **References:** packages/core/src/lock.ts:39 (LockStatus), :198 (checkLockFile), :243 (checkLock); LoopManager imports `checkLock` (loop-manager.ts:24,206)
- **Checklist:** CHECK-T05, CHECK-T06

### V-002: `recoverInterruptedLoop` is async and returns `RecoverySummary`, not `Result<ReconcileSummary>`
- **Severity:** error
- **Location:** tech-spec.md §6, §3.1, §4 Data Model
- **Issue:** Source: `recoverInterruptedLoop(paths: BacklogPaths): Promise<Result<RecoverySummary>>` (packages/cli/src/recovery.ts:445) — **async**, resolves a **`RecoverySummary`** (recovery.ts:425, `extends ReconcileSummary` adding `stalledReset: number` and `stateCleared: boolean`). The spec (a) writes `recoverInterruptedLoop(paths)` without flagging the Promise (§3.1 chains it synchronously), (b) §3.1's move-types list omits `RecoverySummary` (the actual return type), (c) §4's `ResumeResult { reconciled: ReconcileSummary }` types the field as the narrower type.
- **Suggested fix:** §6: `recoverInterruptedLoop(paths: BacklogPaths): Promise<Result<RecoverySummary>>` (async; route must `await`). §3.1: add `RecoverySummary` to the moved-types list. §4: type `ResumeResult.reconciled` as `RecoverySummary` (or document the projection from `RecoverySummary`→`ReconcileSummary`).
- **References:** packages/cli/src/recovery.ts:445 (fn), :425 (RecoverySummary), :57 (ReconcileSummary)
- **Checklist:** CHECK-T05, CHECK-T06, CHECK-T12

### V-003: §3.3 overstates TS exhaustiveness — `colorLoopState` and web `STATE_BADGE` are NOT compile-enforced
- **Severity:** error
- **Location:** tech-spec.md §3.3 "Ripple" bullet
- **Issue:** §3.3 claims adding enum members is "a compile error until handled — guaranteeing no silent fallthrough" for `colorLoopState` and web `STATE_BADGE`. False: `colorLoopState` (status-commands.ts:538) has a `default:` branch (new states compile silently, dimmed); web `STATE_BADGE` is `Record<string, …>` with `?? STATE_BADGE["IDLE"]` (status.tsx:18/89, index.tsx:48/72) — new states compile and silently mislabel as IDLE. The compile guarantee holds only for `mapLoopStateStatus` (`Record<LoopState["status"], LoopStateEnum>`, status.ts:107) and `statusExitCode` (default-less switch, status-commands.ts:512). Since REQ-VOCAB-07 ("no value renders unstyled/as a silent default") is P0, the impl must actively convert these sites (D3.5's refactor) — not lean on a non-existent compiler check.
- **Suggested fix:** Reword §3.3's Ripple bullet: compile-enforced sites are only `mapLoopStateStatus` and `statusExitCode`. `colorLoopState` (has `default`) and web `STATE_BADGE` (`Record<string,…>` + `?? IDLE`) are NOT enforced and silently mis-render new states today; the D3.5 refactor must replace them with a total `Record<LoopStateEnum, …>` (or default-less switch) so REQ-VOCAB-07 becomes structurally true. Remove the "compile error until handled" claim for the badge/color sites.
- **References:** status-commands.ts:538 (default), :512 (exhaustive); status.tsx:18,89; index.tsx:48,72; status.ts:107
- **Checklist:** CHECK-T05, CHECK-T16

### V-004: Review-route `LoopStartOptions` omits the required `sessionTimeoutMinutes` field
- **Severity:** gap
- **Location:** tech-spec.md §3.2
- **Issue:** §3.2 builds review `LoopStartOptions` as `{maxIterations:1, maxRetries:1, review:true, reviewOnly:true, model?, backlogRoot?}`. `LoopStartOptionsSchema` (schemas.ts:370) makes `maxIterations`, `maxRetries`, **and `sessionTimeoutMinutes`** required. The existing start route sets `sessionTimeoutMinutes: body.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES` (loop.ts:186) precisely because it's required. Omitting it fails `LoopStartOptionsSchema.parse` / is a type error.
- **Suggested fix:** Add `sessionTimeoutMinutes: body.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES` to the review options (reuse the same default constant), and note the field set is built/validated via `LoopStartOptionsSchema.parse` as the existing route does.
- **References:** schemas.ts:370-385; routes/loop.ts:178-192
- **Checklist:** CHECK-T05, CHECK-T13

### V-005: Resume's lock model (acquire-and-hold) differs from §3.4's check-only guard — unaddressed TOCTOU for resume/reset
- **Severity:** inconsistency
- **Location:** tech-spec.md §3.4 vs §3.1 resume flow
- **Issue:** §3.4 specifies a route-layer `assertNoLiveLoop` that *checks* `checkLock` then returns 409 — check-then-act. But the CLI path it claims to "mirror" does NOT just check: `acquireRecoveryLock(paths)` (recovery.ts:388) atomically **acquires and holds** the lock across reconcile→relaunch to close the TOCTOU (recovery.ts:372-386), and `recoverInterruptedLoop` itself "does NOT touch the lock — acquire it via `acquireRecoveryLock` first and hold it across this call" (recovery.ts:442). A pre-check leaves a window where a CLI loop acquires the lock after the web check passes but before/while web mutates. §3.4's "mirrors `acquireRecoveryLock` semantics" is inaccurate (check ≠ acquire-and-hold). Bears on REQ-WEB-09 (P1, "never silently corrupts loop state").
- **Suggested fix:** For resume and reset, reuse `acquireRecoveryLock`/`releaseRecoveryLock` (relocate them with `recoverInterruptedLoop` in D3.1) and hold the lock across reconcile (+ relaunch handoff for resume), release in a `finally` via the owner-aware `releaseRecoveryLock`. `unblock` (single core call) may use the lighter `checkLock`→409 guard. Update §3.4 to distinguish lightweight check-then-act (unblock) vs acquire-and-hold (resume/reset); correct the "mirrors" wording.
- **References:** recovery.ts:372-401 (acquireRecoveryLock + TOCTOU rationale), :410 (releaseRecoveryLock owner-aware), :442-443 (lock contract), resume-commands.ts:268 (acquire site)
- **Checklist:** CHECK-T02, CHECK-T05, CHECK-T16

### V-006: Relocated lock helpers / D3.1 move list incomplete
- **Severity:** improvement
- **Location:** tech-spec.md §3.1, §6
- **Issue:** The move list names only `recoverInterruptedLoop` + `ReconcileSummary, KeptBlock, InterruptedItem`. But it's unusable without its lock companions; cli/src/recovery.ts also exports `acquireRecoveryLock`/`releaseRecoveryLock` (:388/410), `AcquiredRecoveryLock`, `RecoverySummary` (V-002), `reconcileAndRequeue` (:163), `detectInterruptedItems` (:114). The boundary vs CLI-only `reverifyAndCommitInterrupted` is undecided → an impl surprise.
- **Suggested fix:** Specify the partition: move to `@rauf/loop/src/recovery.ts` — `recoverInterruptedLoop`, `reconcileAndRequeue`, `acquireRecoveryLock`, `releaseRecoveryLock`, `detectInterruptedItems` + types `ReconcileSummary`, `RecoverySummary`, `KeptBlock`, `InterruptedItem`, `AcquiredRecoveryLock`; keep `reverifyAndCommitInterrupted` + `defaultVerifyRunner` (subprocess verify, CLI-only per D3.1) in `@rauf/cli`. CLI re-imports the moved symbols. (Pairs with V-005.)
- **References:** recovery.ts:114,163,260,296,388,410,425,445
- **Checklist:** CHECK-T05, CHECK-T08

### V-007: Error-mapping table omits the FORBIDDEN/403 (missing CSRF) path the testing section depends on
- **Severity:** improvement
- **Location:** tech-spec.md §7 and §5 vs §8
- **Issue:** §7's code→status table and §5's enumeration omit the 403 FORBIDDEN response for a missing `X-Rauf-Request` header, yet §8 requires a test for "403 missing X-Rauf-Request." The 403 comes from global middleware (app.ts:54-69, code `"FORBIDDEN"`), not per-route mapping. Also: the §7 →400 row uses placeholder `PATH_VIOLATION`, but `validateProjectPath` (projects.ts:159-162) returns the underlying `validatePath` error code, which may differ.
- **Suggested fix:** Add a §7 note that 403 `FORBIDDEN` (missing `X-Rauf-Request`) is enforced by app-level CSRF middleware (app.ts:54) and inherited by all POST routes (covered without per-route code). Verify the exact sandbox-violation code returned by `validatePath`/`validateProjectPath` and use it in the →400 row instead of `PATH_VIOLATION` if they differ.
- **References:** app.ts:54-69; projects.ts:159-162
- **Checklist:** CHECK-T05, CHECK-T10

## Verified clean (not findings)
- D3.1 dependency direction sound: `@rauf/loop` exports `findItemCommit`/`isTreeClean`/`gitCommit` (loop/src/index.ts:4,7), imports `@rauf/core`, and `@rauf/web` already imports `@rauf/loop` (loop-manager.ts:25). Moving recovery cli→loop preserves rule #1.
- CANON alignment exact: §3.5 labels = CANON §4.3; §3.3 exit codes REVIEWING→6, PAUSED_USAGE_LIMIT→4 = CANON §4.4; §3.6 agent items = CANON §4.6 (rename deferred).
- Confirmed-correct cites: resetProject (reset.ts:48), unblockItems (backlog.ts:431), validateBacklog (backlog-validate.ts:47, returns `{valid,findings[]}`), startReviewOnly (runner.ts:406), LoopManager.startLoop (loop-manager.ts:86), CSRF app.ts:54, mapLoopStateStatus (status.ts:106), statusExitCode (status-commands.ts:512), colorLoopState (status-commands.ts:538), LoopStateEnumSchema (schemas.ts:228, 10 values), raw status enum (schemas.ts:167, 12 values), version 0.5.0→0.6.0 minor.
- OQ-T1 (color tables) correctly parked. **OQ-T2 confirmed real:** CLI `--answer` parses to `AnswerInjection {itemId, text}` (resume-commands.ts:54), while §5's resume body uses `{itemId, answer}` — the impl spec must reconcile the field name.

## Fix Execution Plan

### User Decisions Required
None — all fixes are spec-text corrections derivable from source. (V-005/V-006 adopt the verifier-recommended acquire-and-hold lock partition to honor REQ-WEB-09.)

### Execution Steps

#### Step 1: Correct integration signatures in §6 and §3
- **Files:** specs/ux-overhaul-web/tech-spec.md (§3.1, §3.2, §3.4, §4, §6)
- **Addresses:** V-001, V-002, V-004
- **Checklist:** CHECK-T05, CHECK-T06, CHECK-T12, CHECK-T13
- **Action:** (a) Replace both `checkLock(lockPath)` → `checkLock(paths: BacklogPaths): Result<LockStatus>`; note `LockStatus = {locked, pid?, startedAt?, stale?}`, live = `locked && !stale`. (b) §6: `recoverInterruptedLoop(paths: BacklogPaths): Promise<Result<RecoverySummary>>` (async, await); §3.1 add `RecoverySummary` to move list; §4 type `ResumeResult.reconciled` as `RecoverySummary`. (c) §3.2 add `sessionTimeoutMinutes: body.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES` and note `LoopStartOptionsSchema.parse`.
- **Depends on:** none

#### Step 2: Fix the exhaustiveness/enforcement claims in §3.3
- **Files:** specs/ux-overhaul-web/tech-spec.md (§3.3 Ripple bullet)
- **Addresses:** V-003
- **Checklist:** CHECK-T05, CHECK-T16
- **Action:** State compile-enforcement holds only for `mapLoopStateStatus` + `statusExitCode`. `colorLoopState` (`default:`) and web `STATE_BADGE` (`Record<string,…>` + `?? IDLE`) are NOT enforced and silently mis-render new states; D3.5 must convert them to a total `Record<LoopStateEnum,…>` / default-less switch to make REQ-VOCAB-07 structurally true. Remove the "compile error until handled" claim for badge/color sites.
- **Depends on:** none

#### Step 3: Specify the lock model and move-partition for recovery (resume/reset)
- **Files:** specs/ux-overhaul-web/tech-spec.md (§3.1, §3.4, §6)
- **Addresses:** V-005, V-006
- **Checklist:** CHECK-T02, CHECK-T05, CHECK-T08, CHECK-T16
- **Action:** Expand D3.1 move list (§3.1/§6) to `recoverInterruptedLoop`, `reconcileAndRequeue`, `acquireRecoveryLock`, `releaseRecoveryLock`, `detectInterruptedItems` + types `ReconcileSummary`, `RecoverySummary`, `KeptBlock`, `InterruptedItem`, `AcquiredRecoveryLock` → `@rauf/loop/src/recovery.ts`; keep `reverifyAndCommitInterrupted`/`defaultVerifyRunner` in `@rauf/cli`. §3.4: resume/reset use acquire-and-hold (`acquireRecoveryLock` across reconcile+relaunch, release in `finally`); unblock uses lightweight `checkLock`→409; validate ungated. Correct the "mirrors `acquireRecoveryLock`" wording.
- **Depends on:** Step 1
- **Rationale:** V-005/V-006 are the same subsystem — decide together.

#### Step 4: Round out the error-surface notes in §7/§5
- **Files:** specs/ux-overhaul-web/tech-spec.md (§5 note, §7)
- **Addresses:** V-007
- **Checklist:** CHECK-T05, CHECK-T10
- **Action:** Add §7 note: 403 `FORBIDDEN` (missing `X-Rauf-Request`) is enforced by app-level CSRF middleware (app.ts:54), inherited by all POST routes. Verify the real sandbox-violation code from `validatePath`/`validateProjectPath` and use it in the →400 row instead of `PATH_VIOLATION` if different.
- **Depends on:** none

#### Step 5: Note OQ-T2 field-name reconciliation
- **Files:** specs/ux-overhaul-web/tech-spec.md (§10 OQ-T2)
- **Addresses:** verified-clean note (OQ-T2 real)
- **Checklist:** CHECK-T05
- **Action:** Update OQ-T2 to state the concrete mismatch: CLI `--answer` → `AnswerInjection {itemId, text}` (resume-commands.ts:54) vs §5 resume body `{itemId, answer}`; the impl spec must pick one (recommend matching the CLI's `text`, or explicitly documenting the web's `answer`→`text` adaptation).
- **Depends on:** none

## Fix Progress

- Step 1: [APPLIED] 2026-06-14 — Corrected integration signatures: §6 `checkLock(paths: BacklogPaths): Result<LockStatus>` (live = locked && !stale; noted distinct checkLockFile); §6 `recoverInterruptedLoop(paths): Promise<Result<RecoverySummary>>` async + RecoverySummary contract + acquire/releaseRecoveryLock entries; §3.2 review options add required `sessionTimeoutMinutes` via LoopStartOptionsSchema.parse; §4 `ResumeResult.reconciled: RecoverySummary`.
- Step 2: [APPLIED] 2026-06-14 — §3.3 reworded: compile-enforcement holds only for mapLoopStateStatus + statusExitCode (default-less); colorLoopState (default:) and web STATE_BADGE (Record<string> + ?? IDLE) are NOT enforced and silently mis-render — D3.5 refactor to total Record<LoopStateEnum> is the enforcement mechanism. Removed the false "compile error until handled" claim for badge/color sites.
- Step 3: [APPLIED] 2026-06-14 — §3.1 move list expanded to recoverInterruptedLoop + reconcileAndRequeue + acquireRecoveryLock + releaseRecoveryLock + detectInterruptedItems + types (ReconcileSummary/RecoverySummary/KeptBlock/InterruptedItem/AcquiredRecoveryLock) → @rauf/loop; reverifyAndCommitInterrupted/defaultVerifyRunner stay CLI-only. §3.4 split into two guard strengths: unblock = lightweight checkLock→409; reset/resume = acquire-and-hold across reconcile(+relaunch) with finally-release (closes TOCTOU); corrected the "mirrors acquireRecoveryLock" wording.
- Step 4: [APPLIED] 2026-06-14 — §7 error handling: noted 403 FORBIDDEN is app-level CSRF middleware (inherited, covers §8 test without per-route code); sandbox breach uses validateProjectPath's real validatePath code (confirm vs PATH_VIOLATION at impl); removed PATH_VIOLATION from the per-route →400 list.
- Step 5: [APPLIED] 2026-06-14 — §10 OQ-T2 updated to the confirmed mismatch (CLI {itemId,text} vs §5 {itemId,answer}); impl spec to pick one (recommend CLI's `text`).
