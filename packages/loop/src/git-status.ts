import { execFile } from "node:child_process";

import type { Result } from "@rauf/core";
import { ok, err, ErrorCodes } from "@rauf/core";

const PROTECTED_BRANCHES = new Set(["main", "master"]);

/**
 * Verifies it is safe to start an autonomous loop in the given project.
 *
 * The loop auto-commits with `git add -A` on the current branch
 * (see git-commit.ts), so running on a default branch or a dirty tree
 * risks sweeping unrelated work into a loop commit. This guard refuses:
 *   - the default branch (`main` / `master`),
 *   - a detached HEAD (`rev-parse --abbrev-ref HEAD` returns "HEAD"),
 *   - a dirty working tree (`git status --porcelain` is non-empty).
 *
 * Returns ok when on a feature branch with a clean tree, and also when the
 * directory is not a git repository (nothing for the loop to sweep into).
 *
 * `opts.allowDirty` skips the dirty-tree check while keeping the branch and
 * detached-HEAD guards. `rauf resume` uses this: recovering an interrupted loop
 * necessarily rewrites bookkeeping (`.rauf/backlog.json`), so the tree is dirty
 * by construction — but we still must not auto-commit onto a protected branch.
 */
export async function checkLoopPreconditions(
  projectPath: string,
  opts: { allowDirty?: boolean } = {},
): Promise<Result<void>> {
  let branch: string;
  try {
    branch = (await execGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    // Not a git repository (or no commits yet) — nothing to guard against.
    return ok(undefined);
  }

  if (branch === "HEAD") {
    return err({
      code: ErrorCodes.CONFLICT,
      message:
        "Refusing to run the loop on a detached HEAD. " +
        "Check out a feature branch first, or pass --force to override.",
    });
  }

  if (PROTECTED_BRANCHES.has(branch)) {
    return err({
      code: ErrorCodes.CONFLICT,
      message:
        `Refusing to run the loop on the default branch "${branch}". ` +
        "The loop auto-commits with `git add -A`; switch to a feature branch, " +
        "or pass --force to override.",
    });
  }

  if (opts.allowDirty) {
    return ok(undefined);
  }

  let status: string;
  try {
    status = await execGit(projectPath, ["status", "--porcelain"]);
  } catch (e) {
    return err({
      code: ErrorCodes.CONFLICT,
      message: `git status failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (status.trim() !== "") {
    return err({
      code: ErrorCodes.CONFLICT,
      message:
        "Refusing to run the loop with uncommitted changes in the working tree. " +
        "Commit or stash them first, or pass --force to override.",
    });
  }

  return ok(undefined);
}

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr.trim() || stdout.trim() || error.message;
        reject(new Error(msg));
      } else {
        resolve(stdout);
      }
    });
  });
}
