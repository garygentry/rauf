import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveBacklogRoot,
  resolveStateDir,
  resolveBacklogPaths,
  resolveInstructionPaths,
  ensureStateDir,
  scanBacklogRoots,
  resolveTarget,
  type TargetErrorCode,
} from "./backlog-root.js";
import { ErrorCodes } from "./errors.js";
import { createMultiRootProject } from "./test-helpers.js";
import { listActiveLoops } from "./loop-registry.js";
import type { ActiveLoopEntry } from "./schemas.js";

// Mock the registry so resolveTarget's TTY enumeration is deterministic and so
// we can spy on whether it is consulted at all.
vi.mock("./loop-registry.js", () => ({
  listActiveLoops: vi.fn(() => ({ ok: true, value: [] })),
}));
const mockListActiveLoops = vi.mocked(listActiveLoops);

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

// ─── scanBacklogRoots ────────────────────────────────────────────

describe("scanBacklogRoots", () => {
  it("returns just the default .rauf root for a single-root project", () => {
    const result = scanBacklogRoots(project.projectPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value).toEqual([{ root: ".rauf", isDefault: true }]);
  });

  it("discovers every backlog root, default first then alphabetical", () => {
    const p = createMultiRootProject({
      roots: [{ path: "specs/zeta" }, { path: "specs/auth" }],
    });
    const result = scanBacklogRoots(p.projectPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value).toEqual([
      { root: ".rauf", isDefault: true },
      { root: "specs/auth", isDefault: false },
      { root: "specs/zeta", isDefault: false },
    ]);
    p.cleanup();
  });

  it("every discovered root resolves via resolveBacklogPaths", () => {
    const p = createMultiRootProject({ roots: [{ path: "specs/auth" }] });
    const result = scanBacklogRoots(p.projectPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    for (const entry of result.value) {
      const resolved = resolveBacklogPaths(p.projectPath, path.join(p.projectPath, entry.root));
      expect(resolved.ok).toBe(true);
    }
    p.cleanup();
  });

  it("skips node_modules and other scan-skip dirs", () => {
    const p = createMultiRootProject({ roots: [{ path: "specs/auth" }] });
    // A backlog.json buried in node_modules must not be discovered.
    const buried = path.join(p.projectPath, "node_modules", "pkg", ".rauf");
    fs.mkdirSync(buried, { recursive: true });
    fs.writeFileSync(
      path.join(buried, "backlog.json"),
      JSON.stringify({ schemaVersion: "1", project: "x", description: "", items: [] }),
    );
    const result = scanBacklogRoots(p.projectPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.map((r) => r.root)).toEqual([".rauf", "specs/auth"]);
    p.cleanup();
  });

  it("skips artifacts/ so template backlogs are not discovered as noise", () => {
    const p = createMultiRootProject({ roots: [{ path: "specs/auth" }] });
    // rauf ships template backlogs under artifacts/ (e.g. artifacts/variants/.rauf/);
    // these must not surface as candidate roots. Covers both a nested `.rauf` root
    // and a legacy state dir under an `artifacts/` subtree.
    for (const rel of ["artifacts/variants/.rauf", "artifacts/legacy/.ralph"]) {
      const dir = path.join(p.projectPath, rel);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "backlog.json"),
        JSON.stringify({ schemaVersion: "1", project: "x", description: "", items: [] }),
      );
    }
    const result = scanBacklogRoots(p.projectPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.value.map((r) => r.root)).toEqual([".rauf", "specs/auth"]);
    p.cleanup();
  });
});

// ─── resolveTarget ───────────────────────────────────────────────

describe("resolveTarget", () => {
  function makeEntry(projectPath: string, backlogRoot: string): ActiveLoopEntry {
    return {
      stateDir: backlogRoot,
      projectPath,
      backlogRoot,
      pid: 1234,
      startedAt: new Date().toISOString(),
      status: "running",
    };
  }

  beforeEach(() => {
    mockListActiveLoops.mockReset();
    mockListActiveLoops.mockReturnValue({ ok: true, value: [] });
  });

  it("resolves an explicit pathArg regardless of context", () => {
    const res = resolveTarget({
      pathArg: project.projectPath,
      isMachineContext: true,
      isTTY: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unexpected");
    expect(res.value.kind).toBe("resolved");
    if (res.value.kind !== "resolved") throw new Error("unexpected");
    expect(res.value.root).toBe(path.resolve(project.projectPath));
    expect(res.value.backlogDir).toBe(path.join(path.resolve(project.projectPath), ".rauf"));
    // pathArg branch is context-independent — never enumerates.
    expect(mockListActiveLoops).not.toHaveBeenCalled();
  });

  it("returns missing_target in machine context with no pathArg and does NOT enumerate or read cwd", () => {
    const cwdSpy = vi.spyOn(process, "cwd");
    const res = resolveTarget({ isMachineContext: true, isTTY: true });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unexpected");
    expect(res.error.code).toBe("missing_target");
    expect(mockListActiveLoops).not.toHaveBeenCalled();
    expect(cwdSpy).not.toHaveBeenCalled();
    cwdSpy.mockRestore();
  });

  it("treats non-TTY-non-machine defensively as machine strictness (missing_target)", () => {
    const res = resolveTarget({ isMachineContext: false, isTTY: false });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unexpected");
    expect(res.error.code).toBe("missing_target");
    expect(mockListActiveLoops).not.toHaveBeenCalled();
  });

  it("TTY, exactly one active loop → resolves that loop's root", () => {
    const backlogRoot = path.join(path.resolve(project.projectPath), ".rauf");
    mockListActiveLoops.mockReturnValue({
      ok: true,
      value: [makeEntry(project.projectPath, backlogRoot)],
    });
    const res = resolveTarget({ isMachineContext: false, isTTY: true });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unexpected");
    expect(res.value.kind).toBe("resolved");
    if (res.value.kind !== "resolved") throw new Error("unexpected");
    expect(res.value.root).toBe(path.resolve(project.projectPath));
    expect(res.value.backlogDir).toBe(backlogRoot);
  });

  it("TTY, several active loops → ambiguous with those candidates", () => {
    const entries = [
      makeEntry(project.projectPath, path.join(path.resolve(project.projectPath), ".rauf")),
      makeEntry("/other/proj", "/other/proj/.rauf"),
    ];
    mockListActiveLoops.mockReturnValue({ ok: true, value: entries });
    const res = resolveTarget({ isMachineContext: false, isTTY: true });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unexpected");
    expect(res.value.kind).toBe("ambiguous");
    if (res.value.kind !== "ambiguous") throw new Error("unexpected");
    expect(res.value.candidates).toEqual(entries);
  });

  it("TTY, zero active loops → resolves cwd default", () => {
    mockListActiveLoops.mockReturnValue({ ok: true, value: [] });
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(path.resolve(project.projectPath));
    const res = resolveTarget({ isMachineContext: false, isTTY: true });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unexpected");
    expect(res.value.kind).toBe("resolved");
    if (res.value.kind !== "resolved") throw new Error("unexpected");
    expect(res.value.root).toBe(path.resolve(project.projectPath));
    cwdSpy.mockRestore();
  });

  it("TTY, listActiveLoops IO_ERROR → treated as zero (cwd default)", () => {
    mockListActiveLoops.mockReturnValue({
      ok: false,
      error: { code: ErrorCodes.IO_ERROR, message: "boom" },
    });
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(path.resolve(project.projectPath));
    const res = resolveTarget({ isMachineContext: false, isTTY: true });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unexpected");
    expect(res.value.kind).toBe("resolved");
    cwdSpy.mockRestore();
  });

  it("out-of-root backlogFlag → outside_sandbox (PATH_VIOLATION mapped)", () => {
    const res = resolveTarget({
      pathArg: project.projectPath,
      backlogFlag: "../escape",
      isMachineContext: true,
      isTTY: false,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unexpected");
    expect(res.error.code).toBe("outside_sandbox");
    expect(res.error.offending).toBe("../escape");
  });

  it("non-existent root → not_found", () => {
    const missing = path.join(path.resolve(project.projectPath), "no-such-dir");
    const res = resolveTarget({
      pathArg: missing,
      isMachineContext: true,
      isTTY: false,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unexpected");
    expect(res.error.code).toBe("not_found");
  });

  it("all four TargetErrorCode variants are reachable", () => {
    // missing_target
    const missing = resolveTarget({ isMachineContext: true, isTTY: false });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unexpected");
    expect(missing.error.code).toBe("missing_target");

    // outside_sandbox
    const outside = resolveTarget({
      pathArg: project.projectPath,
      backlogFlag: "../escape",
      isMachineContext: true,
      isTTY: false,
    });
    expect(outside.ok).toBe(false);
    if (outside.ok) throw new Error("unexpected");
    expect(outside.error.code).toBe("outside_sandbox");

    // not_found
    const notFound = resolveTarget({
      pathArg: path.join(path.resolve(project.projectPath), "no-such"),
      isMachineContext: true,
      isTTY: false,
    });
    expect(notFound.ok).toBe(false);
    if (notFound.ok) throw new Error("unexpected");
    expect(notFound.error.code).toBe("not_found");

    // ambiguous_target is not produced by resolveTarget's algorithm (branch 2
    // fails fast); it exists in the type surface for an exhaustive CLI switch.
    const codes: TargetErrorCode[] = [
      "missing_target",
      "ambiguous_target",
      "not_found",
      "outside_sandbox",
    ];
    expect(codes).toContain("ambiguous_target");
  });
});
