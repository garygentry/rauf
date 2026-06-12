// Tests for item 010 — CLI cross-root discovery:
//   - `status --all` machine-wide listing (human + --json)
//   - empty-is-never-silent surfacing (inspected dir + cross-root liveness)
//
// The active-loop registry lives at ~/.rauf/active/. We redirect HOME to an
// isolated temp dir BEFORE @rauf/core is imported (os.homedir() reads $HOME on
// POSIX), so listActiveLoops() never touches the real ~/.rauf.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { TMP_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const nodeFs = require("node:fs") as typeof import("node:fs");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "rauf-cli-disco-home-"));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir; // Windows parity (harmless on POSIX)
  return { TMP_HOME: dir };
});

import { registerLoop, LOCK_FILENAME, type ActiveLoopEntry } from "@rauf/core";

import { handleStatus } from "./status-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

const ACTIVE_DIR = path.join(TMP_HOME, ".rauf", "active");

let tmpDir: string;
let captured: string;
let origWrite: typeof process.stdout.write;

function startCapture(): void {
  captured = "";
  origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string | Uint8Array): boolean => {
    captured += typeof s === "string" ? s : s.toString();
    return true;
  };
}

function stopCapture(): void {
  process.stdout.write = origWrite;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-disco-"));
  configureOutput({ noColor: true, quiet: false, json: false });
});

afterEach(() => {
  stopCapture();
  fs.rmSync(ACTIVE_DIR, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  configureOutput({ noColor: true, quiet: true, json: false });
});

/** Register a live loop in its own state dir (live lock holding our pid). */
function registerLiveLoop(label: string, status: ActiveLoopEntry["status"] = "running"): string {
  const stateDir = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), `rauf-disco-${label}-`)));
  fs.writeFileSync(
    path.join(stateDir, LOCK_FILENAME),
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      processStartTime: null, // null → recycle check skipped; our pid is alive
    }),
  );
  registerLoop({
    stateDir,
    projectPath: path.dirname(stateDir),
    backlogRoot: path.join(stateDir, ".."),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status,
  });
  return stateDir;
}

function makeCtx(
  args: string[],
  flags: Record<string, string | true> = {},
  json = false,
): CommandContext {
  return {
    args,
    flags: new Map(Object.entries(flags)),
    globalFlags: { json, quiet: false, noColor: true, root: null },
    rawArgv: [],
  };
}

// ─── status --all ──────────────────────────────────────────────────

describe("status --all", () => {
  it("lists every machine-wide live loop (human form)", async () => {
    registerLiveLoop("a");
    registerLiveLoop("b");

    startCapture();
    const code = await handleStatus(makeCtx([tmpDir], { all: true }));
    stopCapture();

    expect(code).toBe(ExitCode.SUCCESS);
    expect(captured).toContain("Live loops (machine-wide):");
    // Both registered loops are surfaced.
    expect((captured.match(/PID /g) ?? []).length).toBe(2);
  });

  it("reports no live loops when the registry is empty (never silent)", async () => {
    startCapture();
    const code = await handleStatus(makeCtx([tmpDir], { all: true }));
    stopCapture();

    expect(code).toBe(ExitCode.SUCCESS);
    expect(captured).toContain("No live loops on this machine.");
  });

  it("emits the ActiveLoopEntry[] list under --json with stable ordering", async () => {
    const a = registerLiveLoop("a");
    const b = registerLiveLoop("b");

    startCapture();
    const code = await handleStatus(makeCtx([tmpDir], { all: true }, true));
    stopCapture();

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(captured) as { loops: ActiveLoopEntry[] };
    expect(Array.isArray(parsed.loops)).toBe(true);
    expect(parsed.loops).toHaveLength(2);
    const dirs = parsed.loops.map((l) => l.stateDir).sort();
    expect(dirs).toEqual([a, b].sort());

    // Stable ordering: a second read returns the same order.
    startCapture();
    await handleStatus(makeCtx([tmpDir], { all: true }, true));
    stopCapture();
    const parsed2 = JSON.parse(captured) as { loops: ActiveLoopEntry[] };
    expect(parsed2.loops.map((l) => l.stateDir)).toEqual(parsed.loops.map((l) => l.stateDir));
  });
});

// ─── empty-is-never-silent ─────────────────────────────────────────

describe("empty-is-never-silent", () => {
  it("names the inspected directory when the root has no state", async () => {
    // tmpDir has no .rauf — inspecting it must not be silent.
    startCapture();
    const code = await handleStatus(makeCtx([tmpDir]));
    stopCapture();

    expect(code).toBe(ExitCode.SUCCESS);
    expect(captured).toContain("No loop activity in");
    expect(captured).toContain(path.join(tmpDir, ".rauf"));
  });

  it("surfaces a loop live in another backlog root", async () => {
    const otherDir = registerLiveLoop("elsewhere", "running");

    startCapture();
    const code = await handleStatus(makeCtx([tmpDir]));
    stopCapture();

    expect(code).toBe(ExitCode.SUCCESS);
    expect(captured).toContain("A loop is live in another backlog root:");
    expect(captured).toContain(path.resolve(otherDir, ".."));
    expect(captured).toContain("rauf status --all");
  });

  it("emits a structured empty payload under --json", async () => {
    const otherDir = registerLiveLoop("jsonelse", "running");

    startCapture();
    const code = await handleStatus(makeCtx([tmpDir], {}, true));
    stopCapture();

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(captured) as {
      inspected: string;
      empty: boolean;
      liveElsewhere: { stateDir: string }[];
    };
    expect(parsed.empty).toBe(true);
    expect(parsed.inspected).toContain(".rauf");
    expect(parsed.liveElsewhere.map((e) => e.stateDir)).toContain(otherDir);
  });
});
