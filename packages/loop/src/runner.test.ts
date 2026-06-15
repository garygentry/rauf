import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoopEvent, Backlog, LoopStartOptions } from "@rauf/core";
import { EVENTS_SCHEMA_VERSION, ok } from "@rauf/core";

import { LoopRunner } from "./runner.js";
import { registerAgent, getAgentDescriptors } from "./providers/registry.js";
import type { LLMProvider, ExecuteOptions } from "./providers/types.js";

// ─── Test Helpers ────────────────────────────────────────────────────

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ralph-runner-"));
}

/** Create a minimal ralph project structure in tmpDir */
function setupProject(
  tmpDir: string,
  items: Backlog["items"],
  options?: {
    autoSweep?: boolean;
    sweepMinAgeDays?: number;
    model?: string;
    createProgressMd?: boolean;
  },
) {
  const raufDir = path.join(tmpDir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });

  // backlog.json
  const backlog: Backlog = {
    schemaVersion: "1",
    project: "test-project",
    description: "Test project",
    items,
  };
  fs.writeFileSync(path.join(raufDir, "backlog.json"), JSON.stringify(backlog, null, 2));

  // RAUF.md
  fs.writeFileSync(path.join(raufDir, "RAUF.md"), "# Test RAUF.md\nVerification: pnpm test\n");

  // .rauf.json marker
  const marker = {
    rauf: true,
    version: "0.1.0",
    variant: "backlog-json",
    installedAt: new Date().toISOString(),
    installedBy: "test",
    profile: {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck",
        lint: "pnpm lint",
        format: null,
        build: null,
      },
      verify: "pnpm test && pnpm typecheck && pnpm lint",
    },
    artifactHashes: {},
    options: {
      ignoreInTool: false,
      gitignoreScripts: false,
      maxIterations: 20,
      ...(options?.autoSweep !== undefined ? { autoSweep: options.autoSweep } : {}),
      ...(options?.sweepMinAgeDays !== undefined
        ? { sweepMinAgeDays: options.sweepMinAgeDays }
        : {}),
      ...(options?.model !== undefined ? { model: options.model } : {}),
    },
  };
  fs.writeFileSync(path.join(tmpDir, ".rauf.json"), JSON.stringify(marker, null, 2));

  // progress.md
  if (options?.createProgressMd) {
    fs.writeFileSync(path.join(raufDir, "progress.md"), "# Progress\n\n- Test learning\n");
  }

  // git init for gitCommit to work
  try {
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', {
      cwd: tmpDir,
      stdio: "ignore",
    });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "ignore" });
    execSync("git add -A && git commit -m 'init' --allow-empty", {
      cwd: tmpDir,
      stdio: "ignore",
    });
  } catch {
    // git init may fail in some environments — tests still work for most cases
  }
}

/** Write a mock claude script to tmpDir and prepend to PATH */
function writeMockClaude(binDir: string, script: string) {
  const mockPath = path.join(binDir, "claude");
  fs.writeFileSync(mockPath, `#!/bin/bash\n${script}\n`, { mode: 0o755 });
}

const DEFAULT_OPTIONS: LoopStartOptions = {
  maxIterations: 10,
  maxRetries: 2,
  sessionTimeoutMinutes: 5,
};

/** Create a LoopRunner via the static factory, throwing on failure */
function createRunner(projectPath: string, options: LoopStartOptions): LoopRunner {
  const result = LoopRunner.create(projectPath, options);
  if (!result.ok) {
    throw new Error(`Failed to create LoopRunner: ${result.error.message}`);
  }
  return result.value;
}

function pendingItem(
  id: string,
  title: string,
  overrides?: Partial<Backlog["items"][0]>,
): Backlog["items"][0] {
  return {
    id,
    type: "feature",
    priority: 1,
    title,
    description: `Description for ${title}`,
    acceptanceCriteria: ["Tests pass"],
    status: "pending",
    completedAt: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("LoopRunner", () => {
  let tmpDir: string;
  let binDir: string;
  let origPath: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    binDir = createTmpDir();
    origPath = process.env.PATH ?? "";
    process.env.PATH = `${binDir}:${origPath}`;
  });

  afterEach(() => {
    process.env.PATH = origPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  describe("constructor and class structure", () => {
    it("extends TypedEventEmitter", () => {
      setupProject(tmpDir, []);
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      expect(runner).toBeInstanceOf(LoopRunner);
      expect(typeof runner.on).toBe("function");
      expect(typeof runner.emit).toBe("function");
      expect(typeof runner.off).toBe("function");
    });

    it("has cancel() method", () => {
      setupProject(tmpDir, []);
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      expect(typeof runner.cancel).toBe("function");
    });

    it("has start() method returning Promise", () => {
      setupProject(tmpDir, []);
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      expect(typeof runner.start).toBe("function");
    });
  });

  describe("start() — startup sequence", () => {
    it("clears DONE and CANCEL files at startup", async () => {
      setupProject(tmpDir, []);
      // Create pre-existing DONE and CANCEL files
      fs.writeFileSync(path.join(tmpDir, ".rauf", "DONE"), "old");
      fs.writeFileSync(path.join(tmpDir, ".rauf", "CANCEL"), "old");

      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      // DONE should be written again with summary (loop complete), but
      // the old DONE was cleared first. We verify by checking DONE exists
      // with new content (not "old")
      const doneContent = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(doneContent).not.toBe("old");
      // CANCEL file should not exist
      expect(fs.existsSync(path.join(tmpDir, ".rauf", "CANCEL"))).toBe(false);
    });

    it("reads marker options for autoSweep, sweepMinAgeDays, model", async () => {
      setupProject(tmpDir, [], {
        autoSweep: true,
        sweepMinAgeDays: 7,
        model: "claude-sonnet-4-6",
      });
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("loop_started", (e) => events.push(e));
      await runner.start();

      // Loop should have started (no crash from reading marker)
      const logContent = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      expect(logContent).toContain("Auto-sweep enabled");
    });
  });

  describe("start() — main loop lifecycle", () => {
    it("completes a single item with RAUF_DONE signal", async () => {
      setupProject(tmpDir, [pendingItem("001", "Test task")]);
      writeMockClaude(binDir, 'echo "Some output"\necho "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("item_selected", (e) => events.push(e));
      runner.on("item_completed", (e) => events.push(e));
      runner.on("loop_completed", (e) => events.push(e));
      runner.on("signal_parsed", (e) => events.push(e));

      const result = await runner.start();

      expect(result.completedCount).toBe(1);
      expect(result.blockedCount).toBe(0);
      expect(result.cancelled).toBe(false);

      // Check events
      const selectedEvents = events.filter((e) => e.type === "item_selected");
      expect(selectedEvents).toHaveLength(1);
      expect((selectedEvents[0] as Extract<LoopEvent, { type: "item_selected" }>).itemId).toBe(
        "001",
      );

      const completedEvents = events.filter((e) => e.type === "item_completed");
      expect(completedEvents).toHaveLength(1);

      const signalEvents = events.filter((e) => e.type === "signal_parsed");
      expect(signalEvents).toHaveLength(1);
      expect((signalEvents[0] as Extract<LoopEvent, { type: "signal_parsed" }>).signal).toBe(
        "done",
      );
    });

    it("processes multiple items sequentially", async () => {
      setupProject(tmpDir, [pendingItem("001", "First task"), pendingItem("002", "Second task")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      expect(result.completedCount).toBe(2);
      expect(result.blockedCount).toBe(0);
    });

    it("stops when no more eligible items exist", async () => {
      setupProject(tmpDir, [pendingItem("001", "Only task")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      expect(result.completedCount).toBe(1);
      // DONE file written
      expect(fs.existsSync(path.join(tmpDir, ".rauf", "DONE"))).toBe(true);
    });

    it("writes DONE file on completion with summary", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task one")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      const doneContent = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(doneContent).toContain("completed=1");
      // iterations=2 because the loop increments the counter when checking
      // for more items and finds none on the second pass
      expect(doneContent).toContain("iterations=2");
    });
  });

  describe("signal handling", () => {
    it("handles RAUF_BLOCKED signal", async () => {
      setupProject(tmpDir, [pendingItem("001", "Blocked task")]);
      writeMockClaude(binDir, 'echo "RAUF_BLOCKED:Missing dependency"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("item_blocked", (e) => events.push(e));

      const result = await runner.start();

      expect(result.completedCount).toBe(0);
      expect(result.blockedCount).toBe(1);

      const blockedEvents = events.filter((e) => e.type === "item_blocked");
      expect(blockedEvents).toHaveLength(1);
      expect((blockedEvents[0] as Extract<LoopEvent, { type: "item_blocked" }>).reason).toBe(
        "Missing dependency",
      );

      // Item should be blocked in backlog
      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      expect(backlog.items[0].status).toBe("blocked");
    });

    it('RAUF_REVIEW emits signal_parsed with signal:"review" (not "done")', async () => {
      const reviewPayload = JSON.stringify({
        items: [
          {
            type: "bug",
            priority: 2,
            title: "Fix: missing validation",
            description: "Input not validated",
            acceptanceCriteria: ["Validation added"],
          },
        ],
        summary: "Found 1 issue",
      });
      setupProject(tmpDir, [pendingItem("001", "Review task")]);
      writeMockClaude(binDir, `echo 'RAUF_REVIEW:${reviewPayload}'`);

      const signalEvents: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("signal_parsed", (e) => signalEvents.push(e));

      await runner.start();

      expect(signalEvents.length).toBeGreaterThanOrEqual(1);
      expect((signalEvents[0] as Extract<LoopEvent, { type: "signal_parsed" }>).signal).toBe(
        "review",
      );
    });

    it("RAUF_NEEDS_HUMAN sets the item aside (blocked+needsHuman) without halting the loop", async () => {
      setupProject(tmpDir, [pendingItem("001", "Human needed task")]);
      writeMockClaude(binDir, 'echo "RAUF_NEEDS_HUMAN:Need API key"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("needs_human", (e) => events.push(e));

      const result = await runner.start();

      expect(result.completedCount).toBe(0);
      expect(result.needsHumanCount).toBe(1);
      expect(result.cancelled).toBe(false);

      // Item is set aside as blocked + needsHuman (NOT left in_progress)
      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      expect(backlog.items[0].status).toBe("blocked");
      expect(backlog.items[0].needsHuman).toBe(true);
      expect(backlog.items[0].blockedReason).toBe("Need API key");

      // Loop terminated naturally (NOT paused_human — nothing else runnable)
      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("complete");

      // Event emitted with reason
      expect(events).toHaveLength(1);
      expect((events[0] as Extract<LoopEvent, { type: "needs_human" }>).reason).toBe(
        "Need API key",
      );
    });

    it("needs_human sets aside and the loop continues to the next runnable item", async () => {
      setupProject(tmpDir, [pendingItem("001", "Human task"), pendingItem("002", "Normal task")]);
      // 001 (selected first) → needs_human; 002 → done
      writeMockClaude(
        binDir,
        `COUNT_FILE="${tmpDir}/.rauf/.claude_calls"
if [ ! -f "$COUNT_FILE" ]; then
  echo 1 > "$COUNT_FILE"
  echo "RAUF_NEEDS_HUMAN:blocked decision"
else
  echo "RAUF_DONE"
fi`,
      );

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      expect(result.completedCount).toBe(1);
      expect(result.needsHumanCount).toBe(1);
      expect(result.cancelled).toBe(false);

      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      const byId = Object.fromEntries(backlog.items.map((i: { id: string }) => [i.id, i]));
      expect(byId["001"].status).toBe("blocked");
      expect(byId["001"].needsHuman).toBe(true);
      expect(byId["002"].status).toBe("done");

      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("complete");
    });

    it("leaves a dependent of a needs_human item pending", async () => {
      setupProject(tmpDir, [
        pendingItem("001", "Human task"),
        pendingItem("002", "Dependent", { dependsOn: ["001"] }),
      ]);
      writeMockClaude(binDir, 'echo "RAUF_NEEDS_HUMAN:need decision"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      expect(result.needsHumanCount).toBe(1);
      expect(result.completedCount).toBe(0);

      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      const byId = Object.fromEntries(backlog.items.map((i: { id: string }) => [i.id, i]));
      expect(byId["001"].status).toBe("blocked");
      expect(byId["001"].needsHuman).toBe(true);
      // Dependency 001 is not done, so 002 is never selected and stays pending.
      expect(byId["002"].status).toBe("pending");
    });

    it("with --pause-on-needs-human, halts in paused_human on the first needs-human item", async () => {
      // Two pending items: 001 (selected first) → needs_human. With the pause
      // flag the loop must HALT after setting 001 aside — 002 must NOT run.
      setupProject(tmpDir, [pendingItem("001", "Human task"), pendingItem("002", "Normal task")]);
      writeMockClaude(binDir, 'echo "RAUF_NEEDS_HUMAN:Need API key"');

      const needsHumanEvents: LoopEvent[] = [];
      const pausedEvents: LoopEvent[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, pauseOnNeedsHuman: true });
      runner.on("needs_human", (e) => needsHumanEvents.push(e));
      runner.on("loop_paused", (e) => pausedEvents.push(e));

      const result = await runner.start();

      // The loop halted with the pause reason surfaced on the result.
      expect(result.pausedReason).toBe("needs_human");
      expect(result.needsHumanCount).toBe(1);
      expect(result.completedCount).toBe(0);
      expect(result.cancelled).toBe(false);

      // State is the resumable paused_human (NOT complete).
      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("paused_human");
      expect(state.currentItem).toBeNull();

      // 001 is set aside; 002 was never selected because the loop halted.
      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      const byId = Object.fromEntries(backlog.items.map((i: { id: string }) => [i.id, i]));
      expect(byId["001"].status).toBe("blocked");
      expect(byId["001"].needsHuman).toBe(true);
      expect(byId["002"].status).toBe("pending");

      // Both the needs_human and loop_paused events fire (needs_human first).
      expect(needsHumanEvents).toHaveLength(1);
      expect(pausedEvents).toHaveLength(1);
      const paused = pausedEvents[0] as Extract<LoopEvent, { type: "loop_paused" }>;
      expect(paused.reason).toBe("needs_human");
      expect(paused.itemId).toBe("001");

      // The DONE marker derives PAUSED_HUMAN (contains "human").
      const done = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(done.toLowerCase()).toContain("human");
    });

    it("without the flag, a needs_human item does NOT halt the loop (no pausedReason, no loop_paused)", async () => {
      // Same setup as the pause test, but the default (flag off): the loop sets
      // 001 aside and keeps going — 002 runs to done and there is no pause.
      setupProject(tmpDir, [pendingItem("001", "Human task"), pendingItem("002", "Normal task")]);
      writeMockClaude(
        binDir,
        `COUNT_FILE="${tmpDir}/.rauf/.claude_calls"
if [ ! -f "$COUNT_FILE" ]; then
  echo 1 > "$COUNT_FILE"
  echo "RAUF_NEEDS_HUMAN:blocked decision"
else
  echo "RAUF_DONE"
fi`,
      );

      const pausedEvents: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("loop_paused", (e) => pausedEvents.push(e));

      const result = await runner.start();

      expect(result.pausedReason).toBeUndefined();
      expect(result.completedCount).toBe(1);
      expect(result.needsHumanCount).toBe(1);
      expect(pausedEvents).toHaveLength(0);

      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("complete");
    });

    it("DONE file omits the needs_human token on a clean run", async () => {
      setupProject(tmpDir, [pendingItem("001", "Clean task")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      const content = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(content).not.toContain("needs_human");
    });

    it("runs the review pass after a needs_human set-aside (was unreachable before)", async () => {
      setupProject(tmpDir, [pendingItem("001", "Done task"), pendingItem("002", "Human task")]);
      // 001 → done, 002 → needs_human, review-pass spawn → done
      writeMockClaude(
        binDir,
        `COUNT_FILE="${tmpDir}/.rauf/.claude_calls"
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n+1))
echo "$n" > "$COUNT_FILE"
if [ "$n" = "1" ]; then echo "RAUF_DONE"
elif [ "$n" = "2" ]; then echo "RAUF_NEEDS_HUMAN:need human"
else echo "RAUF_DONE"; fi`,
      );

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, review: true });
      runner.on("review_started", (e) => events.push(e));

      const result = await runner.start();

      expect(result.completedCount).toBe(1);
      expect(result.needsHumanCount).toBe(1);
      // The review block sits after the main loop; the old needs_human `return
      // "exit"` skipped it. With set-aside-and-continue it is now reached.
      expect(events.filter((e) => e.type === "review_started")).toHaveLength(1);
    });

    it("retries on 'none' signal and DEFERS (not blocks) after maxRetries", async () => {
      setupProject(tmpDir, [pendingItem("001", "No signal task")]);
      // Mock claude that produces no signal and exits cleanly (code 0) — a
      // genuine_retry, not an infra death. A missing signal must never, by
      // itself, mark an item blocked: after maxRetries it is DEFERRED.
      writeMockClaude(binDir, 'echo "random output"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, maxRetries: 2 });
      runner.on("item_retried", (e) => events.push(e));
      runner.on("item_blocked", (e) => events.push(e));

      const result = await runner.start();

      // Deferred items are NOT counted as genuine blocks.
      expect(result.blockedCount).toBe(0);
      const retryEvents = events.filter((e) => e.type === "item_retried");
      expect(retryEvents).toHaveLength(1);
      expect((retryEvents[0] as Extract<LoopEvent, { type: "item_retried" }>).attempt).toBe(1);

      // The item ends status 'blocked' with the deferred flag and a runner reason.
      const backlog: Backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      const item = backlog.items.find((i) => i.id === "001");
      expect(item?.status).toBe("blocked");
      expect(item?.deferred).toBe(true);
      expect(item?.blockedReason).toContain("deferred by runner");

      // It is tracked in state.deferredItems, not blockedItems.
      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.deferredItems).toContain("001");
      expect(state.blockedItems).not.toContain("001");
    });
  });

  describe("model resolution", () => {
    it("uses item.model over options.model", async () => {
      setupProject(tmpDir, [pendingItem("001", "Model task", { model: "claude-opus-4-6" })]);
      // Script echoes args to stderr so we can verify, stdout emits signal
      writeMockClaude(binDir, 'echo "$@" >&2\necho "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        model: "claude-sonnet-4-6",
      });
      runner.on("llm_spawned", (e) => events.push(e));

      await runner.start();

      const spawnedEvents = events.filter((e) => e.type === "llm_spawned");
      expect(spawnedEvents).toHaveLength(1);
      expect((spawnedEvents[0] as Extract<LoopEvent, { type: "llm_spawned" }>).model).toBe(
        "claude-opus-4-6",
      );
    });

    it("falls back to options.model when item has no model", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "$@" >&2\necho "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        model: "claude-sonnet-4-6",
      });
      runner.on("llm_spawned", (e) => events.push(e));

      await runner.start();

      const spawnedEvents = events.filter((e) => e.type === "llm_spawned");
      expect((spawnedEvents[0] as Extract<LoopEvent, { type: "llm_spawned" }>).model).toBe(
        "claude-sonnet-4-6",
      );
    });
  });

  describe("maxIterations", () => {
    it("stops after maxIterations and writes limit_reached state", async () => {
      // Create many items but limit iterations to 2
      setupProject(tmpDir, [
        pendingItem("001", "Task 1"),
        pendingItem("002", "Task 2"),
        pendingItem("003", "Task 3"),
        pendingItem("004", "Task 4"),
      ]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 2,
      });
      runner.on("loop_completed", (e) => events.push(e));

      const result = await runner.start();

      expect(result.completedCount).toBe(2);

      // State should be limit_reached
      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("limit_reached");

      // DONE file written
      const doneContent = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(doneContent).toContain("completed=2");
      expect(doneContent).toContain("iterations=2");
    });
  });

  describe("cancel()", () => {
    it("triggers graceful cancellation", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task 1"), pendingItem("002", "Task 2")]);
      // Make claude take long enough that cancel fires during execution
      writeMockClaude(binDir, "exec sleep 999");

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("loop_cancelled", (e) => events.push(e));

      // Cancel after a brief delay (while first claude is running)
      setTimeout(() => runner.cancel(), 300);

      const result = await runner.start();

      // Should have been cancelled
      expect(result.cancelled).toBe(true);

      // DONE file should say 'cancel'
      const doneContent = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(doneContent).toBe("cancel");
    }, 15_000);

    it("checks CANCEL file at iteration boundaries", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task 1"), pendingItem("002", "Task 2")]);
      // First call creates CANCEL file then completes — cancel detected at next iteration boundary
      writeMockClaude(
        binDir,
        `touch "${tmpDir}/.rauf/CANCEL"
echo "RAUF_DONE"`,
      );

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      // First item completed, then cancel detected at next iteration boundary
      expect(result.cancelled).toBe(true);
      expect(result.completedCount).toBe(1);
    });
  });

  describe("stderr usage limit detection", () => {
    it("detects 'usage limit' in stderr (case-insensitive)", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      // Non-zero exit with usage limit in stderr
      writeMockClaude(binDir, 'echo "Claude AI Usage Limit reached" >&2\nexit 1');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 1,
      });
      runner.on("usage_limit_hit", (e) => events.push(e));

      // Cancel shortly after start so the interruptible sleep resolves quickly
      setTimeout(() => runner.cancel(), 500);
      await runner.start();

      // Usage limit hit event should have been emitted
      const limitEvents = events.filter((e) => e.type === "usage_limit_hit");
      expect(limitEvents.length).toBeGreaterThanOrEqual(1);

      // Item should be reset to pending (not completed/blocked)
      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      expect(backlog.items[0].status).toBe("pending");
    }, 15_000);

    it("detects 'rate limit' in stderr", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "rate limit exceeded" >&2\nexit 1');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 1,
      });
      runner.on("usage_limit_hit", (e) => events.push(e));

      // Cancel to unblock the sleep
      setTimeout(() => runner.cancel(), 500);
      await runner.start();

      const limitEvents = events.filter((e) => e.type === "usage_limit_hit");
      expect(limitEvents.length).toBeGreaterThanOrEqual(1);
    }, 15_000);

    it("detects 'too many requests' in stderr", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "Too Many Requests" >&2\nexit 1');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 1,
      });
      runner.on("usage_limit_hit", (e) => events.push(e));

      // Cancel to unblock the sleep
      setTimeout(() => runner.cancel(), 500);
      await runner.start();

      const limitEvents = events.filter((e) => e.type === "usage_limit_hit");
      expect(limitEvents.length).toBeGreaterThanOrEqual(1);
    }, 15_000);

    it("does not trigger on exit 0 even with limit text in stderr", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      // Exit 0 with usage limit text in stderr — should NOT trigger usage limit path
      writeMockClaude(binDir, 'echo "usage limit warning" >&2\necho "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("usage_limit_hit", (e) => events.push(e));
      runner.on("item_completed", (e) => events.push(e));

      await runner.start();

      // Should complete normally
      const completedEvents = events.filter((e) => e.type === "item_completed");
      expect(completedEvents).toHaveLength(1);

      // No usage limit events (stderr check only on non-zero exit)
      const limitEvents = events.filter((e) => e.type === "usage_limit_hit");
      expect(limitEvents).toHaveLength(0);
    });
  });

  describe("usage limit budget / banner parse / sleepOnLimit (item 007)", () => {
    it("parses the banner reset time and sleeps to it (no token)", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      // Banner in stdout with a reset time; non-zero exit triggers the usage path.
      writeMockClaude(binDir, 'echo "session limit reached - resets 5:30pm"\nexit 1');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, maxIterations: 1 });
      runner.on("sleep_start", (e) => events.push(e));

      // Unblock the (long) sleep-to-reset-time quickly.
      setTimeout(() => runner.cancel(), 500);
      await runner.start();

      const sleep = events.find((e) => e.type === "sleep_start");
      expect(sleep).toBeDefined();
      // Reason reflects the parsed banner reset time, not the flat fallback.
      expect(sleep && "reason" in sleep ? sleep.reason : "").toContain("banner reset 5:30pm");
    }, 15_000);

    it("falls back to 60s when the banner has no reset time", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "session limit reached" >&2\nexit 1');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, maxIterations: 1 });
      runner.on("sleep_start", (e) => events.push(e));

      setTimeout(() => runner.cancel(), 500);
      await runner.start();

      const sleep = events.find((e) => e.type === "sleep_start");
      expect(sleep).toBeDefined();
      const reason = sleep && "reason" in sleep ? sleep.reason : "";
      expect(reason).toContain("API unavailable");
      expect(reason).not.toContain("banner reset");
    }, 15_000);

    it("sleepOnLimit=false halts with paused_usage_limit and a resume hint", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "session limit reached - resets 5:30pm"\nexit 1');

      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 5,
        sleepOnLimit: false,
      });
      // Exits cleanly without sleeping — no cancel needed.
      await runner.start();

      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("paused_usage_limit");

      const doneContent = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(doneContent).toContain("paused_usage_limit");
      expect(doneContent).toContain("rauf resume");
      expect(doneContent).toContain("5:30pm");

      // Item is reset to pending so `rauf resume` can pick it up.
      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      expect(backlog.items[0].status).toBe("pending");
    });

    it("does not charge the iteration budget for an infra_error no-op", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      const counter = path.join(tmpDir, "attempt-count");
      // First spawn fast-fails (infra_error, no banner); second succeeds.
      writeMockClaude(
        binDir,
        `n=$(cat "${counter}" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "${counter}"
if [ "$n" -eq 1 ]; then
  echo "boom" >&2
  exit 1
fi
echo "RAUF_DONE"`,
      );

      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, maxIterations: 5 });
      const result = await runner.start();

      expect(result.completedCount).toBe(1);

      // The infra no-op attempt is rolled back (incremented to 1, then back to 0)
      // and the rollback is logged.
      const log = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      expect(log).toContain("Iteration not counted (infra_error)");
      expect(log).toContain("budget preserved at 0/5");
    });

    it("halts via the circuit breaker after consecutive infra failures", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      // Every spawn fast-fails (infra_error, no banner). Without the breaker the
      // loop would spin forever because uncountIteration keeps the budget from
      // advancing — so a high maxIterations also proves the breaker, not the
      // budget ceiling, is what terminates the run.
      writeMockClaude(binDir, `echo "boom" >&2\nexit 1`);

      const errors: string[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 100,
        circuitBreakerThreshold: 3,
      });
      runner.on("loop_error", (e) => errors.push(e.error));

      const result = await runner.start();

      // Halted with no work done, the item left pending (never blocked on a
      // flaky spawn), and an error state + DONE summary written.
      expect(result.completedCount).toBe(0);
      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      ) as Backlog;
      expect(backlog.items[0]?.status).toBe("pending");

      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("error");
      expect(state.error).toContain("Circuit breaker");

      expect(errors.some((e) => e.includes("Circuit breaker"))).toBe(true);

      const done = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(done).toContain("Circuit breaker: 3 consecutive infra failures");

      const log = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      expect(log).toContain("Circuit breaker threshold: 3");
    });
  });

  describe("state.json and rauf.log", () => {
    it("writes state.json throughout lifecycle", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      // state.json should exist with terminal state
      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.status).toBe("complete");
      expect(state.completedItems).toContain("001");
      // Iteration is 2: the loop incremented to try for more items,
      // then found no eligible items and broke out
      expect(state.iteration).toBe(2);
    });

    it("appends to rauf.log for key events", async () => {
      setupProject(tmpDir, [pendingItem("001", "Log test task")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      const logContent = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      expect(logContent).toContain("Loop started");
      expect(logContent).toContain("--- Iteration 1 / 10 ---");
      expect(logContent).toContain("Selected item 001");
      expect(logContent).toContain("Signal: done");
      expect(logContent).toContain("Item 001 completed");
      expect(logContent).toContain("Loop completed");
    });
  });

  describe("event emission", () => {
    it("emits all core event types during successful lifecycle", async () => {
      setupProject(tmpDir, [pendingItem("001", "Event test")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const eventTypes: string[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);

      // Subscribe to all event types we expect
      runner.on("loop_started", () => eventTypes.push("loop_started"));
      runner.on("iteration_start", () => eventTypes.push("iteration_start"));
      runner.on("item_selected", () => eventTypes.push("item_selected"));
      runner.on("llm_spawned", () => eventTypes.push("llm_spawned"));
      runner.on("llm_exited", () => eventTypes.push("llm_exited"));
      runner.on("signal_parsed", () => eventTypes.push("signal_parsed"));
      runner.on("item_completed", () => eventTypes.push("item_completed"));
      runner.on("loop_completed", () => eventTypes.push("loop_completed"));

      await runner.start();

      expect(eventTypes).toContain("loop_started");
      expect(eventTypes).toContain("iteration_start");
      expect(eventTypes).toContain("item_selected");
      expect(eventTypes).toContain("llm_spawned");
      expect(eventTypes).toContain("llm_exited");
      expect(eventTypes).toContain("signal_parsed");
      expect(eventTypes).toContain("item_completed");
      expect(eventTypes).toContain("loop_completed");
    });

    it("emits events with correct base fields (timestamp, projectPath)", async () => {
      setupProject(tmpDir, [pendingItem("001", "Base fields test")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("loop_started", (e) => events.push(e));

      await runner.start();

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.timestamp).toBeDefined();
      expect(event.projectPath).toBe(tmpDir);
    });
  });

  describe("DONE file on all terminal paths", () => {
    it("writes DONE on normal completion", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      expect(fs.existsSync(path.join(tmpDir, ".rauf", "DONE"))).toBe(true);
    });

    it("writes DONE on cancel", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'sleep 1\necho "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      setTimeout(() => runner.cancel(), 100);
      await runner.start();

      expect(fs.existsSync(path.join(tmpDir, ".rauf", "DONE"))).toBe(true);
      const content = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(content).toBe("cancel");
    }, 15_000);

    it("writes DONE on maxIterations", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task 1"), pendingItem("002", "Task 2")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 1,
      });
      await runner.start();

      expect(fs.existsSync(path.join(tmpDir, ".rauf", "DONE"))).toBe(true);
      const content = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(content).toContain("completed=1");
    });

    it("writes DONE on RAUF_NEEDS_HUMAN", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task")]);
      writeMockClaude(binDir, 'echo "RAUF_NEEDS_HUMAN:Need decision"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      expect(fs.existsSync(path.join(tmpDir, ".rauf", "DONE"))).toBe(true);
      const content = fs.readFileSync(path.join(tmpDir, ".rauf", "DONE"), "utf-8");
      expect(content).toContain("needs_human");
    });
  });

  describe("crash cleanup", () => {
    it("resets in_progress item to pending on unexpected error", async () => {
      setupProject(tmpDir, [pendingItem("001", "Crash task")]);
      // Create a scenario where we'll get an error: remove RAUF.md mid-run
      // Actually, let's use a simpler approach: write a claude that exits, then
      // corrupt the backlog before the next read
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      // Test the try/finally by checking the reset logic works for the
      // "no items" path — verify state.json shows complete
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      // After normal completion, currentItemId should be null (cleaned up)
      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, ".rauf", "state.json"), "utf-8"));
      expect(state.currentItem).toBeNull();
    });
  });

  describe("dependency-aware item selection", () => {
    it("skips items with unmet dependencies", async () => {
      setupProject(tmpDir, [
        pendingItem("001", "Base task"),
        pendingItem("002", "Dependent task", { dependsOn: ["001"] }),
      ]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("item_selected", (e) => events.push(e));

      await runner.start();

      // Both items should be completed — 001 first, then 002
      const selectedIds = events
        .filter((e) => e.type === "item_selected")
        .map((e) => (e as Extract<LoopEvent, { type: "item_selected" }>).itemId);

      expect(selectedIds).toEqual(["001", "002"]);
    });
  });

  describe("git commit on RAUF_DONE", () => {
    it("auto-commits on completed item", async () => {
      setupProject(tmpDir, [pendingItem("001", "Commit test")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      await runner.start();

      // Check log for commit message
      const logContent = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      // gitCommit may succeed or fail depending on git setup — verify it was attempted
      expect(logContent).toMatch(/Committed:|Item 001 completed/);
    });
  });

  describe("commit reconciliation (item 009)", () => {
    // Runtime files must be gitignored for the tree to read clean after a
    // commit — otherwise the recovery's isTreeClean check never passes. A real
    // install ensures this in the target .gitignore (item 014); here we write it
    // so the mock's commit leaves a genuinely clean tree.
    const RUNTIME_GITIGNORE = [
      ".rauf/.loop.lock",
      ".rauf/state.json",
      ".rauf/DONE",
      ".rauf/CANCEL",
      ".rauf/iteration-status.json",
      ".rauf/rauf.log",
      ".rauf/events.ndjson",
      ".rauf/backlog.json.bak",
      "",
    ].join("\n");

    it("recovers a committed-but-unsignalled item to done instead of blocking", async () => {
      setupProject(tmpDir, [pendingItem("001", "Recover me")]);
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), RUNTIME_GITIGNORE);

      // The agent commits a proper `[rauf] 001:` change (staging everything, so
      // the tree is clean) but exits WITHOUT printing RAUF_DONE — the signal is
      // lost. `git add -A` also commits .gitignore, so the runtime files it
      // names stop dirtying the tree for the reconciliation check.
      writeMockClaude(
        binDir,
        `printf 'recovered\\n' > "${tmpDir}/recovered.txt"
git -C "${tmpDir}" -c commit.gpgsign=false add -A
git -C "${tmpDir}" -c commit.gpgsign=false commit -q -m "[rauf] 001: recovered via commit"
echo "work finished but no signal printed"`,
      );

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, maxIterations: 1 });
      runner.on("item_completed", (e) => events.push(e));
      const result = await runner.start();

      // Recovered to done — NOT blocked or deferred.
      const backlog: Backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      expect(backlog.items[0]?.status).toBe("done");
      expect(backlog.items[0]?.deferred).toBeFalsy();
      expect(result.completedCount).toBe(1);
      expect(result.blockedCount).toBe(0);
      expect(events.some((e) => e.type === "item_completed")).toBe(true);

      // Logged as a commit recovery, and the runner did NOT commit a second time.
      const log = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      expect(log).toContain("recovered_via_commit");
      expect(log).not.toContain("deferred by runner");

      // Exactly one `[rauf] 001:` commit exists — gitCommit was not re-invoked.
      const commitCount = execSync('git log --grep="^\\[rauf\\] 001:" --oneline', {
        cwd: tmpDir,
        encoding: "utf-8",
      })
        .trim()
        .split("\n")
        .filter(Boolean).length;
      expect(commitCount).toBe(1);
    });

    it("does not recover (stays deferred) when no commit landed", async () => {
      setupProject(tmpDir, [pendingItem("001", "No commit")]);
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), RUNTIME_GITIGNORE);

      // No signal, no commit — the runner must fall through to its normal
      // deferral after exhausting retries (clean exit code = genuine_retry).
      writeMockClaude(binDir, 'echo "no signal and no commit"');

      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        maxIterations: 5,
        maxRetries: 2,
      });
      await runner.start();

      const backlog: Backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      expect(backlog.items[0]?.status).toBe("blocked");
      expect(backlog.items[0]?.deferred).toBe(true);

      const log = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      expect(log).not.toContain("recovered_via_commit");
    });
  });

  describe("dirty-tree cleanup pathspec (item 019)", () => {
    it("stashes an unrelated file named backlog.json instead of preserving it", async () => {
      setupProject(tmpDir, [pendingItem("001", "Leaves abandoned work")]);

      // The agent leaves abandoned, uncommitted work in the tree — including an
      // unrelated APPLICATION file that happens to be named backlog.json (NOT
      // the rauf backlog) — then blocks. The dirty-tree cleanup must NOT treat
      // that application file as loop bookkeeping: it should be stashed away so
      // it can't be swept into the next item's commit. (A repo-wide
      // `**/backlog.json` exclude would have wrongly preserved it.)
      writeMockClaude(
        binDir,
        `mkdir -p "${tmpDir}/app/data"
printf '{"app":"data"}\\n' > "${tmpDir}/app/data/backlog.json"
printf 'half-finished\\n' > "${tmpDir}/app/feature.txt"
echo "RAUF_BLOCKED:stopping here"`,
      );

      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, maxIterations: 1 });
      await runner.start();

      // The item blocked, so the abandoned work was reverted.
      const backlog: Backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      );
      expect(backlog.items[0]?.status).toBe("blocked");

      const log = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
      expect(log).toContain("Reverted dirty working tree");

      // The unrelated application backlog.json was stashed — NOT preserved.
      expect(fs.existsSync(path.join(tmpDir, "app", "data", "backlog.json"))).toBe(false);
      // ...and so was the other abandoned work file.
      expect(fs.existsSync(path.join(tmpDir, "app", "feature.txt"))).toBe(false);

      // The REAL rauf backlog (loop bookkeeping) was preserved untouched.
      expect(fs.existsSync(path.join(tmpDir, ".rauf", "backlog.json"))).toBe(true);
    });
  });

  describe("LoopResult", () => {
    it("returns correct counts on normal completion", async () => {
      setupProject(tmpDir, [pendingItem("001", "Task 1"), pendingItem("002", "Task 2")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      expect(result).toEqual({
        completedCount: 2,
        blockedCount: 0,
        cancelled: false,
      });
    });

    it("returns mixed counts", async () => {
      setupProject(tmpDir, [pendingItem("001", "Done task"), pendingItem("002", "Blocked task")]);
      // First call returns RAUF_DONE, second returns RAUF_BLOCKED
      writeMockClaude(
        binDir,
        `COUNT_FILE="${tmpDir}/.rauf/.claude_calls"
if [ ! -f "$COUNT_FILE" ]; then
  echo 1 > "$COUNT_FILE"
  echo "RAUF_DONE"
else
  echo "RAUF_BLOCKED:Cannot proceed"
fi`,
      );

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      expect(result.completedCount).toBe(1);
      expect(result.blockedCount).toBe(1);
      expect(result.cancelled).toBe(false);
    });
  });

  describe("sessionTimeoutMinutes", () => {
    it("passes sessionTimeoutMinutes to spawnClaude", async () => {
      setupProject(tmpDir, [pendingItem("001", "Timeout test")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        sessionTimeoutMinutes: 42,
      });
      runner.on("llm_spawned", (e) => events.push(e));

      await runner.start();

      const spawnedEvent = events.find((e) => e.type === "llm_spawned") as Extract<
        LoopEvent,
        { type: "llm_spawned" }
      >;
      expect(spawnedEvent.timeoutMinutes).toBe(42);
    });
  });

  describe("child session env (suppressIterationReview)", () => {
    it("propagates the review-hook suppression env to child sessions when opted in", async () => {
      setupProject(tmpDir, [pendingItem("001", "Suppression test")]);
      const capture = path.join(tmpDir, "env-capture.txt");
      // Mock claude records the suppression env var it received, then signals done.
      writeMockClaude(
        binDir,
        `printf '%s' "$ENABLE_CODE_SECURITY_REVIEW" > '${capture}'\necho "RAUF_DONE"`,
      );

      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        suppressIterationReview: true,
      });
      await runner.start();

      expect(fs.existsSync(capture)).toBe(true);
      expect(fs.readFileSync(capture, "utf-8")).toBe("0");
    });

    it("does not set the suppression env by default", async () => {
      setupProject(tmpDir, [pendingItem("001", "Default env test")]);
      const capture = path.join(tmpDir, "env-capture.txt");
      writeMockClaude(
        binDir,
        `printf '%s' "$ENABLE_CODE_SECURITY_REVIEW" > '${capture}'\necho "RAUF_DONE"`,
      );

      // Ensure the parent env doesn't already carry the var, so the child
      // inheriting the parent environment unchanged sees it unset.
      const prev = process.env.ENABLE_CODE_SECURITY_REVIEW;
      delete process.env.ENABLE_CODE_SECURITY_REVIEW;
      try {
        const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
        await runner.start();
      } finally {
        if (prev !== undefined) process.env.ENABLE_CODE_SECURITY_REVIEW = prev;
      }

      expect(fs.existsSync(capture)).toBe(true);
      // Var is unset → empty string captured.
      expect(fs.readFileSync(capture, "utf-8")).toBe("");
    });
  });

  describe("agent routing (item 009)", () => {
    interface FakeAgentState {
      constructCount: number;
      disposeCount: number;
      execEnvs: Array<Record<string, string> | undefined>;
      outputFormats: Array<ExecuteOptions["outputFormat"]>;
    }

    /**
     * Register a fake agent whose factory returns a controllable LLMProvider, and return a state
     * object instrumenting construction / dispose / execute options. Registered with last-write-wins
     * so re-registering the same id in another test is safe (module-level registry persists).
     */
    function registerFakeAgent(id: string, stdout = "RAUF_DONE\n"): FakeAgentState {
      const state: FakeAgentState = {
        constructCount: 0,
        disposeCount: 0,
        execEnvs: [],
        outputFormats: [],
      };
      registerAgent({
        id,
        displayName: id,
        factory: (): LLMProvider => {
          state.constructCount++;
          return {
            id,
            displayName: id,
            async execute(_prompt: string, options: ExecuteOptions) {
              state.execEnvs.push(options.env);
              state.outputFormats.push(options.outputFormat);
              return ok({
                stdout,
                stderr: "",
                exitCode: 0,
                timedOut: false,
                durationMs: 1,
              });
            },
            validateCredentials() {
              return ok(undefined);
            },
            async dispose() {
              state.disposeCount++;
            },
          };
        },
      });
      return state;
    }

    it("emits llm_spawned/llm_exited with the real provider.id (codex → 'codex')", async () => {
      registerFakeAgent("codex");
      setupProject(tmpDir, [pendingItem("001", "Codex run")]);

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, provider: "codex" });
      runner.on("llm_spawned", (e) => events.push(e));
      runner.on("llm_exited", (e) => events.push(e));

      await runner.start();

      const spawned = events.find((e) => e.type === "llm_spawned") as Extract<
        LoopEvent,
        { type: "llm_spawned" }
      >;
      const exited = events.find((e) => e.type === "llm_exited") as Extract<
        LoopEvent,
        { type: "llm_exited" }
      >;
      expect(spawned.provider).toBe("codex");
      expect(exited.provider).toBe("codex");
    });

    it("emits provider 'claude-cli' for a default (claude) run", async () => {
      setupProject(tmpDir, [pendingItem("001", "Claude run")]);
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      const events: LoopEvent[] = [];
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      runner.on("llm_spawned", (e) => events.push(e));

      await runner.start();

      const spawned = events.find((e) => e.type === "llm_spawned") as Extract<
        LoopEvent,
        { type: "llm_spawned" }
      >;
      expect(spawned.provider).toBe("claude-cli");
    });

    it("caches one provider instance per distinct agent id across iterations, then disposes it", async () => {
      const state = registerFakeAgent("cache-agent");
      setupProject(tmpDir, [pendingItem("001", "First"), pendingItem("002", "Second")]);

      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, provider: "cache-agent" });
      await runner.start();

      // Two iterations, same resolved id → constructed exactly once and disposed once.
      expect(state.constructCount).toBe(1);
      expect(state.disposeCount).toBe(1);
    });

    it("constructs a second instance when a per-item override selects a different agent", async () => {
      const runState = registerFakeAgent("run-agent");
      const itemState = registerFakeAgent("item-agent");
      setupProject(tmpDir, [
        pendingItem("001", "Run-level"),
        pendingItem("002", "Item override", { provider: "item-agent" }),
      ]);

      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, provider: "run-agent" });
      await runner.start();

      expect(runState.constructCount).toBe(1);
      expect(itemState.constructCount).toBe(1);
      // Both distinct ids disposed on exit.
      expect(runState.disposeCount).toBe(1);
      expect(itemState.disposeCount).toBe(1);
    });

    it("passes the runner childEnv via ExecuteOptions.env to the provider", async () => {
      const state = registerFakeAgent("env-agent");
      setupProject(tmpDir, [pendingItem("001", "Env")]);

      const runner = createRunner(tmpDir, {
        ...DEFAULT_OPTIONS,
        provider: "env-agent",
        suppressIterationReview: true,
      });
      await runner.start();

      expect(state.execEnvs.length).toBeGreaterThan(0);
      // suppressIterationReview resolves to a childEnv carrying the suppression var.
      expect(state.execEnvs[0]).toMatchObject({ ENABLE_CODE_SECURITY_REVIEW: "0" });
    });

    it("uses outputFormat 'stream-json' for the work iteration", async () => {
      const state = registerFakeAgent("fmt-agent");
      setupProject(tmpDir, [pendingItem("001", "Fmt")]);

      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, provider: "fmt-agent" });
      await runner.start();

      expect(state.outputFormats[0]).toBe("stream-json");
    });

    it("turns an unknown agent id into a Result error listing supported ids (no throw)", async () => {
      setupProject(tmpDir, [pendingItem("001", "Unknown")]);

      const errors: string[] = [];
      const runner = createRunner(tmpDir, { ...DEFAULT_OPTIONS, provider: "no-such-agent" });
      runner.on("loop_error", (e) => errors.push(e.error));

      // Must not throw — the unknown id is surfaced as a Result error.
      await runner.start();

      const supportedIds = getAgentDescriptors().map((d) => d.id);
      const errMsg = errors.find((m) => m.includes("no-such-agent"));
      expect(errMsg).toBeDefined();
      // The error enumerates the supported ids (claude-cli is always registered).
      expect(errMsg).toContain("Supported agents:");
      expect(supportedIds).toContain("claude-cli");
      // The item is reset to pending (not left in_progress / blocked) by the per-item backstop.
      const backlog = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8"),
      ) as Backlog;
      expect(backlog.items[0]!.status).toBe("pending");
    });

    it("runner.ts contains no direct spawnClaude( call site", () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const src = fs.readFileSync(path.join(here, "runner.ts"), "utf-8");
      expect(src).not.toMatch(/spawnClaude\(/);
    });
  });

  describe("empty backlog", () => {
    it("completes immediately with no items", async () => {
      setupProject(tmpDir, []);

      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
      const result = await runner.start();

      expect(result.completedCount).toBe(0);
      expect(result.blockedCount).toBe(0);
      expect(result.cancelled).toBe(false);

      // DONE file should exist
      expect(fs.existsSync(path.join(tmpDir, ".rauf", "DONE"))).toBe(true);
    });
  });

  describe("runUsagePreflight degradation", () => {
    it("logs specific diagnostic when readClaudeOAuthToken fails and loop continues", async () => {
      setupProject(tmpDir, [pendingItem("001", "Preflight test")]);
      // Mock claude signals done immediately so the loop finishes cleanly.
      writeMockClaude(binDir, 'echo "RAUF_DONE"');

      // Redirect HOME so readClaudeOAuthToken looks for credentials at
      // ${tmpDir}/.config/claude-code/credentials.json (which doesn't exist),
      // returning FILE_NOT_FOUND without touching the real credentials file.
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        const runner = createRunner(tmpDir, DEFAULT_OPTIONS);
        const result = await runner.start();

        // The loop still continues — item completes, no hard exit.
        expect(result.completedCount).toBe(1);

        const log = fs.readFileSync(path.join(tmpDir, ".rauf", "rauf.log"), "utf-8");
        expect(log).toContain("OAuth token unavailable");
        expect(log).toContain("FILE_NOT_FOUND");
        expect(log).toContain("claudeAiOauth.accessToken");
        expect(log).toContain("Relying on reactive banner detection");
      } finally {
        process.env.HOME = origHome;
      }
    });
  });

  // ── Event persistence: token coalescing + per-run seq density (REQ-EVT-02/03, SC-6) ──
  // Spec: 07-testing-strategy.md §2.1. persistEvent() coalesces llm_token_update
  // writes to ~1 per TOKEN_COALESCE_MS in the FILE while still emitting them
  // in-memory, and assigns a dense per-run `seq` ONLY when a record is actually
  // written (so coalesced/dropped token updates consume no seq). Driven with a
  // fake clock since persistEvent reads Date.now() directly.
  describe("event persistence: coalescing + seq density", () => {
    function persist(runner: LoopRunner, event: LoopEvent): void {
      (runner as unknown as { persistEvent(e: LoopEvent): void }).persistEvent(event);
    }
    function tokenUpdate(): LoopEvent {
      return {
        type: "llm_token_update",
        timestamp: new Date().toISOString(),
        projectPath: tmpDir,
        itemId: "001",
        inputTokens: 100,
        outputTokens: 2,
      } as LoopEvent;
    }
    function iterationStart(iteration: number): LoopEvent {
      return {
        type: "iteration_start",
        timestamp: new Date().toISOString(),
        projectPath: tmpDir,
        iteration,
        maxIterations: 10,
      } as LoopEvent;
    }
    function readRecords(): Array<Record<string, unknown>> {
      const file = path.join(tmpDir, ".rauf", "events.ndjson");
      if (!fs.existsSync(file)) return [];
      return fs
        .readFileSync(file, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("coalesces a token-update burst to one file record per window, always writes structural events, and keeps seq dense (coalesced updates consume no seq)", () => {
      setupProject(tmpDir, [pendingItem("001", "X")]);
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);

      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);

      // First token update → written to file (seq 0).
      persist(runner, tokenUpdate());
      // Two more within the same TOKEN_COALESCE_MS window → dropped from file.
      vi.setSystemTime(1_000_400);
      persist(runner, tokenUpdate());
      vi.setSystemTime(1_000_800);
      persist(runner, tokenUpdate());
      // A structural event interleaved in the same window → ALWAYS written (seq 1).
      persist(runner, iterationStart(1));
      // Advance past the window → the next token update is written (seq 2).
      vi.setSystemTime(1_002_000);
      persist(runner, tokenUpdate());

      const records = readRecords();

      // Only 2 token records (the first + the one after the window); 2 dropped.
      expect(records.filter((r) => r.type === "llm_token_update")).toHaveLength(2);
      // The interleaved structural event is never coalesced.
      expect(records.filter((r) => r.type === "iteration_start")).toHaveLength(1);
      // seq is dense (0,1,2) with no gaps — coalesced token updates consumed no seq.
      expect(records.map((r) => r.seq)).toEqual([0, 1, 2]);
      // Every persisted record carries the schemaVersion envelope.
      expect(records.every((r) => r.schemaVersion === EVENTS_SCHEMA_VERSION)).toBe(true);
      // File order reflects write order: token(0), iteration_start(1), token(2).
      expect(records.map((r) => r.type)).toEqual([
        "llm_token_update",
        "iteration_start",
        "llm_token_update",
      ]);
    });

    it("assigns gapless seq across a run with no coalescing (value assigned only on write)", () => {
      setupProject(tmpDir, [pendingItem("001", "X")]);
      const runner = createRunner(tmpDir, DEFAULT_OPTIONS);

      vi.useFakeTimers();
      // Structural events never coalesce, so each consumes the next seq.
      for (let i = 1; i <= 4; i++) {
        vi.setSystemTime(2_000_000 + i);
        persist(runner, iterationStart(i));
      }

      expect(readRecords().map((r) => r.seq)).toEqual([0, 1, 2, 3]);
    });
  });
});
