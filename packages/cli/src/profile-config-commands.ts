// ─── Profile, Config, and Projects Command Handlers ──────────────
//
// CLI adapters for core profile management, tool config, and project discovery.
// Each handler: parses flags → resolves paths → calls core → formats output.

import * as path from "node:path";

import {
  readMarkerFile,
  writeMarkerFile,
  readToolConfig,
  writeToolConfig,
  resolveRootDirectory,
  detectProfile,
  discoverProjects,
  deriveStatus,
  defaultBacklogPaths,
  update,
  ErrorCodes,
  type ProjectProfile,
  type ToolConfig,
  buildVerifyCommand,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { c, info, print, error, success, outputJson, renderTable, symbols } from "./formatter.js";
import type { TableColumn } from "./formatter.js";

// ─── PROFILE SHOW ──────────────────────────────────────────────────

export async function handleProfileShow(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf profile show <path>");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const result = readMarkerFile(resolved);

  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  const { profile } = result.value;

  if (ctx.globalFlags.json) {
    outputJson(profile);
    return ExitCode.SUCCESS;
  }

  printProfile(profile);
  return ExitCode.SUCCESS;
}

// ─── PROFILE DETECT ────────────────────────────────────────────────
//
// Re-run auto-detection and show results. Does NOT write to disk.

export async function handleProfileDetect(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf profile detect <path>");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const detected = detectProfile(resolved);

  if (ctx.globalFlags.json) {
    outputJson(detected);
    return ExitCode.SUCCESS;
  }

  print(c.bold("Detected Profile (read-only — use 'rauf profile set' or 'rauf update' to apply):"));
  print("");
  printProfile(detected);
  return ExitCode.SUCCESS;
}

// ─── PROFILE SET ───────────────────────────────────────────────────
//
// Update a single profile field in .rauf.json.
// Usage: rauf profile set <path> <key> <value>
//
// Supported keys:
//   commands.test, commands.typecheck, commands.lint, commands.build, commands.format
//   stack, packageManager, monorepo
// Set a command key to "" to disable it (set to null).

const COMMAND_KEYS = new Set(["test", "typecheck", "lint", "build", "format"]);

export async function handleProfileSet(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  const key = ctx.args[1];
  const value = ctx.args[2];

  if (!targetPath || !key || value === undefined) {
    error("Missing required arguments: <path> <key> <value>");
    info("Usage: rauf profile set <path> <key> <value>");
    info("");
    info("Keys: test, typecheck, lint, build, format, stack, packageManager, monorepo");
    info("Set a command key to '' to disable (null).");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const markerResult = readMarkerFile(resolved);

  if (!markerResult.ok) {
    return handleCoreError(markerResult.error, ctx, resolved);
  }

  const marker = markerResult.value;
  const profile = { ...marker.profile, commands: { ...marker.profile.commands } };

  // Apply the update
  if (COMMAND_KEYS.has(key)) {
    // Set command value — empty string means disable (null)
    profile.commands[key as keyof typeof profile.commands] = value === "" ? null : value;
    // Rebuild verify composite
    profile.verify = buildVerifyCommand(profile.commands);
  } else if (key === "stack") {
    profile.stack = value;
  } else if (key === "packageManager") {
    profile.packageManager = value === "" ? null : value;
  } else if (key === "monorepo") {
    if (value !== "true" && value !== "false") {
      error(`Invalid value for 'monorepo': "${value}". Expected 'true' or 'false'.`);
      return ExitCode.USAGE;
    }
    profile.monorepo = value === "true";
  } else {
    error(`Unknown profile key: "${key}"`);
    info("Valid keys: test, typecheck, lint, build, format, stack, packageManager, monorepo");
    return ExitCode.USAGE;
  }

  const writeResult = writeMarkerFile(resolved, { ...marker, profile });
  if (!writeResult.ok) {
    return handleCoreError(writeResult.error, ctx, resolved);
  }

  // Auto-sync RAUF.md with the updated profile
  const updateResult = update(resolved);
  if (!updateResult.ok) {
    // Non-fatal — profile was saved, just warn that RAUF.md wasn't re-rendered
    if (!ctx.globalFlags.json) {
      info(`Profile saved but RAUF.md could not be updated: ${updateResult.error.message}`);
      info(`Run 'rauf update ${targetPath}' manually to sync.`);
    }
  }

  if (ctx.globalFlags.json) {
    outputJson(profile);
    return ExitCode.SUCCESS;
  }

  success(
    `Profile updated: ${c.bold(key)} = ${value === "" ? c.dim("(disabled)") : c.cyan(value)}`,
  );
  if (updateResult.ok) {
    info("RAUF.md verification commands synced.");
  }
  return ExitCode.SUCCESS;
}

// ─── CONFIG LIST ───────────────────────────────────────────────────

export async function handleConfigList(ctx: CommandContext): Promise<number> {
  const result = readToolConfig();

  if (!result.ok) {
    return handleCoreError(result.error, ctx);
  }

  const config = result.value;

  if (ctx.globalFlags.json) {
    outputJson(config);
    return ExitCode.SUCCESS;
  }

  printConfig(config);
  return ExitCode.SUCCESS;
}

// ─── CONFIG GET ────────────────────────────────────────────────────

const VALID_CONFIG_KEYS = new Set<string>(["rootDirectory", "port", "theme"]);

export async function handleConfigGet(ctx: CommandContext): Promise<number> {
  const key = ctx.args[0];
  if (!key) {
    error("Missing required argument: <key>");
    info("Usage: rauf config get <key>");
    info("Keys: rootDirectory, port, theme");
    return ExitCode.USAGE;
  }

  if (!VALID_CONFIG_KEYS.has(key)) {
    error(`Unknown config key: "${key}"`);
    info(`Valid keys: ${[...VALID_CONFIG_KEYS].join(", ")}`);
    return ExitCode.USAGE;
  }

  const result = readToolConfig();
  if (!result.ok) {
    return handleCoreError(result.error, ctx);
  }

  const value = result.value[key as keyof ToolConfig];

  if (ctx.globalFlags.json) {
    outputJson({ [key]: value });
    return ExitCode.SUCCESS;
  }

  print(String(value));
  return ExitCode.SUCCESS;
}

// ─── CONFIG SET ────────────────────────────────────────────────────

export async function handleConfigSet(ctx: CommandContext): Promise<number> {
  const key = ctx.args[0];
  const rawValue = ctx.args[1];

  if (!key || rawValue === undefined) {
    error("Missing required arguments: <key> <value>");
    info("Usage: rauf config set <key> <value>");
    info("Keys: rootDirectory, port, theme");
    return ExitCode.USAGE;
  }

  if (!VALID_CONFIG_KEYS.has(key)) {
    error(`Unknown config key: "${key}"`);
    info(`Valid keys: ${[...VALID_CONFIG_KEYS].join(", ")}`);
    return ExitCode.USAGE;
  }

  const readResult = readToolConfig();
  if (!readResult.ok) {
    return handleCoreError(readResult.error, ctx);
  }

  const config = { ...readResult.value };

  // Coerce value to the correct type per key
  if (key === "port") {
    const portNum = parseInt(rawValue, 10);
    if (isNaN(portNum) || portNum <= 0) {
      error(`Invalid port value: "${rawValue}". Must be a positive integer.`);
      return ExitCode.USAGE;
    }
    config.port = portNum;
  } else if (key === "theme") {
    if (rawValue !== "light" && rawValue !== "dark" && rawValue !== "system") {
      error(`Invalid theme value: "${rawValue}". Valid: light, dark, system.`);
      return ExitCode.USAGE;
    }
    config.theme = rawValue;
  } else if (key === "rootDirectory") {
    config.rootDirectory = path.resolve(rawValue);
  }

  const writeResult = writeToolConfig(config);
  if (!writeResult.ok) {
    return handleCoreError(writeResult.error, ctx);
  }

  if (ctx.globalFlags.json) {
    outputJson(config);
    return ExitCode.SUCCESS;
  }

  success(`Config updated: ${c.bold(key)} = ${c.cyan(String(config[key as keyof ToolConfig]))}`);
  return ExitCode.SUCCESS;
}

// ─── PROJECTS LIST ─────────────────────────────────────────────────

export async function handleProjectsList(ctx: CommandContext): Promise<number> {
  const rootDir = resolveRootDirectory(ctx.globalFlags.root ?? undefined);
  const result = discoverProjects(rootDir);

  if (!result.ok) {
    return handleCoreError(result.error, ctx);
  }

  const { projects, ignored, warnings } = result.value;

  if (ctx.globalFlags.json) {
    outputJson({ projects, ignored, warnings });
    return ExitCode.SUCCESS;
  }

  // Print warnings
  for (const w of warnings) {
    info(c.dim(`  ${symbols.warning} ${w}`));
  }

  if (projects.length === 0 && ignored.length === 0) {
    info(`No rauf-enabled projects found in: ${c.dim(rootDir)}`);
    info("Run 'rauf install <path>' to enable rauf for a project.");
    return ExitCode.SUCCESS;
  }

  info(c.dim(`Root: ${rootDir}`));
  info("");

  if (projects.length > 0) {
    const columns: TableColumn[] = [
      { header: "Name", key: "name" },
      { header: "Stack", key: "stack" },
      { header: "Pkg Mgr", key: "pkgMgr" },
      { header: "Monorepo", key: "monorepo" },
      { header: "Path", key: "projectPath", width: 60 },
    ];

    const rows = projects.map((p) => ({
      name: c.cyan(p.name),
      stack: p.marker.profile.stack,
      pkgMgr: p.marker.profile.packageManager ?? c.dim("—"),
      monorepo: p.marker.profile.monorepo ? c.green("yes") : c.dim("no"),
      projectPath: c.dim(p.path),
    }));

    print(renderTable(columns, rows));
  }

  if (ignored.length > 0) {
    print("");
    print(c.dim(`Ignored (${ignored.length}):`));
    for (const p of ignored) {
      print(c.dim(`  ${symbols.bullet} ${p.name} — ${p.path}`));
    }
  }

  return ExitCode.SUCCESS;
}

// ─── PROJECTS STATUS ───────────────────────────────────────────────
//
// Show loop status for all discovered projects.

export async function handleProjectsStatus(ctx: CommandContext): Promise<number> {
  const rootDir = resolveRootDirectory(ctx.globalFlags.root ?? undefined);
  const result = discoverProjects(rootDir);

  if (!result.ok) {
    return handleCoreError(result.error, ctx);
  }

  const { projects, warnings } = result.value;

  for (const w of warnings) {
    info(c.dim(`  ${symbols.warning} ${w}`));
  }

  if (projects.length === 0) {
    info(`No rauf-enabled projects found in: ${c.dim(rootDir)}`);
    return ExitCode.SUCCESS;
  }

  // Derive status for each project
  const projectStatuses = projects.map((p) => {
    const statusResult = deriveStatus(defaultBacklogPaths(p.path));
    return {
      project: p,
      status: statusResult.ok ? statusResult.value : null,
    };
  });

  if (ctx.globalFlags.json) {
    outputJson(
      projectStatuses.map(({ project, status }) => ({
        name: project.name,
        path: project.path,
        status,
      })),
    );
    return ExitCode.SUCCESS;
  }

  info(c.dim(`Root: ${rootDir}`));
  info("");

  const columns: TableColumn[] = [
    { header: "Name", key: "name" },
    { header: "State", key: "state" },
    { header: "Backlog", key: "backlog" },
    { header: "Path", key: "projectPath", width: 50 },
  ];

  const rows = projectStatuses.map(({ project, status }) => ({
    name: c.cyan(project.name),
    state: status ? colorLoopState(status.loopState) : c.dim("unknown"),
    backlog: status ? `${status.backlogSummary.done}/${status.backlogSummary.total}` : c.dim("—"),
    projectPath: c.dim(project.path),
  }));

  print(renderTable(columns, rows));
  return ExitCode.SUCCESS;
}

// ─── Shared helpers ───────────────────────────────────────────────

/** Map core error codes to CLI exit codes and print with suggested fix */
function handleCoreError(
  err: { code: string; message: string; details?: unknown },
  ctx: CommandContext,
  projectPath?: string,
): number {
  if (ctx.globalFlags.json) {
    outputJson({ error: err });
  } else {
    error(err.message);
    // Print a suggested fix (suppressed by --quiet)
    switch (err.code) {
      case ErrorCodes.FILE_NOT_FOUND:
      case ErrorCodes.NOT_INSTALLED:
        if (projectPath) {
          info(`Rauf is not installed here. Run: ${c.cyan(`rauf install ${projectPath}`)}`);
        } else {
          info("Ensure rauf is installed in the target directory.");
        }
        break;
      case ErrorCodes.INVALID_JSON:
      case ErrorCodes.VALIDATION_ERROR:
        if (projectPath) {
          info(
            `A project file may be corrupted. Try reinstalling: ${c.cyan(`rauf install ${projectPath} --yes`)}`,
          );
        } else {
          info("A config file may be corrupted. Check ~/.rauf/config.json manually.");
        }
        break;
      case ErrorCodes.CONFLICT:
        if (projectPath) {
          info(`A loop may be running. Check with: ${c.cyan(`rauf status ${projectPath}`)}`);
        }
        break;
    }
  }

  switch (err.code) {
    case ErrorCodes.FILE_NOT_FOUND:
      return ExitCode.USAGE;
    case ErrorCodes.NOT_INSTALLED:
      return ExitCode.USAGE;
    case ErrorCodes.INVALID_JSON:
      return ExitCode.USAGE;
    case ErrorCodes.VALIDATION_ERROR:
      return ExitCode.USAGE;
    case ErrorCodes.CONFLICT:
      return ExitCode.USAGE;
    default:
      return ExitCode.ERROR;
  }
}

/** Print a ProjectProfile in human-readable form */
function printProfile(profile: ProjectProfile): void {
  print(`${c.bold("Stack:")}          ${profile.stack}`);
  print(`${c.bold("Package Manager:")} ${profile.packageManager ?? c.dim("(none)")}`);
  print(`${c.bold("Monorepo:")}       ${profile.monorepo ? c.green("yes") : c.dim("no")}`);
  print("");
  print(c.bold("Commands:"));
  printCommand("test", profile.commands.test);
  printCommand("typecheck", profile.commands.typecheck);
  printCommand("lint", profile.commands.lint);
  printCommand("build", profile.commands.build);
  printCommand("format", profile.commands.format);
  if (profile.verify) {
    print("");
    print(`${c.bold("Verify:")} ${c.dim(profile.verify)}`);
  }
}

/** Print a labeled command value, dimming null */
function printCommand(label: string, value: string | null): void {
  const padded = label.padEnd(10);
  if (value) {
    print(`  ${c.cyan(padded)} ${value}`);
  } else {
    print(`  ${c.dim(padded)} ${c.dim("(disabled)")}`);
  }
}

/** Print ToolConfig as key-value pairs */
function printConfig(config: ToolConfig): void {
  print(`${c.bold("rootDirectory:")} ${config.rootDirectory}`);
  print(`${c.bold("port:")}          ${config.port}`);
  print(`${c.bold("theme:")}         ${config.theme}`);
}

/** Colorize a loop state */
function colorLoopState(state: string): string {
  switch (state) {
    case "RUNNING":
      return c.green(state);
    case "PAUSED_HUMAN":
      return c.magenta(state);
    case "LIMIT_REACHED":
      return c.yellow(state);
    case "ERROR":
      return c.red(state);
    case "COMPLETE":
      return c.cyan(state);
    case "ITERATIONS_COMPLETE":
      return c.green(state);
    case "PAUSED":
      return c.yellow(state);
    case "NOT_INSTALLED":
      return c.dim(state);
    default:
      return c.dim(state);
  }
}
