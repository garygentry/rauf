import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

// Redirect TOOL_CONFIG_DIR (and thus the registry's ACTIVE_DIR = ~/.rauf/active)
// to an isolated temp home so listActiveLoops() never touches the real ~/.rauf.
const { TMP_HOME } = vi.hoisted(() => {
  // require() is necessary here: vi.hoisted runs before ESM imports resolve.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const nodeFs = require("node:fs") as typeof import("node:fs");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "rauf-status-home-"));
  return { TMP_HOME: dir };
});

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  const nodePath = await import("node:path");
  return { ...actual, TOOL_CONFIG_DIR: nodePath.join(TMP_HOME, ".rauf") };
});

import { deriveStatus, surfaceInspectedStatus } from "./status.js";
import { registerLoop } from "./loop-registry.js";
import { STATE_FILENAME, LOCK_FILENAME, defaultBacklogPaths } from "./backlog-root.js";
import type { BacklogPaths } from "./backlog-root.js";
import type { ActiveLoopEntry, LoopState } from "./schemas.js";

const ACTIVE_DIR = path.join(TMP_HOME, ".rauf", "active");

let tmpDir: string;

afterEach(() => {
  // Clear registry + project dirs between tests so listings don't bleed.
  fs.rmSync(ACTIVE_DIR, { recursive: true, force: true });
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makePaths(): BacklogPaths {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-status-inspect-"));
  return defaultBacklogPaths(tmpDir);
}

function makeLoopState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    status: "running",
    iteration: 1,
    maxIterations: 10,
    currentItem: "001",
    lastSignal: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedItems: [],
    blockedItems: [],
    deferredItems: [],
    baseCommitHash: null,
    error: null,
    ...overrides,
  };
}

/** Register a live loop in its own state dir (with a live lock holding our pid). */
function registerLiveLoopElsewhere(): ActiveLoopEntry {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-status-other-"));
  fs.writeFileSync(
    path.join(path.resolve(stateDir), LOCK_FILENAME),
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      processStartTime: null,
    }) + "\n",
  );
  const entry: ActiveLoopEntry = {
    stateDir,
    projectPath: path.dirname(stateDir),
    backlogRoot: stateDir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  registerLoop(entry);
  return entry;
}

describe("surfaceInspectedStatus", () => {
  it("empty root surfaces the inspected directory", () => {
    const paths = makePaths(); // no .rauf/, no state.json
    const status = deriveStatus(paths);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stateSource).toBe("none");

    const ctx = surfaceInspectedStatus(paths, status.value);
    expect(ctx.inspectedDir).toBe(paths.stateDir);
    expect(ctx.empty).toBe(true);
    expect(ctx.liveElsewhere).toEqual([]);
  });

  it("empty root with a live loop elsewhere surfaces cross-root liveness", () => {
    const other = registerLiveLoopElsewhere();
    const paths = makePaths();
    const status = deriveStatus(paths);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const ctx = surfaceInspectedStatus(paths, status.value);
    expect(ctx.empty).toBe(true);
    expect(ctx.inspectedDir).toBe(paths.stateDir);
    expect(ctx.liveElsewhere).toHaveLength(1);
    expect(ctx.liveElsewhere[0]!.stateDir).toBe(other.stateDir);
    // Registry status is advisory only.
    expect(ctx.liveElsewhere[0]!.status).toBe("running");
  });

  it("excludes the inspected root itself from liveElsewhere", () => {
    // Make the inspected root the live one — it must NOT appear in liveElsewhere.
    const paths = makePaths();
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.writeFileSync(path.join(paths.stateDir, STATE_FILENAME), JSON.stringify(makeLoopState()));
    fs.writeFileSync(
      path.join(paths.stateDir, LOCK_FILENAME),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        processStartTime: null,
      }) + "\n",
    );
    registerLoop({
      stateDir: paths.stateDir,
      projectPath: tmpDir,
      backlogRoot: tmpDir,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      status: "running",
    });

    const status = deriveStatus(paths);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const ctx = surfaceInspectedStatus(paths, status.value);
    expect(ctx.empty).toBe(false); // state.json present — not the "none" case
    expect(ctx.liveElsewhere).toEqual([]);
  });

  it("populated root is unchanged — deriveStatus stays authoritative (not 'empty')", () => {
    const paths = makePaths();
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.writeFileSync(
      paths.state,
      JSON.stringify(makeLoopState({ status: "running", currentItem: "007" })),
    );

    const status = deriveStatus(paths);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stateSource).toBe("state.json");
    expect(status.value.loopState).toBe("RUNNING");
    expect(status.value.currentItem).toBe("007");

    const ctx = surfaceInspectedStatus(paths, status.value);
    expect(ctx.empty).toBe(false);
    expect(ctx.inspectedDir).toBe(paths.stateDir);
  });
});
