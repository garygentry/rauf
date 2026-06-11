// ─── Loop API Route Tests ─────────────────────────────────────────
//
// Tests for: POST /:id/loop/start, POST /:id/loop/stop,
//            GET /:id/loop/events
//
// Uses real temp directories with mock claude scripts.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { resetLoopManager } from "../loop-manager.js";

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
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/loop/events", {
      method: "GET",
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/loops ──────────────────────────────────────────────

describe("GET /api/loops", () => {
  it("returns an empty list when no loops are running", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/loops", { method: "GET" });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loops: Array<{ projectPath: string }> } };
    expect(body.data.loops).toEqual([]);
  });

  it("lists in-flight loops with their project paths", async () => {
    const projectPath = createProject("test-project", [pendingItem]);
    setupLongRunningClaude();
    const app = makeApp(tmpDir);

    // Start a loop so it stays in-flight
    const startRes = await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
      headers: {
        "X-Rauf-Request": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxIterations: 5 }),
    });
    expect(startRes.status).toBe(200);

    const res = await app.request("/api/loops", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { loops: Array<{ projectPath: string }> } };
    expect(body.data.loops).toEqual([{ projectPath }]);

    // Stop it so afterEach doesn't leave a dangling sleep
    await app.request("/api/projects/test-project/loop/stop", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });
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
