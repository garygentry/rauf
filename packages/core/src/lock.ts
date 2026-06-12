import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import type { BacklogPaths } from "./backlog-root.js";
import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { atomicWrite, fileExists } from "./fs-utils.js";

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

// ─── Internal Helpers ─────────────────────────────────────────────

/**
 * Check if a process with the given PID is alive.
 * Uses `process.kill(pid, 0)` which sends no signal but checks existence.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the start time of a process from /proc/{pid}/stat field 22.
 * Linux only — returns null on non-Linux platforms.
 */
function getProcessStartTime(pid: number): number | null {
  if (process.platform !== "linux") return null;

  let statContent: string;
  try {
    statContent = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
  } catch {
    return null;
  }

  const lastParen = statContent.lastIndexOf(")");
  if (lastParen === -1) return null;

  const fields = statContent.slice(lastParen + 2).split(" ");
  const raw = fields[19];
  if (raw === undefined) return null;

  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

/**
 * Detect PID recycling by comparing recorded start time against current.
 * Linux only — returns false on non-Linux platforms.
 */
function isProcessRecycled(pid: number, recordedStartTime: number | null): boolean {
  if (recordedStartTime === null) return false;
  if (process.platform !== "linux") return false;

  let statContent: string;
  try {
    statContent = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
  } catch {
    return false;
  }

  const lastParen = statContent.lastIndexOf(")");
  if (lastParen === -1) return false;

  const fields = statContent.slice(lastParen + 2).split(" ");
  const raw = fields[19];
  if (raw === undefined) return false;

  const currentStartTime = parseInt(raw, 10);
  if (Number.isNaN(currentStartTime)) return false;

  return currentStartTime !== recordedStartTime;
}

// ─── Public Functions ─────────────────────────────────────────────

/**
 * Acquire a loop lock for the given backlog root.
 *
 * If no lock exists, writes a new lock file with the current PID and timestamp.
 * If a lock exists:
 *   - Stale lock (dead PID or recycled PID): removes and re-acquires
 *   - Active lock (live PID): returns LOCK_CONFLICT error
 *
 * @param paths - BacklogPaths (uses paths.lock for the lock file location)
 * @returns ok(undefined) if lock acquired, err(LOCK_CONFLICT) if another loop is active
 */
export function acquireLock(paths: BacklogPaths): Result<void> {
  const status = checkLock(paths);
  if (!status.ok) return status;

  if (status.value.locked) {
    if (!status.value.stale) {
      const relativePath = path.relative(paths.projectPath, paths.root);
      return err({
        code: ErrorCodes.LOCK_CONFLICT,
        message: `Loop already running for ${relativePath} (PID ${status.value.pid}, started ${status.value.startedAt})`,
        details: {
          backlogRoot: paths.root,
          pid: status.value.pid,
          startedAt: status.value.startedAt,
        },
      });
    }
    // Stale lock — remove it
    try {
      fs.unlinkSync(paths.lock);
    } catch {
      // ignore — may already be gone
    }
  }

  const content: LockFileContent = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    processStartTime: getProcessStartTime(process.pid),
  };

  return atomicWrite(paths.lock, JSON.stringify(content, null, 2) + "\n");
}

/**
 * Release the loop lock for the given backlog root.
 *
 * Removes the lock file. Returns ok even if the file doesn't exist
 * (idempotent — safe to call in finally blocks).
 *
 * @param paths - BacklogPaths (uses paths.lock)
 * @returns ok(undefined) on success
 */
export function releaseLock(paths: BacklogPaths): Result<void> {
  try {
    fs.unlinkSync(paths.lock);
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code !== "ENOENT") {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Failed to release lock: ${e.message}`,
        details: { path: paths.lock },
      });
    }
  }
  return ok(undefined);
}

/**
 * Check the current lock state given a raw lock-file path.
 *
 * Reads the lock file, checks PID liveness, and detects PID recycling.
 * Does not acquire or release the lock — purely informational.
 *
 * @param lockPath - Absolute path to the .loop.lock file
 * @returns Lock status including stale detection
 */
export function checkLockFile(lockPath: string): Result<LockStatus> {
  if (!fileExists(lockPath)) {
    return ok({ locked: false });
  }

  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf-8");
  } catch {
    return ok({ locked: true, stale: true });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ok({ locked: true, stale: true });
  }

  const result = LockFileContentSchema.safeParse(parsed);
  if (!result.success) {
    return ok({ locked: true, stale: true });
  }

  const content = result.data;

  if (!isProcessAlive(content.pid)) {
    return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true });
  }

  if (isProcessRecycled(content.pid, content.processStartTime)) {
    return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true });
  }

  return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: false });
}

/**
 * Check the current lock state for a backlog root.
 *
 * Delegates to checkLockFile using paths.lock.
 *
 * @param paths - BacklogPaths (uses paths.lock)
 * @returns Lock status including stale detection
 */
export function checkLock(paths: BacklogPaths): Result<LockStatus> {
  return checkLockFile(paths.lock);
}

/**
 * Force-remove the lock file regardless of whether the PID is alive.
 * Used when the --force flag is specified.
 *
 * @param paths - BacklogPaths (uses paths.lock)
 * @returns ok(undefined) on success
 */
export function forceClearLock(paths: BacklogPaths): Result<void> {
  return releaseLock(paths);
}
