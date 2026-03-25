// ─── Archive / Sweep Module ──────────────────────────────────────
//
// Moves "done" backlog items into monthly archive files under
// .ralph/archive/YYYY-MM.json, keeping the active backlog lean.

import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile, atomicWrite, fileExists, ensureDir } from "./fs-utils.js";
import { readBacklog, writeBacklog } from "./backlog.js";
import { defaultBacklogPaths } from "./backlog-root.js";
import {
  ArchiveMonthSchema,
  normalizeBacklogItems,
  type ArchiveMonth,
  type SweepResult,
} from "./schemas.js";

// ─── Constants ───────────────────────────────────────────────────

const ARCHIVE_SUBDIR = ".ralph/archive";

// ─── Path helpers ────────────────────────────────────────────────

function getArchiveDir(projectPath: string): string {
  return path.join(path.resolve(projectPath), ARCHIVE_SUBDIR);
}

function getArchiveFilePath(projectPath: string, month: string): string {
  return path.join(getArchiveDir(projectPath), `${month}.json`);
}

const MONTH_REGEX = /^\d{4}-\d{2}$/;
const ARCHIVE_FILE_REGEX = /^\d{4}-\d{2}\.json$/;

// ─── sweepBacklog ─────────────────────────────────────────────────
//
// Moves all done backlog items (optionally older than minAgeDays)
// into monthly archive files. Archive files are written first, then
// backlog.json is updated — safer failure mode than the reverse.

export function sweepBacklog(
  projectPath: string,
  options?: { minAgeDays?: number },
): Result<SweepResult> {
  // 1. Read backlog
  const backlogResult = readBacklog(defaultBacklogPaths(projectPath));
  if (!backlogResult.ok) return backlogResult;

  const backlog = backlogResult.value;
  const minAgeDays = options?.minAgeDays ?? 0;

  // 2. Compute cutoff timestamp (0 = sweep all done items)
  const cutoff = minAgeDays > 0 ? Date.now() - minAgeDays * 86_400_000 : null;

  // 3. Separate items to archive vs keep
  const toArchive = backlog.items.filter((item) => {
    if (item.status !== "done") return false;
    if (cutoff === null) return true;
    // Keep recent items (completed after cutoff) in the backlog
    if (!item.completedAt) return true; // null completedAt → sweep it
    return new Date(item.completedAt).getTime() <= cutoff;
  });

  const toKeep = backlog.items.filter((item) => !toArchive.includes(item));

  // 4. Short-circuit if nothing to archive
  if (toArchive.length === 0) {
    return ok({ archivedCount: 0, archivedMonths: [] });
  }

  // 5. Group by month (YYYY-MM from completedAt, or current month as fallback)
  const currentMonth = new Date().toISOString().slice(0, 7);
  const byMonth = new Map<string, typeof toArchive>();
  for (const item of toArchive) {
    const month = item.completedAt ? item.completedAt.slice(0, 7) : currentMonth;
    const group = byMonth.get(month) ?? [];
    group.push(item);
    byMonth.set(month, group);
  }

  // 6. Ensure archive directory exists
  const archiveDir = getArchiveDir(projectPath);
  const dirResult = ensureDir(archiveDir);
  if (!dirResult.ok) return dirResult;

  // 7. Write each month's archive file (archive-first for safety)
  const sortedMonths = [...byMonth.keys()].sort();
  for (const month of sortedMonths) {
    const items = byMonth.get(month)!;
    const archivePath = getArchiveFilePath(projectPath, month);

    // Merge with existing archive if present
    let existing: ArchiveMonth = { month, items: [] };
    if (fileExists(archivePath)) {
      const existingResult = readJsonFile(archivePath, ArchiveMonthSchema, normalizeBacklogItems);
      if (!existingResult.ok) return existingResult;
      existing = existingResult.value;
    }

    const merged: ArchiveMonth = {
      month,
      items: [...existing.items, ...items],
    };

    const writeResult = atomicWrite(archivePath, JSON.stringify(merged, null, 2) + "\n");
    if (!writeResult.ok) return writeResult;
  }

  // 8. Update backlog with remaining items
  const backlogWriteResult = writeBacklog(defaultBacklogPaths(projectPath), {
    ...backlog,
    items: toKeep,
  });
  if (!backlogWriteResult.ok) return backlogWriteResult;

  // 9. Return summary
  return ok({ archivedCount: toArchive.length, archivedMonths: sortedMonths });
}

// ─── listArchiveMonths ────────────────────────────────────────────
//
// Returns sorted list of YYYY-MM strings for existing archive files.

export function listArchiveMonths(projectPath: string): Result<string[]> {
  const archiveDir = getArchiveDir(projectPath);

  if (!fileExists(archiveDir)) {
    return ok([]);
  }

  try {
    const entries = fs.readdirSync(archiveDir);
    const months = entries
      .filter((f) => ARCHIVE_FILE_REGEX.test(f))
      .map((f) => f.replace(".json", ""))
      .sort();
    return ok(months);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to read archive directory: ${archiveDir}`,
      details: { path: archiveDir, cause: e instanceof Error ? e.message : String(e) },
    });
  }
}

// ─── readArchiveMonth ─────────────────────────────────────────────
//
// Read and validate a single YYYY-MM archive file.

export function readArchiveMonth(projectPath: string, month: string): Result<ArchiveMonth> {
  if (!MONTH_REGEX.test(month)) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Invalid month format: "${month}" — expected YYYY-MM`,
      details: { month },
    });
  }

  const archivePath = getArchiveFilePath(projectPath, month);
  return readJsonFile(archivePath, ArchiveMonthSchema, normalizeBacklogItems);
}

// ─── purgeArchive ─────────────────────────────────────────────────
//
// Delete one or all archive files. Returns the count of purged months.
// Non-existent months are silently treated as 0 (idempotent).

export function purgeArchive(
  projectPath: string,
  month?: string,
): Result<{ purgedCount: number; purgedMonths: string[] }> {
  // Single-month purge
  if (month !== undefined) {
    if (!MONTH_REGEX.test(month)) {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Invalid month format: "${month}" — expected YYYY-MM`,
        details: { month },
      });
    }

    const archivePath = getArchiveFilePath(projectPath, month);
    if (!fileExists(archivePath)) {
      return ok({ purgedCount: 0, purgedMonths: [] });
    }

    try {
      fs.unlinkSync(archivePath);
      return ok({ purgedCount: 1, purgedMonths: [month] });
    } catch (e) {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Failed to delete archive file: ${archivePath}`,
        details: { path: archivePath, cause: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  // Purge all months
  const monthsResult = listArchiveMonths(projectPath);
  if (!monthsResult.ok) return monthsResult;

  const months = monthsResult.value;
  if (months.length === 0) {
    return ok({ purgedCount: 0, purgedMonths: [] });
  }

  const purgedMonths: string[] = [];
  for (const m of months) {
    const archivePath = getArchiveFilePath(projectPath, m);
    try {
      fs.unlinkSync(archivePath);
      purgedMonths.push(m);
    } catch (e) {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Failed to delete archive file: ${archivePath}`,
        details: { path: archivePath, cause: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  // Attempt to remove the (now-empty) archive directory — best effort
  const archiveDir = getArchiveDir(projectPath);
  try {
    fs.rmdirSync(archiveDir);
  } catch {
    // ignore — directory may not be empty or may not exist
  }

  return ok({ purgedCount: purgedMonths.length, purgedMonths });
}
