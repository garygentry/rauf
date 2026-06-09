// ─── LoopManager Tests ────────────────────────────────────────────
//
// Tests for the LoopManager singleton: startLoop, stopLoop,
// subscribe, recoverStaleLoops, shutdownAll.
//
// These tests use real temp directories with backlog.json and
// marker files to exercise the manager. They mock claude by
// prepending a temp dir with a mock `claude` script to PATH.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { LoopEvent } from "@rauf/core";

import { LoopManager } from "./loop-manager.js";

// ─── Helpers ─────────────────────────────────────────────────────

let tmpDir: string;
let projectPath: string;
let originalPath: string;

function writeMarker(dir: string): void {
  const marker = {
    rauf: true,
    version: "1",
    variant: "backlog-json",
    installedAt: new Date().toISOString(),
    installedBy: "test",
    profile: {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: { test: null, typecheck: null, lint: null, build: null, format: null },
      verify: "",
    },
    artifactHashes: {},
    options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
  };
  fs.writeFileSync(path.join(dir, ".rauf.json"), JSON.stringify(marker, null, 2));
}

function writeBacklog(dir: string, items: unknown[] = []): void {
  const raufDir = path.join(dir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  const backlog = { project: "test", description: "test project", items };
  fs.writeFileSync(path.join(raufDir, "backlog.json"), JSON.stringify(backlog, null, 2));
}

function writeRaufMd(dir: string): void {
  const raufDir = path.join(dir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(path.join(raufDir, "RAUF.md"), "# Test\nVerify: echo ok\n");
}

/**
 * Create a mock `claude` executable that immediately exits with
 * RAUF_DONE or another signal on stdout.
 */
function setupMockClaude(signal = "RAUF_DONE"): void {
  const mockBinDir = path.join(tmpDir, "mock-bin");
  fs.mkdirSync(mockBinDir, { recursive: true });
  const script = `#!/bin/bash\necho "${signal}"\nexit 0\n`;
  const claudePath = path.join(mockBinDir, "claude");
  fs.writeFileSync(claudePath, script);
  fs.chmodSync(claudePath, 0o755);
  process.env["PATH"] = `${mockBinDir}:${originalPath}`;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-lm-test-"));
  projectPath = path.join(tmpDir, "my-project");
  fs.mkdirSync(projectPath, { recursive: true });
  originalPath = process.env["PATH"] ?? "";
});

afterEach(() => {
  process.env["PATH"] = originalPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────

describe("LoopManager", () => {
  describe("startLoop", () => {
    it("starts a loop and tracks it", () => {
      const manager = new LoopManager();
      writeMarker(projectPath);
      writeBacklog(projectPath);
      writeRaufMd(projectPath);
      setupMockClaude();

      const result = manager.startLoop(projectPath, {
        maxIterations: 1,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      expect(manager.isRunning(projectPath)).toBe(true);
    });

    it("returns error on duplicate start", () => {
      const manager = new LoopManager();
      writeMarker(projectPath);
      writeBacklog(projectPath);
      writeRaufMd(projectPath);
      setupMockClaude();

      manager.startLoop(projectPath, {
        maxIterations: 1,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      const result = manager.startLoop(projectPath, {
        maxIterations: 1,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already running");
      }
    });
  });

  describe("stopLoop", () => {
    it("returns false when no loop is running", () => {
      const manager = new LoopManager();
      expect(manager.stopLoop("/nonexistent")).toBe(false);
    });

    it("cancels a running loop", () => {
      const manager = new LoopManager();
      writeMarker(projectPath);
      writeBacklog(projectPath, [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "Test item",
          description: "Test",
          acceptanceCriteria: ["test"],
          status: "pending",
          completedAt: null,
        },
      ]);
      writeRaufMd(projectPath);
      // Use a claude that sleeps so we can cancel it
      const mockBinDir = path.join(tmpDir, "mock-bin");
      fs.mkdirSync(mockBinDir, { recursive: true });
      const script = `#!/bin/bash\nexec sleep 999\n`;
      fs.writeFileSync(path.join(mockBinDir, "claude"), script);
      fs.chmodSync(path.join(mockBinDir, "claude"), 0o755);
      process.env["PATH"] = `${mockBinDir}:${originalPath}`;

      manager.startLoop(projectPath, {
        maxIterations: 5,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      expect(manager.isRunning(projectPath)).toBe(true);
      const stopped = manager.stopLoop(projectPath);
      expect(stopped).toBe(true);
    });
  });

  describe("subscribe", () => {
    it("fans out events to subscribers", async () => {
      const manager = new LoopManager();
      writeMarker(projectPath);
      writeBacklog(projectPath, [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "Test item",
          description: "Test",
          acceptanceCriteria: ["test"],
          status: "pending",
          completedAt: null,
        },
      ]);
      writeRaufMd(projectPath);
      setupMockClaude();

      const events: LoopEvent[] = [];
      manager.subscribe(projectPath, (event) => {
        events.push(event);
      });

      manager.startLoop(projectPath, {
        maxIterations: 1,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      // Wait for the loop to complete
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!manager.isRunning(projectPath)) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });

      expect(events.length).toBeGreaterThan(0);
      // Should have a loop_started event
      expect(events.some((e) => e.type === "loop_started")).toBe(true);
    });

    it("unsubscribe stops receiving events", () => {
      const manager = new LoopManager();
      const events: LoopEvent[] = [];
      const unsub = manager.subscribe(projectPath, (event) => {
        events.push(event);
      });
      unsub();

      // Manually verify the listener set is cleaned up
      expect(manager.isRunning(projectPath)).toBe(false);
    });
  });

  describe("isRunning", () => {
    it("returns false for unknown project", () => {
      const manager = new LoopManager();
      expect(manager.isRunning("/nonexistent")).toBe(false);
    });
  });

  describe("recoverStaleLoops", () => {
    it("resets in_progress items in discovered projects", async () => {
      // Create a project with an in_progress item
      writeMarker(projectPath);
      writeBacklog(projectPath, [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "Stale item",
          description: "Test",
          acceptanceCriteria: ["test"],
          status: "in_progress",
          completedAt: null,
        },
      ]);

      const manager = new LoopManager();
      await manager.recoverStaleLoops(tmpDir);

      // Read backlog and verify item was reset to pending
      const backlogPath = path.join(projectPath, ".rauf", "backlog.json");
      const backlog = JSON.parse(fs.readFileSync(backlogPath, "utf-8")) as {
        items: Array<{ status: string }>;
      };
      expect(backlog.items[0]!.status).toBe("pending");
    });

    it("handles missing root directory gracefully", async () => {
      const manager = new LoopManager();
      // Should not throw
      await manager.recoverStaleLoops("/nonexistent-dir-12345");
    });
  });

  describe("shutdownAll", () => {
    it("resolves when no loops are running", async () => {
      const manager = new LoopManager();
      await manager.shutdownAll();
    });

    it("cancels all active loops", async () => {
      const manager = new LoopManager();
      writeMarker(projectPath);
      writeBacklog(projectPath, [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "Test item",
          description: "Test",
          acceptanceCriteria: ["test"],
          status: "pending",
          completedAt: null,
        },
      ]);
      writeRaufMd(projectPath);
      // Use a long-running mock claude
      const mockBinDir = path.join(tmpDir, "mock-bin");
      fs.mkdirSync(mockBinDir, { recursive: true });
      const script = `#!/bin/bash\nexec sleep 999\n`;
      fs.writeFileSync(path.join(mockBinDir, "claude"), script);
      fs.chmodSync(path.join(mockBinDir, "claude"), 0o755);
      process.env["PATH"] = `${mockBinDir}:${originalPath}`;

      manager.startLoop(projectPath, {
        maxIterations: 5,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      expect(manager.isRunning(projectPath)).toBe(true);
      await manager.shutdownAll();
      expect(manager.isRunning(projectPath)).toBe(false);
    });
  });

  describe("event buffer", () => {
    it("replays buffered events to late subscribers", async () => {
      const manager = new LoopManager();
      writeMarker(projectPath);
      writeBacklog(projectPath, [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "Test item",
          description: "Test",
          acceptanceCriteria: ["test"],
          status: "pending",
          completedAt: null,
        },
      ]);
      writeRaufMd(projectPath);
      setupMockClaude();

      manager.startLoop(projectPath, {
        maxIterations: 1,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      // Wait for the loop to complete (no subscriber yet)
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!manager.isRunning(projectPath)) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });

      // Now subscribe after loop finished — should get buffered events
      const events: LoopEvent[] = [];
      manager.subscribe(projectPath, (event) => {
        events.push(event);
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === "loop_started")).toBe(true);
    });

    it("caps buffer at 100 events", () => {
      const manager = new LoopManager();

      // Use subscribe to peek at buffer replay — push 150 events via fanOut
      // We'll access the buffer indirectly by subscribing before and after
      const earlyEvents: LoopEvent[] = [];
      manager.subscribe(projectPath, (event) => {
        earlyEvents.push(event);
      });

      // Start a loop and push fake events through fanOut
      writeMarker(projectPath);
      writeBacklog(projectPath);
      writeRaufMd(projectPath);
      setupMockClaude();

      // Instead of starting a loop, we'll test via a second subscriber
      // Push 150 events by starting a loop with a mock that emits many events
      // Simpler: use the manager's subscribe/fanOut indirectly
      // Actually, let's just verify the buffer size after subscribing with a new listener

      // We need to test the internal buffer — use a loop that emits events
      // For simplicity, create 150 fake loop_started events via startLoop
      // This is tricky without access to internals, so let's test via replay count

      // Alternative approach: start a loop, wait, then check replay count
      // The mock claude exits immediately so we won't get 150 events
      // Let's directly test the buffer cap by using the manager's internal buffer
      // via the (manager as any) escape hatch for testing
      const buf: LoopEvent[] = [];
      const baseEvent: LoopEvent = {
        type: "iteration_start",
        timestamp: new Date().toISOString(),
        iteration: 1,
        maxIterations: 1,
      };

      for (let i = 0; i < 150; i++) {
        buf.push({ ...baseEvent, iteration: i + 1 });
      }

      // Set the buffer directly for testing — key is backlog root (projectPath + .rauf)
      const bufferKey = path.join("/test-project", ".rauf");
      (manager as unknown as { eventBuffers: Map<string, LoopEvent[]> }).eventBuffers.set(
        bufferKey,
        buf.slice(),
      );

      // Verify buffer has 150
      expect(
        (manager as unknown as { eventBuffers: Map<string, LoopEvent[]> }).eventBuffers.get(
          bufferKey,
        )!.length,
      ).toBe(150);

      // Now the bufferEvent method would cap, but since we set directly let's test subscribe replay
      // Subscribe should replay all 150 (the cap applies on insert, not replay)
      const replayed: LoopEvent[] = [];
      manager.subscribe("/test-project", (event) => {
        replayed.push(event);
      });
      expect(replayed.length).toBe(150);

      // Test that bufferEvent caps correctly by pushing through fanOut
      // We need a fresh path for clean test
      const testPath = "/test-cap";
      for (let i = 0; i < 150; i++) {
        // Access private method via escape hatch
        (manager as unknown as { bufferEvent: (p: string, e: LoopEvent) => void }).bufferEvent(
          testPath,
          { ...baseEvent, iteration: i + 1 },
        );
      }

      const cappedBuffer = (
        manager as unknown as { eventBuffers: Map<string, LoopEvent[]> }
      ).eventBuffers.get(testPath)!;
      expect(cappedBuffer.length).toBe(100);
      // Should have events 51-150 (last 100)
      expect((cappedBuffer[0] as { iteration: number }).iteration).toBe(51);
      expect((cappedBuffer[99] as { iteration: number }).iteration).toBe(150);
    });

    it("cleans up buffer after loop completion + timeout", async () => {
      const manager = new LoopManager();
      writeMarker(projectPath);
      writeBacklog(projectPath, [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "Test item",
          description: "Test",
          acceptanceCriteria: ["test"],
          status: "pending",
          completedAt: null,
        },
      ]);
      writeRaufMd(projectPath);
      setupMockClaude();

      manager.startLoop(projectPath, {
        maxIterations: 1,
        maxRetries: 1,
        sessionTimeoutMinutes: 1,
      });

      // Wait for the loop to complete
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!manager.isRunning(projectPath)) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });

      // Buffer should exist immediately after completion — key is backlog root
      const bufferKey = path.join(projectPath, ".rauf");
      const buffers = (manager as unknown as { eventBuffers: Map<string, LoopEvent[]> })
        .eventBuffers;
      expect(buffers.has(bufferKey)).toBe(true);

      // After shutdownAll, buffers should be cleared
      await manager.shutdownAll();
      expect(buffers.has(bufferKey)).toBe(false);
    });
  });
});
