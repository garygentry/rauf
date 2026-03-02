// ─── Profile and Config API Route Tests ──────────────────────────
//
// Tests for:
//   GET  /api/projects/:id/profile
//   PUT  /api/projects/:id/profile
//   POST /api/projects/:id/profile/detect
//   GET  /api/config
//   PUT  /api/config

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

/** A minimal valid .ralph.json (MarkerFile). */
const MARKER_TEMPLATE = {
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

/** Write a valid .ralph.json to the given project directory. */
function writeMarker(dir: string, profileOverride?: Record<string, unknown>): void {
  const marker = {
    ...MARKER_TEMPLATE,
    ...(profileOverride ? { profile: { ...MARKER_TEMPLATE.profile, ...profileOverride } } : {}),
  };
  fs.writeFileSync(path.join(dir, ".ralph.json"), JSON.stringify(marker, null, 2));
}

/** Standard request headers for mutation endpoints. */
const MUTATION_HEADERS = {
  "Content-Type": "application/json",
  "X-Ralph-Request": "true",
};

// ─── Setup ───────────────────────────────────────────────────────

let tmpDir: string;
let projectDir: string;

// Save and restore ~/.ralph/config.json to avoid side effects
let savedConfig: string | null = null;
const CONFIG_PATH = path.join(os.homedir(), ".ralph", "config.json");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-profile-config-test-"));
  projectDir = path.join(tmpDir, "my-project");
  fs.mkdirSync(projectDir);

  // Back up existing config
  try {
    savedConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    savedConfig = null;
  }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Restore config
  if (savedConfig !== null) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, savedConfig);
  } else {
    try {
      fs.unlinkSync(CONFIG_PATH);
    } catch {
      // Ignore — config may not exist
    }
  }
});

// ─── GET /api/projects/:id/profile ───────────────────────────────

describe("GET /api/projects/:id/profile", () => {
  it("returns the profile from .ralph.json", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/profile");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
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
    });
  });

  it("returns 404 when .ralph.json is missing", async () => {
    // No marker file — project not ralph-installed
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/profile");
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("FILE_NOT_FOUND");
  });

  it("returns 400 for invalid project ID (path traversal)", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/profile");
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ID");
  });

  it("returns profile with custom stack", async () => {
    writeMarker(projectDir, { stack: "python", packageManager: null });
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/profile");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { stack: string; packageManager: null } };
    expect(body.data.stack).toBe("python");
    expect(body.data.packageManager).toBeNull();
  });
});

// ─── PUT /api/projects/:id/profile ───────────────────────────────

describe("PUT /api/projects/:id/profile", () => {
  it("updates the profile in .ralph.json", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);

    const newProfile = {
      stack: "python",
      packageManager: null,
      monorepo: false,
      commands: {
        test: "pytest",
        typecheck: "mypy .",
        lint: "ruff check .",
        build: null,
        format: "ruff format --check .",
      },
      verify: "pytest && mypy . && ruff check . && ruff format --check .",
    };

    const res = await app.request("/api/projects/my-project/profile", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify(newProfile),
    });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject(newProfile);
  });

  it("persists the updated profile (GET returns updated value)", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);

    const newProfile = {
      stack: "go",
      packageManager: null,
      monorepo: false,
      commands: {
        test: "go test ./...",
        typecheck: "go vet ./...",
        lint: null,
        build: "go build ./...",
        format: null,
      },
      verify: "go test ./... && go vet ./... && go build ./...",
    };

    await app.request("/api/projects/my-project/profile", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify(newProfile),
    });

    // GET should now return the updated profile
    const res = await app.request("/api/projects/my-project/profile");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { stack: string } };
    expect(body.data.stack).toBe("go");
  });

  it("returns 404 when .ralph.json is missing", async () => {
    const app = makeApp(tmpDir);
    const newProfile = {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: { test: "pnpm test", typecheck: null, lint: null, build: null, format: null },
      verify: "pnpm test",
    };

    const res = await app.request("/api/projects/my-project/profile", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify(newProfile),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid profile body (missing required field)", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/my-project/profile", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ stack: "python" }), // missing commands, monorepo, etc.
    });

    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 without CSRF header", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);

    const res = await app.request("/api/projects/my-project/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/profile", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ID");
  });

  it("preserves other marker file fields when updating profile", async () => {
    writeMarker(projectDir);
    const app = makeApp(tmpDir);

    const newProfile = {
      stack: "rust",
      packageManager: null,
      monorepo: false,
      commands: {
        test: "cargo test",
        typecheck: "cargo check",
        lint: "cargo clippy",
        build: "cargo build",
        format: null,
      },
      verify: "cargo test && cargo check && cargo clippy && cargo build",
    };

    await app.request("/api/projects/my-project/profile", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify(newProfile),
    });

    // Read the raw marker file to verify other fields are preserved
    const raw = JSON.parse(fs.readFileSync(path.join(projectDir, ".ralph.json"), "utf-8")) as {
      ralph: boolean;
      options: { maxIterations: number };
    };
    expect(raw.ralph).toBe(true);
    expect(raw.options.maxIterations).toBe(20);
  });
});

// ─── POST /api/projects/:id/profile/detect ───────────────────────

describe("POST /api/projects/:id/profile/detect", () => {
  it("returns detected profile for a Node.js TypeScript project", async () => {
    // Set up a minimal Node.js TS project in projectDir
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );
    fs.writeFileSync(path.join(projectDir, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(projectDir, "pnpm-lock.yaml"), "");

    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/profile/detect", {
      method: "POST",
      headers: MUTATION_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { stack: string; packageManager: string } };
    expect(body.data.stack).toBe("node-typescript");
    expect(body.data.packageManager).toBe("pnpm");
  });

  it("returns 'unknown' stack when no indicator files are found", async () => {
    // Empty project directory — no indicator files
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/profile/detect", {
      method: "POST",
      headers: MUTATION_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { stack: string } };
    expect(body.data.stack).toBe("unknown");
  });

  it("does NOT save the detected profile (GET still returns original)", async () => {
    writeMarker(projectDir);
    // Set up a Go project in projectDir
    fs.writeFileSync(path.join(projectDir, "go.mod"), "module example.com/my-project");

    const app = makeApp(tmpDir);
    await app.request("/api/projects/my-project/profile/detect", {
      method: "POST",
      headers: MUTATION_HEADERS,
    });

    // GET should still return the original profile from .ralph.json
    const res = await app.request("/api/projects/my-project/profile");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { stack: string } };
    // Original was node-typescript, not go
    expect(body.data.stack).toBe("node-typescript");
  });

  it("returns 403 without CSRF header", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/my-project/profile/detect", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid project ID", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/profile/detect", {
      method: "POST",
      headers: MUTATION_HEADERS,
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ID");
  });
});

// ─── GET /api/config ─────────────────────────────────────────────

describe("GET /api/config", () => {
  it("returns default config when no config file exists", async () => {
    // Ensure config file is deleted (afterEach will restore)
    try {
      fs.unlinkSync(CONFIG_PATH);
    } catch {
      // Ignore if not present
    }

    const app = makeApp(tmpDir);
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      port: expect.any(Number),
      theme: expect.stringMatching(/^(light|dark|system)$/),
      rootDirectory: expect.any(String),
    });
  });

  it("returns saved config when config file exists", async () => {
    const config = {
      rootDirectory: "/tmp/my-projects",
      port: 3000,
      theme: "dark",
    };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    const app = makeApp(tmpDir);
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: typeof config };
    expect(body.data).toMatchObject(config);
  });

  it("returns config with all required fields", async () => {
    // Ensure config file is removed so readToolConfig returns clean defaults
    try {
      fs.unlinkSync(CONFIG_PATH);
    } catch {
      // May not exist — that's fine
    }

    const app = makeApp(tmpDir);
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty("rootDirectory");
    expect(body.data).toHaveProperty("port");
    expect(body.data).toHaveProperty("theme");
  });
});

// ─── PUT /api/config ─────────────────────────────────────────────

describe("PUT /api/config", () => {
  it("saves and returns the updated config", async () => {
    const app = makeApp(tmpDir);

    const newConfig = {
      rootDirectory: "/tmp/my-projects",
      port: 4000,
      theme: "light",
    };

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify(newConfig),
    });

    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: typeof newConfig };
    expect(body.data).toMatchObject(newConfig);
  });

  it("persists the config (GET returns updated value)", async () => {
    const app = makeApp(tmpDir);

    const newConfig = {
      rootDirectory: "/tmp/my-projects",
      port: 4000,
      theme: "dark",
    };

    await app.request("/api/config", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify(newConfig),
    });

    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { theme: string; port: number } };
    expect(body.data.theme).toBe("dark");
    expect(body.data.port).toBe(4000);
  });

  it("returns 400 for invalid theme value", async () => {
    const app = makeApp(tmpDir);

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ rootDirectory: "/tmp", port: 5173, theme: "rainbow" }),
    });

    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid port (negative number)", async () => {
    const app = makeApp(tmpDir);

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ rootDirectory: "/tmp", port: -1, theme: "system" }),
    });

    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing request body", async () => {
    const app = makeApp(tmpDir);

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "X-Ralph-Request": "true" }, // no Content-Type
    });

    expect(res.status).toBe(400);
  });

  it("returns 403 without CSRF header", async () => {
    const app = makeApp(tmpDir);

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootDirectory: "/tmp", port: 5173, theme: "system" }),
    });

    expect(res.status).toBe(403);
  });
});
