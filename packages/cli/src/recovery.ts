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
import { spawn } from "node:child_process";

import {
  readBacklog,
  writeBacklog,
  readJsonFile,
  acquireLock,
  checkLock,
  releaseLock,
  resetStalledItems,
  clearDoneFile,
  clearCancelFile,
  ok,
  err,
  ErrorCodes,
  LoopStateSchema,
  type Backlog,
  type BacklogPaths,
  type Result,
} from "@rauf/core";
import { findItemCommit, isTreeClean, gitCommit } from "@rauf/loop";

// ─── Types ───────────────────────────────────────────────────────

export interface KeptBlock {
  id: string;
  reason: string;
}

/**
 * An item left `in_progress` with uncommitted changes and no `[rauf] <id>:`
 * commit at/after the run baseline — an iteration killed in the verify→commit
 * window (verified-but-uncommitted work). Recoverable via `rauf resume --recover`.
 */
export interface InterruptedItem {
  id: string;
  title: string;
}

export interface ReconcileSummary {
  /** Ids promoted to done because a clean `[rauf] <id>:` commit landed. */
  recovered: string[];
  /** Ids returned to pending because they were runner-deferred false blocks. */
  requeued: string[];
  /** Genuine agent blocks (RAUF_BLOCKED / needsHuman) left blocked, reported. */
  keptBlocked: KeptBlock[];
  /**
   * Interrupted iterations: `in_progress` items with uncommitted work and no
   * matching commit at/after the run baseline. Surfaced distinctly (not as a
   * generic dirty-tree refusal) so the user can re-verify + commit them via
   * `rauf resume --recover`. Only ever populated on a dirty tree.
   */
  interrupted: InterruptedItem[];
  /**
   * Whether commit reconciliation ran. False when the working tree was dirty,
   * in which case no items were promoted via commit (uncommitted work is not
   * silently marked done).
   */
  treeClean: boolean;
}

// ─── Interrupted-iteration detection ─────────────────────────────

/**
 * Identify interrupted iterations among the given items: `in_progress` items
 * with NO `[rauf] <id>:` commit at/after the run baseline. Only meaningful on a
 * dirty tree (a clean tree means the iteration either committed or did nothing),
 * so it short-circuits to `[]` when the tree is clean. Read-only; never throws.
 */
async function findInterruptedItems(
  items: Backlog["items"],
  projectPath: string,
  baseCommitHash: string | null,
  treeClean: boolean,
): Promise<Result<InterruptedItem[]>> {
  const interrupted: InterruptedItem[] = [];
  if (treeClean) return ok(interrupted);

  for (const item of items) {
    if (item.status !== "in_progress") continue;
    const commitResult = await findItemCommit(projectPath, item.id, baseCommitHash ?? undefined);
    if (!commitResult.ok) return commitResult;
    if (!commitResult.value) {
      interrupted.push({ id: item.id, title: item.title });
    }
  }
  return ok(interrupted);
}

/**
 * Read-only detection of interrupted iterations for the current backlog. Reads
 * the run baseline from state.json and the working-tree cleanliness, then
 * returns the `in_progress` items left uncommitted before their commit landed.
 * Mutates nothing — used by `rauf resume` to surface (and, with `--recover`,
 * re-verify) interrupted work before any reconciliation.
 */
export async function detectInterruptedItems(
  paths: BacklogPaths,
): Promise<Result<InterruptedItem[]>> {
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;

  const stateResult = readJsonFile(paths.state, LoopStateSchema);
  const baseCommitHash = stateResult.ok ? stateResult.value.baseCommitHash : null;

  const cleanResult = await isTreeClean(paths.projectPath);
  if (!cleanResult.ok) return cleanResult;

  return findInterruptedItems(
    backlogResult.value.items,
    paths.projectPath,
    baseCommitHash,
    cleanResult.value,
  );
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

  // Interrupted iterations: in_progress items with uncommitted work and no
  // matching commit at/after the baseline. Computed before the loop mutates
  // anything (on a dirty tree the loop never promotes in_progress items anyway).
  const interruptedResult = await findInterruptedItems(
    backlog.items,
    projectPath,
    baseCommitHash,
    treeClean,
  );
  if (!interruptedResult.ok) return interruptedResult;
  const interrupted = interruptedResult.value;

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

  return ok({ recovered, requeued, keptBlocked, interrupted, treeClean });
}

// ─── Re-verify + commit interrupted work (`rauf resume --recover`) ─

/** Outcome of running a project's verify command. */
export interface VerifyOutcome {
  passed: boolean;
  output: string;
}

/** Runs a project's verify command. Injectable for tests. */
export type VerifyRunner = (projectPath: string, command: string) => Promise<VerifyOutcome>;

/**
 * Default verify runner: executes the (possibly composite, `&&`-joined) verify
 * command through a shell in the project directory and reports whether it exited
 * 0. Captures combined stdout+stderr for failure reporting. Never throws.
 */
export const defaultVerifyRunner: VerifyRunner = (projectPath, command) =>
  new Promise((resolve) => {
    const child = spawn(command, { cwd: projectPath, shell: true });
    let output = "";
    child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (e) => resolve({ passed: false, output: String(e) }));
    child.on("close", (code) => resolve({ passed: code === 0, output }));
  });

/** Per-item result of a `--recover` re-verify attempt. */
export interface ItemRecoveryResult {
  id: string;
  title: string;
  /** Whether the verify command passed. */
  verifyPassed: boolean;
  /** Whether the work was committed and the item marked done (verify passed + a commit was produced). */
  committed: boolean;
  /** Commit hash when committed, else null. */
  commitHash: string | null;
  /** Combined verify output (kept for failure reporting). */
  output: string;
}

/**
 * Re-verify and commit interrupted iterations for `rauf resume --recover`.
 *
 * For each interrupted item, run the project's verify command. On green, commit
 * the work as `[rauf] <id>: <title>` (the same format the loop runner uses) and
 * mark the item done. On failure, leave the work untouched and report it so the
 * caller can surface the failure. Marking done happens AFTER the commit — mirror
 * the runner, which commits the in_progress backlog.json and persists the done
 * status separately.
 *
 * Never throws; git/IO failures surface as `Result` errors.
 */
export async function reverifyAndCommitInterrupted(
  paths: BacklogPaths,
  items: InterruptedItem[],
  verifyCommand: string,
  runVerify: VerifyRunner = defaultVerifyRunner,
): Promise<Result<ItemRecoveryResult[]>> {
  const results: ItemRecoveryResult[] = [];

  for (const item of items) {
    const outcome = await runVerify(paths.projectPath, verifyCommand);
    if (!outcome.passed) {
      results.push({
        id: item.id,
        title: item.title,
        verifyPassed: false,
        committed: false,
        commitHash: null,
        output: outcome.output,
      });
      continue;
    }

    const commitResult = await gitCommit(paths.projectPath, item.id, item.title);
    if (!commitResult.ok) return commitResult;
    const commitHash = commitResult.value.commitHash;

    if (commitHash === "") {
      // Verify passed but there was nothing to commit (e.g. an earlier item in
      // this batch already swept the dirty work). Don't mark done off an empty
      // commit; report it untouched.
      results.push({
        id: item.id,
        title: item.title,
        verifyPassed: true,
        committed: false,
        commitHash: null,
        output: outcome.output,
      });
      continue;
    }

    const backlogResult = readBacklog(paths);
    if (!backlogResult.ok) return backlogResult;
    const backlog = backlogResult.value;
    const target = backlog.items.find((i) => i.id === item.id);
    if (target) {
      target.status = "done";
      target.completedAt = new Date().toISOString();
      delete target.deferred;
      delete target.blockedReason;
      delete target.needsHuman;
    }
    const writeResult = writeBacklog(paths, backlog);
    if (!writeResult.ok) return writeResult;

    results.push({
      id: item.id,
      title: item.title,
      verifyPassed: true,
      committed: true,
      commitHash,
      output: outcome.output,
    });
  }

  return ok(results);
}

// ─── Recovery lock (acquire / release) ───────────────────────────

/** Outcome of acquiring the recovery lock. */
export interface AcquiredRecoveryLock {
  /** A stale lock (dead/recycled PID) was found and cleared while acquiring. */
  cleared: boolean;
}

/**
 * Acquire the loop lock for a recovery/resume window, closing the
 * check-then-mutate TOCTOU race: a concurrent `rauf loop run` cannot acquire the
 * lock and start between a staleness check and the backlog mutation, because we
 * hold the lock for the whole window.
 *
 * - A live lock held by another process → propagates `acquireLock`'s
 *   `LOCK_CONFLICT` error. The caller MUST refuse and perform NO mutation, and
 *   MUST NOT release — the lock belongs to the live loop.
 * - A stale lock (dead/recycled PID) → cleared and re-acquired (`cleared: true`).
 * - No lock → acquired (`cleared: false`).
 *
 * On success the caller owns the lock and MUST release it via
 * `releaseRecoveryLock` (in a `finally`, and — for resume — before relaunching).
 * Reuses core `checkLock`/`acquireLock`; does not reimplement PID checks.
 */
export function acquireRecoveryLock(paths: BacklogPaths): Result<AcquiredRecoveryLock> {
  // checkLock only to report whether a stale lock was cleared; acquireLock is
  // the authoritative gate (it atomically refuses a live lock and clears a
  // stale one), so even a lock that appears between this check and the acquire
  // is handled correctly.
  const status = checkLock(paths);
  if (!status.ok) return status;
  const cleared = status.value.locked === true && status.value.stale === true;

  const acquired = acquireLock(paths);
  if (!acquired.ok) return acquired;

  return ok({ cleared });
}

/**
 * Release a recovery lock acquired via `acquireRecoveryLock`. Owner-aware: it
 * never deletes a lock owned by a live DIFFERENT pid (defends against the lock
 * being replaced during the recovery window). A stale lock or a lock we own is
 * removed. Safe to call in a `finally` block. Reuses core `checkLock`/
 * `releaseLock`; does not reimplement PID checks.
 */
export function releaseRecoveryLock(paths: BacklogPaths): Result<void> {
  const status = checkLock(paths);
  if (!status.ok) return status;
  const lock = status.value;

  if (lock.locked && lock.stale !== true && lock.pid !== process.pid) {
    // A live lock held by a different process — not ours to remove.
    return ok(undefined);
  }

  return releaseLock(paths);
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
 * Does NOT touch the lock — acquire it via `acquireRecoveryLock` first and hold
 * it across this call.
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
