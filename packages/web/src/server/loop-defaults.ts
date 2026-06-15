// ─── Loop default options ────────────────────────────────────────
//
// Single source of truth for the web loop-route defaults and the
// request maxIterations resolution. Hoisted out of routes/loop.ts so
// the recovery routes (resume relaunch) can reuse the same constants
// and helper without duplicating the default values.

import {
  readMarkerFile,
  resolveBacklogRoot,
  resolveBacklogPaths,
  readBacklog,
  resolveMaxIterations,
} from "@rauf/core";

export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;

/**
 * Resolve maxIterations by the same precedence as the CLI:
 * request body (flag) > `.rauf.json` options.maxIterations > computed-from-backlog.
 * Falls back to the flat default when nothing resolves. No logging (server-side).
 */
export function resolveRequestMaxIterations(
  projectPath: string,
  flag: number | null,
  backlogRoot?: string,
): number {
  const markerResult = readMarkerFile(projectPath);
  const markerMaxIterations = markerResult.ok ? markerResult.value.options.maxIterations : null;

  let backlog = null;
  const rootResult = resolveBacklogRoot(projectPath, backlogRoot);
  if (rootResult.ok) {
    const pathsResult = resolveBacklogPaths(projectPath, rootResult.value);
    if (pathsResult.ok) {
      const backlogResult = readBacklog(pathsResult.value);
      if (backlogResult.ok) backlog = backlogResult.value;
    }
  }

  return resolveMaxIterations({
    flag,
    markerMaxIterations,
    backlog,
    fallback: DEFAULT_MAX_ITERATIONS,
  }).value;
}
