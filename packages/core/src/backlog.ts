import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile, atomicWrite, fileExists } from "./fs-utils.js";
import {
  BacklogSchema,
  LoopStateSchema,
  VALID_STATUS_TRANSITIONS,
  normalizeBacklogItems,
  type AgentDelegation,
  type Backlog,
  type BacklogItem,
  type BacklogItemType,
  type BacklogItemStatus,
  type BacklogItemSource,
} from "./schemas.js";
import { readMarkerFile } from "./config.js";
import type { BacklogPaths } from "./backlog-root.js";

// ─── Input Types ─────────────────────────────────────────────────

export interface CreateItemInput {
  type: BacklogItemType;
  priority: 1 | 2 | 3 | 4;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  notes?: string;
  estimatedIterations?: number;
  agentDelegation?: AgentDelegation;
  specReferences?: string[];
  source?: BacklogItemSource;
  reviewBatch?: string;
}

export interface UpdateItemInput {
  type?: BacklogItemType;
  priority?: 1 | 2 | 3 | 4;
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  status?: BacklogItemStatus;
  blockedReason?: string;
  dependsOn?: string[];
  notes?: string;
  estimatedIterations?: number;
  agentDelegation?: AgentDelegation;
  specReferences?: string[];
}

// ─── readBacklog ─────────────────────────────────────────────────
//
// Read and validate backlog.json.

export function readBacklog(paths: BacklogPaths): Result<Backlog> {
  return readJsonFile(paths.backlog, BacklogSchema, normalizeBacklogItems);
}

// ─── writeBacklog ────────────────────────────────────────────────
//
// Atomic write with .bak backup (handled by atomicWrite for backlog.json).

export function writeBacklog(paths: BacklogPaths, backlog: Backlog): Result<void> {
  const content = JSON.stringify(backlog, null, 2) + "\n";
  return atomicWrite(paths.backlog, content);
}

// ─── validateStatusTransition ────────────────────────────────────
//
// Check against the allowed transitions map from schemas.ts.

export function validateStatusTransition(
  current: BacklogItemStatus,
  target: BacklogItemStatus,
): boolean {
  if (current === target) return true;
  const allowed = VALID_STATUS_TRANSITIONS[current];
  return allowed.includes(target);
}

// ─── addItem ─────────────────────────────────────────────────────
//
// Auto-assigns zero-padded ID (max+1), injects smart default
// criterion if no AC provided, validates dependsOn references.

export function addItem(paths: BacklogPaths, input: CreateItemInput): Result<BacklogItem> {
  // 1. Read current backlog
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;

  const backlog = backlogResult.value;

  // 2. Compute next numeric ID: max(existing) + 1, zero-pad to 3 digits.
  // Non-numeric IDs (e.g. "notif-001") are ignored — parseInt returns NaN
  // which loses the > comparison, so max stays at its current value.
  const maxId = backlog.items.reduce((max, item) => {
    const num = parseInt(item.id, 10);
    return num > max ? num : max;
  }, 0);
  const nextId = String(maxId + 1).padStart(3, "0");

  // 3. Validate title
  if (!input.title.trim()) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Title must be non-empty",
    });
  }

  // 4. Validate dependsOn references
  if (input.dependsOn && input.dependsOn.length > 0) {
    const existingIds = new Set(backlog.items.map((i) => i.id));
    const missing = input.dependsOn.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `dependsOn references non-existent items: ${missing.join(", ")}`,
        details: { missingIds: missing },
      });
    }
  }

  // 5. Smart default criteria if none provided
  let criteria = input.acceptanceCriteria ?? [];
  if (criteria.length === 0) {
    const markerResult = readMarkerFile(paths.projectPath);
    const verifyCommand = markerResult.ok ? markerResult.value.profile.verify : "";
    const defaultCriterion = verifyCommand
      ? `${verifyCommand} passes`
      : "All verification checks pass";
    criteria = [defaultCriterion];
  }

  // 6. Construct full BacklogItem
  const newItem: BacklogItem = {
    id: nextId,
    type: input.type,
    priority: input.priority,
    title: input.title,
    description: input.description ?? "",
    acceptanceCriteria: criteria,
    status: "pending",
    completedAt: null,
    ...(input.dependsOn && input.dependsOn.length > 0 ? { dependsOn: input.dependsOn } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.estimatedIterations !== undefined
      ? { estimatedIterations: input.estimatedIterations }
      : {}),
    ...(input.agentDelegation !== undefined ? { agentDelegation: input.agentDelegation } : {}),
    ...(input.specReferences !== undefined ? { specReferences: input.specReferences } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.reviewBatch !== undefined ? { reviewBatch: input.reviewBatch } : {}),
  };

  // 7. Append and write
  backlog.items.push(newItem);
  const writeResult = writeBacklog(paths, backlog);
  if (!writeResult.ok) return writeResult;

  return ok(newItem);
}

// ─── updateItem ──────────────────────────────────────────────────
//
// Enforces valid status transitions, auto-sets completedAt on done.

export function updateItem(
  paths: BacklogPaths,
  itemId: string,
  updates: UpdateItemInput,
): Result<BacklogItem> {
  // 1. Read backlog, find item
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;

  const backlog = backlogResult.value;
  const itemIndex = backlog.items.findIndex((i) => i.id === itemId);

  if (itemIndex === -1) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Item not found: ${itemId}`,
      details: { itemId },
    });
  }

  const item = backlog.items[itemIndex]!;

  // 2. Validate status transition if status is being changed
  if (updates.status !== undefined && updates.status !== item.status) {
    if (!validateStatusTransition(item.status, updates.status)) {
      return err({
        code: ErrorCodes.TRANSITION_INVALID,
        message: `Cannot transition from "${item.status}" to "${updates.status}"`,
        details: {
          currentStatus: item.status,
          targetStatus: updates.status,
          allowedTransitions: VALID_STATUS_TRANSITIONS[item.status],
        },
      });
    }
  }

  // 3. Validate dependsOn references if changed
  if (updates.dependsOn && updates.dependsOn.length > 0) {
    const existingIds = new Set(backlog.items.map((i) => i.id));
    const missing = updates.dependsOn.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `dependsOn references non-existent items: ${missing.join(", ")}`,
        details: { missingIds: missing },
      });
    }
  }

  // 4. Merge updates onto item
  const updatedItem: BacklogItem = { ...item };
  if (updates.type !== undefined) updatedItem.type = updates.type;
  if (updates.priority !== undefined) updatedItem.priority = updates.priority;
  if (updates.title !== undefined) updatedItem.title = updates.title;
  if (updates.description !== undefined) updatedItem.description = updates.description;
  if (updates.acceptanceCriteria !== undefined)
    updatedItem.acceptanceCriteria = updates.acceptanceCriteria;
  if (updates.status !== undefined) updatedItem.status = updates.status;
  if (updates.blockedReason !== undefined) updatedItem.blockedReason = updates.blockedReason;
  if (updates.dependsOn !== undefined) updatedItem.dependsOn = updates.dependsOn;
  if (updates.notes !== undefined) updatedItem.notes = updates.notes;
  if (updates.estimatedIterations !== undefined)
    updatedItem.estimatedIterations = updates.estimatedIterations;
  if (updates.agentDelegation !== undefined) updatedItem.agentDelegation = updates.agentDelegation;
  if (updates.specReferences !== undefined) updatedItem.specReferences = updates.specReferences;

  // 5. Auto-set completedAt on done
  if (updates.status === "done") {
    updatedItem.completedAt = new Date().toISOString();
  }

  // 6. Write
  backlog.items[itemIndex] = updatedItem;
  const writeResult = writeBacklog(paths, backlog);
  if (!writeResult.ok) return writeResult;

  return ok(updatedItem);
}

// ─── deleteItem ──────────────────────────────────────────────────
//
// Blocks deletion of in_progress items if loop is active (state.json
// shows running/starting). Warns about dependent items via details.

export function deleteItem(paths: BacklogPaths, itemId: string): Result<void> {
  // 1. Read backlog, find item
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;

  const backlog = backlogResult.value;
  const itemIndex = backlog.items.findIndex((i) => i.id === itemId);

  if (itemIndex === -1) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Item not found: ${itemId}`,
      details: { itemId },
    });
  }

  const item = backlog.items[itemIndex]!;

  // 2. Block deletion of in_progress items if loop is active
  if (item.status === "in_progress") {
    const stateResult = readJsonFile(paths.state, LoopStateSchema);

    if (stateResult.ok) {
      const state = stateResult.value;
      if (state.status === "running" || state.status === "starting") {
        return err({
          code: ErrorCodes.CONFLICT,
          message: `Cannot delete in-progress item "${itemId}" while loop is active`,
          details: { itemId, loopStatus: state.status },
        });
      }
    }
    // If state.json missing/invalid, loop is not active — allow deletion
  }

  // 3. Remove from items array and write
  backlog.items.splice(itemIndex, 1);
  const writeResult = writeBacklog(paths, backlog);
  if (!writeResult.ok) return writeResult;

  return ok(undefined);
}

// ─── restoreFromBackup ──────────────────────────────────────────
//
// Copy .ralph/backlog.json.bak → .ralph/backlog.json if backup exists.

export function restoreFromBackup(paths: BacklogPaths): Result<void> {
  const bakPath = `${paths.backlog}.bak`;

  if (!fileExists(bakPath)) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: "No backup file found",
      details: { path: bakPath },
    });
  }

  try {
    fs.copyFileSync(bakPath, paths.backlog);
    return ok(undefined);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to restore backup: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: bakPath },
    });
  }
}

// ─── selectNextItem ──────────────────────────────────────────────
//
// Returns the highest-priority pending item whose dependencies are
// all done. Returns null if no eligible items exist.
// Ties in priority broken by lower item ID (lexicographic).

export function selectNextItem(backlog: Backlog): BacklogItem | null {
  // Build a set of done item IDs for O(1) lookup
  const doneIds = new Set(backlog.items.filter((i) => i.status === "done").map((i) => i.id));

  // Filter to pending items with all dependencies satisfied
  const eligible = backlog.items.filter((item) => {
    if (item.status !== "pending") return false;
    const deps = item.dependsOn ?? [];
    return deps.every((depId) => doneIds.has(depId));
  });

  if (eligible.length === 0) return null;

  // Sort by priority (ascending), then by ID (lexicographic ascending)
  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  return eligible[0]!;
}

// ─── resetStalledItems ───────────────────────────────────────────
//
// Reads backlog, resets all in_progress items to pending via
// updateItem. Returns count of reset items.

export function resetStalledItems(paths: BacklogPaths): Result<{ resetCount: number }> {
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;

  const inProgressItems = backlogResult.value.items.filter((i) => i.status === "in_progress");

  let resetCount = 0;
  for (const item of inProgressItems) {
    const result = updateItem(paths, item.id, { status: "pending" });
    if (!result.ok) return result;
    resetCount++;
  }

  return ok({ resetCount });
}

// ─── ensureBacklog ────────────────────────────────────────────────
//
// If .ralph/ exists but backlog.json does not, create an empty one.
// Returns NOT_INSTALLED if .ralph/ itself is missing.

export function ensureBacklog(paths: BacklogPaths): Result<void> {
  // If backlog already exists, nothing to do
  if (fileExists(paths.backlog)) return ok(undefined);

  // For default root: check if .ralph/ dir exists — NOT_INSTALLED if missing
  if (path.basename(paths.root) === ".ralph" && !fileExists(paths.root)) {
    return err({
      code: ErrorCodes.NOT_INSTALLED,
      message: `Ralph is not installed at ${paths.projectPath}`,
    });
  }

  // Create empty backlog
  const projectName = path.basename(paths.projectPath);

  const emptyBacklog: Backlog = {
    project: projectName,
    description: "",
    items: [],
  };

  return writeBacklog(paths, emptyBacklog);
}

// ─── unblockItems ─────────────────────────────────────────────────
//
// Transition blocked items back to pending and clear blockedReason.
// If itemId provided, unblock just that item; otherwise unblock all.

export function unblockItems(
  paths: BacklogPaths,
  itemId?: string,
): Result<{ unblockedCount: number; unblockedIds: string[] }> {
  const backlogResult = readBacklog(paths);
  if (!backlogResult.ok) return backlogResult;

  const backlog = backlogResult.value;

  if (itemId !== undefined) {
    // Single item mode
    const item = backlog.items.find((i) => i.id === itemId);
    if (!item) {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Item not found: ${itemId}`,
        details: { itemId },
      });
    }
    if (item.status !== "blocked") {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Item ${itemId} is not blocked (status: ${item.status})`,
        details: { itemId, currentStatus: item.status },
      });
    }
    item.status = "pending";
    delete item.blockedReason;

    const writeResult = writeBacklog(paths, backlog);
    if (!writeResult.ok) return writeResult;

    return ok({ unblockedCount: 1, unblockedIds: [itemId] });
  }

  // All blocked items mode
  const blockedItems = backlog.items.filter((i) => i.status === "blocked");
  if (blockedItems.length === 0) {
    return ok({ unblockedCount: 0, unblockedIds: [] });
  }

  for (const item of blockedItems) {
    item.status = "pending";
    delete item.blockedReason;
  }

  const writeResult = writeBacklog(paths, backlog);
  if (!writeResult.ok) return writeResult;

  return ok({
    unblockedCount: blockedItems.length,
    unblockedIds: blockedItems.map((i) => i.id),
  });
}
