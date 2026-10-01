/**
 * Durable task registry — a JSON mirror of the supervised task beside the
 * runner's own state, so a brand-new Pi session (whose session file has no
 * task entry) can rediscover a loop a previous session launched.
 *
 * The mirror lives at `<stateDir>/supervisors/pi.json` (rauf gitignores and
 * never commits `supervisors/`). Mirrors written by feature-forge's retired
 * forge-loop-supervisor (`<stateDir>/.forge-supervisor.json`) are read too, so
 * a loop launched before the move is still picked up. Liveness is judged from
 * the event stream and `rauf status --json`, never a pid.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { dirname, join } from "node:path";

import type { SupervisorTask } from "./types.js";

/** Mirror location relative to a state dir. */
export const MIRROR_REL = join("supervisors", "pi.json");
/** feature-forge's legacy mirror name (read-only compatibility). */
export const LEGACY_MIRROR_NAME = ".forge-supervisor.json";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "archive", ".pi", ".claude"]);
/** Mirrors live at `<backlogDir>/.rauf/…`; a shallow bound reaches `specs/<feature>/.rauf/`. */
const SCAN_MAX_DEPTH = 5;

export function mirrorPath(stateDir: string): string {
  return join(stateDir, MIRROR_REL);
}

function parseTask(text: string): SupervisorTask | null {
  try {
    const p = JSON.parse(text) as Partial<SupervisorTask>;
    if (!p || typeof p.stateDir !== "string" || typeof p.eventsFile !== "string") return null;
    return {
      projectPath: typeof p.projectPath === "string" ? p.projectPath : undefined,
      backlogDir: typeof p.backlogDir === "string" ? p.backlogDir : undefined,
      stateDir: p.stateDir,
      eventsFile: p.eventsFile,
      eventsIno: typeof p.eventsIno === "number" ? p.eventsIno : undefined,
      launchedAt: typeof p.launchedAt === "string" ? p.launchedAt : "",
      total: typeof p.total === "number" ? p.total : undefined,
      lastSeq: typeof p.lastSeq === "number" ? p.lastSeq : -1,
      closed: p.closed === true,
    };
  } catch {
    return null;
  }
}

/** The mirrored task for a state dir (current mirror first, then the legacy
 *  feature-forge one), or null. A corrupt mirror is "no task", never a throw. */
export function readMirror(stateDir: string): SupervisorTask | null {
  for (const file of [mirrorPath(stateDir), join(stateDir, LEGACY_MIRROR_NAME)]) {
    if (!existsSync(file)) continue;
    try {
      const task = parseTask(readFileSync(file, "utf8"));
      if (task) return task;
    } catch {
      /* unreadable → try the next */
    }
  }
  return null;
}

/** Persist the mirror atomically, stamping the events file's current inode. */
export function writeMirror(task: SupervisorTask): void {
  const file = mirrorPath(task.stateDir);
  try {
    let eventsIno = task.eventsIno;
    try {
      eventsIno = statSync(task.eventsFile).ino;
    } catch {
      /* events file not there yet */
    }
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ ...task, eventsIno }, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch {
    /* best-effort: a failed mirror write must not break a tool */
  }
}

/** Remove the mirror (explicit stop). Leaves a legacy mirror alone. */
export function clearMirror(stateDir: string): void {
  try {
    rmSync(mirrorPath(stateDir), { force: true });
  } catch {
    /* best-effort */
  }
}

/** Every mirrored task under `root` (bounded scan; current or legacy mirror). */
export function discoverMirrors(root: string): SupervisorTask[] {
  const found: SupervisorTask[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > SCAN_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const sub = join(dir, e.name);
      if (e.name === ".rauf") {
        const task = readMirror(sub);
        if (task) found.push(task);
      } else {
        walk(sub, depth + 1);
      }
    }
  };
  walk(root, 0);
  return found;
}
