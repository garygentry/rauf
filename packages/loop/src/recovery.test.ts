import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, execSync, type ChildProcess } from "node:child_process";

import { resolveBacklogPaths, ErrorCodes, type BacklogPaths } from "@rauf/core";

import {
  acquireRecoveryLock,
  releaseRecoveryLock,
  recoverInterruptedLoop,
  readPendingReview,
  restorePendingReview,
} from "./recovery.js";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;
let paths: BacklogPaths;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-loop-recovery-"));
  projectDir = path.join(tmpDir, "proj");
  fs.mkdirSync(path.join(projectDir, ".rauf"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, ".rauf", "backlog.json"),
    JSON.stringify({ schemaVersion: "1", project: "p", description: "d", items: [] }, null, 2),
  );
  const resolved = resolveBacklogPaths(projectDir, path.join(projectDir, ".rauf"));
  if (!resolved.ok) throw new Error(resolved.error.message);
  paths = resolved.value;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeLock(content: object): void {
  fs.writeFileSync(paths.lock, JSON.stringify(content));
}

function writeBacklogItems(items: unknown[]): void {
  fs.writeFileSync(
    paths.backlog,
    JSON.stringify({ schemaVersion: "1", project: "p", description: "d", items }, null, 2),
  );
}

/** Initialise a git repo at projectDir and commit everything (clean tree). */
function initGitCommitted(): void {
  execSync("git init", { cwd: projectDir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: projectDir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: projectDir, stdio: "ignore" });
  execSync("git add -A", { cwd: projectDir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: projectDir, stdio: "ignore" });
}

// ─── acquireRecoveryLock ───────────────────────────────────────────

describe("acquireRecoveryLock", () => {
  it("acquires when no lock exists (cleared: false) and writes our PID", () => {
    const result = acquireRecoveryLock(paths);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cleared).toBe(false);

    const lock = JSON.parse(fs.readFileSync(paths.lock, "utf-8")) as { pid: number };
    expect(lock.pid).toBe(process.pid);
  });

  it("clears a stale lock and re-acquires (cleared: true)", () => {
    writeLock({ pid: 2147483646, startedAt: "old", processStartTime: null });

    const result = acquireRecoveryLock(paths);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cleared).toBe(true);

    const lock = JSON.parse(fs.readFileSync(paths.lock, "utf-8")) as { pid: number };
    expect(lock.pid).toBe(process.pid);
  });

  it("refuses with LOCK_CONFLICT when a live lock is held and leaves it intact", () => {
    writeLock({ pid: process.pid, startedAt: "now", processStartTime: null });

    const result = acquireRecoveryLock(paths);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCodes.LOCK_CONFLICT);

    // The live lock is untouched (still the original PID).
    const lock = JSON.parse(fs.readFileSync(paths.lock, "utf-8")) as { pid: number };
    expect(lock.pid).toBe(process.pid);
  });
});

// ─── releaseRecoveryLock (owner-aware) ─────────────────────────────

describe("releaseRecoveryLock", () => {
  it("releases a lock we own", () => {
    const acquired = acquireRecoveryLock(paths);
    expect(acquired.ok).toBe(true);

    const released = releaseRecoveryLock(paths);
    expect(released.ok).toBe(true);
    expect(fs.existsSync(paths.lock)).toBe(false);
  });

  it("is a no-op when no lock exists", () => {
    const released = releaseRecoveryLock(paths);
    expect(released.ok).toBe(true);
  });

  it("removes a stale lock (dead PID)", () => {
    writeLock({ pid: 2147483646, startedAt: "old", processStartTime: null });
    const released = releaseRecoveryLock(paths);
    expect(released.ok).toBe(true);
    expect(fs.existsSync(paths.lock)).toBe(false);
  });

  it("never deletes a lock owned by a live DIFFERENT pid", async () => {
    // A real, alive child process gives a guaranteed-live PID distinct from ours.
    let child: ChildProcess | undefined;
    try {
      child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
        stdio: "ignore",
      });
      const otherPid = child.pid;
      expect(otherPid).toBeDefined();
      expect(otherPid).not.toBe(process.pid);

      writeLock({ pid: otherPid, startedAt: "now", processStartTime: null });

      const released = releaseRecoveryLock(paths);
      expect(released.ok).toBe(true);

      // The lock belongs to a live different process — it must NOT be deleted.
      expect(fs.existsSync(paths.lock)).toBe(true);
      const lock = JSON.parse(fs.readFileSync(paths.lock, "utf-8")) as { pid: number };
      expect(lock.pid).toBe(otherPid);
    } finally {
      child?.kill("SIGKILL");
    }
  });
});

// ─── recoverInterruptedLoop ────────────────────────────────────────

describe("recoverInterruptedLoop", () => {
  it("is a clean-tree no-op when nothing needs recovery", async () => {
    initGitCommitted();

    const result = await recoverInterruptedLoop(paths);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = result.value;
    expect(summary.recovered).toEqual([]);
    expect(summary.requeued).toEqual([]);
    expect(summary.keptBlocked).toEqual([]);
    expect(summary.interrupted).toEqual([]);
    expect(summary.treeClean).toBe(true);
    expect(summary.stalledReset).toBe(0);
  });

  it("resets a stalled in_progress item with no commit back to pending", async () => {
    writeBacklogItems([
      {
        id: "001",
        type: "feature",
        priority: 1,
        title: "Stalled item",
        description: "d",
        acceptanceCriteria: ["a"],
        status: "in_progress",
        completedAt: null,
        dependsOn: [],
      },
    ]);
    initGitCommitted();

    const result = await recoverInterruptedLoop(paths);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.stalledReset).toBe(1);
    expect(result.value.recovered).toEqual([]);

    const backlog = JSON.parse(fs.readFileSync(paths.backlog, "utf-8")) as {
      items: { id: string; status: string }[];
    };
    expect(backlog.items[0]?.status).toBe("pending");
  });
});

// ─── readPendingReview (#146) ──────────────────────────────────────

describe("readPendingReview", () => {
  it("returns null with no state.json, unparsable state, or no pending review", () => {
    expect(readPendingReview(paths)).toBeNull();
    fs.writeFileSync(paths.state, "{not json");
    expect(readPendingReview(paths)).toBeNull();
    fs.writeFileSync(paths.state, JSON.stringify({ status: "complete", reviewPending: false }));
    expect(readPendingReview(paths)).toBeNull();
  });

  it("returns the pending review's exact scope, dropping non-string ids", () => {
    fs.writeFileSync(
      paths.state,
      JSON.stringify({ status: "complete", reviewPending: true, reviewItemIds: ["001", 7, "003"] }),
    );
    expect(readPendingReview(paths)).toMatchObject({ itemIds: ["001", "003"] });
    expect(readPendingReview(paths)?.state.status).toBe("complete");
  });

  it("falls back to a null scope (every done item) when reviewItemIds is empty or absent", () => {
    fs.writeFileSync(paths.state, JSON.stringify({ reviewPending: true, reviewItemIds: [] }));
    expect(readPendingReview(paths)).toMatchObject({ itemIds: null });
    fs.writeFileSync(paths.state, JSON.stringify({ reviewPending: true }));
    expect(readPendingReview(paths)).toMatchObject({ itemIds: null });
  });
});

// ─── restorePendingReview (#149) ───────────────────────────────────

describe("restorePendingReview", () => {
  const preState = {
    status: "paused_usage_limit",
    iteration: 7,
    maxIterations: 20,
    currentItem: "004",
    lastSignal: "clean",
    startedAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T11:00:00.000Z",
    completedItems: ["001"],
    blockedItems: [],
    deferredItems: [],
    error: null,
    sleepUntil: "2026-09-30T12:00:00.000Z",
    reviewPending: true,
    reviewItemIds: ["001"],
    baseCommitHash: "abc123",
  };

  it("restores the pre-recovery run context, normalized to a settled idle state", async () => {
    fs.writeFileSync(paths.state, JSON.stringify(preState));
    const pending = readPendingReview(paths)!;
    initGitCommitted();
    const recovered = await recoverInterruptedLoop(paths);
    expect(recovered.ok).toBe(true);
    expect(fs.existsSync(paths.state)).toBe(false);

    expect(restorePendingReview(paths, pending).ok).toBe(true);
    const state = JSON.parse(fs.readFileSync(paths.state, "utf-8"));
    expect(state).toMatchObject({
      status: "idle",
      currentItem: null,
      iteration: 7,
      maxIterations: 20,
      startedAt: preState.startedAt,
      completedItems: ["001"],
      baseCommitHash: "abc123",
      reviewPending: true,
      reviewItemIds: ["001"],
    });
    expect(state.sleepUntil).toBeUndefined();
    expect(readPendingReview(paths)?.itemIds).toEqual(["001"]);
  });

  it("falls back to a minimal idle state that keeps baseCommitHash for an invalid pre-state", () => {
    fs.writeFileSync(
      paths.state,
      JSON.stringify({ reviewPending: true, baseCommitHash: "def456", status: "bogus" }),
    );
    const pending = readPendingReview(paths)!;
    expect(restorePendingReview(paths, pending).ok).toBe(true);
    const state = JSON.parse(fs.readFileSync(paths.state, "utf-8"));
    expect(state).toMatchObject({ status: "idle", reviewPending: true, baseCommitHash: "def456" });
    expect(state.reviewItemIds).toBeUndefined();
  });
});
