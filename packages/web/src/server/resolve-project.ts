// ─── Project Path Resolution ────────────────────────────────────
//
// Shared helper for resolving a project ID (URL param) to a filesystem path.
// Handles the self-hosting case where the project IS the root directory.

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolve a project ID (from URL `:id` param) to an absolute path.
 *
 * Normal case: `rootDirectory/id`
 * Self-hosting case: if `id` matches `basename(rootDirectory)` and
 * the child path doesn't exist, falls back to `rootDirectory` itself.
 *
 * Returns null if the ID contains path traversal characters.
 */
export function resolveProjectPath(id: string, rootDirectory: string): string | null {
  const decoded = decodeURIComponent(id);

  // Reject traversal attempts — the id must be a plain directory name
  if (decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") {
    return null;
  }

  const childPath = path.join(rootDirectory, decoded);

  // Normal case: project is a subdirectory of root
  try {
    if (fs.statSync(childPath).isDirectory()) {
      return childPath;
    }
  } catch {
    // Child path doesn't exist — fall through
  }

  // Self-hosting case: project IS the root directory
  if (decoded === path.basename(rootDirectory)) {
    return rootDirectory;
  }

  // Default: return child path (downstream validation will catch missing dirs)
  return childPath;
}
