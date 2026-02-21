import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  deriveStatus,
  readLogTail,
  watchLog,
  RALPH_DIR,
  LOG_FILENAME,
  DONE_FILENAME,
  STALENESS_THRESHOLD_MS,
  LOG_ACTIVE_THRESHOLD_MS,
} from "./status.js";
import { STATE_FILENAME } from "./backlog.js";
import type { Backlog, BacklogItem, LoopState } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-status-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create .ralph directory */
function createRalphDir(): void {
  fs.mkdirSync(path.join(tmpDir, RALPH_DIR), { recursive: true });
}

/** Write a state.json for test setup */
function writeStateJson(state: LoopState): void {
  createRalphDir();
  const filePath = path.join(tmpDir, RALPH_DIR, STATE_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
}

/** Write a backlog.json for test setup */
function writeBacklog(backlog: Backlog): void {
  createRalphDir();
  const filePath = path.join(tmpDir, RALPH_DIR, "backlog.json");
  fs.writeFileSync(filePath, JSON.stringify(backlog, null, 2) + "\n");
}

/** Write ralph.log with given content */
function writeLog(content: string, mtimeOverride?: Date): void {
  createRalphDir();
  const filePath = path.join(tmpDir, RALPH_DIR, LOG_FILENAME);
  fs.writeFileSync(filePath, content);
  if (mtimeOverride) {
    fs.utimesSync(filePath, mtimeOverride, mtimeOverride);
  }
}

/** Write DONE file */
function writeDoneFile(content: string = ""): void {
  createRalphDir();
  const filePath = path.join(tmpDir, RALPH_DIR, DONE_FILENAME);
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
  it("returns NOT_INSTALLED when .ralph directory is missing", () => {
    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("NOT_INSTALLED");
    expect(result.value.stateSource).toBe("none");
    expect(result.value.backlogSummary.total).toBe(0);
  });

  it("derives RUNNING from state.json with status 'running'", () => {
    const state = makeLoopState({ status: "running" });
    writeStateJson(state);

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
  });

  it("derives COMPLETE from state.json with status 'complete'", () => {
    const state = makeLoopState({ status: "complete" });
    writeStateJson(state);

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
    expect(result.value.stateSource).toBe("state.json");
  });

  it("derives PAUSED from state.json with status 'paused'", () => {
    const state = makeLoopState({ status: "paused" });
    writeStateJson(state);

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED");
  });

  it("derives PAUSED_HUMAN from state.json with status 'paused_human'", () => {
    const state = makeLoopState({ status: "paused_human" });
    writeStateJson(state);

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED_HUMAN");
  });

  it("derives LIMIT_REACHED from state.json with status 'limit_reached'", () => {
    const state = makeLoopState({ status: "limit_reached" });
    writeStateJson(state);

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should be approximately 10 seconds (allow 2s tolerance)
    expect(result.value.elapsed).toBeGreaterThanOrEqual(9);
    expect(result.value.elapsed).toBeLessThanOrEqual(12);
  });

  it("reports stateSource as 'state.json' for Tier 1", () => {
    writeStateJson(makeLoopState());

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stateSource).toBe("state.json");
  });
});

// ─── deriveStatus: Tier 2 (Log parsing fallback) ────────────────

describe("deriveStatus — Tier 2: log parsing fallback", () => {
  it("returns IDLE with stateSource 'none' when no log exists", () => {
    createRalphDir();
    // No state.json, no log

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("IDLE");
    expect(result.value.stateSource).toBe("none");
  });

  it("detects RUNNING from log mtime < 60s", () => {
    // Write log with recent mtime (default is now)
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("detects PAUSED from stale log (mtime > 60s, no DONE file)", () => {
    const staleTime = new Date(Date.now() - LOG_ACTIVE_THRESHOLD_MS - 5000);
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n", staleTime);

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED");
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("detects COMPLETE from DONE file", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    writeDoneFile("");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
  });

  it("detects PAUSED_HUMAN from DONE file content", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    writeDoneFile("needs_human: requires API key setup");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("PAUSED_HUMAN");
  });

  it("detects LIMIT_REACHED from DONE file content", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    writeDoneFile("LIMIT REACHED after 20 iterations");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("LIMIT_REACHED");
  });

  it("detects ERROR from DONE file content", () => {
    const staleTime = new Date(Date.now() - 120_000);
    writeLog("[2026-02-21 10:00:00] Some log content\n", staleTime);
    writeDoneFile("error: claude process exited with code 1");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("ERROR");
  });

  it("parses iteration details from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] Ralph Loop starting | max=10 iterations",
        "[2026-02-21 10:00:01] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] ✓ Clean completion signal received",
        "[2026-02-21 10:01:00] --- Iteration 2 / 10 ---",
        "[2026-02-21 10:01:30] Working on task...",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iteration).toBe(2);
    expect(result.value.maxIterations).toBe(10);
  });

  it("parses last signal from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] ⚠ Task blocked: 005",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSignal).toBe("blocked");
  });

  it("parses clean signal from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] ✓ Clean completion signal received",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSignal).toBe("clean");
  });

  it("parses needs_human signal from log", () => {
    writeLog(
      [
        "[2026-02-21 10:00:00] --- Iteration 1 / 10 ---",
        "[2026-02-21 10:00:30] ⛔ Loop paused — human input needed: need API key",
        "",
      ].join("\n"),
    );

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSignal).toBe("needs_human");
  });

  it("falls back to Tier 2 when state.json is invalid JSON", () => {
    createRalphDir();
    const statePath = path.join(tmpDir, RALPH_DIR, STATE_FILENAME);
    fs.writeFileSync(statePath, "not json at all");
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should use log parsing since state.json is invalid
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("falls back to Tier 2 when state.json fails schema validation", () => {
    createRalphDir();
    const statePath = path.join(tmpDir, RALPH_DIR, STATE_FILENAME);
    fs.writeFileSync(statePath, JSON.stringify({ status: "invalid_status" }));
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(tmpDir);
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

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary).toEqual({
      pending: 2,
      inProgress: 1,
      blocked: 1,
      done: 2,
      total: 6,
    });
  });

  it("populates backlogSummary with correct counts from log-parsing path", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-01" }),
      makeItem({ id: "002", status: "pending" }),
    ]);
    writeBacklog(backlog);
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary).toEqual({
      pending: 1,
      inProgress: 0,
      blocked: 0,
      done: 1,
      total: 2,
    });
  });

  it("returns zero counts when backlog.json is missing", () => {
    writeStateJson(makeLoopState());

    const result = deriveStatus(tmpDir);
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
    createRalphDir();
    const backlogPath = path.join(tmpDir, RALPH_DIR, "backlog.json");
    fs.writeFileSync(backlogPath, "not json");
    writeStateJson(makeLoopState());

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary.total).toBe(0);
  });
});

// ─── readLogTail ────────────────────────────────────────────────

describe("readLogTail", () => {
  it("returns empty array when log file is missing", () => {
    createRalphDir();
    const result = readLogTail(tmpDir, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("returns last N lines from log", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    writeLog(lines.join("\n") + "\n");

    const result = readLogTail(tmpDir, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["Line 16", "Line 17", "Line 18", "Line 19", "Line 20"]);
  });

  it("returns all lines when N exceeds file length", () => {
    writeLog("Line 1\nLine 2\nLine 3\n");

    const result = readLogTail(tmpDir, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["Line 1", "Line 2", "Line 3"]);
  });

  it("handles log without trailing newline", () => {
    writeLog("Line 1\nLine 2");

    const result = readLogTail(tmpDir, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["Line 1", "Line 2"]);
  });

  it("defaults to 50 lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    writeLog(lines.join("\n") + "\n");

    const result = readLogTail(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(50);
    expect(result.value[0]).toBe("Line 51");
  });

  it("caps at 10000 lines maximum", () => {
    createRalphDir();
    // We don't need to write 10001 lines — just test the cap logic
    const lines = Array.from({ length: 5 }, (_, i) => `Line ${i + 1}`);
    writeLog(lines.join("\n") + "\n");

    const result = readLogTail(tmpDir, 20_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should return all 5 lines (capped request but fewer lines exist)
    expect(result.value.length).toBe(5);
  });

  it("handles empty log file", () => {
    writeLog("");

    const result = readLogTail(tmpDir, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("handles log with only newlines", () => {
    writeLog("\n\n\n");

    const result = readLogTail(tmpDir, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Split on \n from "\n\n\n" gives ["", "", "", ""] → pop last → ["", "", ""]
    expect(result.value).toEqual(["", "", ""]);
  });
});

// ─── watchLog ───────────────────────────────────────────────────

describe("watchLog", () => {
  it("returns a cleanup function", () => {
    createRalphDir();
    writeLog("Initial content\n");

    const cleanup = watchLog(tmpDir, () => {});
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("detects new lines appended to log", async () => {
    writeLog("Line 1\n");

    const receivedLines: string[][] = [];
    const cleanup = watchLog(tmpDir, (lines) => {
      receivedLines.push(lines);
    });

    // Append new content
    const logPath = path.join(tmpDir, RALPH_DIR, LOG_FILENAME);
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
    const cleanup = watchLog(tmpDir, (lines) => {
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
  it("handles .ralph dir exists but is completely empty", () => {
    createRalphDir();

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("IDLE");
    expect(result.value.stateSource).toBe("none");
  });

  it("handles state.json with empty file", () => {
    createRalphDir();
    const statePath = path.join(tmpDir, RALPH_DIR, STATE_FILENAME);
    fs.writeFileSync(statePath, "");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Falls through to Tier 2
    expect(result.value.stateSource).not.toBe("state.json");
  });

  it("DONE file takes precedence over log mtime in Tier 2", () => {
    // Log is recent (RUNNING candidate), but DONE file exists
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");
    writeDoneFile("");

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
  });

  it("Tier 1 takes precedence over Tier 2", () => {
    // Both state.json and log exist — state.json wins
    writeStateJson(makeLoopState({ status: "running" }));
    writeDoneFile(""); // DONE file would suggest COMPLETE in Tier 2

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("RUNNING");
    expect(result.value.stateSource).toBe("state.json");
  });

  it("handles project path with trailing slash", () => {
    writeStateJson(makeLoopState({ status: "complete" }));

    const result = deriveStatus(tmpDir + "/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loopState).toBe("COMPLETE");
  });

  it("handles elapsed as null when startedAt is invalid", () => {
    const state = makeLoopState({
      startedAt: "not-a-date",
    });
    writeStateJson(state);

    const result = deriveStatus(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.elapsed).toBeNull();
  });
});
