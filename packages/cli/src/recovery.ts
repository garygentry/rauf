// ─── Loop Recovery — CLI `--recover` path ────────────────────────
//
// The shared reconcile/resume core now lives in `@rauf/loop`
// (packages/loop/src/recovery.ts) so the web server can reuse it without
// importing `@rauf/cli`. This file keeps only the CLI-only `--recover`
// sub-path (re-verify the project's verify command in a subprocess, then
// commit) and re-exports the moved shared core so existing `./recovery`
// consumers keep compiling.

import { spawn } from "node:child_process";

import { readBacklog, writeBacklog, ok, type BacklogPaths, type Result } from "@rauf/core";
import { gitCommit, type InterruptedItem } from "@rauf/loop";

// ─── Re-export the relocated shared core ─────────────────────────
// Keeps any `./recovery` consumer (resume-commands.ts / reset-commands.ts)
// resolving these symbols unchanged after the move to `@rauf/loop`.

export {
  detectInterruptedItems,
  reconcileAndRequeue,
  acquireRecoveryLock,
  releaseRecoveryLock,
  recoverInterruptedLoop,
} from "@rauf/loop";
export type {
  KeptBlock,
  InterruptedItem,
  ReconcileSummary,
  RecoverySummary,
  AcquiredRecoveryLock,
} from "@rauf/loop";

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
