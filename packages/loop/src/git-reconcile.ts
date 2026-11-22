import type { Result } from "@rauf/core";
import { ok, err, ErrorCodes } from "@rauf/core";

import { execGit } from "./git-exec.js";

/**
 * Escapes POSIX extended-regex (ERE) metacharacters so an item id can be
 * embedded literally in a `git log --extended-regexp --grep` pattern. Backlog
 * ids are usually numeric, but the schema allows any non-empty string, so an id
 * containing ERE metacharacters (e.g. `1.0`) must not overmatch or error.
 */
function escapeEre(value: string): string {
  return value.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&");
}

/**
 * The `git log --grep` ERE for an item's commit subject. With a title, the
 * whole line must be the subject gitCommit writes. `-m` puts any second title
 * line in the body, so only the first line can appear there; trailing
 * whitespace is optional so both git's default cleanup (which strips it) and
 * `commit.cleanup=verbatim` (which keeps it) match.
 */
function itemCommitPattern(itemId: string, title?: string): string {
  const prefix = `^\\[rauf\\] ${escapeEre(itemId)}:`;
  if (title === undefined) return prefix;
  const subjectTitle = (title.split("\n")[0] ?? "").trimEnd();
  const body = subjectTitle === "" ? "" : ` ${escapeEre(subjectTitle)}`;
  return `${prefix}${body}[[:space:]]*$`;
}

/**
 * Finds the most recent commit whose message is a rauf per-item commit for the
 * given item id (`[rauf] <id>: <title>`).
 *
 * The grep is anchored with `^\[rauf\] ` and the trailing colon so that id
 * `003` does not match `030` or `0030`, and so a stray mention of `[rauf]`
 * mid-message does not count. The id itself is ERE-escaped so metacharacters in
 * it are matched literally.
 *
 * `title` tightens an UNBOUNDED search (no `sinceRef`) to the exact subject
 * gitCommit writes, `[rauf] <id>: <title>`. Item ids restart at 001 in every
 * backlog, so in a repo with several backlogs (a forge layout:
 * specs/<feature>/) the whole history holds other backlogs' `[rauf] 001:`
 * commits, which used to recover THIS backlog's items (#165). A false negative
 * (e.g. the title was edited after the commit) leaves the item pending to
 * re-run, the safe direction. Two backlogs sharing an id AND a title can still
 * collide there; a run baseline is what fully scopes the search.
 *
 * With `sinceRef` the `[rauf] <id>:` prefix is enough and `title` is ignored:
 * the range is this run's own commits, and the prefix is what lets the runner
 * recover work an agent (or a subject-rewriting hook) committed under its own
 * subject before dying without a signal.
 *
 * When `sinceRef` is provided, the search is scoped to the `<sinceRef>..HEAD`
 * commit range so only commits made AFTER that baseline can match. This bounds
 * reconciliation to the current run and prevents a stale `[rauf] <id>:` commit
 * from a prior backlog cycle (rauf restarts ids at 001) from matching.
 *
 * Returns ok with `{ commitHash }` for the newest match, ok with `null` when no
 * commit matches, and err on git failure. Never throws.
 */
export async function findItemCommit(
  projectPath: string,
  itemId: string,
  sinceRef?: string,
  title?: string,
): Promise<Result<{ commitHash: string } | null>> {
  try {
    const args = [
      "log",
      "--extended-regexp",
      `--grep=${itemCommitPattern(itemId, sinceRef ? undefined : title)}`,
      "--format=%H",
      "-n",
      "1",
    ];
    if (sinceRef) {
      args.push(`${sinceRef}..HEAD`);
    }
    const stdout = await execGit(projectPath, args);
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
