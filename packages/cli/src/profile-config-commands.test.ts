// ─── Profile, Config, and Projects Command Handler Tests ──────────

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  handleProfileShow,
  handleProfileDetect,
  handleProfileSet,
  handleConfigList,
  handleConfigGet,
  handleConfigSet,
  handleProjectsList,
  handleProjectsStatus,
} from "./profile-config-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";
import ports from "../../../config/ports.json";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;
const TOOL_CONFIG_PATH = path.join(os.homedir(), ".rauf", "config.json");
let savedConfig: string | null = null;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-cli-profile-"));
  configureOutput({ noColor: true, quiet: true, json: false });

  // Save real tool config if it exists (to restore after test)
  try {
    savedConfig = fs.readFileSync(TOOL_CONFIG_PATH, "utf-8");
  } catch {
    savedConfig = null;
  }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Restore real tool config
  if (savedConfig !== null) {
    fs.mkdirSync(path.dirname(TOOL_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(TOOL_CONFIG_PATH, savedConfig, "utf-8");
  } else {
    try {
      fs.unlinkSync(TOOL_CONFIG_PATH);
    } catch {
      // ignore
    }
  }
});

/** Build a CommandContext for testing */
function makeCtx(
  args: string[],
  flags: Record<string, string | true> = {},
  globalFlags: Partial<{ json: boolean; quiet: boolean; noColor: boolean; root: string }> = {},
): CommandContext {
  return {
    args,
    flags: new Map(Object.entries(flags)),
    globalFlags: {
      json: globalFlags.json ?? false,
      quiet: globalFlags.quiet ?? true,
      noColor: globalFlags.noColor ?? true,
      root: globalFlags.root ?? null,
    },
    rawArgv: [],
  };
}

/** Capture stdout for testing */
function captureStdout(fn: () => Promise<void>): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };
    fn()
      .then(() => {
        process.stdout.write = orig;
        resolve(output);
      })
      .catch((e: unknown) => {
        process.stdout.write = orig;
        reject(e);
      });
  });
}

/** Create a minimal .rauf.json (marker file) in a project dir */
function createMarkerFile(projectDir: string, overrides: Record<string, unknown> = {}): void {
  const marker = {
    rauf: true,
    version: "1.0.0",
    variant: "backlog-json",
    installedAt: "2026-01-01T00:00:00Z",
    installedBy: "test",
    profile: {
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
    },
    artifactHashes: {},
    options: {
      ignoreInTool: false,
      gitignoreScripts: false,
      maxIterations: 20,
    },
    ...overrides,
  };
  fs.writeFileSync(path.join(projectDir, ".rauf.json"), JSON.stringify(marker, null, 2));
}

/** Write a test tool config */
function writeTestToolConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(TOOL_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(TOOL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── handleProfileShow ─────────────────────────────────────────────

describe("handleProfileShow", () => {
  it("returns INVALID_ARGS when path is missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleProfileShow(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns NOT_FOUND when .rauf.json does not exist", async () => {
    const projectDir = path.join(tmpDir, "no-marker");
    fs.mkdirSync(projectDir);
    const ctx = makeCtx([projectDir]);
    const code = await handleProfileShow(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("outputs JSON profile when --json flag is set", async () => {
    const projectDir = path.join(tmpDir, "project-a");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProfileShow(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("stack", "node-typescript");
    expect(parsed).toHaveProperty("packageManager", "pnpm");
    expect(parsed).toHaveProperty("monorepo", true);
    expect(parsed).toHaveProperty("commands");
    expect(parsed.commands).toHaveProperty("test", "pnpm test");
  });

  it("prints profile in human-readable format", async () => {
    const projectDir = path.join(tmpDir, "project-b");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const output = await captureStdout(async () => {
      configureOutput({ noColor: true, quiet: false, json: false });
      const ctx = makeCtx([projectDir], {}, { quiet: false });
      await handleProfileShow(ctx);
      configureOutput({ noColor: true, quiet: true, json: false });
    });

    expect(output).toContain("node-typescript");
    expect(output).toContain("pnpm");
    expect(output).toContain("pnpm test");
  });
});

// ─── handleProfileDetect ───────────────────────────────────────────

describe("handleProfileDetect", () => {
  it("returns INVALID_ARGS when path is missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleProfileDetect(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("detects profile from filesystem (node-typescript project)", async () => {
    const projectDir = path.join(tmpDir, "ts-project");
    fs.mkdirSync(projectDir);
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest", typecheck: "tsc --noEmit", lint: "eslint ." },
      }),
    );
    fs.writeFileSync(path.join(projectDir, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(projectDir, "pnpm-lock.yaml"), "");

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProfileDetect(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("stack", "node-typescript");
    expect(parsed).toHaveProperty("packageManager", "pnpm");
  });

  it("does NOT write to .rauf.json (read-only)", async () => {
    const projectDir = path.join(tmpDir, "readonly-project");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const markerBefore = fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8");
    const ctx = makeCtx([projectDir]);
    await handleProfileDetect(ctx);
    const markerAfter = fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8");

    expect(markerBefore).toBe(markerAfter);
  });
});

// ─── handleProfileSet ──────────────────────────────────────────────

describe("handleProfileSet", () => {
  it("returns INVALID_ARGS when arguments are missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns INVALID_ARGS for unknown key", async () => {
    const projectDir = path.join(tmpDir, "project-set");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);
    const ctx = makeCtx([projectDir, "unknownKey", "someValue"]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("updates a command key in the profile", async () => {
    const projectDir = path.join(tmpDir, "project-cmd");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const ctx = makeCtx([projectDir, "test", "bun test --run"]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const marker = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8"));
    expect(marker.profile.commands.test).toBe("bun test --run");
    expect(marker.profile.verify).toContain("bun test --run");
  });

  it("disables a command key when value is empty string", async () => {
    const projectDir = path.join(tmpDir, "project-disable");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const ctx = makeCtx([projectDir, "format", ""]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const marker = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8"));
    expect(marker.profile.commands.format).toBeNull();
  });

  it("updates the stack field", async () => {
    const projectDir = path.join(tmpDir, "project-stack");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const ctx = makeCtx([projectDir, "stack", "python"]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const marker = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8"));
    expect(marker.profile.stack).toBe("python");
  });

  it("updates the monorepo field", async () => {
    const projectDir = path.join(tmpDir, "project-mono");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const ctx = makeCtx([projectDir, "monorepo", "false"]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const marker = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8"));
    expect(marker.profile.monorepo).toBe(false);
  });

  it("returns INVALID_ARGS for invalid monorepo value", async () => {
    const projectDir = path.join(tmpDir, "project-mono-bad");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const ctx = makeCtx([projectDir, "monorepo", "yes"]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("outputs JSON with updated profile when --json flag is set", async () => {
    const projectDir = path.join(tmpDir, "project-json");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([projectDir, "lint", "eslint --fix ."], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProfileSet(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed.commands.lint).toBe("eslint --fix .");
  });

  it("rebuilds verify string after updating a command", async () => {
    const projectDir = path.join(tmpDir, "project-verify");
    fs.mkdirSync(projectDir);
    createMarkerFile(projectDir);

    const ctx = makeCtx([projectDir, "build", "bun build"]);
    await handleProfileSet(ctx);

    const marker = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8"));
    expect(marker.profile.verify).toContain("bun build");
  });

  it("returns NOT_FOUND when .rauf.json does not exist", async () => {
    const projectDir = path.join(tmpDir, "no-marker-set");
    fs.mkdirSync(projectDir);
    const ctx = makeCtx([projectDir, "stack", "go"]);
    const code = await handleProfileSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });
});

// ─── handleConfigList ──────────────────────────────────────────────

describe("handleConfigList", () => {
  it("outputs JSON config when --json flag is set", async () => {
    writeTestToolConfig({
      rootDirectory: "/home/test/projects",
      port: ports.serverPort,
      theme: "dark",
    });

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleConfigList(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("rootDirectory", "/home/test/projects");
    expect(parsed).toHaveProperty("port", ports.serverPort);
    expect(parsed).toHaveProperty("theme", "dark");
  });

  it("returns defaults when no config file exists", async () => {
    // Remove the config file for this test
    try {
      fs.unlinkSync(TOOL_CONFIG_PATH);
    } catch {
      /* ignore */
    }

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleConfigList(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    // Defaults include rootDirectory (cwd), port from ports.json, theme system
    expect(parsed).toHaveProperty("port", ports.serverPort);
    expect(parsed).toHaveProperty("theme", "system");
  });
});

// ─── handleConfigGet ───────────────────────────────────────────────

describe("handleConfigGet", () => {
  it("returns INVALID_ARGS when key is missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleConfigGet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns INVALID_ARGS for unknown key", async () => {
    const ctx = makeCtx(["unknownKey"]);
    const code = await handleConfigGet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("gets an existing config value", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: ports.serverPort, theme: "light" });

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx(["theme"], {}, { quiet: false });
    configureOutput({ noColor: true, quiet: false, json: false });
    const code = await handleConfigGet(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(output.trim()).toBe("light");
  });

  it("outputs JSON when --json flag is set", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: 5200, theme: "dark" });

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx(["port"], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleConfigGet(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("port", 5200);
  });
});

// ─── handleConfigSet ───────────────────────────────────────────────

describe("handleConfigSet", () => {
  it("returns INVALID_ARGS when arguments are missing", async () => {
    const ctx = makeCtx([]);
    const code = await handleConfigSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns INVALID_ARGS for unknown key", async () => {
    const ctx = makeCtx(["unknownKey", "value"]);
    const code = await handleConfigSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("sets the port (coerces string to number)", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: ports.serverPort, theme: "system" });

    const ctx = makeCtx(["port", "8080"]);
    const code = await handleConfigSet(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const stored = JSON.parse(fs.readFileSync(TOOL_CONFIG_PATH, "utf-8"));
    expect(stored.port).toBe(8080);
  });

  it("returns INVALID_ARGS for invalid port", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: ports.serverPort, theme: "system" });
    const ctx = makeCtx(["port", "not-a-number"]);
    const code = await handleConfigSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("sets the theme", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: ports.serverPort, theme: "system" });

    const ctx = makeCtx(["theme", "dark"]);
    const code = await handleConfigSet(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const stored = JSON.parse(fs.readFileSync(TOOL_CONFIG_PATH, "utf-8"));
    expect(stored.theme).toBe("dark");
  });

  it("returns INVALID_ARGS for invalid theme", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: ports.serverPort, theme: "system" });
    const ctx = makeCtx(["theme", "purple"]);
    const code = await handleConfigSet(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("sets rootDirectory (resolves to absolute path)", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: ports.serverPort, theme: "system" });

    const ctx = makeCtx(["rootDirectory", "/workspace/projects"]);
    const code = await handleConfigSet(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const stored = JSON.parse(fs.readFileSync(TOOL_CONFIG_PATH, "utf-8"));
    expect(stored.rootDirectory).toBe("/workspace/projects");
  });

  it("outputs JSON with updated config when --json flag is set", async () => {
    writeTestToolConfig({ rootDirectory: "/home/test", port: ports.serverPort, theme: "system" });

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx(["theme", "light"], {}, { json: true, quiet: false });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleConfigSet(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed.theme).toBe("light");
  });
});

// ─── handleProjectsList ────────────────────────────────────────────

describe("handleProjectsList", () => {
  it("returns SUCCESS with info when no projects found", async () => {
    const rootDir = path.join(tmpDir, "empty-root");
    fs.mkdirSync(rootDir);

    const ctx = makeCtx([], {}, { root: rootDir });
    const code = await handleProjectsList(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("lists discovered projects as JSON", async () => {
    const rootDir = path.join(tmpDir, "root-with-projects");
    const projectDir = path.join(rootDir, "my-project");
    fs.mkdirSync(projectDir, { recursive: true });
    createMarkerFile(projectDir);

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([], {}, { json: true, quiet: false, root: rootDir });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProjectsList(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("projects");
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0]).toHaveProperty("name", "my-project");
  });

  it("separates ignored projects from active projects", async () => {
    const rootDir = path.join(tmpDir, "root-ignored");
    const activeDir = path.join(rootDir, "active");
    const ignoredDir = path.join(rootDir, "ignored");
    fs.mkdirSync(activeDir, { recursive: true });
    fs.mkdirSync(ignoredDir, { recursive: true });

    createMarkerFile(activeDir);
    createMarkerFile(ignoredDir, {
      options: { ignoreInTool: true, gitignoreScripts: false, maxIterations: 20 },
    });

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([], {}, { json: true, quiet: false, root: rootDir });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProjectsList(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.ignored).toHaveLength(1);
    expect(parsed.projects[0].name).toBe("active");
    expect(parsed.ignored[0].name).toBe("ignored");
  });

  it("returns NOT_FOUND when root directory does not exist", async () => {
    const ctx = makeCtx([], {}, { root: "/nonexistent/path/that/does/not/exist" });
    const code = await handleProjectsList(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });
});

// ─── handleProjectsStatus ──────────────────────────────────────────

describe("handleProjectsStatus", () => {
  it("returns SUCCESS with info when no projects found", async () => {
    const rootDir = path.join(tmpDir, "empty-root-status");
    fs.mkdirSync(rootDir);

    const ctx = makeCtx([], {}, { root: rootDir });
    const code = await handleProjectsStatus(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("shows status for discovered projects as JSON", async () => {
    const rootDir = path.join(tmpDir, "root-status");
    const projectDir = path.join(rootDir, "project-x");
    fs.mkdirSync(projectDir, { recursive: true });
    createMarkerFile(projectDir);

    // Add a .rauf dir so deriveStatus can compute backlog summary
    const raufDir = path.join(projectDir, ".rauf");
    fs.mkdirSync(raufDir);
    fs.writeFileSync(
      path.join(raufDir, "backlog.json"),
      JSON.stringify({ project: "project-x", description: "desc", items: [] }),
    );

    let output = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string | Uint8Array) => {
      output += s.toString();
      return true;
    };

    const ctx = makeCtx([], {}, { json: true, quiet: false, root: rootDir });
    configureOutput({ noColor: true, quiet: false, json: true });
    const code = await handleProjectsStatus(ctx);

    process.stdout.write = orig;
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output) as Array<{
      name: string;
      status: { loopState: string } | null;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toHaveProperty("name", "project-x");
    expect(parsed[0]).toHaveProperty("status");
    expect(parsed[0]?.status).toHaveProperty("loopState");
  });

  it("returns NOT_FOUND when root directory does not exist", async () => {
    const ctx = makeCtx([], {}, { root: "/nonexistent/path/that/does/not/exist" });
    const code = await handleProjectsStatus(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });
});
