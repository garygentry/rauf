import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile, fileExists, atomicWrite } from "./fs-utils.js";
import { readBacklog } from "./backlog.js";
import { type BacklogPaths, SCAN_SKIP_DIRS } from "./backlog-root.js";
import {
  LoopStateSchema,
  LOG_PATTERNS,
  type LoopState,
  type LoopStateEnum,
  type DerivedStatus,
  type BacklogSummary,
} from "./schemas.js";

// ─── Constants ───────────────────────────────────────────────────

/** Staleness threshold in milliseconds (5 minutes) */
const STALENESS_THRESHOLD_MS = 5 * 60 * 1000;

/** Log mtime threshold for "active" detection in milliseconds (60 seconds) */
const LOG_ACTIVE_THRESHOLD_MS = 60 * 1000;

/** Maximum lines to read for log tail display */
const MAX_LOG_TAIL_LINES = 10_000;

/** Lines to scan from end for fallback status patterns */
const LOG_SCAN_TAIL_LINES = 1000;

// ─── Types ──────────────────────────────────────────────────────

/**
 * A backlog root discovered to have an active (non-idle) loop.
 * Returned by `scanActiveRoots()` for the status display.
 */
export interface ActiveRoot {
  /** Relative path from project root to the backlog root directory */
  relativePath: string;
  /** Current loop status (from state.json or lock file presence) */
  loopState: LoopStateEnum;
  /** ID of the backlog item currently being worked on, if any */
  currentItem: string | null;
}

// ─── BacklogSummary ──────────────────────────────────────────────

function computeBacklogSummary(paths: BacklogPaths): BacklogSummary {
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) {
    return { pending: 0, inProgress: 0, blocked: 0, done: 0, total: 0 };
  }

  const items = backlogResult.value.items;
  return {
    pending: items.filter((i) => i.status === "pending").length,
    inProgress: items.filter((i) => i.status === "in_progress").length,
    blocked: items.filter((i) => i.status === "blocked").length,
    done: items.filter((i) => i.status === "done").length,
    total: items.length,
  };
}

// ─── Tier 1: state.json ─────────────────────────────────────────

/** Map LoopState.status → LoopStateEnum */
function mapLoopStateStatus(status: LoopState["status"]): LoopStateEnum {
  const mapping: Record<LoopState["status"], LoopStateEnum> = {
    idle: "IDLE",
    starting: "RUNNING",
    running: "RUNNING",
    paused: "PAUSED",
    complete: "COMPLETE",
    paused_human: "PAUSED_HUMAN",
    limit_reached: "LIMIT_REACHED",
    error: "ERROR",
    sleeping_limit: "SLEEPING_LIMIT",
    weekly_limit: "WEEKLY_LIMIT",
    reviewing: "RUNNING",
  };
  return mapping[status];
}

function deriveFromStateJson(paths: BacklogPaths): Result<DerivedStatus | null> {
  const stateResult = readJsonFile(paths.state, LoopStateSchema);

  if (!stateResult.ok) {
    // state.json missing or invalid — signal to fall through to Tier 2
    return ok(null);
  }

  const state = stateResult.value;
  let loopState = mapLoopStateStatus(state.status);

  // Staleness check: running >5min old → PAUSED
  // sleeping_limit and weekly_limit are intentionally long-lived — never downgrade them
  if ((state.status === "running" || state.status === "starting") && state.updatedAt) {
    const updatedAt = new Date(state.updatedAt).getTime();
    const now = Date.now();
    if (now - updatedAt > STALENESS_THRESHOLD_MS) {
      loopState = "PAUSED";
    }
  }

  const elapsed = computeElapsed(state.startedAt);

  return ok({
    loopState,
    stateSource: "state.json" as const,
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    currentItem: state.currentItem,
    lastSignal: state.lastSignal,
    startedAt: state.startedAt,
    elapsed,
    backlogSummary: computeBacklogSummary(paths),
    sleepUntil: state.sleepUntil ?? null,
  });
}

// ─── Tier 2: Log parsing fallback ───────────────────────────────

function deriveFromLogParsing(paths: BacklogPaths): DerivedStatus {
  const logPath = paths.log;
  const donePath = paths.done;
  const summary = computeBacklogSummary(paths);

  const base: DerivedStatus = {
    loopState: "IDLE",
    stateSource: "log-parsing",
    iteration: null,
    maxIterations: null,
    currentItem: null,
    lastSignal: null,
    startedAt: null,
    elapsed: null,
    backlogSummary: summary,
  };

  // Check if log file exists
  if (!fileExists(logPath)) {
    // No log at all — IDLE
    return { ...base, stateSource: "none" };
  }

  // Check DONE file first — indicates completed/paused run
  if (fileExists(donePath)) {
    let doneContent = "";
    try {
      doneContent = fs.readFileSync(donePath, "utf-8").trim();
    } catch {
      // Unreadable DONE file — treat as COMPLETE
    }

    const doneState = parseDoneFileState(doneContent);
    return {
      ...base,
      loopState: doneState,
      ...parseLogForDetails(logPath),
    };
  }

  // Check log mtime for activity
  try {
    const stat = fs.statSync(logPath);
    const mtimeAge = Date.now() - stat.mtimeMs;

    if (mtimeAge < LOG_ACTIVE_THRESHOLD_MS) {
      // Log was recently written — likely RUNNING
      return {
        ...base,
        loopState: "RUNNING",
        ...parseLogForDetails(logPath),
      };
    }
  } catch {
    // Can't stat log — IDLE
    return { ...base, stateSource: "none" };
  }

  // Log exists but is stale, no DONE file — likely crashed → PAUSED
  return {
    ...base,
    loopState: "PAUSED",
    ...parseLogForDetails(logPath),
  };
}

/** Parse DONE file content to determine terminal state */
function parseDoneFileState(content: string): LoopStateEnum {
  if (!content) return "COMPLETE";

  const lower = content.toLowerCase();
  if (lower.includes("human") || lower.includes("needs_human")) return "PAUSED_HUMAN";
  if (lower.includes("limit")) return "LIMIT_REACHED";
  if (lower.includes("error")) return "ERROR";
  return "COMPLETE";
}

/** Parse log file tail for iteration/max/start details */
function parseLogForDetails(logPath: string): Partial<DerivedStatus> {
  const details: Partial<DerivedStatus> = {};

  let lines: string[];
  try {
    const content = fs.readFileSync(logPath, "utf-8");
    lines = content.split("\n");
  } catch {
    return details;
  }

  // Scan tail for iteration info
  const tail = lines.slice(-LOG_SCAN_TAIL_LINES);

  // Find the last iteration marker
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i]!;
    const iterMatch = LOG_PATTERNS.iteration.exec(line);
    if (iterMatch) {
      details.iteration = parseInt(iterMatch[1]!, 10);
      details.maxIterations = parseInt(iterMatch[2]!, 10);
      break;
    }
  }

  // Find loop start for startedAt and maxIterations
  const head = lines.slice(0, 100);
  for (const line of head) {
    const startMatch = LOG_PATTERNS.loopStart.exec(line);
    if (startMatch) {
      details.maxIterations = details.maxIterations ?? parseInt(startMatch[1]!, 10);

      // Try to extract timestamp from same or preceding line
      const tsMatch = LOG_PATTERNS.timestamp.exec(line);
      if (tsMatch) {
        details.startedAt = tsMatch[1]!;
        details.elapsed = computeElapsed(tsMatch[1]!);
      }
      break;
    }
  }

  // Scan tail for last signal
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i]!;
    if (LOG_PATTERNS.done.test(line)) {
      details.lastSignal = "clean";
      break;
    }
    if (LOG_PATTERNS.blocked.test(line)) {
      details.lastSignal = "blocked";
      break;
    }
    if (LOG_PATTERNS.needsHuman.test(line)) {
      details.lastSignal = "needs_human";
      break;
    }
  }

  return details;
}

// ─── Shared helpers ─────────────────────────────────────────────

function computeElapsed(startedAt: string | null): number | null {
  if (startedAt === null) return null;
  try {
    const start = new Date(startedAt).getTime();
    if (isNaN(start)) return null;
    return Math.floor((Date.now() - start) / 1000);
  } catch {
    return null;
  }
}

// ─── deriveStatus ───────────────────────────────────────────────
//
// Two-tier status derivation:
//   1. state.json (authoritative when available)
//   2. Log parsing fallback (heuristic)
// Always reads backlog for summary counts.

export function deriveStatus(paths: BacklogPaths): Result<DerivedStatus> {
  // Tier 1: Try state.json
  const tier1Result = deriveFromStateJson(paths);
  if (!tier1Result.ok) return tier1Result;

  if (tier1Result.value !== null) {
    return ok(tier1Result.value);
  }

  // Tier 2: Fall back to log parsing
  return ok(deriveFromLogParsing(paths));
}

// ─── readLogTail ────────────────────────────────────────────────
//
// Read last N lines of rauf.log. Cap at MAX_LOG_TAIL_LINES.

export function readLogTail(paths: BacklogPaths, lines: number = 50): Result<string[]> {
  const logPath = paths.log;
  const cappedLines = Math.min(Math.max(lines, 1), MAX_LOG_TAIL_LINES);

  if (!fileExists(logPath)) {
    return ok([]);
  }

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const allLines = content.split("\n");

    // Remove trailing empty line from final newline
    if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
      allLines.pop();
    }

    return ok(allLines.slice(-cappedLines));
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to read log: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: logPath },
    });
  }
}

// ─── watchLog ───────────────────────────────────────────────────
//
// Watch rauf.log for changes using fs.watch. Calls callback with
// new lines as they appear. Returns cleanup function to stop watching.

export function watchLog(paths: BacklogPaths, callback: (lines: string[]) => void): () => void {
  const logPath = paths.log;
  let lastSize = 0;

  // Initialize size from current file
  try {
    const stat = fs.statSync(logPath);
    lastSize = stat.size;
  } catch {
    // File doesn't exist yet — will start watching from 0
  }

  const watcher = fs.watch(logPath, { persistent: false }, (eventType) => {
    if (eventType !== "change") return;

    try {
      const stat = fs.statSync(logPath);
      if (stat.size <= lastSize) {
        // File was truncated or unchanged
        lastSize = stat.size;
        return;
      }

      // Read only the new bytes
      const fd = fs.openSync(logPath, "r");
      const buffer = Buffer.alloc(stat.size - lastSize);
      fs.readSync(fd, buffer, 0, buffer.length, lastSize);
      fs.closeSync(fd);

      lastSize = stat.size;

      const newContent = buffer.toString("utf-8");
      const newLines = newContent.split("\n").filter((l) => l.length > 0);

      if (newLines.length > 0) {
        callback(newLines);
      }
    } catch {
      // File may have been deleted or is being written — ignore
    }
  });

  return () => {
    watcher.close();
  };
}

// ─── writeLoopState ──────────────────────────────────────────────
//
// Atomic write of state.json with LoopStateSchema validation.
// Auto-sets updatedAt to current ISO timestamp before writing.

export function writeLoopState(
  paths: BacklogPaths,
  state: Omit<LoopState, "updatedAt"> & { updatedAt?: string },
): Result<void> {
  const stateWithTimestamp: LoopState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  // Validate against schema before writing
  const validation = LoopStateSchema.safeParse(stateWithTimestamp);
  if (!validation.success) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Invalid loop state",
      details: {
        issues: validation.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
  }

  return atomicWrite(paths.state, JSON.stringify(validation.data, null, 2) + "\n");
}

// ─── appendLog ───────────────────────────────────────────────────
//
// Append a timestamped line to rauf.log.
// Format: [YYYY-MM-DD HH:MM:SS] message\n

export function appendLog(paths: BacklogPaths, message: string): Result<void> {
  const logPath = paths.log;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const timestamp = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  const line = `[${timestamp}] ${message}\n`;

  try {
    fs.appendFileSync(logPath, line, "utf-8");
    return ok(undefined);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to append to log: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: logPath },
    });
  }
}

// ─── writeDoneFile ───────────────────────────────────────────────
//
// Write content string to DONE marker file.

export function writeDoneFile(paths: BacklogPaths, content: string): Result<void> {
  const donePath = paths.done;

  try {
    fs.writeFileSync(donePath, content, "utf-8");
    return ok(undefined);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to write DONE file: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: donePath },
    });
  }
}

// ─── clearDoneFile ───────────────────────────────────────────────
//
// Remove DONE file. Returns ok even if file doesn't exist.

export function clearDoneFile(paths: BacklogPaths): Result<void> {
  const donePath = paths.done;

  try {
    fs.unlinkSync(donePath);
  } catch (e) {
    // ENOENT is fine — file didn't exist
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code !== "ENOENT") {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Failed to clear DONE file: ${e.message}`,
        details: { path: donePath },
      });
    }
  }

  return ok(undefined);
}

// ─── checkCancelRequested ────────────────────────────────────────
//
// Check if CANCEL file exists. Returns boolean directly
// (not wrapped in Result).

export function checkCancelRequested(paths: BacklogPaths): boolean {
  return fileExists(paths.cancel);
}

// ─── clearCancelFile ─────────────────────────────────────────────
//
// Remove CANCEL file. Returns whether the file existed.

export function clearCancelFile(paths: BacklogPaths): Result<boolean> {
  const cancelPath = paths.cancel;

  try {
    fs.unlinkSync(cancelPath);
    return ok(true);
  } catch (e) {
    // ENOENT means file didn't exist — return false (not an error)
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      return ok(false);
    }
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to clear CANCEL file: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: cancelPath },
    });
  }
}

// ─── scanActiveRoots ─────────────────────────────────────────────
//
// Scan the project for backlog roots with active (non-idle) loops.

function walkForStateFiles(dir: string, projectPath: string, results: ActiveRoot[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or deleted — skip
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    if ((SCAN_SKIP_DIRS as readonly string[]).includes(name)) continue;

    const fullPath = path.join(dir, name);

    if (name === ".rauf") {
      // Check for state.json in this .rauf dir
      const statePath = path.join(fullPath, "state.json");
      try {
        const raw = fs.readFileSync(statePath, "utf-8");
        const parsed = LoopStateSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.status !== "idle") {
          // Determine backlog root: if parent has backlog.json, root is parent; else root is .rauf dir
          const parentDir = dir;
          const parentHasBacklog = fileExists(path.join(parentDir, "backlog.json"));
          const backlogRoot = parentHasBacklog ? parentDir : fullPath;
          results.push({
            relativePath: path.relative(projectPath, backlogRoot),
            loopState: mapLoopStateStatus(parsed.data.status),
            currentItem: parsed.data.currentItem,
          });
        }
      } catch {
        // Missing or corrupt state.json — skip
      }

      // Check for .loop.lock without active state
      const lockPath = path.join(fullPath, ".loop.lock");
      if (fileExists(lockPath)) {
        const parentDir = dir;
        const parentHasBacklog = fileExists(path.join(parentDir, "backlog.json"));
        const backlogRoot = parentHasBacklog ? parentDir : fullPath;
        const relPath = path.relative(projectPath, backlogRoot);
        // Only add if not already in results
        if (!results.some((r) => r.relativePath === relPath)) {
          results.push({
            relativePath: relPath,
            loopState: "RUNNING",
            currentItem: null,
          });
        }
      }

      // Don't recurse into .rauf dirs
      continue;
    }

    // Recurse into non-.rauf directories
    walkForStateFiles(fullPath, projectPath, results);
  }
}

/**
 * Scan the project for backlog roots with active (non-idle) loops.
 *
 * Walks the project directory looking for state.json files inside .rauf/
 * directories. For each found, reads the state and returns roots with
 * non-idle status. Also detects .loop.lock files as activity indicators.
 *
 * Skips: node_modules, .git, dist, build, coverage
 *
 * @param projectPath - Absolute path to the project root
 * @returns Array of active roots with their status
 */
export function scanActiveRoots(projectPath: string): Result<ActiveRoot[]> {
  const resolved = path.resolve(projectPath);
  const results: ActiveRoot[] = [];

  walkForStateFiles(resolved, resolved, results);

  // Sort by relativePath for deterministic output
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return ok(results);
}

// ─── Exported constants (for testing) ────────────────────────────

export { STALENESS_THRESHOLD_MS, LOG_ACTIVE_THRESHOLD_MS };
