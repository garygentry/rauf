import type { Result } from "./errors.js";

// ─── Constants ────────────────────────────────────────────────────

/** Lock file name within the state directory */
export const LOCK_FILENAME = ".loop.lock";

/** Directories to skip during active root scanning */
export const SCAN_SKIP_DIRS = ["node_modules", ".git", "dist", "build", "coverage"] as const;

/** State file name (unified constant) */
export const STATE_FILENAME = "state.json";

/** Backlog file name */
export const BACKLOG_FILENAME = "backlog.json";

/** Default backlog root directory name */
export const DEFAULT_ROOT_DIR = ".ralph";

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
  /** The project root directory (contains .ralph.json marker) */
  projectPath: string;
  /** The backlog root directory (contains backlog.json or has .ralph/ subdir with it) */
  root: string;
  /**
   * Where state files live (state.json, ralph.log, progress.md, etc.).
   * Same as `root` when root IS `.ralph/` (the default root case).
   * Otherwise `root/.ralph/`.
   */
  stateDir: string;
  /** Resolved path to backlog.json (found in root or stateDir) */
  backlog: string;
  /** Path to state.json */
  state: string;
  /** Path to ralph.log */
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
}

/**
 * Instruction file paths resolved with fallback.
 *
 * For RALPH.md and REVIEW.md: checks the backlog root's state directory first,
 * then falls back to the project-level `.ralph/` directory.
 * Returns `null` if neither location has the file.
 */
export interface InstructionPaths {
  /** Resolved RALPH.md path (per-root override or project-level fallback), or null if missing */
  ralphMd: string | null;
  /** Resolved REVIEW.md path (per-root override or project-level fallback), or null if missing */
  reviewMd: string | null;
}

// ─── Placeholder Functions ────────────────────────────────────────

/**
 * Resolve the backlog root directory from project path and optional --backlog flag.
 * No flag → default `.ralph/` directory. With flag → resolve relative to projectPath.
 */
export function resolveBacklogRoot(projectPath: string, backlogFlag?: string): Result<string> {
  void projectPath;
  void backlogFlag;
  throw new Error("not implemented");
}

/**
 * Determine the state directory for a given backlog root.
 * If root basename is `.ralph`, returns root directly (no nesting).
 * Otherwise returns `root/.ralph/`.
 */
export function resolveStateDir(backlogRoot: string): string {
  void backlogRoot;
  throw new Error("not implemented");
}

/**
 * Resolve all backlog paths for a given project and backlog root.
 * Validates sandboxing, checks for backlog.json location, builds full BacklogPaths.
 */
export function resolveBacklogPaths(
  projectPath: string,
  backlogRoot: string,
): Result<BacklogPaths> {
  void projectPath;
  void backlogRoot;
  throw new Error("not implemented");
}

/**
 * Resolve instruction file paths (RALPH.md, REVIEW.md) with per-root-then-project fallback.
 */
export function resolveInstructionPaths(paths: BacklogPaths): InstructionPaths {
  void paths;
  throw new Error("not implemented");
}

/**
 * Ensure the state directory exists (creates with parents if needed).
 */
export async function ensureStateDir(paths: BacklogPaths): Promise<Result<void>> {
  void paths;
  throw new Error("not implemented");
}
