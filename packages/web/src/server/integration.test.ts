// ─── API Integration Tests ────────────────────────────────────────
//
// End-to-end API round-trip tests that exercise the full Hono server
// stack, from HTTP request → route handler → core logic → filesystem
// → JSON response. These tests use real filesystem state (temp dirs)
// and Hono's app.request() to avoid network overhead.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createApp } from "./app.js";
import { install, type InstallOptions } from "@ralph/core";

// ─── Shared Helpers ──────────────────────────────────────────────

const ARTIFACTS_DIR = path.resolve(__dirname, "../../../../artifacts/variants/backlog-json");

/** CSRF + JSON headers for mutation requests. */
const MUTATION_HEADERS = {
  "X-Rauf-Request": "true",
  "Content-Type": "application/json",
};

function makeApp(rootDirectory: string) {
  return createApp(Date.now(), { rootDirectory });
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

/** Create a minimal project directory with common files. */
function createProject(
  dir: string,
  opts: { git?: boolean; packageJson?: boolean; tsconfig?: boolean; pnpmLock?: boolean } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });
  if (opts.git) fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  if (opts.packageJson) {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        scripts: { test: "vitest", typecheck: "tsc --noEmit" },
      }),
    );
  }
  if (opts.tsconfig) {
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
  }
  if (opts.pnpmLock) {
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  }
}

/** Install ralph into a project using core's install function. */
function installRauf(projectDir: string, overrides: Partial<InstallOptions> = {}): void {
  const result = install(projectDir, {
    artifactsDir: ARTIFACTS_DIR,
    projectName: path.basename(projectDir),
    ...overrides,
  });
  if (!result.ok) throw new Error(`Install failed: ${result.error.message}`);
}

/** Write a valid state.json for simulating loop state. */
function writeStateJson(projectDir: string, overrides: Record<string, unknown> = {}): void {
  const raufDir = path.join(projectDir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  const state = {
    status: "running",
    currentItem: "001",
    iteration: 1,
    maxIterations: 20,
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    updatedAt: new Date().toISOString(),
    lastSignal: "clean",
    completedItems: [],
    blockedItems: [],
    error: null,
    ...overrides,
  };
  fs.writeFileSync(path.join(raufDir, "state.json"), JSON.stringify(state, null, 2));
}

// ─── Setup ──────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;
let projectName: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-api-integration-"));
  projectName = "test-project";
  projectDir = path.join(tmpDir, projectName);
  createProject(projectDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });
  installRauf(projectDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════
// Health endpoint
// ═════════════════════════════════════════════════════════════════

describe("API Integration: health", () => {
  it("GET /api/health returns version and discovers projects", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: { version: string; projectCount: number } };
    expect(body.data.version).toBeDefined();
    expect(body.data.projectCount).toBe(1); // Our installed project
  });
});

// ═════════════════════════════════════════════════════════════════
// Projects API round-trip
// ═════════════════════════════════════════════════════════════════

describe("API Integration: projects", () => {
  it("GET /api/projects lists discovered projects", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);

    const body = (await json(res)) as {
      data: { projects: { name: string; path: string }[] };
    };
    expect(body.data.projects.length).toBe(1);
    expect(body.data.projects[0]!.name).toBe(projectName);
  });

  it("GET /api/projects/:id returns project detail", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request(`/api/projects/${projectName}`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: { name: string; marker: { rauf: boolean } } };
    expect(body.data.marker.rauf).toBe(true);
  });

  it("GET /api/projects/:id returns 404 for nonexistent project", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════
// Backlog API full CRUD round-trip
// ═════════════════════════════════════════════════════════════════

describe("API Integration: backlog CRUD round-trip", () => {
  it("create → read → update → delete through API", async () => {
    const app = makeApp(tmpDir);
    const base = `/api/projects/${projectName}/backlog`;

    // ── CREATE ──
    const createRes = await app.request(base, {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({
        type: "feature",
        priority: 1,
        title: "API Integration Feature",
        description: "Created via API",
        acceptanceCriteria: ["AC1 passes", "AC2 passes"],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await json(createRes)) as {
      data: { id: string; title: string; status: string };
    };
    expect(created.data.id).toBe("001");
    expect(created.data.title).toBe("API Integration Feature");
    expect(created.data.status).toBe("pending");

    // ── READ single ──
    const readRes = await app.request(`${base}/001`);
    expect(readRes.status).toBe(200);
    const readItem = (await json(readRes)) as { data: { id: string; title: string } };
    expect(readItem.data.id).toBe("001");
    expect(readItem.data.title).toBe("API Integration Feature");

    // ── CREATE second item ──
    const create2Res = await app.request(base, {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ type: "bug", priority: 2, title: "API Bug Fix" }),
    });
    expect(create2Res.status).toBe(201);
    const created2 = (await json(create2Res)) as { data: { id: string } };
    expect(created2.data.id).toBe("002");

    // ── LIST all ──
    const listRes = await app.request(base);
    expect(listRes.status).toBe(200);
    const listed = (await json(listRes)) as { data: { id: string }[] };
    expect(listed.data).toHaveLength(2);

    // ── LIST with filter ──
    const filteredRes = await app.request(`${base}?type=bug`);
    expect(filteredRes.status).toBe(200);
    const filtered = (await json(filteredRes)) as { data: { id: string; type: string }[] };
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0]!.type).toBe("bug");

    // ── UPDATE: change status pending → in_progress ──
    const updateRes = await app.request(`${base}/001`, {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await json(updateRes)) as { data: { status: string } };
    expect(updated.data.status).toBe("in_progress");

    // ── UPDATE: change status in_progress → done ──
    const doneRes = await app.request(`${base}/001`, {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ status: "done" }),
    });
    expect(doneRes.status).toBe(200);
    const doneItem = (await json(doneRes)) as { data: { status: string; completedAt: string } };
    expect(doneItem.data.status).toBe("done");
    expect(doneItem.data.completedAt).toBeTruthy();

    // ── DELETE ──
    const deleteRes = await app.request(`${base}/002`, {
      method: "DELETE",
      headers: MUTATION_HEADERS,
    });
    expect(deleteRes.status).toBe(200);

    // ── VERIFY final state ──
    const finalRes = await app.request(base);
    expect(finalRes.status).toBe(200);
    const finalList = (await json(finalRes)) as { data: { id: string; status: string }[] };
    expect(finalList.data).toHaveLength(1);
    expect(finalList.data[0]!.id).toBe("001");
    expect(finalList.data[0]!.status).toBe("done");
  });

  it("CSRF protection blocks mutations without header", async () => {
    const app = makeApp(tmpDir);
    const base = `/api/projects/${projectName}/backlog`;

    // POST without CSRF header
    const res = await app.request(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "feature", priority: 1, title: "Should fail" }),
    });
    expect(res.status).toBe(403);
  });

  it("invalid status transition returns 400", async () => {
    const app = makeApp(tmpDir);
    const base = `/api/projects/${projectName}/backlog`;

    // Create item
    await app.request(base, {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ type: "feature", priority: 1, title: "Item" }),
    });

    // Try invalid transition: pending → done (must go through in_progress)
    const res = await app.request(`${base}/001`, {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("TRANSITION_INVALID");
  });

  it("validation errors include field-level details", async () => {
    const app = makeApp(tmpDir);
    const base = `/api/projects/${projectName}/backlog`;

    const res = await app.request(base, {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ type: "invalid-type", priority: 99, title: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as {
      error: { code: string; details: { fieldErrors: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeDefined();
    expect(body.error.details.fieldErrors).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════
// Status API round-trip
// ═════════════════════════════════════════════════════════════════

describe("API Integration: status round-trip", () => {
  it("GET /api/projects/:id/status returns IDLE when no loop state", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request(`/api/projects/${projectName}/status`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as {
      data: { state: string; backlogSummary: { total: number } };
    };
    expect(body.data.loopState).toBe("IDLE");
    expect(body.data.backlogSummary.total).toBe(0); // Empty backlog
  });

  it("GET /api/projects/:id/status returns RUNNING with mock state.json", async () => {
    const app = makeApp(tmpDir);

    // Add an item and simulate loop running
    await app.request(`/api/projects/${projectName}/backlog`, {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ type: "feature", priority: 1, title: "Running task" }),
    });

    writeStateJson(projectDir, {
      status: "running",
      currentItem: "001",
    });

    const res = await app.request(`/api/projects/${projectName}/status`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: { state: string; currentItem: string } };
    expect(body.data.loopState).toBe("RUNNING");
    expect(body.data.currentItem).toBe("001");
  });

  it("GET /api/projects/:id/log returns empty when no log file", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request(`/api/projects/${projectName}/log`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: string[] };
    expect(body.data).toEqual([]);
  });

  it("GET /api/projects/:id/log returns log lines when log exists", async () => {
    const app = makeApp(tmpDir);

    // Write a log file
    const logContent = "Line 1\nLine 2\nLine 3\n";
    const raufDir = path.join(projectDir, ".rauf");
    fs.writeFileSync(path.join(raufDir, "rauf.log"), logContent);

    const res = await app.request(`/api/projects/${projectName}/log?tail=2`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: string[] };
    expect(body.data).toHaveLength(2);
    expect(body.data[1]).toBe("Line 3");
  });

  it("GET /api/projects/:id/progress returns empty string when no progress file", async () => {
    const app = makeApp(tmpDir);

    // Remove progress.md that install creates
    const progressPath = path.join(projectDir, ".rauf", "progress.md");
    if (fs.existsSync(progressPath)) fs.unlinkSync(progressPath);

    const res = await app.request(`/api/projects/${projectName}/progress`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: string };
    expect(body.data).toBe("");
  });

  it("GET /api/projects/:id/progress returns content when progress exists", async () => {
    const app = makeApp(tmpDir);

    // Write progress content
    fs.writeFileSync(
      path.join(projectDir, ".rauf", "progress.md"),
      "# Progress\n\n## Learnings\n\n- Pattern A works well\n",
    );

    const res = await app.request(`/api/projects/${projectName}/progress`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: string };
    expect(body.data).toContain("# Progress");
    expect(body.data).toContain("Pattern A works well");
  });
});

// ═════════════════════════════════════════════════════════════════
// Profile API round-trip
// ═════════════════════════════════════════════════════════════════

describe("API Integration: profile round-trip", () => {
  it("GET /api/projects/:id/profile returns installed profile", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request(`/api/projects/${projectName}/profile`);
    expect(res.status).toBe(200);

    const body = (await json(res)) as {
      data: { stack: string; packageManager: string; commands: Record<string, unknown> };
    };
    expect(body.data.stack).toBe("node-typescript");
    expect(body.data.packageManager).toBe("pnpm");
    expect(body.data.commands.test).toBeDefined();
  });

  it("PUT /api/projects/:id/profile updates profile", async () => {
    const app = makeApp(tmpDir);

    const res = await app.request(`/api/projects/${projectName}/profile`, {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({
        stack: "node-typescript",
        packageManager: "npm",
        monorepo: false,
        commands: {
          test: "npm test",
          typecheck: "npm run typecheck",
          lint: "npm run lint",
          build: null,
          format: null,
        },
        verify: "npm test && npm run typecheck && npm run lint",
      }),
    });
    expect(res.status).toBe(200);

    // Verify the change persisted
    const readRes = await app.request(`/api/projects/${projectName}/profile`);
    const body = (await json(readRes)) as { data: { packageManager: string } };
    expect(body.data.packageManager).toBe("npm");
  });

  it("POST /api/projects/:id/profile/detect auto-detects stack", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request(`/api/projects/${projectName}/profile/detect`, {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: "{}",
    });
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: { stack: string } };
    // Project has package.json + tsconfig.json → node-typescript
    expect(body.data.stack).toBe("node-typescript");
  });
});

// ═════════════════════════════════════════════════════════════════
// Error handling across API
// ═════════════════════════════════════════════════════════════════

describe("API Integration: error handling", () => {
  it("all error responses follow standard format", async () => {
    const app = makeApp(tmpDir);

    // 404: nonexistent project
    const res404 = await app.request("/api/projects/nonexistent");
    expect(res404.status).toBe(404);
    const body404 = (await json(res404)) as { error: { code: string; message: string } };
    expect(body404.error).toBeDefined();
    expect(body404.error.code).toBeDefined();
    expect(body404.error.message).toBeDefined();

    // 403: missing CSRF header
    const res403 = await app.request(`/api/projects/${projectName}/backlog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "feature", priority: 1, title: "Test" }),
    });
    expect(res403.status).toBe(403);
    const body403 = (await json(res403)) as { error: { code: string; message: string } };
    expect(body403.error.code).toBeDefined();
    expect(body403.error.message).toBeDefined();

    // 404: nonexistent route
    const resNotFound = await app.request("/api/nonexistent");
    expect(resNotFound.status).toBe(404);
    const bodyNotFound = (await json(resNotFound)) as { error: { code: string; message: string } };
    expect(bodyNotFound.error.code).toBe("NOT_FOUND");
  });

  it("corrupt backlog.json returns structured error via API", async () => {
    const app = makeApp(tmpDir);

    // Corrupt the backlog file
    fs.writeFileSync(path.join(projectDir, ".rauf", "backlog.json"), "{ broken json }");

    const res = await app.request(`/api/projects/${projectName}/backlog`);
    expect(res.status).toBe(500);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("path traversal attempts are blocked", async () => {
    const app = makeApp(tmpDir);

    // Try path traversal in project ID
    const res = await app.request("/api/projects/a%2Fb/backlog");
    expect(res.status).toBe(400);
  });
});
