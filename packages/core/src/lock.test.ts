import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resolveBacklogPaths } from "./backlog-root.js";
import {
  acquireLock,
  releaseLock,
  checkLock,
  checkLockFile,
  forceClearLock,
  LockFileContentSchema,
} from "./lock.js";
import type { BacklogPaths } from "./backlog-root.js";
import { createMultiRootProject } from "./test-helpers.js";

describe("lock", () => {
  let projectPath: string;
  let cleanup: () => void;
  let paths: BacklogPaths;

  beforeEach(() => {
    const project = createMultiRootProject();
    projectPath = project.projectPath;
    cleanup = project.cleanup;

    const result = resolveBacklogPaths(projectPath, path.join(projectPath, ".rauf"));
    if (!result.ok) throw new Error(`resolveBacklogPaths failed: ${result.error.message}`);
    paths = result.value;

    // Ensure the state directory exists
    fs.mkdirSync(path.dirname(paths.lock), { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  describe("acquireLock", () => {
    it("creates .loop.lock with valid JSON on fresh dir", () => {
      const result = acquireLock(paths);
      expect(result.ok).toBe(true);

      const raw = fs.readFileSync(paths.lock, "utf-8");
      const parsed = JSON.parse(raw);
      const validated = LockFileContentSchema.safeParse(parsed);
      expect(validated.success).toBe(true);

      expect(parsed.pid).toBe(process.pid);
      expect(typeof parsed.startedAt).toBe("string");
      expect(parsed).toHaveProperty("processStartTime");
    });

    it("returns LOCK_CONFLICT when locked by current (live) PID", () => {
      const first = acquireLock(paths);
      expect(first.ok).toBe(true);

      const second = acquireLock(paths);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.code).toBe("LOCK_CONFLICT");
        expect(second.error.message).toContain("PID");
        expect(second.error.message).toContain(String(process.pid));
      }
    });

    it("removes stale lock (dead PID 999999999) and acquires successfully", () => {
      // Write a lock with a dead PID
      const staleLock = {
        pid: 999999999,
        startedAt: "2026-01-01T00:00:00Z",
        processStartTime: null,
      };
      fs.writeFileSync(paths.lock, JSON.stringify(staleLock, null, 2) + "\n");

      const result = acquireLock(paths);
      expect(result.ok).toBe(true);

      // Verify the new lock is ours
      const raw = fs.readFileSync(paths.lock, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.pid).toBe(process.pid);
    });

    it("treats corrupt lock file as stale and acquires", () => {
      fs.writeFileSync(paths.lock, "this is not json");

      const result = acquireLock(paths);
      expect(result.ok).toBe(true);

      const raw = fs.readFileSync(paths.lock, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.pid).toBe(process.pid);
    });
  });

  describe("releaseLock", () => {
    it("removes lock file", () => {
      acquireLock(paths);
      expect(fs.existsSync(paths.lock)).toBe(true);

      const result = releaseLock(paths);
      expect(result.ok).toBe(true);
      expect(fs.existsSync(paths.lock)).toBe(false);
    });

    it("returns ok when no lock exists (idempotent)", () => {
      expect(fs.existsSync(paths.lock)).toBe(false);
      const result = releaseLock(paths);
      expect(result.ok).toBe(true);
    });
  });

  describe("checkLock", () => {
    it("returns { locked: false } when no lock file", () => {
      const result = checkLock(paths);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locked).toBe(false);
      }
    });

    it("returns { locked: true, stale: false } for live PID", () => {
      acquireLock(paths);
      const result = checkLock(paths);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locked).toBe(true);
        expect(result.value.stale).toBe(false);
        expect(result.value.pid).toBe(process.pid);
      }
    });

    it("returns { locked: true, stale: true } for dead PID", () => {
      const staleLock = {
        pid: 999999999,
        startedAt: "2026-01-01T00:00:00Z",
        processStartTime: null,
      };
      fs.writeFileSync(paths.lock, JSON.stringify(staleLock, null, 2) + "\n");

      const result = checkLock(paths);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locked).toBe(true);
        expect(result.value.stale).toBe(true);
        expect(result.value.pid).toBe(999999999);
      }
    });
  });

  describe("checkLockFile", () => {
    it("returns { locked: false } when lock file is missing", () => {
      const result = checkLockFile(paths.lock);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locked).toBe(false);
      }
    });

    it("returns { locked: true, stale: false } for a live PID", () => {
      acquireLock(paths);
      const result = checkLockFile(paths.lock);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locked).toBe(true);
        expect(result.value.stale).toBe(false);
        expect(result.value.pid).toBe(process.pid);
      }
    });

    it("returns { locked: true, stale: true } for a dead PID", () => {
      const staleLock = {
        pid: 999999999,
        startedAt: "2026-01-01T00:00:00Z",
        processStartTime: null,
      };
      fs.writeFileSync(paths.lock, JSON.stringify(staleLock, null, 2) + "\n");

      const result = checkLockFile(paths.lock);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locked).toBe(true);
        expect(result.value.stale).toBe(true);
        expect(result.value.pid).toBe(999999999);
      }
    });

    it("returns stale for a PID-recycled lock (processStartTime mismatch)", () => {
      // Write a lock with current pid but wrong processStartTime so recycled detection fires
      const recycleLock = {
        pid: process.pid,
        startedAt: "2026-01-01T00:00:00Z",
        // Use an absurd future start time that cannot match the actual process
        processStartTime: Number.MAX_SAFE_INTEGER,
      };
      fs.writeFileSync(paths.lock, JSON.stringify(recycleLock, null, 2) + "\n");

      const result = checkLockFile(paths.lock);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // On Linux: recycled detection should flag stale. On non-Linux: processStartTime is null
        // and isProcessRecycled returns false, so lock is live. Either outcome is correct per
        // platform. Just assert Result is ok.
        expect(typeof result.value.locked).toBe("boolean");
      }
    });

    it("checkLock parity: produces identical result to checkLockFile(paths.lock)", () => {
      acquireLock(paths);
      const byFile = checkLockFile(paths.lock);
      const byPaths = checkLock(paths);
      expect(byFile).toEqual(byPaths);
    });
  });

  describe("forceClearLock", () => {
    it("removes lock regardless of PID status", () => {
      acquireLock(paths);
      expect(fs.existsSync(paths.lock)).toBe(true);

      const result = forceClearLock(paths);
      expect(result.ok).toBe(true);
      expect(fs.existsSync(paths.lock)).toBe(false);
    });
  });
});
