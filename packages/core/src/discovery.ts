import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile } from "./fs-utils.js";
import { MarkerFileSchema, type DiscoveredProject } from "./schemas.js";
import { detectMigrationState } from "./migrate.js";

// ─── Types ───────────────────────────────────────────────────────

export interface DiscoveryResult {
  /** Projects with valid .rauf.json and ignoreInTool !== true */
  projects: DiscoveredProject[];
  /** Projects with ignoreInTool === true */
  ignored: DiscoveredProject[];
  /** Warnings from invalid .rauf.json files or read errors */
  warnings: string[];
}

// ─── discoverProjects ────────────────────────────────────────────
//
// Scan rootDir at depth=1 for directories containing .rauf.json.
// - rootDir itself is included if it has a .rauf.json
// - Paths containing /artifacts/ are excluded
// - Invalid .rauf.json files are skipped with warnings
// - Returns projects sorted by name, with ignored projects separate

export function discoverProjects(rootDir: string): Result<DiscoveryResult> {
  const resolved = path.resolve(rootDir);

  // Verify rootDir exists and is a directory
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Root directory is not a directory: ${resolved}`,
        details: { path: resolved },
      });
    }
  } catch {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Root directory does not exist: ${resolved}`,
      details: { path: resolved },
    });
  }

  const projects: DiscoveredProject[] = [];
  const ignored: DiscoveredProject[] = [];
  const warnings: string[] = [];

  // Collect candidate directories: rootDir itself + immediate children
  const candidates: string[] = [resolved];

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(resolved, entry.name));
      }
    }
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Cannot read root directory: ${resolved}`,
      details: {
        path: resolved,
        cause: e instanceof Error ? e.message : String(e),
      },
    });
  }

  for (const candidatePath of candidates) {
    // Filter: exclude paths containing /artifacts/ segment
    if (
      candidatePath.includes(`${path.sep}artifacts${path.sep}`) ||
      candidatePath.endsWith(`${path.sep}artifacts`)
    ) {
      continue;
    }

    const markerPath = path.join(candidatePath, ".rauf.json");

    // Check if .rauf.json exists
    try {
      fs.accessSync(markerPath, fs.constants.F_OK);
    } catch {
      // No rauf marker — but surface legacy ralph installs so the user
      // knows to migrate them (instead of silently treating as absent).
      const legacy = detectMigrationState(candidatePath);
      if (legacy.ok && (legacy.value === "legacy_ralph" || legacy.value === "partial")) {
        warnings.push(
          `Legacy ralph project at ${candidatePath} — run 'rauf migrate ${candidatePath}' to migrate it.`,
        );
      }
      continue; // No rauf marker, skip
    }

    // Parse and validate .rauf.json
    const markerResult = readJsonFile(markerPath, MarkerFileSchema);
    if (!markerResult.ok) {
      warnings.push(
        `Skipping ${candidatePath}: invalid .rauf.json — ${markerResult.error.message}`,
      );
      continue;
    }

    const dirName = path.basename(candidatePath);
    const project: DiscoveredProject = {
      id: dirName,
      path: candidatePath,
      name: dirName,
      marker: markerResult.value,
    };

    // Separate ignored vs active
    if (markerResult.value.options.ignoreInTool) {
      ignored.push(project);
    } else {
      projects.push(project);
    }
  }

  // Sort both lists by name (case-insensitive)
  const sortByName = (a: DiscoveredProject, b: DiscoveredProject) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase());

  projects.sort(sortByName);
  ignored.sort(sortByName);

  return ok({ projects, ignored, warnings });
}
