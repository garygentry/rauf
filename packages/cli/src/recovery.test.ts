import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

import { resolveBacklogPaths, ErrorCodes, type BacklogPaths } from "@rauf/core";

import { acquireRecoveryLock, releaseRecoveryLock } from "./recovery.js";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;
let paths: BacklogPaths;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-recovery-"));
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
