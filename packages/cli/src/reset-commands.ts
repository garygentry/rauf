// ─── Reset Command Handler ───────────────────────────────────────
//
// `rauf reset [path] [--keep-done] [--backlog <dir>] [--json]`
//
// One-command recovery from an interrupted loop (e.g. a usage-limit death):
//   1. Refuse if a live loop holds the lock; clear a stale lock.
//   2. Reconcile committed work: committed-clean non-done items → done.
//   3. Requeue runner-deferred false blocks → pending (genuine agent blocks
//      stay blocked and are reported).
//   4. Reset stalled (in_progress → pending), clear state.json, DONE, CANCEL.
//
// Done items are kept by default (this IS what `--keep-done` expresses); reset
// never sweeps or destroys completed work.

import * as path from "node:path";

import { resolveBacklogRoot, resolveBacklogPaths, ErrorCodes } from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractStringFlag, extractBoolFlag } from "./parser.js";
import { c, info, print, error, success, warn, outputJson, symbols } from "./formatter.js";
import { guardLoopLock, recoverInterruptedLoop, type RecoverySummary } from "./recovery.js";

// ─── handleReset ─────────────────────────────────────────────────

export async function handleReset(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0] ?? ".";

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  // Recognized for forward-compat / explicitness; keeping done items is the
  // default, so reset never destroys completed work regardless.
  extractBoolFlag(ctx.flags, "keep-done");

  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.INVALID_ARGS;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;

  // 1. Lock check — refuse if a live loop holds the lock; clear a stale one.
  const lockGuard = guardLoopLock(paths);
  if (!lockGuard.ok) {
    error(lockGuard.error.message);
    return ExitCode.ERROR;
  }
  if (lockGuard.value.alive) {
    const msg = `A loop is already running (PID ${lockGuard.value.pid}, started ${lockGuard.value.startedAt}). Stop it before resetting.`;
    if (ctx.globalFlags.json) {
      outputJson({ error: { code: ErrorCodes.CONFLICT, message: msg } });
    } else {
      error(msg);
      info(`Check with: ${c.cyan(`rauf status ${targetPath}`)}`);
    }
    return ExitCode.CONFLICT;
  }
  const lockCleared = lockGuard.value.cleared;

  // 2–4. Reconcile committed work, requeue false blocks, reset stalled items,
  // and clear loop state + markers (shared with `rauf resume`).
  const recoveryResult = await recoverInterruptedLoop(paths);
  if (!recoveryResult.ok) {
    error(recoveryResult.error.message);
    return ExitCode.ERROR;
  }
  const summary = recoveryResult.value;

  if (ctx.globalFlags.json) {
    outputJson({
      recovered: summary.recovered,
      requeued: summary.requeued,
      keptBlocked: summary.keptBlocked,
      stalledReset: summary.stalledReset,
      lockCleared,
      stateCleared: summary.stateCleared,
      treeClean: summary.treeClean,
    });
    return ExitCode.SUCCESS;
  }

  printSummary(summary, { stalledReset: summary.stalledReset, lockCleared });
  return ExitCode.SUCCESS;
}

// ─── Summary rendering ───────────────────────────────────────────

function printSummary(
  summary: RecoverySummary,
  extra: { stalledReset: number; lockCleared: boolean },
): void {
  if (extra.lockCleared) {
    info("Cleared a stale loop lock.");
  }
  if (!summary.treeClean) {
    warn(
      "Working tree is dirty — skipped commit reconciliation (uncommitted work was not marked done).",
    );
  }

  const parts: string[] = [];
  if (summary.recovered.length > 0) {
    parts.push(
      `recovered ${summary.recovered.length} committed item${summary.recovered.length === 1 ? "" : "s"} (${summary.recovered.join(", ")})`,
    );
  }
  if (summary.requeued.length > 0) {
    parts.push(
      `requeued ${summary.requeued.length} false block${summary.requeued.length === 1 ? "" : "s"} (${summary.requeued.join(", ")})`,
    );
  }
  if (extra.stalledReset > 0) {
    parts.push(
      `reset ${extra.stalledReset} stalled item${extra.stalledReset === 1 ? "" : "s"} to pending`,
    );
  }

  if (parts.length === 0 && summary.keptBlocked.length === 0 && !extra.lockCleared) {
    info("Nothing to reset — backlog and loop state are already clean.");
  } else if (parts.length > 0) {
    success(`Reset complete: ${parts.join(", ")}.`);
  } else {
    success("Reset complete: cleared loop state.");
  }

  if (summary.keptBlocked.length > 0) {
    print(
      c.bold(
        `\nKept ${summary.keptBlocked.length} genuine block${summary.keptBlocked.length === 1 ? "" : "s"} (not requeued):`,
      ),
    );
    for (const b of summary.keptBlocked) {
      print(`  ${symbols.bullet} ${c.red(b.id)}: ${b.reason}`);
    }
    info("Resolve these manually, then `rauf backlog unblock <path> <id>` to requeue.");
  }
}
