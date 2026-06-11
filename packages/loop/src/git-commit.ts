import { execFile } from "node:child_process";

import type { Result } from "@rauf/core";
import { ok, err, ErrorCodes } from "@rauf/core";

export interface GitCommitSuccess {
  commitHash: string;
}

/**
 * Runtime files the loop writes into a backlog dir's `.rauf/`. They must never
 * land in a per-item commit, even in a project whose `.gitignore` was not set
 * up. Excluded from `git add` via `:(exclude,glob)` pathspecs (the `**` covers
 * nested backlog dirs like specs/<feature>/.rauf/ as well as the root .rauf/).
 * backlog.json / progress.md / RAUF.md / archive/ are intentionally NOT listed,
 * so they stage and commit normally.
 */
const RUNTIME_EXCLUDE_PATHSPECS = [
  ":(exclude,glob)**/.rauf/.loop.lock",
  ":(exclude,glob)**/.rauf/state.json",
  ":(exclude,glob)**/.rauf/DONE",
  ":(exclude,glob)**/.rauf/CANCEL",
  ":(exclude,glob)**/.rauf/iteration-status.json",
  ":(exclude,glob)**/.rauf/rauf.log",
  // backlog.json.bak sits beside backlog.json (root .rauf/ or specs/<feature>/).
  ":(exclude,glob)**/backlog.json.bak",
];

/**
 * Runs `git add -A && git commit` in the given project directory.
 * Uses commit message format: `[rauf] <itemId>: <title>`
 *
 * Returns ok with commit hash on success, err on failure.
 * Handles "nothing to commit" gracefully (returns ok with empty hash).
 */
export async function gitCommit(
  projectPath: string,
  itemId: string,
  title: string,
): Promise<Result<GitCommitSuccess>> {
  const message = `[rauf] ${itemId}: ${title}`;

  try {
    await execGit(projectPath, ["add", "-A", "--", ".", ...RUNTIME_EXCLUDE_PATHSPECS]);
  } catch (e) {
    return err({
      code: ErrorCodes.CONFLICT,
      message: `git add failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  try {
    const stdout = await execGit(projectPath, ["commit", "-m", message]);
    const hash = extractCommitHash(stdout);
    return ok({ commitHash: hash });
  } catch (e) {
    if (isNothingToCommit(e)) {
      return ok({ commitHash: "" });
    }
    return err({
      code: ErrorCodes.CONFLICT,
      message: `git commit failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr.trim() || stdout.trim() || error.message;
        const gitError = new Error(msg);
        (gitError as Error & { stdout: string; stderr: string }).stdout = stdout;
        (gitError as Error & { stdout: string; stderr: string }).stderr = stderr;
        reject(gitError);
      } else {
        resolve(stdout);
      }
    });
  });
}

function extractCommitHash(stdout: string): string {
  // git commit output: "[branch hash] message" or "[branch (root-commit) hash] message"
  const match = /\[[\w/.-]+\s+(?:\(root-commit\)\s+)?([0-9a-f]+)\]/.exec(stdout);
  return match?.[1] ?? "";
}

function isNothingToCommit(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  const errWithStderr = e as Error & { stdout?: string; stderr?: string };
  const stdout = (errWithStderr.stdout ?? "").toLowerCase();
  return msg.includes("nothing to commit") || stdout.includes("nothing to commit");
}
