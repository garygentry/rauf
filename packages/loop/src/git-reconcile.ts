import type { Result } from "@rauf/core";
import { ok, err, ErrorCodes } from "@rauf/core";

import { execGit } from "./git-exec.js";

/**
 * Finds the most recent commit whose message is a rauf per-item commit for the
 * given item id (`[rauf] <id>: <title>`).
 *
 * The grep is anchored with `^\[rauf\] ` and the trailing colon so that id
 * `003` does not match `030` or `0030`, and so a stray mention of `[rauf]`
 * mid-message does not count.
 *
 * Returns ok with `{ commitHash }` for the newest match, ok with `null` when no
 * commit matches, and err on git failure. Never throws.
 */
export async function findItemCommit(
  projectPath: string,
  itemId: string,
): Promise<Result<{ commitHash: string } | null>> {
  try {
    const stdout = await execGit(projectPath, [
      "log",
      "--extended-regexp",
      `--grep=^\\[rauf\\] ${itemId}:`,
      "--format=%H",
      "-n",
      "1",
    ]);
    const commitHash = stdout.trim().split("\n")[0]?.trim() ?? "";
    return ok(commitHash ? { commitHash } : null);
  } catch (e) {
    return err({
      code: ErrorCodes.CONFLICT,
      message: `git log failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/**
 * Reports whether the working tree is clean (no staged, unstaged, or untracked
 * changes) via `git status --porcelain`.
 *
 * Returns ok(true) when the porcelain output is empty, ok(false) otherwise, and
 * err on git failure. Never throws.
 */
export async function isTreeClean(projectPath: string): Promise<Result<boolean>> {
  try {
    const stdout = await execGit(projectPath, ["status", "--porcelain"]);
    return ok(stdout.trim() === "");
  } catch (e) {
    return err({
      code: ErrorCodes.CONFLICT,
      message: `git status failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
