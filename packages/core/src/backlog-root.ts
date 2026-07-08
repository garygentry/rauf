import * as fs from "node:fs";
import * as path from "node:path";

import { fileExists, validatePath, ensureDir } from "./fs-utils.js";
import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { listActiveLoops } from "./loop-registry.js";
import type { ActiveLoopEntry } from "./schemas.js";

// ─── Constants ────────────────────────────────────────────────────

/** Lock file name within the state directory */
export const LOCK_FILENAME = ".loop.lock";

/** Directories to skip during active root scanning */
export const SCAN_SKIP_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "artifacts",
] as const;

/** State file name (unified constant) */
export const STATE_FILENAME = "state.json";

/** Backlog file name */
export const BACKLOG_FILENAME = "backlog.json";

/** Default backlog root directory name */
export const DEFAULT_ROOT_DIR = ".rauf";

// ─── Types ────────────────────────────────────────────────────────

/**
 * All resolved absolute paths for a backlog root.
 *
 * Created by `resolveBacklogPaths()` and threaded through every core,
 * loop, CLI, and web function that touches backlog or state files.
 * Pure data — no methods, no filesystem access at construction time
 * (except for backlog.json location probing).
 */
export interface BacklogPaths {
  /** The project root directory (contains .rauf.json marker) */
  projectPath: string;
  /** The backlog root directory (contains backlog.json or has .rauf/ subdir with it) */
  root: string;
  /**
   * Where state files live (state.json, rauf.log, progress.md, etc.).
   * Same as `root` when root IS `.rauf/` (the default root case).
   * Otherwise `root/.rauf/`.
   */
  stateDir: string;
  /** Resolved path to backlog.json (found in root or stateDir) */
  backlog: string;
  /** Path to state.json */
  state: string;
  /** Path to rauf.log */
  log: string;
  /** Path to DONE sentinel file */
  done: string;
  /** Path to CANCEL sentinel file */
  cancel: string;
  /** Path to progress.md (always per-root, no fallback) */
  progress: string;
  /** Path to iteration-status.json */
  iterationStatus: string;
  /** Path to archive/ directory */
  archive: string;
  /** Path to .loop.lock */
  lock: string;
  /** Path to events.ndjson — the persisted per-run event stream (= stateDir/events.ndjson). */
  eventsLog: string;
}

/**
 * Instruction file paths resolved with fallback.
 *
 * For RAUF.md and REVIEW.md: checks the backlog root's state directory first,
 * then falls back to the project-level `.rauf/` directory.
 * Returns `null` if neither location has the file.
 */
export interface InstructionPaths {
  /** Resolved RAUF.md path (per-root override or project-level fallback), or null if missing */
  raufMd: string | null;
  /** Resolved REVIEW.md path (per-root override or project-level fallback), or null if missing */
  reviewMd: string | null;
}

// ─── Functions ────────────────────────────────────────────────────

/**
 * Resolve the absolute backlog root path from a project path and optional --backlog flag.
 *
 * When `backlogFlag` is omitted or undefined, returns the default root: `{projectPath}/.rauf`.
 * When provided, resolves relative to `projectPath` and validates that the result
 * is within the project root (path sandboxing per REQ-SEC-01).
 *
 * @param projectPath - Absolute path to the project root (directory containing .rauf.json)
 * @param backlogFlag - Optional --backlog flag value (relative directory path)
 * @returns Absolute path to the backlog root directory
 */
export function resolveBacklogRoot(projectPath: string, backlogFlag?: string): Result<string> {
  if (backlogFlag === undefined || backlogFlag === "") {
    return ok(path.join(path.resolve(projectPath), ".rauf"));
  }

  const resolved = path.resolve(projectPath, backlogFlag);
  const validation = validatePath(resolved, [path.resolve(projectPath)]);
  if (!validation.ok) {
    return err({
      code: ErrorCodes.PATH_VIOLATION,
      message: `Backlog root '${resolved}' is outside the project root`,
    });
  }

  return ok(resolved);
}

/**
 * Determine the state directory for a given backlog root.
 * If root basename is `.rauf`, returns root directly (no nesting).
 * Otherwise returns `root/.rauf/`.
 */
export function resolveStateDir(backlogRoot: string): string {
  const resolved = path.resolve(backlogRoot);
  if (path.basename(resolved) === ".rauf") {
    return resolved;
  }
  return path.join(resolved, ".rauf");
}

/**
 * Resolve all backlog paths for a given project and backlog root.
 * Validates sandboxing, checks for backlog.json location, builds full BacklogPaths.
 */
export function resolveBacklogPaths(
  projectPath: string,
  backlogRoot: string,
): Result<BacklogPaths> {
  // 1. Validate backlogRoot within projectPath
  const validation = validatePath(backlogRoot, [path.resolve(projectPath)]);
  if (!validation.ok) {
    return err({
      code: ErrorCodes.PATH_VIOLATION,
      message: `Backlog root '${backlogRoot}' is outside the project root`,
    });
  }

  // 2. Check that backlogRoot exists as a directory
  try {
    const stat = fs.statSync(path.resolve(backlogRoot));
    if (!stat.isDirectory()) {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Backlog root directory not found: ${backlogRoot}`,
      });
    }
  } catch {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Backlog root directory not found: ${backlogRoot}`,
    });
  }

  // 3. Compute stateDir
  const stateDir = resolveStateDir(backlogRoot);

  // 4. Locate backlog.json
  const rootBacklog = path.join(path.resolve(backlogRoot), "backlog.json");
  const stateDirBacklog = path.join(stateDir, "backlog.json");
  let backlogPath: string;

  if (fileExists(rootBacklog)) {
    backlogPath = rootBacklog;
  } else if (stateDir !== path.resolve(backlogRoot) && fileExists(stateDirBacklog)) {
    backlogPath = stateDirBacklog;
  } else {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `No backlog.json found in ${backlogRoot} or ${stateDir}`,
    });
  }

  // 5. Build and return BacklogPaths
  return ok({
    projectPath: path.resolve(projectPath),
    root: path.resolve(backlogRoot),
    stateDir,
    backlog: backlogPath,
    state: path.join(stateDir, "state.json"),
    log: path.join(stateDir, "rauf.log"),
    done: path.join(stateDir, "DONE"),
    cancel: path.join(stateDir, "CANCEL"),
    progress: path.join(stateDir, "progress.md"),
    iterationStatus: path.join(stateDir, "iteration-status.json"),
    archive: path.join(stateDir, "archive"),
    lock: path.join(stateDir, ".loop.lock"),
    eventsLog: path.join(stateDir, "events.ndjson"),
  });
}

/**
 * Resolve instruction file paths (RAUF.md, REVIEW.md) with per-root-then-project fallback.
 */
export function resolveInstructionPaths(paths: BacklogPaths): InstructionPaths {
  const projectRaufDir = path.join(paths.projectPath, ".rauf");

  function resolveWithFallback(filename: string): string | null {
    // 1. Per-root override
    const perRoot = path.join(paths.stateDir, filename);
    if (fileExists(perRoot)) return perRoot;

    // 2. Project-level fallback (only if stateDir differs from project .rauf/)
    if (paths.stateDir !== projectRaufDir) {
      const projectLevel = path.join(projectRaufDir, filename);
      if (fileExists(projectLevel)) return projectLevel;
    }

    return null;
  }

  return {
    raufMd: resolveWithFallback("RAUF.md"),
    reviewMd: resolveWithFallback("REVIEW.md"),
  };
}

/**
 * Ensure the state directory exists (creates with parents if needed).
 */
export function ensureStateDir(paths: BacklogPaths): Result<void> {
  return ensureDir(paths.stateDir);
}

/**
 * Construct BacklogPaths for the default root ({projectPath}/.rauf) without
 * any filesystem checks. Useful as a bridge for callers that don't yet resolve
 * paths via resolveBacklogPaths.
 */
export function defaultBacklogPaths(projectPath: string): BacklogPaths {
  const resolved = path.resolve(projectPath);
  const stateDir = path.join(resolved, ".rauf");
  return {
    projectPath: resolved,
    root: stateDir,
    stateDir,
    backlog: path.join(stateDir, BACKLOG_FILENAME),
    state: path.join(stateDir, STATE_FILENAME),
    log: path.join(stateDir, "rauf.log"),
    done: path.join(stateDir, "DONE"),
    cancel: path.join(stateDir, "CANCEL"),
    progress: path.join(stateDir, "progress.md"),
    iterationStatus: path.join(stateDir, "iteration-status.json"),
    archive: path.join(stateDir, "archive"),
    lock: path.join(stateDir, LOCK_FILENAME),
    eventsLog: path.join(stateDir, "events.ndjson"),
  };
}

// ─── scanBacklogRoots ────────────────────────────────────────────

/**
 * A backlog root discovered in a project, suitable for the `--backlog` flag and
 * the web backlog-root selector (REM-8). Distinct from `ActiveRoot` (status.ts),
 * which lists only roots with a *live* loop — this lists *every* root that has a
 * `backlog.json`, regardless of loop state.
 */
export interface BacklogRootEntry {
  /**
   * `--backlog` flag value: the backlog-root directory path relative to the
   * project root (e.g. `.rauf`, `specs/auth`). Always resolvable by
   * `resolveBacklogPaths(projectPath, root)`. Uses `/` separators.
   */
  root: string;
  /** True for the project's default root (`{projectPath}/.rauf`). */
  isDefault: boolean;
}

function walkForBacklogs(
  dir: string,
  projectPath: string,
  defaultRoot: string,
  results: BacklogRootEntry[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or deleted — skip
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    if ((SCAN_SKIP_DIRS as readonly string[]).includes(name)) continue;

    const fullPath = path.join(dir, name);

    // A directory directly containing backlog.json is a backlog root. This
    // covers both `<dir>/backlog.json` (non-default roots) and the default
    // `.rauf/backlog.json` (where the .rauf dir itself is the root).
    if (fileExists(path.join(fullPath, BACKLOG_FILENAME))) {
      const rel = path.relative(projectPath, fullPath).split(path.sep).join("/");
      if (!results.some((r) => r.root === rel)) {
        results.push({ root: rel, isDefault: path.resolve(fullPath) === defaultRoot });
      }
    }

    // Don't recurse into .rauf state dirs.
    if (name === DEFAULT_ROOT_DIR) continue;

    walkForBacklogs(fullPath, projectPath, defaultRoot, results);
  }
}

/**
 * Scan a project for every backlog root (any directory with a `backlog.json`,
 * directly or as `.rauf/backlog.json`). Returns `--backlog`-ready relative paths,
 * with the default `.rauf` root flagged. Skips: node_modules, .git, dist, build,
 * coverage, artifacts (the last excludes rauf's own template backlogs, matching
 * `discoverProjects`). Results are sorted with the default root first, then alphabetically.
 *
 * @param projectPath - Absolute path to the project root
 */
export function scanBacklogRoots(projectPath: string): Result<BacklogRootEntry[]> {
  const resolved = path.resolve(projectPath);
  const defaultRoot = path.join(resolved, DEFAULT_ROOT_DIR);
  const results: BacklogRootEntry[] = [];

  walkForBacklogs(resolved, resolved, defaultRoot, results);

  results.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.root.localeCompare(b.root);
  });

  return ok(results);
}

// ─── resolveTarget ───────────────────────────────────────────────
//
// The context-aware wrong-root safety guard. Co-located here (not a new file)
// because the load-bearing sandbox-containment seam (`resolveBacklogRoot`,
// `resolveBacklogPaths`) already lives in this module and `resolveTarget` MUST
// delegate containment to it (REQ-SAFE-01) — see 03-target-resolution.md §2.

/**
 * Inputs to {@link resolveTarget}. The CLI computes `isMachineContext`/`isTTY`
 * from the global flags + `process.stdout.isTTY` and passes them in, so `core`
 * stays free of any `process`/TTY probing of its own.
 */
export interface ResolveTargetOptions {
  /** Positional `<root>` argument, if the user gave one. */
  pathArg?: string;
  /** `--backlog <dir>` flag, if given. */
  backlogFlag?: string;
  /**
   * True when output is machine-bound: `--json` OR a non-TTY stdout (D5).
   * When true, a missing/ambiguous target is a HARD ERROR (REQ-SCOPE-01),
   * never an implicit scan.
   */
  isMachineContext: boolean;
  /** True when stdout is an interactive TTY (drives cwd-default + pick list). */
  isTTY: boolean;
}

/**
 * Outcome of a *successful* resolution. Two shapes:
 *  - "resolved"  — a concrete (root, backlogDir) the caller acts on.
 *  - "ambiguous" — several active roots on a TTY; the CLI renders `candidates`
 *                  as an interactive pick list. NEVER returned in machine
 *                  context — there, ambiguity is a `TargetError`.
 */
export type ResolvedTarget =
  | {
      kind: "resolved";
      /** Absolute, sandbox-validated project root. */
      root: string;
      /** Absolute, sandbox-validated backlog/state directory under `root`. */
      backlogDir: string;
    }
  | {
      kind: "ambiguous";
      /** Live loops to disambiguate between; from `listActiveLoops()`. */
      candidates: ActiveLoopEntry[];
    };

/** Reason a target could not be resolved to a single concrete root. */
export type TargetErrorCode =
  | "missing_target" // machine context, no path given (REQ-SCOPE-01)
  | "ambiguous_target" // machine context, several active roots — hard fail
  | "not_found" // named/derived root does not exist
  | "outside_sandbox"; // containment failure (REQ-SAFE-01)

/**
 * Structured resolution failure. Returned in a `Result`, never thrown for an
 * expected condition. The CLI maps every variant to exit `USAGE(2)`.
 */
export interface TargetError {
  /** Machine-stable discriminant. */
  code: TargetErrorCode;
  /** Human-readable, single-line explanation. */
  message: string;
  /** The path/flag that triggered the failure, when applicable. */
  offending?: string;
}

/**
 * Resolve an explicit (pathArg, backlogFlag) pair to a concrete `resolved`
 * target, delegating ALL containment/existence checks to `resolveBacklogRoot` +
 * `resolveBacklogPaths` (REQ-SAFE-01 — no local `path.resolve`+`startsWith`).
 * Maps delegate `RaufError.code`s to `TargetError` codes.
 */
function resolveConcrete(
  pathArg: string,
  backlogFlag?: string,
): Result<ResolvedTarget, TargetError> {
  const rootResult = resolveBacklogRoot(pathArg, backlogFlag);
  if (!rootResult.ok) {
    if (rootResult.error.code === ErrorCodes.PATH_VIOLATION) {
      return err({
        code: "outside_sandbox",
        message: rootResult.error.message,
        offending: backlogFlag ?? pathArg,
      });
    }
    return err({ code: "not_found", message: rootResult.error.message, offending: pathArg });
  }

  const pathsResult = resolveBacklogPaths(pathArg, rootResult.value);
  if (!pathsResult.ok) {
    if (pathsResult.error.code === ErrorCodes.PATH_VIOLATION) {
      return err({
        code: "outside_sandbox",
        message: pathsResult.error.message,
        offending: rootResult.value,
      });
    }
    // FILE_NOT_FOUND (or any other code) → not_found (defensive default).
    return err({
      code: "not_found",
      message: pathsResult.error.message,
      offending: rootResult.value,
    });
  }

  return ok({
    kind: "resolved",
    root: pathsResult.value.projectPath,
    backlogDir: pathsResult.value.root,
  });
}

/**
 * Resolve the CLI arguments + output context to a single backlog target, or a
 * structured reason it cannot be resolved. Context-aware (REQ-SCOPE-01/02, D5):
 *
 *  - **Explicit `pathArg`** — context-independent: resolve it via
 *    `resolveBacklogRoot`/`resolveBacklogPaths`.
 *  - **No path, machine context** — HARD `missing_target` error; never scans.
 *  - **No path, TTY** — default to cwd; exactly one live loop → resolved; several
 *    → `kind:"ambiguous"`; zero → resolve cwd.
 *
 * The final (root, backlogDir) always flows through the delegate seam, so the
 * sandbox containment check is NEVER reimplemented here (REQ-SAFE-01). No
 * subprocess, no `process`/TTY probing (the caller supplies the context flags).
 *
 * @returns ok(ResolvedTarget) on success; err(TargetError) on a hard failure.
 */
export function resolveTarget(opts: ResolveTargetOptions): Result<ResolvedTarget, TargetError> {
  const { pathArg, backlogFlag, isMachineContext, isTTY } = opts;

  // Branch 1: explicit pathArg — context-independent.
  if (pathArg !== undefined && pathArg !== "") {
    return resolveConcrete(pathArg, backlogFlag);
  }

  // Branch 2 & 4: no path, machine context (or neither machine nor TTY →
  // defensive machine strictness). Never consult listActiveLoops or cwd.
  if (isMachineContext || !isTTY) {
    return err({
      code: "missing_target",
      message:
        "A target root is required in machine context (--json or non-TTY). Pass <root> [--backlog <dir>].",
    });
  }

  // Branch 3: no path, TTY. Enumerate live loops.
  const active = listActiveLoops();
  const loops = active.ok ? active.value : []; // IO_ERROR → treat as zero.

  if (loops.length === 1) {
    const entry = loops[0];
    if (entry !== undefined) {
      return resolveConcrete(entry.projectPath, entry.backlogRoot);
    }
  }

  if (loops.length >= 2) {
    return ok({ kind: "ambiguous", candidates: loops });
  }

  // Zero active loops → default to cwd.
  return resolveConcrete(process.cwd(), backlogFlag);
}
