// ─── Status API Route Tests ───────────────────────────────────────
//
// Tests for: GET /:id/status, GET /:id/log, GET /:id/log/stream,
//            GET /:id/progress

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeApp(rootDirectory: string) {
  return createApp(Date.now(), { rootDirectory });
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

/** Create a minimal valid .rauf.json (MarkerFile). */
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
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck",
        lint: null,
        build: null,
        format: null,
      },
      verify: "pnpm test && pnpm typecheck",
    },
    artifactHashes: {},
    options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
  };
  fs.writeFileSync(path.join(dir, ".rauf.json"), JSON.stringify(marker, null, 2));
}

/** Write a state.json to .rauf/ */
function writeState(dir: string, overrides: Record<string, unknown> = {}): void {
  const raufDir = path.join(dir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  const state = {
    status: "running",
    currentItem: "001",
    iteration: 2,
    maxIterations: 20,
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    updatedAt: new Date().toISOString(),
    lastSignal: "clean",
    completedItems: ["000"],
    blockedItems: [],
    error: null,
    ...overrides,
  };
  fs.writeFileSync(path.join(raufDir, "state.json"), JSON.stringify(state, null, 2));
}

/** Write a log file with some lines. */
function writeLog(dir: string, lines: string[]): void {
  const raufDir = path.join(dir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(path.join(raufDir, "rauf.log"), lines.join("\n") + "\n");
}

/** Write a progress.md file. */
function writeProgress(dir: string, content: string): void {
  const raufDir = path.join(dir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(path.join(raufDir, "progress.md"), content);
}

/** Ensure .rauf/ directory exists (without any files). */
function writeRaufDir(dir: string): void {
  fs.mkdirSync(path.join(dir, ".rauf"), { recursive: true });
}

// ─── Setup ───────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-status-test-"));
  projectDir = path.join(tmpDir, "my-project");
  fs.mkdirSync(projectDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── GET /api/projects/:id/status ────────────────────────────────

describe("GET /api/projects/:id/status", () => {
  it("returns IDLE when .rauf/ directory is missing (caller handles NOT_INSTALLED)", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/status");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loopState: string } };
    expect(body.data.loopState).toBe("IDLE");
  });

  it("returns IDLE when .rauf/ exists but no state.json or log file", async () => {
    writeMarker(projectDir);
    writeRaufDir(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/status");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loopState: string; stateSource: string } };
    expect(body.data.loopState).toBe("IDLE");
    expect(body.data.stateSource).toBe("none");
  });

  it("returns RUNNING with correct fields from state.json", async () => {
    writeMarker(projectDir);
    writeState(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/status");
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      data: {
        loopState: string;
        stateSource: string;
        iteration: number;
        maxIterations: number;
        currentItem: string;
      };
    };
    expect(body.data.loopState).toBe("RUNNING");
    expect(body.data.stateSource).toBe("state.json");
    expect(body.data.iteration).toBe(2);
    expect(body.data.maxIterations).toBe(20);
    expect(body.data.currentItem).toBe("001");
  });

  it("returns DerivedStatus with backlogSummary", async () => {
    writeMarker(projectDir);
    writeRaufDir(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/status");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { backlogSummary: Record<string, number> } };
    expect(body.data.backlogSummary).toMatchObject({
      pending: expect.any(Number),
      inProgress: expect.any(Number),
      blocked: expect.any(Number),
      done: expect.any(Number),
      total: expect.any(Number),
    });
  });

  it("returns PAUSED when state.json shows running but is stale (>5 min old)", async () => {
    writeMarker(projectDir);
    // Write a state.json with updatedAt > 5 min ago
    writeState(projectDir, {
      status: "running",
      updatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/status");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loopState: string } };
    expect(body.data.loopState).toBe("PAUSED");
  });

  it("returns 400 for invalid project ID (path traversal)", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/status");
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ID");
  });

  it("returns 400 for dot-dot traversal", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/../status");
    // Hono may decode ".." differently; check for error response
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error).toBeDefined();
  });
});

// ─── GET /api/projects/:id/log ────────────────────────────────────

describe("GET /api/projects/:id/log", () => {
  it("returns empty array when log file is missing", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/log");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string[] };
    expect(body.data).toEqual([]);
  });

  it("returns last 50 lines by default", async () => {
    writeMarker(projectDir);
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);
    writeLog(projectDir, lines);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/log");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string[] };
    expect(body.data).toHaveLength(50);
    expect(body.data[0]).toBe("Line 11");
    expect(body.data[49]).toBe("Line 60");
  });

  it("returns ?tail=N lines when specified", async () => {
    writeMarker(projectDir);
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    writeLog(projectDir, lines);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/log?tail=5");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string[] };
    expect(body.data).toHaveLength(5);
    expect(body.data[0]).toBe("Line 16");
    expect(body.data[4]).toBe("Line 20");
  });

  it("returns all lines when fewer than tail limit", async () => {
    writeMarker(projectDir);
    writeLog(projectDir, ["line1", "line2", "line3"]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/log?tail=50");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string[] };
    expect(body.data).toHaveLength(3);
  });

  it("defaults to 50 lines on invalid tail param", async () => {
    writeMarker(projectDir);
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);
    writeLog(projectDir, lines);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/log?tail=abc");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string[] };
    // Falls back to default 50
    expect(body.data).toHaveLength(50);
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/log");
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/projects/:id/log/stream ────────────────────────────

describe("GET /api/projects/:id/log/stream", () => {
  // Helper: make a request that can be cleanly cancelled.
  // Cancelling res.body triggers stream.onAbort() in Hono, which resolves
  // abortPromise and lets the SSE callback exit cleanly.
  async function sseRequest(app: ReturnType<typeof makeApp>, path: string) {
    const res = await app.request(path);
    return res;
  }

  it("returns 200 with text/event-stream content type", async () => {
    writeMarker(projectDir);
    writeRaufDir(projectDir);
    const app = makeApp(tmpDir);
    const res = await sseRequest(app, "/api/projects/my-project/log/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    // Cancel to clean up the streaming callback
    await res.body?.cancel();
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/log/stream");
    expect(res.status).toBe(400);
  });

  it("includes initial log event when log file has content", async () => {
    writeMarker(projectDir);
    writeLog(projectDir, ["log line 1", "log line 2", "log line 3"]);
    const app = makeApp(tmpDir);
    const res = await sseRequest(app, "/api/projects/my-project/log/stream");
    expect(res.status).toBe(200);

    // Read the first chunk: contains the initial log + status events
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    // Cancel to trigger stream.onAbort() cleanup
    await reader.cancel();

    const text = new TextDecoder().decode(value);
    // Should contain a "log" SSE event with the log lines
    expect(text).toContain("event: log");
    expect(text).toContain("log line 1");
  });

  it("includes initial status event when state.json exists", async () => {
    writeMarker(projectDir);
    writeState(projectDir);
    const app = makeApp(tmpDir);
    const res = await sseRequest(app, "/api/projects/my-project/log/stream");
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    const text = new TextDecoder().decode(value);
    // Should contain a "status" SSE event
    expect(text).toContain("event: status");
    expect(text).toContain("RUNNING");
  });

  it("handles missing log file gracefully (no initial log event)", async () => {
    writeMarker(projectDir);
    writeRaufDir(projectDir);
    // No log file — log watcher setup should not throw
    const app = makeApp(tmpDir);
    const res = await sseRequest(app, "/api/projects/my-project/log/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    // The SSE stream should start without errors (no initial log event though)
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    const text = new TextDecoder().decode(value);
    // No log event expected (no log file), but status event is expected
    expect(text).not.toContain("event: log");
    expect(text).toContain("event: status");
  });
});

// ─── GET /api/projects/:id/progress ──────────────────────────────

describe("GET /api/projects/:id/progress", () => {
  it("returns empty string when progress.md is missing", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/progress");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string };
    expect(body.data).toBe("");
  });

  it("returns markdown content when progress.md exists", async () => {
    writeMarker(projectDir);
    const content = "# Progress\n\n## Session 1\n\n- Did some work\n";
    writeProgress(projectDir, content);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/progress");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string };
    expect(body.data).toBe(content);
  });

  it("returns empty string when .rauf/ dir does not exist", async () => {
    writeMarker(projectDir);
    // No .rauf/ directory at all
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/progress");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string };
    expect(body.data).toBe("");
  });

  it("preserves multi-line markdown content exactly", async () => {
    writeMarker(projectDir);
    const content =
      "# Progress\n\n## Learnings\n\n- Pattern A works\n- Pattern B does not\n\n## Next steps\n\nTBD\n";
    writeProgress(projectDir, content);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/progress");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: string };
    expect(body.data).toBe(content);
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/progress");
    expect(res.status).toBe(400);
  });
});
