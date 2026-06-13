import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { handleStatus, handleLog, handleProgress, statusExitCode } from "./status-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import type { DerivedStatus, LoopStateEnum } from "@rauf/core";
import { configureOutput } from "./formatter.js";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-cli-status-"));
  configureOutput({ noColor: true, quiet: true, json: false });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a minimal project dir with .rauf directory */
function createRaufProject(projectDir: string): string {
  const raufDir = path.join(projectDir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  return raufDir;
}

/** Create a valid backlog.json in the .rauf directory */
function createBacklog(raufDir: string, items: object[] = []): void {
  fs.writeFileSync(
    path.join(raufDir, "backlog.json"),
    JSON.stringify({ project: "test", description: "test", items }, null, 2),
  );
}

/** Create a state.json in the .rauf directory */
function createStateJson(raufDir: string, overrides: Record<string, unknown> = {}): void {
  // All required fields per LoopStateSchema
  const state = {
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    iteration: 3,
    maxIterations: 20,
    currentItem: "007",
    lastSignal: "clean", // non-null required
    completedItems: [],
    blockedItems: [],
    error: null,
    pid: 12345,
    ...overrides,
  };
  fs.writeFileSync(path.join(raufDir, "state.json"), JSON.stringify(state, null, 2));
}

/** Build a CommandContext for testing */
function makeCtx(
  args: string[],
  flags: Record<string, string | true> = {},
  globalFlags: Partial<{ json: boolean; quiet: boolean; noColor: boolean }> = {},
): CommandContext {
  return {
    args,
    flags: new Map(Object.entries(flags)),
    globalFlags: {
      json: globalFlags.json ?? false,
      quiet: globalFlags.quiet ?? true,
      noColor: globalFlags.noColor ?? true,
      root: null,
    },
    rawArgv: [],
  };
}

// ─── handleStatus tests ────────────────────────────────────────────

describe("handleStatus", () => {
  it("returns INVALID_ARGS when path is missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleStatus(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns 0 (idle/complete) when .rauf directory does not exist", async () => {
    const projectDir = path.join(tmpDir, "no-ralph");
    fs.mkdirSync(projectDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    // NOT_INSTALLED → exit 0
    expect(code).toBe(0);
  });

  it("returns 0 when loop is IDLE (no state.json, no log)", async () => {
    const projectDir = path.join(tmpDir, "idle-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(0);
  });

  it("returns RUNNING(6) when loop is RUNNING (state.json with running status)", async () => {
    const projectDir = path.join(tmpDir, "running-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, { status: "running" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(ExitCode.RUNNING);
  });

  it("returns 0 when loop is COMPLETE", async () => {
    const projectDir = path.join(tmpDir, "complete-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, { status: "complete" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(0);
  });

  it("returns NEEDS_HUMAN(3) when loop is PAUSED_HUMAN", async () => {
    const projectDir = path.join(tmpDir, "human-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, { status: "paused_human" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(ExitCode.NEEDS_HUMAN);
  });

  it("returns LIMIT(4) when loop is LIMIT_REACHED", async () => {
    const projectDir = path.join(tmpDir, "limit-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, { status: "limit_reached" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(ExitCode.LIMIT);
  });

  it("returns LIMIT(4) and SLEEPING_LIMIT loopState for sleeping_limit status", async () => {
    const projectDir = path.join(tmpDir, "sleeping-limit-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, {
      status: "sleeping_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      error: "5-hour usage limit hit",
    });

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.LIMIT);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("loopState", "SLEEPING_LIMIT");
    expect(parsed).toHaveProperty("sleepUntil");
  });

  it("returns LIMIT(4) and WEEKLY_LIMIT loopState for weekly_limit status", async () => {
    const projectDir = path.join(tmpDir, "weekly-limit-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, {
      status: "weekly_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil: "2026-02-27T05:00:00Z",
      error: "Weekly usage limit exhausted",
    });

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.LIMIT);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("loopState", "WEEKLY_LIMIT");
    expect(parsed.sleepUntil).toBe("2026-02-27T05:00:00Z");
  });

  it("shows sleeping limit information in text output", async () => {
    const projectDir = path.join(tmpDir, "sleeping-text-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    const sleepUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    createStateJson(raufDir, {
      status: "sleeping_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil,
      error: "5-hour usage limit hit",
    });

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: false, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: false });
    await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(output.toLowerCase()).toMatch(/sleeping/i);
    expect(output).toMatch(/will resume at/i);
  });

  it("shows weekly limit information in text output", async () => {
    const projectDir = path.join(tmpDir, "weekly-text-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, {
      status: "weekly_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil: "2026-02-27T05:00:00Z",
      error: "Weekly usage limit exhausted",
    });

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: false, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: false });
    await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(output.toLowerCase()).toMatch(/weekly/i);
    expect(output).toMatch(/restart the loop after/i);
  });

  it("returns 0 when loop is PAUSED", async () => {
    const projectDir = path.join(tmpDir, "paused-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, { status: "paused" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(0);
  });

  it("returns JSON output when --json flag is set", async () => {
    const projectDir = path.join(tmpDir, "json-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir, { status: "running" });

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.RUNNING);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("loopState", "RUNNING");
    expect(parsed).toHaveProperty("stateSource", "state.json");
    expect(parsed).toHaveProperty("backlogSummary");
  });

  it("includes backlog summary counts", async () => {
    const projectDir = path.join(tmpDir, "summary-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir, [
      {
        id: "001",
        type: "feature",
        priority: 1,
        title: "Task A",
        description: "desc",
        status: "done",
        completedAt: "2026-01-01T00:00:00Z",
        acceptanceCriteria: ["done"],
      },
      {
        id: "002",
        type: "feature",
        priority: 2,
        title: "Task B",
        description: "desc",
        status: "pending",
        completedAt: null,
        acceptanceCriteria: ["pending"],
      },
    ]);
    createStateJson(raufDir, { status: "running" });

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    const parsed = JSON.parse(output);
    expect(parsed.backlogSummary.done).toBe(1);
    expect(parsed.backlogSummary.pending).toBe(1);
    expect(parsed.backlogSummary.total).toBe(2);
  });

  it("includes lock liveness and deferred count in --json output", async () => {
    const projectDir = path.join(tmpDir, "lock-json-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir, [
      {
        id: "001",
        type: "feature",
        priority: 1,
        title: "Genuine block",
        description: "desc",
        status: "blocked",
        completedAt: null,
        blockedReason: "agent said RAUF_BLOCKED",
        acceptanceCriteria: ["x"],
      },
      {
        id: "002",
        type: "feature",
        priority: 2,
        title: "Runner deferral",
        description: "desc",
        status: "blocked",
        completedAt: null,
        deferred: true,
        blockedReason: "No signal after N attempts (deferred by runner)",
        acceptanceCriteria: ["x"],
      },
    ]);
    createStateJson(raufDir, { status: "running" });
    // Live lock held by this very process.
    fs.writeFileSync(
      path.join(raufDir, ".loop.lock"),
      JSON.stringify(
        { pid: process.pid, startedAt: new Date().toISOString(), processStartTime: null },
        null,
        2,
      ),
    );

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    const parsed = JSON.parse(output);
    expect(parsed.lock).toMatchObject({
      present: true,
      pid: process.pid,
      alive: true,
      stale: false,
    });
    expect(parsed.backlogSummary.blocked).toBe(2);
    expect(parsed.backlogSummary.deferred).toBe(1);
  });

  it("shows lock liveness and blocked/deferred split in text output", async () => {
    const projectDir = path.join(tmpDir, "lock-text-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir, [
      {
        id: "001",
        type: "feature",
        priority: 1,
        title: "Genuine block",
        description: "desc",
        status: "blocked",
        completedAt: null,
        blockedReason: "agent said RAUF_BLOCKED",
        acceptanceCriteria: ["x"],
      },
      {
        id: "002",
        type: "feature",
        priority: 2,
        title: "Runner deferral",
        description: "desc",
        status: "blocked",
        completedAt: null,
        deferred: true,
        blockedReason: "No signal after N attempts (deferred by runner)",
        acceptanceCriteria: ["x"],
      },
    ]);
    createStateJson(raufDir, { status: "running" });
    fs.writeFileSync(
      path.join(raufDir, ".loop.lock"),
      JSON.stringify(
        { pid: process.pid, startedAt: new Date().toISOString(), processStartTime: null },
        null,
        2,
      ),
    );

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: false, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: false });
    await handleStatus(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(output).toMatch(new RegExp(`Lock:\\s+PID ${process.pid} \\(alive\\)`));
    // Genuine blocked = blocked(2) - deferred(1) = 1; Deferred = 1.
    expect(output).toMatch(/Blocked:\s+1/);
    expect(output).toMatch(/Deferred:\s+1/);
  });

  it("handles stale running state (>5min) as PAUSED", async () => {
    const projectDir = path.join(tmpDir, "stale-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    // updatedAt 10 minutes ago
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    createStateJson(raufDir, { status: "running", updatedAt: oldTime });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    // PAUSED → exit 0
    expect(code).toBe(0);
  });
});

// ─── handleLog tests ───────────────────────────────────────────────

describe("handleLog", () => {
  it("returns INVALID_ARGS when path is missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleLog(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns SUCCESS with empty info when no log exists", async () => {
    const projectDir = path.join(tmpDir, "no-log");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleLog(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("prints last N lines of log file", async () => {
    const projectDir = path.join(tmpDir, "log-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(raufDir, "rauf.log"), lines.join("\n") + "\n");

    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output.push(s.toString());
      return true;
    };

    const ctx = makeCtx([projectDir], { tail: "5" });
    configureOutput({ noColor: true, quiet: false, json: false });
    const code = await handleLog(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const printed = output.join("").trim().split("\n");
    expect(printed).toHaveLength(5);
    expect(printed[0]).toBe("line 26");
    expect(printed[4]).toBe("line 30");
  });

  it("uses default tail of 20 lines", async () => {
    const projectDir = path.join(tmpDir, "default-tail");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(raufDir, "rauf.log"), lines.join("\n") + "\n");

    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output.push(s.toString());
      return true;
    };

    const ctx = makeCtx([projectDir]);
    configureOutput({ noColor: true, quiet: false, json: false });
    const code = await handleLog(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const printed = output.join("").trim().split("\n");
    expect(printed).toHaveLength(20);
    expect(printed[0]).toBe("line 11");
    expect(printed[19]).toBe("line 30");
  });

  it("returns all lines when log has fewer lines than tail", async () => {
    const projectDir = path.join(tmpDir, "short-log");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    fs.writeFileSync(path.join(raufDir, "rauf.log"), "line 1\nline 2\nline 3\n");

    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output.push(s.toString());
      return true;
    };

    const ctx = makeCtx([projectDir], { tail: "20" });
    configureOutput({ noColor: true, quiet: false, json: false });
    await handleLog(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    const printed = output.join("").trim().split("\n");
    expect(printed).toHaveLength(3);
  });
});

// ─── handleProgress tests ─────────────────────────────────────────

describe("handleProgress", () => {
  it("returns INVALID_ARGS when path is missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleProgress(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns SUCCESS with info message when progress.md is missing", async () => {
    const projectDir = path.join(tmpDir, "no-progress");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleProgress(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("prints progress.md content", async () => {
    const projectDir = path.join(tmpDir, "progress-project");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    const content = "# Progress\n\n- Step 1 done\n- Step 2 in progress\n";
    fs.writeFileSync(path.join(raufDir, "progress.md"), content);

    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output.push(s.toString());
      return true;
    };

    const ctx = makeCtx([projectDir]);
    configureOutput({ noColor: true, quiet: false, json: false });
    const code = await handleProgress(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(output.join("")).toContain("# Progress");
    expect(output.join("")).toContain("Step 1 done");
  });

  it("outputs JSON with content when --json flag is set", async () => {
    const projectDir = path.join(tmpDir, "json-progress");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    fs.writeFileSync(path.join(raufDir, "progress.md"), "# Progress\n\nSome notes.");

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProgress(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("content");
    expect(parsed.content).toContain("# Progress");
  });

  it("outputs JSON with null content when progress.md missing", async () => {
    const projectDir = path.join(tmpDir, "no-progress-json");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);

    let output = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProgress(ctx);

    process.stdout.write = origWrite;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("content", null);
  });

  it("handles empty progress.md gracefully", async () => {
    const projectDir = path.join(tmpDir, "empty-progress");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    fs.writeFileSync(path.join(raufDir, "progress.md"), "");
    const ctx = makeCtx([projectDir]);
    const code = await handleProgress(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });
});

// ─── Follow surface (item 009a) ────────────────────────────────────

/** Capture process.stdout.write while running fn; restore afterwards. */
async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  let out = "";
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await fn();
    return { code, out };
  } finally {
    process.stdout.write = orig;
  }
}

function writeEventsLog(raufDir: string, projectPath: string): void {
  const lines = [
    JSON.stringify({
      type: "loop_started",
      timestamp: new Date().toISOString(),
      projectPath,
      maxIterations: 5,
      seq: 0,
      schemaVersion: "1",
    }),
  ];
  fs.writeFileSync(path.join(raufDir, "events.ndjson"), lines.join("\n") + "\n");
}

describe("status --follow", () => {
  it("streams one DerivedStatus snapshot as NDJSON under --json, stops on SIGINT", async () => {
    const projectDir = path.join(tmpDir, "status-follow-json");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    createStateJson(raufDir);

    const ctx = makeCtx([projectDir], { follow: true, interval: "0.05" }, { json: true });
    const { code, out } = await captureStdout(async () => {
      const p = handleStatus(ctx);
      // First tick runs synchronously; interrupt to end the stream.
      setTimeout(() => process.emit("SIGINT"), 30);
      return p;
    });

    expect(code).toBe(ExitCode.SUCCESS);
    const firstLine = out.split("\n").find((l) => l.trim().length > 0)!;
    const snapshot = JSON.parse(firstLine);
    expect(snapshot).toHaveProperty("loopState");
  });
});

describe("log --follow", () => {
  it("replays events.ndjson and stops on SIGINT (formatted)", async () => {
    const projectDir = path.join(tmpDir, "log-follow");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    fs.writeFileSync(path.join(raufDir, "rauf.log"), "first log line\n");
    writeEventsLog(raufDir, projectDir);

    const ctx = makeCtx([projectDir], { follow: true });
    const { code, out } = await captureStdout(async () => {
      const p = handleLog(ctx);
      setTimeout(() => process.emit("SIGINT"), 30);
      return p;
    });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(out).toContain("first log line");
    expect(out).toContain("loop_started");
  });

  it("emits NDJSON objects (log + events) under --follow --json", async () => {
    const projectDir = path.join(tmpDir, "log-follow-json");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    fs.writeFileSync(path.join(raufDir, "rauf.log"), "raw line\n");
    writeEventsLog(raufDir, projectDir);

    const ctx = makeCtx([projectDir], { follow: true }, { json: true });
    const { code, out } = await captureStdout(async () => {
      const p = handleLog(ctx);
      setTimeout(() => process.emit("SIGINT"), 30);
      return p;
    });

    expect(code).toBe(ExitCode.SUCCESS);
    const objs = out
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    expect(objs).toContainEqual(expect.objectContaining({ source: "log", line: "raw line" }));
    expect(objs).toContainEqual(expect.objectContaining({ type: "loop_started", seq: 0 }));
  });
});

describe("log --json (one-shot)", () => {
  it("emits the tail as a JSON array of log lines", async () => {
    const projectDir = path.join(tmpDir, "log-json");
    const raufDir = createRaufProject(projectDir);
    createBacklog(raufDir);
    fs.writeFileSync(path.join(raufDir, "rauf.log"), "line a\nline b\n");

    const ctx = makeCtx([projectDir], {}, { json: true });
    const { code, out } = await captureStdout(() => handleLog(ctx));

    expect(code).toBe(ExitCode.SUCCESS);
    const arr = JSON.parse(out);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toContain("line a");
    expect(arr).toContain("line b");
  });
});

// ─── statusExitCode (unified scheme, 00 §2b) ─────────────────────────

describe("statusExitCode (unified exit-code scheme)", () => {
  /** Minimal DerivedStatus carrying a backlog summary with the given blocked/deferred counts. */
  function derivedWith(blocked: number, deferred = 0): DerivedStatus {
    return {
      loopState: "IDLE",
      stateSource: "state.json",
      iteration: null,
      maxIterations: null,
      currentItem: null,
      lastSignal: null,
      startedAt: null,
      elapsed: null,
      backlogSummary: {
        pending: 0,
        inProgress: 0,
        blocked,
        deferred,
        done: 0,
        total: blocked,
      },
    };
  }

  it.each<[LoopStateEnum, number]>([
    ["RUNNING", ExitCode.RUNNING], // 6
    ["PAUSED_HUMAN", ExitCode.NEEDS_HUMAN], // 3
    ["LIMIT_REACHED", ExitCode.LIMIT], // 4
    ["SLEEPING_LIMIT", ExitCode.LIMIT], // 4
    ["WEEKLY_LIMIT", ExitCode.LIMIT], // 4
    ["ERROR", ExitCode.ERROR], // 1
    ["IDLE", ExitCode.SUCCESS], // 0
    ["COMPLETE", ExitCode.SUCCESS], // 0
    ["PAUSED", ExitCode.SUCCESS], // 0
    ["NOT_INSTALLED", ExitCode.SUCCESS], // 0
  ])("maps %s → %d (no derived status)", (state, expected) => {
    expect(statusExitCode(state)).toBe(expected);
  });

  it("derives BLOCKED(5) for a clean terminal state with genuine blocks", () => {
    expect(statusExitCode("IDLE", derivedWith(2))).toBe(ExitCode.BLOCKED);
    expect(statusExitCode("COMPLETE", derivedWith(1))).toBe(ExitCode.BLOCKED);
    expect(statusExitCode("PAUSED", derivedWith(1))).toBe(ExitCode.BLOCKED);
  });

  it("does NOT derive BLOCKED when blocked items are all deferred (runner false-blocks)", () => {
    // 2 blocked, both deferred → genuine blocked is 0 → SUCCESS, not BLOCKED.
    expect(statusExitCode("IDLE", derivedWith(2, 2))).toBe(ExitCode.SUCCESS);
  });

  it("does NOT derive BLOCKED for a non-terminal state even with genuine blocks", () => {
    // RUNNING is query-time, not a clean terminal — stays RUNNING(6).
    expect(statusExitCode("RUNNING", derivedWith(3))).toBe(ExitCode.RUNNING);
  });
});
