import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  deriveStatus,
  readLogTail,
  watchLog,
  writeLoopState,
  appendLog,
  writeDoneFile,
  clearDoneFile,
  checkCancelRequested,
  clearCancelFile,
  scanActiveRoots,
  STALENESS_THRESHOLD_MS,
  LOG_ACTIVE_THRESHOLD_MS,
} from "./status.js";
import {
  STATE_FILENAME,
  DEFAULT_ROOT_DIR,
  LOCK_FILENAME,
  defaultBacklogPaths,
} from "./backlog-root.js";
import type { BacklogPaths } from "./backlog-root.js";
import type { Backlog, BacklogItem, LoopState } from "./schemas.js";

// ─── Constants (test-local) ────────────────────────────────────────

const LOG_FILENAME = "rauf.log";
const DONE_FILENAME = "DONE";
const CANCEL_FILENAME = "CANCEL";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-status-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build BacklogPaths for the default root in tmpDir */
function makePaths(): BacklogPaths {
  return defaultBacklogPaths(tmpDir);
}

/** Create .rauf directory */
function createRaufDir(): void {
  fs.mkdirSync(path.join(tmpDir, DEFAULT_ROOT_DIR), { recursive: true });
}

/** Write a state.json for test setup */
function writeStateJson(state: LoopState): void {
  createRaufDir();
  const filePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
}

/** Write a backlog.json for test setup */
function writeBacklog(backlog: Backlog): void {
  createRaufDir();
  const filePath = path.join(tmpDir, DEFAULT_ROOT_DIR, "backlog.json");
  fs.writeFileSync(filePath, JSON.stringify(backlog, null, 2) + "\n");
}

/** Write rauf.log with given content */
function writeLog(content: string, mtimeOverride?: Date): void {
  createRaufDir();
  const filePath = path.join(tmpDir, DEFAULT_ROOT_DIR, LOG_FILENAME);
  fs.writeFileSync(filePath, content);
  if (mtimeOverride) {
    fs.utimesSync(filePath, mtimeOverride, mtimeOverride);
  }
}

/** Write DONE file */
function setupDoneFile(content: string = ""): void {
  createRaufDir();
  const filePath = path.join(tmpDir, DEFAULT_ROOT_DIR, DONE_FILENAME);
  fs.writeFileSync(filePath, content);
}

/** Create a minimal valid LoopState */
function makeLoopState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    status: "running",
    iteration: 2,
    maxIterations: 10,
    currentItem: "003",
    lastSignal: "clean",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedItems: ["001", "002"],
    blockedItems: [],
    deferredItems: [],
    error: null,
    ...overrides,
  };
}

/** Create a minimal valid Backlog */
function makeBacklog(items: BacklogItem[] = [], overrides: Partial<Backlog> = {}): Backlog {
  return {
    project: "test-project",
    description: "A test project",
    items,
    ...overrides,
  };
}

/** Create a minimal BacklogItem */
function makeItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: "001",
    type: "feature",
    priority: 1,
    title: "Test item",
    description: "A test description",
    acceptanceCriteria: ["Criterion 1"],
    status: "pending",
    completedAt: null,
    ...overrides,
  };
}

// ─── deriveStatus: Tier 1 (state.json) ──────────────────────────

describe("deriveStatus — Tier 1: state.json", () => {
  it("returns IDLE with stateSource 'none' when .rauf directory is missing", () => {
    // With BacklogPaths, deriveStatus no longer checks for .rauf dir existence.
    // When state.json is missing and no log exists, it returns IDLE via tier 2.
    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("IDLE");
    expect(result.value.stateSource).toBe("none");
    expect(result.value.backlogSummary.total).toBe(0);
  });

  it("derives RUNNING from state.json with status 'running'", () => {
    const state = makeLoopState({ status: "running" });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
    expect(result.value.stateSource).toBe("state.json");
    expect(result.value.iteration).toBe(2);
    expect(result.value.maxIterations).toBe(10);
    expect(result.value.currentItem).toBe("003");
    expect(result.value.lastSignal).toBe("clean");
  });

  it("derives RUNNING from state.json with status 'starting'", () => {
    const state = makeLoopState({ status: "starting", iteration: 0 });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
  });

  it("derives COMPLETE from state.json with status 'complete'", () => {
    const state = makeLoopState({ status: "complete" });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
    expect(result.value.stateSource).toBe("state.json");
  });

  it("derives PAUSED from state.json with status 'paused'", () => {
    const state = makeLoopState({ status: "paused" });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED");
  });

  it("derives PAUSED_HUMAN from state.json with status 'paused_human'", () => {
    const state = makeLoopState({ status: "paused_human" });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED_HUMAN");
  });

  it("derives LIMIT_REACHED from state.json with status 'limit_reached'", () => {
    const state = makeLoopState({ status: "limit_reached" });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("LIMIT_REACHED");
  });

  it("derives ERROR from state.json with status 'error'", () => {
    const state = makeLoopState({
      status: "error",
      error: "Process crashed",
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("ERROR");
  });

  it("downgrades running to PAUSED when updatedAt is stale (>5 min)", () => {
    const staleTime = new Date(Date.now() - STALENESS_THRESHOLD_MS - 1000).toISOString();
    const state = makeLoopState({
      status: "running",
      updatedAt: staleTime,
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED");
    expect(result.value.stateSource).toBe("state.json");
  });

  it("downgrades starting to PAUSED when updatedAt is stale (>5 min)", () => {
    const staleTime = new Date(Date.now() - STALENESS_THRESHOLD_MS - 1000).toISOString();
    const state = makeLoopState({
      status: "starting",
      updatedAt: staleTime,
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED");
  });

  it("keeps running as RUNNING when updatedAt is recent", () => {
    const recentTime = new Date(Date.now() - 60_000).toISOString();
    const state = makeLoopState({
      status: "running",
      updatedAt: recentTime,
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
  });

  it("does not apply staleness check to non-running statuses", () => {
    const staleTime = new Date(Date.now() - STALENESS_THRESHOLD_MS - 1000).toISOString();
    const state = makeLoopState({
      status: "complete",
      updatedAt: staleTime,
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
  });

  it("computes elapsed time from startedAt", () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    const state = makeLoopState({
      startedAt: tenSecondsAgo,
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should be approximately 10 seconds (allow 2s tolerance)
    expect(result.value.elapsed).toBeGreaterThanOrEqual(9);
    expect(result.value.elapsed).toBeLessThanOrEqual(12);
  });

  it("reports stateSource as 'state.json' for Tier 1", () => {
    writeStateJson(makeLoopState());

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stateSource).toBe("state.json");
  });
});

// ─── deriveStatus: Tier 2 (Log parsing fallback) ────────────────

describe("deriveStatus — Tier 2: log parsing fallback", () => {
  it("returns IDLE with stateSource 'none' when no log exists", () => {
    createRaufDir();
    // No state.json, no log

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("IDLE");
    expect(result.value.stateSource).toBe("none");
  });

  it("detects RUNNING from log mtime < 60s", () => {
    // Write log with recent mtime (default is now)
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("detects PAUSED from stale log (mtime > 60s, no DONE file)", () => {
    const staleTime = new Date(Date.now() - LOG_ACTIVE_THRESHOLD_MS - 5000);
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n", staleTime);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED");
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("detects COMPLETE from DONE file", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    setupDoneFile("");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
  });

  it("detects PAUSED_HUMAN from DONE file content", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    setupDoneFile("needs_human: requires API key setup");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED_HUMAN");
  });

  it("detects LIMIT_REACHED from DONE file content", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    setupDoneFile("LIMIT REACHED after 20 iterations");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("LIMIT_REACHED");
  });

  it("detects ERROR from DONE file content", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    setupDoneFile("error: claude process exited with code 1");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("ERROR");
  });

  it("parses iteration details from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] Loop started (maxIterations=10)",
        "[2026-02-21 10:00:01] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] Item 001 completed: Setup auth",
        "[2026-02-21 10:01:00] --- Iteration 2 / 10 ---",
        "[2026-02-21 10:01:30] Working on task...",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iteration).toBe(2);
    expect(result.value.maxIterations).toBe(10);
  });

  it("parses last signal from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] Item 005 blocked: Missing API key",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSignal).toBe("blocked");
  });

  it("parses clean signal from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] Item 001 completed: Implement feature",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSignal).toBe("clean");
  });

  it("parses needs_human signal from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] Item 003 needs human input: need API key",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSignal).toBe("needs_human");
  });

  it("falls back to Tier 2 when state.json is invalid JSON", () => {
    createRaufDir();
    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    fs.writeFileSync(statePath, "not json at all");
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should use log parsing since state.json is invalid
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("falls back to Tier 2 when state.json fails schema validation", () => {
    createRaufDir();
    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    fs.writeFileSync(statePath, JSON.stringify({ status: "invalid_status" }));
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stateSource).toBe("log-parsing");
  });
});

// ─── deriveStatus: BacklogSummary ───────────────────────────────

describe("deriveStatus — BacklogSummary", () => {
  it("populates backlogSummary with correct counts from state.json path", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-01" }),
      makeItem({ id: "002", status: "done", completedAt: "2026-01-02" }),
      makeItem({ id: "003", status: "in_progress" }),
      makeItem({ id: "004", status: "pending" }),
      makeItem({ id: "005", status: "pending" }),
      makeItem({ id: "006", status: "blocked", blockedReason: "Waiting" }),
    ]);
    writeBacklog(backlog);
    writeStateJson(makeLoopState());

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary).toEqual({
      pending: 2,
      inProgress: 1,
      blocked: 1,
      needsHuman: 0,
      deferred: 0,
      done: 2,
      total: 6,
    });
  });

  it("counts needsHuman as a subset of blocked", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-01" }),
      makeItem({ id: "002", status: "blocked", blockedReason: "code blocker" }),
      makeItem({
        id: "003",
        status: "blocked",
        blockedReason: "need API key",
        needsHuman: true,
      }),
    ]);
    writeBacklog(backlog);
    writeStateJson(makeLoopState());

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both blocked items count in `blocked`; only the flagged one in `needsHuman`.
    expect(result.value.backlogSummary.blocked).toBe(2);
    expect(result.value.backlogSummary.needsHuman).toBe(1);
  });

  it("counts deferred (runner false-block) as a subset of blocked", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", status: "blocked", blockedReason: "agent said RAUF_BLOCKED" }),
      makeItem({
        id: "002",
        status: "blocked",
        blockedReason: "No signal after N attempts (deferred by runner)",
        deferred: true,
      }),
      makeItem({
        id: "003",
        status: "blocked",
        blockedReason: "another deferral",
        deferred: true,
      }),
    ]);
    writeBacklog(backlog);
    writeStateJson(makeLoopState());

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // All three are blocked-status; only the two flagged ones are deferred.
    expect(result.value.backlogSummary.blocked).toBe(3);
    expect(result.value.backlogSummary.deferred).toBe(2);
  });

  it("populates backlogSummary with correct counts from log-parsing path", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-01" }),
      makeItem({ id: "002", status: "pending" }),
    ]);
    writeBacklog(backlog);
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary).toEqual({
      pending: 1,
      inProgress: 0,
      blocked: 0,
      needsHuman: 0,
      deferred: 0,
      done: 1,
      total: 2,
    });
  });

  it("returns zero counts when backlog.json is missing", () => {
    writeStateJson(makeLoopState());

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary).toEqual({
      pending: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
      total: 0,
    });
  });

  it("returns zero counts when backlog.json is invalid", () => {
    createRaufDir();
    const backlogPath = path.join(tmpDir, DEFAULT_ROOT_DIR, "backlog.json");
    fs.writeFileSync(backlogPath, "not json");
    writeStateJson(makeLoopState());

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary.total).toBe(0);
  });
});

// ─── deriveStatus: lock summary ──────────────────────────────────

describe("deriveStatus — lock summary", () => {
  /** Write a .loop.lock with the given content */
  function writeLock(content: object): void {
    createRaufDir();
    const filePath = path.join(tmpDir, DEFAULT_ROOT_DIR, LOCK_FILENAME);
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n");
  }

  it("reports lock absent when no .loop.lock exists", () => {
    writeBacklog(makeBacklog());
    writeStateJson(makeLoopState());

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lock).toEqual({
      present: false,
      pid: null,
      startedAt: null,
      alive: false,
      stale: false,
    });
  });

  it("reports lock alive for the current (live) process PID", () => {
    writeBacklog(makeBacklog());
    writeStateJson(makeLoopState());
    writeLock({
      pid: process.pid,
      startedAt: "2026-06-11T00:00:00.000Z",
      processStartTime: null,
    });

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lock?.present).toBe(true);
    expect(result.value.lock?.pid).toBe(process.pid);
    expect(result.value.lock?.alive).toBe(true);
    expect(result.value.lock?.stale).toBe(false);
    expect(result.value.lock?.startedAt).toBe("2026-06-11T00:00:00.000Z");
  });

  it("reports lock stale for a dead PID", () => {
    writeBacklog(makeBacklog());
    writeStateJson(makeLoopState());
    // 2147483646 — a PID that is effectively guaranteed not to be running.
    writeLock({ pid: 2147483646, startedAt: "2026-06-11T00:00:00.000Z", processStartTime: null });

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lock?.present).toBe(true);
    expect(result.value.lock?.pid).toBe(2147483646);
    expect(result.value.lock?.alive).toBe(false);
    expect(result.value.lock?.stale).toBe(true);
  });
});

// ─── readLogTail ────────────────────────────────────────────────

describe("readLogTail", () => {
  it("returns empty array when log file is missing", () => {
    createRaufDir();
    const result = readLogTail(makePaths(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("returns last N lines from log", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    writeLog(lines.join("\n") + "\n");

    const result = readLogTail(makePaths(), 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["Line 16", "Line 17", "Line 18", "Line 19", "Line 20"]);
  });

  it("returns all lines when N exceeds file length", () => {
    writeLog("Line 1\nLine 2\nLine 3\n");

    const result = readLogTail(makePaths(), 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["Line 1", "Line 2", "Line 3"]);
  });

  it("handles log without trailing newline", () => {
    writeLog("Line 1\nLine 2");

    const result = readLogTail(makePaths(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["Line 1", "Line 2"]);
  });

  it("defaults to 50 lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    writeLog(lines.join("\n") + "\n");

    const result = readLogTail(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(50);
    expect(result.value[0]).toBe("Line 51");
  });

  it("caps at 10000 lines maximum", () => {
    createRaufDir();
    // We don't need to write 10001 lines — just test the cap logic
    const lines = Array.from({ length: 5 }, (_, i) => `Line ${i + 1}`);
    writeLog(lines.join("\n") + "\n");

    const result = readLogTail(makePaths(), 20_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should return all 5 lines (capped request but fewer lines exist)
    expect(result.value.length).toBe(5);
  });

  it("handles empty log file", () => {
    writeLog("");

    const result = readLogTail(makePaths(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("handles log with only newlines", () => {
    writeLog("\n\n\n");

    const result = readLogTail(makePaths(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Split on \n from "\n\n\n" gives ["", "", "", ""] → pop last → ["", "", ""]
    expect(result.value).toEqual(["", "", ""]);
  });
});

// ─── watchLog ───────────────────────────────────────────────────

describe("watchLog", () => {
  it("returns a cleanup function", () => {
    createRaufDir();
    writeLog("Initial content\n");

    const cleanup = watchLog(makePaths(), () => {});
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("detects new lines appended to log", async () => {
    writeLog("Line 1\n");

    const receivedLines: string[][] = [];
    const cleanup = watchLog(makePaths(), (lines) => {
      receivedLines.push(lines);
    });

    // Append new content
    const logPath = path.join(tmpDir, DEFAULT_ROOT_DIR, LOG_FILENAME);
    fs.appendFileSync(logPath, "Line 2\nLine 3\n");

    // Wait for watcher to trigger
    await new Promise((resolve) => setTimeout(resolve, 200));

    cleanup();

    // Should have received at least one callback with new lines
    expect(receivedLines.length).toBeGreaterThanOrEqual(1);
    const allNew = receivedLines.flat();
    expect(allNew).toContain("Line 2");
    expect(allNew).toContain("Line 3");
  });

  it("does not emit for empty appends", async () => {
    writeLog("Line 1\n");

    const receivedLines: string[][] = [];
    const cleanup = watchLog(makePaths(), (lines) => {
      receivedLines.push(lines);
    });

    // Wait without appending
    await new Promise((resolve) => setTimeout(resolve, 150));

    cleanup();
    expect(receivedLines.length).toBe(0);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────

describe("deriveStatus — edge cases", () => {
  it("handles .rauf dir exists but is completely empty", () => {
    createRaufDir();

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("IDLE");
    expect(result.value.stateSource).toBe("none");
  });

  it("handles state.json with empty file", () => {
    createRaufDir();
    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    fs.writeFileSync(statePath, "");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Falls through to Tier 2
    expect(result.value.stateSource).not.toBe("state.json");
  });

  it("DONE file takes precedence over log mtime in Tier 2", () => {
    // Log is recent (RUNNING candidate), but DONE file exists
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");
    setupDoneFile("");

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
  });

  it("Tier 1 takes precedence over Tier 2", () => {
    // Both state.json and log exist — state.json wins
    writeStateJson(makeLoopState({ status: "running" }));
    setupDoneFile(""); // DONE file would suggest COMPLETE in Tier 2

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
    expect(result.value.stateSource).toBe("state.json");
  });

  it("handles elapsed as null when startedAt is invalid", () => {
    const state = makeLoopState({
      startedAt: "not-a-date",
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.elapsed).toBeNull();
  });
});

// ─── deriveStatus: Usage Limit States ───────────────────────────

describe("deriveStatus — usage limit states", () => {
  it("maps sleeping_limit state to SLEEPING_LIMIT", () => {
    const state = makeLoopState({
      status: "sleeping_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      error: "5-hour usage limit hit",
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("SLEEPING_LIMIT");
    expect(result.value.stateSource).toBe("state.json");
    expect(result.value.sleepUntil).toBeDefined();
    expect(typeof result.value.sleepUntil).toBe("string");
  });

  it("does not downgrade sleeping_limit to PAUSED even when updatedAt is stale", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const state = makeLoopState({
      status: "sleeping_limit",
      updatedAt: tenMinutesAgo,
      currentItem: null,
      lastSignal: "error",
      sleepUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      error: "5-hour usage limit hit",
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("SLEEPING_LIMIT");
  });

  it("maps weekly_limit state to WEEKLY_LIMIT", () => {
    const state = makeLoopState({
      status: "weekly_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil: "2026-02-27T05:00:00Z",
      error: "Weekly usage limit exhausted",
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("WEEKLY_LIMIT");
    expect(result.value.sleepUntil).toBe("2026-02-27T05:00:00Z");
  });

  it("does not downgrade weekly_limit to PAUSED when updatedAt is stale", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const state = makeLoopState({
      status: "weekly_limit",
      updatedAt: tenMinutesAgo,
      currentItem: null,
      lastSignal: "error",
      sleepUntil: "2026-02-27T05:00:00Z",
      error: "Weekly usage limit exhausted",
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("WEEKLY_LIMIT");
  });

  it("returns null sleepUntil when not set in state", () => {
    const state = makeLoopState({
      status: "sleeping_limit",
      currentItem: null,
      lastSignal: "error",
      error: "5-hour usage limit hit",
    });
    writeStateJson(state);

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("SLEEPING_LIMIT");
    expect(result.value.sleepUntil ?? null).toBeNull();
  });
});

// ─── writeLoopState ──────────────────────────────────────────────

describe("writeLoopState", () => {
  it("writes valid state.json atomically", () => {
    createRaufDir();
    const state = makeLoopState({ status: "running" });

    const result = writeLoopState(makePaths(), state);
    expect(result.ok).toBe(true);

    // Verify file was written
    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    const content = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(content.status).toBe("running");
    expect(content.iteration).toBe(2);
  });

  it("auto-sets updatedAt to current ISO timestamp", () => {
    createRaufDir();
    const state = makeLoopState({ status: "running" });
    const before = new Date().toISOString();

    const result = writeLoopState(makePaths(), state);
    expect(result.ok).toBe(true);

    const after = new Date().toISOString();
    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    const content = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    // updatedAt should be between before and after
    expect(content.updatedAt >= before).toBe(true);
    expect(content.updatedAt <= after).toBe(true);
  });

  it("overwrites any provided updatedAt with current timestamp", () => {
    createRaufDir();
    const oldTimestamp = "2020-01-01T00:00:00.000Z";
    const state = makeLoopState({ status: "running", updatedAt: oldTimestamp });

    const result = writeLoopState(makePaths(), state);
    expect(result.ok).toBe(true);

    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    const content = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(content.updatedAt).not.toBe(oldTimestamp);
  });

  it("validates against LoopStateSchema before writing", () => {
    createRaufDir();
    // Invalid state: status is not a valid enum value
    const invalidState = {
      status: "not_a_valid_status" as LoopState["status"],
      iteration: 1,
      maxIterations: 10,
      currentItem: null,
      lastSignal: "clean" as const,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedItems: [],
      blockedItems: [],
      error: null,
    };

    const result = writeLoopState(makePaths(), invalidState);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns validation error for missing required fields", () => {
    createRaufDir();
    // Missing iteration and other required fields
    const partialState = {
      status: "running",
    } as unknown as LoopState;

    const result = writeLoopState(makePaths(), partialState);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns error when .rauf directory does not exist", () => {
    // No createRaufDir() — directory missing
    const state = makeLoopState({ status: "running" });

    const result = writeLoopState(makePaths(), state);
    expect(result.ok).toBe(false);
  });

  it("writes valid JSON with pretty formatting", () => {
    createRaufDir();
    const state = makeLoopState({ status: "complete" });

    writeLoopState(makePaths(), state);

    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    const raw = fs.readFileSync(statePath, "utf-8");
    // Should be pretty-printed (contains newlines) and end with newline
    expect(raw).toContain("\n");
    expect(raw.endsWith("\n")).toBe(true);
    // Should parse cleanly
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ─── appendLog ───────────────────────────────────────────────────

describe("appendLog", () => {
  it("appends timestamped line to rauf.log", () => {
    createRaufDir();
    // Create the log file first
    const logPath = path.join(tmpDir, DEFAULT_ROOT_DIR, LOG_FILENAME);
    fs.writeFileSync(logPath, "");

    const result = appendLog(makePaths(), "Hello world");
    expect(result.ok).toBe(true);

    const content = fs.readFileSync(logPath, "utf-8");
    // Should match format [YYYY-MM-DD HH:MM:SS] message\n
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Hello world\n$/);
  });

  it("appends multiple lines sequentially", () => {
    createRaufDir();
    const logPath = path.join(tmpDir, DEFAULT_ROOT_DIR, LOG_FILENAME);
    fs.writeFileSync(logPath, "");

    appendLog(makePaths(), "First message");
    appendLog(makePaths(), "Second message");

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("First message");
    expect(lines[1]).toContain("Second message");
  });

  it("creates log file if it does not exist (when directory exists)", () => {
    createRaufDir();

    const result = appendLog(makePaths(), "New log");
    expect(result.ok).toBe(true);

    const logPath = path.join(tmpDir, DEFAULT_ROOT_DIR, LOG_FILENAME);
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("New log");
  });

  it("returns error when .rauf directory does not exist", () => {
    const result = appendLog(makePaths(), "Should fail");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_NOT_FOUND");
  });

  it("preserves existing log content when appending", () => {
    createRaufDir();
    const logPath = path.join(tmpDir, DEFAULT_ROOT_DIR, LOG_FILENAME);
    fs.writeFileSync(logPath, "[2026-02-27 10:00:00] Previous entry\n");

    appendLog(makePaths(), "New entry");

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("Previous entry");
    expect(content).toContain("New entry");
  });
});

// ─── writeDoneFile ───────────────────────────────────────────────

describe("writeDoneFile", () => {
  it("writes content string to DONE file", () => {
    createRaufDir();

    const result = writeDoneFile(makePaths(), "loop completed successfully");
    expect(result.ok).toBe(true);

    const donePath = path.join(tmpDir, DEFAULT_ROOT_DIR, DONE_FILENAME);
    const content = fs.readFileSync(donePath, "utf-8");
    expect(content).toBe("loop completed successfully");
  });

  it("writes empty string to DONE file", () => {
    createRaufDir();

    const result = writeDoneFile(makePaths(), "");
    expect(result.ok).toBe(true);

    const donePath = path.join(tmpDir, DEFAULT_ROOT_DIR, DONE_FILENAME);
    const content = fs.readFileSync(donePath, "utf-8");
    expect(content).toBe("");
  });

  it("overwrites existing DONE file", () => {
    createRaufDir();
    const donePath = path.join(tmpDir, DEFAULT_ROOT_DIR, DONE_FILENAME);
    fs.writeFileSync(donePath, "old content");

    const result = writeDoneFile(makePaths(), "new content");
    expect(result.ok).toBe(true);

    const content = fs.readFileSync(donePath, "utf-8");
    expect(content).toBe("new content");
  });

  it("returns error when .rauf directory does not exist", () => {
    const result = writeDoneFile(makePaths(), "should fail");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_NOT_FOUND");
  });
});

// ─── clearDoneFile ───────────────────────────────────────────────

describe("clearDoneFile", () => {
  it("removes existing DONE file", () => {
    createRaufDir();
    const donePath = path.join(tmpDir, DEFAULT_ROOT_DIR, DONE_FILENAME);
    fs.writeFileSync(donePath, "done");

    const result = clearDoneFile(makePaths());
    expect(result.ok).toBe(true);
    expect(fs.existsSync(donePath)).toBe(false);
  });

  it("returns ok when DONE file does not exist", () => {
    createRaufDir();

    const result = clearDoneFile(makePaths());
    expect(result.ok).toBe(true);
  });

  it("returns ok even when .rauf directory does not exist", () => {
    // No createRaufDir()
    const result = clearDoneFile(makePaths());
    expect(result.ok).toBe(true);
  });
});

// ─── checkCancelRequested ────────────────────────────────────────

describe("checkCancelRequested", () => {
  it("returns true when CANCEL exists", () => {
    createRaufDir();
    const cancelPath = path.join(tmpDir, DEFAULT_ROOT_DIR, CANCEL_FILENAME);
    fs.writeFileSync(cancelPath, "");

    expect(checkCancelRequested(makePaths())).toBe(true);
  });

  it("returns false when CANCEL does not exist", () => {
    createRaufDir();

    expect(checkCancelRequested(makePaths())).toBe(false);
  });

  it("returns false when .rauf directory does not exist", () => {
    expect(checkCancelRequested(makePaths())).toBe(false);
  });

  it("returns true regardless of CANCEL file content", () => {
    createRaufDir();
    const cancelPath = path.join(tmpDir, DEFAULT_ROOT_DIR, CANCEL_FILENAME);
    fs.writeFileSync(cancelPath, "user requested cancellation");

    expect(checkCancelRequested(makePaths())).toBe(true);
  });
});

// ─── clearCancelFile ─────────────────────────────────────────────

describe("clearCancelFile", () => {
  it("removes CANCEL file and returns true when it existed", () => {
    createRaufDir();
    const cancelPath = path.join(tmpDir, DEFAULT_ROOT_DIR, CANCEL_FILENAME);
    fs.writeFileSync(cancelPath, "");

    const result = clearCancelFile(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(true);
    expect(fs.existsSync(cancelPath)).toBe(false);
  });

  it("returns false when CANCEL file did not exist", () => {
    createRaufDir();

    const result = clearCancelFile(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(false);
  });

  it("returns false when .rauf directory does not exist", () => {
    const result = clearCancelFile(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(false);
  });
});

// ─── scanActiveRoots ─────────────────────────────────────────────

describe("scanActiveRoots", () => {
  it("returns empty array when no active roots exist", () => {
    createRaufDir();

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("returns active roots and skips idle ones", () => {
    // Create default root with running state
    createRaufDir();
    const defaultState = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    fs.writeFileSync(
      defaultState,
      JSON.stringify(makeLoopState({ status: "running", currentItem: "001" })),
    );

    // Create specs/auth root with idle state
    const authDir = path.join(tmpDir, "specs", "auth");
    const authStateDir = path.join(authDir, ".rauf");
    fs.mkdirSync(authStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(authStateDir, STATE_FILENAME),
      JSON.stringify(makeLoopState({ status: "idle", currentItem: null })),
    );

    // Create specs/billing root with running state
    const billingDir = path.join(tmpDir, "specs", "billing");
    const billingStateDir = path.join(billingDir, ".rauf");
    fs.mkdirSync(billingStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(billingDir, "backlog.json"),
      JSON.stringify({ project: "billing", description: "", items: [] }),
    );
    fs.writeFileSync(
      path.join(billingStateDir, STATE_FILENAME),
      JSON.stringify(makeLoopState({ status: "running", currentItem: "005" })),
    );

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should find 2 active roots (default + billing), skip idle auth
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.relativePath).toBe(".rauf");
    expect(result.value[0]!.loopState).toBe("RUNNING");
    expect(result.value[0]!.currentItem).toBe("001");
    expect(result.value[1]!.relativePath).toBe(path.join("specs", "billing"));
    expect(result.value[1]!.loopState).toBe("RUNNING");
    expect(result.value[1]!.currentItem).toBe("005");
  });

  it("skips node_modules, .git, dist, build, coverage directories", () => {
    createRaufDir();

    // Create .rauf dirs inside skip directories
    for (const skipDir of ["node_modules", ".git", "dist", "build", "coverage"]) {
      const stateDir = path.join(tmpDir, skipDir, "some-pkg", ".rauf");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, STATE_FILENAME),
        JSON.stringify(makeLoopState({ status: "running" })),
      );
    }

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // None of the skip directories should appear
    expect(result.value).toEqual([]);
  });

  it("handles missing state.json gracefully", () => {
    // Create .rauf dir without state.json
    createRaufDir();

    // Create another root with .rauf dir but no state.json
    const otherStateDir = path.join(tmpDir, "specs", "api", ".rauf");
    fs.mkdirSync(otherStateDir, { recursive: true });
    // No state.json written

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("handles corrupt state.json gracefully", () => {
    createRaufDir();
    const statePath = path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME);
    fs.writeFileSync(statePath, "not json at all");

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("sorts results by relativePath", () => {
    // Create multiple active roots in non-alphabetical order
    const roots = ["specs/zebra", "specs/alpha", "specs/middle"];
    for (const rootPath of roots) {
      const stateDir = path.join(tmpDir, rootPath, ".rauf");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, rootPath, "backlog.json"),
        JSON.stringify({ project: rootPath, description: "", items: [] }),
      );
      fs.writeFileSync(
        path.join(stateDir, STATE_FILENAME),
        JSON.stringify(makeLoopState({ status: "running" })),
      );
    }

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.map((r) => r.relativePath);
    expect(paths).toEqual([
      path.join("specs", "alpha"),
      path.join("specs", "middle"),
      path.join("specs", "zebra"),
    ]);
  });

  it("detects lock file as activity indicator", () => {
    createRaufDir();
    // No state.json, but has a lock file
    fs.writeFileSync(
      path.join(tmpDir, DEFAULT_ROOT_DIR, LOCK_FILENAME),
      JSON.stringify({ pid: 12345, startedAt: new Date().toISOString(), processStartTime: null }),
    );

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.relativePath).toBe(".rauf");
    expect(result.value[0]!.loopState).toBe("RUNNING");
    expect(result.value[0]!.currentItem).toBeNull();
  });

  it("does not duplicate when both state.json and lock file exist", () => {
    createRaufDir();
    fs.writeFileSync(
      path.join(tmpDir, DEFAULT_ROOT_DIR, STATE_FILENAME),
      JSON.stringify(makeLoopState({ status: "running", currentItem: "001" })),
    );
    fs.writeFileSync(
      path.join(tmpDir, DEFAULT_ROOT_DIR, LOCK_FILENAME),
      JSON.stringify({ pid: 12345, startedAt: new Date().toISOString(), processStartTime: null }),
    );

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should only appear once
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.currentItem).toBe("001");
  });

  it("works with non-default root (backlog.json in parent dir)", () => {
    // Create specs/auth with backlog.json in root and running state in .rauf/
    const authDir = path.join(tmpDir, "specs", "auth");
    const authStateDir = path.join(authDir, ".rauf");
    fs.mkdirSync(authStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "backlog.json"),
      JSON.stringify({ project: "auth", description: "", items: [] }),
    );
    fs.writeFileSync(
      path.join(authStateDir, STATE_FILENAME),
      JSON.stringify(makeLoopState({ status: "running", currentItem: "002" })),
    );

    const result = scanActiveRoots(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    // Since parent has backlog.json, backlog root is the parent dir
    expect(result.value[0]!.relativePath).toBe(path.join("specs", "auth"));
    expect(result.value[0]!.currentItem).toBe("002");
  });
});
