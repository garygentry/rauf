import { z } from "zod";

// ─── Enums & Primitives ────────────────────────────────────────────

export const BacklogItemTypeSchema = z.enum([
  "bug",
  "refactor",
  "feature",
  "chore",
]);

export const BacklogItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "done",
  "blocked",
]);

export const BacklogItemPrioritySchema = z
  .number()
  .int()
  .min(1)
  .max(4) as z.ZodType<1 | 2 | 3 | 4>;

/** Zero-padded sequential ID: "001", "002", etc. */
export const BacklogItemIdSchema = z.string().regex(/^\d{3,}$/, {
  message: "ID must be zero-padded digits (e.g. '001')",
});

// ─── BacklogItem ───────────────────────────────────────────────────

export const BacklogItemSchema = z.object({
  id: BacklogItemIdSchema,
  type: BacklogItemTypeSchema,
  priority: BacklogItemPrioritySchema,
  title: z.string().min(1, "Title must be non-empty"),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  status: BacklogItemStatusSchema,
  completedAt: z.string().nullable(),
  blockedReason: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  notes: z.string().optional(),
  estimatedIterations: z.number().int().positive().optional(),
  model: z.string().optional(),
});

// ─── Backlog ───────────────────────────────────────────────────────

export const BacklogSchema = z.object({
  project: z.string(),
  description: z.string(),
  items: z.array(BacklogItemSchema),
});

// ─── ProfileCommands ───────────────────────────────────────────────

export const ProfileCommandsSchema = z.object({
  test: z.string().nullable(),
  typecheck: z.string().nullable(),
  lint: z.string().nullable(),
  build: z.string().nullable(),
  format: z.string().nullable(),
});

// ─── ProjectProfile ────────────────────────────────────────────────

export const ProjectProfileSchema = z.object({
  stack: z.string(),
  packageManager: z.string().nullable(),
  monorepo: z.boolean(),
  commands: ProfileCommandsSchema,
  verify: z.string(),
});

// ─── MarkerOptions ─────────────────────────────────────────────────

export const MarkerOptionsSchema = z.object({
  ignoreInTool: z.boolean(),
  gitignoreScripts: z.boolean(),
  maxIterations: z.number().int().positive(),
  model: z.string().optional(),
});

// ─── MarkerFile (.ralph.json) ──────────────────────────────────────

export const MarkerFileSchema = z.object({
  ralph: z.literal(true),
  version: z.string(),
  variant: z.literal("backlog-json"),
  installedAt: z.string(),
  installedBy: z.string(),
  profile: ProjectProfileSchema,
  artifactHashes: z.record(z.string(), z.string()),
  options: MarkerOptionsSchema,
});

// ─── LoopState (state.json) ────────────────────────────────────────

export const LoopStateStatusSchema = z.enum([
  "starting",
  "running",
  "paused",
  "complete",
  "paused_human",
  "limit_reached",
  "error",
]);

export const LoopStateSignalSchema = z.enum([
  "clean",
  "blocked",
  "needs_human",
  "error",
]);

export const LoopStateSchema = z.object({
  status: LoopStateStatusSchema,
  iteration: z.number().int().nonnegative(),
  maxIterations: z.number().int().positive(),
  currentItem: z.string().nullable(),
  lastSignal: LoopStateSignalSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  completedItems: z.array(z.string()),
  blockedItems: z.array(z.string()),
  error: z.string().nullable(),
});

// ─── ToolConfig (~/.ralph/config.json) ─────────────────────────────

export const ToolConfigThemeSchema = z.enum(["light", "dark", "system"]);

export const ToolConfigSchema = z.object({
  rootDirectory: z.string(),
  port: z.number().int().positive(),
  theme: ToolConfigThemeSchema,
});

// ─── DerivedStatus ─────────────────────────────────────────────────

export const LoopStateEnumSchema = z.enum([
  "IDLE",
  "RUNNING",
  "PAUSED",
  "COMPLETE",
  "PAUSED_HUMAN",
  "LIMIT_REACHED",
  "ERROR",
  "NOT_INSTALLED",
]);

export const BacklogSummarySchema = z.object({
  pending: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const DerivedStatusSchema = z.object({
  loopState: LoopStateEnumSchema,
  stateSource: z.enum(["state.json", "log-parsing", "none"]),
  iteration: z.number().int().nullable(),
  maxIterations: z.number().int().nullable(),
  currentItem: z.string().nullable(),
  lastSignal: z.string().nullable(),
  startedAt: z.string().nullable(),
  elapsed: z.number().nullable(),
  backlogSummary: BacklogSummarySchema,
});

// ─── DiscoveredProject ─────────────────────────────────────────────

export const DiscoveredProjectSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  marker: MarkerFileSchema,
});

// ─── InstallationReport ────────────────────────────────────────────

export const InstallActionSchema = z.object({
  file: z.string(),
  action: z.enum(["created", "updated", "skipped", "merged", "rendered"]),
  detail: z.string(),
});

export const InstallationReportSchema = z.object({
  projectName: z.string(),
  projectPath: z.string(),
  actions: z.array(InstallActionSchema),
  profile: ProjectProfileSchema,
  warnings: z.array(z.string()),
});

// ─── API Response Wrappers ─────────────────────────────────────────

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

// ApiSuccess is generic — exported as a schema factory
export function apiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ data: dataSchema });
}

// ─── Result Type (core internal) ───────────────────────────────────

export const RalphErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// ─── Log Patterns (fallback parsing) ───────────────────────────────

export const LOG_PATTERNS = {
  loopStart: /Ralph Loop starting \| max=(\d+) iterations/,
  iteration: /--- Iteration (\d+) \/ (\d+) ---/,
  status:
    /Status → pending:(\d+)\s+in_progress:(\d+)\s+blocked:(\d+)\s+done:(\d+)\s+total:(\d+)/,
  done: /✓ Clean completion signal received/,
  blocked: /⚠ Task blocked: ([^\s]+)/,
  needsHuman: /⛔ Loop paused — human input needed: (.+)/,
  complete: /COMPLETE: (.+)/,
  limitReached: /LIMIT REACHED: (.+)/,
  timestamp: /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/,
} as const;

// ─── Valid Status Transitions ──────────────────────────────────────

export const VALID_STATUS_TRANSITIONS: Record<
  BacklogItemStatus,
  BacklogItemStatus[]
> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["done", "blocked", "pending"],
  blocked: ["pending"],
  done: ["pending"],
};

// ─── Inferred Types ────────────────────────────────────────────────

export type BacklogItemType = z.infer<typeof BacklogItemTypeSchema>;
export type BacklogItemStatus = z.infer<typeof BacklogItemStatusSchema>;
export type BacklogItem = z.infer<typeof BacklogItemSchema>;
export type Backlog = z.infer<typeof BacklogSchema>;
export type ProfileCommands = z.infer<typeof ProfileCommandsSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type MarkerOptions = z.infer<typeof MarkerOptionsSchema>;
export type MarkerFile = z.infer<typeof MarkerFileSchema>;
export type LoopStateStatus = z.infer<typeof LoopStateStatusSchema>;
export type LoopStateSignal = z.infer<typeof LoopStateSignalSchema>;
export type LoopState = z.infer<typeof LoopStateSchema>;
export type ToolConfigTheme = z.infer<typeof ToolConfigThemeSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type LoopStateEnum = z.infer<typeof LoopStateEnumSchema>;
export type BacklogSummary = z.infer<typeof BacklogSummarySchema>;
export type DerivedStatus = z.infer<typeof DerivedStatusSchema>;
export type DiscoveredProject = z.infer<typeof DiscoveredProjectSchema>;
export type InstallAction = z.infer<typeof InstallActionSchema>;
export type InstallationReport = z.infer<typeof InstallationReportSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type RalphError = z.infer<typeof RalphErrorSchema>;
