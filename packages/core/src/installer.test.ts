import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  install,
  update,
  checkDrift,
  uninstall,
  preflight,
  buildTemplateVars,
  isCommandInPath,
  RAUF_MD_MANAGED_START,
  RAUF_MD_MANAGED_END,
  RAUF_GITIGNORE_ENTRIES,
  type InstallOptions,
} from "./installer.js";
import { readMarkerFile, writeMarkerFile, MARKER_FILENAME } from "./config.js";
import { CLAUDE_MD_SENTINEL_START, CLAUDE_MD_SENTINEL_END } from "./claude-md.js";
import { fileExists } from "./fs-utils.js";
import type { ProjectProfile } from "./schemas.js";

// ─── Test Fixtures ────────────────────────────────────────────────

/** Path to the real artifacts directory in this repo */
const ARTIFACTS_DIR = path.resolve(__dirname, "../../../artifacts/variants/backlog-json");

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
    // Create a .rauf.json to simulate existing installation
    fs.writeFileSync(path.join(tmpDir, MARKER_FILENAME), JSON.stringify({ rauf: true }));

    const result = preflight(tmpDir);

    expect(result.passed).toBe(false);
    const installedCheck = result.checks.find((c) => c.name === "not_already_installed");
    expect(installedCheck?.passed).toBe(false);
  });

  it("returns 4 checks total", () => {
    createFakeProject(tmpDir, { git: true });
    const result = preflight(tmpDir);
    expect(result.checks).toHaveLength(4);
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

  it("does not deploy shell scripts", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    expect(fileExists(path.join(tmpDir, "ralph.sh"))).toBe(false);
    expect(fileExists(path.join(tmpDir, "ralph-add.sh"))).toBe(false);
    expect(fileExists(path.join(tmpDir, "ralph-status.sh"))).toBe(false);
  });

  it("creates .rauf/ directory with RAUF.md, backlog.json, progress.md", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    expect(fileExists(path.join(tmpDir, ".rauf", "RAUF.md"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".rauf", "backlog.json"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".rauf", "progress.md"))).toBe(true);
  });

  it("renders RAUF.md with profile variables", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    install(tmpDir, installOpts());

    const raufMd = fs.readFileSync(path.join(tmpDir, ".rauf", "RAUF.md"), "utf-8");

    // Should contain rendered commands (not raw {{var}})
    expect(raufMd).toContain("pnpm test");
    expect(raufMd).not.toContain("{{testCommand}}");
  });

  it("creates CLAUDE.md with ralph section", () => {
    createFakeProject(tmpDir, { git: true });

    install(tmpDir, installOpts());

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_END);
    expect(claudeMd).toContain("Autonomous Loop (Rauf)");
  });

  it("merges CLAUDE.md if it already exists", () => {
    createFakeProject(tmpDir, { git: true });
    const existingContent = "# My Project\n\nCustom content here.\n";
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), existingContent);

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    const claudeMd = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("# My Project");
    expect(claudeMd).toContain("Custom content here.");
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);
  });

  it("creates AGENTS.md with the cross-agent rauf section", () => {
    createFakeProject(tmpDir, { git: true });

    install(tmpDir, installOpts());

    const agentsMd = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("<!-- rauf:agents:start -->");
    expect(agentsMd).toContain("<!-- rauf:agents:end -->");
    expect(agentsMd).toContain("Autonomous Loop (Rauf)");
    // Cross-agent file must NOT carry the Claude-only Task-tool guidance.
    expect(agentsMd).not.toMatch(/Task tool/i);
  });

  it("merges AGENTS.md if it already exists, preserving user content", () => {
    createFakeProject(tmpDir, { git: true });
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# My Project\n\nExisting AGENTS notes.\n");

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    const agentsMd = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("Existing AGENTS notes.");
    expect(agentsMd).toContain("<!-- rauf:agents:start -->");
  });

  it("reinstall leaves AGENTS.md byte-identical (idempotent skip)", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());
    const first = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    install(tmpDir, installOpts());
    const second = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(second).toBe(first);
  });

  it("writes .rauf.json marker file", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);

    const markerResult = readMarkerFile(tmpDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    expect(markerResult.value.rauf).toBe(true);
    expect(markerResult.value.version).toBe("1");
    expect(markerResult.value.variant).toBe("backlog-json");
    expect(markerResult.value.profile.stack).toBe("node-typescript");
  });

  it("stores artifact hashes in marker file (RAUF.md only, no scripts)", () => {
    createFakeProject(tmpDir, { git: true });

    install(tmpDir, installOpts());

    const markerResult = readMarkerFile(tmpDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    const hashes = markerResult.value.artifactHashes;
    expect(hashes["RAUF.md"]).toBeDefined();
    // No script hashes
    expect(hashes["ralph.sh"]).toBeUndefined();
    expect(hashes["ralph-status.sh"]).toBeUndefined();
    expect(hashes["ralph-add.sh"]).toBeUndefined();
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

    const backlogContent = fs.readFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "utf-8");
    const backlog = JSON.parse(backlogContent);
    expect(backlog.project).toBe("my-project");
    expect(backlog.description).toBe("A test project");
    expect(backlog.items).toEqual([]);
  });

  it("returns actions for each deployed artifact (no scripts)", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actionFiles = result.value.actions.map((a) => a.file);
    // No script actions
    expect(actionFiles).not.toContain("ralph.sh");
    expect(actionFiles).not.toContain("ralph-status.sh");
    expect(actionFiles).not.toContain("ralph-add.sh");
    // Data file actions
    expect(actionFiles).toContain(".rauf/RAUF.md");
    expect(actionFiles).toContain(".rauf/backlog.json");
    expect(actionFiles).toContain(".rauf/progress.md");
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
    const result = install(path.join(tmpDir, "nonexistent"), installOpts());

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
    const raufMd1 = fs.readFileSync(path.join(tmpDir, ".rauf", "RAUF.md"), "utf-8");
    const claudeMd1 = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");

    // Second install (idempotent — already installed)
    const r2 = install(tmpDir, installOpts({ projectName: "test" }));
    expect(r2.ok).toBe(true);

    // Files should be identical
    const raufMd2 = fs.readFileSync(path.join(tmpDir, ".rauf", "RAUF.md"), "utf-8");
    const claudeMd2 = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");

    expect(raufMd2).toBe(raufMd1);
    expect(claudeMd2).toBe(claudeMd1);
  });

  it("reinstall preserves provider/providerConfig and other marker options", () => {
    createFakeProject(tmpDir, { git: true });

    // First install.
    install(tmpDir, installOpts({ projectName: "orig" }));

    // Simulate a project configured to default to a non-Claude agent by hand-editing the marker
    // (as a user or feature-forge installer would persist provider config).
    const markerPath = path.join(tmpDir, ".rauf.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
    marker.options.provider = "codex";
    marker.options.providerConfig = { binary: "codex", promptDelivery: "arg" };
    marker.options.model = "gpt-5";
    marker.options.runtime = "global";
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));

    // Reinstall (idempotent path).
    const r2 = install(tmpDir, installOpts({ projectName: "orig" }));
    expect(r2.ok).toBe(true);

    const markerResult = readMarkerFile(tmpDir);
    expect(markerResult.ok).toBe(true);
    if (!markerResult.ok) return;

    // Cross-agent config must survive reinstall, not silently revert to the Claude default.
    expect(markerResult.value.options.provider).toBe("codex");
    expect(markerResult.value.options.providerConfig).toEqual({
      binary: "codex",
      promptDelivery: "arg",
    });
    expect(markerResult.value.options.model).toBe("gpt-5");
    expect(markerResult.value.options.runtime).toBe("global");
  });

  it("second install preserves existing backlog.json", () => {
    createFakeProject(tmpDir, { git: true });

    // First install creates empty backlog
    install(tmpDir, installOpts({ projectName: "orig" }));

    // Modify backlog to have content
    const backlogPath = path.join(tmpDir, ".rauf", "backlog.json");
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

    // No script actions at all
    const actionFiles = result.value.actions.map((a) => a.file);
    expect(actionFiles).not.toContain("ralph.sh");
    expect(actionFiles).not.toContain("ralph-status.sh");
    expect(actionFiles).not.toContain("ralph-add.sh");
  });

  it("preserves backlog.json and progress.md during update", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const backlogAction = result.value.actions.find((a) => a.file === ".rauf/backlog.json");
    expect(backlogAction?.action).toBe("skipped");
    expect(backlogAction?.detail).toContain("preserved");

    const progressAction = result.value.actions.find((a) => a.file === ".rauf/progress.md");
    expect(progressAction?.action).toBe("skipped");
  });

  it("updates .rauf.json with new hashes", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const markerBefore = readMarkerFile(tmpDir);
    expect(markerBefore.ok).toBe(true);

    update(tmpDir, { artifactsDir: ARTIFACTS_DIR });

    const markerAfter = readMarkerFile(tmpDir);
    expect(markerAfter.ok).toBe(true);
    if (!markerAfter.ok) return;

    // Marker action should be present
    expect(markerAfter.value.installedBy.startsWith("rauf-manager@")).toBe(true);
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

  it("prunes stale artifact-hash keys (e.g. legacy ralph.sh) from the marker", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Simulate a pre-rename install whose marker carried legacy script hashes.
    const before = readMarkerFile(tmpDir);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    writeMarkerFile(tmpDir, {
      ...before.value,
      artifactHashes: {
        ...before.value.artifactHashes,
        "ralph.sh": "deadbeef",
        "ralph-status.sh": "stalekey",
      },
    });

    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);

    const after = readMarkerFile(tmpDir);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.artifactHashes["ralph.sh"]).toBeUndefined();
    expect(after.value.artifactHashes["ralph-status.sh"]).toBeUndefined();
    expect(after.value.artifactHashes["RAUF.md"]).toBeDefined();

    // The marker action reports what was pruned.
    if (!result.ok) return;
    const markerAction = result.value.actions.find((a) => a.file === MARKER_FILENAME);
    expect(markerAction?.detail).toContain("pruned 2 stale key(s)");
  });
});

// ─── checkDrift ───────────────────────────────────────────────────

describe("checkDrift", () => {
  it("fails when not installed", () => {
    createFakeProject(tmpDir, { git: true });

    const result = checkDrift(tmpDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_INSTALLED");
  });

  it("reports not-stale immediately after install", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const result = checkDrift(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.stale).toBe(false);
    expect(result.value.toolVersionStale).toBe(false);
    expect(result.value.deadHashKeys).toEqual([]);
  });

  it("flags tool-version drift from an older installedBy", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const before = readMarkerFile(tmpDir);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    writeMarkerFile(tmpDir, { ...before.value, installedBy: "rauf-manager@0.1.0" });

    const result = checkDrift(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.stale).toBe(true);
    expect(result.value.toolVersionStale).toBe(true);
    expect(result.value.installedBy).toBe("rauf-manager@0.1.0");
    expect(result.value.currentInstalledBy.startsWith("rauf-manager@")).toBe(true);
  });

  it("flags dead artifact-hash keys", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const before = readMarkerFile(tmpDir);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    writeMarkerFile(tmpDir, {
      ...before.value,
      artifactHashes: { ...before.value.artifactHashes, "ralph.sh": "deadbeef" },
    });

    const result = checkDrift(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.stale).toBe(true);
    expect(result.value.deadHashKeys).toContain("ralph.sh");
  });

  it("reports not-stale after update heals a drifted marker", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const before = readMarkerFile(tmpDir);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    writeMarkerFile(tmpDir, {
      ...before.value,
      installedBy: "rauf-manager@0.1.0",
      artifactHashes: { ...before.value.artifactHashes, "ralph.sh": "deadbeef" },
    });

    update(tmpDir, { artifactsDir: ARTIFACTS_DIR });

    const result = checkDrift(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stale).toBe(false);
  });
});

// ─── update — RAUF.md sentinel preservation ──────────────────────

describe("update — RAUF.md sentinel preservation", () => {
  it("preserves project-specific content below managed section", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });
    install(tmpDir, installOpts());

    // Add custom content to the project-specific section
    const raufMdPath = path.join(tmpDir, ".rauf", "RAUF.md");
    const original = fs.readFileSync(raufMdPath, "utf-8");
    const customContent =
      original +
      "\n- Always run database migrations before tests\n- Use factory functions from tests/helpers/\n";
    fs.writeFileSync(raufMdPath, customContent);

    // Run update
    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);

    const updated = fs.readFileSync(raufMdPath, "utf-8");
    // Custom content should survive
    expect(updated).toContain("Always run database migrations before tests");
    expect(updated).toContain("Use factory functions from tests/helpers/");
    // Managed section should still be present
    expect(updated).toContain(RAUF_MD_MANAGED_START);
    expect(updated).toContain(RAUF_MD_MANAGED_END);
    expect(updated).toContain("pnpm test");
  });

  it("updates the managed verification commands section", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });
    install(tmpDir, installOpts());

    // Manually alter the managed section to simulate stale commands
    const raufMdPath = path.join(tmpDir, ".rauf", "RAUF.md");
    let content = fs.readFileSync(raufMdPath, "utf-8");
    content = content.replace("pnpm test", "OLD_TEST_COMMAND");
    fs.writeFileSync(raufMdPath, content);

    // Run update — should restore correct commands
    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raufMdAction = result.value.actions.find((a) => a.file === ".rauf/RAUF.md");
    expect(raufMdAction?.action).toBe("updated");

    const updated = fs.readFileSync(raufMdPath, "utf-8");
    expect(updated).toContain("pnpm test");
    expect(updated).not.toContain("OLD_TEST_COMMAND");
  });

  it("handles RAUF.md without managed sentinels (legacy) by full overwrite", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });
    install(tmpDir, installOpts());

    // Strip sentinels to simulate a legacy file
    const raufMdPath = path.join(tmpDir, ".rauf", "RAUF.md");
    const content = fs.readFileSync(raufMdPath, "utf-8");
    const legacy = content.replace(RAUF_MD_MANAGED_START, "").replace(RAUF_MD_MANAGED_END, "");
    fs.writeFileSync(raufMdPath, legacy);

    // Update should fall back to full overwrite
    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);

    const updated = fs.readFileSync(raufMdPath, "utf-8");
    // Should have sentinels back from full template render
    expect(updated).toContain(RAUF_MD_MANAGED_START);
    expect(updated).toContain(RAUF_MD_MANAGED_END);
  });

  it("reports skipped when RAUF.md managed section is already up to date", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });
    install(tmpDir, installOpts());

    // Update with no changes — should report skipped
    const result = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raufMdAction = result.value.actions.find((a) => a.file === ".rauf/RAUF.md");
    expect(raufMdAction?.action).toBe("skipped");
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

  it("removes .rauf.json marker file", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    expect(fileExists(path.join(tmpDir, MARKER_FILENAME))).toBe(true);

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, MARKER_FILENAME))).toBe(false);
  });

  it("removes RAUF.md", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    expect(fileExists(path.join(tmpDir, ".rauf", "RAUF.md"))).toBe(true);

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, ".rauf", "RAUF.md"))).toBe(false);
  });

  it("preserves backlog.json by default", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, ".rauf", "backlog.json"))).toBe(true);
  });

  it("preserves progress.md by default", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, ".rauf", "progress.md"))).toBe(true);
  });

  it("removes backlog.json when keepBacklog=false", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, { keepBacklog: false });

    expect(fileExists(path.join(tmpDir, ".rauf", "backlog.json"))).toBe(false);
  });

  it("removes progress.md when keepProgress=false", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, { keepProgress: false });

    expect(fileExists(path.join(tmpDir, ".rauf", "progress.md"))).toBe(false);
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
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# My Project\n\nKeep this content.\n");

    install(tmpDir, installOpts());
    uninstall(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("# My Project");
    expect(content).toContain("Keep this content.");
    expect(content).not.toContain(CLAUDE_MD_SENTINEL_START);
  });

  it("preserves CLAUDE.md section when removeClaudeMdSection=false", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, { removeClaudeMdSection: false });

    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain(CLAUDE_MD_SENTINEL_START);
  });

  it("removes the cross-agent section from AGENTS.md (deletes file when only the block remained)", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());
    expect(fileExists(path.join(tmpDir, "AGENTS.md"))).toBe(true);

    uninstall(tmpDir);

    expect(fileExists(path.join(tmpDir, "AGENTS.md"))).toBe(false);
  });

  it("preserves non-rauf content in AGENTS.md after uninstall", () => {
    createFakeProject(tmpDir, { git: true });
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# My Project\n\nKeep this AGENTS content.\n");

    install(tmpDir, installOpts());
    uninstall(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Keep this AGENTS content.");
    expect(content).not.toContain("<!-- rauf:agents:start -->");
  });

  it("preserves AGENTS.md section when removeAgentsMdSection=false", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, { removeAgentsMdSection: false });

    const content = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("<!-- rauf:agents:start -->");
  });

  it("removes .rauf/ directory when empty", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    uninstall(tmpDir, {
      keepBacklog: false,
      keepProgress: false,
      keepLog: false,
    });

    expect(fileExists(path.join(tmpDir, ".rauf"))).toBe(false);
  });

  it("keeps .rauf/ directory when files are preserved", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Default keeps backlog and progress
    uninstall(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, ".rauf"))).toBe(true);
  });
});

// ─── full lifecycle: install → update → uninstall ─────────────────

describe("full lifecycle", () => {
  it("install → update → uninstall works end-to-end", () => {
    createFakeProject(tmpDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    const installResult = install(tmpDir, installOpts({ projectName: "lifecycle-test" }));
    expect(installResult.ok).toBe(true);

    // Verify installation — no scripts, data files present
    expect(fileExists(path.join(tmpDir, "ralph.sh"))).toBe(false);
    expect(fileExists(path.join(tmpDir, ".rauf.json"))).toBe(true);
    expect(fileExists(path.join(tmpDir, ".rauf", "RAUF.md"))).toBe(true);

    // Update
    const updateResult = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(updateResult.ok).toBe(true);

    // Verify still installed
    expect(fileExists(path.join(tmpDir, ".rauf.json"))).toBe(true);

    // Uninstall (keeping backlog)
    const uninstallResult = uninstall(tmpDir);
    expect(uninstallResult.ok).toBe(true);

    // Verify removed
    expect(fileExists(path.join(tmpDir, ".rauf.json"))).toBe(false);
    expect(fileExists(path.join(tmpDir, ".rauf", "RAUF.md"))).toBe(false);

    // Backlog preserved
    expect(fileExists(path.join(tmpDir, ".rauf", "backlog.json"))).toBe(true);
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
    expect(vars.verifyCommand).toBe("pnpm test && pnpm typecheck && pnpm lint && pnpm build");
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

// ─── edge cases ───────────────────────────────────────────────────

describe("edge cases", () => {
  it("install preserves existing valid backlog.json", () => {
    createFakeProject(tmpDir, { git: true });

    // Create a valid backlog before install
    const raufDir = path.join(tmpDir, ".rauf");
    fs.mkdirSync(raufDir, { recursive: true });
    fs.writeFileSync(
      path.join(raufDir, "backlog.json"),
      JSON.stringify({ project: "existing", description: "Pre-existing", items: [] }, null, 2),
    );

    const result = install(tmpDir, installOpts({ projectName: "new-name" }));
    expect(result.ok).toBe(true);

    const backlog = JSON.parse(fs.readFileSync(path.join(raufDir, "backlog.json"), "utf-8"));
    expect(backlog.project).toBe("existing"); // Not overwritten
  });

  it("install preserves existing progress.md", () => {
    createFakeProject(tmpDir, { git: true });

    const raufDir = path.join(tmpDir, ".rauf");
    fs.mkdirSync(raufDir, { recursive: true });
    fs.writeFileSync(path.join(raufDir, "progress.md"), "# Custom Progress\n\nMy learnings.");

    install(tmpDir, installOpts());

    const content = fs.readFileSync(path.join(raufDir, "progress.md"), "utf-8");
    expect(content).toContain("# Custom Progress");
  });

  it("project name defaults to directory basename", () => {
    createFakeProject(tmpDir, { git: true });

    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.projectName).toBe(path.basename(tmpDir));
  });
});

// ─── preflight checks (updated) ────────────────────────────────────────

describe("preflight — no jq check", () => {
  it("returns 4 checks total (no jq check)", () => {
    createFakeProject(tmpDir, { git: true });
    const result = preflight(tmpDir);
    expect(result.checks).toHaveLength(4);
    expect(result.checks.find((c) => c.name === "jq_available")).toBeUndefined();
  });
});

// ─── .gitignore deployment ────────────────────────────────────────

describe("install — .gitignore entries", () => {
  it("creates .gitignore with all rauf runtime entries", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    for (const entry of RAUF_GITIGNORE_ENTRIES) {
      expect(gitignore).toContain(entry);
    }
  });

  // REQ-COMMIT-02 / item 014: events.ndjson is a runtime file the runner writes
  // mid-run and excludes from per-item commits (RUNTIME_EXCLUDE_PATHSPECS). The
  // installer's .gitignore list MUST cover it too, or an existing install whose
  // .gitignore predates the event log would track it. Keep in sync with
  // packages/loop/src/git-commit.ts RUNTIME_EXCLUDE_PATHSPECS.
  it("ignores .rauf/events.ndjson (runner-written, never tracked)", () => {
    expect(RAUF_GITIGNORE_ENTRIES).toContain("**/.rauf/events.ndjson");
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());
    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("**/.rauf/events.ndjson");
  });

  it("appends entries to an existing .gitignore without touching other lines", () => {
    createFakeProject(tmpDir, { git: true });
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\ndist/\n");
    install(tmpDir, installOpts());

    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("dist/");
    expect(gitignore).toContain("**/.rauf/.loop.lock");
  });

  it("does not duplicate entries already present in .gitignore", () => {
    createFakeProject(tmpDir, { git: true });
    const preExisting = RAUF_GITIGNORE_ENTRIES.join("\n") + "\n";
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), preExisting);

    install(tmpDir, installOpts());

    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    const lockCount = (gitignore.match(/\*\*\/\.rauf\/\.loop\.lock/g) ?? []).length;
    expect(lockCount).toBe(1);
  });

  it("includes .gitignore in the install actions report", () => {
    createFakeProject(tmpDir, { git: true });
    const result = install(tmpDir, installOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actionFiles = result.value.actions.map((a) => a.file);
    expect(actionFiles).toContain(".gitignore");
  });

  it("second install does not duplicate .gitignore entries (idempotent)", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());
    install(tmpDir, installOpts());

    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    const lockCount = (gitignore.match(/\*\*\/\.rauf\/\.loop\.lock/g) ?? []).length;
    expect(lockCount).toBe(1);
  });

  it("update backfills .gitignore entries for older installs", () => {
    createFakeProject(tmpDir, { git: true });
    install(tmpDir, installOpts());

    // Simulate an older install that left no .gitignore
    fs.unlinkSync(path.join(tmpDir, ".gitignore"));

    const updateResult = update(tmpDir, { artifactsDir: ARTIFACTS_DIR });
    expect(updateResult.ok).toBe(true);

    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("**/.rauf/.loop.lock");
  });
});
