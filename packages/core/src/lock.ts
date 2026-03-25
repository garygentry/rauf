import { z } from "zod";

import type { BacklogPaths } from "./backlog-root.js";
import type { Result } from "./errors.js";

// ─── Types ────────────────────────────────────────────────────────

/**
 * Content of the `.loop.lock` file in a backlog root's state directory.
 * Used to prevent concurrent loop execution on the same backlog root.
 */
export interface LockFileContent {
  /** PID of the loop process that acquired the lock */
  pid: number;
  /** ISO 8601 timestamp when the lock was acquired */
  startedAt: string;
  /**
   * Process start time in clock ticks (from /proc/{pid}/stat field 22).
   * Used to detect PID recycling on Linux. Null on non-Linux platforms
   * where this information is unavailable.
   */
  processStartTime: number | null;
}

/** Zod schema for validating lock file JSON content */
export const LockFileContentSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string(),
  processStartTime: z.number().int().nullable(),
});

/**
 * Describes the current state of a backlog root's lock file.
 * Returned by `checkLock()`.
 */
export interface LockStatus {
  /** Whether a lock file exists */
  locked: boolean;
  /** PID of the lock holder (if locked) */
  pid?: number;
  /** ISO 8601 timestamp when the lock was acquired (if locked) */
  startedAt?: string;
  /** Whether the lock is stale (PID dead or recycled) */
  stale?: boolean;
}

// ─── Placeholder Functions ────────────────────────────────────────

/**
 * Acquire a lock for the given backlog root.
 * Returns LOCK_CONFLICT if already locked by a live process.
 * Removes stale locks automatically.
 */
export function acquireLock(paths: BacklogPaths): Result<void> {
  void paths;
  throw new Error("not implemented");
}

/**
 * Release the lock for the given backlog root.
 * Idempotent — returns ok even if no lock exists.
 */
export function releaseLock(paths: BacklogPaths): Result<void> {
  void paths;
  throw new Error("not implemented");
}

/**
 * Check the current lock status for the given backlog root.
 * Returns locked state, PID info, and staleness.
 */
export function checkLock(paths: BacklogPaths): Result<LockStatus> {
  void paths;
  throw new Error("not implemented");
}

/**
 * Force-clear the lock regardless of PID status.
 */
export function forceClearLock(paths: BacklogPaths): Result<void> {
  void paths;
  throw new Error("not implemented");
}
