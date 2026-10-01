// ─── Supervisor Markers ──────────────────────────────────────────
//
// A small per-session file that says "this agent session is supervising this
// loop" (#156). `rauf loop wait` (and a detached `loop run`) write it when the
// calling session is identifiable, and a host's stop hook reads it: a Codex
// Stop hook blocks the session from ending its turn while a loop it supervises
// is still running (`rauf hook codex-stop`).
//
// Markers live in `<stateDir>/supervisors/<id>.json`. The whole `supervisors/`
// directory is runtime state: it is gitignored by `rauf install` and excluded
// from the runner's per-item commits.

import * as fs from "node:fs";
import * as path from "node:path";

import type { BacklogPaths } from "./backlog-root.js";
import { atomicWrite, ensureDir } from "./fs-utils.js";

/** Subdirectory of a state dir that holds supervisor state. */
export const SUPERVISORS_DIRNAME = "supervisors";

/** One supervising session's marker for one loop. */
export interface SupervisorMarker {
  /** The supervising session's id (Codex `session_id` / `$CODEX_THREAD_ID`). */
  sessionId: string;
  /** Project root passed to rauf (contains `.rauf.json`). */
  projectPath: string;
  /** The backlog root (`--backlog`), absolute. */
  backlogRoot: string;
  /** The loop's state directory, absolute. */
  stateDir: string;
  /** Cursor for the next `loop wait` (`--since-seq`). */
  nextSeq: number;
  /** Run id for the next `loop wait` (`--run-id`), or null before the run's first event. */
  runId: string | null;
  /** ISO time the marker was last written by `loop wait` / `loop run --detached`. */
  updatedAt: string;
  /** Stop-hook blocks since the last `loop wait` call — the runaway guard. */
  blocksSinceWait: number;
}

/**
 * The supervising session's id, from the environment: `RAUF_SUPERVISOR_ID`
 * (any host may set it) or `CODEX_THREAD_ID` (set by Codex in every shell
 * command it runs, equal to the Stop hook's `session_id`). Null when neither is
 * set — then no marker is written.
 */
export function supervisorIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env.RAUF_SUPERVISOR_ID || env.CODEX_THREAD_ID;
  return id && id.trim() !== "" ? id.trim() : null;
}

/** Filesystem-safe form of a session id. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/** Path of a session's marker in a state dir. */
export function supervisorMarkerPath(stateDir: string, sessionId: string): string {
  return path.join(stateDir, SUPERVISORS_DIRNAME, `${safeId(sessionId)}.json`);
}

/** Read a marker file; null when absent, unreadable or malformed (never throws). */
export function readSupervisorMarker(file: string): SupervisorMarker | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<SupervisorMarker>;
    if (
      typeof raw.sessionId !== "string" ||
      typeof raw.projectPath !== "string" ||
      typeof raw.backlogRoot !== "string" ||
      typeof raw.stateDir !== "string"
    ) {
      return null;
    }
    return {
      sessionId: raw.sessionId,
      projectPath: raw.projectPath,
      backlogRoot: raw.backlogRoot,
      stateDir: raw.stateDir,
      nextSeq: typeof raw.nextSeq === "number" ? raw.nextSeq : 0,
      runId: typeof raw.runId === "string" ? raw.runId : null,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
      blocksSinceWait: typeof raw.blocksSinceWait === "number" ? raw.blocksSinceWait : 0,
    };
  } catch {
    return null;
  }
}

/** Write (replace) a marker atomically. Best-effort: returns false on any failure. */
export function writeSupervisorMarker(marker: SupervisorMarker): boolean {
  const file = supervisorMarkerPath(marker.stateDir, marker.sessionId);
  if (!ensureDir(path.dirname(file)).ok) return false;
  return atomicWrite(file, JSON.stringify(marker, null, 2) + "\n").ok;
}

/**
 * Record that `sessionId` is supervising the loop at `paths`, with the cursor
 * its next `loop wait` should use. Resets the stop-hook runaway counter.
 */
export function recordSupervision(
  paths: BacklogPaths,
  sessionId: string,
  cursor: { nextSeq: number; runId: string | null },
  now: Date = new Date(),
): boolean {
  return writeSupervisorMarker({
    sessionId,
    projectPath: path.resolve(paths.projectPath),
    backlogRoot: path.resolve(paths.root),
    stateDir: path.resolve(paths.stateDir),
    nextSeq: cursor.nextSeq,
    runId: cursor.runId,
    updatedAt: now.toISOString(),
    blocksSinceWait: 0,
  });
}

/** Remove a session's marker (the loop ended). Best-effort. */
export function clearSupervisorMarker(stateDir: string, sessionId: string): void {
  try {
    fs.rmSync(supervisorMarkerPath(stateDir, sessionId), { force: true });
  } catch {
    /* best-effort */
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "archive", ".next"]);
const SCAN_MAX_DEPTH = 6;

/**
 * Every marker for `sessionId` under `root` (bounded scan: skips heavy
 * directories, caps depth, tolerates unreadable dirs). Markers live at
 * `<…>/.rauf/supervisors/<id>.json`, so only `.rauf` dirs are looked into.
 */
export function findSupervisorMarkers(root: string, sessionId: string): SupervisorMarker[] {
  const name = `${safeId(sessionId)}.json`;
  const found: SupervisorMarker[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > SCAN_MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const sub = path.join(dir, e.name);
      if (e.name === ".rauf") {
        const marker = readSupervisorMarker(path.join(sub, SUPERVISORS_DIRNAME, name));
        if (marker && marker.sessionId === sessionId) found.push(marker);
      } else {
        walk(sub, depth + 1);
      }
    }
  };
  // The root itself may be a project whose .rauf/ is a direct child.
  walk(path.resolve(root), 0);
  return found;
}
