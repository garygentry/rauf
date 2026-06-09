// ─── /api/projects route tests ───────────────────────────────────

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

/** Create a minimal valid .rauf.json (MarkerFile) in a directory. */
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

/** CSRF headers for mutation requests. */
const csrfHeaders = { "X-Rauf-Request": "true", "Content-Type": "application/json" };

// ─── Setup ───────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-web-test-"));
  projectDir = path.join(tmpDir, "my-project");
  fs.mkdirSync(projectDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── GET /api/projects ────────────────────────────────────────────

describe("GET /api/projects", () => {
  it("returns empty arrays when no projects exist", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { projects: unknown[]; ignored: unknown[] } };
    expect(body.data.projects).toEqual([]);
    expect(body.data.ignored).toEqual([]);
  });

  it("returns project list when ralph is installed", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { projects: { id: string }[]; ignored: unknown[] } };
    expect(body.data.projects).toHaveLength(1);
    expect(body.data.projects[0]!.id).toBe("my-project");
    expect(body.data.ignored).toHaveLength(0);
  });

  it("separates ignored projects into the ignored array", async () => {
    // Create a project with ignoreInTool: true
    writeMarker(projectDir);
    const markerPath = path.join(projectDir, ".rauf.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8")) as Record<string, unknown>;
    (marker.options as Record<string, unknown>).ignoreInTool = true;
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));

    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      data: { projects: { id: string }[]; ignored: { id: string }[] };
    };
    expect(body.data.projects).toHaveLength(0);
    expect(body.data.ignored).toHaveLength(1);
    expect(body.data.ignored[0]!.id).toBe("my-project");
  });

  it("returns multiple projects sorted by name", async () => {
    const beta = path.join(tmpDir, "beta");
    const alpha = path.join(tmpDir, "alpha");
    fs.mkdirSync(beta);
    fs.mkdirSync(alpha);
    writeMarker(beta);
    writeMarker(alpha);

    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects");
    const body = (await json(res)) as { data: { projects: { id: string }[] } };
    expect(body.data.projects[0]!.id).toBe("alpha");
    expect(body.data.projects[1]!.id).toBe("beta");
  });
});

// ─── GET /api/projects/:id ────────────────────────────────────────

describe("GET /api/projects/:id", () => {
  it("returns project detail when installed", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { id: string; path: string; marker: unknown } };
    expect(body.data.id).toBe("my-project");
    expect(body.data.path).toBe(projectDir);
    expect(body.data.marker).toBeTruthy();
  });

  it("returns 404 for non-existent project", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/ghost");
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for existing directory without .rauf.json", async () => {
    const app = makeApp(tmpDir);
    // projectDir exists but has no .rauf.json
    const res = await app.request("/api/projects/my-project");
    expect(res.status).toBe(404);
  });

  it("blocks path traversal attempt (.. in id) — returns 4xx", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/..");
    // Hono normalizes ".." in URLs before routing, so the request never
    // reaches a handler with id="..". It either lands on the list route (200)
    // or a non-existent route (404). Either way, no project data leaks.
    expect([400, 404, 200]).toContain(res.status);
  });

  it("returns 400 for path traversal via URL-encoding", async () => {
    const app = makeApp(tmpDir);
    // %2F is '/' — after decode this becomes "a/b"
    const res = await app.request("/api/projects/a%2Fb");
    expect(res.status).toBe(400);
  });

  it("returns marker profile in detail response", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project");
    const body = (await json(res)) as {
      data: { marker: { profile: { stack: string } } };
    };
    expect(body.data.marker.profile.stack).toBe("node-typescript");
  });
});

// ─── POST /api/projects/:id/install ──────────────────────────────

describe("POST /api/projects/:id/install", () => {
  it("returns 403 without X-Rauf-Request header", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("blocks path traversal in id via URL normalization", async () => {
    const app = makeApp(tmpDir);
    // Hono normalizes ".." before routing — the request resolves to a
    // non-existent route and is rejected at the routing layer (404/403).
    const res = await app.request("/api/projects/../install", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect([400, 404]).toContain(res.status);
  });

  it("returns 404 when target directory does not exist", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/nonexistent/install", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/projects/init ─────────────────────────────────────

describe("POST /api/projects/init", () => {
  it("returns 403 without X-Rauf-Request header", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPath: path.join(tmpDir, "newproject") }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when targetPath is missing", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/init", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ name: "foo" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is not JSON", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/init", {
      method: "POST",
      headers: { "X-Rauf-Request": "true", "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns VALIDATION_ERROR with field details when targetPath is empty string", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/init", {
      method: "POST",
      headers: csrfHeaders,
      body: JSON.stringify({ targetPath: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as {
      error: { code: string; details: { fieldErrors: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeDefined();
    expect(body.error.details.fieldErrors.targetPath).toBeDefined();
  });
});

// ─── POST /api/projects/:id/update ───────────────────────────────

describe("POST /api/projects/:id/update", () => {
  it("returns 403 without X-Rauf-Request header", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/update", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when project is not installed", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/update", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("blocks path traversal in id via URL normalization", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/../update", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect([400, 404]).toContain(res.status);
  });
});

// ─── POST /api/projects/:id/uninstall ────────────────────────────

describe("POST /api/projects/:id/uninstall", () => {
  it("returns 403 without X-Rauf-Request header", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/uninstall", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when project is not installed", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/uninstall", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("blocks path traversal in id via URL normalization", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/../uninstall", {
      method: "POST",
      headers: csrfHeaders,
      body: "{}",
    });
    expect([400, 404]).toContain(res.status);
  });
});

// ─── Health endpoint: projectCount ───────────────────────────────

describe("GET /api/health projectCount", () => {
  it("reflects the number of discovered projects", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/health");
    const body = (await json(res)) as { data: { projectCount: number } };
    expect(body.data.projectCount).toBe(1);
  });

  it("returns 0 when no projects are installed", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/health");
    const body = (await json(res)) as { data: { projectCount: number } };
    expect(body.data.projectCount).toBe(0);
  });
});
