import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { LoopEvent } from "@ralph/core";

import { findCommand, ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";
import { formatAndPrintEvent } from "./loop-commands.js";
import { SERVER_STATE_FILE } from "./server-commands.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Capture stdout/stderr during a function call */
function captureOutput(fn: () => void | Promise<void>) {
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
    expect(subNames).toEqual(["start", "stop", "follow", "run", "review", "watch"]);
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

  it("errors with helpful message when server not running", async () => {
    const loop = findCommand("loop")!;
    const stopHandler = loop.subcommands!.find((s) => s.name === "stop")!.handler!;
    const ctx = makeCtx({ args: ["/tmp/some-project"] });

    const output = await captureOutput(async () => {
      const code = await stopHandler(ctx);
      expect(code).toBe(ExitCode.ERROR);
    });

    expect(output.stderr).toContain("Server is not running");
  });
});

describe("handleLoopFollow", () => {
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

  it("errors when server not running", async () => {
    const loop = findCommand("loop")!;
    const followHandler = loop.subcommands!.find((s) => s.name === "follow")!.handler!;
    const ctx = makeCtx({ args: ["/tmp/some-project"] });

    const output = await captureOutput(async () => {
      const code = await followHandler(ctx);
      expect(code).toBe(ExitCode.ERROR);
    });

    // With no server running, direct mode is used → resolveBacklogPaths fails for /tmp/some-project
    expect(output.stderr).toContain("not found");
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
      // Should fail with ERROR (server not running), not INVALID_ARGS
      expect(code).toBe(ExitCode.ERROR);
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
