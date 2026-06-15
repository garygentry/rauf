---
name: ux-overhaul-phase4-web-tech-facts
description: Verified source ground-truth for ux-overhaul-web tech-spec (Phase 4) — recovery signatures, exhaustiveness reality, LoopStartOptions required fields
metadata:
  type: project
---

Ground truth verified against source for `specs/ux-overhaul-web/tech-spec.md` (Phase 4 web recovery parity). Companion to [[ux-overhaul-phase4-web-facts]] (the PRD-stage facts).

**Why:** tech mode's core job is integration-signature correctness; these are the source-of-truth checks that recur if the spec is re-verified or the impl spec is later checked.

**How to apply:** trust these over the spec's cited file:line when they disagree.

Recovery (cli/src/recovery.ts — D3.1 move target):
- `recoverInterruptedLoop(paths): Promise<Result<RecoverySummary>>` at line **445** — it is **async** and returns **RecoverySummary** (extends ReconcileSummary, adds stalledReset/stateCleared), NOT `Result<ReconcileSummary>`. Spec §4/§6 understate this (omit async + RecoverySummary type to move).
- It does NOT touch the lock — caller must `acquireRecoveryLock(paths)` first (recovery.ts:388) and hold across the call. The CLI resume orchestration (resume-commands.ts:268) acquires the lock, calls recover, releases before relaunch. Web's D3.4 route guard `assertNoLiveLoop` is a DIFFERENT, weaker model than acquire-and-hold — TOCTOU risk the spec doesn't address.
- `reverifyAndCommitInterrupted` (recovery.ts:296) spawns verify subprocess — correctly scoped CLI-only.
- Loop already exports findItemCommit/isTreeClean/gitCommit (loop/src/index.ts:4,7); loop imports @rauf/core; web imports @rauf/loop (loop-manager.ts:25). So D3.1 move cli→loop is dependency-legal and preserves rule #1. CONFIRMED sound.

checkLock: `checkLock(paths: BacklogPaths): Result<LockStatus>` (lock.ts:243) — takes **paths**, not lockPath. Separate `checkLockFile(lockPath)` exists (lock.ts:198). Spec §3.4/§6 wrongly write `checkLock(lockPath)`. Cross-process claim is TRUE (PID-based via lock file).

Exhaustiveness reality (spec §3.3 overstates TS safety):
- `mapLoopStateStatus` (status.ts:106) IS `Record<LoopState["status"],LoopStateEnum>` — exhaustive, compile-enforced. ✓
- `statusExitCode` (status-commands.ts:512) is a switch with NO default, returns in every case — exhaustive. ✓
- `colorLoopState` (status-commands.ts:538) HAS a `default:` branch — NOT exhaustive, no compile error.
- web `STATE_BADGE` (status.tsx:18, index.tsx:48) is `Record<string,StateBadgeConfig>` with `?? STATE_BADGE["IDLE"]` fallback — NOT exhaustive, silently mislabels unknown states. Spec's "compile error until handled" guarantee is FALSE for both badge sites.

LoopStartOptions (core/schemas.ts:370): REQUIRES maxIterations, maxRetries, sessionTimeoutMinutes (all non-optional); has review/reviewOnly/model/backlogRoot optional. Spec §3.2 review-options list omits required **sessionTimeoutMinutes** — existing loop route sets it via DEFAULT_SESSION_TIMEOUT_MINUTES (loop.ts:186). `startLoop` returns `{ok:true}|{ok:false,error}`; existing route returns `{data:{started:true,projectPath}}`.

--answer parsing: AnswerInjection is `{itemId, text}` (resume-commands.ts:54) — field is **text**, not **answer**. Spec §5 resume body uses `{itemId, answer}` — flagged for OQ-T2 (parked, do not error).

Confirmed-correct cites: resetProject (reset.ts:48), unblockItems (backlog.ts:431), validateBacklog (backlog-validate.ts:47, returns {valid,findings[]}), startReviewOnly (runner.ts:406, async Promise<LoopResult>), CSRF middleware (app.ts:54, code "FORBIDDEN" 403), LoopManager.startLoop (loop-manager.ts:86)/isRunning(:174)/checkLock imported(:24), resolveProjectPath (resolve-project.ts:18), validateProjectPath/resolveBacklogPathsFromParam (projects.ts:159/169), version 0.5.0→0.6.0 accurate. LoopStateEnum=10 (schemas.ts:228), raw=12 (schemas.ts:167). CANON §4.3 labels / §4.4 codes / §4.6 agent items all match spec.
