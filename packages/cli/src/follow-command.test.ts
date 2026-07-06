import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { handleFollow } from "./follow-command.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

let tmpDir: string;
let stdoutSpy: { mockRestore: () => void };
let written: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-follow-"));
  configureOutput({ noColor: true, quiet: true, json: false });
  written = "";
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    written += String(chunk);
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createRaufDir(projectDir: string): string {
  const raufDir = path.join(projectDir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(
    path.join(raufDir, "backlog.json"),
    JSON.stringify({ project: "test", description: "test", items: [] }, null, 2),
  );
  return raufDir;
}

/** Write a terminal (complete) state.json so follow's poll loop finishes promptly. */
function createTerminalState(raufDir: string): void {
  const state = {
    status: "complete",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    iteration: 1,
    maxIterations: 5,
    currentItem: null,
    lastSignal: "clean",
    completedItems: [],
    blockedItems: [],
    error: null,
    pid: null,
  };
  fs.writeFileSync(path.join(raufDir, "state.json"), JSON.stringify(state, null, 2));
}

function writeEvents(raufDir: string, projectPath: string): void {
  const lines = [
    JSON.stringify({
      type: "loop_started",
      timestamp: new Date().toISOString(),
      projectPath,
      maxIterations: 5,
      seq: 0,
      schemaVersion: "1",
    }),
    JSON.stringify({
      type: "iteration_start",
      timestamp: new Date().toISOString(),
      projectPath,
      iteration: 1,
      maxIterations: 5,
      seq: 1,
      schemaVersion: "1",
    }),
  ];
  fs.writeFileSync(path.join(raufDir, "events.ndjson"), lines.join("\n") + "\n");
}

function makeCtx(args: string[], json = false): CommandContext {
  return {
    args,
    flags: new Map<string, string | true>([["interval", "0.05"]]),
    globalFlags: { json, quiet: true, noColor: true, root: null },
    rawArgv: [],
  };
}

describe("handleFollow", () => {
  it("returns INVALID_ARGS when no path is given", async () => {
    const ctx: CommandContext = {
      args: [],
      flags: new Map(),
      globalFlags: { json: false, quiet: true, noColor: true, root: null },
      rawArgv: [],
    };
    expect(await handleFollow(ctx)).toBe(ExitCode.USAGE);
  });

  it("emits a structured missing_target error under --json when no path is given", async () => {
    const ctx: CommandContext = {
      args: [],
      flags: new Map(),
      globalFlags: { json: true, quiet: true, noColor: true, root: null },
      rawArgv: [],
    };
    const code = await handleFollow(ctx);
    expect(code).toBe(ExitCode.USAGE);
    const parsed = JSON.parse(written.trim()) as { error: { code: string } };
    expect(parsed.error.code).toBe("missing_target");
  });

  it("replays the current run's events then exits on a terminal state (formatted)", async () => {
    const raufDir = createRaufDir(tmpDir);
    createTerminalState(raufDir);
    writeEvents(raufDir, tmpDir);

    const code = await handleFollow(makeCtx([tmpDir]));

    expect(code).toBe(ExitCode.SUCCESS);
    // Formatted (human) mode renders rich labels, not the raw event-type tokens.
    expect(written).toContain("loop started");
    expect(written).toContain("iteration 1/");
  });

  it("replays events as NDJSON (one PersistedEvent per line) under --json", async () => {
    const raufDir = createRaufDir(tmpDir);
    createTerminalState(raufDir);
    writeEvents(raufDir, tmpDir);

    const code = await handleFollow(makeCtx([tmpDir], true));

    expect(code).toBe(ExitCode.SUCCESS);
    const objectLines = written
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { type: string; seq: number });
    expect(objectLines[0]).toMatchObject({ type: "loop_started", seq: 0 });
    expect(objectLines[1]).toMatchObject({ type: "iteration_start", seq: 1 });
  });

  it("tolerates a missing events.ndjson (replays nothing, still exits)", async () => {
    const raufDir = createRaufDir(tmpDir);
    createTerminalState(raufDir);

    const code = await handleFollow(makeCtx([tmpDir]));
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("does not stitch the archived log — replays the current run only (REQ-OBS-04, §3.2)", async () => {
    // 07-testing-strategy.md §3.2(b): follow replays the CURRENT run's
    // events.ndjson, never the rotated archive/{ts}-events.ndjson from prior runs.
    const raufDir = createRaufDir(tmpDir);
    createTerminalState(raufDir);
    writeEvents(raufDir, tmpDir); // current run: loop_started seq0, iteration_start seq1

    // A prior run's archived events sit alongside — they must NOT be replayed.
    const archiveDir = path.join(raufDir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(archiveDir, "20260101-000000-events.ndjson"),
      JSON.stringify({
        type: "loop_started",
        timestamp: new Date().toISOString(),
        projectPath: "/ARCHIVED_SENTINEL",
        maxIterations: 5,
        seq: 0,
        schemaVersion: "1",
      }) + "\n",
    );

    const code = await handleFollow(makeCtx([tmpDir], true));

    expect(code).toBe(ExitCode.SUCCESS);
    // The current run is replayed...
    expect(written).toContain("iteration_start");
    // ...but nothing from the archived run is stitched in.
    expect(written).not.toContain("ARCHIVED_SENTINEL");
  });
});
