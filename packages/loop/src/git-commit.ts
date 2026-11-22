import * as path from "node:path";

import type { Result } from "@rauf/core";
import { ok, err, ErrorCodes } from "@rauf/core";

import { execGit } from "./git-exec.js";

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
export const RUNTIME_EXCLUDE_PATHSPECS = [
  ":(exclude,glob)**/.rauf/.loop.lock",
  ":(exclude,glob)**/.rauf/state.json",
  ":(exclude,glob)**/.rauf/DONE",
  ":(exclude,glob)**/.rauf/CANCEL",
  ":(exclude,glob)**/.rauf/iteration-status.json",
  ":(exclude,glob)**/.rauf/rauf.log",
  ":(exclude,glob)**/.rauf/events.ndjson",
  ":(exclude,glob)**/.rauf/supervisors/**",
  ":(exclude,glob)**/.rauf/.forge-supervisor.json",
  // backlog.json.bak sits beside backlog.json (root .rauf/ or specs/<feature>/).
  ":(exclude,glob)**/backlog.json.bak",
];

/**
 * Build an exclude pathspec that matches exactly `relPath` (a file) or
 * everything under it (a directory), WITHOUT a literal leading directory.
 *
 * Why not `:(exclude)<relPath>`: when the path sits under a gitignored
 * directory (e.g. a backlog at `specs/<feature>/` with `specs/` ignored),
 * `git stash push --include-untracked` saves the stash, then exits non-zero
 * ("The following paths are ignored by one of your .gitignore files") and
 * leaves the tree staged — which halted the whole loop (#172, sibling of
 * #137). git only raises that for a pathspec with a literal leading-directory
 * prefix; `:(exclude,glob)specs/...` fails the same way. Backslash-escaping
 * the first character (`\specs/...`) gives the pathspec no literal prefix while
 * still matching only this exact path: wildmatch's `\` matches the next BYTE
 * literally, so it is safe for a multi-byte first character too (a one-char
 * class like `[Ü]` would not be, nor `[!]`, which reads as a negated class).
 * The repo-wide globs in RUNTIME_EXCLUDE_PATHSPECS avoid the error the same way
 * (leading `**`).
 *
 * A `git check-ignore` filter is NOT a substitute: a TRACKED backlog.json
 * inside an ignored dir reports "not ignored" yet still trips the error, and
 * dropping its exclude would stash the live backlog.
 */
export function exactExcludePathspec(relPath: string, opts: { dir: boolean }): string {
  const posix = relPath.split(path.sep).join("/");
  const escaped = posix.replace(/[*?[\]\\]/g, (c) => `\\${c}`);
  // A path that already starts with an escaped metacharacter is anchored.
  const anchored = escaped.startsWith("\\") ? escaped : `\\${escaped}`;
  return `:(exclude,glob)${anchored}${opts.dir ? "/**" : ""}`;
}

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

/** A commit's full sha and how many files it touched. */
export interface CommitDescription {
  sha: string;
  filesChanged: number;
}

/**
 * Resolve `ref` (a full or abbreviated sha) to its full sha and file count, for
 * the item_completed supervision card (#153). One `git show --name-only` call.
 * Best-effort: returns null on any git failure — the card just omits the fields.
 */
export async function describeCommit(
  projectPath: string,
  ref: string,
): Promise<CommitDescription | null> {
  try {
    const stdout = await execGit(projectPath, ["show", "--name-only", "--format=%H", ref, "--"]);
    const [sha, ...files] = stdout.split("\n").filter((l) => l.trim() !== "");
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha.trim())) return null;
    return { sha: sha.trim(), filesChanged: files.length };
  } catch {
    return null;
  }
}
