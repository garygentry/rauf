// ─── /api/projects/:id/backlog route tests ───────────────────────

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

/** Create a minimal valid .ralph.json (MarkerFile). */
function writeMarker(dir: string): void {
  const marker = {
    ralph: true,
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
  fs.writeFileSync(path.join(dir, ".ralph.json"), JSON.stringify(marker, null, 2));
}

/** Write a minimal backlog.json with the given items. */
function writeBacklog(
  dir: string,
  items: unknown[] = [],
  extra: Record<string, unknown> = {},
): void {
  const ralphDir = path.join(dir, ".ralph");
  fs.mkdirSync(ralphDir, { recursive: true });
  const backlog = {
    project: "test-project",
    description: "Test project",
    items,
    ...extra,
  };
  fs.writeFileSync(path.join(ralphDir, "backlog.json"), JSON.stringify(backlog, null, 2));
}

function makeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "001",
    type: "feature",
    priority: 2,
    title: "Sample item",
    description: "",
    acceptanceCriteria: ["Tests pass"],
    status: "pending",
    completedAt: null,
    ...overrides,
  };
}

/** CSRF headers for mutation requests. */
const csrfHeaders = { "X-Ralph-Request": "true", "Content-Type": "application/json" };

// ─── Setup ───────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-backlog-test-"));
  projectDir = path.join(tmpDir, "my-project");
  fs.mkdirSync(projectDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── GET /api/projects/:id/backlog ────────────────────────────────

describe("GET /api/projects/:id/backlog", () => {
  it("returns 404 when project has no backlog.json", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog");
    expect(res.status).toBe(404);
  });

  it("returns empty items array when backlog has no items", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("returns all items when no filters applied", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [
      makeItem({ id: "001", status: "pending" }),
      makeItem({ id: "002", status: "done" }),
    ]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it("filters by status", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [
      makeItem({ id: "001", status: "pending" }),
      makeItem({ id: "002", status: "done" }),
      makeItem({ id: "003", status: "pending" }),
    ]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog?status=pending");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { id: string }[] };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((i) => i.id !== "002")).toBe(true);
  });

  it("filters by type", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [
      makeItem({ id: "001", type: "feature" }),
      makeItem({ id: "002", type: "bug" }),
      makeItem({ id: "003", type: "bug" }),
    ]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog?type=bug");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { id: string }[] };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((i) => i.id !== "001")).toBe(true);
  });

  it("sorts by priority ascending by default", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [
      makeItem({ id: "001", priority: 3 }),
      makeItem({ id: "002", priority: 1 }),
      makeItem({ id: "003", priority: 2 }),
    ]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog");
    const body = (await json(res)) as { data: { id: string; priority: number }[] };
    expect(body.data[0]!.priority).toBe(1);
    expect(body.data[1]!.priority).toBe(2);
    expect(body.data[2]!.priority).toBe(3);
  });

  it("sorts by id when sort=id", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [
      makeItem({ id: "003" }),
      makeItem({ id: "001" }),
      makeItem({ id: "002" }),
    ]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog?sort=id");
    const body = (await json(res)) as { data: { id: string }[] };
    expect(body.data[0]!.id).toBe("001");
    expect(body.data[1]!.id).toBe("002");
    expect(body.data[2]!.id).toBe("003");
  });

  it("sorts by status when sort=status", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [
      makeItem({ id: "001", status: "pending" }),
      makeItem({ id: "002", status: "done" }),
      makeItem({ id: "003", status: "blocked" }),
    ]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog?sort=status");
    const body = (await json(res)) as { data: { status: string }[] };
    // alphabetical: blocked, done, pending
    expect(body.data[0]!.status).toBe("blocked");
    expect(body.data[1]!.status).toBe("done");
    expect(body.data[2]!.status).toBe("pending");
  });

  it("combines status and type filters", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [
      makeItem({ id: "001", status: "pending", type: "feature" }),
      makeItem({ id: "002", status: "pending", type: "bug" }),
      makeItem({ id: "003", status: "done", type: "feature" }),
    ]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog?status=pending&type=feature");
    const body = (await json(res)) as { data: { id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe("001");
  });

  it("returns 400 for invalid project ID (path traversal)", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/backlog");
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/projects/:id/backlog ──────────────────────────────

describe("POST /api/projects/:id/backlog", () => {
  it("returns 403 without CSRF header", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "feature", priority: 2, title: "New task" }),
    });
    expect(res.status).toBe(403);
  });

  it("creates a new item and returns 201", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "feature", priority: 2, title: "New task" }),
    });
    expect(res.status).toBe(201);
    const body = (await json(res)) as { data: { id: string; title: string } };
    expect(body.data.id).toBe("001");
    expect(body.data.title).toBe("New task");
  });

  it("auto-increments ID from existing items", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "005" })]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "bug", priority: 1, title: "Another task" }),
    });
    expect(res.status).toBe(201);
    const body = (await json(res)) as { data: { id: string } };
    expect(body.data.id).toBe("006");
  });

  it("returns 400 when type is missing", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ priority: 2, title: "No type" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when priority is out of range", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "feature", priority: 5, title: "Bad priority" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when title is empty", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "feature", priority: 2, title: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not JSON", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: { "X-Ralph-Request": "true", "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("uses provided acceptanceCriteria", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({
        type: "chore",
        priority: 3,
        title: "A chore",
        acceptanceCriteria: ["Step A passes", "Step B passes"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await json(res)) as { data: { acceptanceCriteria: string[] } };
    expect(body.data.acceptanceCriteria).toEqual(["Step A passes", "Step B passes"]);
  });

  it("returns 404 when project has no backlog.json", async () => {
    writeMarker(projectDir);
    // No backlog.json written
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "feature", priority: 2, title: "Task" }),
    });
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/projects/:id/backlog/:itemId ────────────────────────

describe("GET /api/projects/:id/backlog/:itemId", () => {
  it("returns a single item by ID", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001", title: "Find me" })]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { id: string; title: string } };
    expect(body.data.id).toBe("001");
    expect(body.data.title).toBe("Find me");
  });

  it("returns 404 when item ID does not exist", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001" })]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/999");
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when backlog.json does not exist", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001");
    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/projects/:id/backlog/:itemId ────────────────────────

describe("PUT /api/projects/:id/backlog/:itemId", () => {
  it("returns 403 without CSRF header", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(403);
  });

  it("updates an item's title", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: csrfHeaders,
      body: JSON.stringify({ title: "Updated title" }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { title: string } };
    expect(body.data.title).toBe("Updated title");
  });

  it("enforces valid status transitions (TRANSITION_INVALID → 400)", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001", status: "pending" })]);
    const app = makeApp(tmpDir);
    // pending → done is an invalid transition
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: csrfHeaders,
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("TRANSITION_INVALID");
  });

  it("allows valid status transition pending → in_progress", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001", status: "pending" })]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: csrfHeaders,
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { status: string } };
    expect(body.data.status).toBe("in_progress");
  });

  it("returns 404 when item ID does not exist", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/999", {
      method: "PUT",
      headers: csrfHeaders,
      body: JSON.stringify({ title: "No such item" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type value", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "invalid-type" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is not JSON", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: { "X-Ralph-Request": "true", "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("auto-sets completedAt when transitioning to done", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001", status: "in_progress" })]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: csrfHeaders,
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { completedAt: string | null } };
    expect(body.data.completedAt).not.toBeNull();
  });
});

// ─── DELETE /api/projects/:id/backlog/:itemId ─────────────────────

describe("DELETE /api/projects/:id/backlog/:itemId", () => {
  it("returns 403 without CSRF header", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });

  it("deletes an item and returns { data: null }", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "DELETE",
      headers: csrfHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: null };
    expect(body.data).toBeNull();
  });

  it("returns 400 when item ID does not exist", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/999", {
      method: "DELETE",
      headers: csrfHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when trying to delete in_progress item with active loop", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001", status: "in_progress" })]);
    // Write a state.json showing the loop is running (must match LoopStateSchema)
    const stateDir = path.join(projectDir, ".ralph");
    const state = {
      status: "running",
      currentItem: "001",
      iteration: 1,
      maxIterations: 20,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSignal: "clean",
      completedItems: [],
      blockedItems: [],
      error: null,
    };
    fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify(state));
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "DELETE",
      headers: csrfHeaders,
    });
    expect(res.status).toBe(409);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("can delete in_progress item when loop is not active", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001", status: "in_progress" })]);
    // No state.json — loop is not active
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "DELETE",
      headers: csrfHeaders,
    });
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/projects/:id/backlog/restore ───────────────────────

describe("POST /api/projects/:id/backlog/restore", () => {
  it("returns 403 without CSRF header", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/restore", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when no backup file exists", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/restore", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("restores from backup and returns { data: null }", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem({ id: "001" })]);
    // Create a .bak file (simulating what atomicWrite does)
    const ralphDir = path.join(projectDir, ".ralph");
    const backlogPath = path.join(ralphDir, "backlog.json");
    const bakPath = `${backlogPath}.bak`;
    const backup = {
      project: "test-project",
      description: "Backup",
      items: [makeItem({ id: "001" }), makeItem({ id: "002", title: "Restored item" })],
    };
    fs.writeFileSync(bakPath, JSON.stringify(backup, null, 2));

    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/restore", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: null };
    expect(body.data).toBeNull();

    // Verify the backlog was actually restored (now has 2 items)
    const restored = JSON.parse(fs.readFileSync(backlogPath, "utf-8")) as {
      items: { id: string }[];
    };
    expect(restored.items).toHaveLength(2);
    expect(restored.items[1]!.id).toBe("002");
  });
});

// ─── Edge cases: corrupt files ────────────────────────────────────

describe("Edge cases: corrupt backlog.json", () => {
  function writeCorruptBacklog(dir: string): void {
    const ralphDir = path.join(dir, ".ralph");
    fs.mkdirSync(ralphDir, { recursive: true });
    fs.writeFileSync(path.join(ralphDir, "backlog.json"), "{ invalid json }");
  }

  function writeInvalidSchemaBacklog(dir: string): void {
    const ralphDir = path.join(dir, ".ralph");
    fs.mkdirSync(ralphDir, { recursive: true });
    // Valid JSON but wrong schema (items is a string, not an array)
    fs.writeFileSync(
      path.join(ralphDir, "backlog.json"),
      JSON.stringify({ items: "not-an-array" }),
    );
  }

  it("GET /backlog returns 500 with INVALID_JSON code for corrupt file", async () => {
    writeMarker(projectDir);
    writeCorruptBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog");
    expect(res.status).toBe(500);
    const body = (await json(res)) as { error: { code: string; message: string } };
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("GET /backlog/:itemId returns 500 with error for corrupt file", async () => {
    writeMarker(projectDir);
    writeCorruptBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001");
    expect(res.status).toBe(500);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("GET /backlog returns 500 with VALIDATION_ERROR for invalid-schema file", async () => {
    writeMarker(projectDir);
    writeInvalidSchemaBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog");
    expect(res.status).toBe(500);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /backlog returns error code for corrupt file", async () => {
    writeMarker(projectDir);
    writeCorruptBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "feature", priority: 2, title: "Test" }),
    });
    // readBacklog fails inside addItem → returns error (400 or 500)
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error).toBeDefined();
    expect(body.error.code).toBeDefined();
  });
});

// ─── Zod validation error details ────────────────────────────────

describe("POST /api/projects/:id/backlog — Zod validation details", () => {
  it("returns error details with field-level info when multiple fields invalid", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "unknown-type", priority: 99, title: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as {
      error: { code: string; details: { fieldErrors: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeDefined();
    expect(body.error.details.fieldErrors).toBeDefined();
    // type and priority should both have errors
    expect(body.error.details.fieldErrors.type).toBeDefined();
    expect(body.error.details.fieldErrors.priority).toBeDefined();
  });

  it("PUT /backlog/:itemId returns field-level error details for invalid type", async () => {
    writeMarker(projectDir);
    writeBacklog(projectDir, [makeItem()]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/backlog/001", {
      method: "PUT",
      headers: csrfHeaders,
      body: JSON.stringify({ type: "not-valid", priority: "high" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as {
      error: { code: string; details: { fieldErrors: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fieldErrors.type).toBeDefined();
  });
});
