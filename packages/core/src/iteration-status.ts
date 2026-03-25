// ─── Iteration Status ───────────────────────────────────────────
//
// Manages .ralph/iteration-status.json — a live file written during
// Claude invocations to expose tool activity, token counts, and
// stuckness to watchers (CLI, web dashboard, `ralph loop watch`).

import * as fs from "node:fs";

import type { BacklogPaths } from "./backlog-root.js";
import { type Result, ok } from "./errors.js";
import { atomicWrite } from "./fs-utils.js";
import { IterationStatusSchema, type IterationStatus } from "./schemas.js";

/** Minimum interval between writes (ms) */
const THROTTLE_MS = 1000;

/** Last write timestamp per iteration-status path, for throttling */
const lastWriteAt = new Map<string, number>();

/**
 * Write iteration-status.json atomically.
 * Throttled to max 1 write per second per root.
 * Returns ok(true) if written, ok(false) if throttled.
 */
export function writeIterationStatus(
  paths: BacklogPaths,
  status: IterationStatus,
  force?: boolean,
): Result<boolean> {
  const key = paths.iterationStatus;
  const now = Date.now();
  const lastWrite = lastWriteAt.get(key) ?? 0;

  if (!force && now - lastWrite < THROTTLE_MS) {
    return ok(false);
  }

  const content = JSON.stringify(status, null, 2) + "\n";
  const result = atomicWrite(paths.iterationStatus, content);
  if (!result.ok) return result as unknown as Result<boolean>;

  lastWriteAt.set(key, now);
  return ok(true);
}

/**
 * Read and validate iteration-status.json.
 * Returns null if the file does not exist or fails validation.
 */
export function readIterationStatus(paths: BacklogPaths): IterationStatus | null {
  let raw: string;
  try {
    raw = fs.readFileSync(paths.iterationStatus, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = IterationStatusSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Delete iteration-status.json (called when an iteration ends).
 */
export function clearIterationStatus(paths: BacklogPaths): void {
  try {
    fs.unlinkSync(paths.iterationStatus);
  } catch {
    // File may not exist — that's fine
  }
  lastWriteAt.delete(paths.iterationStatus);
}
