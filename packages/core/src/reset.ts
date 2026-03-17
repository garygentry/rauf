// ─── Reset Module ────────────────────────────────────────────────
//
// Orchestrates a full project reset for a fresh backlog cycle:
// sweep done items → reset stalled → clear state/markers → optionally empty backlog.

import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { sweepBacklog } from "./archive.js";
import { readBacklog, writeBacklog, resetStalledItems } from "./backlog.js";
import { clearDoneFile, clearCancelFile } from "./status.js";

// ─── Types ──────────────────────────────────────────────────────

export interface ResetProjectOptions {
  clearBacklog?: boolean;
}

export interface ResetProjectResult {
  sweptCount: number;
  sweptMonths: string[];
  stalledResetCount: number;
  stateCleared: boolean;
  doneCleared: boolean;
  cancelCleared: boolean;
  backlogCleared: boolean;
}

// ─── Constants ──────────────────────────────────────────────────

const RALPH_DIR = ".ralph";
const STATE_FILENAME = "state.json";

// ─── resetProject ───────────────────────────────────────────────

export function resetProject(
  projectPath: string,
  options?: ResetProjectOptions,
): Result<ResetProjectResult> {
  const resolved = path.resolve(projectPath);

  // 1. Sweep all done items to archive (no min-age filter)
  const sweepResult = sweepBacklog(resolved);
  if (!sweepResult.ok) return sweepResult;

  // 2. Reset in_progress → pending
  const stalledResult = resetStalledItems(resolved);
  if (!stalledResult.ok) return stalledResult;

  // 3. Delete state.json (swallow ENOENT)
  const statePath = path.join(resolved, RALPH_DIR, STATE_FILENAME);
  let stateCleared = false;
  try {
    fs.unlinkSync(statePath);
    stateCleared = true;
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code !== "ENOENT") {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Failed to delete state.json: ${e.message}`,
        details: { path: statePath },
      });
    }
  }

  // 4. Clear DONE file
  const doneResult = clearDoneFile(resolved);
  if (!doneResult.ok) return doneResult;

  // 5. Clear CANCEL file
  const cancelResult = clearCancelFile(resolved);
  if (!cancelResult.ok) return cancelResult;

  // 6. Optionally empty backlog items array (preserve project/description)
  let backlogCleared = false;
  if (options?.clearBacklog) {
    const backlogResult = readBacklog(resolved);
    if (!backlogResult.ok) return backlogResult;

    const backlog = backlogResult.value;
    const writeResult = writeBacklog(resolved, {
      ...backlog,
      items: [],
    });
    if (!writeResult.ok) return writeResult;
    backlogCleared = true;
  }

  return ok({
    sweptCount: sweepResult.value.archivedCount,
    sweptMonths: sweepResult.value.archivedMonths,
    stalledResetCount: stalledResult.value.resetCount,
    stateCleared,
    doneCleared: true,
    cancelCleared: true,
    backlogCleared,
  });
}
