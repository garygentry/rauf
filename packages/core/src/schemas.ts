import { z } from "zod";

// ─── Enums & Primitives ────────────────────────────────────────────

export const BacklogItemTypeSchema = z.enum([
  "bug",
  "bugfix",
  "refactor",
  "feature",
  "chore",
  "test",
]);

export const BacklogItemStatusSchema = z.enum(["pending", "in_progress", "done", "blocked"]);

export const BacklogItemPrioritySchema = z.number().int().min(1).max(4) as z.ZodType<1 | 2 | 3 | 4>;

/** Item ID: recommended format is zero-padded digits ("001"), but any non-empty string is accepted. */
export const BacklogItemIdSchema = z.string().min(1, "ID must be non-empty");

// ─── AgentDelegation ──────────────────────────────────────────────

export const AgentDelegationSchema = z.object({
  recommendedConcurrency: z.number().int().min(2).optional(),
  strategy: z.string().optional(),
  subtasks: z.array(z.string()).optional(),
});

// ─── BacklogItem ───────────────────────────────────────────────────

export const BacklogItemSourceSchema = z.enum(["human", "review"]);

export const BacklogItemSchema = z.object({
  id: BacklogItemIdSchema,
  type: BacklogItemTypeSchema,
  priority: BacklogItemPrioritySchema,
  title: z.string().min(1, "Title must be non-empty"),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  status: BacklogItemStatusSchema,
  completedAt: z.string().nullable().optional(),
  blockedReason: z.string().optional(),
  /**
   * When true, this item is `blocked` specifically because it needs a human
   * decision/action (RAUF_NEEDS_HUMAN), as opposed to a code-level blocker.
   * The loop sets the item aside and continues; the human resolves it and
   * re-runs (`--retry-blocked`/`unblock`, which clears this flag).
   */
  needsHuman: z.boolean().optional(),
  /**
   * When true, this item is `blocked` because the RUNTIME gave up on it
   * (e.g. no signal after N retries), as opposed to the agent explicitly
   * blocking it (RAUF_BLOCKED) or asking for a human (needsHuman). A deferred
   * item keeps status `blocked`; this flag distinguishes a runner "false block"
   * — which `rauf reset`/`resume` requeue to pending — from a genuine block.
   */
  deferred: z.boolean().optional(),
  /**
   * A human's answer to a question this item raised (RAUF_NEEDS_HUMAN),
   * injected by `rauf resume --answer <id> "<text>"`. When set, the loop
   * threads it into the next iteration's prompt as a "Human's Answer"
   * section. Cleared automatically when the item completes so a later
   * unrelated retry never re-injects a stale answer.
   */
  humanAnswer: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  notes: z.string().optional(),
  estimatedIterations: z.number().int().positive().optional(),
  model: z.string().optional(),
  agentDelegation: AgentDelegationSchema.optional(),
  specReferences: z.array(z.string()).optional(),
  provider: z.string().optional(),
  source: BacklogItemSourceSchema.optional(),
  reviewBatch: z.string().optional(),
});

// ─── Backlog ───────────────────────────────────────────────────────

export const BacklogSchema = z.object({
  /**
   * Backlog contract version. Optional-with-default so existing backlogs
   * (which predate this field) keep validating — the default is stamped on
   * read. Never list this in the generated JSON Schema's `required` array.
   */
  schemaVersion: z.string().default("1"),
  project: z.string(),
  description: z.string(),
  items: z.array(BacklogItemSchema),
});

/** Normalize `dependencies` → `dependsOn` on each item in a raw backlog object. */
export function normalizeBacklogItems(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      return {
        ...obj,
        items: obj.items.map((item: unknown) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const rec = item as Record<string, unknown>;
            if ("dependencies" in rec && !("dependsOn" in rec)) {
              const { dependencies, ...rest } = rec;
              return { ...rest, dependsOn: dependencies };
            }
          }
          return item;
        }),
      };
    }
  }
  return data;
}

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

export const RuntimeSchema = z.enum(["shell", "global"]);

export const MarkerOptionsSchema = z.object({
  ignoreInTool: z.boolean(),
  gitignoreScripts: z.boolean(),
  maxIterations: z.number().int().positive(),
  model: z.string().optional(),
  autoSweep: z.boolean().optional(),
  sweepMinAgeDays: z.number().int().nonnegative().optional(),
  sessionTimeout: z.number().int().positive().optional(),
  /** Runtime mode: 'shell' (legacy scripts) or 'global' (TypeScript loop runner). Defaults to 'shell' when omitted for backward compat. */
  runtime: RuntimeSchema.optional(),
  provider: z.string().optional(),
  providerConfig: z.record(z.string(), z.unknown()).optional(),
});

// ─── MarkerFile (.rauf.json) ──────────────────────────────────────

export const MarkerFileSchema = z.object({
  rauf: z.literal(true),
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
  "idle",
  "starting",
  "running",
  "paused",
  "complete",
  "paused_human",
  "limit_reached",
  "error",
  "sleeping_limit",
  "weekly_limit",
  "reviewing",
  /** Clean halt when a usage limit is hit and sleepOnLimit is false — resumable via `rauf resume`. */
  "paused_usage_limit",
]);

export const LoopStateSignalSchema = z.enum(["clean", "blocked", "needs_human", "error"]);

export const LoopStateSchema = z.object({
  status: LoopStateStatusSchema,
  iteration: z.number().int().nonnegative(),
  maxIterations: z.number().int().positive(),
  currentItem: z.string().nullable(),
  lastSignal: LoopStateSignalSchema.nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  completedItems: z.array(z.string()),
  blockedItems: z.array(z.string()),
  /**
   * Items the runtime gave up on (deferred "false blocks"), distinct from
   * blockedItems (genuine agent blocks). Optional-with-default so existing
   * state.json predating this field still parses (missing → []).
   */
  deferredItems: z.array(z.string()).default([]),
  error: z.string().nullable(),
  sleepUntil: z.string().nullable().optional(),
  /**
   * HEAD commit hash captured at loop start, used as the baseline (`sinceRef`)
   * for commit reconciliation so only commits made during THIS run can recover
   * an item. Prevents a stale `[rauf] <id>:` commit from a prior backlog cycle
   * (rauf restarts ids at 001 every backlog) from falsely promoting a fresh
   * item. Optional-with-default so existing state.json predating this field
   * still parses (missing → null).
   */
  baseCommitHash: z.string().nullable().default(null),
});

// ─── ToolConfig (~/.rauf/config.json) ─────────────────────────────

export const ToolConfigThemeSchema = z.enum(["light", "dark", "system"]);

export const ToolConfigSchema = z.object({
  rootDirectory: z.string(),
  port: z.number().int().positive(),
  theme: ToolConfigThemeSchema,
  defaultProvider: z.string().optional(),
  providers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
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
  "SLEEPING_LIMIT",
  "WEEKLY_LIMIT",
]);

export const BacklogSummarySchema = z.object({
  pending: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  /** Every item with status `blocked` — includes both genuine blocks and runner-deferred ones. */
  blocked: z.number().int().nonnegative(),
  /** Subset of `blocked` that is blocked on a human decision (needsHuman flag). */
  needsHuman: z.number().int().nonnegative().optional(),
  /** Subset of `blocked` the runner gave up on (deferred flag — a "false block"). */
  deferred: z.number().int().nonnegative().optional(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/**
 * Liveness of a backlog root's `.loop.lock`, as surfaced in DerivedStatus.
 * Derived from core's `checkLock` — never reimplements PID checks.
 */
export const LockSummarySchema = z.object({
  /** Whether a lock file is present on disk. */
  present: z.boolean(),
  /** PID recorded in the lock file, if any. */
  pid: z.number().int().nullable(),
  /** ISO timestamp the lock was acquired, if recorded. */
  startedAt: z.string().nullable(),
  /** A live process still holds the lock (present, not stale). */
  alive: z.boolean(),
  /** The lock is stale — its PID is dead, recycled, or unreadable. */
  stale: z.boolean(),
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
  /** Lock-file liveness for this backlog root (present/alive/stale + PID). */
  lock: LockSummarySchema.optional(),
  sleepUntil: z.string().nullable().optional(),
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

export const RaufErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// ─── Log Patterns (fallback parsing) ───────────────────────────────

export const LOG_PATTERNS = {
  loopStart: /Loop started \(maxIterations=(\d+)\)/,
  iteration: /--- Iteration (\d+) \/ (\d+) ---/,
  done: /Item \S+ completed: .+/,
  blocked: /Item \S+ blocked: (.+)/,
  needsHuman: /Item \S+ needs human input(?: \(set aside\))?: (.+)/,
  complete: /Loop completed/,
  limitReached: /Max iterations reached \((\d+)\)/,
  timestamp: /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/,
} as const;

// ─── Valid Status Transitions ──────────────────────────────────────

export const VALID_STATUS_TRANSITIONS: Record<BacklogItemStatus, BacklogItemStatus[]> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["done", "blocked", "pending"],
  blocked: ["pending"],
  done: ["pending"],
};

// ─── Archive ───────────────────────────────────────────────────────

export const ArchiveMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  items: z.array(BacklogItemSchema),
});

export const SweepResultSchema = z.object({
  archivedCount: z.number().int().nonnegative(),
  archivedMonths: z.array(z.string()),
});

// ─── LoopStartOptions ─────────────────────────────────────────────

export const LoopStartOptionsSchema = z.object({
  maxIterations: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
  model: z.string().optional(),
  sessionTimeoutMinutes: z.number().int().positive(),
  provider: z.string().optional(),
  review: z.boolean().optional(),
  reviewOnly: z.boolean().optional(),
  backlogRoot: z.string().optional(),
  /**
   * Opt-in: suppress per-iteration review/security hooks inside the loop's
   * child agent sessions, deferring review to a single gate over the cumulative
   * branch diff. When true, a documented set of hook-suppression env vars is
   * merged into every child session's environment. Default behavior (undefined/
   * false) is unchanged — child sessions inherit the parent environment as-is.
   */
  suppressIterationReview: z.boolean().optional(),
  /**
   * Generic environment variable overrides applied to every child agent session
   * spawned by the loop. Values here take precedence over the suppression set
   * implied by `suppressIterationReview`. Not hardcoded to any one plugin —
   * use this to opt out of any hook that honors an env var.
   */
  childEnv: z.record(z.string(), z.string()).optional(),
  /**
   * When a 5-hour usage limit is hit, sleep until reset and continue (default,
   * unattended behavior). When false, halt cleanly instead: write the
   * `paused_usage_limit` state plus a DONE summary with a resume hint, and exit
   * so the run can be picked back up later with `rauf resume`.
   */
  sleepOnLimit: z.boolean().optional(),
  /**
   * Halt the loop after this many CONSECUTIVE infra_error spawn deaths (fast
   * non-zero exits with no usage banner). Prevents the loop from grinding
   * through the whole iteration budget when every spawn dies the same way.
   * Reset to 0 on any real outcome. Defaults to 3 when unset.
   */
  circuitBreakerThreshold: z.number().int().positive().optional(),
  /**
   * Opt-in: halt the loop when an item emits RAUF_NEEDS_HUMAN, so a supervising
   * session can detect the pause and inject an answer (e.g. `rauf resume
   * --answer`). The item is still set aside as blocked + needsHuman first. When
   * unset/false, behavior is unchanged — the loop keeps working other runnable
   * items after setting the needs-human item aside.
   */
  pauseOnNeedsHuman: z.boolean().optional(),
});

// ─── LoopEvent (discriminated union) ──────────────────────────────

const LoopEventBaseSchema = z.object({
  timestamp: z.string(),
  projectPath: z.string(),
});

const LoopEventLimitTypeSchema = z.enum(["5h", "7d"]);

const LoopStartedSchema = LoopEventBaseSchema.extend({
  type: z.literal("loop_started"),
  maxIterations: z.number().int().positive(),
  model: z.string().optional(),
});

const IterationStartSchema = LoopEventBaseSchema.extend({
  type: z.literal("iteration_start"),
  iteration: z.number().int().positive(),
  maxIterations: z.number().int().positive(),
});

const ItemSelectedSchema = LoopEventBaseSchema.extend({
  type: z.literal("item_selected"),
  itemId: z.string(),
  title: z.string(),
  priority: z.number().int(),
});

const LlmSpawnedSchema = LoopEventBaseSchema.extend({
  type: z.literal("llm_spawned"),
  itemId: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  timeoutMinutes: z.number().int().positive(),
});

const LlmExitedSchema = LoopEventBaseSchema.extend({
  type: z.literal("llm_exited"),
  itemId: z.string(),
  provider: z.string(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  durationMs: z.number().nonnegative(),
});

const SignalParsedSchema = LoopEventBaseSchema.extend({
  type: z.literal("signal_parsed"),
  itemId: z.string(),
  signal: z.enum(["done", "blocked", "needs_human", "review", "none"]),
  reason: z.string().optional(),
});

const ItemCompletedSchema = LoopEventBaseSchema.extend({
  type: z.literal("item_completed"),
  itemId: z.string(),
  title: z.string(),
});

const ItemBlockedSchema = LoopEventBaseSchema.extend({
  type: z.literal("item_blocked"),
  itemId: z.string(),
  reason: z.string(),
});

const ItemRetriedSchema = LoopEventBaseSchema.extend({
  type: z.literal("item_retried"),
  itemId: z.string(),
  attempt: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
});

const NeedsHumanSchema = LoopEventBaseSchema.extend({
  type: z.literal("needs_human"),
  itemId: z.string(),
  reason: z.string(),
});

const LoopPausedSchema = LoopEventBaseSchema.extend({
  type: z.literal("loop_paused"),
  reason: z.literal("needs_human"),
  itemId: z.string(),
});

const UsageLimitHitSchema = LoopEventBaseSchema.extend({
  type: z.literal("usage_limit_hit"),
  limitType: LoopEventLimitTypeSchema,
  utilization: z.number(),
});

const UsageLimitClearedSchema = LoopEventBaseSchema.extend({
  type: z.literal("usage_limit_cleared"),
  limitType: LoopEventLimitTypeSchema,
});

const SleepStartSchema = LoopEventBaseSchema.extend({
  type: z.literal("sleep_start"),
  sleepUntil: z.string(),
  reason: z.string(),
});

const SleepEndSchema = LoopEventBaseSchema.extend({
  type: z.literal("sleep_end"),
});

const LoopCompletedSchema = LoopEventBaseSchema.extend({
  type: z.literal("loop_completed"),
  completedCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  needsHumanCount: z.number().int().nonnegative().optional(),
});

const LoopErrorSchema = LoopEventBaseSchema.extend({
  type: z.literal("loop_error"),
  error: z.string(),
});

const LoopCancelledSchema = LoopEventBaseSchema.extend({
  type: z.literal("loop_cancelled"),
});

const ReviewStartedSchema = LoopEventBaseSchema.extend({
  type: z.literal("review_started"),
  completedItemIds: z.array(z.string()),
});

const ReviewCompletedSchema = LoopEventBaseSchema.extend({
  type: z.literal("review_completed"),
  itemsCreated: z.number().int().nonnegative(),
  summary: z.string(),
});

const ReviewFailedSchema = LoopEventBaseSchema.extend({
  type: z.literal("review_failed"),
  reason: z.string(),
});

const LlmToolActivitySchema = LoopEventBaseSchema.extend({
  type: z.literal("llm_tool_activity"),
  itemId: z.string(),
  toolName: z.string(),
  phase: z.enum(["start", "end"]),
});

const LlmTokenUpdateSchema = LoopEventBaseSchema.extend({
  type: z.literal("llm_token_update"),
  itemId: z.string(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
});

const LlmStuckWarningSchema = LoopEventBaseSchema.extend({
  type: z.literal("llm_stuck_warning"),
  itemId: z.string(),
  silentMs: z.number().nonnegative(),
});

export const LoopEventSchema = z.discriminatedUnion("type", [
  LoopStartedSchema,
  IterationStartSchema,
  ItemSelectedSchema,
  LlmSpawnedSchema,
  LlmExitedSchema,
  SignalParsedSchema,
  ItemCompletedSchema,
  ItemBlockedSchema,
  ItemRetriedSchema,
  NeedsHumanSchema,
  LoopPausedSchema,
  UsageLimitHitSchema,
  UsageLimitClearedSchema,
  SleepStartSchema,
  SleepEndSchema,
  LoopCompletedSchema,
  LoopErrorSchema,
  LoopCancelledSchema,
  ReviewStartedSchema,
  ReviewCompletedSchema,
  ReviewFailedSchema,
  LlmToolActivitySchema,
  LlmTokenUpdateSchema,
  LlmStuckWarningSchema,
]);

// ─── PersistedEvent (events.ndjson) ──────────────────────────────

/**
 * One line of events.ndjson: a full LoopEvent plus a per-run dense sequence
 * number and a schema-version tag.
 *
 * FLAT by design: the entire LoopEvent is preserved, so a reader needs no join
 * against another surface to interpret a record. This is the first
 * z.intersection in the codebase; intersecting the discriminated union with the
 * envelope forfeits the discriminated-union fast path but is acceptable at
 * Phase-1 event volumes. `LoopEventSchema.and(envelope)` is an equivalent
 * terser spelling.
 */
export const PersistedEventSchema = z.intersection(
  LoopEventSchema,
  z.object({
    /**
     * Monotonic, dense, per-run sequence number. Assigned ONLY when a record is
     * actually written to disk, so coalesced/dropped token updates never consume
     * a seq. Reset to 0 at the start of each run.
     */
    seq: z.number().int().nonnegative(),
    /**
     * Event-log schema version. "1" for Phase 1. Forward-stable machine
     * contract.
     */
    schemaVersion: z.string(),
  }),
);

// ─── ActiveLoopEntry (~/.rauf/active/<hash>.json) ────────────────

/**
 * A registry entry describing one currently-running loop. Written at loop start
 * (registerLoop), refreshed on each status transition (updateLoopStatus), and
 * removed at loop exit (deregisterLoop). One file per loop under ~/.rauf/active/,
 * keyed by sha256(resolvedStateDir)[:16].
 */
export const ActiveLoopEntrySchema = z.object({
  /** Resolved (absolute) state directory — the registry key source AND the
   *  reconciliation anchor (its .loop.lock is ground truth). */
  stateDir: z.string(),
  /** Project root the loop runs against (contains .rauf.json marker). */
  projectPath: z.string(),
  /** The --backlog root (equals projectPath/.rauf for the default root). */
  backlogRoot: z.string(),
  /** OS process id of the runner, used for liveness reconciliation. */
  pid: z.number().int(),
  /** ISO-8601 timestamp the loop registered. */
  startedAt: z.string(),
  /**
   * Advisory last-known status. state.json remains the SINGLE authoritative
   * source for current status; this field is a convenience for the cross-root
   * listing and MUST NOT be trusted over state.json.
   */
  status: LoopStateStatusSchema,
});

// ─── Event-log constants ─────────────────────────────────────────

/** events.ndjson record schema version. Forward-stable machine contract.
 *  Bumped only under the formal versioning discipline that lands in Phase 3. */
export const EVENTS_SCHEMA_VERSION = "1";

/**
 * Coalescing window for llm_token_update persistence: at most one token-update
 * record is written to events.ndjson per this interval (time-based,
 * last-write-wins). DELIBERATELY independent of, and finer than, the runner's
 * existing TOKEN_EVENT_THROTTLE_MS that gates iteration-status.json.
 */
export const TOKEN_COALESCE_MS = 1000;

/** Per-run event log file name within a backlog root's state directory. */
export const EVENTS_LOG_FILENAME = "events.ndjson";

// ─── Review Payload (parsed from RAUF_REVIEW signal) ─────────────

export const ReviewItemSchema = z.object({
  type: BacklogItemTypeSchema,
  priority: BacklogItemPrioritySchema,
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1),
});

export const ReviewPayloadSchema = z.object({
  items: z.array(ReviewItemSchema).min(1),
  summary: z.string(),
});

// ─── IterationStatus (.rauf/iteration-status.json) ───────────────

export const IterationStatusSchema = z.object({
  itemId: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  currentTool: z.string().nullable(),
  recentTools: z.array(z.string()).max(10),
  tokens: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
  lastActivityAt: z.string(),
  stuckWarning: z.boolean(),
});

// ─── Inferred Types ────────────────────────────────────────────────

export type BacklogItemType = z.infer<typeof BacklogItemTypeSchema>;
export type BacklogItemStatus = z.infer<typeof BacklogItemStatusSchema>;
export type AgentDelegation = z.infer<typeof AgentDelegationSchema>;
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
export type LockSummary = z.infer<typeof LockSummarySchema>;
export type DerivedStatus = z.infer<typeof DerivedStatusSchema>;
export type DiscoveredProject = z.infer<typeof DiscoveredProjectSchema>;
export type InstallAction = z.infer<typeof InstallActionSchema>;
export type InstallationReport = z.infer<typeof InstallationReportSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type RaufError = z.infer<typeof RaufErrorSchema>;
export type ArchiveMonth = z.infer<typeof ArchiveMonthSchema>;
export type SweepResult = z.infer<typeof SweepResultSchema>;
export type BacklogItemSource = z.infer<typeof BacklogItemSourceSchema>;
export type LoopStartOptions = z.infer<typeof LoopStartOptionsSchema>;
export type LoopEvent = z.infer<typeof LoopEventSchema>;
/** A LoopEvent persisted to events.ndjson, carrying seq + schemaVersion. */
export type PersistedEvent = z.infer<typeof PersistedEventSchema>;
/** One live-loop registry entry. */
export type ActiveLoopEntry = z.infer<typeof ActiveLoopEntrySchema>;
export type ReviewItem = z.infer<typeof ReviewItemSchema>;
export type ReviewPayload = z.infer<typeof ReviewPayloadSchema>;
export type IterationStatus = z.infer<typeof IterationStatusSchema>;
