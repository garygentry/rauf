// ─── Install / Init / Update / Uninstall Command Handlers ───────
//
// CLI adapters for core installer and greenfield modules.
// Each handler: parses flags → resolves paths → calls core → formats output.
//
// Artifacts are embedded at build time in @rauf/core — no filesystem
// path resolution needed. The install/init/update functions default to
// reading from embedded artifacts when artifactsDir is omitted.

import * as path from "node:path";
import * as fs from "node:fs";

import {
  install,
  update,
  checkDrift,
  uninstall,
  preflight,
  initProject,
  ErrorCodes,
  type InstallationReport,
  type DriftReport,
  type ProfileOverrides,
} from "@rauf/core";
import { getAgentDescriptors, type AgentDescriptor } from "@rauf/loop";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag, extractStringFlag } from "./parser.js";
import { c, info, error, warn, success, outputJson, symbols } from "./formatter.js";

// ─── handleInstall ───────────────────────────────────────────────

export async function handleInstall(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info(`Usage: rauf install <path> [options]`);
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const yes = extractBoolFlag(ctx.flags, "yes");
  const gitignoreScripts = extractBoolFlag(ctx.flags, "gitignore-scripts");
  const agentResult = resolveInstallAgent(ctx);
  if (!agentResult.ok) return ExitCode.USAGE;
  const agent = agentResult.agent;

  // Extract profile override flags
  const overrides = extractProfileOverrides(ctx);

  // Run preflight first for display (unless --yes)
  if (!yes) {
    const preflightResult = preflight(resolved, agent);
    printPreflightResults(preflightResult.checks);

    if (!preflightResult.passed) {
      error("Preflight checks failed. Fix the issues above and try again.");
      if (ctx.globalFlags.json) {
        outputJson({ error: { code: "PREFLIGHT_FAILED", checks: preflightResult.checks } });
      }

      // Map to specific exit code based on which check failed
      const dirCheck = preflightResult.checks.find((c) => c.name === "directory_exists");
      if (dirCheck && !dirCheck.passed) return ExitCode.USAGE;
      return ExitCode.ERROR;
    }

    info("");
  }

  // Run installation (artifacts are embedded in @rauf/core)
  const result = install(resolved, {
    profileOverrides: overrides,
    options: {
      gitignoreScripts,
      ...(agent ? { provider: agent.id } : {}),
    },
    agent,
  });

  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  const report = result.value;

  if (ctx.globalFlags.json) {
    outputJson(report);
    return ExitCode.SUCCESS;
  }

  printInstallationReport(report);
  return ExitCode.SUCCESS;
}

// ─── handleInit ──────────────────────────────────────────────────

export async function handleInit(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info(`Usage: rauf init <path> [options]`);
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const name = extractStringFlag(ctx.flags, "name");
  const description = extractStringFlag(ctx.flags, "description");
  const stack = extractStringFlag(ctx.flags, "stack");
  const seed = extractStringFlag(ctx.flags, "seed");
  const agentResult = resolveInstallAgent(ctx);
  if (!agentResult.ok) return ExitCode.USAGE;
  const agent = agentResult.agent;

  // Extract profile override flags
  const overrides = extractProfileOverrides(ctx);

  // Validate stack preset if provided
  const validPresets = new Set([
    "node-typescript",
    "node-javascript",
    "python",
    "go",
    "rust",
    "custom",
  ]);
  if (stack && !validPresets.has(stack)) {
    error(`Invalid stack preset: "${stack}"`);
    info(`Valid presets: ${[...validPresets].join(", ")}`);
    return ExitCode.USAGE;
  }

  // Check target doesn't already exist as a rauf project
  if (fs.existsSync(path.join(resolved, ".rauf.json"))) {
    error(`Path "${resolved}" already has a .rauf.json. Use 'rauf install' for existing projects.`);
    return ExitCode.USAGE;
  }

  const result = initProject(resolved, {
    projectName: name ?? undefined,
    projectDescription: description ?? undefined,
    preset: stack ?? undefined,
    profileOverrides: overrides,
    seedFile: seed ?? undefined,
    rootDirectory: ctx.globalFlags.root ?? undefined,
    options: agent ? { provider: agent.id } : undefined,
    agent,
  });

  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  const report = result.value;

  if (ctx.globalFlags.json) {
    outputJson(report);
    return ExitCode.SUCCESS;
  }

  printInitReport(report);
  return ExitCode.SUCCESS;
}

// ─── handleUpdate ────────────────────────────────────────────────

export async function handleUpdate(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info(`Usage: rauf update <path> [--check]`);
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  // `--yes` is tolerated for back-compat but undocumented: `update` is
  // non-destructive and never prompts, so there is nothing to confirm.
  extractBoolFlag(ctx.flags, "yes");
  const check = extractBoolFlag(ctx.flags, "check");

  // Report-only drift check: never writes. Exits non-zero when stale so bulk
  // audits can script `rauf update --check <repo>` like `format:check`.
  if (check) {
    const driftResult = checkDrift(resolved);
    if (!driftResult.ok) {
      return handleCoreError(driftResult.error, ctx, resolved);
    }
    const drift = driftResult.value;
    if (ctx.globalFlags.json) {
      outputJson(drift);
    } else {
      printDriftReport(drift, resolved);
    }
    return drift.stale ? ExitCode.ERROR : ExitCode.SUCCESS;
  }

  const result = update(resolved);

  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  const report = result.value;

  if (ctx.globalFlags.json) {
    outputJson(report);
    return ExitCode.SUCCESS;
  }

  printUpdateReport(report);
  return ExitCode.SUCCESS;
}

// ─── handleUninstall ─────────────────────────────────────────────

export async function handleUninstall(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info(`Usage: rauf uninstall <path> [--yes] [--keep-data]`);
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  extractBoolFlag(ctx.flags, "yes"); // consume --yes flag (not yet used for confirmation)
  const keepData = extractBoolFlag(ctx.flags, "keep-data");

  const result = uninstall(resolved, {
    keepBacklog: keepData || true,
    keepProgress: keepData || true,
    keepLog: keepData || true,
    removeClaudeMdSection: true,
  });

  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson({ success: true, path: resolved, keepData });
    return ExitCode.SUCCESS;
  }

  success(`Rauf uninstalled from ${resolved}`);
  if (keepData) {
    info("  Data files (backlog.json, progress.md, rauf.log) preserved.");
  } else {
    info("  Data files preserved by default. Use without --keep-data to see defaults.");
  }
  return ExitCode.SUCCESS;
}

// ─── Shared helpers ──────────────────────────────────────────────

function resolveInstallAgent(
  ctx: CommandContext,
): { ok: true; agent?: AgentDescriptor } | { ok: false } {
  const id = extractStringFlag(ctx.flags, "agent");
  if (id === null) return { ok: true };

  const descriptors = getAgentDescriptors();
  const agent = descriptors.find((descriptor) => descriptor.id === id);
  if (!agent) {
    error(`Unknown agent: "${id}"`);
    info(`Supported agents: ${descriptors.map((descriptor) => descriptor.id).join(", ")}`);
    return { ok: false };
  }
  return { ok: true, agent };
}

/** Extract profile override flags from command context */
function extractProfileOverrides(ctx: CommandContext): ProfileOverrides | undefined {
  const test = extractStringFlag(ctx.flags, "test-cmd");
  const typecheck = extractStringFlag(ctx.flags, "typecheck-cmd");
  const lint = extractStringFlag(ctx.flags, "lint-cmd");
  const build = extractStringFlag(ctx.flags, "build-cmd");
  const format = extractStringFlag(ctx.flags, "format-cmd");

  // Only return overrides if at least one was specified
  if (test === null && typecheck === null && lint === null && build === null && format === null) {
    return undefined;
  }

  const overrides: ProfileOverrides = {};
  if (test !== null) overrides.test = test;
  if (typecheck !== null) overrides.typecheck = typecheck;
  if (lint !== null) overrides.lint = lint;
  if (build !== null) overrides.build = build;
  if (format !== null) overrides.format = format;

  return overrides;
}

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
        info(
          `Ensure the directory exists, then run: ${c.cyan(projectPath ? `rauf install ${projectPath}` : "rauf install <path>")}`,
        );
        break;
      case ErrorCodes.NOT_INSTALLED:
        info(
          `Rauf is not installed here. Run: ${c.cyan(projectPath ? `rauf install ${projectPath}` : "rauf install <path>")}`,
        );
        break;
      case ErrorCodes.INVALID_JSON:
      case ErrorCodes.VALIDATION_ERROR:
        info(
          `A project file may be corrupted. Try re-running: ${c.cyan(projectPath ? `rauf install ${projectPath} --yes` : "rauf install <path> --yes")}`,
        );
        break;
      case ErrorCodes.ALREADY_INSTALLED:
      case ErrorCodes.CONFLICT:
        info(
          `Use ${c.cyan(projectPath ? `rauf update ${projectPath}` : "rauf update <path>")} to update an existing installation.`,
        );
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
    case ErrorCodes.ALREADY_INSTALLED:
      return ExitCode.USAGE;
    case ErrorCodes.TRANSITION_INVALID:
      return ExitCode.USAGE;
    default:
      return ExitCode.ERROR;
  }
}

/** Print preflight check results */
function printPreflightResults(
  checks: Array<{ name: string; passed: boolean; message: string; severity: string }>,
): void {
  info(c.bold("Preflight Checks:"));
  for (const check of checks) {
    const icon = check.passed
      ? c.green(symbols.success)
      : check.severity === "error"
        ? c.red(symbols.error)
        : c.yellow(symbols.warning);
    info(`  ${icon} ${check.message}`);
  }
}

/** Print installation report in human-readable format */
function printInstallationReport(report: InstallationReport): void {
  success(`Rauf installed in ${c.bold(report.projectName)}`);
  info("");

  info(c.bold("Profile:"));
  info(`  Stack: ${report.profile.stack}`);
  if (report.profile.commands.test) info(`  Test:  ${report.profile.commands.test}`);
  if (report.profile.commands.typecheck) info(`  Type:  ${report.profile.commands.typecheck}`);
  if (report.profile.commands.lint) info(`  Lint:  ${report.profile.commands.lint}`);
  if (report.profile.commands.build) info(`  Build: ${report.profile.commands.build}`);
  if (report.profile.verify) info(`  Verify: ${report.profile.verify}`);
  info("");

  printActions(report.actions);
  printWarnings(report.warnings);
}

/** Print init report in human-readable format */
function printInitReport(report: InstallationReport): void {
  success(`Project initialized: ${c.bold(report.projectName)}`);
  info(`  Path: ${report.projectPath}`);
  info("");

  info(c.bold("Profile:"));
  info(`  Stack: ${report.profile.stack}`);
  if (report.profile.verify) info(`  Verify: ${report.profile.verify}`);
  info("");

  printActions(report.actions);
  printWarnings(report.warnings);

  info("");
  info(c.dim("Next steps:"));
  info(c.dim(`  cd ${report.projectPath}`));
  info(c.dim(`  rauf loop run  # Start the autonomous loop`));
}

/** Print update report in human-readable format */
function printUpdateReport(report: InstallationReport): void {
  success(`Rauf artifacts updated in ${c.bold(report.projectName)}`);
  info("");

  printActions(report.actions);
  printWarnings(report.warnings);
}

/** Print a report-only drift check (from `rauf update --check`) */
function printDriftReport(drift: DriftReport, projectPath: string): void {
  const name = c.bold(path.basename(projectPath));
  if (!drift.stale) {
    success(`${name} is up to date (${c.dim(drift.installedBy)})`);
    return;
  }

  warn(`${name} has stale rauf artifacts — run ${c.cyan(`rauf update ${projectPath}`)}`);
  info("");
  if (drift.toolVersionStale) {
    info(
      `  ${symbols.bullet} installed by ${c.yellow(drift.installedBy)}, current is ${c.green(drift.currentInstalledBy)}`,
    );
  }
  if (drift.deadHashKeys.length > 0) {
    info(
      `  ${symbols.bullet} stale artifact hash key(s): ${c.yellow(drift.deadHashKeys.join(", "))}`,
    );
  }
}

/** Print a list of install actions */
function printActions(actions: InstallationReport["actions"]): void {
  info(c.bold("Files:"));
  for (const action of actions) {
    const icon =
      action.action === "created"
        ? c.green("+")
        : action.action === "updated" || action.action === "rendered"
          ? c.yellow("~")
          : c.dim("-");
    const label = action.action === "skipped" ? c.dim(action.file) : action.file;
    info(`  ${icon} ${label}  ${c.dim(action.detail ?? "")}`);
  }
}

/** Print warnings if any */
function printWarnings(warnings: string[]): void {
  if (warnings.length > 0) {
    info("");
    for (const w of warnings) {
      warn(w);
    }
  }
}
