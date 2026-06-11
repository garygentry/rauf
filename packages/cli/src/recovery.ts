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

import { readBacklog, writeBacklog, ok, type BacklogPaths, type Result } from "@rauf/core";
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
 */
export async function reconcileAndRequeue(paths: BacklogPaths): Promise<Result<ReconcileSummary>> {
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;
  const backlog = backlogResult.value;
  const projectPath = paths.projectPath;

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
    if (treeClean) {
      const commitResult = await findItemCommit(projectPath, item.id);
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
