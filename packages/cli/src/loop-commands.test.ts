import fs from "node:fs";
import path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { execSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { LoopEvent } from "@rauf/core";
import { LoopEventSchema } from "@rauf/core";

import { findCommand, ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";
import {
  formatAndPrintEvent,
  ensureServerRunning,
  createLoopBranch,
  buildPreconditionRemediation,
  handleLoopRun,
} from "./loop-commands.js";
import { SERVER_STATE_FILE, writeServerState, removeServerState } from "./server-commands.js";

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
      expect(code).toBe(ExitCode.CONFLICT);
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
      expect(code).toBe(ExitCode.CONFLICT);
    });

    const all = out.stdout + out.stderr;
    expect(all).toContain("app.ts");
    expect(all).toContain("--seed-backlog only commits");
    // No seed commit was created, and the backlog is still uncommitted.
    expect(gitSubjects(proj)).not.toContain("[rauf] backlog: seed");
    expect(gitStatus(proj)).not.toBe("");
  });
});
