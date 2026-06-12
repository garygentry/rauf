// ─── Loop API Route Tests ─────────────────────────────────────────
//
// Tests for: POST /:id/loop/start, POST /:id/loop/stop,
//            GET /:id/loop/events
//
// Uses real temp directories with mock claude scripts.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The active-loop registry lives at ~/.rauf/active/. Redirect HOME to an
// isolated temp dir BEFORE @rauf/core is imported (os.homedir() reads $HOME on
// POSIX; ACTIVE_DIR is bound at core module load) so listActiveLoops() never
// touches the real ~/.rauf. Mirrors the CLI status-discovery.test.ts pattern.
const { TMP_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const nodeFs = require("node:fs") as typeof import("node:fs");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "rauf-web-loop-home-"));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir; // Windows parity (harmless on POSIX)
  return { TMP_HOME: dir };
});

import {
  registerLoop,
  LOCK_FILENAME,
  EVENTS_LOG_FILENAME,
  type ActiveLoopEntry,
  type PersistedEvent,
} from "@rauf/core";

import { createApp } from "../app.js";
import { resetLoopManager } from "../loop-manager.js";

const ACTIVE_DIR = path.join(TMP_HOME, ".rauf", "active");

// ─── Helpers ─────────────────────────────────────────────────────

let tmpDir: string;
let originalPath: string;

function makeApp(rootDirectory: string) {
  return createApp(Date.now(), { rootDirectory });
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

function writeMarker(dir: string): void {
  const marker = {
    rauf: true,
    version: "1",
    variant: "backlog-json",
    installedAt: new Date().toISOString(),
    installedBy: "test",
    profile: {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: { test: null, typecheck: null, lint: null, build: null, format: null },
      verify: "",
    },
    artifactHashes: {},
    options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
  };
  fs.writeFileSync(path.join(dir, ".rauf.json"), JSON.stringify(marker, null, 2));
}

function writeBacklog(dir: string, items: unknown[] = []): void {
  const raufDir = path.join(dir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  const backlog = { project: "test", description: "test project", items };
  fs.writeFileSync(path.join(raufDir, "backlog.json"), JSON.stringify(backlog, null, 2));
}

function writeRaufMd(dir: string): void {
  const raufDir = path.join(dir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(path.join(raufDir, "RAUF.md"), "# Test\nVerify: echo ok\n");
}

function setupMockClaude(signal = "RAUF_DONE"): void {
  const mockBinDir = path.join(tmpDir, "mock-bin");
  fs.mkdirSync(mockBinDir, { recursive: true });
  const script = `#!/bin/bash\necho "${signal}"\nexit 0\n`;
  fs.writeFileSync(path.join(mockBinDir, "claude"), script);
  fs.chmodSync(path.join(mockBinDir, "claude"), 0o755);
  process.env["PATH"] = `${mockBinDir}:${originalPath}`;
}

function setupLongRunningClaude(): void {
  const mockBinDir = path.join(tmpDir, "mock-bin");
  fs.mkdirSync(mockBinDir, { recursive: true });
  const script = `#!/bin/bash\nexec sleep 999\n`;
  fs.writeFileSync(path.join(mockBinDir, "claude"), script);
  fs.chmodSync(path.join(mockBinDir, "claude"), 0o755);
  process.env["PATH"] = `${mockBinDir}:${originalPath}`;
}

function createProject(name: string, items: unknown[] = []): string {
  const projectPath = path.join(tmpDir, name);
  fs.mkdirSync(projectPath, { recursive: true });
  writeMarker(projectPath);
  writeBacklog(projectPath, items);
  writeRaufMd(projectPath);
  return projectPath;
}

/** Seed a project's events.ndjson with PersistedEvent records (one JSON line each). */
function seedEvents(projectPath: string, records: PersistedEvent[]): void {
  const raufDir = path.join(projectPath, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(path.join(raufDir, EVENTS_LOG_FILENAME), lines);
}

/** Build a minimal valid loop_started PersistedEvent. */
function loopStarted(projectPath: string, seq: number): PersistedEvent {
  return {
    type: "loop_started",
    timestamp: new Date(seq * 1000).toISOString(),
    projectPath,
    maxIterations: 5,
    seq,
    schemaVersion: "1",
  };
}

/** Register a live loop in the (isolated) registry with a live lock holding our pid. */
function registerLiveLoop(label: string): string {
  const stateDir = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), `rauf-web-live-${label}-`)));
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
    status: "running",
  });
  return stateDir;
}

/**
 * Read an SSE response body, accumulating text until `predicate(buf)` is true or
 * the timeout elapses, then cancel the stream (triggering the handler's abort
 * cleanup). The handler blocks until client disconnect, so we MUST cancel.
 */
async function readSSEUntil(
  res: Response,
  predicate: (buf: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const tick = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: false }>((r) =>
          setTimeout(() => r({ value: undefined, done: false }), 100),
        ),
      ]);
      if (tick.done) break;
      if (tick.value) buf += decoder.decode(tick.value, { stream: true });
      if (predicate(buf)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return buf;
}

const pendingItem = {
  id: "001",
  type: "feature",
  priority: 1,
  title: "Test item",
  description: "Test",
  acceptanceCriteria: ["test"],
  status: "pending",
  completedAt: null,
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-loop-route-test-"));
  originalPath = process.env["PATH"] ?? "";
  resetLoopManager();
});

afterEach(() => {
  process.env["PATH"] = originalPath;
  resetLoopManager();
  fs.rmSync(ACTIVE_DIR, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── POST /:id/loop/start ────────────────────────────────────────

describe("POST /:id/loop/start", () => {
  it("starts a loop and returns 200", async () => {
    createProject("test-project", [pendingItem]);
    setupMockClaude();
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
      headers: {
        "X-Rauf-Request": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxIterations: 1 }),
    });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { started: boolean } };
    expect(body.data.started).toBe(true);
  });

  it("returns 409 on already-running project", async () => {
    createProject("test-project", [pendingItem]);
    setupLongRunningClaude();
    const app = makeApp(tmpDir);

    // Start first loop
    const res1 = await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
      headers: {
        "X-Rauf-Request": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxIterations: 5 }),
    });
    expect(res1.status).toBe(200);

    // Try to start second loop
    const res2 = await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
      headers: {
        "X-Rauf-Request": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxIterations: 1 }),
    });

    expect(res2.status).toBe(409);
    const body = (await json(res2)) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("uses default options when body is empty", async () => {
    createProject("test-project");
    setupMockClaude();
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });

    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/loop/start", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });
    expect(res.status).toBe(400);
  });

  it("requires CSRF header", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});

// ─── POST /:id/loop/stop ─────────────────────────────────────────

describe("POST /:id/loop/stop", () => {
  it("returns 404 when no loop is running", async () => {
    createProject("test-project");
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/test-project/loop/stop", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });

    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("stops a running loop and returns 200", async () => {
    createProject("test-project", [pendingItem]);
    setupLongRunningClaude();
    const app = makeApp(tmpDir);

    // Start loop first
    await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
      headers: {
        "X-Rauf-Request": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxIterations: 5 }),
    });

    // Stop it
    const res = await app.request("/api/projects/test-project/loop/stop", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { stopped: boolean } };
    expect(body.data.stopped).toBe(true);
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/loop/stop", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id/loop/events ────────────────────────────────────────

describe("GET /:id/loop/events", () => {
  it("returns SSE stream with correct content type", async () => {
    createProject("test-project");
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/test-project/loop/events", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await readSSEUntil(res, (b) => b.includes("heartbeat"));
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/loop/events", {
      method: "GET",
    });
    expect(res.status).toBe(400);
  });

  it("replays events.ndjson as loop_event SSE (no server-owned runner)", async () => {
    // V1: file-backed replay — the server never started this loop, yet the
    // events.ndjson is streamed back. Proves in-process parity (REQ-WEB-01, SC-1).
    const projectPath = createProject("test-project");
    seedEvents(projectPath, [loopStarted(projectPath, 0), loopStarted(projectPath, 1)]);
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/test-project/loop/events", {
      method: "GET",
    });
    expect(res.status).toBe(200);

    const buf = await readSSEUntil(res, (b) => (b.match(/event: loop_event/g) ?? []).length >= 2);
    const loopEventCount = (buf.match(/event: loop_event/g) ?? []).length;
    expect(loopEventCount).toBeGreaterThanOrEqual(2);
    expect(buf).toContain('"seq":0');
    expect(buf).toContain('"seq":1');
    expect(buf).toContain('"type":"loop_started"');
  });

  it("missing events.ndjson → empty timeline, heartbeat only, no error", async () => {
    // V3: graceful absence (REQ-REL-03). A backlog.json exists but no event log.
    createProject("test-project");
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/test-project/loop/events", {
      method: "GET",
    });
    expect(res.status).toBe(200);

    const buf = await readSSEUntil(res, (b) => b.includes("heartbeat"), 1000);
    expect(buf).toContain("event: heartbeat");
    expect(buf).not.toContain("event: loop_event");
    expect(buf).not.toContain("event: loop_error");
  });

  it("?backlog resolution failure emits loop_error (NOT a silent default-root fallback)", async () => {
    // A ?backlog escaping the project root fails resolveBacklogRoot. The handler
    // must surface the error rather than tailing the wrong (default) root
    // (REQ-DISC-01/02). Seed the default root with events to prove they are NOT
    // streamed when resolution fails.
    const projectPath = createProject("test-project");
    seedEvents(projectPath, [loopStarted(projectPath, 0)]);
    const app = makeApp(tmpDir);

    const res = await app.request(
      "/api/projects/test-project/loop/events?backlog=" + encodeURIComponent("../../escape"),
      { method: "GET" },
    );
    expect(res.status).toBe(200);

    const buf = await readSSEUntil(res, (b) => b.includes("event: loop_error"), 1000);
    expect(buf).toContain("event: loop_error");
    expect(buf).toContain("PATH_VIOLATION");
    // The default root's seeded event must NOT have leaked through.
    expect(buf).not.toContain("event: loop_event");
  });
});

// ─── GET /api/loops ──────────────────────────────────────────────

describe("GET /api/loops", () => {
  it("returns an empty list when no loops are registered", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/loops", { method: "GET" });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loops: ActiveLoopEntry[] } };
    expect(body.data.loops).toEqual([]);
  });

  it("returns reconciled registry entries (any mode, not just server-owned)", async () => {
    // V2: a loop registered in the registry — with no manager runner — is listed
    // as a full ActiveLoopEntry (REQ-WEB-03, REQ-DISC-05).
    const stateDir = registerLiveLoop("a");
    const app = makeApp(tmpDir);

    const res = await app.request("/api/loops", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loops: ActiveLoopEntry[] } };
    expect(body.data.loops).toHaveLength(1);
    const entry = body.data.loops[0]!;
    expect(entry.stateDir).toBe(stateDir);
    expect(entry.pid).toBe(process.pid);
    expect(entry.status).toBe("running");
  });

  it("excludes a stale registry entry (self-heal)", async () => {
    // A registered entry with no live lock reconciles as not-live and is pruned.
    const stateDir = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "rauf-web-stale-")));
    registerLoop({
      stateDir,
      projectPath: path.dirname(stateDir),
      backlogRoot: path.join(stateDir, ".."),
      pid: 2147483646, // a pid that is (essentially certainly) dead
      startedAt: new Date().toISOString(),
      status: "running",
    });
    const app = makeApp(tmpDir);

    const res = await app.request("/api/loops", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loops: ActiveLoopEntry[] } };
    expect(body.data.loops).toEqual([]);

    fs.rmSync(stateDir, { recursive: true, force: true });
  });
});

// ─── Route mounting ──────────────────────────────────────────────

describe("Route mounting", () => {
  it("loop routes are mounted under /api/projects/:id/loop/*", async () => {
    const app = makeApp(tmpDir);

    // Verify start endpoint is reachable (gets CSRF error, not 404)
    const res = await app.request("/api/projects/test/loop/start", {
      method: "POST",
    });
    // Should be 403 (CSRF), not 404 — proves route is mounted
    expect(res.status).toBe(403);
  });
});
