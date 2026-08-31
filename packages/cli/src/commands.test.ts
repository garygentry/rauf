import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { VERSION } from "@rauf/core";
import { COMMANDS, findCommand, getSubcommandNames, findSubcommand, ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";
import { getAgentDescriptors } from "@rauf/loop";
import { handleAgents } from "./loop-commands.js";

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
    rawArgv: [],
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
    expect(names).toContain("follow");
    expect(names).toContain("profile");
    expect(names).toContain("config");
    expect(names).toContain("projects");
    expect(names).toContain("loop");
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
    expect(subNames).toEqual([
      "list",
      "validate",
      "add",
      "edit",
      "delete",
      "show",
      "restore",
      "sweep",
      "archive",
      "reset",
      "unblock",
      "answer",
    ]);
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

describe("agent CLI surface registration (06 §Verification)", () => {
  it("registers a --agent FlagDef on `loop run` enumerating SUPPORTED_AGENT_IDS", () => {
    const run = findCommand("loop")!.subcommands!.find((s) => s.name === "run")!;
    const agentFlag = run.flags!.find((f) => f.name.startsWith("--agent"));
    expect(agentFlag).toBeDefined();
    const ids = getAgentDescriptors().map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(agentFlag!.description).toContain(id);
    }
  });

  it("registers a top-level `agents` command (handler, --json flag, no subcommands)", () => {
    const agents = findCommand("agents");
    expect(agents).toBeDefined();
    expect(agents!.name).toBe("agents");
    expect(agents!.handler).toBe(handleAgents);
    expect(agents!.subcommands).toBeUndefined();
    const jsonFlag = agents!.flags!.find((f) => f.name === "--json");
    expect(jsonFlag).toBeDefined();
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
    expect(output.stdout).toContain(`rauf v${VERSION}`);
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
    expect(output.stdout).toContain("rauf");
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

  it("renders subcommand usage + full flag view for `help loop run`", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["loop", "run"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    // The subcommand usage line, not just the subcommand list.
    expect(output.stdout).toContain("Usage:");
    expect(output.stdout).toContain("rauf loop run");
    // A flag list with the documented flags.
    expect(output.stdout).toContain("Flags:");
    expect(output.stdout).toContain("--iterations");
    // It is the subcommand view, not the parent's subcommand table.
    expect(output.stdout).not.toContain("Subcommands:");
  });

  it("renders subcommand flags for `help loop run`", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["loop", "run"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    expect(output.stdout).toContain("Flags:");
    expect(output.stdout).toContain("--retries");
    expect(output.stdout).toContain("--force");
  });

  it("outputs JSON for subcommand help when --json", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({
      args: ["loop", "run"],
      globalFlags: { json: true, noColor: false, quiet: false, root: null },
    });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    const parsed = JSON.parse(output.stdout);
    expect(parsed.name).toBe("loop run");
    expect(Array.isArray(parsed.flags)).toBe(true);
    expect(parsed.flags.some((f: { name: string }) => f.name.startsWith("--iterations"))).toBe(
      true,
    );
  });

  it("renders subcommand usage + flags for `help backlog reset` (not the bare-name fallback)", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["backlog", "reset"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    expect(output.stdout).toContain("Usage:");
    expect(output.stdout).toContain("rauf backlog reset <path>");
    expect(output.stdout).toContain("--clear");
    expect(output.stdout).toContain("Flags:");
    expect(output.stdout).toContain("--keep-progress");
    expect(output.stdout).toContain("--keep-log");
    expect(output.stdout).toContain("--yes");
  });

  it("renders subcommand usage + flags for `help backlog sweep` (not the bare-name fallback)", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["backlog", "sweep"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });
    expect(output.stdout).toContain("Usage:");
    expect(output.stdout).toContain("rauf backlog sweep <path>");
    expect(output.stdout).toContain("--min-age-days");
    expect(output.stdout).toContain("Flags:");
    expect(output.stdout).toContain("--dry-run");
  });

  it("returns USAGE for unknown command in help", async () => {
    const cmd = findCommand("help")!;
    const ctx = makeCtx({ args: ["nonexistent"] });
    const output = await captureOutput(async () => {
      const code = await cmd.handler!(ctx);
      expect(code).toBe(ExitCode.USAGE);
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
      expect(code).toBe(ExitCode.USAGE);
    });
    const parsed = JSON.parse(output.stdout);
    expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
  });
});

describe("ExitCode", () => {
  it("defines all expected exit codes", () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.ERROR).toBe(1);
    expect(ExitCode.USAGE).toBe(2);
    expect(ExitCode.NEEDS_HUMAN).toBe(3);
    expect(ExitCode.LIMIT).toBe(4);
    expect(ExitCode.BLOCKED).toBe(5);
    expect(ExitCode.RUNNING).toBe(6);
  });

  // REQ-EXIT-02 call-site audit: the unified ExitCode table dropped these member
  // names; no CLI source may reference them after the v0.5.0 redefinition (03 §1).
  it("has no source references to the removed ExitCode member names", () => {
    const srcDir = path.dirname(fileURLToPath(import.meta.url));
    const removed = ["INVALID_ARGS", "NOT_FOUND", "VALIDATION", "CONFLICT", "PAUSED_HUMAN"];
    const offenders: string[] = [];
    for (const file of fs.readdirSync(srcDir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const text = fs.readFileSync(path.join(srcDir, file), "utf-8");
      for (const member of removed) {
        if (text.includes(`ExitCode.${member}`)) offenders.push(`${file}: ExitCode.${member}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// REQ-DOC-02 (06 §4a): no stale `loop start` / `--watch` token may survive in the
// rendered help/usage surface — except the REQ-RMV-01 remediation messages, which
// are the only allowed mentions.
describe("help/usage no-stale-token audit", () => {
  function collectUsageStrings(): string[] {
    const out: string[] = [];
    const walk = (defs: typeof COMMANDS) => {
      for (const def of defs) {
        if (def.usage) out.push(def.usage);
        if (def.description) out.push(def.description);
        if (def.flags) for (const f of def.flags) out.push(f.description ?? "");
        if (def.subcommands) walk(def.subcommands as typeof COMMANDS);
      }
    };
    walk(COMMANDS);
    return out;
  }

  it("contains no `loop start` token in any usage/help/flag string", () => {
    const offenders = collectUsageStrings().filter((s) => /loop start/.test(s));
    expect(offenders).toEqual([]);
  });

  it("contains no `--watch` token in any usage/help/flag string", () => {
    const offenders = collectUsageStrings().filter((s) => /--watch/.test(s));
    expect(offenders).toEqual([]);
  });

  it("still exposes the canonical `loop run [--detached|-d]` grammar", () => {
    const loop = findCommand("loop")!;
    const run = loop.subcommands!.find((s) => s.name === "run")!;
    const flagNames = (run.flags ?? []).map((f) => f.name).join(" ");
    expect(flagNames).toContain("--detached");
    expect(loop.subcommands!.some((s) => s.name === "start")).toBe(false);
  });
});
