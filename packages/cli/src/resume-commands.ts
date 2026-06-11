// ─── Resume Command Handler ──────────────────────────────────────
//
// `rauf resume [path] [--backlog <dir>] [--iterations N] [...loop flags]`
//
// Continue an interrupted loop in one step:
//   1. Refuse if a live loop holds the lock; clear a stale lock.
//   2. Detect a resumable state (paused_usage_limit / limit_reached / error /
//      a dead lock with non-done work).
//   3. Reconcile committed work + requeue runner-deferred false blocks + reset
//      stalled items + clear state/markers (shared with `rauf reset`).
//   4. Relaunch the loop via the normal `rauf loop run` entrypoint so it picks
//      up the first eligible item with a recomputed budget — honoring --backlog.
//
// Resume passes `--allow-dirty` to the launch: recovery rewrites `.rauf/
// backlog.json`, so the tree is dirty by construction. Branch protection stays
// on (only the dirty-tree guard is relaxed).

import * as path from "node:path";

import {
  resolveBacklogRoot,
  resolveBacklogPaths,
  readBacklog,
  readJsonFile,
  readMarkerFile,
  detectProfile,
  deriveStatus,
  selectNextItem,
  LoopStateSchema,
  ErrorCodes,
  type BacklogPaths,
  type LoopState,
  type LoopStateEnum,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractStringFlag, extractBoolFlag } from "./parser.js";
import { c, info, error, success, warn, outputJson } from "./formatter.js";
import {
  acquireRecoveryLock,
  releaseRecoveryLock,
  recoverInterruptedLoop,
  detectInterruptedItems,
  reverifyAndCommitInterrupted,
  type InterruptedItem,
  type VerifyRunner,
} from "./recovery.js";
import { handleLoopRun } from "./loop-commands.js";

// ─── Verify-command resolution ───────────────────────────────────

/**
 * Resolve the project's verify command for `--recover`, preferring the
 * installed `.rauf.json` profile and falling back to a fresh `detectProfile`
 * scan. Returns null when no verify command can be determined.
 */
function resolveVerifyCommand(projectPath: string): string | null {
  const marker = readMarkerFile(projectPath);
  if (marker.ok && marker.value.profile.verify.trim() !== "") {
    return marker.value.profile.verify;
  }
  const detected = detectProfile(projectPath);
  return detected.verify.trim() !== "" ? detected.verify : null;
}

/** Surface interrupted iterations without mutating (default `rauf resume`). */
function reportInterruptedSurface(items: InterruptedItem[], ctx: CommandContext): void {
  if (ctx.globalFlags.json) {
    outputJson({ resumed: false, reason: "interrupted_uncommitted", interrupted: items });
    return;
  }
  for (const it of items) {
    warn(`item ${it.id} left uncommitted changes (interrupted before commit)`);
  }
  info(`Re-verify and commit this work with ${c.cyan("rauf resume --recover")}.`);
}

/**
 * `--recover`: re-verify and commit interrupted work. Returns `true` when
 * recovery HALTED (no verify command, a re-verify error, or a failed verify) —
 * the caller must then stop without reconciling or relaunching, leaving the work
 * untouched. Returns `false` when all interrupted items were recovered (or there
 * was nothing to commit) and the normal recovery + relaunch should proceed.
 */
async function runRecoverInterrupted(
  projectPath: string,
  paths: BacklogPaths,
  items: InterruptedItem[],
  runVerify: VerifyRunner | undefined,
): Promise<boolean> {
  const verifyCommand = resolveVerifyCommand(projectPath);
  if (verifyCommand === null) {
    error(
      "No verify command is configured for this project (.rauf.json / profile) — cannot auto-recover interrupted work.",
    );
    return true;
  }

  info(`Re-verifying interrupted work with ${c.dim(verifyCommand)} …`);
  const recoverResult = await reverifyAndCommitInterrupted(paths, items, verifyCommand, runVerify);
  if (!recoverResult.ok) {
    error(recoverResult.error.message);
    return true;
  }

  let verifyFailed = false;
  for (const r of recoverResult.value) {
    if (r.committed) {
      success(`Recovered item ${r.id}: re-verified, committed ${c.dim(r.commitHash ?? "")}, done.`);
    } else if (!r.verifyPassed) {
      error(`Re-verify failed for item ${r.id} — work left untouched.`);
      verifyFailed = true;
    } else {
      warn(`item ${r.id}: verify passed but there was nothing to commit — left untouched.`);
    }
  }
  return verifyFailed;
}

// ─── Resumable-state detection ───────────────────────────────────

/**
 * Raw state.json statuses that mark an interrupted-but-resumable loop. A clean
 * usage-limit pause, a hit usage limit, and a circuit-breaker error all stop
 * the loop with work still outstanding; `paused`/`sleeping_limit`/`weekly_limit`
 * are the crash/sleep variants.
 */
const RESUMABLE_RAW_STATUSES = new Set<LoopState["status"]>([
  "paused_usage_limit",
  "limit_reached",
  "error",
  "paused",
  "sleeping_limit",
  "weekly_limit",
]);

/** Derived states that indicate a stopped loop with work potentially left. */
const RESUMABLE_DERIVED_STATES = new Set<LoopStateEnum>([
  "PAUSED",
  "LIMIT_REACHED",
  "ERROR",
  "WEEKLY_LIMIT",
  "SLEEPING_LIMIT",
]);

interface ResumeDetection {
  /** Whether an interrupted-loop marker (state / dead lock) was found. */
  resumable: boolean;
  /** Short label of what was detected, for the user-facing message. */
  label: string;
  /** Count of non-done backlog items. */
  nonDone: number;
}

function detectResumeState(paths: BacklogPaths, deadLockCleared: boolean): ResumeDetection {
  let nonDone = 0;
  const backlogResult = readBacklog(paths);
  if (backlogResult.ok) {
    nonDone = backlogResult.value.items.filter((i) => i.status !== "done").length;
  }

  // Prefer the precise raw status from state.json (deriveStatus collapses
  // paused_usage_limit → PAUSED, which would lose the distinction).
  const rawResult = readJsonFile(paths.state, LoopStateSchema);
  const rawStatus = rawResult.ok ? rawResult.value.status : null;

  const derived = deriveStatus(paths);
  const loopState = derived.ok ? derived.value.loopState : null;

  const rawResumable = rawStatus !== null && RESUMABLE_RAW_STATUSES.has(rawStatus);
  const derivedResumable = loopState !== null && RESUMABLE_DERIVED_STATES.has(loopState);
  const deadLockResumable = deadLockCleared && nonDone > 0;

  const resumable = rawResumable || derivedResumable || deadLockResumable;

  let label: string;
  if (rawResumable && rawStatus) {
    label = rawStatus;
  } else if (derivedResumable && loopState) {
    label = loopState;
  } else if (deadLockResumable) {
    label = "dead lock";
  } else {
    label = loopState ?? rawStatus ?? "unknown";
  }

  return { resumable, label, nonDone };
}

// ─── handleResume ────────────────────────────────────────────────

export interface ResumeDeps {
  /** Loop launcher — injectable for tests. Defaults to `handleLoopRun`. */
  runLoop?: (ctx: CommandContext) => Promise<number>;
  /** Verify runner for `--recover` — injectable for tests. Defaults to the real shell runner. */
  runVerify?: VerifyRunner;
}

export async function handleResume(ctx: CommandContext, deps: ResumeDeps = {}): Promise<number> {
  const runLoop = deps.runLoop ?? handleLoopRun;
  const targetPath = ctx.args[0] ?? ".";
  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const recoverFlag = extractBoolFlag(ctx.flags, "recover");

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

  // 1. Acquire the loop lock for the recovery window — refuse with LOCK_CONFLICT
  // if a live loop holds it (closes the check-then-mutate TOCTOU race), clear a
  // stale one. We hold the lock across detect + recover + decide, then release it
  // BEFORE relaunching so the loop's own lock acquisition succeeds.
  const acquired = acquireRecoveryLock(paths);
  if (!acquired.ok) {
    if (acquired.error.code === ErrorCodes.LOCK_CONFLICT) {
      const msg = `${acquired.error.message}. Nothing to resume.`;
      if (ctx.globalFlags.json) {
        outputJson({ error: { code: ErrorCodes.LOCK_CONFLICT, message: msg } });
      } else {
        error(msg);
        info(`Check with: ${c.cyan(`rauf status ${targetPath}`)}`);
      }
      return ExitCode.CONFLICT;
    }
    error(acquired.error.message);
    return ExitCode.ERROR;
  }
  if (acquired.value.cleared) {
    info("Cleared a stale loop lock.");
  }

  // Hold the lock across state detection, recovery, and the eligibility decision.
  // `relaunch` is set only when we should hand off to the loop after releasing;
  // `exitCode` holds the result for every early-return path. Release happens in
  // the finally so the lock is freed before any relaunch and on any throw.
  let relaunch = false;
  let exitCode: number = ExitCode.SUCCESS;
  try {
    // 2. Detect a resumable state.
    const detection = detectResumeState(paths, acquired.value.cleared);

    if (detection.nonDone === 0) {
      if (ctx.globalFlags.json) {
        outputJson({ resumed: false, reason: "all_items_done", detectedState: detection.label });
      } else {
        success("Nothing to resume — all backlog items are done.");
      }
    } else {
      // 2b. Detect interrupted iterations (verified-but-uncommitted work killed
      // before its commit) BEFORE any mutation. Without --recover we only
      // surface them and stop; with --recover we re-verify and commit them.
      const interruptedResult = await detectInterruptedItems(paths);
      if (!interruptedResult.ok) {
        error(interruptedResult.error.message);
        exitCode = ExitCode.ERROR;
      } else if (interruptedResult.value.length > 0 && !recoverFlag) {
        // Surface only — never mutate. Point to `rauf resume --recover`.
        reportInterruptedSurface(interruptedResult.value, ctx);
      } else {
        if (detection.resumable) {
          info(`Detected interrupted loop (${c.cyan(detection.label)}) — recovering and resuming.`);
        } else {
          // No interruption marker, but non-done work remains (e.g. the loop
          // exhausted its budget with pending items left). Resuming is still valid.
          warn(
            `No interrupted-loop marker found (state: ${detection.label}), but ${detection.nonDone} non-done item(s) remain — continuing.`,
          );
        }

        // 2c. With --recover, re-verify + commit interrupted work first. A failed
        // re-verify leaves the work untouched and stops (no reconciliation, no
        // relaunch) so the user can inspect it.
        let recoverHalted = false;
        if (interruptedResult.value.length > 0) {
          recoverHalted = await runRecoverInterrupted(
            resolved,
            paths,
            interruptedResult.value,
            deps.runVerify,
          );
          if (recoverHalted) exitCode = ExitCode.ERROR;
        }

        if (!recoverHalted) {
          // 3. Reconcile committed work, requeue false blocks, reset stalled items,
          // and clear loop state + markers.
          const recoveryResult = await recoverInterruptedLoop(paths);
          if (!recoveryResult.ok) {
            error(recoveryResult.error.message);
            exitCode = ExitCode.ERROR;
          } else {
            const summary = recoveryResult.value;

            if (summary.interrupted.length > 0) {
              for (const it of summary.interrupted) {
                warn(`item ${it.id} left uncommitted changes (interrupted before commit)`);
              }
            } else if (!summary.treeClean) {
              warn(
                "Working tree is dirty — skipped commit reconciliation (uncommitted work was not marked done).",
              );
            }
            const recoveryParts: string[] = [];
            if (summary.recovered.length > 0)
              recoveryParts.push(`recovered ${summary.recovered.join(", ")}`);
            if (summary.requeued.length > 0)
              recoveryParts.push(`requeued ${summary.requeued.join(", ")}`);
            if (summary.stalledReset > 0)
              recoveryParts.push(`reset ${summary.stalledReset} stalled`);
            if (recoveryParts.length > 0) info(c.dim(`Recovery: ${recoveryParts.join("; ")}.`));

            // 4. Bail before launching if no eligible item remains (only genuine
            // blocks / needs-human left) — the loop would spawn and immediately
            // complete otherwise.
            const postBacklog = readBacklog(paths);
            if (postBacklog.ok && selectNextItem(postBacklog.value) === null) {
              if (ctx.globalFlags.json) {
                outputJson({
                  resumed: false,
                  reason: "no_eligible_items",
                  recovered: summary.recovered,
                  requeued: summary.requeued,
                  keptBlocked: summary.keptBlocked,
                });
              } else {
                success("Recovery complete, but no eligible pending items remain to run.");
                if (summary.keptBlocked.length > 0) {
                  info(
                    `${summary.keptBlocked.length} genuine block(s) need attention — resolve them, then ${c.cyan("rauf backlog unblock")}.`,
                  );
                }
              }
            } else {
              relaunch = true;
            }
          }
        }
      }
    }
  } finally {
    // Release the recovery lock before relaunching: the loop's own entrypoint
    // acquires its lock, which would conflict with one we still held.
    releaseRecoveryLock(paths);
  }

  if (!relaunch) return exitCode;

  // 5. Relaunch via the normal loop entrypoint. Forward the user's flags and add
  // --allow-dirty so the bookkeeping-dirty tree doesn't trip the precondition
  // guard (branch protection stays on). The recomputed budget (item 010) and
  // --backlog handling come for free from handleLoopRun.
  const runCtx: CommandContext = {
    args: ctx.args,
    flags: new Map(ctx.flags),
    globalFlags: ctx.globalFlags,
    rawArgv: ctx.rawArgv,
  };
  if (backlogFlag !== null) runCtx.flags.set("backlog", backlogFlag);
  runCtx.flags.set("allow-dirty", true);

  return runLoop(runCtx);
}
