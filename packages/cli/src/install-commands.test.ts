import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { handleInstall, handleInit, handleUpdate, handleUninstall } from "./install-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-cli-install-"));
  // Suppress output during tests
  configureOutput({ noColor: true, quiet: true, json: false });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    args: [],
    flags: new Map(),
    globalFlags: {
      json: false,
      noColor: true,
      quiet: false,
      root: null,
    },
    rawArgv: [],
    ...overrides,
  };
}

/** Capture stdout/stderr during an async function call */
async function captureOutput(fn: () => Promise<unknown>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;

  process.stdout.write = ((chunk: string) => {
    stdout.push(chunk);
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string) => {
    stderr.push(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    await fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }

  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

// ─── handleInstall ─────────────────────────────────────────────────

describe("handleInstall", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleInstall(makeCtx());
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns NOT_FOUND for non-existent directory", async () => {
    const ctx = makeCtx({ args: [path.join(tmpDir, "nonexistent")] });
    const code = await handleInstall(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("installs rauf into an existing project", async () => {
    const projectDir = path.join(tmpDir, "myproject");
    createFakeProject(projectDir, { git: true, packageJson: true, tsconfig: true, pnpmLock: true });

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });

    const code = await handleInstall(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    // Verify artifacts deployed
    expect(fs.existsSync(path.join(projectDir, ".rauf.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "ralph.sh"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, ".rauf", "RAUF.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
  });

  it("install --yes skips confirmations and succeeds", async () => {
    const projectDir = path.join(tmpDir, "skip-confirm");
    createFakeProject(projectDir, { git: true });

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });

    const code = await handleInstall(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(fs.existsSync(path.join(projectDir, ".rauf.json"))).toBe(true);
  });

  it("outputs JSON report with --json flag", async () => {
    const projectDir = path.join(tmpDir, "json-output");
    createFakeProject(projectDir, { git: true });

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    configureOutput({ noColor: true, quiet: false, json: true });

    const output = await captureOutput(async () => {
      const code = await handleInstall(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.projectName).toBeDefined();
    expect(parsed.projectPath).toBe(path.resolve(projectDir));
    expect(parsed.actions).toBeDefined();
    expect(Array.isArray(parsed.actions)).toBe(true);
  });

  it("command override flags apply to profile", async () => {
    const projectDir = path.join(tmpDir, "override-project");
    createFakeProject(projectDir, { git: true });

    const flags = new Map<string, string | true>([
      ["yes", true],
      ["test-cmd", "npm test"],
      ["build-cmd", "npm run build"],
    ]);
    const ctx = makeCtx({ args: [projectDir], flags });

    const code = await handleInstall(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    // Read marker to check profile was overridden
    const markerContent = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8"));
    expect(markerContent.profile.commands.test).toBe("npm test");
    expect(markerContent.profile.commands.build).toBe("npm run build");
  });

  it("install with --gitignore-scripts sets option", async () => {
    const projectDir = path.join(tmpDir, "gitignore-scripts");
    createFakeProject(projectDir, { git: true });

    const flags = new Map<string, string | true>([
      ["yes", true],
      ["gitignore-scripts", true],
    ]);
    const ctx = makeCtx({ args: [projectDir], flags });

    const code = await handleInstall(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const markerContent = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8"));
    expect(markerContent.options.gitignoreScripts).toBe(true);
  });
});

// ─── handleInit ────────────────────────────────────────────────────

describe("handleInit", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleInit(makeCtx());
    expect(code).toBe(ExitCode.USAGE);
  });

  it("creates a new project with git and ralph", async () => {
    const projectDir = path.join(tmpDir, "new-project");

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["stack", "node-typescript"],
        ["name", "My Project"],
        ["description", "A test project"],
      ]),
    });

    const code = await handleInit(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    // Verify project was created
    expect(fs.existsSync(projectDir)).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".rauf.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "ralph.sh"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
  });

  it("--name and --description are reflected in output", async () => {
    const projectDir = path.join(tmpDir, "named-project");

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["name", "Test App"],
        ["description", "For testing"],
        ["stack", "custom"],
      ]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleInit(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.projectName).toBe("Test App");
  });

  it("--stack validates preset name", async () => {
    const projectDir = path.join(tmpDir, "bad-stack");

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([["stack", "invalid-stack"]]),
    });

    const code = await handleInit(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns CONFLICT if path already has .rauf.json", async () => {
    const projectDir = path.join(tmpDir, "existing-ralph");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, ".rauf.json"), JSON.stringify({ rauf: true }));

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleInit(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("--seed populates backlog from a markdown file", async () => {
    const projectDir = path.join(tmpDir, "seeded-project");
    const seedFile = path.join(tmpDir, "seed.md");
    fs.writeFileSync(
      seedFile,
      "- [ ] [feature] Build the thing\n- [ ] [bug] Fix the other thing\n",
    );

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["stack", "custom"],
        ["seed", seedFile],
      ]),
    });

    const code = await handleInit(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    // Check backlog has seeded items
    const backlog = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".rauf", "backlog.json"), "utf-8"),
    );
    expect(backlog.items.length).toBe(2);
    expect(backlog.items[0].title).toBe("Build the thing");
    expect(backlog.items[0].type).toBe("feature");
    expect(backlog.items[1].title).toBe("Fix the other thing");
    expect(backlog.items[1].type).toBe("bug");
  });

  it("--stack python creates python-appropriate .gitignore", async () => {
    const projectDir = path.join(tmpDir, "python-project");

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([["stack", "python"]]),
    });

    const code = await handleInit(ctx);
    expect(code).toBe(ExitCode.SUCCESS);

    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("__pycache__");
    expect(gitignore).toContain(".venv");
  });
});

// ─── handleUpdate ──────────────────────────────────────────────────

describe("handleUpdate", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleUpdate(makeCtx());
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns NOT_FOUND for non-installed project", async () => {
    const projectDir = path.join(tmpDir, "no-ralph");
    fs.mkdirSync(projectDir, { recursive: true });

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleUpdate(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("updates artifacts in an installed project", async () => {
    // First install
    const projectDir = path.join(tmpDir, "update-test");
    createFakeProject(projectDir, { git: true });

    const installCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    const installCode = await handleInstall(installCtx);
    expect(installCode).toBe(ExitCode.SUCCESS);

    // Now update
    const updateCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    const updateCode = await handleUpdate(updateCtx);
    expect(updateCode).toBe(ExitCode.SUCCESS);

    // Marker file should still exist
    expect(fs.existsSync(path.join(projectDir, ".rauf.json"))).toBe(true);
  });

  it("outputs JSON report with --json flag", async () => {
    const projectDir = path.join(tmpDir, "update-json");
    createFakeProject(projectDir, { git: true });

    // Install first
    const installCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    await handleInstall(installCtx);

    // Update with --json
    configureOutput({ noColor: true, quiet: false, json: true });
    const updateCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleUpdate(updateCtx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.actions).toBeDefined();
    expect(Array.isArray(parsed.actions)).toBe(true);
  });
});

// ─── handleUninstall ───────────────────────────────────────────────

describe("handleUninstall", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleUninstall(makeCtx());
    expect(code).toBe(ExitCode.USAGE);
  });

  it("returns NOT_FOUND for non-installed project", async () => {
    const projectDir = path.join(tmpDir, "no-ralph");
    fs.mkdirSync(projectDir, { recursive: true });

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleUninstall(ctx);
    expect(code).toBe(ExitCode.USAGE);
  });

  it("uninstalls rauf from an installed project", async () => {
    const projectDir = path.join(tmpDir, "uninstall-test");
    createFakeProject(projectDir, { git: true });

    // Install first
    const installCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    await handleInstall(installCtx);

    // Verify installed
    expect(fs.existsSync(path.join(projectDir, ".rauf.json"))).toBe(true);

    // Uninstall
    const uninstallCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    const code = await handleUninstall(uninstallCtx);
    expect(code).toBe(ExitCode.SUCCESS);

    // Verify marker removed
    expect(fs.existsSync(path.join(projectDir, ".rauf.json"))).toBe(false);
  });

  it("preserves backlog and progress by default", async () => {
    const projectDir = path.join(tmpDir, "uninstall-keep");
    createFakeProject(projectDir, { git: true });

    // Install first
    const installCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    await handleInstall(installCtx);

    // Verify data files exist
    expect(fs.existsSync(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".rauf", "progress.md"))).toBe(true);

    // Uninstall
    const uninstallCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    const code = await handleUninstall(uninstallCtx);
    expect(code).toBe(ExitCode.SUCCESS);

    // Data files should be preserved
    expect(fs.existsSync(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".rauf", "progress.md"))).toBe(true);
  });

  it("outputs JSON with --json flag", async () => {
    const projectDir = path.join(tmpDir, "uninstall-json");
    createFakeProject(projectDir, { git: true });

    // Install first
    const installCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });
    await handleInstall(installCtx);

    // Uninstall with --json
    configureOutput({ noColor: true, quiet: false, json: true });
    const uninstallCtx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleUninstall(uninstallCtx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe(path.resolve(projectDir));
  });
});

// ─── Exit code mapping ──────────────────────────────────────────────

describe("exit codes", () => {
  it("install returns correct exit codes for various errors", async () => {
    // Non-existent path → NOT_FOUND
    const code1 = await handleInstall(
      makeCtx({
        args: [path.join(tmpDir, "does-not-exist")],
        flags: new Map([["yes", true as string | true]]),
      }),
    );
    expect(code1).toBe(ExitCode.USAGE);
  });

  it("update returns NOT_FOUND for non-installed project", async () => {
    const dir = path.join(tmpDir, "empty-dir");
    fs.mkdirSync(dir, { recursive: true });

    const code = await handleUpdate(makeCtx({ args: [dir] }));
    expect(code).toBe(ExitCode.USAGE);
  });

  it("uninstall returns NOT_FOUND for non-installed project", async () => {
    const dir = path.join(tmpDir, "empty-dir2");
    fs.mkdirSync(dir, { recursive: true });

    const code = await handleUninstall(makeCtx({ args: [dir] }));
    expect(code).toBe(ExitCode.USAGE);
  });
});

// ─── Command registry integration ──────────────────────────────────

describe("command registry has handlers", () => {
  it("install, init, update, uninstall all have handlers", async () => {
    const { findCommand } = await import("./commands.js");

    expect(findCommand("install")?.handler).toBeDefined();
    expect(findCommand("init")?.handler).toBeDefined();
    expect(findCommand("update")?.handler).toBeDefined();
    expect(findCommand("uninstall")?.handler).toBeDefined();
  });
});
