import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { discoverProjects } from "./discovery.js";
import { ErrorCodes } from "./errors.js";
import type { MarkerFile } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-discovery-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a valid MarkerFile object for testing */
function makeMarker(overrides: Partial<MarkerFile> = {}): MarkerFile {
  return {
    rauf: true,
    version: "1",
    variant: "backlog-json",
    installedAt: "2026-01-01T00:00:00Z",
    installedBy: "ralph@0.1.0",
    profile: {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck",
        lint: "pnpm lint",
        build: "pnpm build",
        format: null,
      },
      verify: "pnpm test && pnpm typecheck && pnpm lint && pnpm build",
    },
    artifactHashes: {},
    options: {
      ignoreInTool: false,
      gitignoreScripts: false,
      maxIterations: 20,
    },
    ...overrides,
  };
}

/** Create a project directory with a .rauf.json marker */
function createProject(name: string, marker?: MarkerFile, parent?: string): string {
  const dir = path.join(parent ?? tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".rauf.json"), JSON.stringify(marker ?? makeMarker(), null, 2));
  return dir;
}

// ─── discoverProjects ─────────────────────────────────────────────

describe("discoverProjects", () => {
  it("returns empty when no projects have .rauf.json", () => {
    // Create some directories without .rauf.json
    fs.mkdirSync(path.join(tmpDir, "project-a"));
    fs.mkdirSync(path.join(tmpDir, "project-b"));

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(0);
    expect(result.value.ignored).toHaveLength(0);
    expect(result.value.warnings).toHaveLength(0);
  });

  it("discovers child directories with valid .rauf.json", () => {
    createProject("alpha");
    createProject("beta");
    fs.mkdirSync(path.join(tmpDir, "no-marker"));

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(2);
    expect(result.value.projects[0]!.name).toBe("alpha");
    expect(result.value.projects[1]!.name).toBe("beta");
  });

  it("includes rootDir itself if it has .rauf.json", () => {
    // Place a marker in the root directory itself
    fs.writeFileSync(path.join(tmpDir, ".rauf.json"), JSON.stringify(makeMarker()));
    createProject("child-project");

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // rootDir + child = 2 projects
    expect(result.value.projects).toHaveLength(2);
    // rootDir should be one of the discovered projects
    const rootProject = result.value.projects.find((p) => p.path === path.resolve(tmpDir));
    expect(rootProject).toBeDefined();
    expect(rootProject!.id).toBe(path.basename(tmpDir));
  });

  it("scans depth=1 only (does not recurse into grandchildren)", () => {
    // Create nested structure: tmpDir/parent/nested/
    const parentDir = path.join(tmpDir, "parent");
    fs.mkdirSync(parentDir, { recursive: true });
    // Put marker in nested dir (depth=2 from tmpDir)
    createProject("nested", makeMarker(), parentDir);

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // "parent" has no .rauf.json, "nested" is too deep
    expect(result.value.projects).toHaveLength(0);
  });

  it("excludes paths containing /artifacts/", () => {
    // Create artifacts directory (simulating ralph's own artifact templates)
    const artifactsDir = path.join(tmpDir, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, ".rauf.json"), JSON.stringify(makeMarker()));

    createProject("real-project");

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(1);
    expect(result.value.projects[0]!.name).toBe("real-project");
  });

  it("skips invalid .rauf.json with warning", () => {
    // Valid project
    createProject("good-project");

    // Project with invalid marker file
    const badDir = path.join(tmpDir, "bad-project");
    fs.mkdirSync(badDir);
    fs.writeFileSync(
      path.join(badDir, ".rauf.json"),
      JSON.stringify({ rauf: false, garbage: true }),
    );

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(1);
    expect(result.value.projects[0]!.name).toBe("good-project");
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]).toContain("bad-project");
  });

  it("skips .rauf.json with invalid JSON with warning", () => {
    const badDir = path.join(tmpDir, "corrupt");
    fs.mkdirSync(badDir);
    fs.writeFileSync(path.join(badDir, ".rauf.json"), "{ not valid json }}}");

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(0);
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]).toContain("corrupt");
  });

  it("separates ignored projects (ignoreInTool: true)", () => {
    createProject("active-project");
    createProject(
      "hidden-project",
      makeMarker({
        options: { ignoreInTool: true, gitignoreScripts: false, maxIterations: 20 },
      }),
    );

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(1);
    expect(result.value.projects[0]!.name).toBe("active-project");

    expect(result.value.ignored).toHaveLength(1);
    expect(result.value.ignored[0]!.name).toBe("hidden-project");
  });

  it("returns projects sorted by name (case-insensitive)", () => {
    createProject("Zulu");
    createProject("alpha");
    createProject("Mike");
    createProject("bravo");

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const names = result.value.projects.map((p) => p.name);
    expect(names).toEqual(["alpha", "bravo", "Mike", "Zulu"]);
  });

  it("sets correct id, path, and marker on discovered projects", () => {
    const marker = makeMarker();
    createProject("my-app", marker);

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const project = result.value.projects[0]!;
    expect(project.id).toBe("my-app");
    expect(project.path).toBe(path.join(tmpDir, "my-app"));
    expect(project.name).toBe("my-app");
    expect(project.marker.rauf).toBe(true);
    expect(project.marker.profile.stack).toBe("node-typescript");
  });

  it("returns error for non-existent root directory", () => {
    const result = discoverProjects(path.join(tmpDir, "does-not-exist"));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    expect(result.error.message).toContain("does not exist");
  });

  it("returns error when root path is a file, not a directory", () => {
    const filePath = path.join(tmpDir, "not-a-dir.txt");
    fs.writeFileSync(filePath, "hello");

    const result = discoverProjects(filePath);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    expect(result.error.message).toContain("not a directory");
  });

  it("ignores non-directory entries in root", () => {
    createProject("real-project");
    // Create a regular file at the root level (not a directory)
    fs.writeFileSync(path.join(tmpDir, "some-file.txt"), "data");

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(1);
    expect(result.value.projects[0]!.name).toBe("real-project");
  });

  it("handles mixed valid, invalid, and ignored projects", () => {
    createProject("active-a");
    createProject("active-b");
    createProject(
      "ignored-c",
      makeMarker({
        options: { ignoreInTool: true, gitignoreScripts: false, maxIterations: 20 },
      }),
    );
    // Invalid marker
    const badDir = path.join(tmpDir, "broken-d");
    fs.mkdirSync(badDir);
    fs.writeFileSync(path.join(badDir, ".rauf.json"), "{}");
    // No marker
    fs.mkdirSync(path.join(tmpDir, "empty-e"));

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(2);
    expect(result.value.ignored).toHaveLength(1);
    expect(result.value.warnings).toHaveLength(1);
  });

  it("warns about a legacy ralph project (no .rauf.json, has legacy .ralph.json)", () => {
    const legacyDir = path.join(tmpDir, "legacy-proj");
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(
      path.join(legacyDir, ".ralph.json"),
      JSON.stringify({ ralph: true, version: "0.1.0", variant: "backlog-json" }),
    );

    const result = discoverProjects(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projects).toHaveLength(0);
    expect(
      result.value.warnings.some(
        (w) => w.includes("Legacy ralph project") && w.includes("rauf migrate"),
      ),
    ).toBe(true);
  });
});
