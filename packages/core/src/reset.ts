// ─── Reset Module ────────────────────────────────────────────────
//
// Orchestrates a full project reset for a fresh backlog cycle:
// sweep done items → reset stalled → clear state/markers → optionally empty backlog.

import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { sweepBacklog } from "./archive.js";
import { readBacklog, writeBacklog, resetStalledItems, ensureBacklog } from "./backlog.js";
import type { BacklogPaths } from "./backlog-root.js";
import { clearDoneFile, clearCancelFile } from "./status.js";
import { atomicWrite, fileExists, ensureDir } from "./fs-utils.js";
import { deployProgress } from "./installer.js";

// ─── Types ──────────────────────────────────────────────────────

export interface ResetProjectOptions {
  clearBacklog?: boolean;
  keepProgress?: boolean;
  keepLog?: boolean;
}

export interface ResetProjectResult {
  sweptCount: number;
  sweptMonths: string[];
  stalledResetCount: number;
  stateCleared: boolean;
  doneCleared: boolean;
  cancelCleared: boolean;
  backlogCleared: boolean;
  progressArchived: boolean;
  logArchived: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Compact, filesystem-safe timestamp: 20260317-143052 */
function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ─── resetProject ───────────────────────────────────────────────

export function resetProject(
  paths: BacklogPaths,
  options?: ResetProjectOptions,
): Result<ResetProjectResult> {
  // 0. Ensure backlog.json exists (create empty if .ralph/ dir is present)
  const ensureResult = ensureBacklog(paths);
  if (!ensureResult.ok) return ensureResult;

  // 1. Sweep all done items to archive (no min-age filter)
  const sweepResult = sweepBacklog(paths);
  if (!sweepResult.ok) return sweepResult;

  // 2. Reset in_progress → pending
  const stalledResult = resetStalledItems(paths);
  if (!stalledResult.ok) return stalledResult;

  // 3. Delete state.json (swallow ENOENT)
  const statePath = paths.state;
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
  const doneResult = clearDoneFile(paths);
  if (!doneResult.ok) return doneResult;

  // 5. Clear CANCEL file
  const cancelResult = clearCancelFile(paths);
  if (!cancelResult.ok) return cancelResult;

  // 6. Archive progress.md when clearing backlog (unless --keep-progress)
  const ts = archiveTimestamp();
  let progressArchived = false;
  if (options?.clearBacklog && !options?.keepProgress) {
    const progressPath = paths.progress;
    if (fileExists(progressPath)) {
      const archiveDir = paths.archive;
      const ensureResult = ensureDir(archiveDir);
      if (!ensureResult.ok) return ensureResult;

      const content = fs.readFileSync(progressPath, "utf-8");
      const archivePath = path.join(archiveDir, `${ts}-progress.md`);
      const archiveResult = atomicWrite(archivePath, content);
      if (!archiveResult.ok) return archiveResult;

      fs.unlinkSync(progressPath);
      const deployResult = deployProgress(paths.stateDir);
      if (!deployResult.ok) return deployResult;

      progressArchived = true;
    }
  }

  // 7. Archive ralph.log when clearing backlog (unless --keep-log)
  let logArchived = false;
  if (options?.clearBacklog && !options?.keepLog) {
    const logPath = paths.log;
    if (fileExists(logPath)) {
      const archiveDir = paths.archive;
      const ensureResult = ensureDir(archiveDir);
      if (!ensureResult.ok) return ensureResult;

      const archivePath = path.join(archiveDir, `${ts}-ralph.log`);
      try {
        fs.renameSync(logPath, archivePath);
        logArchived = true;
      } catch (e) {
        if (e instanceof Error) {
          return err({
            code: ErrorCodes.FILE_NOT_FOUND,
            message: `Failed to archive ralph.log: ${e.message}`,
            details: { path: logPath },
          });
        }
      }
    }
  }

  // 8. Optionally clear backlog (empty items, reset project/description)
  let backlogCleared = false;
  if (options?.clearBacklog) {
    const backlogResult = readBacklog(paths);
    if (!backlogResult.ok) return backlogResult;

    const backlog = backlogResult.value;
    const writeResult = writeBacklog(paths, {
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
    progressArchived,
    logArchived,
  });
}
