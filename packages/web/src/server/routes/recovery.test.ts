// ─── Recovery API Route Tests ─────────────────────────────────────
//
// Tests for: POST /:id/reset, POST /:id/backlog/unblock,
//            GET /:id/backlog/validate
//
// Uses real temp directories with mock claude scripts, mirroring the
// loop.test.ts harness (HOME isolation, lock seeding, mock claude).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The active-loop registry lives at ~/.rauf/active/. Redirect HOME to an
// isolated temp dir BEFORE @rauf/core is imported (os.homedir() reads $HOME on
// POSIX; ACTIVE_DIR is bound at core module load) so listActiveLoops() never
// touches the real ~/.rauf. Mirrors loop.test.ts.
const { TMP_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const nodeFs = require("node:fs") as typeof import("node:fs");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "rauf-web-recovery-home-"));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir; // Windows parity (harmless on POSIX)
  return { TMP_HOME: dir };
});

import { LOCK_FILENAME } from "@rauf/core";

import { createApp } from "../app.js";
import { getLoopManager, resetLoopManager } from "../loop-manager.js";

const ACTIVE_DIR = path.join(TMP_HOME, ".rauf", "active");

/** Local mirror of the resume route's success DTO (00 §6). */
interface ResumeResult {
  reconciled: { treeClean: boolean; interrupted: unknown[] };
  relaunched: boolean;
  reason?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

let tmpDir: string;
let originalPath: string;

const csrf = { "X-Rauf-Request": "true", "Content-Type": "application/json" };

function makeApp(rootDirectory: string) {
  return createApp(Date.now(), { rootDirectory });
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

/** Init a clean git repo so recoverInterruptedLoop's `git status` succeeds
 *  (resume reconciles committed work via git). */
function initGitRepo(dir: string): void {
  const opts = { cwd: dir, stdio: "ignore" as const };
  execFileSync("git", ["init"], opts);
  execFileSync("git", ["config", "user.email", "test@example.com"], opts);
  execFileSync("git", ["config", "user.name", "Test"], opts);
  execFileSync("git", ["add", "-A"], opts);
  execFileSync("git", ["commit", "-m", "init"], opts);
}

/** A mock claude that blocks (sleep) so a relaunched loop stays live. */
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

/** Seed a LIVE .loop.lock in a project's default .rauf root so checkLock /
 *  acquireRecoveryLock report a live loop (mirrors loop-manager.test.ts). */
function seedLiveLock(name: string): void {
  const raufDir = path.join(tmpDir, name, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(
    path.join(raufDir, LOCK_FILENAME),
    JSON.stringify({
      pid: process.pid, // our process is alive → locked && !stale
      startedAt: new Date().toISOString(),
      processStartTime: null, // null → recycle check skipped → reads as live
    }),
  );
}

/** Seed a state.json with the given raw status. */
function seedState(name: string, status: string): void {
  const raufDir = path.join(tmpDir, name, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(
    path.join(raufDir, "state.json"),
    JSON.stringify({
      status,
      iteration: 1,
      maxIterations: 10,
      currentItem: null,
      lastSignal: "clean",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedItems: [],
      blockedItems: [],
      deferredItems: [],
      error: null,
      baseCommitHash: null,
    }),
  );
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

const blockedItem = {
  ...pendingItem,
  status: "blocked",
  blockedReason: "manual",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-web-recovery-route-test-"));
  originalPath = process.env["PATH"] ?? "";
  resetLoopManager();
});

afterEach(async () => {
  await getLoopManager().shutdownAll();
  process.env["PATH"] = originalPath;
  resetLoopManager();
  fs.rmSync(ACTIVE_DIR, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── POST /:id/reset ─────────────────────────────────────────────

describe("POST /:id/reset", () => {
  it("resets a project and returns 200 with ResetProjectResult", async () => {
    createProject("p", [pendingItem]);
    seedState("p", "paused"); // something to clear
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ clearBacklog: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { stateCleared: boolean } };
    expect(body.data).toHaveProperty("stateCleared");
  });

  it("returns 403 without X-Rauf-Request (app-level CSRF)", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 409 LOCK_CONFLICT when a loop is live (acquire-and-hold guard)", async () => {
    createProject("p", [pendingItem]);
    seedLiveLock("p"); // live lock our PID holds → acquireRecoveryLock fails
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", { method: "POST", headers: csrf });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("LOCK_CONFLICT");
  });

  it("returns 404 when the project/backlog is missing", async () => {
    const app = makeApp(tmpDir); // no createProject → no .rauf.json / backlog
    const res = await app.request("/api/projects/ghost/reset", { method: "POST", headers: csrf });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed body (schema reject)", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ clearBacklog: "yes-please" }), // boolean expected → .strict reject
    });
    expect(res.status).toBe(400);
  });
});

// ─── POST /:id/backlog/unblock ───────────────────────────────────

describe("POST /:id/backlog/unblock", () => {
  it("unblocks all blocked items and returns counts", async () => {
    createProject("p", [blockedItem, { ...blockedItem, id: "002" }]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { unblockedCount: number; unblockedIds: string[] };
    };
    expect(body.data.unblockedCount).toBe(2);
    expect(body.data.unblockedIds).toContain("001");
  });

  it("unblocks a single item by id", async () => {
    createProject("p", [blockedItem, { ...blockedItem, id: "002" }]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ itemId: "001" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { unblockedCount: number } };
    expect(body.data.unblockedCount).toBe(1);
  });

  it("returns 403 without X-Rauf-Request", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when a loop is live (assertNoLiveLoop / checkLock)", async () => {
    createProject("p", [blockedItem]);
    seedLiveLock("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", {
      method: "POST",
      headers: csrf,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("LOCK_CONFLICT");
  });

  it("returns 404 when the backlog is missing", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/ghost/backlog/unblock", {
      method: "POST",
      headers: csrf,
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed body", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ itemId: 123 }), // string expected
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id/backlog/validate ───────────────────────────────────

describe("GET /:id/backlog/validate", () => {
  it("returns 200 with { valid, findings } for a clean backlog", async () => {
    createProject("p", [pendingItem]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { valid: boolean; findings: unknown[] } };
    expect(body.data.valid).toBe(true);
    expect(Array.isArray(body.data.findings)).toBe(true);
  });

  it("surfaces findings (machine-readable) for an invalid backlog", async () => {
    // Two items with the same id → DUPLICATE_ID finding.
    createProject("p", [pendingItem, { ...pendingItem }]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { valid: boolean; findings: { code: string }[] };
    };
    expect(body.data.valid).toBe(false);
    expect(body.data.findings.some((f) => f.code === "DUPLICATE_ID")).toBe(true);
  });

  it("is safe during a live run (read-only — NOT 409)", async () => {
    createProject("p", [pendingItem]);
    seedLiveLock("p"); // a live loop must NOT block a read-only validate
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("does NOT require X-Rauf-Request (GET is not CSRF-gated)", async () => {
    createProject("p", [pendingItem]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).not.toBe(403);
  });

  it("returns 404 when the backlog is missing", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/ghost/backlog/validate", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a sandbox-escaping ?backlogRoot", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request(
      "/api/projects/p/backlog/validate?backlogRoot=" + encodeURIComponent("../../escape"),
      { method: "GET" },
    );
    expect(res.status).toBe(400);
  });
});

// ─── POST /:id/resume ────────────────────────────────────────────

describe("POST /:id/resume", () => {
  it("returns 200 relaunched:false when nothing is eligible (no items)", async () => {
    createProject("p", []); // empty backlog → selectNextItem === null
    initGitRepo(path.join(tmpDir, "p"));
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: ResumeResult };
    expect(body.data.relaunched).toBe(false);
    expect(body.data.reason).toBe("no eligible items");
    expect(body.data.reconciled).toHaveProperty("treeClean");
  });

  it("returns 200 relaunched:true with a pending item (relaunches the loop)", async () => {
    createProject("p", [pendingItem]);
    initGitRepo(path.join(tmpDir, "p"));
    setupLongRunningClaude();
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: ResumeResult };
    expect(body.data.relaunched).toBe(true);
  });

  it("injects answers ({itemId,text}) → humanAnswer, unblocking to pending", async () => {
    createProject("p", [blockedItem]); // id "001", status blocked
    initGitRepo(path.join(tmpDir, "p"));
    setupLongRunningClaude();
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ answers: [{ itemId: "001", text: "do it this way" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: ResumeResult };
    expect(body.data.relaunched).toBe(true);

    await getLoopManager().shutdownAll();
    const backlog = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "p", ".rauf", "backlog.json"), "utf8"),
    ) as { items: { id: string; humanAnswer?: string; needsHuman?: boolean }[] };
    const item = backlog.items.find((i) => i.id === "001");
    expect(item?.humanAnswer).toBe("do it this way");
    expect(item?.needsHuman).toBe(false);
  });

  it("returns 403 without X-Rauf-Request", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when a loop is live (acquire-and-hold guard)", async () => {
    createProject("p", [pendingItem]);
    seedLiveLock("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", { method: "POST", headers: csrf });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("LOCK_CONFLICT");
  });

  it("returns 404 when the project/backlog is missing", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/ghost/resume", { method: "POST", headers: csrf });
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed answers (missing text)", async () => {
    createProject("p", [pendingItem]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ answers: [{ itemId: "001" }] }), // text missing → .strict reject
    });
    expect(res.status).toBe(400);
  });

  it("leaves no orphaned recovery lock — a second resume is not 409'd", async () => {
    createProject("p", [pendingItem]);
    initGitRepo(path.join(tmpDir, "p"));
    setupLongRunningClaude();
    const app = makeApp(tmpDir);

    const res1 = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({}),
    });
    expect(res1.status).toBe(200);
    expect(((await res1.json()) as { data: ResumeResult }).data.relaunched).toBe(true);

    // Stop the relaunched loop so its own lock is released.
    await getLoopManager().shutdownAll();

    // A second resume must acquire the recovery lock cleanly (no orphaned lock
    // from the first resume's acquire-and-hold).
    const res2 = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(200); // not 409
  });
});

// ─── Route-mounting smoke ────────────────────────────────────────

describe("recovery route mounting", () => {
  it("reset/resume/unblock are mounted (403 CSRF, not 404)", async () => {
    const app = makeApp(tmpDir);
    for (const p of ["reset", "resume", "backlog/unblock"]) {
      const res = await app.request(`/api/projects/test/${p}`, { method: "POST" });
      expect(res.status).toBe(403); // reached the CSRF middleware → route exists
    }
  });
});
