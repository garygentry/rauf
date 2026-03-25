// @ralph/core — Shared business logic
// Modules will be added as backlog items are completed

export const VERSION = "0.1.0";

export * from "./schemas.js";
export * from "./errors.js";
export * from "./fs-utils.js";
export * from "./discovery.js";
export * from "./config.js";
export * from "./profile.js";
export * from "./template.js";
export * from "./claude-md.js";
export * from "./backlog-root.js";
export * from "./lock.js";
// Explicit re-export: BACKLOG_FILENAME and STATE_FILENAME come from backlog-root.js (canonical source).
// backlog.js also exports them for backward compat — suppress TS2308 with explicit picks.
export {
  BACKLOG_DIR,
  type CreateItemInput,
  type UpdateItemInput,
  readBacklog,
  writeBacklog,
  addItem,
  updateItem,
  deleteItem,
  restoreFromBackup,
  resetStalledItems,
  selectNextItem,
  ensureBacklog,
  validateStatusTransition,
  unblockItems,
} from "./backlog.js";
export * from "./archive.js";
export * from "./status.js";
export * from "./installer.js";
export * from "./greenfield.js";
export * from "./reset.js";
export * from "./embedded-artifacts.js";
export * from "./iteration-status.js";
