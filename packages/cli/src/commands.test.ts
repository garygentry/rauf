import { describe, it, expect, beforeEach, vi } from "vitest";
import { VERSION } from "@ralph/core";
import {
  COMMANDS,
  findCommand,
  getSubcommandNames,
  findSubcommand,
  ExitCode,
} from "./commands.js";
import type { CommandContext, CommandDef } from "./commands.js";
import { configureOutput } from "./formatter.js";

// Helper to capture stdout/stderr
function captureOutput(fn: () => void | Promise<void>) {
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

  const result = fn();
  const restore = () => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  };

  if (result instanceof Promise) {
    return result.then(() => {
      restore();
      return { stdout: stdout.join(""), stderr: stderr.join("") };
    });
  }

  restore();
  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    args: [],
    flags: new Map(),
    globalFlags: {
      json: false,
      noColor: false,
      quiet: false,
      root: null,
    },
    ...overrides,
  };
}

describe("COMMANDS registry", () => {
  it("contains all expected top-level commands", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(names).toContain("version");
    expect(names).toContain("help");
    expect(names).toContain("server");
    expect(names).toContain("install");
    expect(names).toContain("init");
    expect(names).toContain("update");
    expect(names).toContain("uninstall");
    expect(names).toContain("backlog");
    expect(names).toContain("status");
    expect(names).toContain("log");
    expect(names).toContain("progress");
    expect(names).toContain("profile");
    expect(names).toContain("config");
    expect(names).toContain("projects");
  });

  it("has descriptions for all commands", () => {
    for (const cmd of COMMANDS) {
      expect(cmd.description).toBeTruthy();
      expect(cmd.description.length).toBeGreaterThan(5);
    }
  });

  it("has handlers for version and help", () => {
    expect(findCommand("version")?.handler).toBeDefined();
    expect(findCommand("help")?.handler).toBeDefined();
  });

  it("backlog has expected subcommands", () => {
    const backlog = findCommand("backlog");
    expect(backlog?.subcommands).toBeDefined();
    const subNames = backlog!.subcommands!.map((s) => s.name);
    expect(subNames).toEqual(["list", "add", "edit", "delete", "show", "restore"]);
  });

  it("server has expected subcommands", () => {
    const server = findCommand("server");
    const subNames = server!.subcommands!.map((s) => s.name);
    expect(subNames).toEqual(["start", "stop", "restart", "status", "logs"]);
  });

  it("config has expected subcommands", () => {
    const config = findCommand("config");
    const subNames = config!.subcommands!.map((s) => s.name);
    expect(subNames).toEqual(["get", "set", "list"]);
  });

  it("profile has expected subcommands", () => {
    const profile = findCommand("profile");
    const subNames = profile!.subcommands!.map((s) => s.name);
    expect(subNames).toEqual(["show", "detect", "set"]);
  });

  it("projects has expected subcommands", () => {
    const projects = findCommand("projects");
    const subNames = projects!.subcommands!.map((s) => s.name);
    expect(subNames).toEqual(["list", "status"]);
  });
});

describe("findCommand", () => {
  it("finds existing command", () => {
    expect(findCommand("version")).toBeDefined();
    expect(findCommand("version")!.name).toBe("version");
  });

  it("returns undefined for unknown command", () => {
    expect(findCommand("nonexistent")).toBeUndefined();
  });
});

describe("getSubcommandNames", () => {
  it("returns set of subcommand names", () => {
    const backlog = findCommand("backlog")!;
    const names = getSubcommandNames(backlog);
    expect(names.has("list")).toBe(true);
    expect(names.has("add")).toBe(true);
    expect(names.has("edit")).toBe(true);
    expect(names.has("delete")).toBe(true);
    expect(names.has("show")).toBe(true);
    expect(names.has("restore")).toBe(true);
  });

  it("returns empty set for command without subcommands", () => {
    const version = findCommand("version")!;
    expect(getSubcommandNames(version).size).toBe(0);
  });
});

describe("findSubcommand", () => {
  it("finds existing subcommand", () => {
    const backlog = findCommand("backlog")!;
    const sub = findSubcommand(backlog, "list");
    expect(sub).toBeDefined();
    expect(sub!.name).toBe("list");
  });

  it("returns undefined for unknown subcommand", () => {
    const backlog = findCommand("backlog")!;
    expect(findSubcommand(backlog, "nonexistent")).toBeUndefined();
  });
});

describe("version command", () => {
  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  it("prints version string", async () => {
    const cmd = findCommand("version")!;
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(makeCtx());
      expect(code).toBe(ExitCode.SUCCESS);
    });
    expect(output.stdout).toContain(`ralph v${VERSION}`);
  });

  it("outputs JSON when --json flag is set", async () => {
    const cmd = findCommand("version")!;
    const ctx = makeCtx({
      globalFlags: { json: true, noColor: false, quiet: false, root: null },
    });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    const parsed = JSON.parse(output.stdout);
    expect(parsed).toEqual({ version: VERSION });
  });
});

describe("help command", () => {
  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  it("shows general help with no args", async () => {
    const cmd = findCommand("help")!;
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(makeCtx());
      expect(code).toBe(ExitCode.SUCCESS);
    });
    expect(output.stdout).toContain("ralph");
    expect(output.stdout).toContain("Usage:");
    expect(output.stdout).toContain("Commands:");
    expect(output.stdout).toContain("--json");
    expect(output.stdout).toContain("--no-color");
    expect(output.stdout).toContain("--quiet");
    expect(output.stdout).toContain("--root");
  });

  it("lists all commands except help itself", async () => {
    const cmd = findCommand("help")!;
    const output = await captureOutput(async () => {
      await cmd.handler!(makeCtx());
    });
    // All commands except 'help' should appear
    for (const c of COMMANDS) {
      if (c.name === "help") continue;
      expect(output.stdout).toContain(c.name);
    }
  });

  it("shows help for specific command", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["backlog"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    expect(output.stdout).toContain("backlog");
    expect(output.stdout).toContain("Subcommands:");
    expect(output.stdout).toContain("list");
    expect(output.stdout).toContain("add");
  });

  it("shows help for command without subcommands", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["version"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    expect(output.stdout).toContain("version");
    expect(output.stdout).not.toContain("Subcommands:");
  });

  it("returns INVALID_ARGS for unknown command in help", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["nonexistent"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.INVALID_ARGS);
    });
    expect(output.stdout).toContain("Unknown command");
  });

  it("outputs JSON for general help when --json", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({
      globalFlags: { json: true, noColor: false, quiet: false, root: null },
    });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    const parsed = JSON.parse(output.stdout);
    expect(parsed.version).toBe(VERSION);
    expect(parsed.commands).toBeDefined();
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(parsed.commands.length).toBe(COMMANDS.length);
  });

  it("outputs JSON for command help when --json", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({
      args: ["backlog"],
      globalFlags: { json: true, noColor: false, quiet: false, root: null },
    });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    const parsed = JSON.parse(output.stdout);
    expect(parsed.name).toBe("backlog");
    expect(parsed.subcommands).toBeDefined();
    expect(parsed.subcommands.length).toBeGreaterThan(0);
  });

  it("outputs JSON error for unknown command when --json", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({
      args: ["nonexistent"],
      globalFlags: { json: true, noColor: false, quiet: false, root: null },
    });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.INVALID_ARGS);
    });
    const parsed = JSON.parse(output.stdout);
    expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
  });
});

describe("ExitCode", () => {
  it("defines all expected exit codes", () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.ERROR).toBe(1);
    expect(ExitCode.INVALID_ARGS).toBe(2);
    expect(ExitCode.NOT_FOUND).toBe(3);
    expect(ExitCode.VALIDATION).toBe(4);
    expect(ExitCode.CONFLICT).toBe(5);
  });
});
