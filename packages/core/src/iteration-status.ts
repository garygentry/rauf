// ─── Iteration Status ───────────────────────────────────────────
//
// Manages .ralph/iteration-status.json — a live file written during
// Claude invocations to expose tool activity, token counts, and
// stuckness to watchers (CLI, web dashboard, `ralph loop watch`).

import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok } from "./errors.js";
import { atomicWrite } from "./fs-utils.js";
import { IterationStatusSchema, type IterationStatus } from "./schemas.js";

const STATUS_FILENAME = "iteration-status.json";

/** Minimum interval between writes (ms) */
const THROTTLE_MS = 1000;

/** Last write timestamp per project path, for throttling */
const lastWriteAt = new Map<string, number>();

function statusPath(projectPath: string): string {
  return path.resolve(projectPath, ".ralph", STATUS_FILENAME);
}

/**
 * Write iteration-status.json atomically.
 * Throttled to max 1 write per second per project.
 * Returns ok(true) if written, ok(false) if throttled.
 */
export function writeIterationStatus(
  projectPath: string,
  status: IterationStatus,
  force?: boolean,
): Result<boolean> {
  const now = Date.now();
  const lastWrite = lastWriteAt.get(projectPath) ?? 0;

  if (!force && now - lastWrite < THROTTLE_MS) {
    return ok(false);
  }

  const content = JSON.stringify(status, null, 2) + "\n";
  const result = atomicWrite(statusPath(projectPath), content);
  if (!result.ok) return result as unknown as Result<boolean>;

  lastWriteAt.set(projectPath, now);
  return ok(true);
}

/**
 * Read and validate iteration-status.json.
 * Returns null if the file does not exist or fails validation.
 */
export function readIterationStatus(projectPath: string): IterationStatus | null {
  const filePath = statusPath(projectPath);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
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
export function clearIterationStatus(projectPath: string): void {
  try {
    fs.unlinkSync(statusPath(projectPath));
  } catch {
    // File may not exist — that's fine
  }
  lastWriteAt.delete(projectPath);
}
