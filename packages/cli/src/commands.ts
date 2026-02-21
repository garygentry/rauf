// ─── Command Registry ────────────────────────────────────────────
//
// Defines all CLI commands, their descriptions, and subcommands.
// Includes handler implementations for `version` and `help`.
// Other commands are registered as stubs — future items add handlers.

import { VERSION } from "@ralph/core";
import type { GlobalFlags } from "./parser.js";
import { c, print, outputJson, renderTable } from "./formatter.js";
import type { TableColumn } from "./formatter.js";
import { handleInstall, handleInit, handleUpdate, handleUninstall } from "./install-commands.js";
import {
  handleBacklogList,
  handleBacklogAdd,
  handleBacklogEdit,
  handleBacklogDelete,
  handleBacklogShow,
  handleBacklogRestore,
} from "./backlog-commands.js";
import { handleStatus, handleLog, handleProgress } from "./status-commands.js";
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
import {
  handleServerStart,
  handleServerStop,
  handleServerRestart,
  handleServerStatus,
  handleServerLogs,
} from "./server-commands.js";

// ─── Types ───────────────────────────────────────────────────────

export interface CommandContext {
  args: string[];
  flags: Map<string, string | true>;
  globalFlags: GlobalFlags;
  rawArgv: string[];
}

export interface SubcommandDef {
  name: string;
  description: string;
  usage?: string;
  handler?: (ctx: CommandContext) => Promise<number>;
}

export interface CommandDef {
  name: string;
  description: string;
  usage?: string;
  subcommands?: SubcommandDef[];
  handler?: (ctx: CommandContext) => Promise<number>;
}

// ─── Exit Codes ──────────────────────────────────────────────────

export const ExitCode = {
  SUCCESS: 0,
  ERROR: 1,
  INVALID_ARGS: 2,
  NOT_FOUND: 3,
  VALIDATION: 4,
  CONFLICT: 5,
} as const;

// ─── Command Definitions ─────────────────────────────────────────
//
// All commands from SPEC-CLI.md are listed. Commands without handlers
// will show "not yet implemented" when invoked.

export const COMMANDS: CommandDef[] = [
  {
    name: "version",
    description: "Show version information",
    usage: "ralph version",
    handler: handleVersion,
  },
  {
    name: "help",
    description: "Show help for a command",
    usage: "ralph help [command]",
    handler: handleHelp,
  },
  {
    name: "server",
    description: "Manage the ralph web server",
    usage: "ralph server <subcommand>",
    subcommands: [
      { name: "start", description: "Start the web server", handler: handleServerStart },
      { name: "stop", description: "Stop the web server", handler: handleServerStop },
      { name: "restart", description: "Restart the web server", handler: handleServerRestart },
      { name: "status", description: "Show server status", handler: handleServerStatus },
      { name: "logs", description: "View server logs", handler: handleServerLogs },
    ],
  },
  {
    name: "install",
    description: "Install ralph into an existing project",
    usage: "ralph install <path> [options]",
    handler: handleInstall,
  },
  {
    name: "init",
    description: "Initialize a new project with ralph",
    usage: "ralph init <path> [options]",
    handler: handleInit,
  },
  {
    name: "update",
    description: "Update ralph artifacts in a project",
    usage: "ralph update <path> [--yes]",
    handler: handleUpdate,
  },
  {
    name: "uninstall",
    description: "Remove ralph from a project",
    usage: "ralph uninstall <path> [--yes] [--keep-data]",
    handler: handleUninstall,
  },
  {
    name: "backlog",
    description: "Manage project backlog items",
    usage: "ralph backlog <subcommand> <path>",
    subcommands: [
      { name: "list", description: "List backlog items", handler: handleBacklogList },
      { name: "add", description: "Add a new backlog item", handler: handleBacklogAdd },
      { name: "edit", description: "Edit an existing item", handler: handleBacklogEdit },
      { name: "delete", description: "Delete a backlog item", handler: handleBacklogDelete },
      { name: "show", description: "Show item details", handler: handleBacklogShow },
      { name: "restore", description: "Restore from backup", handler: handleBacklogRestore },
    ],
  },
  {
    name: "status",
    description: "Show loop status for a project",
    usage: "ralph status <path>",
    handler: handleStatus,
  },
  {
    name: "log",
    description: "View loop log for a project",
    usage: "ralph log <path> [--tail N] [--follow]",
    handler: handleLog,
  },
  {
    name: "progress",
    description: "View progress notes for a project",
    usage: "ralph progress <path>",
    handler: handleProgress,
  },
  {
    name: "profile",
    description: "Manage project tech-stack profile",
    usage: "ralph profile <subcommand> <path>",
    subcommands: [
      { name: "show", description: "Show current profile", handler: handleProfileShow },
      { name: "detect", description: "Auto-detect tech stack", handler: handleProfileDetect },
      { name: "set", description: "Set a profile value", handler: handleProfileSet },
    ],
  },
  {
    name: "config",
    description: "Manage ralph tool configuration",
    usage: "ralph config <subcommand>",
    subcommands: [
      { name: "get", description: "Get a config value", handler: handleConfigGet },
      { name: "set", description: "Set a config value", handler: handleConfigSet },
      { name: "list", description: "List all config values", handler: handleConfigList },
    ],
  },
  {
    name: "projects",
    description: "List and manage discovered projects",
    usage: "ralph projects <subcommand>",
    subcommands: [
      { name: "list", description: "List discovered projects", handler: handleProjectsList },
      {
        name: "status",
        description: "Show status for all projects",
        handler: handleProjectsStatus,
      },
    ],
  },
];

// ─── Command Lookup ──────────────────────────────────────────────

const commandMap = new Map<string, CommandDef>();
for (const cmd of COMMANDS) {
  commandMap.set(cmd.name, cmd);
}

export function findCommand(name: string): CommandDef | undefined {
  return commandMap.get(name);
}

export function getSubcommandNames(cmd: CommandDef): Set<string> {
  if (!cmd.subcommands) return new Set();
  return new Set(cmd.subcommands.map((sc) => sc.name));
}

export function findSubcommand(cmd: CommandDef, name: string): SubcommandDef | undefined {
  return cmd.subcommands?.find((sc) => sc.name === name);
}

// ─── Built-in Command Handlers ───────────────────────────────────

async function handleVersion(ctx: CommandContext): Promise<number> {
  if (ctx.globalFlags.json) {
    outputJson({ version: VERSION });
  } else {
    print(`ralph v${VERSION}`);
  }
  return ExitCode.SUCCESS;
}

async function handleHelp(ctx: CommandContext): Promise<number> {
  const target = ctx.args[0];

  if (target) {
    return showCommandHelp(target, ctx);
  }

  return showGeneralHelp(ctx);
}

function showGeneralHelp(ctx: CommandContext): number {
  if (ctx.globalFlags.json) {
    outputJson({
      version: VERSION,
      commands: COMMANDS.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        subcommands: cmd.subcommands?.map((sc) => sc.name) ?? [],
      })),
    });
    return ExitCode.SUCCESS;
  }

  const lines: string[] = [
    `${c.bold("ralph")} v${VERSION} ${c.dim("\u2014 Management tool for ralph autonomous coding loops")}`,
    "",
    `${c.bold("Usage:")} ralph <command> [options]`,
    "",
    c.bold("Commands:"),
  ];

  // Build command table
  const columns: TableColumn[] = [
    { header: "Command", key: "name" },
    { header: "Description", key: "desc" },
  ];
  const rows = COMMANDS.filter((cmd) => cmd.name !== "help").map((cmd) => ({
    name: c.cyan(cmd.name),
    desc: cmd.description,
  }));

  lines.push(
    renderTable(columns, rows)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );

  lines.push("");
  lines.push(c.bold("Global Flags:"));
  lines.push(`  ${c.cyan("--json")}            Machine-readable JSON output`);
  lines.push(`  ${c.cyan("--no-color")}        Suppress ANSI color codes`);
  lines.push(`  ${c.cyan("--quiet")}, ${c.cyan("-q")}      Suppress informational output`);
  lines.push(`  ${c.cyan("--root")} <path>     Override root directory`);
  lines.push("");
  lines.push(c.dim("Run 'ralph help <command>' for details on a specific command."));

  print(lines.join("\n"));
  return ExitCode.SUCCESS;
}

function showCommandHelp(commandName: string, ctx: CommandContext): number {
  const cmd = findCommand(commandName);
  if (!cmd) {
    if (ctx.globalFlags.json) {
      outputJson({
        error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${commandName}` },
      });
    } else {
      print(
        `${c.red("Unknown command:")} ${commandName}\n\nRun ${c.cyan("ralph help")} for available commands.`,
      );
    }
    return ExitCode.INVALID_ARGS;
  }

  if (ctx.globalFlags.json) {
    outputJson({
      name: cmd.name,
      description: cmd.description,
      usage: cmd.usage ?? `ralph ${cmd.name}`,
      subcommands:
        cmd.subcommands?.map((sc) => ({
          name: sc.name,
          description: sc.description,
        })) ?? [],
    });
    return ExitCode.SUCCESS;
  }

  const lines: string[] = [
    c.bold(cmd.description),
    "",
    `${c.bold("Usage:")} ${cmd.usage ?? `ralph ${cmd.name}`}`,
  ];

  if (cmd.subcommands && cmd.subcommands.length > 0) {
    lines.push("");
    lines.push(c.bold("Subcommands:"));
    const columns: TableColumn[] = [
      { header: "Subcommand", key: "name" },
      { header: "Description", key: "desc" },
    ];
    const rows = cmd.subcommands.map((sc) => ({
      name: c.cyan(sc.name),
      desc: sc.description,
    }));
    lines.push(
      renderTable(columns, rows)
        .split("\n")
        .map((l) => "  " + l)
        .join("\n"),
    );
  }

  print(lines.join("\n"));
  return ExitCode.SUCCESS;
}
