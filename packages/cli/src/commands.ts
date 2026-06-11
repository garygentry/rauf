// ─── Command Registry ────────────────────────────────────────────
//
// Defines all CLI commands, their descriptions, and subcommands.
// Includes handler implementations for `version` and `help`.
// Other commands are registered as stubs — future items add handlers.

import { VERSION } from "@rauf/core";
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
  handleBacklogSweep,
  handleBacklogArchiveDispatch,
  handleBacklogReset,
  handleBacklogUnblock,
  handleBacklogValidate,
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
import {
  handleLoopStart,
  handleLoopStop,
  handleLoopFollow,
  handleLoopRun,
  handleLoopReview,
  handleLoopWatch,
} from "./loop-commands.js";
import { handleMigrate } from "./migrate-commands.js";
import { handleReset } from "./reset-commands.js";
import { handleResume } from "./resume-commands.js";

// ─── Types ───────────────────────────────────────────────────────

export interface CommandContext {
  args: string[];
  flags: Map<string, string | true>;
  globalFlags: GlobalFlags;
  rawArgv: string[];
}

/** A documented flag for a command/subcommand, rendered in `rauf help`. */
export interface FlagDef {
  /** Display name, including any value placeholder (e.g. "--iterations <N>"). */
  name: string;
  /** One-line description of what the flag does. */
  description: string;
}

export interface SubcommandDef {
  name: string;
  description: string;
  usage?: string;
  flags?: FlagDef[];
  handler?: (ctx: CommandContext) => Promise<number>;
}

export interface CommandDef {
  name: string;
  description: string;
  usage?: string;
  flags?: FlagDef[];
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
    usage: "rauf version",
    handler: handleVersion,
  },
  {
    name: "help",
    description: "Show help for a command",
    usage: "rauf help [command]",
    handler: handleHelp,
  },
  {
    name: "server",
    description: "Manage the rauf web server",
    usage: "rauf server <subcommand>",
    subcommands: [
      { name: "start", description: "Start the web server", handler: handleServerStart },
      {
        name: "stop",
        description: "Stop the web server",
        usage: "rauf server stop [--force]",
        handler: handleServerStop,
      },
      {
        name: "restart",
        description: "Restart the web server",
        usage: "rauf server restart [--force]",
        handler: handleServerRestart,
      },
      { name: "status", description: "Show server status", handler: handleServerStatus },
      { name: "logs", description: "View server logs", handler: handleServerLogs },
    ],
  },
  {
    name: "loop",
    description: "Manage rauf autonomous coding loops",
    usage: "rauf loop <subcommand> [path]",
    subcommands: [
      {
        name: "start",
        description: "Start a loop via server",
        usage: "rauf loop start [path] [options]",
        flags: [
          { name: "--iterations <N>", description: "Max iterations (default: backlog-derived)" },
          {
            name: "--retries <N>",
            description: "Max retries per item before deferring (default: 3)",
          },
          {
            name: "--timeout <N>",
            description: "Per-iteration session timeout in minutes (default: 60)",
          },
          { name: "--model <name>", description: "Claude model to use" },
          { name: "--backlog <dir>", description: "Backlog directory for multi-backlog projects" },
          {
            name: "--create-branch <name>",
            description: "Create & switch to a new feature branch before starting",
          },
          { name: "--follow", description: "Follow loop events in real-time after starting" },
          {
            name: "--retry-blocked",
            description: "Unblock previously blocked items before starting",
          },
          {
            name: "--suppress-iteration-review",
            description: "Suppress per-iteration review hooks in child sessions",
          },
        ],
        handler: handleLoopStart,
      },
      { name: "stop", description: "Stop a running loop", handler: handleLoopStop },
      { name: "follow", description: "Follow loop events in real-time", handler: handleLoopFollow },
      {
        name: "run",
        description: "Run loop directly in-process",
        usage: "rauf loop run [path] [options]",
        flags: [
          { name: "--iterations <N>", description: "Max iterations (default: backlog-derived)" },
          {
            name: "--retries <N>",
            description: "Max retries per item before deferring (default: 3)",
          },
          {
            name: "--timeout <N>",
            description: "Per-iteration session timeout in minutes (default: 60)",
          },
          { name: "--model <name>", description: "Claude model to use" },
          { name: "--backlog <dir>", description: "Backlog directory for multi-backlog projects" },
          { name: "--force", description: "Skip git preconditions (protected branch, dirty tree)" },
          {
            name: "--allow-dirty",
            description: "Allow a dirty working tree (skip only the dirty-tree check)",
          },
          { name: "--review", description: "Run a review pass after the loop completes" },
          { name: "--review-only", description: "Run only the review pass, no iterations" },
          {
            name: "--retry-blocked",
            description: "Unblock previously blocked items before running",
          },
          {
            name: "--suppress-iteration-review",
            description: "Suppress per-iteration review hooks in child sessions",
          },
          {
            name: "--ndjson",
            description: "Emit one JSON object per loop event to stdout (machine-readable)",
          },
        ],
        handler: handleLoopRun,
      },
      {
        name: "review",
        description: "Review completed items and create fix items",
        usage: "rauf loop review [path] [--model MODEL] [--timeout N]",
        handler: handleLoopReview,
      },
      {
        name: "watch",
        description: "Watch live iteration status (tool activity, tokens)",
        usage: "rauf loop watch [path] [--json]",
        handler: handleLoopWatch,
      },
    ],
  },
  {
    name: "install",
    description: "Install rauf into an existing project",
    usage: "rauf install <path> [options]",
    handler: handleInstall,
  },
  {
    name: "init",
    description: "Initialize a new project with rauf",
    usage: "rauf init <path> [options]",
    handler: handleInit,
  },
  {
    name: "update",
    description: "Update rauf artifacts in a project",
    usage: "rauf update <path> [--yes]",
    handler: handleUpdate,
  },
  {
    name: "uninstall",
    description: "Remove rauf from a project",
    usage: "rauf uninstall <path> [--yes] [--keep-data]",
    handler: handleUninstall,
  },
  {
    name: "migrate",
    description: "Migrate a legacy ralph project to rauf",
    usage:
      "rauf migrate <path> [--dry-run] [--no-backup] [--clean-backups] | rauf migrate --global",
    handler: handleMigrate,
  },
  {
    name: "backlog",
    description: "Manage project backlog items",
    usage: "rauf backlog <subcommand> <path>",
    subcommands: [
      { name: "list", description: "List backlog items", handler: handleBacklogList },
      {
        name: "validate",
        description: "Validate a backlog against the schema + semantic checks",
        usage: "rauf backlog validate <path> [--backlog <dir>] [--specs-dir <dir>] [--json]",
        handler: handleBacklogValidate,
      },
      { name: "add", description: "Add a new backlog item", handler: handleBacklogAdd },
      { name: "edit", description: "Edit an existing item", handler: handleBacklogEdit },
      { name: "delete", description: "Delete a backlog item", handler: handleBacklogDelete },
      { name: "show", description: "Show item details", handler: handleBacklogShow },
      { name: "restore", description: "Restore from backup", handler: handleBacklogRestore },
      {
        name: "sweep",
        description: "Archive done items into .rauf/archive/",
        handler: handleBacklogSweep,
      },
      {
        name: "archive",
        description: "Manage archive files (list, view, purge)",
        handler: handleBacklogArchiveDispatch,
      },
      {
        name: "reset",
        description: "Reset project state for a fresh backlog cycle",
        handler: handleBacklogReset,
      },
      {
        name: "unblock",
        description: "Unblock items for retry",
        handler: handleBacklogUnblock,
      },
    ],
  },
  {
    name: "reset",
    description:
      "Recover an interrupted loop: reconcile commits, requeue false blocks, clear state",
    usage: "rauf reset [path] [--keep-done] [--backlog <dir>] [--json]",
    handler: handleReset,
  },
  {
    name: "resume",
    description: "Continue an interrupted loop: recover state, then relaunch from the next item",
    usage: "rauf resume [path] [--recover] [--backlog <dir>] [--iterations N] [--json]",
    handler: handleResume,
  },
  {
    name: "status",
    description: "Show loop status for a project",
    usage: "rauf status <path> [--watch] [--interval N]",
    handler: handleStatus,
  },
  {
    name: "log",
    description: "View loop log for a project",
    usage: "rauf log <path> [--tail N] [--follow]",
    handler: handleLog,
  },
  {
    name: "progress",
    description: "View progress notes for a project",
    usage: "rauf progress <path>",
    handler: handleProgress,
  },
  {
    name: "profile",
    description: "Manage project tech-stack profile",
    usage: "rauf profile <subcommand> <path>",
    subcommands: [
      { name: "show", description: "Show current profile", handler: handleProfileShow },
      { name: "detect", description: "Auto-detect tech stack", handler: handleProfileDetect },
      { name: "set", description: "Set a profile value", handler: handleProfileSet },
    ],
  },
  {
    name: "config",
    description: "Manage rauf tool configuration",
    usage: "rauf config <subcommand>",
    subcommands: [
      { name: "get", description: "Get a config value", handler: handleConfigGet },
      { name: "set", description: "Set a config value", handler: handleConfigSet },
      { name: "list", description: "List all config values", handler: handleConfigList },
    ],
  },
  {
    name: "projects",
    description: "List and manage discovered projects",
    usage: "rauf projects <subcommand>",
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
    print(`rauf v${VERSION}`);
  }
  return ExitCode.SUCCESS;
}

async function handleHelp(ctx: CommandContext): Promise<number> {
  const target = ctx.args[0];

  if (target) {
    // `rauf help <command> [subcommand]` — second positional targets a subcommand.
    return showCommandHelp(target, ctx, ctx.args[1]);
  }

  return showGeneralHelp(ctx);
}

export function showGeneralHelp(ctx: CommandContext): number {
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
    `${c.bold("rauf")} v${VERSION} ${c.dim("\u2014 Management tool for rauf autonomous coding loops")}`,
    "",
    `${c.bold("Usage:")} rauf <command> [options]`,
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
  lines.push(c.dim("Run 'rauf help <command>' for details on a specific command."));

  print(lines.join("\n"));
  return ExitCode.SUCCESS;
}

export function showCommandHelp(
  commandName: string,
  ctx: CommandContext,
  subcommandName?: string,
): number {
  const cmd = findCommand(commandName);
  if (!cmd) {
    if (ctx.globalFlags.json) {
      outputJson({
        error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${commandName}` },
      });
    } else {
      print(
        `${c.red("Unknown command:")} ${commandName}\n\nRun ${c.cyan("rauf help")} for available commands.`,
      );
    }
    return ExitCode.INVALID_ARGS;
  }

  // Resolve a targeted subcommand, if one was named and exists.
  const sub = subcommandName ? findSubcommand(cmd, subcommandName) : undefined;

  if (sub) {
    return showSubcommandHelp(cmd, sub, ctx);
  }

  if (ctx.globalFlags.json) {
    outputJson({
      name: cmd.name,
      description: cmd.description,
      usage: cmd.usage ?? `rauf ${cmd.name}`,
      flags: cmd.flags ?? [],
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
    `${c.bold("Usage:")} ${cmd.usage ?? `rauf ${cmd.name}`}`,
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

  appendFlagLines(lines, cmd.flags);

  print(lines.join("\n"));
  return ExitCode.SUCCESS;
}

/** Render help for a specific `<command> <subcommand>`: usage + flag list. */
function showSubcommandHelp(cmd: CommandDef, sub: SubcommandDef, ctx: CommandContext): number {
  const usage = sub.usage ?? `rauf ${cmd.name} ${sub.name}`;

  if (ctx.globalFlags.json) {
    outputJson({
      name: `${cmd.name} ${sub.name}`,
      description: sub.description,
      usage,
      flags: sub.flags ?? [],
    });
    return ExitCode.SUCCESS;
  }

  const lines: string[] = [c.bold(sub.description), "", `${c.bold("Usage:")} ${usage}`];

  appendFlagLines(lines, sub.flags);

  print(lines.join("\n"));
  return ExitCode.SUCCESS;
}

/** Append a "Flags:" table to the given help lines when flags are documented. */
function appendFlagLines(lines: string[], flags: FlagDef[] | undefined): void {
  if (!flags || flags.length === 0) return;
  lines.push("");
  lines.push(c.bold("Flags:"));
  const columns: TableColumn[] = [
    { header: "Flag", key: "name" },
    { header: "Description", key: "desc" },
  ];
  const rows = flags.map((f) => ({ name: c.cyan(f.name), desc: f.description }));
  lines.push(
    renderTable(columns, rows)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
}
