// ─── migrate Command Handler ─────────────────────────────────────
//
// CLI adapter for core's Rauf→Rauf migration.
//
//   rauf migrate <path>                 migrate a project in place
//   rauf migrate <path> --dry-run       print the plan, write nothing
//   rauf migrate <path> --no-backup     skip backup copies
//   rauf migrate <path> --clean-backups remove backups left by a prior migrate
//   rauf migrate --global               move ~/.rauf → ~/.rauf
//
// Each handler: parse flags → resolve path → call core → format report.

import * as fs from "node:fs";
import * as path from "node:path";

import { planMigration, migrate, migrateGlobal, type MigrateReport } from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag } from "./parser.js";
import { c, info, print, error, warn, success, outputJson } from "./formatter.js";

// ─── handleMigrate ────────────────────────────────────────────────

export async function handleMigrate(ctx: CommandContext): Promise<number> {
  const global = extractBoolFlag(ctx.flags, "global");
  const dryRun = extractBoolFlag(ctx.flags, "dry-run");
  const noBackup = extractBoolFlag(ctx.flags, "no-backup");
  const cleanBackups = extractBoolFlag(ctx.flags, "clean-backups");

  // ── Global variant ──────────────────────────────────────────────
  if (global) {
    const result = migrateGlobal();
    if (!result.ok) {
      if (ctx.globalFlags.json) {
        outputJson({ error: result.error });
      } else {
        error(result.error.message);
      }
      return ExitCode.ERROR;
    }
    if (ctx.globalFlags.json) {
      outputJson(result.value);
    } else {
      printReport(result.value, { global: true });
    }
    return ExitCode.SUCCESS;
  }

  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf migrate <path> [--dry-run] [--no-backup] [--clean-backups]");
    info("       rauf migrate --global");
    return ExitCode.INVALID_ARGS;
  }
  const resolved = path.resolve(targetPath);

  // ── Clean-backups variant ───────────────────────────────────────
  if (cleanBackups) {
    return handleCleanBackups(resolved, ctx);
  }

  // ── Dry-run variant ─────────────────────────────────────────────
  if (dryRun) {
    const result = planMigration(resolved);
    if (!result.ok) {
      if (ctx.globalFlags.json) {
        outputJson({ error: result.error });
      } else {
        error(result.error.message);
      }
      return ExitCode.ERROR;
    }
    if (ctx.globalFlags.json) {
      outputJson(result.value);
    } else {
      info(c.bold(`Dry run — no files will be changed.`));
      printReport(result.value, {});
    }
    return ExitCode.SUCCESS;
  }

  // ── Real migration ──────────────────────────────────────────────
  const result = migrate(resolved, { backup: !noBackup });
  if (!result.ok) {
    if (ctx.globalFlags.json) {
      outputJson({ error: result.error });
    } else {
      error(result.error.message);
    }
    return errorExitCode(result.error.code);
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value);
    return ExitCode.SUCCESS;
  }

  printReport(result.value, {});
  if (result.value.applied) {
    success(`Migration complete: ${result.value.projectPath}`);
  }
  return ExitCode.SUCCESS;
}

// ─── handleCleanBackups ──────────────────────────────────────────

function handleCleanBackups(resolved: string, ctx: CommandContext): number {
  const candidates = [
    path.join(resolved, ".rauf.bak"),
    path.join(resolved, ".rauf.json.bak"),
    path.join(resolved, "CLAUDE.md.raufbak"),
  ];
  const removed: string[] = [];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fs.rmSync(candidate, { recursive: true, force: true });
        removed.push(candidate);
      }
    } catch (e) {
      warn(`Could not remove ${candidate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (ctx.globalFlags.json) {
    outputJson({ removed });
    return ExitCode.SUCCESS;
  }
  if (removed.length === 0) {
    info("No migration backups found.");
  } else {
    success(`Removed ${removed.length} backup(s):`);
    for (const r of removed) info(`  ${r}`);
  }
  return ExitCode.SUCCESS;
}

// ─── Report formatting ───────────────────────────────────────────

function printReport(report: MigrateReport, opts: { global?: boolean }): void {
  print("");
  print(`${c.bold("State:")} ${stateLabel(report.state)}`);

  if (report.steps.length > 0) {
    print("");
    print(c.bold(report.dryRun ? "Planned steps:" : "Steps performed:"));
    for (const step of report.steps) info(`  ${c.green("•")} ${step}`);
  }

  if (report.loopDirsRenamed.length > 0 && !report.dryRun) {
    // already covered by steps; skip duplicate listing
  }

  if (report.foreignDirsReported.length > 0) {
    print("");
    print(c.bold("Loop-like dirs left in place (no state.json):"));
    for (const d of report.foreignDirsReported) info(`  ${c.dim("-")} ${d}`);
  }

  if (report.staleLocks.length > 0) {
    print("");
    print(c.bold(`Stale locks ${report.dryRun ? "found" : "cleaned"}:`));
    for (const l of report.staleLocks) info(`  ${c.dim("-")} ${l.path} (pid ${l.pid})`);
  }

  if (report.claudeMdOutOfBlockRefs.length > 0) {
    print("");
    warn(
      `CLAUDE.md has ${report.claudeMdOutOfBlockRefs.length} 'ralph' reference(s) OUTSIDE the managed block — fix by hand:`,
    );
    for (const ref of report.claudeMdOutOfBlockRefs) {
      info(`  ${c.dim(`L${ref.line}:`)} ${ref.text}`);
    }
  }

  if (report.foreignConfigRefs.length > 0) {
    print("");
    warn(
      `These non-rauf config/state files reference '.rauf' — update them by hand (NOT auto-rewritten):`,
    );
    for (const ref of report.foreignConfigRefs) {
      info(`  ${c.dim(`${ref.path}:${ref.line}`)} ${ref.text}`);
    }
  }

  if (report.warnings.length > 0) {
    print("");
    for (const w of report.warnings) warn(w);
  }

  if (report.backupsCreated.length > 0) {
    print("");
    print(c.bold("Backups created (your safety net — not auto-deleted):"));
    for (const b of report.backupsCreated) info(`  ${b}`);
    if (!opts.global) {
      info(c.dim(`  Remove them later with: rauf migrate ${report.projectPath} --clean-backups`));
    }
  }

  print("");
}

function stateLabel(state: MigrateReport["state"]): string {
  switch (state) {
    case "legacy_ralph":
      return c.yellow("legacy_ralph (needs migration)");
    case "already_rauf":
      return c.green("already_rauf");
    case "partial":
      return c.yellow("partial (resumable)");
    case "marker_corrupt":
      return c.red("marker_corrupt");
    case "not_installed":
      return c.dim("not_installed");
    default:
      return state;
  }
}

function errorExitCode(code: string): number {
  if (code === "LOCK_CONFLICT") return ExitCode.CONFLICT;
  if (code === "INVALID_JSON" || code === "VALIDATION_ERROR") return ExitCode.VALIDATION;
  return ExitCode.ERROR;
}
