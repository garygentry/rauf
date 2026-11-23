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

/** A commit's full sha, how many files it touched, and which look like build output. */
export interface CommitDescription {
  sha: string;
  /** Every path the commit touches, deletions included (the card's file count). */
  filesChanged: number;
  /** Paths the commit adds or modifies, i.e. not deletions (#192). */
  filesWritten: number;
  /**
   * Added or modified paths matching {@link isBuildOutputPath} (#192), in commit
   * order. Deletions are excluded: `git rm -r --cached obj/` is the fix, not the fault.
   */
  buildOutputPaths: string[];
}

/**
 * Default `options.commitWarnFileThreshold` (#192): a per-item commit touching
 * more files than this is flagged `large_commit`. A scaffold item with a
 * lockfile stays well under it; a committed build tree does not.
 */
export const DEFAULT_COMMIT_WARN_FILE_THRESHOLD = 300;

/** Directory segments that only ever hold generated build output or installed deps. */
const BUILD_OUTPUT_DIRS = new Set([
  "obj",
  "node_modules",
  "dist",
  "target",
  "__pycache__",
  ".next",
  ".turbo",
  ".pytest_cache",
  ".mypy_cache",
]);

/** File extensions that are compiled artifacts, never source. */
const BUILD_OUTPUT_EXTENSIONS = /\.(dll|pdb|exe|pyc|pyo|class|o|so|dylib|tsbuildinfo)$/i;

/**
 * Whether a repo-relative path looks like build output (#192): a path under a
 * well-known output/deps directory, a .NET `bin/…/Debug|Release/` tree
 * (`bin/Debug/`, `bin/x64/Release/`; a bare `bin/` is often hand-written
 * scripts, so it alone is not flagged), or a compiled-artifact extension. A
 * heuristic for an advisory warning, not a filter.
 */
export function isBuildOutputPath(relPath: string): boolean {
  const segments = relPath.split("/");
  const dirs = segments.slice(0, -1);
  if (dirs.some((d) => BUILD_OUTPUT_DIRS.has(d))) return true;
  const bin = dirs.indexOf("bin");
  if (bin !== -1 && dirs.slice(bin + 1).some((d) => /^(debug|release)$/i.test(d))) return true;
  return BUILD_OUTPUT_EXTENSIONS.test(segments[segments.length - 1] ?? "");
}

/**
 * Resolve `ref` (a full or abbreviated sha) to its full sha, file count and
 * build-output paths, for the item_completed card (#153) and commit_warning
 * (#192). One `git show --name-only` call.
 * Best-effort: returns null on any git failure — the card just omits the fields.
 */
export async function describeCommit(
  projectPath: string,
  ref: string,
): Promise<CommitDescription | null> {
  try {
    // core.quotePath=false: git would otherwise C-quote a non-ASCII path
    // ("obj/caf\303\251.json"), hiding its segments from isBuildOutputPath.
    const stdout = await execGit(projectPath, [
      "-c",
      "core.quotePath=false",
      "show",
      "--name-status",
      "--format=%H",
      ref,
      "--",
    ]);
    const [sha, ...rows] = stdout.split("\n").filter((l) => l.trim() !== "");
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha.trim())) return null;
    // Each row is `<status>\t<path>` (or `R100\t<old>\t<new>` for a rename/copy).
    const written: string[] = [];
    for (const row of rows) {
      const fields = row.split("\t");
      const status = fields[0] ?? "";
      const file = fields[fields.length - 1] ?? "";
      if (!status.startsWith("D")) written.push(file);
    }
    return {
      sha: sha.trim(),
      filesChanged: rows.length,
      filesWritten: written.length,
      buildOutputPaths: written.filter(isBuildOutputPath),
    };
  } catch {
    return null;
  }
}

/**
 * Stash every uncommitted change except the loop's own bookkeeping (anything
 * under a `.rauf/` dir, this backlog and its `.bak`), as a recoverable stash
 * named `message`. Used to revert an abandoned iteration (item 009, #83) and by
 * `rauf resume --discard-interrupted` for an interrupted item's edits (#191).
 *
 * Positive `.` plus exclude pathspecs: the shared RUNTIME_EXCLUDE_PATHSPECS
 * (which also keep OTHER backlog roots' `.rauf/` dirs out, item 019) plus this
 * backlog's state dir and file. Those two are anchored-glob excludes, NOT
 * literal `:(exclude)<path>`: under a gitignored dir (a backlog at
 * `specs/<feature>/` with `specs/` ignored), a literal exclude makes
 * `git stash push --include-untracked` save the stash, exit non-zero and leave
 * the tree staged (#172). Likewise never add a literal `backlog.json.bak`
 * exclude: the shared glob covers it, and a literal one naming an existing
 * ignored file fails the same way (#137).
 *
 * Returns `ok({ stashed: false })` when only bookkeeping is dirty, and `err`
 * when git status/stash fails.
 */
/** The pathspecs selecting every path except loop bookkeeping (see stashNonLoopWork). */
function nonLoopPathspecs(projectPath: string, paths: { stateDir: string; backlog: string }) {
  return [
    ".",
    ...RUNTIME_EXCLUDE_PATHSPECS,
    exactExcludePathspec(path.relative(projectPath, paths.stateDir), { dir: true }),
    exactExcludePathspec(path.relative(projectPath, paths.backlog), { dir: false }),
  ];
}

/**
 * Whether anything outside loop bookkeeping is uncommitted (#191). Best-effort:
 * a git failure reads as "not dirty".
 */
export async function hasNonLoopWork(
  projectPath: string,
  paths: { stateDir: string; backlog: string },
): Promise<boolean> {
  try {
    const status = await execGit(projectPath, [
      "status",
      "--porcelain",
      "--",
      ...nonLoopPathspecs(projectPath, paths),
    ]);
    return status.trim() !== "";
  } catch {
    return false;
  }
}

export async function stashNonLoopWork(
  projectPath: string,
  paths: { stateDir: string; backlog: string },
  message: string,
): Promise<Result<{ stashed: boolean }>> {
  const pathspecs = nonLoopPathspecs(projectPath, paths);
  try {
    const status = await execGit(projectPath, ["status", "--porcelain", "--", ...pathspecs]);
    if (status.trim() === "") return ok({ stashed: false });
    await execGit(projectPath, [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      message,
      "--",
      ...pathspecs,
    ]);
    return ok({ stashed: true });
  } catch (e) {
    return err({ code: ErrorCodes.CONFLICT, message: e instanceof Error ? e.message : String(e) });
  }
}
