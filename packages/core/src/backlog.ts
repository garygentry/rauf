import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile, atomicWrite, fileExists } from "./fs-utils.js";
import {
  BacklogSchema,
  LoopStateSchema,
  VALID_STATUS_TRANSITIONS,
  type Backlog,
  type BacklogItem,
  type BacklogItemType,
  type BacklogItemStatus,
} from "./schemas.js";
import { readMarkerFile } from "./config.js";

// ─── Constants ───────────────────────────────────────────────────

const BACKLOG_DIR = ".ralph";
const BACKLOG_FILENAME = "backlog.json";
const STATE_FILENAME = "state.json";

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
}

// ─── Path helpers ────────────────────────────────────────────────

function getBacklogPath(projectPath: string): string {
  return path.join(path.resolve(projectPath), BACKLOG_DIR, BACKLOG_FILENAME);
}

function getStatePath(projectPath: string): string {
  return path.join(path.resolve(projectPath), BACKLOG_DIR, STATE_FILENAME);
}

// ─── readBacklog ─────────────────────────────────────────────────
//
// Read and validate .ralph/backlog.json.

export function readBacklog(projectPath: string): Result<Backlog> {
  return readJsonFile(getBacklogPath(projectPath), BacklogSchema);
}

// ─── writeBacklog ────────────────────────────────────────────────
//
// Atomic write with .bak backup (handled by atomicWrite for backlog.json).

export function writeBacklog(
  projectPath: string,
  backlog: Backlog,
): Result<void> {
  const content = JSON.stringify(backlog, null, 2) + "\n";
  return atomicWrite(getBacklogPath(projectPath), content);
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

export function addItem(
  projectPath: string,
  input: CreateItemInput,
): Result<BacklogItem> {
  // 1. Read current backlog
  const backlogResult = readBacklog(projectPath);
  if (!backlogResult.ok) return backlogResult;

  const backlog = backlogResult.value;

  // 2. Compute next ID: max(existing) + 1, zero-pad to 3 digits
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
    const markerResult = readMarkerFile(projectPath);
    const verifyCommand = markerResult.ok
      ? markerResult.value.profile.verify
      : "";
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
    ...(input.dependsOn && input.dependsOn.length > 0
      ? { dependsOn: input.dependsOn }
      : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.estimatedIterations !== undefined
      ? { estimatedIterations: input.estimatedIterations }
      : {}),
  };

  // 7. Append and write
  backlog.items.push(newItem);
  const writeResult = writeBacklog(projectPath, backlog);
  if (!writeResult.ok) return writeResult;

  return ok(newItem);
}

// ─── updateItem ──────────────────────────────────────────────────
//
// Enforces valid status transitions, auto-sets completedAt on done.

export function updateItem(
  projectPath: string,
  itemId: string,
  updates: UpdateItemInput,
): Result<BacklogItem> {
  // 1. Read backlog, find item
  const backlogResult = readBacklog(projectPath);
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
  if (updates.description !== undefined)
    updatedItem.description = updates.description;
  if (updates.acceptanceCriteria !== undefined)
    updatedItem.acceptanceCriteria = updates.acceptanceCriteria;
  if (updates.status !== undefined) updatedItem.status = updates.status;
  if (updates.blockedReason !== undefined)
    updatedItem.blockedReason = updates.blockedReason;
  if (updates.dependsOn !== undefined)
    updatedItem.dependsOn = updates.dependsOn;
  if (updates.notes !== undefined) updatedItem.notes = updates.notes;
  if (updates.estimatedIterations !== undefined)
    updatedItem.estimatedIterations = updates.estimatedIterations;

  // 5. Auto-set completedAt on done
  if (updates.status === "done") {
    updatedItem.completedAt = new Date().toISOString();
  }

  // 6. Write
  backlog.items[itemIndex] = updatedItem;
  const writeResult = writeBacklog(projectPath, backlog);
  if (!writeResult.ok) return writeResult;

  return ok(updatedItem);
}

// ─── deleteItem ──────────────────────────────────────────────────
//
// Blocks deletion of in_progress items if loop is active (state.json
// shows running/starting). Warns about dependent items via details.

export function deleteItem(
  projectPath: string,
  itemId: string,
): Result<void> {
  // 1. Read backlog, find item
  const backlogResult = readBacklog(projectPath);
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
    const statePath = getStatePath(projectPath);
    const stateResult = readJsonFile(statePath, LoopStateSchema);

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
  const writeResult = writeBacklog(projectPath, backlog);
  if (!writeResult.ok) return writeResult;

  return ok(undefined);
}

// ─── restoreFromBackup ──────────────────────────────────────────
//
// Copy .ralph/backlog.json.bak → .ralph/backlog.json if backup exists.

export function restoreFromBackup(projectPath: string): Result<void> {
  const backlogPath = getBacklogPath(projectPath);
  const bakPath = `${backlogPath}.bak`;

  if (!fileExists(bakPath)) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: "No backup file found",
      details: { path: bakPath },
    });
  }

  try {
    fs.copyFileSync(bakPath, backlogPath);
    return ok(undefined);
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to restore backup: ${e instanceof Error ? e.message : String(e)}`,
      details: { path: bakPath },
    });
  }
}

// ─── Exported constants (for testing) ────────────────────────────

export { BACKLOG_DIR, BACKLOG_FILENAME, STATE_FILENAME };
