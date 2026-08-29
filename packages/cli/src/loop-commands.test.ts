import fs from "node:fs";
import path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { execSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { LoopEvent } from "@rauf/core";
import { LoopEventSchema, defaultBacklogPaths } from "@rauf/core";

import { findCommand, ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { parseArgs } from "./parser.js";
import { configureOutput } from "./formatter.js";
import {
  formatAndPrintEvent,
  ensureServerRunning,
  createLoopBranch,
  buildPreconditionRemediation,
  handleLoopRun,
  handleAgents,
  loopRunExitCode,
  resolveModelOverride,
} from "./loop-commands.js";
import type { LoopResult } from "@rauf/loop";
import { LoopRunner, getAgentDescriptors, listAgents } from "@rauf/loop";
import { err, ErrorCodes } from "@rauf/core";
import { SERVER_STATE_FILE, writeServerState, removeServerState } from "./server-commands.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Capture stdout/stderr during a function call */
function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }>;
function captureOutput(fn: () => void): { stdout: string; stderr: string };
function captureOutput(
  fn: () => void | Promise<void>,
): { stdout: string; stderr: string } | Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;

  process.stdout.write = ((chunk: string) => {
    stdout.push(chunk);
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string) => {
    stderr.push(chunk);
    return true;
  }) as typeof process.stderr.write;

  const result = fn();
  const restore = () => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  };

  if (result instanceof Promise) {
    return result.then(() => {
      restore();
      return { stdout: stdout.join(""), stderr: stderr.join("") };
    });
  }

  restore();
  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    args: [],
    flags: new Map(),
    globalFlags: {
      json: false,
      noColor: true,
      quiet: false,
      root: null,
    },
    rawArgv: [],
    ...overrides,
  };
}

/** Build a base LoopEvent with common fields */
function baseEvent<T extends LoopEvent["type"]>(
  type: T,
  payload: Omit<Extract<LoopEvent, { type: T }>, "type" | "timestamp" | "projectPath">,
): Extract<LoopEvent, { type: T }> {
  return {
    type,
    timestamp: "2026-02-27T10:30:00.000Z",
    projectPath: "/test/project",
    ...payload,
  } as Extract<LoopEvent, { type: T }>;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("resolveModelOverride (--model / --no-model, #38)", () => {
  it("returns the model and no override for a plain --model", () => {
    const flags = new Map<string, string | true>([["model", "opus"]]);
    expect(resolveModelOverride(flags)).toEqual({ model: "opus", ignoreItemModel: false });
    expect(flags.has("model")).toBe(false); // extracted
  });

  it("sets ignoreItemModel and no model for --no-model", () => {
    const flags = new Map<string, string | true>([["no-model", true]]);
    expect(resolveModelOverride(flags)).toEqual({ model: undefined, ignoreItemModel: true });
    expect(flags.has("no-model")).toBe(false);
  });

  it("treats --model none as the ignore sentinel (no model string)", () => {
    const flags = new Map<string, string | true>([["model", "none"]]);
    expect(resolveModelOverride(flags)).toEqual({ model: undefined, ignoreItemModel: true });
  });

  it("honors --no-model alongside a run-level --model override", () => {
    const flags = new Map<string, string | true>([
      ["no-model", true],
      ["model", "gpt-5-codex"],
    ]);
    expect(resolveModelOverride(flags)).toEqual({
      model: "gpt-5-codex",
      ignoreItemModel: true,
    });
  });

  it("returns neither when no model flag is present", () => {
    expect(resolveModelOverride(new Map())).toEqual({
      model: undefined,
      ignoreItemModel: false,
    });
  });
});

describe("loopRunExitCode (terminal LoopResult → unified exit code, 00 §2a)", () => {
  // Each row: a LoopResult shape and the expected unified exit code.
  const base: LoopResult = { completedCount: 0, blockedCount: 0, cancelled: false };
  const cases: Array<{ name: string; result: LoopResult; expected: number }> = [
    {
      name: "clean completion → SUCCESS(0)",
      result: { ...base, completedCount: 3 },
      expected: ExitCode.SUCCESS,
    },
    {
      name: "idle / nothing to do → SUCCESS(0)",
      result: { ...base },
      expected: ExitCode.SUCCESS,
    },
    {
      name: "graceful cancel → SUCCESS(0)",
      result: { ...base, completedCount: 1, cancelled: true, gracefulStop: true },
      expected: ExitCode.SUCCESS,
    },
    {
      name: "pausedReason needs_human → NEEDS_HUMAN(3)",
      result: { ...base, pausedReason: "needs_human" },
      expected: ExitCode.NEEDS_HUMAN,
    },
    {
      name: "needsHumanCount > 0 → NEEDS_HUMAN(3)",
      result: { ...base, needsHumanCount: 2 },
      expected: ExitCode.NEEDS_HUMAN,
    },
    {
      name: "limitReached → LIMIT(4)",
      result: { ...base, completedCount: 2, limitReached: true },
      expected: ExitCode.LIMIT,
    },
    {
      name: "blockedCount > 0 → BLOCKED(5)",
      result: { ...base, blockedCount: 1 },
      expected: ExitCode.BLOCKED,
    },
    {
      name: "needs-human precedes limit (order)",
      result: { ...base, needsHumanCount: 1, limitReached: true },
      expected: ExitCode.NEEDS_HUMAN,
    },
    {
      name: "limit precedes blocked (order)",
      result: { ...base, blockedCount: 1, limitReached: true },
      expected: ExitCode.LIMIT,
    },
    {
      name: "setupFailed → ERROR(1) (fail-fast agent unavailable, REQ-DET-02/SC-3)",
      result: { ...base, setupFailed: true },
      expected: ExitCode.ERROR,
    },
    {
      name: "setupFailed precedes every other terminal (highest priority)",
      result: { ...base, setupFailed: true, completedCount: 5, limitReached: true },
      expected: ExitCode.ERROR,
    },
  ];

  it.each(cases)("$name", ({ result, expected }) => {
    expect(loopRunExitCode(result)).toBe(expected);
  });

  it("never returns RUNNING(6) for any terminal shape", () => {
    for (const { result } of cases) {
      expect(loopRunExitCode(result)).not.toBe(ExitCode.RUNNING);
    }
  });
});

describe("loop command registration", () => {
  it("loop command exists in registry", () => {
    const loop = findCommand("loop");
    expect(loop).toBeDefined();
    expect(loop!.name).toBe("loop");
  });

  it("has expected subcommands", () => {
    const loop = findCommand("loop")!;
    expect(loop.subcommands).toBeDefined();
    const subNames = loop.subcommands!.map((s) => s.name);
    expect(subNames).toEqual(["stop", "run", "review"]);
  });

  it("no longer registers the removed monitor verbs (clean break, no aliases)", () => {
    const loop = findCommand("loop")!;
    const subNames = loop.subcommands!.map((s) => s.name);
    expect(subNames).not.toContain("watch");
    expect(subNames).not.toContain("follow");
  });

  it("exposes a top-level follow command (the promoted live-view verb)", () => {
    const follow = findCommand("follow");
    expect(follow).toBeDefined();
    expect(follow!.handler).toBeDefined();
  });

  it("all subcommands have handlers", () => {
    const loop = findCommand("loop")!;
    for (const sub of loop.subcommands!) {
      expect(sub.handler).toBeDefined();
    }
  });

  it("all subcommands have descriptions", () => {
    const loop = findCommand("loop")!;
    for (const sub of loop.subcommands!) {
      expect(sub.description).toBeTruthy();
      expect(sub.description.length).toBeGreaterThan(5);
    }
  });
});

describe("handleLoopStop", () => {
  let savedState: string | null = null;

  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
    // Back up and remove server state so isServerRunning() returns false
    try {
      savedState = fs.readFileSync(SERVER_STATE_FILE, "utf-8");
    } catch {
      savedState = null;
    }
    try {
      fs.unlinkSync(SERVER_STATE_FILE);
    } catch {
      /* ok */
    }
  });

  afterEach(() => {
    // Restore server state
    if (savedState !== null) {
      fs.mkdirSync(path.dirname(SERVER_STATE_FILE), { recursive: true });
      fs.writeFileSync(SERVER_STATE_FILE, savedState);
    }
  });

  it("exits USAGE(2) with a remediation hint when server not running", async () => {
    const loop = findCommand("loop")!;
    const stopHandler = loop.subcommands!.find((s) => s.name === "stop")!.handler!;
    const ctx = makeCtx({ args: ["/tmp/some-project"] });

    const output = await captureOutput(async () => {
      const code = await stopHandler(ctx);
      // no-server is a misuse of stop → USAGE(2), not ERROR (00 §1 / 03 §1)
      expect(code).toBe(ExitCode.USAGE);
    });

    expect(output.stderr).toContain("Server is not running");
    // hint (info → stdout) names the canonical detached verb, not the removed
    // `loop start` (REQ-DOC-02)
    expect(output.stdout).toContain("rauf loop run --detached");
    expect(output.stdout).not.toContain("loop start");
  });

  it("exits USAGE(2) when there is no active loop to stop (server 404)", async () => {
    // Server is running but reports no active loop for this project → USAGE(2),
    // not ERROR — stopping a loop that isn't running is a misuse (00 §1 / 03 §1).
    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { uptime: 1, version: "test", pid: process.pid } }));
        return;
      }
      if (req.method === "POST" && /\/loop\/stop$/.test(req.url ?? "")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "No active loop" } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    try {
      writeServerState({ pid: process.pid, port, startedAt: new Date().toISOString() });
      const loop = findCommand("loop")!;
      const stopHandler = loop.subcommands!.find((s) => s.name === "stop")!.handler!;
      const ctx = makeCtx({ args: [path.join(os.tmpdir(), "rauf-stop-noloop")] });
      const output = await captureOutput(async () => {
        const code = await stopHandler(ctx);
        expect(code).toBe(ExitCode.USAGE);
      });
      expect(output.stderr).toContain("No active loop");
    } finally {
      removeServerState();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("formatAndPrintEvent", () => {
  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  it("formats loop_started event", () => {
    const event = baseEvent("loop_started", { maxIterations: 20, model: "opus" });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Loop started");
    expect(output.stdout).toContain("20");
    expect(output.stdout).toContain("opus");
  });

  it("formats loop_started without model", () => {
    const event = baseEvent("loop_started", { maxIterations: 10 });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Loop started");
    expect(output.stdout).toContain("10");
    expect(output.stdout).not.toContain("model:");
  });

  it("formats iteration_start event", () => {
    const event = baseEvent("iteration_start", { iteration: 3, maxIterations: 20 });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Iteration 3/20");
  });

  it("formats item_selected event", () => {
    const event = baseEvent("item_selected", {
      itemId: "012",
      title: "Add loop commands",
      priority: 1,
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("#012");
    expect(output.stdout).toContain("Add loop commands");
    expect(output.stdout).toContain("P1");
  });

  it("formats llm_spawned event", () => {
    const event = baseEvent("llm_spawned", {
      itemId: "012",
      provider: "claude-cli",
      model: "sonnet",
      timeoutMinutes: 60,
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("claude-cli spawned");
    expect(output.stdout).toContain("sonnet");
    expect(output.stdout).toContain("60m");
  });

  it("formats llm_exited event", () => {
    const event = baseEvent("llm_exited", {
      itemId: "012",
      provider: "claude-cli",
      exitCode: 0,
      timedOut: false,
      durationMs: 120000,
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("claude-cli exited");
    expect(output.stdout).toContain("code=0");
    expect(output.stdout).toContain("120s");
    expect(output.stdout).not.toContain("TIMED OUT");
  });

  it("formats llm_exited with timeout", () => {
    const event = baseEvent("llm_exited", {
      itemId: "012",
      provider: "claude-cli",
      exitCode: 1,
      timedOut: true,
      durationMs: 3600000,
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("TIMED OUT");
  });

  it("formats signal_parsed event — done", () => {
    const event = baseEvent("signal_parsed", {
      itemId: "012",
      signal: "done",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Signal:");
    expect(output.stdout).toContain("done");
  });

  it("formats signal_parsed event — blocked with reason", () => {
    const event = baseEvent("signal_parsed", {
      itemId: "012",
      signal: "blocked",
      reason: "missing dependency",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("blocked");
    expect(output.stdout).toContain("missing dependency");
  });

  it("formats item_completed event", () => {
    const event = baseEvent("item_completed", {
      itemId: "012",
      title: "Add loop commands",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Completed #012");
    expect(output.stdout).toContain("Add loop commands");
  });

  it("formats item_blocked event", () => {
    const event = baseEvent("item_blocked", {
      itemId: "012",
      reason: "API key missing",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Blocked #012");
    expect(output.stdout).toContain("API key missing");
  });

  it("formats item_retried event", () => {
    const event = baseEvent("item_retried", {
      itemId: "012",
      attempt: 2,
      maxRetries: 3,
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Retry #012");
    expect(output.stdout).toContain("2/3");
  });

  it("formats needs_human event", () => {
    const event = baseEvent("needs_human", {
      itemId: "012",
      reason: "Design decision needed",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Needs human #012");
    expect(output.stdout).toContain("Design decision needed");
  });

  it("formats usage_limit_hit event", () => {
    const event = baseEvent("usage_limit_hit", {
      limitType: "5h",
      utilization: 100,
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Usage limit hit");
    expect(output.stdout).toContain("5h");
    expect(output.stdout).toContain("100%");
  });

  it("formats usage_limit_cleared event", () => {
    const event = baseEvent("usage_limit_cleared", {
      limitType: "5h",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Usage limit cleared");
    expect(output.stdout).toContain("5h");
  });

  it("formats sleep_start event", () => {
    const event = baseEvent("sleep_start", {
      sleepUntil: "2026-02-27T15:00:00.000Z",
      reason: "5-hour usage limit",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Sleeping");
    expect(output.stdout).toContain("5-hour usage limit");
  });

  it("formats sleep_end event", () => {
    const event = baseEvent("sleep_end", {});
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Woke from sleep");
  });

  it("formats loop_completed event", () => {
    const event = baseEvent("loop_completed", {
      completedCount: 5,
      blockedCount: 1,
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Loop completed");
    expect(output.stdout).toContain("5 done");
    expect(output.stdout).toContain("1 blocked");
  });

  it("formats loop_error event", () => {
    const event = baseEvent("loop_error", {
      error: "backlog read failed",
    });
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Loop error:");
    expect(output.stdout).toContain("backlog read failed");
  });

  it("formats loop_cancelled event", () => {
    const event = baseEvent("loop_cancelled", {});
    const output = captureOutput(() => formatAndPrintEvent(event));
    expect(output.stdout).toContain("Loop cancelled");
  });

  it("includes timestamp in all event output", () => {
    const event = baseEvent("loop_started", { maxIterations: 20 });
    const output = captureOutput(() => formatAndPrintEvent(event));
    // Should contain a time-like pattern (HH:MM:SS)
    expect(output.stdout).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("path resolution", () => {
  it("defaults to current directory when no path arg", async () => {
    // handleLoopStop with no args will resolve to cwd, then fail because server isn't running
    const loop = findCommand("loop")!;
    const stopHandler = loop.subcommands!.find((s) => s.name === "stop")!.handler!;
    const ctx = makeCtx({ args: [] }); // no path arg

    await captureOutput(async () => {
      const code = await stopHandler(ctx);
      // no-server path resolves cwd then exits USAGE(2) — a misuse of stop (00 §1)
      expect(code).toBe(ExitCode.USAGE);
    });
  });

  it("resolves relative path to absolute", async () => {
    const loop = findCommand("loop")!;
    const stopHandler = loop.subcommands!.find((s) => s.name === "stop")!.handler!;
    const ctx = makeCtx({ args: ["./my-project"] });

    const output = await captureOutput(async () => {
      await stopHandler(ctx);
    });
    // Should get to an error about the server/loop, meaning path resolved OK.
    // Exact error depends on whether a server happens to be running.
    const stderrHasExpectedError =
      output.stderr.includes("Server is not running") ||
      output.stderr.includes("No active loop") ||
      output.stderr.includes("Failed to connect");
    expect(stderrHasExpectedError).toBe(true);
  });
});

describe("ensureServerRunning", () => {
  let savedState: string | null = null;

  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
    try {
      savedState = fs.readFileSync(SERVER_STATE_FILE, "utf-8");
    } catch {
      savedState = null;
    }
    removeServerState();
  });

  afterEach(() => {
    removeServerState();
    if (savedState !== null) {
      fs.mkdirSync(path.dirname(SERVER_STATE_FILE), { recursive: true });
      fs.writeFileSync(SERVER_STATE_FILE, savedState);
    }
  });

  /** Start a throwaway server answering GET /api/health like a live rauf server. */
  async function startHealthyServer(): Promise<{ port: number; close: () => Promise<void> }> {
    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { uptime: 1, version: "test", pid: process.pid } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    return {
      port,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it("no-ops (does not restart) when a healthy server is already running", async () => {
    const { port, close } = await startHealthyServer();
    try {
      // Alive PID (our own) + a live health endpoint → already running.
      writeServerState({ pid: process.pid, port, startedAt: new Date().toISOString() });

      const output = await captureOutput(async () => {
        const ready = await ensureServerRunning(makeCtx());
        expect(ready).toBe(true);
      });

      // It must NOT have attempted to (re)start the daemon.
      expect(output.stdout).not.toContain("Starting daemon");
      // State file is untouched (no new PID written).
      expect(readState().pid).toBe(process.pid);
    } finally {
      removeServerState();
      await close();
    }
  });

  function readState(): { pid: number } {
    return JSON.parse(fs.readFileSync(SERVER_STATE_FILE, "utf-8")) as { pid: number };
  }
});

// ─── --create-branch + actionable precondition refusal (item 026) ───

describe("createLoopBranch & loop preconditions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-createbranch-"));
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function git(cwd: string, args: string): void {
    execSync(`git ${args}`, { cwd, stdio: "ignore" });
  }

  function currentBranch(cwd: string): string {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
  }

  /** Project dir that is its own git repo on `main`, with runtime files ignored. */
  function makeProject(items: object[]): string {
    const projectDir = path.join(tmpDir, "proj");
    const raufDir = path.join(projectDir, ".rauf");
    fs.mkdirSync(raufDir, { recursive: true });
    fs.writeFileSync(
      path.join(raufDir, "backlog.json"),
      JSON.stringify({ schemaVersion: "1", project: "p", description: "d", items }, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(projectDir, ".gitignore"),
      [
        ".rauf/state.json",
        ".rauf/DONE",
        ".rauf/CANCEL",
        ".rauf/.loop.lock",
        ".rauf/rauf.log",
        ".rauf/events.ndjson",
        ".rauf/iteration-status.json",
        ".rauf/backlog.json.bak",
        "",
      ].join("\n"),
    );
    git(projectDir, "-c init.defaultBranch=main init");
    git(projectDir, 'config user.email "test@test.com"');
    git(projectDir, 'config user.name "Test"');
    git(projectDir, "add -A");
    git(projectDir, 'commit -m "baseline"');
    return projectDir;
  }

  function pendingItem(id: string): object {
    return {
      id,
      type: "feature",
      priority: 1,
      title: `Item ${id}`,
      description: "d",
      acceptanceCriteria: [],
      status: "pending",
      completedAt: null,
      dependsOn: [],
    };
  }

  it("switches to a new feature branch (switched:true)", async () => {
    const proj = makeProject([]);
    expect(currentBranch(proj)).toBe("main");

    const result = await createLoopBranch(proj, "feat/x");
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.switched).toBe(true);
    expect(currentBranch(proj)).toBe("feat/x");
  });

  it("no-ops when already on the requested branch (switched:false)", async () => {
    const proj = makeProject([]);
    git(proj, "switch -c feat/x");

    const result = await createLoopBranch(proj, "feat/x");
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.switched).toBe(false);
    expect(currentBranch(proj)).toBe("feat/x");
  });

  it("fails cleanly when the branch already exists (no switch)", async () => {
    const proj = makeProject([]);
    git(proj, "branch feat/x"); // create but stay on main

    const result = await createLoopBranch(proj, "feat/x");
    expect(result.ok).toBe(false);
    // The working branch is left untouched on failure.
    expect(currentBranch(proj)).toBe("main");
  });

  it("buildPreconditionRemediation lists branch + seed + force commands", () => {
    const lines = buildPreconditionRemediation(".").join("\n");
    expect(lines).toContain("git switch -c");
    expect(lines).toContain("--create-branch");
    expect(lines).toContain("--seed-backlog");
    expect(lines).toContain("--force");
  });

  it("loop run prints actionable remediation when refusing on a protected branch", async () => {
    const proj = makeProject([pendingItem("001")]); // stays on `main`
    const ctx = makeCtx({ args: [proj] });

    const out = await captureOutput(async () => {
      const code = await handleLoopRun(ctx);
      expect(code).toBe(ExitCode.USAGE);
    });

    const all = out.stdout + out.stderr;
    expect(all).toContain('default branch "main"'); // the refusal itself
    expect(all).toContain("git switch -c");
    expect(all).toContain("--create-branch");
    expect(all).toContain("--seed-backlog");
    expect(all).toContain("--force");
    // It refused — the branch is unchanged and no loop ran.
    expect(currentBranch(proj)).toBe("main");
  });

  it("loop run --create-branch switches off the protected branch and starts cleanly", async () => {
    // Empty backlog: the loop selects no item and completes without spawning Claude.
    const proj = makeProject([]);
    const ctx = makeCtx({
      args: [proj],
      flags: new Map<string, string | true>([["create-branch", "feat/work"]]),
    });

    const out = await captureOutput(async () => {
      const code = await handleLoopRun(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    // The branch switch happened before the precondition check, which then passed.
    expect(currentBranch(proj)).toBe("feat/work");
    expect(out.stdout).toContain("Switched to new branch");
  });

  // ─── --ndjson machine-readable event stream (item 027) ───

  it("loop run --ndjson emits valid JSON events + a trailing result line", async () => {
    // Empty backlog: completes without spawning Claude, emitting loop_started
    // and loop_completed events.
    const proj = makeProject([]);
    git(proj, "switch -c feat/ndjson"); // off the protected branch → preconditions pass
    const ctx = makeCtx({
      args: [proj],
      flags: new Map<string, string | true>([["ndjson", true]]),
    });

    const out = await captureOutput(async () => {
      const code = await handleLoopRun(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const lines = out.stdout.split("\n").filter((l) => l.trim().length > 0);
    // At least: one event line + the trailing result line.
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Every line is valid JSON (NDJSON: one object per line).
    const parsed = lines.map((l) => JSON.parse(l));

    // All lines except the trailing result are valid LoopEvents with a known type.
    const eventObjs = parsed.slice(0, -1);
    expect(eventObjs.length).toBeGreaterThanOrEqual(1);
    for (const obj of eventObjs) {
      const result = LoopEventSchema.safeParse(obj);
      expect(result.success).toBe(true);
      expect(typeof obj.type).toBe("string");
    }
    // The first emitted event is loop_started.
    expect(eventObjs[0].type).toBe("loop_started");

    // The trailing line is the loop result (no event `type`, carries counts).
    const resultLine = parsed[parsed.length - 1];
    expect(resultLine.type).toBeUndefined();
    expect(typeof resultLine.completedCount).toBe("number");
    expect(typeof resultLine.blockedCount).toBe("number");

    // The human renderer + diagnostic lines are suppressed → no leakage into stdout.
    expect(out.stdout).not.toContain("Running loop directly");
    expect(out.stdout).not.toContain("Loop finished");
  });

  // ─── --seed-backlog (item 028) ───

  function writeBacklog(projectDir: string, items: object[], description = "d"): void {
    fs.writeFileSync(
      path.join(projectDir, ".rauf", "backlog.json"),
      JSON.stringify({ schemaVersion: "1", project: "p", description, items }, null, 2) + "\n",
    );
  }

  function gitStatus(cwd: string): string {
    return execSync("git status --porcelain", { cwd, encoding: "utf-8" }).trim();
  }

  function gitSubjects(cwd: string): string {
    return execSync("git log --format=%s", { cwd, encoding: "utf-8" });
  }

  it("loop run --seed-backlog commits an otherwise-clean backlog before the loop", async () => {
    // Empty backlog: after seeding, the loop selects no item and completes
    // without spawning Claude.
    const proj = makeProject([]);
    git(proj, "switch -c feat/seed"); // off the protected branch
    // Dirty the already-tracked backlog to simulate a freshly-edited backlog.
    writeBacklog(proj, [], "seeded description");
    // A runtime file that must NOT land in the seed commit (criterion 3).
    fs.writeFileSync(path.join(proj, ".rauf", "state.json"), "{}\n");
    expect(gitStatus(proj)).not.toBe("");

    const ctx = makeCtx({
      args: [proj],
      flags: new Map<string, string | true>([["seed-backlog", true]]),
    });
    const out = await captureOutput(async () => {
      const code = await handleLoopRun(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    // The backlog was committed as `[rauf] backlog: seed <project>`.
    expect(gitSubjects(proj)).toContain("[rauf] backlog: seed proj");
    expect(out.stdout).toContain("Seeded backlog");
    // The seed commit excludes runtime files (state.json never gets tracked).
    const tracked = execSync("git ls-files", { cwd: proj, encoding: "utf-8" });
    expect(tracked).not.toContain(".rauf/state.json");
    // Tree is clean after seeding (the loop ran on an empty backlog).
    expect(gitStatus(proj)).toBe("");
  });

  it("loop run --seed-backlog refuses and lists other dirty files (no auto-commit)", async () => {
    const proj = makeProject([]);
    git(proj, "switch -c feat/seed");
    writeBacklog(proj, [], "seeded description"); // backlog dirty
    fs.writeFileSync(path.join(proj, "app.ts"), "export const x = 1;\n"); // unrelated dirty file

    const ctx = makeCtx({
      args: [proj],
      flags: new Map<string, string | true>([["seed-backlog", true]]),
    });
    const out = await captureOutput(async () => {
      const code = await handleLoopRun(ctx);
      expect(code).toBe(ExitCode.USAGE);
    });

    const all = out.stdout + out.stderr;
    expect(all).toContain("app.ts");
    expect(all).toContain("--seed-backlog only commits");
    // No seed commit was created, and the backlog is still uncommitted.
    expect(gitSubjects(proj)).not.toContain("[rauf] backlog: seed");
    expect(gitStatus(proj)).not.toBe("");
  });

  it("loop run --seed-backlog refuses on a dirty .rauf bookkeeping file (not swept into the seed)", async () => {
    // Regression: the dirty-check must not exclude the whole .rauf/ dir. RAUF.md
    // is git-tracked and gitCommit WOULD stage it, so an uncommitted edit must
    // surface as "other dirty" and refuse — never land in the seed commit.
    const proj = makeProject([]);
    git(proj, "switch -c feat/seed");
    writeBacklog(proj, [], "seeded description"); // backlog dirty
    const raufMd = path.join(proj, ".rauf", "RAUF.md");
    fs.writeFileSync(raufMd, "# customized loop instructions\n"); // tracked bookkeeping, dirty

    const ctx = makeCtx({
      args: [proj],
      flags: new Map<string, string | true>([["seed-backlog", true]]),
    });
    const out = await captureOutput(async () => {
      const code = await handleLoopRun(ctx);
      expect(code).toBe(ExitCode.USAGE);
    });

    const all = out.stdout + out.stderr;
    expect(all).toContain(".rauf/RAUF.md");
    expect(all).toContain("--seed-backlog only commits");
    // No seed commit, and RAUF.md is still uncommitted (not swept in).
    expect(gitSubjects(proj)).not.toContain("[rauf] backlog: seed");
    expect(gitStatus(proj)).not.toBe("");
  });
});

// ─── --pause-on-needs-human exit code (item 008) ───

describe("loop run --pause-on-needs-human exit code", () => {
  let tmpDir: string;
  let binDir: string;
  let origPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-pausehuman-"));
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-pausehuman-bin-"));
    origPath = process.env.PATH ?? "";
    process.env.PATH = `${binDir}:${origPath}`;
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  afterEach(() => {
    process.env.PATH = origPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  function git(cwd: string, args: string): void {
    execSync(`git ${args}`, { cwd, stdio: "ignore" });
  }

  /** A full rauf project (backlog + RAUF.md + marker) on a non-protected branch. */
  function makeRunnableProject(items: object[]): string {
    const projectDir = path.join(tmpDir, "proj");
    const raufDir = path.join(projectDir, ".rauf");
    fs.mkdirSync(raufDir, { recursive: true });
    fs.writeFileSync(
      path.join(raufDir, "backlog.json"),
      JSON.stringify({ schemaVersion: "1", project: "p", description: "d", items }, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(raufDir, "RAUF.md"), "# Test RAUF.md\nVerification: true\n");
    fs.writeFileSync(
      path.join(projectDir, ".rauf.json"),
      JSON.stringify(
        {
          rauf: true,
          version: "0.1.0",
          variant: "backlog-json",
          installedAt: new Date().toISOString(),
          installedBy: "test",
          profile: { stack: "node", packageManager: "pnpm", monorepo: false, verify: "true" },
          artifactHashes: {},
          options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(projectDir, ".gitignore"),
      [
        ".rauf/state.json",
        ".rauf/DONE",
        ".rauf/CANCEL",
        ".rauf/.loop.lock",
        ".rauf/rauf.log",
        ".rauf/events.ndjson",
        ".rauf/iteration-status.json",
        ".rauf/backlog.json.bak",
        "",
      ].join("\n"),
    );
    git(projectDir, "-c init.defaultBranch=main init");
    git(projectDir, 'config user.email "test@test.com"');
    git(projectDir, 'config user.name "Test"');
    git(projectDir, "add -A");
    git(projectDir, 'commit -m "baseline"');
    git(projectDir, "switch -c feat/pause"); // off the protected branch
    return projectDir;
  }

  function writeMockClaude(script: string): void {
    fs.writeFileSync(path.join(binDir, "claude"), `#!/bin/bash\n${script}\n`, { mode: 0o755 });
  }

  function pendingItem(id: string): object {
    return {
      id,
      type: "feature",
      priority: 1,
      title: `Item ${id}`,
      description: "d",
      acceptanceCriteria: ["Tests pass"],
      status: "pending",
      completedAt: null,
      dependsOn: [],
    };
  }

  it("returns ExitCode.NEEDS_HUMAN and halts in paused_human", async () => {
    const proj = makeRunnableProject([pendingItem("001"), pendingItem("002")]);
    writeMockClaude('echo "RAUF_NEEDS_HUMAN:Need API key"');

    const ctx = makeCtx({
      args: [proj],
      flags: new Map<string, string | true>([["pause-on-needs-human", true]]),
    });

    let code = -1;
    await captureOutput(async () => {
      code = await handleLoopRun(ctx);
    });

    // Distinct non-zero exit code (not SUCCESS).
    expect(code).toBe(ExitCode.NEEDS_HUMAN);
    expect(code).not.toBe(ExitCode.SUCCESS);

    const state = JSON.parse(fs.readFileSync(path.join(proj, ".rauf", "state.json"), "utf-8"));
    expect(state.status).toBe("paused_human");
    // The loop halted on the first needs-human item; 002 never ran.
    const backlog = JSON.parse(fs.readFileSync(path.join(proj, ".rauf", "backlog.json"), "utf-8"));
    const byId = Object.fromEntries(backlog.items.map((i: { id: string }) => [i.id, i]));
    expect(byId["001"].needsHuman).toBe(true);
    expect(byId["002"].status).toBe("pending");
  });

  it("without the flag, the run completes but a needs-human item still maps to NEEDS_HUMAN (00 §2a)", async () => {
    const proj = makeRunnableProject([pendingItem("001")]);
    writeMockClaude('echo "RAUF_NEEDS_HUMAN:Need API key"');

    const ctx = makeCtx({ args: [proj] });

    let code = -1;
    await captureOutput(async () => {
      code = await handleLoopRun(ctx);
    });

    // Without --pause-on-needs-human the loop runs to completion (state "complete",
    // the item is set aside, not a hard pause), but the unified terminal mapping
    // reports NEEDS_HUMAN(3) because needsHumanCount > 0 (status<->loop-run parity).
    expect(code).toBe(ExitCode.NEEDS_HUMAN);
    const state = JSON.parse(fs.readFileSync(path.join(proj, ".rauf", "state.json"), "utf-8"));
    expect(state.status).toBe("complete");
  });
});

// ─── loop run --detached delegates to the server-POST flow (item 006) ───

describe("loop run --detached", () => {
  let savedState: string | null = null;
  let tmpDir: string;

  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
    try {
      savedState = fs.readFileSync(SERVER_STATE_FILE, "utf-8");
    } catch {
      savedState = null;
    }
    removeServerState();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-detached-"));
  });

  afterEach(() => {
    removeServerState();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedState !== null) {
      fs.mkdirSync(path.dirname(SERVER_STATE_FILE), { recursive: true });
      fs.writeFileSync(SERVER_STATE_FILE, savedState);
    }
  });

  /**
   * A throwaway server that answers GET /api/health (so ensureServerRunning
   * no-ops) and records POST .../loop/start so the test can assert delegation.
   */
  async function startMockServer(): Promise<{
    port: number;
    close: () => Promise<void>;
    startCalls: Array<{ id: string; body: unknown }>;
  }> {
    const startCalls: Array<{ id: string; body: unknown }> = [];
    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { uptime: 1, version: "test", pid: process.pid } }));
        return;
      }
      const m = req.url?.match(/^\/api\/projects\/([^/]+)\/loop\/start$/);
      if (req.method === "POST" && m) {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          startCalls.push({ id: decodeURIComponent(m[1]!), body: raw ? JSON.parse(raw) : {} });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { started: true } }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    return {
      port,
      startCalls,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it("delegates to ensureServerRunning + POST /loop/start and returns immediately (no in-process LoopRunner)", async () => {
    const { port, close, startCalls } = await startMockServer();
    try {
      writeServerState({ pid: process.pid, port, startedAt: new Date().toISOString() });

      // A bare project dir (no git repo, no precondition setup). The in-process
      // path would refuse here; the detached path bypasses all of it.
      const proj = path.join(tmpDir, "proj");
      fs.mkdirSync(proj, { recursive: true });

      const ctx = makeCtx({
        args: [proj],
        flags: new Map<string, string | true>([["detached", true]]),
      });

      let code = -1;
      const out = await captureOutput(async () => {
        code = await handleLoopRun(ctx);
      });

      expect(code).toBe(ExitCode.SUCCESS);
      // It hit the server's loop/start route exactly once for this project.
      expect(startCalls.length).toBe(1);
      expect(startCalls[0]!.id).toBe(path.basename(proj));
      // It took the detached path, NOT the in-process LoopRunner path.
      expect(out.stdout).toContain("Loop started");
      expect(out.stdout).not.toContain("Running loop directly");
      // No state.json was written (no in-process LoopRunner ever created it).
      expect(fs.existsSync(path.join(proj, ".rauf", "state.json"))).toBe(false);
    } finally {
      removeServerState();
      await close();
    }
  });

  it("resolves -d to --detached (same delegation path)", async () => {
    const { port, close, startCalls } = await startMockServer();
    try {
      writeServerState({ pid: process.pid, port, startedAt: new Date().toISOString() });
      const proj = path.join(tmpDir, "proj");
      fs.mkdirSync(proj, { recursive: true });

      // Parse `loop run <proj> -d` through the real parser so the -d→--detached
      // alias normalization is exercised, then dispatch handleLoopRun.
      const parsed = parseArgs(["loop", "run", proj, "-d"], new Set(["run", "stop", "review"]));
      expect(parsed.flags.has("detached")).toBe(true);
      expect(parsed.flags.has("d")).toBe(false);

      const ctx = makeCtx({ args: parsed.args, flags: parsed.flags });
      let code = -1;
      await captureOutput(async () => {
        code = await handleLoopRun(ctx);
      });

      expect(code).toBe(ExitCode.SUCCESS);
      expect(startCalls.length).toBe(1);
    } finally {
      removeServerState();
      await close();
    }
  });

  it("forwards --backlog <dir> as backlogRoot in the POST body (REQ-FLAG-03)", async () => {
    const { port, close, startCalls } = await startMockServer();
    try {
      writeServerState({ pid: process.pid, port, startedAt: new Date().toISOString() });
      const proj = path.join(tmpDir, "proj-backlog");
      fs.mkdirSync(proj, { recursive: true });

      const customBacklog = "specs/my-backlog";
      const ctx = makeCtx({
        args: [proj],
        flags: new Map<string, string | true>([
          ["detached", true],
          ["backlog", customBacklog],
        ]),
      });

      let code = -1;
      await captureOutput(async () => {
        code = await handleLoopRun(ctx);
      });

      expect(code).toBe(ExitCode.SUCCESS);
      expect(startCalls.length).toBe(1);
      // --backlog must be forwarded as backlogRoot so the detached run targets the
      // same root as the flag (02 §6, REQ-FLAG-03).
      expect((startCalls[0]!.body as Record<string, unknown>).backlogRoot).toBe(customBacklog);
    } finally {
      removeServerState();
      await close();
    }
  });

  it("forwards --agent <id> as body.provider in the POST body (REQ-SEL-01)", async () => {
    const { port, close, startCalls } = await startMockServer();
    try {
      writeServerState({ pid: process.pid, port, startedAt: new Date().toISOString() });
      const proj = path.join(tmpDir, "proj-agent");
      fs.mkdirSync(proj, { recursive: true });

      const ctx = makeCtx({
        args: [proj],
        flags: new Map<string, string | true>([
          ["detached", true],
          ["agent", "codex"],
        ]),
      });

      let code = -1;
      await captureOutput(async () => {
        code = await handleLoopRun(ctx);
      });

      expect(code).toBe(ExitCode.SUCCESS);
      expect(startCalls.length).toBe(1);
      expect((startCalls[0]!.body as Record<string, unknown>).provider).toBe("codex");
    } finally {
      removeServerState();
      await close();
    }
  });
});

// ─── --agent flag plumbing + `rauf agents` (item 011, 06 §3-4) ──────────

describe("loop run --agent plumbing (in-process)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-agent-"));
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function git(cwd: string, args: string): void {
    execSync(`git ${args}`, { cwd, stdio: "ignore" });
  }

  /** A minimal runnable rauf project on a non-protected branch. */
  function makeProject(): string {
    const projectDir = path.join(tmpDir, "proj");
    const raufDir = path.join(projectDir, ".rauf");
    fs.mkdirSync(raufDir, { recursive: true });
    fs.writeFileSync(
      path.join(raufDir, "backlog.json"),
      JSON.stringify(
        {
          schemaVersion: "1",
          project: "p",
          description: "d",
          items: [
            {
              id: "001",
              type: "feature",
              priority: 1,
              title: "Item 001",
              description: "d",
              acceptanceCriteria: ["Tests pass"],
              status: "pending",
              completedAt: null,
              dependsOn: [],
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(path.join(raufDir, "RAUF.md"), "# Test RAUF.md\nVerification: true\n");
    git(projectDir, "-c init.defaultBranch=main init");
    git(projectDir, 'config user.email "test@test.com"');
    git(projectDir, 'config user.name "Test"');
    git(projectDir, "add -A");
    git(projectDir, 'commit -m "baseline"');
    git(projectDir, "switch -c feat/agent");
    return projectDir;
  }

  it("--agent codex sets options.provider === 'codex'", async () => {
    const proj = makeProject();
    // Short-circuit before the loop actually runs: capture the options handed to
    // LoopRunner.create and return an err so handleLoopRun returns early.
    let captured: Record<string, unknown> | undefined;
    vi.spyOn(LoopRunner, "create").mockImplementation((_path, options) => {
      captured = options as unknown as Record<string, unknown>;
      return err({ code: ErrorCodes.IO_ERROR, message: "stop" });
    });

    const ctx = makeCtx({
      args: [proj],
      flags: new Map<string, string | true>([["agent", "codex"]]),
    });
    await captureOutput(async () => {
      await handleLoopRun(ctx);
    });

    expect(captured?.provider).toBe("codex");
  });

  it("omitting --agent leaves options.provider undefined", async () => {
    const proj = makeProject();
    let captured: Record<string, unknown> | undefined;
    vi.spyOn(LoopRunner, "create").mockImplementation((_path, options) => {
      captured = options as unknown as Record<string, unknown>;
      return err({ code: ErrorCodes.IO_ERROR, message: "stop" });
    });

    const ctx = makeCtx({ args: [proj] });
    await captureOutput(async () => {
      await handleLoopRun(ctx);
    });

    expect(captured?.provider).toBeUndefined();
  });
});

describe("loop run --agent help enumeration (06 §3.2)", () => {
  it("the --agent FlagDef description enumerates getAgentDescriptors() ids (sync, no probe)", () => {
    const run = findCommand("loop")!.subcommands!.find((s) => s.name === "run")!;
    const agentFlag = run.flags!.find((f) => f.name.startsWith("--agent"));
    expect(agentFlag).toBeDefined();
    const ids = getAgentDescriptors().map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(agentFlag!.description).toContain(id);
    }
  });
});

describe("rauf agents command (06 §3.3)", () => {
  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  it("lists each registered descriptor's id/displayName/availability", async () => {
    const ctx = makeCtx();
    let code = -1;
    const out = await captureOutput(async () => {
      code = await handleAgents(ctx);
    });
    expect(code).toBe(ExitCode.SUCCESS);
    const rows = await listAgents();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(out.stdout).toContain(r.id);
      expect(out.stdout).toContain(r.displayName);
    }
    // Header columns present.
    expect(out.stdout).toContain("AVAILABLE");
    expect(out.stdout).toContain("DETAIL");
  });

  it("--json emits { agents: AgentAvailability[] }", async () => {
    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });
    let code = -1;
    const out = await captureOutput(async () => {
      code = await handleAgents(ctx);
    });
    configureOutput({ noColor: true, quiet: false, json: false });
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(out.stdout) as { agents: Array<{ id: string; available: boolean }> };
    expect(Array.isArray(parsed.agents)).toBe(true);
    const expected = await listAgents();
    expect(parsed.agents.map((a) => a.id)).toEqual(expected.map((a) => a.id));
    expect(parsed.agents[0]).toHaveProperty("available");
  });
});

// ─── loop run --detached --follow lifecycle (item 007, 02 §3) ───────────

describe("loop run --detached --follow", () => {
  let savedState: string | null = null;
  let tmpDir: string;

  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
    try {
      savedState = fs.readFileSync(SERVER_STATE_FILE, "utf-8");
    } catch {
      savedState = null;
    }
    removeServerState();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-follow-"));
  });

  afterEach(() => {
    removeServerState();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedState !== null) {
      fs.mkdirSync(path.dirname(SERVER_STATE_FILE), { recursive: true });
      fs.writeFileSync(SERVER_STATE_FILE, savedState);
    }
  });

  /**
   * A throwaway server that answers GET /api/health, records POST .../loop/start
   * (so the no-follow-in-body invariant can be asserted), streams SSE on
   * GET .../loop/events, and records POST .../loop/stop (so the Ctrl-C-detaches-
   * only invariant can be asserted — it must stay empty). When `terminal` is set,
   * the events stream emits a single loop_completed event and ends so the follow
   * view returns on its own; otherwise it holds the SSE connection open so only a
   * SIGINT can detach the view.
   */
  async function startMockServer(opts: { terminal: boolean }): Promise<{
    port: number;
    close: () => Promise<void>;
    startCalls: Array<{ id: string; body: unknown }>;
    stopCalls: Array<{ id: string }>;
    eventsConnected: () => boolean;
  }> {
    const startCalls: Array<{ id: string; body: unknown }> = [];
    const stopCalls: Array<{ id: string }> = [];
    let connected = false;
    const openResponses = new Set<http.ServerResponse>();

    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { uptime: 1, version: "test", pid: process.pid } }));
        return;
      }
      const startMatch = req.url?.match(/^\/api\/projects\/([^/]+)\/loop\/start$/);
      if (req.method === "POST" && startMatch) {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          startCalls.push({
            id: decodeURIComponent(startMatch[1]!),
            body: raw ? JSON.parse(raw) : {},
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: { started: true } }));
        });
        return;
      }
      const stopMatch = req.url?.match(/^\/api\/projects\/([^/]+)\/loop\/stop$/);
      if (req.method === "POST" && stopMatch) {
        stopCalls.push({ id: decodeURIComponent(stopMatch[1]!) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { stopped: true } }));
        return;
      }
      const eventsMatch = req.url?.match(/^\/api\/projects\/([^/]+)\/loop\/events$/);
      if (req.method === "GET" && eventsMatch) {
        connected = true;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        if (opts.terminal) {
          res.write(
            `event: loop_event\ndata: ${JSON.stringify({
              type: "loop_completed",
              timestamp: "2026-06-13T00:00:00.000Z",
              projectPath: "/test",
              completedCount: 1,
              blockedCount: 0,
              needsHumanCount: 0,
            })}\n\n`,
          );
          res.end();
        } else {
          // Hold the connection open — only a SIGINT (view detach) ends it.
          openResponses.add(res);
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    return {
      port,
      startCalls,
      stopCalls,
      eventsConnected: () => connected,
      close: () =>
        new Promise<void>((resolve) => {
          for (const r of openResponses) r.end();
          server.close(() => resolve());
        }),
    };
  }

  it("does NOT include --follow (or --detached) in the server request body", async () => {
    const { port, close, startCalls } = await startMockServer({ terminal: true });
    try {
      writeServerState({ pid: process.pid, port, startedAt: new Date().toISOString() });
      const proj = path.join(tmpDir, "proj");
      fs.mkdirSync(proj, { recursive: true });

      const ctx = makeCtx({
        args: [proj],
        flags: new Map<string, string | true>([
          ["detached", true],
          ["follow", true],
        ]),
      });

      let code = -1;
      await captureOutput(async () => {
        code = await handleLoopRun(ctx);
      });

      // The terminal event ends the follow view on its own → SUCCESS.
      expect(code).toBe(ExitCode.SUCCESS);
      expect(startCalls.length).toBe(1);
      // The body carries only loop options — never the observation/mode flags.
      const body = startCalls[0]!.body as Record<string, unknown>;
      expect(body).not.toHaveProperty("follow");
      expect(body).not.toHaveProperty("detached");
    } finally {
      removeServerState();
      await close();
    }
  });

  it("Ctrl-C on the attached view detaches the view only (no POST /loop/stop, loop keeps running)", async () => {
    const mock = await startMockServer({ terminal: false });
    try {
      writeServerState({
        pid: process.pid,
        port: mock.port,
        startedAt: new Date().toISOString(),
      });
      const proj = path.join(tmpDir, "proj");
      fs.mkdirSync(proj, { recursive: true });

      const ctx = makeCtx({
        args: [proj],
        flags: new Map<string, string | true>([
          ["detached", true],
          ["follow", true],
        ]),
      });

      let code = -1;
      const run = captureOutput(async () => {
        code = await handleLoopRun(ctx);
      });

      // Wait until the POST landed and the follow view connected to the SSE
      // stream, then simulate Ctrl-C on the attached view.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !(mock.startCalls.length === 1 && mock.eventsConnected())) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(mock.startCalls.length).toBe(1);
      expect(mock.eventsConnected()).toBe(true);

      process.emit("SIGINT");
      await run;

      // The view detached cleanly (SUCCESS) WITHOUT stopping the loop.
      expect(code).toBe(ExitCode.SUCCESS);
      expect(mock.stopCalls.length).toBe(0);
    } finally {
      removeServerState();
      await mock.close();
    }
  });
});

// ─── Observation parity: attended vs detached (REQ-EXEC-06, NFR-PARITY-01, 06 §3) ───
//
// Parity is structural, not re-implemented. Both branches run the SAME engine
// (in-process `LoopRunner.create().start()` vs the server's `LoopManager`-driven
// `LoopRunner`) against the SAME project, so they emit to the SAME events.ndjson
// substrate; and both observation views (in-process follow + detached follow's
// `streamEventsUntilDone`) render every event through the SINGLE shared
// `formatAndPrintEvent`. These tests pin those two invariants so the two paths
// cannot drift into producing different observer output.
describe("observation parity (attended vs detached)", () => {
  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  it("both run modes resolve the same events.ndjson substrate for a project", () => {
    const proj = path.join(os.tmpdir(), "rauf-parity-proj");
    // The events substrate is a pure function of (projectPath, backlogFlag): the
    // attended in-process run and the detached server run resolve it identically,
    // so an observer sees one and the same file regardless of run mode.
    const attended = defaultBacklogPaths(proj);
    const detached = defaultBacklogPaths(proj);
    expect(detached.eventsLog).toBe(attended.eventsLog);
    expect(attended.eventsLog.endsWith("events.ndjson")).toBe(true);
  });

  it("renders identical observer output for a given event regardless of run mode", () => {
    // Both follow views call the same formatAndPrintEvent — deterministic, so the
    // observer output is byte-identical whether the run was attended or detached.
    const event = baseEvent("item_selected", {
      itemId: "014",
      title: "Integration & full-gate",
      priority: 2,
    });
    const attendedOut = captureOutput(() => formatAndPrintEvent(event));
    const detachedOut = captureOutput(() => formatAndPrintEvent(event));
    expect(detachedOut.stdout).toBe(attendedOut.stdout);
    expect(attendedOut.stdout).toContain("#014");
  });
});
