import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { handleStatus, handleLog, handleProgress } from "./status-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
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

/** Create a minimal project dir with .ralph directory */
function createRalphProject(projectDir: string): string {
  const ralphDir = path.join(projectDir, ".ralph");
  fs.mkdirSync(ralphDir, { recursive: true });
  return ralphDir;
}

/** Create a valid backlog.json in the .ralph directory */
function createBacklog(ralphDir: string, items: object[] = []): void {
  fs.writeFileSync(
    path.join(ralphDir, "backlog.json"),
    JSON.stringify({ project: "test", description: "test", items }, null, 2),
  );
}

/** Create a state.json in the .ralph directory */
function createStateJson(ralphDir: string, overrides: Record<string, unknown> = {}): void {
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
  fs.writeFileSync(path.join(ralphDir, "state.json"), JSON.stringify(state, null, 2));
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
      root: undefined,
    },
    rawArgv: [],
  };
}

// ─── handleStatus tests ────────────────────────────────────────────

describe("handleStatus", () => {
  it("returns INVALID_ARGS when path is missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleStatus(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns 0 (idle/complete) when .ralph directory does not exist", async () => {
    const projectDir = path.join(tmpDir, "no-ralph");
    fs.mkdirSync(projectDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    // NOT_INSTALLED → exit 0
    expect(code).toBe(0);
  });

  it("returns 0 when loop is IDLE (no state.json, no log)", async () => {
    const projectDir = path.join(tmpDir, "idle-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(0);
  });

  it("returns 1 when loop is RUNNING (state.json with running status)", async () => {
    const projectDir = path.join(tmpDir, "running-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, { status: "running" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(1);
  });

  it("returns 0 when loop is COMPLETE", async () => {
    const projectDir = path.join(tmpDir, "complete-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, { status: "complete" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(0);
  });

  it("returns 2 when loop is PAUSED_HUMAN", async () => {
    const projectDir = path.join(tmpDir, "human-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, { status: "paused_human" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(2);
  });

  it("returns 3 when loop is LIMIT_REACHED", async () => {
    const projectDir = path.join(tmpDir, "limit-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, { status: "limit_reached" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(3);
  });

  it("returns 0 and SLEEPING_LIMIT loopState for sleeping_limit status", async () => {
    const projectDir = path.join(tmpDir, "sleeping-limit-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, {
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

    expect(code).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("loopState", "SLEEPING_LIMIT");
    expect(parsed).toHaveProperty("sleepUntil");
  });

  it("returns 0 and WEEKLY_LIMIT loopState for weekly_limit status", async () => {
    const projectDir = path.join(tmpDir, "weekly-limit-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, {
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

    expect(code).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("loopState", "WEEKLY_LIMIT");
    expect(parsed.sleepUntil).toBe("2026-02-27T05:00:00Z");
  });

  it("shows sleeping limit information in text output", async () => {
    const projectDir = path.join(tmpDir, "sleeping-text-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    const sleepUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    createStateJson(ralphDir, {
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
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, {
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
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, { status: "paused" });
    const ctx = makeCtx([projectDir]);
    const code = await handleStatus(ctx);
    expect(code).toBe(0);
  });

  it("returns JSON output when --json flag is set", async () => {
    const projectDir = path.join(tmpDir, "json-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    createStateJson(ralphDir, { status: "running" });

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

    expect(code).toBe(1);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("loopState", "RUNNING");
    expect(parsed).toHaveProperty("stateSource", "state.json");
    expect(parsed).toHaveProperty("backlogSummary");
  });

  it("includes backlog summary counts", async () => {
    const projectDir = path.join(tmpDir, "summary-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir, [
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
    createStateJson(ralphDir, { status: "running" });

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

  it("handles stale running state (>5min) as PAUSED", async () => {
    const projectDir = path.join(tmpDir, "stale-project");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    // updatedAt 10 minutes ago
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    createStateJson(ralphDir, { status: "running", updatedAt: oldTime });
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
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns SUCCESS with empty info when no log exists", async () => {
    const projectDir = path.join(tmpDir, "no-log");
    const ralphDir = createRalphProject(projectDir);
    createBacklog(ralphDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleLog(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("prints last N lines of log file", async () => {
    const projectDir = path.join(tmpDir, "log-project");
    const ralphDir = createRalphProject(projectDir);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(ralphDir, "ralph.log"), lines.join("\n") + "\n");

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
    const ralphDir = createRalphProject(projectDir);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(ralphDir, "ralph.log"), lines.join("\n") + "\n");

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
    const ralphDir = createRalphProject(projectDir);
    fs.writeFileSync(path.join(ralphDir, "ralph.log"), "line 1\nline 2\nline 3\n");

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
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns SUCCESS with info message when progress.md is missing", async () => {
    const projectDir = path.join(tmpDir, "no-progress");
    createRalphProject(projectDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleProgress(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("prints progress.md content", async () => {
    const projectDir = path.join(tmpDir, "progress-project");
    const ralphDir = createRalphProject(projectDir);
    const content = "# Progress\n\n- Step 1 done\n- Step 2 in progress\n";
    fs.writeFileSync(path.join(ralphDir, "progress.md"), content);

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
    const ralphDir = createRalphProject(projectDir);
    fs.writeFileSync(path.join(ralphDir, "progress.md"), "# Progress\n\nSome notes.");

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
    createRalphProject(projectDir);

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
    const ralphDir = createRalphProject(projectDir);
    fs.writeFileSync(path.join(ralphDir, "progress.md"), "");
    const ctx = makeCtx([projectDir]);
    const code = await handleProgress(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });
});
