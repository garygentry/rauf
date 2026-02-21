// ─── Install / Init / Update / Uninstall Command Handlers ───────
//
// CLI adapters for core installer and greenfield modules.
// Each handler: parses flags → resolves paths → calls core → formats output.

import * as path from "node:path";
import * as fs from "node:fs";

import {
  install,
  update,
  uninstall,
  preflight,
  initProject,
  ErrorCodes,
  type InstallationReport,
  type ProfileOverrides,
} from "@ralph/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag, extractStringFlag } from "./parser.js";
import { c, info, error, warn, success, outputJson, symbols } from "./formatter.js";

// ─── Constants ────────────────────────────────────────────────────

/**
 * Resolve the canonical artifacts directory.
 *
 * In development, artifacts live at `<repo>/artifacts/variants/backlog-json/`.
 * The CLI binary is at `<repo>/packages/cli/src/` — walk up to repo root.
 * In a compiled binary, artifacts will be embedded (item 038), but for now
 * we resolve relative to the CLI source directory.
 */
function resolveArtifactsDir(): string {
  // __dirname equivalent: directory of this file
  const cliSrcDir = path.dirname(new URL(import.meta.url).pathname);
  // Walk up: packages/cli/src → packages/cli → packages → repo root
  const repoRoot = path.resolve(cliSrcDir, "..", "..", "..");
  return path.join(repoRoot, "artifacts", "variants", "backlog-json");
}

// ─── handleInstall ───────────────────────────────────────────────

export async function handleInstall(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info(`Usage: ralph install <path> [options]`);
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const yes = extractBoolFlag(ctx.flags, "yes");
  const gitignoreScripts = extractBoolFlag(ctx.flags, "gitignore-scripts");

  // Extract profile override flags
  const overrides = extractProfileOverrides(ctx);

  // Resolve artifacts directory
  const artifactsDir = resolveArtifactsDir();

  // Run preflight first for display (unless --yes)
  if (!yes) {
    const preflightResult = preflight(resolved);
    printPreflightResults(preflightResult.checks);

    if (!preflightResult.passed) {
      error("Preflight checks failed. Fix the issues above and try again.");
      if (ctx.globalFlags.json) {
        outputJson({ error: { code: "PREFLIGHT_FAILED", checks: preflightResult.checks } });
      }

      // Map to specific exit code based on which check failed
      const dirCheck = preflightResult.checks.find((c) => c.name === "directory_exists");
      if (dirCheck && !dirCheck.passed) return ExitCode.NOT_FOUND;
      return ExitCode.ERROR;
    }

    info("");
  }

  // Run installation
  const result = install(resolved, {
    artifactsDir,
    profileOverrides: overrides,
    options: {
      gitignoreScripts,
    },
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
    info(`Usage: ralph init <path> [options]`);
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const name = extractStringFlag(ctx.flags, "name");
  const description = extractStringFlag(ctx.flags, "description");
  const stack = extractStringFlag(ctx.flags, "stack");
  const seed = extractStringFlag(ctx.flags, "seed");

  // Extract profile override flags
  const overrides = extractProfileOverrides(ctx);

  // Resolve artifacts directory
  const artifactsDir = resolveArtifactsDir();

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
    return ExitCode.INVALID_ARGS;
  }

  // Check target doesn't already exist as a ralph project
  if (fs.existsSync(path.join(resolved, ".ralph.json"))) {
    error(
      `Path "${resolved}" already has a .ralph.json. Use 'ralph install' for existing projects.`,
    );
    return ExitCode.CONFLICT;
  }

  const result = initProject(resolved, {
    artifactsDir,
    projectName: name ?? undefined,
    projectDescription: description ?? undefined,
    preset: stack ?? undefined,
    profileOverrides: overrides,
    seedFile: seed ?? undefined,
    rootDirectory: ctx.globalFlags.root ?? undefined,
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
    info(`Usage: ralph update <path> [--yes]`);
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  extractBoolFlag(ctx.flags, "yes"); // consume --yes flag (not yet used for confirmation)

  // Resolve artifacts directory
  const artifactsDir = resolveArtifactsDir();

  const result = update(resolved, { artifactsDir });

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
    info(`Usage: ralph uninstall <path> [--yes] [--keep-data]`);
    return ExitCode.INVALID_ARGS;
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

  success(`Ralph uninstalled from ${resolved}`);
  if (keepData) {
    info("  Data files (backlog.json, progress.md, ralph.log) preserved.");
  } else {
    info("  Data files preserved by default. Use without --keep-data to see defaults.");
  }
  return ExitCode.SUCCESS;
}

// ─── Shared helpers ──────────────────────────────────────────────

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
          `Ensure the directory exists, then run: ${c.cyan(projectPath ? `ralph install ${projectPath}` : "ralph install <path>")}`,
        );
        break;
      case ErrorCodes.NOT_INSTALLED:
        info(
          `Ralph is not installed here. Run: ${c.cyan(projectPath ? `ralph install ${projectPath}` : "ralph install <path>")}`,
        );
        break;
      case ErrorCodes.INVALID_JSON:
      case ErrorCodes.VALIDATION_ERROR:
        info(
          `A project file may be corrupted. Try re-running: ${c.cyan(projectPath ? `ralph install ${projectPath} --yes` : "ralph install <path> --yes")}`,
        );
        break;
      case ErrorCodes.ALREADY_INSTALLED:
      case ErrorCodes.CONFLICT:
        info(
          `Use ${c.cyan(projectPath ? `ralph update ${projectPath}` : "ralph update <path>")} to update an existing installation.`,
        );
        break;
    }
  }

  switch (err.code) {
    case ErrorCodes.FILE_NOT_FOUND:
      return ExitCode.NOT_FOUND;
    case ErrorCodes.NOT_INSTALLED:
      return ExitCode.NOT_FOUND;
    case ErrorCodes.INVALID_JSON:
      return ExitCode.VALIDATION;
    case ErrorCodes.VALIDATION_ERROR:
      return ExitCode.VALIDATION;
    case ErrorCodes.CONFLICT:
    case ErrorCodes.ALREADY_INSTALLED:
      return ExitCode.CONFLICT;
    case ErrorCodes.TRANSITION_INVALID:
      return ExitCode.VALIDATION;
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
  success(`Ralph installed in ${c.bold(report.projectName)}`);
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
  info(c.dim(`  ./ralph.sh    # Start the autonomous loop`));
}

/** Print update report in human-readable format */
function printUpdateReport(report: InstallationReport): void {
  success(`Ralph artifacts updated in ${c.bold(report.projectName)}`);
  info("");

  printActions(report.actions);
  printWarnings(report.warnings);
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
