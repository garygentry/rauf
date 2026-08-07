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
  resolveBacklogRoot,
  resolveBacklogPaths,
  validateBacklog,
  ErrorCodes,
  BacklogItemTypeSchema,
  BacklogItemStatusSchema,
  type BacklogItem,
  type BacklogItemType,
  type BacklogItemStatus,
  type CreateItemInput,
  type UpdateItemInput,
} from "@rauf/core";

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

// Derived from the Zod source of truth so the CLI can never drift from the
// schema (the hardcoded list previously omitted `bugfix` and `test`).
const VALID_TYPES = new Set<string>(BacklogItemTypeSchema.options);
const VALID_STATUSES = new Set<string>(BacklogItemStatusSchema.options);

// ─── handleBacklogList ───────────────────────────────────────────

export async function handleBacklogList(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf backlog list <path> [--status <s>] [--type <t>] [--json]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const statusFilter = extractStringFlag(ctx.flags, "status");
  const typeFilter = extractStringFlag(ctx.flags, "type");

  // Validate filter values
  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    error(`Invalid status filter: "${statusFilter}"`);
    info(`Valid statuses: ${[...VALID_STATUSES].join(", ")}`);
    return ExitCode.USAGE;
  }
  if (typeFilter && !VALID_TYPES.has(typeFilter)) {
    error(`Invalid type filter: "${typeFilter}"`);
    info(`Valid types: ${[...VALID_TYPES].join(", ")}`);
    return ExitCode.USAGE;
  }

  const result = readBacklog(paths);
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
    info('Usage: rauf backlog add <path> --title "..." --type <t> --priority N [options]');
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
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
    return ExitCode.USAGE;
  }
  if (!type) {
    error("Missing required flag: --type");
    return ExitCode.USAGE;
  }
  if (!VALID_TYPES.has(type)) {
    error(`Invalid type: "${type}"`);
    info(`Valid types: ${[...VALID_TYPES].join(", ")}`);
    return ExitCode.USAGE;
  }

  // Priority defaults to 2 if not specified
  const priority = priorityNum ?? 2;
  if (priority < 1 || priority > 4 || !Number.isInteger(priority)) {
    error("Priority must be an integer from 1 to 4");
    return ExitCode.USAGE;
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

  const result = addItem(paths, input);
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
    info("Usage: rauf backlog edit <path> <id> [field options]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
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
    return ExitCode.USAGE;
  }

  // Validate status if provided
  if (status && !VALID_STATUSES.has(status)) {
    error(`Invalid status: "${status}"`);
    info(`Valid statuses: ${[...VALID_STATUSES].join(", ")}`);
    return ExitCode.USAGE;
  }

  // Validate priority if provided
  if (
    priorityNum !== null &&
    (priorityNum < 1 || priorityNum > 4 || !Number.isInteger(priorityNum))
  ) {
    error("Priority must be an integer from 1 to 4");
    return ExitCode.USAGE;
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

  const result = updateItem(paths, itemId, updates);
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
    info("Usage: rauf backlog delete <path> <id> [--yes]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const yes = extractBoolFlag(ctx.flags, "yes");

  // Confirmation check — in non-interactive CLI mode, require --yes
  if (!yes) {
    error(`Deleting item ${itemId} requires confirmation.`);
    info("Pass --yes to confirm the deletion.");
    return ExitCode.USAGE;
  }

  const result = deleteItem(paths, itemId);
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
    info("Usage: rauf backlog show <path> <id> [--json]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;

  const result = readBacklog(paths);
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  const item = result.value.items.find((i) => i.id === itemId);
  if (!item) {
    error(`Item not found: ${itemId}`);
    return ExitCode.USAGE;
  }

  if (ctx.globalFlags.json) {
    outputJson(item);
    return ExitCode.SUCCESS;
  }

  printItemDetail(item);
  return ExitCode.SUCCESS;
}

// ─── handleBacklogValidate ───────────────────────────────────────
//
// rauf backlog validate <path> [--backlog <dir>] [--specs-dir <dir>] [--json]
//
// Exit codes (contract — see SPEC-BACKLOG-TOOL-CONTRACT.md):
//   0 = valid (no error findings; warnings allowed)
//   1 = validation findings (one or more errors)
//   2 = usage / IO error (missing path, unreadable file, bad JSON)

export async function handleBacklogValidate(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf backlog validate <path> [--backlog <dir>] [--specs-dir <dir>] [--json]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    if (ctx.globalFlags.json) outputJson({ error: backlogRootResult.error });
    else error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    // e.g. no backlog.json found → usage/IO error
    if (ctx.globalFlags.json) outputJson({ error: pathsResult.error });
    else error(pathsResult.error.message);
    return ExitCode.USAGE;
  }
  const paths = pathsResult.value;

  // --specs-dir is resolved relative to the target project path. When absent,
  // specReferences-existence is skipped (the repo-wide ad-hoc flow has no specs).
  const specsDirFlag = extractStringFlag(ctx.flags, "specs-dir");
  const specsDir = specsDirFlag ? path.resolve(resolved, specsDirFlag) : undefined;

  const result = validateBacklog(paths, { specsDir });
  if (!result.ok) {
    // IO / JSON-parse failure → usage/IO exit code (2), NOT a validation finding.
    if (ctx.globalFlags.json) outputJson({ error: result.error });
    else error(result.error.message);
    return ExitCode.USAGE;
  }

  const { valid, findings } = result.value;

  if (ctx.globalFlags.json) {
    outputJson({ valid, findings });
    return valid ? ExitCode.SUCCESS : ExitCode.ERROR;
  }

  for (const f of findings) {
    const loc = f.itemId ? ` [${f.itemId}]` : f.path ? ` [${f.path}]` : "";
    const line = `${f.code}${loc}: ${f.message}`;
    if (f.severity === "error") error(line);
    else warn(line);
  }

  if (valid) {
    const warnCount = findings.length;
    success(
      warnCount > 0
        ? `Backlog is valid (${warnCount} warning${warnCount === 1 ? "" : "s"}).`
        : "Backlog is valid.",
    );
    return ExitCode.SUCCESS;
  }

  const errCount = findings.filter((f) => f.severity === "error").length;
  error(`Backlog is invalid: ${errCount} error${errCount === 1 ? "" : "s"}.`);
  return ExitCode.ERROR;
}

// ─── handleBacklogRestore ────────────────────────────────────────

export async function handleBacklogRestore(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf backlog restore <path> [--yes]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const yes = extractBoolFlag(ctx.flags, "yes");

  if (!yes) {
    error("Restoring backlog from backup requires confirmation.");
    info("Pass --yes to confirm the restore.");
    return ExitCode.USAGE;
  }

  const result = restoreFromBackup(paths);
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
// rauf backlog sweep <path> [--min-age-days N] [--dry-run] [--yes]

export async function handleBacklogSweep(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf backlog sweep <path> [--min-age-days N] [--dry-run] [--yes]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const yes = extractBoolFlag(ctx.flags, "yes");
  const dryRun = extractBoolFlag(ctx.flags, "dry-run");
  const minAgeDays = extractNumberFlag(ctx.flags, "min-age-days");

  if (dryRun) {
    // Preview mode — read backlog and show what would be swept
    const backlogResult = readBacklog(paths);
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
    return ExitCode.USAGE;
  }

  const result = sweepBacklog(paths, { minAgeDays: minAgeDays ?? undefined });
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
// rauf backlog archive list <path>

export async function handleBacklogArchiveList(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[1]; // args[0] is "list"
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf backlog archive list <path>");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const monthsResult = listArchiveMonths(paths);
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
    const archiveResult = readArchiveMonth(paths, month);
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
// rauf backlog archive view <path> <month>

export async function handleBacklogArchiveView(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[1]; // args[0] is "view"
  const month = ctx.args[2];

  if (!targetPath || !month) {
    error("Missing required arguments: <path> <month>");
    info("Usage: rauf backlog archive view <path> <month>");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const result = readArchiveMonth(paths, month);
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
// rauf backlog archive purge <path> [--month YYYY-MM] [--yes]

export async function handleBacklogArchivePurge(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[1]; // args[0] is "purge"
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf backlog archive purge <path> [--month YYYY-MM] [--yes]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const yes = extractBoolFlag(ctx.flags, "yes");
  const month = extractStringFlag(ctx.flags, "month");

  if (!yes) {
    error("Purging archive requires confirmation.");
    info("Pass --yes to confirm.");
    return ExitCode.USAGE;
  }

  const result = purgeArchive(paths, month ?? undefined);
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
// Dispatches "rauf backlog archive <subcommand> ..." to the relevant handler.

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
      info("Usage: rauf backlog archive <list|view|purge> <path> [options]");
      return ExitCode.USAGE;
  }
}

// ─── handleBacklogReset ──────────────────────────────────────────
//
// rauf backlog reset <path> [--clear] [--yes] [--json]

export async function handleBacklogReset(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info(
      "Usage: rauf backlog reset <path> [--clear] [--keep-progress] [--keep-log] [--yes] [--json]",
    );
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const yes = extractBoolFlag(ctx.flags, "yes");
  const clear = extractBoolFlag(ctx.flags, "clear");
  const keepProgress = extractBoolFlag(ctx.flags, "keep-progress");
  const keepLog = extractBoolFlag(ctx.flags, "keep-log");

  if (!yes) {
    error("Resetting project state requires confirmation.");
    info(
      "Pass --yes to confirm. This will sweep done items, clear loop state, and reset stalled items.",
    );
    return ExitCode.USAGE;
  }

  const result = resetProject(paths, {
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
    parts.push("archived rauf.log");
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
// rauf backlog unblock <path> [id]

export async function handleBacklogUnblock(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf backlog unblock <path> [id]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const itemId = ctx.args[1] ?? undefined;

  const result = unblockItems(paths, itemId);
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

// ─── handleBacklogAnswer ──────────────────────────────────────────
//
// rauf backlog answer <path> <id> "<text>"
//
// Apply-only twin of `resume --answer`'s injection block: thread a human
// answer into a blocked item and re-queue it to pending, with NO relaunch.

export async function handleBacklogAnswer(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  const itemId = ctx.args[1];
  const text = ctx.args[2];
  if (!targetPath || !itemId || text === undefined) {
    error("Missing required arguments: <path> <id> <text>");
    info('Usage: rauf backlog answer <path> <id> "<text>" [--backlog <dir>] [--json]');
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;

  // Refuse unless the item is currently `blocked` — mirrors unblockItems'
  // not-blocked guard so `answer` and `unblock` reject identically. Reading
  // first also yields a precise "not found" vs "not blocked".
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) {
    return handleCoreError(backlogResult.error, ctx, resolved);
  }
  const item = backlogResult.value.items.find((i) => i.id === itemId);
  if (!item) {
    error(`Item not found: ${itemId}`);
    return ExitCode.USAGE;
  }
  if (item.status !== "blocked") {
    error(`Item ${itemId} is not blocked (status: ${item.status})`);
    return ExitCode.USAGE;
  }

  // Same write as resume --answer's injection — but the command returns
  // after the write; there is no detection/relaunch step.
  const result = updateItem(paths, itemId, {
    humanAnswer: text,
    status: "pending",
    needsHuman: false,
    blockedReason: null,
  });
  if (!result.ok) {
    return handleCoreError(result.error, ctx, resolved);
  }

  if (ctx.globalFlags.json) {
    outputJson({ answered: itemId, status: "pending" });
    return ExitCode.SUCCESS;
  }
  success(`Answered ${itemId} — re-queued to pending with the answer threaded.`);
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
          `Rauf is not installed here. Run: ${c.cyan(projectPath ? `rauf install ${projectPath}` : "rauf install <path>")}`,
        );
        break;
      case ErrorCodes.INVALID_JSON:
      case ErrorCodes.VALIDATION_ERROR:
        info(
          `The backlog file may be corrupted. Recover with: ${c.cyan(projectPath ? `rauf backlog restore ${projectPath} --yes` : "rauf backlog restore <path> --yes")}`,
        );
        break;
      case ErrorCodes.TRANSITION_INVALID:
        info(
          "Valid transitions: pending → in_progress, in_progress → done or blocked, blocked → pending.",
        );
        break;
      case ErrorCodes.CONFLICT:
        info(
          `A loop may be running. Check with: ${c.cyan(projectPath ? `rauf status ${projectPath}` : "rauf status <path>")}`,
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
      return ExitCode.USAGE;
    case ErrorCodes.TRANSITION_INVALID:
      return ExitCode.USAGE;
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
