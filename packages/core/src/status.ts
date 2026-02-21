import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile, fileExists } from "./fs-utils.js";
import { readBacklog } from "./backlog.js";
import {
  LoopStateSchema,
  LOG_PATTERNS,
  type LoopState,
  type LoopStateEnum,
  type DerivedStatus,
  type BacklogSummary,
} from "./schemas.js";

// ─── Constants ───────────────────────────────────────────────────

const RALPH_DIR = ".ralph";
const STATE_FILENAME = "state.json";
const LOG_FILENAME = "ralph.log";
const DONE_FILENAME = "DONE";

/** Staleness threshold in milliseconds (5 minutes) */
const STALENESS_THRESHOLD_MS = 5 * 60 * 1000;

/** Log mtime threshold for "active" detection in milliseconds (60 seconds) */
const LOG_ACTIVE_THRESHOLD_MS = 60 * 1000;

/** Maximum lines to read for log tail display */
const MAX_LOG_TAIL_LINES = 10_000;

/** Lines to scan from end for fallback status patterns */
const LOG_SCAN_TAIL_LINES = 1000;

// ─── Path helpers ────────────────────────────────────────────────

function getStatePath(projectPath: string): string {
  return path.join(path.resolve(projectPath), RALPH_DIR, STATE_FILENAME);
}

function getLogPath(projectPath: string): string {
  return path.join(path.resolve(projectPath), RALPH_DIR, LOG_FILENAME);
}

function getDonePath(projectPath: string): string {
  return path.join(path.resolve(projectPath), RALPH_DIR, DONE_FILENAME);
}

// ─── BacklogSummary ──────────────────────────────────────────────

function computeBacklogSummary(projectPath: string): BacklogSummary {
  const backlogResult = readBacklog(projectPath);
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
    starting: "RUNNING",
    running: "RUNNING",
    paused: "PAUSED",
    complete: "COMPLETE",
    paused_human: "PAUSED_HUMAN",
    limit_reached: "LIMIT_REACHED",
    error: "ERROR",
  };
  return mapping[status];
}

function deriveFromStateJson(projectPath: string): Result<DerivedStatus | null> {
  const statePath = getStatePath(projectPath);
  const stateResult = readJsonFile(statePath, LoopStateSchema);

  if (!stateResult.ok) {
    // state.json missing or invalid — signal to fall through to Tier 2
    return ok(null);
  }

  const state = stateResult.value;
  let loopState = mapLoopStateStatus(state.status);

  // Staleness check: running >5min old → PAUSED
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
    backlogSummary: computeBacklogSummary(projectPath),
  });
}

// ─── Tier 2: Log parsing fallback ───────────────────────────────

function deriveFromLogParsing(projectPath: string): DerivedStatus {
  const logPath = getLogPath(projectPath);
  const donePath = getDonePath(projectPath);
  const summary = computeBacklogSummary(projectPath);

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

function computeElapsed(startedAt: string): number | null {
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

export function deriveStatus(projectPath: string): Result<DerivedStatus> {
  const resolved = path.resolve(projectPath);

  // Check if project has ralph installed
  const ralphDir = path.join(resolved, RALPH_DIR);
  if (!fileExists(ralphDir)) {
    return ok({
      loopState: "NOT_INSTALLED",
      stateSource: "none",
      iteration: null,
      maxIterations: null,
      currentItem: null,
      lastSignal: null,
      startedAt: null,
      elapsed: null,
      backlogSummary: { pending: 0, inProgress: 0, blocked: 0, done: 0, total: 0 },
    });
  }

  // Tier 1: Try state.json
  const tier1Result = deriveFromStateJson(projectPath);
  if (!tier1Result.ok) return tier1Result;

  if (tier1Result.value !== null) {
    return ok(tier1Result.value);
  }

  // Tier 2: Fall back to log parsing
  return ok(deriveFromLogParsing(projectPath));
}

// ─── readLogTail ────────────────────────────────────────────────
//
// Read last N lines of ralph.log. Cap at MAX_LOG_TAIL_LINES.

export function readLogTail(projectPath: string, lines: number = 50): Result<string[]> {
  const logPath = getLogPath(projectPath);
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
// Watch ralph.log for changes using fs.watch. Calls callback with
// new lines as they appear. Returns cleanup function to stop watching.

export function watchLog(projectPath: string, callback: (lines: string[]) => void): () => void {
  const logPath = getLogPath(projectPath);
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

// ─── Exported constants (for testing) ────────────────────────────

export { RALPH_DIR, LOG_FILENAME, DONE_FILENAME, STALENESS_THRESHOLD_MS, LOG_ACTIVE_THRESHOLD_MS };
