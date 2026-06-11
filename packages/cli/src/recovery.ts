// ─── Loop Recovery Helpers ───────────────────────────────────────
//
// Shared reconciliation + false-block requeue logic used by both
// `rauf reset` (reset-commands.ts) and `rauf resume` (item 012).
//
// A usage-limit death (or any environmental interruption) can leave a
// backlog in an inconsistent state:
//   - an item committed `[rauf] <id>:` but died before signalling done
//     (it is recorded blocked/deferred yet the work actually landed), and
//   - items the RUNTIME gave up on (deferred "false blocks") that are not
//     genuinely blocked by the agent.
//
// `reconcileAndRequeue` repairs both: it promotes committed-clean items to
// done and returns runner-deferred items to pending, while leaving genuine
// agent blocks (RAUF_BLOCKED / needsHuman) untouched so a human can see them.

import * as fs from "node:fs";

import {
  readBacklog,
  writeBacklog,
  readJsonFile,
  checkLock,
  releaseLock,
  resetStalledItems,
  clearDoneFile,
  clearCancelFile,
  ok,
  err,
  ErrorCodes,
  LoopStateSchema,
  type BacklogPaths,
  type Result,
} from "@rauf/core";
import { findItemCommit, isTreeClean } from "@rauf/loop";

// ─── Types ───────────────────────────────────────────────────────

export interface KeptBlock {
  id: string;
  reason: string;
}

export interface ReconcileSummary {
  /** Ids promoted to done because a clean `[rauf] <id>:` commit landed. */
  recovered: string[];
  /** Ids returned to pending because they were runner-deferred false blocks. */
  requeued: string[];
  /** Genuine agent blocks (RAUF_BLOCKED / needsHuman) left blocked, reported. */
  keptBlocked: KeptBlock[];
  /**
   * Whether commit reconciliation ran. False when the working tree was dirty,
   * in which case no items were promoted via commit (uncommitted work is not
   * silently marked done).
   */
  treeClean: boolean;
}

// ─── reconcileAndRequeue ─────────────────────────────────────────

/**
 * Reconcile committed work and requeue runner-deferred false blocks in a single
 * atomic read-modify-write of backlog.json. Never throws — git failures and IO
 * errors surface as `Result` errors.
 *
 * Ordering per non-done item:
 *   1. Commit reconciliation (only when the tree is clean): if a `[rauf] <id>:`
 *      commit exists, mark the item done (clearing deferred/blockedReason/
 *      needsHuman). This takes precedence so a deferred item whose work actually
 *      landed is recovered, not requeued.
 *   2. Requeue false blocks: items flagged `deferred` return to pending.
 *   3. Genuine agent blocks (status blocked, not deferred) stay blocked and are
 *      reported (needsHuman items included — they need a human, not a retry).
 *
 * Commit promotion is gated on a clean working tree because an uncommitted work
 * tree means the item's changes have NOT all landed — marking it done would lose
 * work. Requeue and block-reporting are independent of tree state and always run.
 *
 * Commit reconciliation is bounded to the run baseline (`baseCommitHash` from
 * state.json) so only commits made during the interrupted run can recover an
 * item — a stale `[rauf] <id>:` commit from a prior backlog cycle (rauf restarts
 * ids at 001 each backlog) is excluded. When state.json carries no baseline (an
 * old pre-baseline state, or none at all), genuine agent blocks (status
 * `blocked`, not `deferred`) are NOT auto-promoted via commit, since an unbounded
 * search could falsely mark a real block done; pending/deferred items still
 * reconcile so legitimately-landed work is recovered.
 */
export async function reconcileAndRequeue(paths: BacklogPaths): Promise<Result<ReconcileSummary>> {
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;
  const backlog = backlogResult.value;
  const projectPath = paths.projectPath;

  // Run baseline for commit reconciliation: only commits after this hash can
  // recover an item. Missing (old/absent state.json) → null (unbounded search,
  // restricted below for genuine blocks).
  const stateResult = readJsonFile(paths.state, LoopStateSchema);
  const baseCommitHash = stateResult.ok ? stateResult.value.baseCommitHash : null;

  // A clean tree is required before any commit-based promotion: uncommitted
  // changes mean the item's work has not fully landed.
  const cleanResult = await isTreeClean(projectPath);
  if (!cleanResult.ok) return cleanResult;
  const treeClean = cleanResult.value;

  const recovered: string[] = [];
  const requeued: string[] = [];
  const keptBlocked: KeptBlock[] = [];

  for (const item of backlog.items) {
    if (item.status === "done") continue;

    // 1. Commit reconciliation — recover work that landed before the loop died.
    // Without a run baseline, skip commit-promotion for genuine agent blocks
    // (status blocked, not deferred): an unbounded history search could promote
    // a real block on a matching stale commit.
    const isGenuineBlock = item.status === "blocked" && !item.deferred;
    const allowCommitPromotion = treeClean && (baseCommitHash !== null || !isGenuineBlock);
    if (allowCommitPromotion) {
      const commitResult = await findItemCommit(projectPath, item.id, baseCommitHash ?? undefined);
      if (!commitResult.ok) return commitResult;
      if (commitResult.value) {
        item.status = "done";
        item.completedAt = new Date().toISOString();
        delete item.deferred;
        delete item.blockedReason;
        delete item.needsHuman;
        recovered.push(item.id);
        continue;
      }
    }

    // 2. Requeue runner-deferred false blocks.
    if (item.deferred) {
      item.status = "pending";
      delete item.deferred;
      delete item.blockedReason;
      requeued.push(item.id);
      continue;
    }

    // 3. Genuine agent blocks stay blocked and are reported.
    if (item.status === "blocked") {
      const reason = item.needsHuman
        ? (item.blockedReason ?? "needs human input")
        : (item.blockedReason ?? "blocked by agent");
      keptBlocked.push({ id: item.id, reason });
    }
  }

  const writeResult = writeBacklog(paths, backlog);
  if (!writeResult.ok) return writeResult;

  return ok({ recovered, requeued, keptBlocked, treeClean });
}

// ─── guardLoopLock ───────────────────────────────────────────────

/** Outcome of inspecting (and possibly clearing) the loop lock. */
export interface LockGuard {
  /** A live loop holds the lock — the caller MUST refuse to recover/resume. */
  alive: boolean;
  /** PID recorded in the lock file, if a lock was present. */
  pid?: number;
  /** When the lock was acquired, if a lock was present. */
  startedAt?: string;
  /** A stale lock (dead/recycled PID) was found and removed. */
  cleared: boolean;
}

/**
 * Inspect the loop lock before a recovery/resume operation.
 *
 * - A live lock (present, not stale) → `alive: true`; the caller refuses so we
 *   never mutate a backlog out from under a running loop.
 * - A stale lock (dead or recycled PID) → removed, `cleared: true`.
 * - No lock → `alive: false, cleared: false`.
 *
 * Shared by `rauf reset` and `rauf resume` so both gate on the lock identically.
 */
export function guardLoopLock(paths: BacklogPaths): Result<LockGuard> {
  const lockResult = checkLock(paths);
  if (!lockResult.ok) return lockResult;
  const lock = lockResult.value;

  if (lock.locked && !lock.stale) {
    return ok({ alive: true, pid: lock.pid, startedAt: lock.startedAt, cleared: false });
  }

  if (lock.locked && lock.stale) {
    const cleared = releaseLock(paths);
    if (!cleared.ok) return cleared;
    return ok({ alive: false, pid: lock.pid, startedAt: lock.startedAt, cleared: true });
  }

  return ok({ alive: false, cleared: false });
}

// ─── recoverInterruptedLoop ──────────────────────────────────────

export interface RecoverySummary extends ReconcileSummary {
  /** Count of stalled `in_progress` items reset back to `pending`. */
  stalledReset: number;
  /** Whether state.json was present and removed. */
  stateCleared: boolean;
}

/**
 * Full recovery sequence for an interrupted loop, shared by `rauf reset` and
 * `rauf resume` so the two can never drift:
 *   1. Reconcile committed work + requeue runner-deferred false blocks.
 *   2. Reset stalled (`in_progress` → `pending`) items so the loop can pick
 *      them up again (`selectNextItem` only chooses `pending`).
 *   3. Clear state.json (which carries blockedItems/deferredItems), the DONE
 *      marker, and the CANCEL marker (so a relaunched loop isn't instantly
 *      killed by a leftover CANCEL).
 *
 * Does NOT touch the lock — call `guardLoopLock` first.
 */
export async function recoverInterruptedLoop(
  paths: BacklogPaths,
): Promise<Result<RecoverySummary>> {
  const reconcileResult = await reconcileAndRequeue(paths);
  if (!reconcileResult.ok) return reconcileResult;
  const summary = reconcileResult.value;

  const stalledResult = resetStalledItems(paths);
  if (!stalledResult.ok) return stalledResult;
  const stalledReset = stalledResult.value.resetCount;

  let stateCleared = false;
  try {
    fs.unlinkSync(paths.state);
    stateCleared = true;
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code !== "ENOENT") {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Failed to delete state.json: ${e.message}`,
        details: { path: paths.state },
      });
    }
  }

  const doneResult = clearDoneFile(paths);
  if (!doneResult.ok) return doneResult;
  const cancelResult = clearCancelFile(paths);
  if (!cancelResult.ok) return cancelResult;

  return ok({ ...summary, stalledReset, stateCleared });
}
