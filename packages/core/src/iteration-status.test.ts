import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  writeIterationStatus,
  readIterationStatus,
  clearIterationStatus,
} from "./iteration-status.js";
import { defaultBacklogPaths } from "./backlog-root.js";
import type { BacklogPaths } from "./backlog-root.js";
import type { IterationStatus } from "./schemas.js";

let tmpDir: string;
let paths: BacklogPaths;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-iter-status-"));
  fs.mkdirSync(path.join(tmpDir, ".ralph"), { recursive: true });
  paths = defaultBacklogPaths(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStatus(overrides?: Partial<IterationStatus>): IterationStatus {
  return {
    itemId: "001",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentTool: "Edit",
    recentTools: ["Read", "Edit"],
    tokens: { input: 100, output: 50 },
    lastActivityAt: new Date().toISOString(),
    stuckWarning: false,
    ...overrides,
  };
}

describe("iteration-status", () => {
  it("writeIterationStatus writes a valid JSON file that readIterationStatus can parse", () => {
    const status = makeStatus();
    const result = writeIterationStatus(paths, status, true);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(true);

    const read = readIterationStatus(paths);
    expect(read).not.toBeNull();
    expect(read!.itemId).toBe("001");
    expect(read!.currentTool).toBe("Edit");
  });

  it("writeIterationStatus with force=true always writes", () => {
    const status1 = makeStatus({ currentTool: "Read" });
    const status2 = makeStatus({ currentTool: "Bash" });

    const r1 = writeIterationStatus(paths, status1, true);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value).toBe(true);

    const r2 = writeIterationStatus(paths, status2, true);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value).toBe(true);

    const read = readIterationStatus(paths);
    expect(read).not.toBeNull();
    expect(read!.currentTool).toBe("Bash");
  });

  it("writeIterationStatus without force throttles rapid second call", () => {
    const status = makeStatus();

    const r1 = writeIterationStatus(paths, status);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value).toBe(true);

    // Immediate second call should be throttled
    const r2 = writeIterationStatus(paths, status);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value).toBe(false);
  });

  it("readIterationStatus returns null when file does not exist", () => {
    const result = readIterationStatus(paths);
    expect(result).toBeNull();
  });

  it("readIterationStatus returns null for invalid JSON", () => {
    fs.writeFileSync(paths.iterationStatus, "not valid json {{{");
    const result = readIterationStatus(paths);
    expect(result).toBeNull();
  });

  it("clearIterationStatus removes the file", () => {
    writeIterationStatus(paths, makeStatus(), true);
    expect(fs.existsSync(paths.iterationStatus)).toBe(true);

    clearIterationStatus(paths);
    expect(fs.existsSync(paths.iterationStatus)).toBe(false);
  });

  it("clearIterationStatus succeeds even if file does not exist", () => {
    expect(fs.existsSync(paths.iterationStatus)).toBe(false);
    // Should not throw
    clearIterationStatus(paths);
  });

  it("writes to a non-default root when BacklogPaths points elsewhere", () => {
    // Create a custom backlog root at tmpDir/specs/auth/.ralph/
    const customStateDir = path.join(tmpDir, "specs", "auth", ".ralph");
    fs.mkdirSync(customStateDir, { recursive: true });

    const customPaths: BacklogPaths = {
      projectPath: tmpDir,
      root: path.join(tmpDir, "specs", "auth"),
      stateDir: customStateDir,
      backlog: path.join(customStateDir, "backlog.json"),
      state: path.join(customStateDir, "state.json"),
      log: path.join(customStateDir, "ralph.log"),
      done: path.join(customStateDir, "DONE"),
      cancel: path.join(customStateDir, "CANCEL"),
      progress: path.join(customStateDir, "progress.md"),
      iterationStatus: path.join(customStateDir, "iteration-status.json"),
      archive: path.join(customStateDir, "archive"),
      lock: path.join(customStateDir, ".loop.lock"),
    };

    const status = makeStatus({ currentTool: "Write" });
    const result = writeIterationStatus(customPaths, status, true);
    expect(result.ok).toBe(true);

    // Verify the file was written to the custom location
    expect(fs.existsSync(customPaths.iterationStatus)).toBe(true);
    expect(fs.existsSync(path.join(customStateDir, "iteration-status.json"))).toBe(true);

    // Default paths location should NOT have the file
    expect(fs.existsSync(paths.iterationStatus)).toBe(false);

    // Read back via the custom paths
    const read = readIterationStatus(customPaths);
    expect(read).not.toBeNull();
    expect(read!.currentTool).toBe("Write");

    // Clean up via clearIterationStatus
    clearIterationStatus(customPaths);
    expect(fs.existsSync(customPaths.iterationStatus)).toBe(false);
  });
});
