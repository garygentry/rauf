import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveBacklogRoot,
  resolveStateDir,
  resolveBacklogPaths,
  resolveInstructionPaths,
  ensureStateDir,
} from "./backlog-root.js";
import { ErrorCodes } from "./errors.js";
import { createMultiRootProject } from "./test-helpers.js";

let project: ReturnType<typeof createMultiRootProject>;

beforeEach(() => {
  project = createMultiRootProject();
});

afterEach(() => {
  project.cleanup();
});

// ─── resolveBacklogRoot ──────────────────────────────────────────

describe("resolveBacklogRoot", () => {
  it("returns {projectPath}/.ralph when no flag is provided", () => {
    const result = resolveBacklogRoot(project.projectPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value).toBe(path.join(project.projectPath, ".ralph"));
  });

  it("returns {projectPath}/.ralph when flag is empty string", () => {
    const result = resolveBacklogRoot(project.projectPath, "");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value).toBe(path.join(project.projectPath, ".ralph"));
  });

  it("resolves a custom path relative to projectPath", () => {
    const result = resolveBacklogRoot(project.projectPath, "specs/auth");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value).toBe(path.join(project.projectPath, "specs/auth"));
  });

  it("returns PATH_VIOLATION for path traversal (../../outside)", () => {
    const result = resolveBacklogRoot(project.projectPath, "../../outside");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unexpected");
    expect(result.error.code).toBe(ErrorCodes.PATH_VIOLATION);
  });
});

// ─── resolveStateDir ─────────────────────────────────────────────

describe("resolveStateDir", () => {
  it("returns same directory when basename is .ralph (no nesting)", () => {
    const input = path.join(project.projectPath, ".ralph");
    expect(resolveStateDir(input)).toBe(input);
  });

  it("returns {root}/.ralph for custom root basename", () => {
    const input = path.join(project.projectPath, "specs", "auth");
    expect(resolveStateDir(input)).toBe(path.join(input, ".ralph"));
  });
});

// ─── resolveBacklogPaths ─────────────────────────────────────────

describe("resolveBacklogPaths", () => {
  it("finds backlog.json in root directory first", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", backlog: { project: "auth", description: "Auth", items: [] } }],
    });
    const root = path.join(p.projectPath, "specs/auth");
    const result = resolveBacklogPaths(p.projectPath, root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.backlog).toBe(path.join(root, "backlog.json"));
    p.cleanup();
  });

  it("falls back to stateDir for backlog.json", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", backlogInRoot: false }],
    });
    const root = path.join(p.projectPath, "specs/auth");
    const result = resolveBacklogPaths(p.projectPath, root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.backlog).toBe(path.join(root, ".ralph", "backlog.json"));
    p.cleanup();
  });

  it("returns FILE_NOT_FOUND when no backlog.json exists", () => {
    // Create a directory with no backlog.json
    const emptyRoot = path.join(project.projectPath, "empty-root");
    fs.mkdirSync(emptyRoot, { recursive: true });
    const result = resolveBacklogPaths(project.projectPath, emptyRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unexpected");
    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("returns FILE_NOT_FOUND when root directory does not exist", () => {
    const nonexistent = path.join(project.projectPath, "does-not-exist");
    const result = resolveBacklogPaths(project.projectPath, nonexistent);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unexpected");
    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("returns PATH_VIOLATION for root outside project", () => {
    const result = resolveBacklogPaths(project.projectPath, "/tmp/outside");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unexpected");
    expect(result.error.code).toBe(ErrorCodes.PATH_VIOLATION);
  });

  it("all path fields are absolute", () => {
    const root = path.join(project.projectPath, ".ralph");
    const result = resolveBacklogPaths(project.projectPath, root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    const paths = result.value;
    expect(path.isAbsolute(paths.projectPath)).toBe(true);
    expect(path.isAbsolute(paths.root)).toBe(true);
    expect(path.isAbsolute(paths.stateDir)).toBe(true);
    expect(path.isAbsolute(paths.backlog)).toBe(true);
    expect(path.isAbsolute(paths.state)).toBe(true);
    expect(path.isAbsolute(paths.log)).toBe(true);
    expect(path.isAbsolute(paths.done)).toBe(true);
    expect(path.isAbsolute(paths.cancel)).toBe(true);
    expect(path.isAbsolute(paths.progress)).toBe(true);
    expect(path.isAbsolute(paths.iterationStatus)).toBe(true);
    expect(path.isAbsolute(paths.archive)).toBe(true);
    expect(path.isAbsolute(paths.lock)).toBe(true);
  });

  it("default root has stateDir equal to root", () => {
    const root = path.join(project.projectPath, ".ralph");
    const result = resolveBacklogPaths(project.projectPath, root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.stateDir).toBe(result.value.root);
  });
});

// ─── resolveInstructionPaths ─────────────────────────────────────

describe("resolveInstructionPaths", () => {
  it("finds per-root RALPH.md when present", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", hasRalphMd: true }],
    });
    const root = path.join(p.projectPath, "specs/auth");
    const pathsResult = resolveBacklogPaths(p.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    const instructions = resolveInstructionPaths(pathsResult.value);
    expect(instructions.ralphMd).toBe(path.join(root, ".ralph", "RALPH.md"));
    p.cleanup();
  });

  it("falls back to project-level RALPH.md", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", hasRalphMd: false }],
    });
    const root = path.join(p.projectPath, "specs/auth");
    const pathsResult = resolveBacklogPaths(p.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    const instructions = resolveInstructionPaths(pathsResult.value);
    // Falls back to project-level .ralph/RALPH.md (created by default)
    expect(instructions.ralphMd).toBe(path.join(p.projectPath, ".ralph", "RALPH.md"));
    p.cleanup();
  });

  it("returns null when RALPH.md missing everywhere", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", hasRalphMd: false }],
    });
    // Remove the project-level RALPH.md too
    fs.unlinkSync(path.join(p.projectPath, ".ralph", "RALPH.md"));

    const root = path.join(p.projectPath, "specs/auth");
    const pathsResult = resolveBacklogPaths(p.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    const instructions = resolveInstructionPaths(pathsResult.value);
    expect(instructions.ralphMd).toBeNull();
    p.cleanup();
  });

  it("does not fall back for default root (stateDir === project .ralph/)", () => {
    // Default root: stateDir IS .ralph/, so no fallback path exists
    const root = path.join(project.projectPath, ".ralph");
    const pathsResult = resolveBacklogPaths(project.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    // Remove RALPH.md from default root
    fs.unlinkSync(path.join(project.projectPath, ".ralph", "RALPH.md"));

    const instructions = resolveInstructionPaths(pathsResult.value);
    // Should be null — no fallback since stateDir === projectRalphDir
    expect(instructions.ralphMd).toBeNull();
  });
});

// ─── ensureStateDir ──────────────────────────────────────────────

describe("ensureStateDir", () => {
  it("creates directory with parents", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth" }],
    });
    const root = path.join(p.projectPath, "specs/auth");
    const pathsResult = resolveBacklogPaths(p.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    // Remove the state dir to test creation
    const stateDir = pathsResult.value.stateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
    expect(fs.existsSync(stateDir)).toBe(false);

    const result = ensureStateDir(pathsResult.value);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
    p.cleanup();
  });

  it("is a no-op when directory already exists", () => {
    const root = path.join(project.projectPath, ".ralph");
    const pathsResult = resolveBacklogPaths(project.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    // stateDir already exists from createMultiRootProject
    const result = ensureStateDir(pathsResult.value);
    expect(result.ok).toBe(true);
  });
});
