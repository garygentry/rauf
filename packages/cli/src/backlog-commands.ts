// ─── Backlog Management Command Handlers ─────────────────────────
//
// CLI adapters for core backlog CRUD functions.
// Each handler: parses flags → resolves paths → calls core → formats output.

import * as path from "node:path";

import {
  readBacklog,
  addItem,
  updateItem,
  deleteItem,
  restoreFromBackup,
  sweepBacklog,
  listArchiveMonths,
  readArchiveMonth,
  purgeArchive,
  resetProject,
  unblockItems,
  defaultBacklogPaths,
  ErrorCodes,
  type BacklogItem,
  type BacklogItemType,
  type BacklogItemStatus,
  type CreateItemInput,
  type UpdateItemInput,
} from "@ralph/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import {
  extractBoolFlag,
  extractStringFlag,
  extractNumberFlag,
  extractRepeatableFlag,
} from "./parser.js";
import {
  c,
  info,
  print,
  error,
  warn,
  success,
  outputJson,
  renderTable,
  symbols,
} from "./formatter.js";
import type { TableColumn } from "./formatter.js";

// ─── Constants ────────────────────────────────────────────────────

const VALID_TYPES = new Set<string>(["bug", "refactor", "feature", "chore"]);
const VALID_STATUSES = new Set<string>(["pending", "in_progress", "done", "blocked"]);

// ─── handleBacklogList ───────────────────────────────────────────

export async function handleBacklogList(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: ralph backlog list <path> [--status <s>] [--type <t>] [--json]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const statusFilter = extractStringFlag(ctx.flags, "status");
  const typeFilter = extractStringFlag(ctx.flags, "type");

  // Validate filter values
  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    error(`Invalid status filter: "${statusFilter}"`);
    info(`Valid statuses: ${[...VALID_STATUSES].join(", ")}`);
    return ExitCode.INVALID_ARGS;
  }
  if (typeFilter && !VALID_TYPES.has(typeFilter)) {
    error(`Invalid type filter: "${typeFilter}"`);
    info(`Valid types: ${[...VALID_TYPES].join(", ")}`);
    return ExitCode.INVALID_ARGS;
  }

  const result = readBacklog(defaultBacklogPaths(resolved));
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  let items = result.value.items;

  // Apply filters
  if (statusFilter) {
    items = items.filter((i) => i.status === statusFilter);
  }
  if (typeFilter) {
    items = items.filter((i) => i.type === typeFilter);
  }

  if (ctx.globalFlags.json) {
    outputJson(items);
    return ExitCode.SUCCESS;
  }

  if (items.length === 0) {
    info("No backlog items found.");
    return ExitCode.SUCCESS;
  }

  // Render table
  const columns: TableColumn[] = [
    { header: "ID", key: "id" },
    { header: "Type", key: "type" },
    { header: "Pri", key: "priority", align: "right" },
    { header: "Status", key: "status" },
    { header: "Title", key: "title", width: 50 },
  ];

  const rows = items.map((item) => ({
    id: item.id,
    type: item.type,
    priority: String(item.priority),
    status: colorStatus(item.status),
    title: item.title,
  }));

  print(renderTable(columns, rows));
  return ExitCode.SUCCESS;
}

// ─── handleBacklogAdd ────────────────────────────────────────────

export async function handleBacklogAdd(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info('Usage: ralph backlog add <path> --title "..." --type <t> --priority N [options]');
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const title = extractStringFlag(ctx.flags, "title");
  const type = extractStringFlag(ctx.flags, "type");
  const priorityNum = extractNumberFlag(ctx.flags, "priority");
  const dependsOnRaw = extractStringFlag(ctx.flags, "depends-on");
  const notes = extractStringFlag(ctx.flags, "notes");
  const description = extractStringFlag(ctx.flags, "description");
  const estimatedIterations = extractNumberFlag(ctx.flags, "estimated-iterations");

  // Extract repeatable --ac flags from raw argv
  const acValues = extractRepeatableFlag(ctx.rawArgv, "ac");
  // Also remove 'ac' from the flags map so it doesn't show as unknown
  ctx.flags.delete("ac");

  // Validate required fields
  if (!title) {
    error("Missing required flag: --title");
    return ExitCode.INVALID_ARGS;
  }
  if (!type) {
    error("Missing required flag: --type");
    return ExitCode.INVALID_ARGS;
  }
  if (!VALID_TYPES.has(type)) {
    error(`Invalid type: "${type}"`);
    info(`Valid types: ${[...VALID_TYPES].join(", ")}`);
    return ExitCode.INVALID_ARGS;
  }

  // Priority defaults to 2 if not specified
  const priority = priorityNum ?? 2;
  if (priority < 1 || priority > 4 || !Number.isInteger(priority)) {
    error("Priority must be an integer from 1 to 4");
    return ExitCode.INVALID_ARGS;
  }

  // Parse dependsOn comma-separated list
  const dependsOn = dependsOnRaw
    ? dependsOnRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  // Build input
  const input: CreateItemInput = {
    type: type as BacklogItemType,
    priority: priority as 1 | 2 | 3 | 4,
    title,
    description: description ?? undefined,
    acceptanceCriteria: acValues.length > 0 ? acValues : undefined,
    dependsOn,
    notes: notes ?? undefined,
    estimatedIterations: estimatedIterations ?? undefined,
  };

  // Warn if no --ac provided (smart default will be used)
  if (acValues.length === 0) {
    warn("No --ac flags provided. A smart default acceptance criterion will be added.");
  }

  const result = addItem(defaultBacklogPaths(resolved), input);
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  const newItem = result.value;

  if (ctx.globalFlags.json) {
    outputJson(newItem);
    return ExitCode.SUCCESS;
  }

  success(`Created item ${c.bold(newItem.id)}: ${newItem.title}`);
  return ExitCode.SUCCESS;
}

// ─── handleBacklogEdit ───────────────────────────────────────────

export async function handleBacklogEdit(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  const itemId = ctx.args[1];

  if (!targetPath || !itemId) {
    error("Missing required arguments: <path> <id>");
    info("Usage: ralph backlog edit <path> <id> [field options]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const title = extractStringFlag(ctx.flags, "title");
  const type = extractStringFlag(ctx.flags, "type");
  const priorityNum = extractNumberFlag(ctx.flags, "priority");
  const status = extractStringFlag(ctx.flags, "status");
  const description = extractStringFlag(ctx.flags, "description");
  const dependsOnRaw = extractStringFlag(ctx.flags, "depends-on");
  const notes = extractStringFlag(ctx.flags, "notes");
  const blockedReason = extractStringFlag(ctx.flags, "blocked-reason");
  const estimatedIterations = extractNumberFlag(ctx.flags, "estimated-iterations");

  // Extract repeatable --ac flags (replaces entire array)
  const acValues = extractRepeatableFlag(ctx.rawArgv, "ac");
  ctx.flags.delete("ac");

  // Validate type if provided
  if (type && !VALID_TYPES.has(type)) {
    error(`Invalid type: "${type}"`);
    info(`Valid types: ${[...VALID_TYPES].join(", ")}`);
    return ExitCode.INVALID_ARGS;
  }

  // Validate status if provided
  if (status && !VALID_STATUSES.has(status)) {
    error(`Invalid status: "${status}"`);
    info(`Valid statuses: ${[...VALID_STATUSES].join(", ")}`);
    return ExitCode.INVALID_ARGS;
  }

  // Validate priority if provided
  if (
    priorityNum !== null &&
    (priorityNum < 1 || priorityNum > 4 || !Number.isInteger(priorityNum))
  ) {
    error("Priority must be an integer from 1 to 4");
    return ExitCode.INVALID_ARGS;
  }

  // Parse dependsOn
  const dependsOn = dependsOnRaw
    ? dependsOnRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  // Build updates (only include fields that were specified)
  const updates: UpdateItemInput = {};
  if (title !== null) updates.title = title;
  if (type !== null) updates.type = type as BacklogItemType;
  if (priorityNum !== null) updates.priority = priorityNum as 1 | 2 | 3 | 4;
  if (status !== null) updates.status = status as BacklogItemStatus;
  if (description !== null) updates.description = description;
  if (acValues.length > 0) updates.acceptanceCriteria = acValues;
  if (dependsOn !== undefined) updates.dependsOn = dependsOn;
  if (notes !== null) updates.notes = notes;
  if (blockedReason !== null) updates.blockedReason = blockedReason;
  if (estimatedIterations !== null) updates.estimatedIterations = estimatedIterations;

  const result = updateItem(defaultBacklogPaths(resolved), itemId, updates);
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value);
    return ExitCode.SUCCESS;
  }

  success(`Updated item ${c.bold(itemId)}`);
  return ExitCode.SUCCESS;
}

// ─── handleBacklogDelete ─────────────────────────────────────────

export async function handleBacklogDelete(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  const itemId = ctx.args[1];

  if (!targetPath || !itemId) {
    error("Missing required arguments: <path> <id>");
    info("Usage: ralph backlog delete <path> <id> [--yes]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const yes = extractBoolFlag(ctx.flags, "yes");

  // Confirmation check — in non-interactive CLI mode, require --yes
  if (!yes) {
    error(`Deleting item ${itemId} requires confirmation.`);
    info("Pass --yes to confirm the deletion.");
    return ExitCode.INVALID_ARGS;
  }

  const result = deleteItem(defaultBacklogPaths(resolved), itemId);
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson({ deleted: itemId });
    return ExitCode.SUCCESS;
  }

  success(`Deleted item ${c.bold(itemId)}`);
  return ExitCode.SUCCESS;
}

// ─── handleBacklogShow ───────────────────────────────────────────

export async function handleBacklogShow(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  const itemId = ctx.args[1];

  if (!targetPath || !itemId) {
    error("Missing required arguments: <path> <id>");
    info("Usage: ralph backlog show <path> <id> [--json]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);

  const result = readBacklog(defaultBacklogPaths(resolved));
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  const item = result.value.items.find((i) => i.id === itemId);
  if (!item) {
    error(`Item not found: ${itemId}`);
    return ExitCode.NOT_FOUND;
  }

  if (ctx.globalFlags.json) {
    outputJson(item);
    return ExitCode.SUCCESS;
  }

  printItemDetail(item);
  return ExitCode.SUCCESS;
}

// ─── handleBacklogRestore ────────────────────────────────────────

export async function handleBacklogRestore(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: ralph backlog restore <path> [--yes]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const yes = extractBoolFlag(ctx.flags, "yes");

  if (!yes) {
    error("Restoring backlog from backup requires confirmation.");
    info("Pass --yes to confirm the restore.");
    return ExitCode.INVALID_ARGS;
  }

  const result = restoreFromBackup(defaultBacklogPaths(resolved));
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson({ restored: true, path: resolved });
    return ExitCode.SUCCESS;
  }

  success("Backlog restored from backup.");
  return ExitCode.SUCCESS;
}

// ─── handleBacklogSweep ──────────────────────────────────────────
//
// ralph backlog sweep <path> [--min-age-days N] [--dry-run] [--yes]

export async function handleBacklogSweep(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: ralph backlog sweep <path> [--min-age-days N] [--dry-run] [--yes]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const yes = extractBoolFlag(ctx.flags, "yes");
  const dryRun = extractBoolFlag(ctx.flags, "dry-run");
  const minAgeDays = extractNumberFlag(ctx.flags, "min-age-days");

  if (dryRun) {
    // Preview mode — read backlog and show what would be swept
    const backlogResult = readBacklog(defaultBacklogPaths(resolved));
    if (!backlogResult.ok) {
      return handleCoreError(backlogResult.error, ctx, resolved);
    }

    const minAge = minAgeDays ?? 0;
    const cutoff = minAge > 0 ? Date.now() - minAge * 86_400_000 : null;
    const currentMonth = new Date().toISOString().slice(0, 7);

    const toArchive = backlogResult.value.items.filter((item) => {
      if (item.status !== "done") return false;
      if (cutoff === null) return true;
      if (!item.completedAt) return true;
      return new Date(item.completedAt).getTime() <= cutoff;
    });

    if (toArchive.length === 0) {
      info("No done items would be swept.");
      return ExitCode.SUCCESS;
    }

    const columns: TableColumn[] = [
      { header: "ID", key: "id" },
      { header: "Title", key: "title", width: 40 },
      { header: "CompletedAt", key: "completedAt" },
      { header: "Target Month", key: "month" },
    ];

    const rows = toArchive.map((item) => ({
      id: item.id,
      title: item.title,
      completedAt: item.completedAt ? item.completedAt.slice(0, 10) : "(null)",
      month: item.completedAt ? item.completedAt.slice(0, 7) : currentMonth,
    }));

    print(renderTable(columns, rows));
    info(
      `${toArchive.length} item${toArchive.length === 1 ? "" : "s"} would be archived (dry run — no writes).`,
    );
    return ExitCode.SUCCESS;
  }

  if (!yes) {
    error("Sweeping requires confirmation.");
    info("Pass --yes to confirm. Use --dry-run to preview without writing.");
    return ExitCode.INVALID_ARGS;
  }

  const result = sweepBacklog(defaultBacklogPaths(resolved), { minAgeDays: minAgeDays ?? undefined });
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value);
    return ExitCode.SUCCESS;
  }

  if (result.value.archivedCount === 0) {
    info("No done items to archive.");
  } else {
    success(
      `Archived ${result.value.archivedCount} item${result.value.archivedCount === 1 ? "" : "s"} → ${result.value.archivedMonths.join(", ")}`,
    );
  }
  return ExitCode.SUCCESS;
}

// ─── handleBacklogArchiveList ─────────────────────────────────────
//
// ralph backlog archive list <path>

export async function handleBacklogArchiveList(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[1]; // args[0] is "list"
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: ralph backlog archive list <path>");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const monthsResult = listArchiveMonths(defaultBacklogPaths(resolved));
  if (!monthsResult.ok) {
    return handleCoreError(monthsResult.error, ctx, resolved);
  }

  const months = monthsResult.value;

  if (months.length === 0) {
    info("No archive files found.");
    return ExitCode.SUCCESS;
  }

  // Read each archive for item counts
  const rows: { month: string; count: string }[] = [];
  for (const month of months) {
    const archiveResult = readArchiveMonth(defaultBacklogPaths(resolved), month);
    const count = archiveResult.ok ? String(archiveResult.value.items.length) : "?";
    rows.push({ month, count });
  }

  if (ctx.globalFlags.json) {
    outputJson(rows.map((r) => ({ month: r.month, count: Number(r.count) })));
    return ExitCode.SUCCESS;
  }

  const columns: TableColumn[] = [
    { header: "Month", key: "month" },
    { header: "Items", key: "count", align: "right" },
  ];
  print(renderTable(columns, rows));
  return ExitCode.SUCCESS;
}

// ─── handleBacklogArchiveView ─────────────────────────────────────
//
// ralph backlog archive view <path> <month>

export async function handleBacklogArchiveView(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[1]; // args[0] is "view"
  const month = ctx.args[2];

  if (!targetPath || !month) {
    error("Missing required arguments: <path> <month>");
    info("Usage: ralph backlog archive view <path> <month>");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const result = readArchiveMonth(defaultBacklogPaths(resolved), month);
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value);
    return ExitCode.SUCCESS;
  }

  const { items } = result.value;
  if (items.length === 0) {
    info(`No items in archive for ${month}.`);
    return ExitCode.SUCCESS;
  }

  const columns: TableColumn[] = [
    { header: "ID", key: "id" },
    { header: "Type", key: "type" },
    { header: "Pri", key: "priority", align: "right" },
    { header: "Title", key: "title", width: 50 },
    { header: "Completed", key: "completedAt" },
  ];

  const rows = items.map((item) => ({
    id: item.id,
    type: item.type,
    priority: String(item.priority),
    title: item.title,
    completedAt: item.completedAt ? item.completedAt.slice(0, 10) : "(null)",
  }));

  print(renderTable(columns, rows));
  return ExitCode.SUCCESS;
}

// ─── handleBacklogArchivePurge ────────────────────────────────────
//
// ralph backlog archive purge <path> [--month YYYY-MM] [--yes]

export async function handleBacklogArchivePurge(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[1]; // args[0] is "purge"
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: ralph backlog archive purge <path> [--month YYYY-MM] [--yes]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const yes = extractBoolFlag(ctx.flags, "yes");
  const month = extractStringFlag(ctx.flags, "month");

  if (!yes) {
    error("Purging archive requires confirmation.");
    info("Pass --yes to confirm.");
    return ExitCode.INVALID_ARGS;
  }

  const result = purgeArchive(defaultBacklogPaths(resolved), month ?? undefined);
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value);
    return ExitCode.SUCCESS;
  }

  if (result.value.purgedCount === 0) {
    info("No archive files found to purge.");
  } else {
    success(
      `Purged ${result.value.purgedCount} archive file${result.value.purgedCount === 1 ? "" : "s"}: ${result.value.purgedMonths.join(", ")}`,
    );
  }
  return ExitCode.SUCCESS;
}

// ─── handleBacklogArchiveDispatch ─────────────────────────────────
//
// Dispatches "ralph backlog archive <subcommand> ..." to the relevant handler.

export async function handleBacklogArchiveDispatch(ctx: CommandContext): Promise<number> {
  const subcommand = ctx.args[0];

  switch (subcommand) {
    case "list":
      return handleBacklogArchiveList(ctx);
    case "view":
      return handleBacklogArchiveView(ctx);
    case "purge":
      return handleBacklogArchivePurge(ctx);
    default:
      error(`Unknown archive subcommand: "${subcommand ?? ""}"`);
      info("Valid subcommands: list, view, purge");
      info("Usage: ralph backlog archive <list|view|purge> <path> [options]");
      return ExitCode.INVALID_ARGS;
  }
}

// ─── handleBacklogReset ──────────────────────────────────────────
//
// ralph backlog reset <path> [--clear] [--yes] [--json]

export async function handleBacklogReset(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info(
      "Usage: ralph backlog reset <path> [--clear] [--keep-progress] [--keep-log] [--yes] [--json]",
    );
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const yes = extractBoolFlag(ctx.flags, "yes");
  const clear = extractBoolFlag(ctx.flags, "clear");
  const keepProgress = extractBoolFlag(ctx.flags, "keep-progress");
  const keepLog = extractBoolFlag(ctx.flags, "keep-log");

  if (!yes) {
    error("Resetting project state requires confirmation.");
    info(
      "Pass --yes to confirm. This will sweep done items, clear loop state, and reset stalled items.",
    );
    return ExitCode.INVALID_ARGS;
  }

  const result = resetProject(defaultBacklogPaths(resolved), {
    clearBacklog: clear,
    keepProgress,
    keepLog,
  });
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value);
    return ExitCode.SUCCESS;
  }

  const r = result.value;
  const parts: string[] = [];

  if (r.sweptCount > 0) {
    parts.push(
      `swept ${r.sweptCount} done item${r.sweptCount === 1 ? "" : "s"} → ${r.sweptMonths.join(", ")}`,
    );
  }
  if (r.stalledResetCount > 0) {
    parts.push(
      `reset ${r.stalledResetCount} stalled item${r.stalledResetCount === 1 ? "" : "s"} to pending`,
    );
  }
  if (r.stateCleared) {
    parts.push("cleared state.json");
  }
  if (r.backlogCleared) {
    parts.push("emptied backlog");
  }
  if (r.progressArchived) {
    parts.push("archived progress.md");
  }
  if (r.logArchived) {
    parts.push("archived ralph.log");
  }

  if (parts.length === 0) {
    info("Project was already clean — nothing to reset.");
  } else {
    success(`Reset complete: ${parts.join(", ")}.`);
  }

  return ExitCode.SUCCESS;
}

// ─── handleBacklogUnblock ─────────────────────────────────────────
//
// ralph backlog unblock <path> [id]

export async function handleBacklogUnblock(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: ralph backlog unblock <path> [id]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const itemId = ctx.args[1] ?? undefined;

  const result = unblockItems(defaultBacklogPaths(resolved), itemId);
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value);
    return ExitCode.SUCCESS;
  }

  if (result.value.unblockedCount === 0) {
    info("No blocked items found.");
  } else {
    success(
      `Unblocked ${result.value.unblockedCount} item${result.value.unblockedCount === 1 ? "" : "s"}: ${result.value.unblockedIds.join(", ")}`,
    );
  }
  return ExitCode.SUCCESS;
}

// ─── Shared helpers ──────────────────────────────────────────────

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
        info(
          `Ralph is not installed here. Run: ${c.cyan(projectPath ? `ralph install ${projectPath}` : "ralph install <path>")}`,
        );
        break;
      case ErrorCodes.INVALID_JSON:
      case ErrorCodes.VALIDATION_ERROR:
        info(
          `The backlog file may be corrupted. Recover with: ${c.cyan(projectPath ? `ralph backlog restore ${projectPath} --yes` : "ralph backlog restore <path> --yes")}`,
        );
        break;
      case ErrorCodes.TRANSITION_INVALID:
        info(
          "Valid transitions: pending → in_progress, in_progress → done or blocked, blocked → pending.",
        );
        break;
      case ErrorCodes.CONFLICT:
        info(
          `A loop may be running. Check with: ${c.cyan(projectPath ? `ralph status ${projectPath}` : "ralph status <path>")}`,
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
      return ExitCode.CONFLICT;
    case ErrorCodes.TRANSITION_INVALID:
      return ExitCode.VALIDATION;
    default:
      return ExitCode.ERROR;
  }
}

/** Colorize a status string for table display */
function colorStatus(status: string): string {
  switch (status) {
    case "pending":
      return c.dim(status);
    case "in_progress":
      return c.yellow(status);
    case "done":
      return c.green(status);
    case "blocked":
      return c.red(status);
    default:
      return status;
  }
}

/** Print detailed view of a single backlog item */
function printItemDetail(item: BacklogItem): void {
  print(`${c.bold("ID:")}       ${item.id}`);
  print(`${c.bold("Title:")}    ${item.title}`);
  print(`${c.bold("Type:")}     ${item.type}`);
  print(`${c.bold("Priority:")} ${item.priority}`);
  print(`${c.bold("Status:")}   ${colorStatus(item.status)}`);

  if (item.description) {
    print(`${c.bold("Description:")}`);
    print(`  ${item.description}`);
  }

  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    print(`${c.bold("Acceptance Criteria:")}`);
    for (const ac of item.acceptanceCriteria) {
      print(`  ${symbols.bullet} ${ac}`);
    }
  }

  if (item.dependsOn && item.dependsOn.length > 0) {
    print(`${c.bold("Depends On:")} ${item.dependsOn.join(", ")}`);
  }

  if (item.notes) {
    print(`${c.bold("Notes:")}    ${item.notes}`);
  }

  if (item.completedAt) {
    print(`${c.bold("Completed:")} ${item.completedAt}`);
  }

  if (item.blockedReason) {
    print(`${c.bold("Blocked:")}  ${item.blockedReason}`);
  }

  if (item.estimatedIterations) {
    print(`${c.bold("Est. Iterations:")} ${item.estimatedIterations}`);
  }
}
