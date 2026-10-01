import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  acquireLock,
  findSupervisorMarkers,
  readSupervisorMarker,
  recordSupervision,
  resolveBacklogPaths,
  supervisorIdFromEnv,
  supervisorMarkerPath,
  type BacklogPaths,
} from "@rauf/core";

import {
  CODEX_STOP_HOOK_CONFIG,
  MAX_BLOCKS_WITHOUT_WAIT,
  decideCodexStop,
  waitCommandFor,
} from "./hook-commands.js";
import { updateSupervision, type WaitResult } from "./wait-command.js";

const SESSION = "01a0f530-8116-7883-b1c2-d5f490644bad";

let tmpDir: string;
let paths: BacklogPaths;

function setup(backlogRel = "specs/auth"): BacklogPaths {
  const root = path.join(tmpDir, backlogRel);
  fs.mkdirSync(path.join(root, ".rauf"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "backlog.json"),
    JSON.stringify({ project: "t", description: "t", items: [] }),
  );
  const p = resolveBacklogPaths(tmpDir, root);
  if (!p.ok) throw new Error(p.error.message);
  return p.value;
}

function writeState(p: BacklogPaths, status: string, extra: Record<string, unknown> = {}): void {
  const now = new Date().toISOString();
  fs.writeFileSync(
    p.state,
    JSON.stringify({
      status,
      startedAt: now,
      updatedAt: now,
      iteration: 1,
      maxIterations: 5,
      currentItem: null,
      lastSignal: "clean",
      completedItems: [],
      blockedItems: [],
      error: null,
      pid: null,
      ...extra,
    }),
  );
}

/** A running loop: running state + a lock held by this live process. */
function running(p: BacklogPaths): void {
  writeState(p, "running");
  const r = acquireLock(p);
  if (!r.ok) throw new Error(r.error.message);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-hook-"));
  paths = setup();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("supervisor markers", () => {
  it("takes the session id from RAUF_SUPERVISOR_ID, else CODEX_THREAD_ID", () => {
    expect(supervisorIdFromEnv({})).toBeNull();
    expect(supervisorIdFromEnv({ CODEX_THREAD_ID: "c1" })).toBe("c1");
    expect(supervisorIdFromEnv({ CODEX_THREAD_ID: "c1", RAUF_SUPERVISOR_ID: "r1" })).toBe("r1");
  });

  it("records under <stateDir>/supervisors/ and is found by a bounded scan from the project root", () => {
    expect(recordSupervision(paths, SESSION, { nextSeq: 7, runId: "R" })).toBe(true);
    const file = supervisorMarkerPath(paths.stateDir, SESSION);
    expect(file).toBe(path.join(paths.stateDir, "supervisors", `${SESSION}.json`));
    expect(readSupervisorMarker(file)?.nextSeq).toBe(7);

    const found = findSupervisorMarkers(tmpDir, SESSION);
    expect(found).toHaveLength(1);
    expect(found[0]!.backlogRoot).toBe(path.resolve(paths.root));
    expect(findSupervisorMarkers(tmpDir, "someone-else")).toEqual([]);
  });

  it("loop wait keeps the marker's cursor current and removes it once the loop has ended", () => {
    vi.stubEnv("RAUF_SUPERVISOR_ID", SESSION);
    vi.stubEnv("CODEX_THREAD_ID", "");
    const base: WaitResult = {
      event: null,
      card: null,
      nextSeq: 12,
      runId: "R",
      runChanged: false,
      loopState: "RUNNING",
      progress: null,
      terminal: false,
      timedOut: true,
    };
    updateSupervision(paths, base);
    const file = supervisorMarkerPath(paths.stateDir, SESSION);
    expect(readSupervisorMarker(file)).toMatchObject({
      nextSeq: 12,
      runId: "R",
      blocksSinceWait: 0,
    });

    updateSupervision(paths, { ...base, terminal: true, timedOut: false });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("writes nothing when the session is not identifiable", () => {
    vi.stubEnv("RAUF_SUPERVISOR_ID", "");
    vi.stubEnv("CODEX_THREAD_ID", "");
    updateSupervision(paths, {
      event: null,
      card: null,
      nextSeq: 1,
      runId: null,
      runChanged: false,
      loopState: "RUNNING",
      progress: null,
      terminal: false,
      timedOut: true,
    });
    expect(fs.existsSync(path.join(paths.stateDir, "supervisors"))).toBe(false);
  });
});

describe("decideCodexStop", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    session_id: SESSION,
    cwd: tmpDir,
    stop_hook_active: false,
    ...over,
  });

  it("allows the stop when this session supervises nothing", () => {
    running(paths);
    expect(decideCodexStop(input())).toEqual({ decision: "allow" });
    // Another session's marker does not hold this one.
    recordSupervision(paths, "other-session", { nextSeq: 0, runId: null });
    expect(decideCodexStop(input())).toEqual({ decision: "allow" });
  });

  it("blocks while a supervised loop is running, naming the exact next wait", () => {
    running(paths);
    recordSupervision(paths, SESSION, { nextSeq: 9, runId: "2026-10-01T10:00:00.000Z" });

    const d = decideCodexStop(input());

    expect(d.decision).toBe("block");
    const reason = d.decision === "block" ? d.reason : "";
    expect(reason).toContain("specs/auth");
    expect(reason).toContain("RUNNING");
    expect(reason).toContain(
      `rauf loop wait ${tmpDir} --backlog specs/auth --since-seq 9 --run-id 2026-10-01T10:00:00.000Z --timeout 240s`,
    );
    expect(reason).toContain(supervisorMarkerPath(paths.stateDir, SESSION));
    // The block is counted on the marker.
    expect(
      readSupervisorMarker(supervisorMarkerPath(paths.stateDir, SESSION))?.blocksSinceWait,
    ).toBe(1);
  });

  it("allows (and drops the marker) once the loop has ended — complete or paused for a human", () => {
    for (const status of ["complete", "paused_human"]) {
      writeState(paths, status);
      recordSupervision(paths, SESSION, { nextSeq: 3, runId: "R" });
      expect(decideCodexStop(input())).toEqual({ decision: "allow" });
      expect(fs.existsSync(supervisorMarkerPath(paths.stateDir, SESSION))).toBe(false);
    }
  });

  it("lets go after repeated stops without a loop wait, even with stop_hook_active", () => {
    running(paths);
    recordSupervision(paths, SESSION, { nextSeq: 0, runId: null });

    for (let i = 0; i < MAX_BLOCKS_WITHOUT_WAIT; i++) {
      expect(decideCodexStop(input({ stop_hook_active: i > 0 })).decision).toBe("block");
    }
    const d = decideCodexStop(input({ stop_hook_active: true }));
    expect(d.decision).toBe("allow");
    expect(d.decision === "allow" ? d.systemMessage : "").toContain("rauf loop wait");

    // A loop wait resets the guard: the session is held again.
    recordSupervision(paths, SESSION, { nextSeq: 4, runId: "R" });
    expect(decideCodexStop(input({ stop_hook_active: true })).decision).toBe("block");
  });

  it("lets the session go while the loop sleeps on a usage limit", () => {
    writeState(paths, "sleeping_limit", { sleepUntil: "2026-10-01T15:00:00.000Z" });
    acquireLock(paths);
    recordSupervision(paths, SESSION, { nextSeq: 0, runId: null });
    const d = decideCodexStop(input());
    expect(d.decision).toBe("allow");
    expect(d.decision === "allow" ? d.systemMessage : "").toContain("sleeping on a usage limit");
  });

  it("finds a supervised loop outside the hook's cwd through the session index", () => {
    running(paths);
    recordSupervision(paths, SESSION, { nextSeq: 2, runId: "R" });
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-hook-cwd-"));
    try {
      expect(decideCodexStop(input({ cwd: elsewhere })).decision).toBe("block");
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
    // Once the marker is gone, the index entry is pruned and the stop allowed.
    fs.rmSync(supervisorMarkerPath(paths.stateDir, SESSION));
    expect(decideCodexStop(input({ cwd: os.tmpdir() })).decision).toBe("allow");
    expect(findSupervisorMarkers(os.tmpdir(), SESSION)).toEqual([]);
  });

  it("allows on malformed input (no session id)", () => {
    expect(decideCodexStop({})).toEqual({ decision: "allow" });
  });
});

describe("waitCommandFor / config", () => {
  it("quotes paths that need it and uses .rauf for the default root", () => {
    const cmd = waitCommandFor({
      sessionId: "s",
      projectPath: "/home/me/my proj",
      backlogRoot: "/home/me/my proj/.rauf",
      stateDir: "/home/me/my proj/.rauf",
      nextSeq: 0,
      runId: null,
      updatedAt: "",
      blocksSinceWait: 0,
    });
    expect(cmd).toBe(
      "rauf loop wait '/home/me/my proj' --backlog .rauf --since-seq 0 --timeout 240s",
    );
  });

  it("prints a Codex hooks.json Stop entry", () => {
    expect(CODEX_STOP_HOOK_CONFIG.hooks.Stop[0]!.hooks[0]).toEqual({
      type: "command",
      command: "rauf hook codex-stop",
      timeout: 30,
    });
  });
});
