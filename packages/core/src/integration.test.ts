// ─── Integration Tests ────────────────────────────────────────────
//
// End-to-end integration tests that exercise cross-module workflows:
//   1. Install into fresh directory
//   2. Greenfield init creates valid project
//   3. Backlog add/list/edit/delete cycle
//   4. Status derivation with mock state.json
//
// These tests compose multiple core functions and verify the complete
// chain works, including filesystem side effects.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

import { install, preflight, update, uninstall } from "./installer.js";
import { initProject } from "./greenfield.js";
import { readBacklog, addItem, updateItem, deleteItem, restoreFromBackup } from "./backlog.js";
import { deriveStatus, readLogTail } from "./status.js";
import { readMarkerFile, MARKER_FILENAME } from "./config.js";
import { fileExists } from "./fs-utils.js";
import { CLAUDE_MD_SENTINEL_START, CLAUDE_MD_SENTINEL_END } from "./claude-md.js";
import { STATE_FILENAME, DEFAULT_ROOT_DIR, defaultBacklogPaths } from "./backlog-root.js";
import type { LoopState } from "./schemas.js";

// ─── Shared Fixtures ─────────────────────────────────────────────

const ARTIFACTS_DIR = path.resolve(__dirname, "../../../artifacts/variants/backlog-json");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-integration-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a minimal fake project directory with common files. */
function createProject(
  dir: string,
  opts: {
    git?: boolean;
    packageJson?: boolean | Record<string, unknown>;
    tsconfig?: boolean;
    pnpmLock?: boolean;
  } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });

  if (opts.git) {
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  }
  if (opts.packageJson) {
    const content =
      typeof opts.packageJson === "object"
        ? opts.packageJson
        : {
            name: "test-project",
            scripts: { test: "vitest", typecheck: "tsc --noEmit", lint: "eslint ." },
          };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(content, null, 2));
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

/** Write a state.json into a project's .rauf/ directory. */
function writeStateJson(projectPath: string, state: LoopState): void {
  const raufDir = path.join(projectPath, DEFAULT_ROOT_DIR);
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(path.join(raufDir, STATE_FILENAME), JSON.stringify(state, null, 2));
}

/** Write a rauf.log file into a project's .rauf/ directory. */
function writeLog(projectPath: string, content: string, mtimeOverride?: Date): void {
  const raufDir = path.join(projectPath, DEFAULT_ROOT_DIR);
  fs.mkdirSync(raufDir, { recursive: true });
  const filePath = path.join(raufDir, "rauf.log");
  fs.writeFileSync(filePath, content);
  if (mtimeOverride) {
    fs.utimesSync(filePath, mtimeOverride, mtimeOverride);
  }
}

/** Write a DONE file into a project's .rauf/ directory. */
function writeDoneFile(projectPath: string, content: string = ""): void {
  const raufDir = path.join(projectPath, DEFAULT_ROOT_DIR);
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(path.join(raufDir, "DONE"), content);
}

/** Create a valid LoopState object for testing. */
function makeLoopState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    status: "running",
    iteration: 2,
    maxIterations: 10,
    currentItem: "001",
    lastSignal: "clean",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedItems: [],
    blockedItems: [],
    deferredItems: [],
    error: null,
    baseCommitHash: null,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════
// 1. Install into fresh directory
// ═════════════════════════════════════════════════════════════════

describe("Integration: install into fresh directory", () => {
  it("full install: preflight → install → verify all artifacts", () => {
    const projectDir = path.join(tmpDir, "fresh-project");
    createProject(projectDir, {
      git: true,
      packageJson: true,
      tsconfig: true,
      pnpmLock: true,
    });

    // Step 1: Preflight should pass
    const pf = preflight(projectDir);
    expect(pf.passed).toBe(true);
    expect(pf.checks.every((c) => c.severity !== "error" || c.passed)).toBe(true);

    // Step 2: Install (defaults to runtime: 'global')
    const result = install(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      projectName: "integration-test",
      projectDescription: "An integration test project",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report = result.value;

    // Step 3: Verify all expected files exist
    // No scripts at project root
    expect(fileExists(path.join(projectDir, "ralph.sh"))).toBe(false);
    expect(fileExists(path.join(projectDir, "ralph-add.sh"))).toBe(false);
    expect(fileExists(path.join(projectDir, "ralph-status.sh"))).toBe(false);

    // .rauf/ directory with data files
    expect(fileExists(path.join(projectDir, ".rauf", "RAUF.md"))).toBe(true);
    expect(fileExists(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
    expect(fileExists(path.join(projectDir, ".rauf", "progress.md"))).toBe(true);

    // CLAUDE.md with sentinel blocks
    const claudeMd = fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_END);
    expect(claudeMd).toContain("Autonomous Loop (Rauf)");

    // .rauf.json marker file
    const markerResult = readMarkerFile(projectDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    expect(markerResult.value.rauf).toBe(true);
    expect(markerResult.value.profile.stack).toBe("node-typescript");
    expect(markerResult.value.profile.packageManager).toBe("pnpm");
    // Only RAUF.md hash (no script hashes)
    expect(Object.keys(markerResult.value.artifactHashes).length).toBeGreaterThanOrEqual(1);

    // RAUF.md contains rendered commands (not raw template vars)
    const raufMd = fs.readFileSync(path.join(projectDir, ".rauf", "RAUF.md"), "utf-8");
    expect(raufMd).not.toContain("{{");
    expect(raufMd).toContain("pnpm test");

    // Backlog is valid and empty
    const backlogResult = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlogResult.ok).toBe(true);
    if (!backlogResult.ok) return;
    expect(backlogResult.value.project).toBe("integration-test");
    expect(backlogResult.value.description).toBe("An integration test project");
    expect(backlogResult.value.items).toEqual([]);

    // Installation report is complete
    expect(report.projectName).toBe("integration-test");
    expect(report.projectPath).toBe(path.resolve(projectDir));
    expect(report.actions.length).toBeGreaterThan(0);
  });

  it("install → update → uninstall lifecycle", () => {
    const projectDir = path.join(tmpDir, "lifecycle-project");
    createProject(projectDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    const installResult = install(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      projectName: "lifecycle",
    });
    expect(installResult.ok).toBe(true);

    // Verify installed — no scripts, data files present
    expect(fileExists(path.join(projectDir, "ralph.sh"))).toBe(false);
    expect(fileExists(path.join(projectDir, MARKER_FILENAME))).toBe(true);

    // Update (no changes — should be idempotent)
    const updateResult = update(projectDir, { artifactsDir: ARTIFACTS_DIR });
    expect(updateResult.ok).toBe(true);

    // Uninstall
    const uninstallResult = uninstall(projectDir);
    expect(uninstallResult.ok).toBe(true);

    // Verify removed
    expect(fileExists(path.join(projectDir, MARKER_FILENAME))).toBe(false);
    expect(fileExists(path.join(projectDir, ".rauf", "RAUF.md"))).toBe(false);

    // Backlog preserved by default
    expect(fileExists(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
  });

  it("install with profile overrides and CLAUDE.md merge", () => {
    const projectDir = path.join(tmpDir, "override-project");
    createProject(projectDir, { git: true, packageJson: true, tsconfig: true });

    // Pre-existing CLAUDE.md
    const existingContent = "# My Existing Project\n\nImportant documentation.\n";
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), existingContent);

    const result = install(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      profileOverrides: {
        test: "npm run custom-test",
        lint: "npm run custom-lint",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Profile overrides applied
    expect(result.value.profile.commands.test).toBe("npm run custom-test");
    expect(result.value.profile.commands.lint).toBe("npm run custom-lint");

    // CLAUDE.md preserves existing content + adds ralph section
    const claudeMd = fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("# My Existing Project");
    expect(claudeMd).toContain("Important documentation.");
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);
  });
});

// ═════════════════════════════════════════════════════════════════
// 2. Greenfield init creates valid project
// ═════════════════════════════════════════════════════════════════

describe("Integration: greenfield init creates valid project", () => {
  it("creates project with git, artifacts, and valid marker", () => {
    const projectDir = path.join(tmpDir, "greenfield-project");

    const result = initProject(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      preset: "node-typescript",
      projectName: "my-greenfield",
      projectDescription: "A fresh greenfield project",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Directory created
    expect(fs.existsSync(projectDir)).toBe(true);

    // Git initialized
    expect(fs.existsSync(path.join(projectDir, ".git"))).toBe(true);
    const log = spawnSync("git", ["log", "--oneline", "-1"], {
      cwd: projectDir,
      encoding: "utf-8",
    });
    expect(log.status).toBe(0);
    expect(log.stdout).toContain("Initial commit");

    // .gitignore created
    expect(fileExists(path.join(projectDir, ".gitignore"))).toBe(true);
    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules");

    // No scripts deployed
    expect(fileExists(path.join(projectDir, "ralph.sh"))).toBe(false);
    expect(fileExists(path.join(projectDir, "ralph-add.sh"))).toBe(false);
    expect(fileExists(path.join(projectDir, "ralph-status.sh"))).toBe(false);

    // .rauf/ data files
    expect(fileExists(path.join(projectDir, ".rauf", "RAUF.md"))).toBe(true);
    expect(fileExists(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
    expect(fileExists(path.join(projectDir, ".rauf", "progress.md"))).toBe(true);

    // CLAUDE.md with ralph section
    const claudeMd = fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);

    // .rauf.json marker is valid
    const markerResult = readMarkerFile(projectDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;
    expect(markerResult.value.rauf).toBe(true);

    // Backlog is valid and empty (no seed provided)
    const backlogResult = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlogResult.ok).toBe(true);
    if (!backlogResult.ok) return;
    expect(backlogResult.value.items).toEqual([]);

    // Report is correct
    expect(result.value.projectPath).toBe(path.resolve(projectDir));
  });

  it("creates project with seed backlog items", () => {
    const projectDir = path.join(tmpDir, "seeded-project");

    // Create a seed file
    const seedPath = path.join(tmpDir, "seed.md");
    fs.writeFileSync(
      seedPath,
      [
        "- [ ] [feature] User authentication",
        "- [ ] [bug] Fix login redirect",
        "- [ ] [chore] Set up CI pipeline",
      ].join("\n"),
    );

    const result = initProject(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      preset: "node-typescript",
      projectName: "seeded-project",
      seedFile: seedPath,
    });
    expect(result.ok).toBe(true);

    // Verify seeded items
    const backlogResult = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlogResult.ok).toBe(true);
    if (!backlogResult.ok) return;

    expect(backlogResult.value.items.length).toBe(3);
    expect(backlogResult.value.items[0]!.title).toBe("User authentication");
    expect(backlogResult.value.items[0]!.type).toBe("feature");
    expect(backlogResult.value.items[1]!.title).toBe("Fix login redirect");
    expect(backlogResult.value.items[1]!.type).toBe("bug");
    expect(backlogResult.value.items[2]!.title).toBe("Set up CI pipeline");
    expect(backlogResult.value.items[2]!.type).toBe("chore");

    // IDs are auto-assigned
    expect(backlogResult.value.items[0]!.id).toBe("001");
    expect(backlogResult.value.items[1]!.id).toBe("002");
    expect(backlogResult.value.items[2]!.id).toBe("003");
  });

  it("creates project with different stack presets", () => {
    const projectDir = path.join(tmpDir, "python-project");

    const result = initProject(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      preset: "python",
      projectName: "py-project",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // .gitignore should be Python-specific
    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("__pycache__");

    // Marker should have python stack
    const markerResult = readMarkerFile(projectDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;
    expect(markerResult.value.profile.stack).toBe("python");
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. Backlog add/list/edit/delete cycle
// ═════════════════════════════════════════════════════════════════

describe("Integration: backlog add/list/edit/delete cycle", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = path.join(tmpDir, "backlog-project");
    createProject(projectDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    // Install to get a valid project with empty backlog
    const result = install(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      projectName: "backlog-test",
    });
    expect(result.ok).toBe(true);
  });

  it("add → list → edit → delete full cycle", () => {
    // ── Add items ──
    const add1 = addItem(defaultBacklogPaths(projectDir), {
      type: "feature",
      priority: 1,
      title: "Implement login",
      description: "Add login page with OAuth",
      acceptanceCriteria: ["Login form renders", "OAuth flow works"],
    });
    expect(add1.ok).toBe(true);
    if (!add1.ok) return;
    expect(add1.value.id).toBe("001");
    expect(add1.value.status).toBe("pending");

    const add2 = addItem(defaultBacklogPaths(projectDir), {
      type: "bug",
      priority: 2,
      title: "Fix header alignment",
    });
    expect(add2.ok).toBe(true);
    if (!add2.ok) return;
    expect(add2.value.id).toBe("002");

    const add3 = addItem(defaultBacklogPaths(projectDir), {
      type: "chore",
      priority: 3,
      title: "Set up linting",
      acceptanceCriteria: ["ESLint runs", "No errors"],
    });
    expect(add3.ok).toBe(true);
    if (!add3.ok) return;
    expect(add3.value.id).toBe("003");

    // ── List (read backlog) ──
    const backlog = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;
    expect(backlog.value.items).toHaveLength(3);
    expect(backlog.value.items[0]!.title).toBe("Implement login");
    expect(backlog.value.items[1]!.title).toBe("Fix header alignment");
    expect(backlog.value.items[2]!.title).toBe("Set up linting");

    // ── Edit: transition pending → in_progress ──
    const edit1 = updateItem(defaultBacklogPaths(projectDir), "001", { status: "in_progress" });
    expect(edit1.ok).toBe(true);
    if (!edit1.ok) return;
    expect(edit1.value.status).toBe("in_progress");

    // ── Edit: transition in_progress → done ──
    const edit2 = updateItem(defaultBacklogPaths(projectDir), "001", { status: "done" });
    expect(edit2.ok).toBe(true);
    if (!edit2.ok) return;
    expect(edit2.value.status).toBe("done");
    expect(edit2.value.completedAt).not.toBeNull();

    // ── Edit: update title and priority ──
    const edit3 = updateItem(defaultBacklogPaths(projectDir), "002", {
      title: "Fix header and footer alignment",
      priority: 1,
    });
    expect(edit3.ok).toBe(true);
    if (!edit3.ok) return;
    expect(edit3.value.title).toBe("Fix header and footer alignment");
    expect(edit3.value.priority).toBe(1);

    // ── Delete an item ──
    const del = deleteItem(defaultBacklogPaths(projectDir), "003");
    expect(del.ok).toBe(true);

    // ── Verify final state ──
    const finalBacklog = readBacklog(defaultBacklogPaths(projectDir));
    expect(finalBacklog.ok).toBe(true);
    if (!finalBacklog.ok) return;
    expect(finalBacklog.value.items).toHaveLength(2);
    expect(finalBacklog.value.items.find((i) => i.id === "003")).toBeUndefined();

    const item1 = finalBacklog.value.items.find((i) => i.id === "001");
    expect(item1?.status).toBe("done");
    expect(item1?.completedAt).not.toBeNull();

    const item2 = finalBacklog.value.items.find((i) => i.id === "002");
    expect(item2?.title).toBe("Fix header and footer alignment");
    expect(item2?.priority).toBe(1);
  });

  it("invalid transitions are rejected", () => {
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 1, title: "Test item" });

    // pending → done is invalid (must go through in_progress)
    const badTransition = updateItem(defaultBacklogPaths(projectDir), "001", { status: "done" });
    expect(badTransition.ok).toBe(false);
    if (badTransition.ok) return;
    expect(badTransition.error.code).toBe("TRANSITION_INVALID");
  });

  it("backup and restore works after modifications", () => {
    // Add items (each write creates a .bak)
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 1, title: "Item A" });
    addItem(defaultBacklogPaths(projectDir), { type: "bug", priority: 2, title: "Item B" });

    // Now add a third item — the .bak now has 2 items
    addItem(defaultBacklogPaths(projectDir), { type: "chore", priority: 3, title: "Item C" });

    // Verify we have 3 items
    const before = readBacklog(defaultBacklogPaths(projectDir));
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.items).toHaveLength(3);

    // Restore from backup (should have 2 items, from before the 3rd add)
    const restoreResult = restoreFromBackup(defaultBacklogPaths(projectDir));
    expect(restoreResult.ok).toBe(true);

    const after = readBacklog(defaultBacklogPaths(projectDir));
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.items).toHaveLength(2);
    expect(after.value.items.find((i) => i.title === "Item C")).toBeUndefined();
  });

  it("auto-assigns smart default acceptance criteria", () => {
    // Add item without explicit acceptance criteria
    const result = addItem(defaultBacklogPaths(projectDir), {
      type: "feature",
      priority: 1,
      title: "No explicit AC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should get a smart default based on the installed profile's verify command
    expect(result.value.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("ID assignment handles gaps from deletions", () => {
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 1, title: "First" }); // 001
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 2, title: "Second" }); // 002
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 3, title: "Third" }); // 003

    // Delete item 002
    deleteItem(defaultBacklogPaths(projectDir), "002");

    // Next ID should be 004, not 002 (gaps are intentional)
    const add4 = addItem(defaultBacklogPaths(projectDir), {
      type: "feature",
      priority: 1,
      title: "Fourth",
    });
    expect(add4.ok).toBe(true);
    if (!add4.ok) return;
    expect(add4.value.id).toBe("004");
  });

  it("dependsOn references are validated", () => {
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 1, title: "Foundation" }); // 001

    // Add item depending on 001 — should succeed
    const dep = addItem(defaultBacklogPaths(projectDir), {
      type: "feature",
      priority: 2,
      title: "Dependent",
      dependsOn: ["001"],
    });
    expect(dep.ok).toBe(true);

    // Add item depending on nonexistent item — should fail
    const badDep = addItem(defaultBacklogPaths(projectDir), {
      type: "feature",
      priority: 2,
      title: "Bad dependency",
      dependsOn: ["999"],
    });
    expect(badDep.ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. Status derivation with mock state.json
// ═════════════════════════════════════════════════════════════════

describe("Integration: status derivation with mock state.json", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = path.join(tmpDir, "status-project");
    createProject(projectDir, { git: true, packageJson: true });

    // Install to create a valid project
    const result = install(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      projectName: "status-test",
    });
    expect(result.ok).toBe(true);

    // Add some backlog items
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 1, title: "Task A" });
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 2, title: "Task B" });
    addItem(defaultBacklogPaths(projectDir), { type: "bug", priority: 1, title: "Task C" });
  });

  it("derives RUNNING state from state.json with recent updatedAt", () => {
    writeStateJson(projectDir, makeLoopState({ status: "running" }));

    const result = deriveStatus(defaultBacklogPaths(projectDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loopState).toBe("RUNNING");
    expect(result.value.stateSource).toBe("state.json");
    expect(result.value.currentItem).toBe("001");
    expect(result.value.backlogSummary).toBeDefined();
    expect(result.value.backlogSummary.total).toBe(3);
  });

  it("derives PAUSED state from stale state.json (>5 min old)", () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    writeStateJson(
      projectDir,
      makeLoopState({
        status: "running",
        updatedAt: staleDate,
      }),
    );

    const result = deriveStatus(defaultBacklogPaths(projectDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loopState).toBe("PAUSED");
  });

  it("derives COMPLETE state from completed state.json", () => {
    writeStateJson(
      projectDir,
      makeLoopState({
        status: "complete",
        lastSignal: "clean",
        completedItems: ["001", "002"],
      }),
    );

    const result = deriveStatus(defaultBacklogPaths(projectDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loopState).toBe("COMPLETE");
  });

  it("derives status from log parsing when state.json is missing", () => {
    // Write a fresh log file (recent mtime → RUNNING)
    writeLog(
      projectDir,
      [
        "=== Rauf Loop Starting ===",
        `Date: ${new Date().toISOString()}`,
        "--- Iteration 1 / 10 ---",
        "Processing item 001",
      ].join("\n"),
    );

    const result = deriveStatus(defaultBacklogPaths(projectDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loopState).toBe("RUNNING");
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("derives COMPLETE from DONE file when log is stale", () => {
    // Write a stale log
    const staleDate = new Date(Date.now() - 5 * 60 * 1000);
    writeLog(projectDir, "Some old log content\n", staleDate);

    // Write DONE file
    writeDoneFile(projectDir, "done");

    const result = deriveStatus(defaultBacklogPaths(projectDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loopState).toBe("COMPLETE");
    expect(result.value.stateSource).toBe("log-parsing");
  });

  it("derives PAUSED_HUMAN from DONE file with human content", () => {
    const staleDate = new Date(Date.now() - 5 * 60 * 1000);
    writeLog(projectDir, "Some log\n", staleDate);
    writeDoneFile(projectDir, "needs_human");

    const result = deriveStatus(defaultBacklogPaths(projectDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loopState).toBe("PAUSED_HUMAN");
  });

  it("backlog summary reflects actual backlog state", () => {
    // Transition one item to in_progress, another to done
    updateItem(defaultBacklogPaths(projectDir), "001", { status: "in_progress" });
    updateItem(defaultBacklogPaths(projectDir), "001", { status: "done" });

    writeStateJson(projectDir, makeLoopState({ status: "complete" }));

    const result = deriveStatus(defaultBacklogPaths(projectDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogSummary.done).toBe(1);
    expect(result.value.backlogSummary.pending).toBe(2);
    expect(result.value.backlogSummary.total).toBe(3);
  });

  it("readLogTail returns correct number of lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
    writeLog(projectDir, lines.join("\n") + "\n");

    const result = readLogTail(defaultBacklogPaths(projectDir), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(10);
    expect(result.value[result.value.length - 1]).toBe("Line 100");
  });

  it("returns IDLE when .rauf directory does not exist (caller handles NOT_INSTALLED)", () => {
    // Create a project without installing ralph.
    // With BacklogPaths, deriveStatus no longer checks for .rauf dir existence —
    // the caller (CLI/web) is responsible for the NOT_INSTALLED check.
    const bareDir = path.join(tmpDir, "bare-project");
    createProject(bareDir, { git: true });

    const result = deriveStatus(defaultBacklogPaths(bareDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loopState).toBe("IDLE");
    expect(result.value.stateSource).toBe("none");
  });
});

// ═════════════════════════════════════════════════════════════════
// 5. Cross-module: install → add items → status derivation
// ═════════════════════════════════════════════════════════════════

describe("Integration: install → backlog → status full workflow", () => {
  it("complete workflow from install through status check", () => {
    const projectDir = path.join(tmpDir, "full-workflow");
    createProject(projectDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    // Install
    const installResult = install(projectDir, {
      artifactsDir: ARTIFACTS_DIR,
      projectName: "full-workflow",
    });
    expect(installResult.ok).toBe(true);

    // Add items
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 1, title: "Feature 1" });
    addItem(defaultBacklogPaths(projectDir), { type: "feature", priority: 2, title: "Feature 2" });

    // Check status (should be IDLE — no loop running)
    const statusResult = deriveStatus(defaultBacklogPaths(projectDir));
    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;

    expect(statusResult.value.loopState).toBe("IDLE");
    expect(statusResult.value.backlogSummary.pending).toBe(2);
    expect(statusResult.value.backlogSummary.total).toBe(2);

    // Simulate loop running
    updateItem(defaultBacklogPaths(projectDir), "001", { status: "in_progress" });
    writeStateJson(
      projectDir,
      makeLoopState({
        status: "running",
        currentItem: "001",
        iteration: 1,
        maxIterations: 20,
      }),
    );

    // Status should now be RUNNING
    const runningStatus = deriveStatus(defaultBacklogPaths(projectDir));
    expect(runningStatus.ok).toBe(true);
    if (!runningStatus.ok) return;
    expect(runningStatus.value.loopState).toBe("RUNNING");
    expect(runningStatus.value.currentItem).toBe("001");

    // Simulate loop completing item
    updateItem(defaultBacklogPaths(projectDir), "001", { status: "done" });
    writeStateJson(
      projectDir,
      makeLoopState({
        status: "complete",
        completedItems: ["001"],
        lastSignal: "clean",
      }),
    );

    // Status should now be COMPLETE
    const completeStatus = deriveStatus(defaultBacklogPaths(projectDir));
    expect(completeStatus.ok).toBe(true);
    if (!completeStatus.ok) return;
    expect(completeStatus.value.loopState).toBe("COMPLETE");
    expect(completeStatus.value.backlogSummary.done).toBe(1);
    expect(completeStatus.value.backlogSummary.pending).toBe(1);
  });
});
