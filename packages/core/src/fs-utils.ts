import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { z } from "zod";

import { type Result, ok, err, ErrorCodes } from "./errors.js";

// ─── atomicWrite ──────────────────────────────────────────────────
//
// Write content atomically: write to .tmp then rename.
// For backlog.json files, also create a .bak backup first.

export function atomicWrite(filePath: string, content: string): Result<void> {
  const resolved = path.resolve(filePath);
  const tmpPath = `${resolved}.tmp`;

  try {
    // Create .bak backup for backlog.json files
    const basename = path.basename(resolved);
    if (basename === "backlog.json" && fs.existsSync(resolved)) {
      fs.copyFileSync(resolved, `${resolved}.bak`);
    }

    // Write to .tmp first, then rename for atomicity
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, resolved);

    return ok(undefined);
  } catch (e) {
    // Clean up .tmp if it was left behind
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }

    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to write ${resolved}: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: resolved },
    });
  }
}

// ─── readJsonFile ─────────────────────────────────────────────────
//
// Read a JSON file and validate against a Zod schema.
// Returns structured errors for missing file, bad JSON, and validation failures.

export function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): Result<T> {
  const resolved = path.resolve(filePath);

  // Read file
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `File not found: ${resolved}`,
      details: {
        path: resolved,
        cause: e instanceof Error ? e.message : String(e),
      },
    });
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return err({
      code: ErrorCodes.INVALID_JSON,
      message: `Invalid JSON in ${resolved}: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: resolved },
    });
  }

  // Validate against schema
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Validation failed for ${resolved}`,
      details: {
        path: resolved,
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
  }

  return ok(result.data);
}

// ─── computeHash ──────────────────────────────────────────────────
//
// SHA-256 hex digest of a file's contents.

export function computeHash(filePath: string): Result<string> {
  const resolved = path.resolve(filePath);

  try {
    const content = fs.readFileSync(resolved);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return ok(hash);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Cannot hash file: ${resolved}`,
      details: {
        path: resolved,
        cause: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

// ─── validatePath ─────────────────────────────────────────────────
//
// Verify that a target path resolves to a location within at least
// one of the allowed roots. Prevents directory traversal attacks.

export function validatePath(targetPath: string, allowedRoots: string[]): Result<string> {
  const resolved = path.resolve(targetPath);

  const isWithinRoot = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    // Must start with the root + separator, or be the root itself
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });

  if (!isWithinRoot) {
    return err({
      code: ErrorCodes.PATH_VIOLATION,
      message: `Path "${resolved}" is outside allowed roots`,
      details: {
        resolved,
        allowedRoots: allowedRoots.map((r) => path.resolve(r)),
      },
    });
  }

  return ok(resolved);
}

// ─── fileExists ───────────────────────────────────────────────────
//
// Non-throwing file existence check.

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(path.resolve(filePath), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ─── ensureDir ────────────────────────────────────────────────────
//
// Create a directory and all parent directories (mkdir -p equivalent).

export function ensureDir(dirPath: string): Result<void> {
  const resolved = path.resolve(dirPath);

  try {
    fs.mkdirSync(resolved, { recursive: true });
    return ok(undefined);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to create directory: ${resolved}`,
      details: {
        path: resolved,
        cause: e instanceof Error ? e.message : String(e),
      },
    });
  }
}
