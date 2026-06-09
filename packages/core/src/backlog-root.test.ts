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
  it("returns {projectPath}/.rauf when no flag is provided", () => {
    const result = resolveBacklogRoot(project.projectPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value).toBe(path.join(project.projectPath, ".rauf"));
  });

  it("returns {projectPath}/.rauf when flag is empty string", () => {
    const result = resolveBacklogRoot(project.projectPath, "");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value).toBe(path.join(project.projectPath, ".rauf"));
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
  it("returns same directory when basename is .rauf (no nesting)", () => {
    const input = path.join(project.projectPath, ".rauf");
    expect(resolveStateDir(input)).toBe(input);
  });

  it("returns {root}/.rauf for custom root basename", () => {
    const input = path.join(project.projectPath, "specs", "auth");
    expect(resolveStateDir(input)).toBe(path.join(input, ".rauf"));
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
    expect(result.value.backlog).toBe(path.join(root, ".rauf", "backlog.json"));
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
    const root = path.join(project.projectPath, ".rauf");
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
    const root = path.join(project.projectPath, ".rauf");
    const result = resolveBacklogPaths(project.projectPath, root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.stateDir).toBe(result.value.root);
  });
});

// ─── resolveInstructionPaths ─────────────────────────────────────

describe("resolveInstructionPaths", () => {
  it("finds per-root RAUF.md when present", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", hasRaufMd: true }],
    });
    const root = path.join(p.projectPath, "specs/auth");
    const pathsResult = resolveBacklogPaths(p.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    const instructions = resolveInstructionPaths(pathsResult.value);
    expect(instructions.raufMd).toBe(path.join(root, ".rauf", "RAUF.md"));
    p.cleanup();
  });

  it("falls back to project-level RAUF.md", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", hasRaufMd: false }],
    });
    const root = path.join(p.projectPath, "specs/auth");
    const pathsResult = resolveBacklogPaths(p.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    const instructions = resolveInstructionPaths(pathsResult.value);
    // Falls back to project-level .rauf/RAUF.md (created by default)
    expect(instructions.raufMd).toBe(path.join(p.projectPath, ".rauf", "RAUF.md"));
    p.cleanup();
  });

  it("returns null when RAUF.md missing everywhere", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/auth", hasRaufMd: false }],
    });
    // Remove the project-level RAUF.md too
    fs.unlinkSync(path.join(p.projectPath, ".rauf", "RAUF.md"));

    const root = path.join(p.projectPath, "specs/auth");
    const pathsResult = resolveBacklogPaths(p.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    const instructions = resolveInstructionPaths(pathsResult.value);
    expect(instructions.raufMd).toBeNull();
    p.cleanup();
  });

  it("does not fall back for default root (stateDir === project .rauf/)", () => {
    // Default root: stateDir IS .rauf/, so no fallback path exists
    const root = path.join(project.projectPath, ".rauf");
    const pathsResult = resolveBacklogPaths(project.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    // Remove RAUF.md from default root
    fs.unlinkSync(path.join(project.projectPath, ".rauf", "RAUF.md"));

    const instructions = resolveInstructionPaths(pathsResult.value);
    // Should be null — no fallback since stateDir === projectRaufDir
    expect(instructions.raufMd).toBeNull();
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
    const root = path.join(project.projectPath, ".rauf");
    const pathsResult = resolveBacklogPaths(project.projectPath, root);
    expect(pathsResult.ok).toBe(true);
    if (!pathsResult.ok) throw new Error("unexpected");

    // stateDir already exists from createMultiRootProject
    const result = ensureStateDir(pathsResult.value);
    expect(result.ok).toBe(true);
  });
});
