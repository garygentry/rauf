import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  install,
  update,
  uninstall,
  preflight,
  buildTemplateVars,
  isCommandInPath,
  threeWayCompare,
  SCRIPT_ARTIFACTS,
  DIR_FILES,
  DOT_RALPH,
  type InstallOptions,
  type UpdateOptions,
  type UninstallOptions,
} from "./installer.js";
import { readMarkerFile, MARKER_FILENAME } from "./config.js";
import { CLAUDE_MD_SENTINEL_START, CLAUDE_MD_SENTINEL_END } from "./claude-md.js";
import { computeHash, fileExists } from "./fs-utils.js";
import type { ProjectProfile } from "./schemas.js";

// ─── Test Fixtures ────────────────────────────────────────────────

/** Path to the real artifacts directory in this repo */
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  "../../../artifacts/variants/backlog-json",
);

let tmpDir: string;

/** Create a minimal fake project directory */
function createFakeProject(
  dir: string,
  opts: {
    git?: boolean;
    packageJson?: boolean;
    tsconfig?: boolean;
    pnpmLock?: boolean;
  } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });

  if (opts.git) {
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  }
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
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  }
}

/** Standard install options pointing to real artifacts */
function installOpts(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    artifactsDir: ARTIFACTS_DIR,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-installer-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── preflight ────────────────────────────────────────────────────

describe("preflight", () => {
  it("passes all checks for a valid git project", () => {
    createFakeProject(tmpDir, { git: true });

    const result = preflight(tmpDir);

    expect(result.passed).toBe(true);
    const dirCheck = result.checks.find((c) => c.name === "directory_exists");
    expect(dirCheck?.passed).toBe(true);
    const gitCheck = result.checks.find((c) => c.name === "git_repo");
    expect(gitCheck?.passed).toBe(true);
  });

  it("fails for non-existent directory", () => {
    const result = preflight(path.join(tmpDir, "nonexistent"));

    expect(result.passed).toBe(false);
    const dirCheck = result.checks.find((c) => c.name === "directory_exists");
    expect(dirCheck?.passed).toBe(false);
    expect(dirCheck?.severity).toBe("error");
  });

  it("warns when not a git repo", () => {
    createFakeProject(tmpDir); // No .git

    const result = preflight(tmpDir);

    const gitCheck = result.checks.find((c) => c.name === "git_repo");
    expect(gitCheck?.passed).toBe(false);
    expect(gitCheck?.severity).toBe("warning");
    // Warnings don't cause overall failure
    expect(result.passed).toBe(true);
  });

  it("fails when already installed", () => {
    createFakeProject(tmpDir, { git: true });
    // Create a .ralph.json to simulate existing installation
    fs.writeFileSync(
      path.join(tmpDir, MARKER_FILENAME),
      JSON.stringify({ ralph: true }),
    );

    const result = preflight(tmpDir);

    expect(result.passed).toBe(false);
    const installedCheck = result.checks.find(
      (c) => c.name === "not_already_installed",
    );
    expect(installedCheck?.passed).toBe(false);
  });

  it("returns 5 checks total", () => {
    createFakeProject(tmpDir, { git: true });
    const result = preflight(tmpDir);
    expect(result.checks).toHaveLength(5);
  });
});

// ─── install ──────────────────────────────────────────────────────

describe("install", () => {
  it("installs all artifacts into a fresh project", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    const result = install(tmpDir, installOpts({ projectName: "test-project" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report = result.value;
    expect(report.projectName).toBe("test-project");
    expect(report.projectPath).toBe(path.resolve(tmpDir));
    expect(report.profile.stack).toBe("node-typescript");
  });

  it("creates scripts with executable permissions", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    for (const script of SCRIPT_ARTIFACTS) {
      const scriptPath = path.join(tmpDir, script);
      expect(fileExists(scriptPath)).toBe(true);

      const stat = fs.statSync(scriptPath);
      // Check executable bit is set (owner execute)
      expect(stat.mode & 0o100).toBeTruthy();
    }
  });

  it("creates .ralph/ directory with RALPH.md, backlog.json, progress.md", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    expect(fileExists(path.join(tmpDir, ".ralph", "RALPH.md"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".ralph", "backlog.json"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".ralph", "progress.md"))).toBe(true);
  });

  it("renders RALPH.md with profile variables", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    install(tmpDir, installOpts());

    const ralphMd = fs.readFileSync(
      path.join(tmpDir, ".ralph", "RALPH.md"),
      "utf-8",
    );

    // Should contain rendered commands (not raw {{var}})
    expect(ralphMd).toContain("pnpm test");
    expect(ralphMd).not.toContain("{{testCommand}}");
  });

  it("creates CLAUDE.md with ralph section", () => {
    createFakeProject(tmpDir, { git: true });

    install(tmpDir, installOpts());

    const claudeMd = fs.readFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_END);
    expect(claudeMd).toContain("Autonomous Loop (Ralph)");
  });

  it("merges CLAUDE.md if it already exists", () => {
    createFakeProject(tmpDir, { git: true });
    const existingContent = "# My Project\n\nCustom content here.\n";
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), existingContent);

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    const claudeMd = fs.readFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(claudeMd).toContain("# My Project");
    expect(claudeMd).toContain("Custom content here.");
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);
  });

  it("writes .ralph.json marker file", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    const markerResult = readMarkerFile(tmpDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    expect(markerResult.value.ralph).toBe(true);
    expect(markerResult.value.version).toBe("1");
    expect(markerResult.value.variant).toBe("backlog-json");
    expect(markerResult.value.profile.stack).toBe("node-typescript");
  });

  it("stores artifact hashes in marker file", () => {
    createFakeProject(tmpDir, { git: true });

    install(tmpDir, installOpts());

    const markerResult = readMarkerFile(tmpDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    const hashes = markerResult.value.artifactHashes;
    // Should have hashes for scripts and RALPH.md
    expect(Object.keys(hashes).length).toBeGreaterThanOrEqual(4);
    expect(hashes["ralph.sh"]).toBeDefined();
    expect(hashes["RALPH.md"]).toBeDefined();
  });

  it("applies marker options defaults", () => {
    createFakeProject(tmpDir, { git: true });

    install(tmpDir, installOpts());

    const markerResult = readMarkerFile(tmpDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    expect(markerResult.value.options.ignoreInTool).toBe(false);
    expect(markerResult.value.options.gitignoreScripts).toBe(false);
    expect(markerResult.value.options.maxIterations).toBe(20);
  });

  it("applies custom marker options", () => {
    createFakeProject(tmpDir, { git: true });

    install(
      tmpDir,
      installOpts({
        options: { maxIterations: 10, ignoreInTool: true },
      }),
    );

    const markerResult = readMarkerFile(tmpDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    expect(markerResult.value.options.maxIterations).toBe(10);
    expect(markerResult.value.options.ignoreInTool).toBe(true);
  });

  it("applies profile overrides", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    const result = install(
      tmpDir,
      installOpts({
        profileOverrides: { test: "custom-test-cmd" },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.profile.commands.test).toBe("custom-test-cmd");
  });

  it("populates backlog.json with project name and description", () => {
    createFakeProject(tmpDir, { git: true });

    install(
      tmpDir,
      installOpts({
        projectName: "my-project",
        projectDescription: "A test project",
      }),
    );

    const backlogContent = fs.readFileSync(
      path.join(tmpDir, ".ralph", "backlog.json"),
      "utf-8",
    );
    const backlog = JSON.parse(backlogContent);
    expect(backlog.project).toBe("my-project");
    expect(backlog.description).toBe("A test project");
    expect(backlog.items).toEqual([]);
  });

  it("returns actions for each deployed artifact", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actionFiles = result.value.actions.map((a) => a.file);
    expect(actionFiles).toContain("ralph.sh");
    expect(actionFiles).toContain("ralph-status.sh");
    expect(actionFiles).toContain("ralph-add.sh");
    expect(actionFiles).toContain(".ralph/RALPH.md");
    expect(actionFiles).toContain(".ralph/backlog.json");
    expect(actionFiles).toContain(".ralph/progress.md");
    expect(actionFiles).toContain("CLAUDE.md");
    expect(actionFiles).toContain(MARKER_FILENAME);
  });

  it("returns warnings for missing git repo", () => {
    createFakeProject(tmpDir); // No .git

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.warnings.length).toBeGreaterThan(0);
    expect(result.value.warnings.some((w) => w.includes("git"))).toBe(true);
  });

  it("fails for non-existent project directory", () => {
    const result = install(
      path.join(tmpDir, "nonexistent"),
      installOpts(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_NOT_FOUND");
  });

  it("fails when artifacts directory is missing", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, {
      artifactsDir: path.join(tmpDir, "nonexistent-artifacts"),
    });

    expect(result.ok).toBe(false);
  });
});

// ─── install idempotency ──────────────────────────────────────────

describe("install — idempotency", () => {
  it("running install twice produces the same files", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true });

    // First install
    const r1 = install(tmpDir, installOpts({ projectName: "test" }));
    expect(r1.ok).toBe(true);

    // Capture state after first install
    const ralphMd1 = fs.readFileSync(
      path.join(tmpDir, ".ralph", "RALPH.md"),
      "utf-8",
    );
    const claudeMd1 = fs.readFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "utf-8",
    );

    // Second install (idempotent — already installed)
    const r2 = install(tmpDir, installOpts({ projectName: "test" }));
    expect(r2.ok).toBe(true);

    // Files should be identical
    const ralphMd2 = fs.readFileSync(
      path.join(tmpDir, ".ralph", "RALPH.md"),
      "utf-8",
    );
    const claudeMd2 = fs.readFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "utf-8",
    );

    expect(ralphMd2).toBe(ralphMd1);
    expect(claudeMd2).toBe(claudeMd1);
  });

  it("second install skips existing scripts with same content", () => {
    createFakeProject(tmpDir, { git: true });

    install(tmpDir, installOpts());

    const r2 = install(tmpDir, installOpts());
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    // Scripts should be skipped on second run
    const scriptActions = r2.value.actions.filter(
      (a) => SCRIPT_ARTIFACTS.includes(a.file),
    );
    for (const action of scriptActions) {
      expect(action.action).toBe("skipped");
    }
  });

  it("second install preserves existing backlog.json", () => {
    createFakeProject(tmpDir, { git: true });

    // First install creates empty backlog
    install(tmpDir, installOpts({ projectName: "orig" }));

    // Modify backlog to have content
    const backlogPath = path.join(tmpDir, ".ralph", "backlog.json");
    const modified = JSON.stringify(
      {
        project: "modified",
        description: "Modified after install",
        items: [],
      },
      null,
      2,
    );
    fs.writeFileSync(backlogPath, modified);

    // Second install should not overwrite
    const r2 = install(tmpDir, installOpts({ projectName: "new-name" }));
    expect(r2.ok).toBe(true);

    const backlog = JSON.parse(fs.readFileSync(backlogPath, "utf-8"));
    expect(backlog.project).toBe("modified"); // Not overwritten
  });
});

// ─── update ───────────────────────────────────────────────────────

describe("update", () => {
  it("fails when not installed", () => {
    createFakeProject(tmpDir, { git: true });

    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_INSTALLED");
  });

  it("succeeds when installed and nothing changed", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Scripts should be up_to_date (skipped)
    const scriptActions = result.value.actions.filter(
      (a) => SCRIPT_ARTIFACTS.includes(a.file),
    );
    for (const action of scriptActions) {
      expect(action.action).toBe("skipped");
    }
  });

  it("preserves backlog.json and progress.md during update", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const backlogAction = result.value.actions.find(
      (a) => a.file === ".ralph/backlog.json",
    );
    expect(backlogAction?.action).toBe("skipped");
    expect(backlogAction?.detail).toContain("preserved");

    const progressAction = result.value.actions.find(
      (a) => a.file === ".ralph/progress.md",
    );
    expect(progressAction?.action).toBe("skipped");
  });

  it("detects locally modified scripts and preserves them", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Modify a script locally
    const scriptPath = path.join(tmpDir, "ralph.sh");
    fs.writeFileSync(scriptPath, "#!/bin/bash\n# My custom script\n");
    fs.chmodSync(scriptPath, 0o755);

    // Update with same canonical (canonical unchanged, local modified)
    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ralphAction = result.value.actions.find(
      (a) => a.file === "ralph.sh",
    );
    expect(ralphAction?.action).toBe("skipped");
    expect(ralphAction?.detail).toContain("Local modifications preserved");

    // Script content should not be overwritten
    const content = fs.readFileSync(scriptPath, "utf-8");
    expect(content).toContain("# My custom script");
  });

  it("updates .ralph.json with new hashes", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const markerBefore = readMarkerFile(tmpDir);
    expect(markerBefore.ok).toBe(true);

    update(tmpDir, { artifactsDir: ARTIFACTS_DIR });

    const markerAfter = readMarkerFile(tmpDir);
    expect(markerAfter.ok).toBe(true);
    if (!markerAfter.ok) return;

    // Marker action should be present
    expect(
      markerAfter.value.installedBy.startsWith("ralph-manager@"),
    ).toBe(true);
  });

  it("returns InstallationReport with profile", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true });
    install(tmpDir, installOpts());

    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.profile).toBeDefined();
    expect(result.value.projectPath).toBe(path.resolve(tmpDir));
  });
});

// ─── uninstall ────────────────────────────────────────────────────

describe("uninstall", () => {
  it("fails when not installed", () => {
    createFakeProject(tmpDir, { git: true });

    const result = uninstall(tmpDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_INSTALLED");
  });

  it("removes scripts from project root", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Verify scripts exist
    for (const script of SCRIPT_ARTIFACTS) {
      expect(fileExists(path.join(tmpDir, script))).toBe(true);
    }

    const result = uninstall(tmpDir);
    expect(result.ok).toBe(true);

    // Scripts should be gone
    for (const script of SCRIPT_ARTIFACTS) {
      expect(fileExists(path.join(tmpDir, script))).toBe(false);
    }
  });

  it("removes .ralph.json marker file", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    expect(fileExists(path.join(tmpDir, MARKER_FILENAME))).toBe(true);

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, MARKER_FILENAME))).toBe(false);
  });

  it("removes RALPH.md", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    expect(fileExists(path.join(tmpDir, ".ralph", "RALPH.md"))).toBe(true);

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, ".ralph", "RALPH.md"))).toBe(false);
  });

  it("preserves backlog.json by default", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, ".ralph", "backlog.json"))).toBe(true);
  });

  it("preserves progress.md by default", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, ".ralph", "progress.md"))).toBe(true);
  });

  it("removes backlog.json when keepBacklog=false", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, { keepBacklog: false });

    expect(fileExists(path.join(tmpDir, ".ralph", "backlog.json"))).toBe(false);
  });

  it("removes progress.md when keepProgress=false", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, { keepProgress: false });

    expect(fileExists(path.join(tmpDir, ".ralph", "progress.md"))).toBe(false);
  });

  it("removes ralph section from CLAUDE.md", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Verify CLAUDE.md has ralph section
    const before = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(before).toContain(CLAUDE_MD_SENTINEL_START);

    uninstall(tmpDir);

    // CLAUDE.md was only the ralph section, so it should be removed entirely
    expect(fileExists(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
  });

  it("preserves non-ralph content in CLAUDE.md after uninstall", () => {
    createFakeProject(tmpDir, { git: true });

    // Create CLAUDE.md with existing content
    fs.writeFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "# My Project\n\nKeep this content.\n",
    );

    install(tmpDir, installOpts());
    uninstall(tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(content).toContain("# My Project");
    expect(content).toContain("Keep this content.");
    expect(content).not.toContain(CLAUDE_MD_SENTINEL_START);
  });

  it("preserves CLAUDE.md section when removeClaudeMdSection=false", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, { removeClaudeMdSection: false });

    const content = fs.readFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "utf-8",
    );
    expect(content).toContain(CLAUDE_MD_SENTINEL_START);
  });

  it("removes .ralph/ directory when empty", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, {
      keepBacklog: false,
      keepProgress: false,
      keepLog: false,
    });

    expect(fileExists(path.join(tmpDir, ".ralph"))).toBe(false);
  });

  it("keeps .ralph/ directory when files are preserved", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Default keeps backlog and progress
    uninstall(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, ".ralph"))).toBe(true);
  });
});

// ─── full lifecycle: install → update → uninstall ─────────────────

describe("full lifecycle", () => {
  it("install → update → uninstall works end-to-end", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    // Install
    const installResult = install(
      tmpDir,
      installOpts({ projectName: "lifecycle-test" }),
    );
    expect(installResult.ok).toBe(true);

    // Verify installation
    expect(fileExists(path.join(tmpDir, "ralph.sh"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".ralph.json"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".ralph", "RALPH.md"))).toBe(true);

    // Update
    const updateResult = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(updateResult.ok).toBe(true);

    // Verify still installed
    expect(fileExists(path.join(tmpDir, "ralph.sh"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".ralph.json"))).toBe(true);

    // Uninstall (keeping backlog)
    const uninstallResult = uninstall(tmpDir);
    expect(uninstallResult.ok).toBe(true);

    // Verify removed
    expect(fileExists(path.join(tmpDir, "ralph.sh"))).toBe(false);
    expect(fileExists(path.join(tmpDir, ".ralph.json"))).toBe(false);
    expect(fileExists(path.join(tmpDir, ".ralph", "RALPH.md"))).toBe(false);

    // Backlog preserved
    expect(fileExists(path.join(tmpDir, ".ralph", "backlog.json"))).toBe(true);
  });
});

// ─── buildTemplateVars ────────────────────────────────────────────

describe("buildTemplateVars", () => {
  it("maps profile commands to template variables", () => {
    const profile: ProjectProfile = {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: true,
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck",
        lint: "pnpm lint",
        build: "pnpm build",
        format: null,
      },
      verify: "pnpm test && pnpm typecheck && pnpm lint && pnpm build",
    };

    const vars = buildTemplateVars(profile);

    expect(vars.testCommand).toBe("pnpm test");
    expect(vars.typecheckCommand).toBe("pnpm typecheck");
    expect(vars.lintCommand).toBe("pnpm lint");
    expect(vars.buildCommand).toBe("pnpm build");
    expect(vars.formatCommand).toBeNull();
    expect(vars.verifyCommand).toBe(
      "pnpm test && pnpm typecheck && pnpm lint && pnpm build",
    );
    expect(vars.stackDescription).toBe("node-typescript");
  });
});

// ─── isCommandInPath ──────────────────────────────────────────────

describe("isCommandInPath", () => {
  it("finds common system commands", () => {
    // 'ls' should exist on any Unix system
    expect(isCommandInPath("ls")).toBe(true);
  });

  it("returns false for nonexistent commands", () => {
    expect(isCommandInPath("totally-nonexistent-command-xyz123")).toBe(false);
  });
});

// ─── threeWayCompare ──────────────────────────────────────────────

describe("threeWayCompare", () => {
  let fileA: string;
  let fileB: string;
  let fileC: string;

  beforeEach(() => {
    fileA = path.join(tmpDir, "fileA");
    fileB = path.join(tmpDir, "fileB");
    fileC = path.join(tmpDir, "fileC");
  });

  it("returns up_to_date when current matches canonical", () => {
    const content = "same content";
    fs.writeFileSync(fileA, content);
    fs.writeFileSync(fileB, content);

    const hashA = computeHash(fileA);
    expect(hashA.ok).toBe(true);
    if (!hashA.ok) return;

    const result = threeWayCompare(hashA.value, fileA, fileB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("up_to_date");
  });

  it("returns safe_update when current matches stored but canonical differs", () => {
    fs.writeFileSync(fileA, "original");
    fs.writeFileSync(fileB, "new version");

    const storedHash = computeHash(fileA);
    expect(storedHash.ok).toBe(true);
    if (!storedHash.ok) return;

    const result = threeWayCompare(storedHash.value, fileA, fileB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("safe_update");
  });

  it("returns local_only when stored matches canonical but current differs", () => {
    fs.writeFileSync(fileA, "locally modified");
    fs.writeFileSync(fileB, "canonical");

    const storedHash = computeHash(fileB);
    expect(storedHash.ok).toBe(true);
    if (!storedHash.ok) return;

    const result = threeWayCompare(storedHash.value, fileA, fileB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("local_only");
  });

  it("returns conflict when all three differ", () => {
    fs.writeFileSync(fileA, "current");
    fs.writeFileSync(fileB, "canonical");
    fs.writeFileSync(fileC, "stored-original");

    const storedHash = computeHash(fileC);
    expect(storedHash.ok).toBe(true);
    if (!storedHash.ok) return;

    const result = threeWayCompare(storedHash.value, fileA, fileB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("conflict");
  });

  it("returns safe_update when file does not exist locally", () => {
    fs.writeFileSync(fileB, "canonical");

    const result = threeWayCompare(undefined, fileA, fileB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("safe_update");
  });

  it("returns safe_update when no stored hash exists", () => {
    fs.writeFileSync(fileA, "current");
    fs.writeFileSync(fileB, "canonical");

    const result = threeWayCompare(undefined, fileA, fileB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("safe_update");
  });
});

// ─── edge cases ───────────────────────────────────────────────────

describe("edge cases", () => {
  it("install preserves existing valid backlog.json", () => {
    createFakeProject(tmpDir, { git: true });

    // Create a valid backlog before install
    const ralphDir = path.join(tmpDir, ".ralph");
    fs.mkdirSync(ralphDir, { recursive: true });
    fs.writeFileSync(
      path.join(ralphDir, "backlog.json"),
      JSON.stringify(
        { project: "existing", description: "Pre-existing", items: [] },
        null,
        2,
      ),
    );

    const result = install(tmpDir, installOpts({ projectName: "new-name" }));
    expect(result.ok).toBe(true);

    const backlog = JSON.parse(
      fs.readFileSync(path.join(ralphDir, "backlog.json"), "utf-8"),
    );
    expect(backlog.project).toBe("existing"); // Not overwritten
  });

  it("install preserves existing progress.md", () => {
    createFakeProject(tmpDir, { git: true });

    const ralphDir = path.join(tmpDir, ".ralph");
    fs.mkdirSync(ralphDir, { recursive: true });
    fs.writeFileSync(
      path.join(ralphDir, "progress.md"),
      "# Custom Progress\n\nMy learnings.",
    );

    install(tmpDir, installOpts());

    const content = fs.readFileSync(
      path.join(ralphDir, "progress.md"),
      "utf-8",
    );
    expect(content).toContain("# Custom Progress");
  });

  it("project name defaults to directory basename", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projectName).toBe(path.basename(tmpDir));
  });

  it("update after local script modification with canonical change reports conflict", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Modify a script locally
    const scriptPath = path.join(tmpDir, "ralph-status.sh");
    fs.writeFileSync(scriptPath, "#!/bin/bash\n# My custom status script\n");

    // Create a temp artifacts dir with a different canonical
    const altArtifacts = path.join(tmpDir, "alt-artifacts");
    fs.mkdirSync(altArtifacts, { recursive: true });
    fs.mkdirSync(path.join(altArtifacts, ".ralph"), { recursive: true });

    // Copy all artifacts but modify ralph-status.sh
    for (const file of fs.readdirSync(ARTIFACTS_DIR)) {
      const src = path.join(ARTIFACTS_DIR, file);
      const dest = path.join(altArtifacts, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      }
    }
    // Copy .ralph subdir
    for (const file of fs.readdirSync(path.join(ARTIFACTS_DIR, ".ralph"))) {
      fs.copyFileSync(
        path.join(ARTIFACTS_DIR, ".ralph", file),
        path.join(altArtifacts, ".ralph", file),
      );
    }

    // Now change the canonical version
    fs.writeFileSync(
      path.join(altArtifacts, "ralph-status.sh"),
      "#!/bin/bash\n# New canonical version\n",
    );

    const result = update(tmpDir, { artifactsDir: altArtifacts });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const statusAction = result.value.actions.find(
      (a) => a.file === "ralph-status.sh",
    );
    expect(statusAction?.action).toBe("skipped");
    expect(statusAction?.detail).toContain("Conflict");

    // Should have a warning about the conflict
    expect(
      result.value.warnings.some((w) => w.includes("ralph-status.sh")),
    ).toBe(true);
  });
});
