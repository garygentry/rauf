---
title: Schemas Reference
description: All data structures used across the rauf system, mapping directly to Zod schemas.
---

All data structures used across the rauf system. These map directly to Zod schemas in `packages/core/src/schemas.ts`.

## ArchiveMonth

Stored in `.rauf/archive/YYYY-MM.json`. Each file holds all done items swept for a given calendar month.

```typescript
interface ArchiveMonth {
  month: string; // YYYY-MM format
  items: BacklogItem[];
}
```

## SweepResult

Returned by `sweepBacklog()` and `POST /api/projects/:id/backlog/sweep`.

```typescript
interface SweepResult {
  archivedCount: number; // Items moved to archive
  archivedMonths: string[]; // YYYY-MM strings of files written (sorted)
}
```

## BacklogItem

```typescript
interface BacklogItem {
  id: string; // Zero-padded sequential: "001", "002", ...
  type: "bug" | "bugfix" | "refactor" | "feature" | "chore" | "test";
  priority: 1 | 2 | 3 | 4; // 1 = highest
  title: string; // Non-empty
  description: string;
  acceptanceCriteria: string[]; // At least one after smart defaults
  status: "pending" | "in_progress" | "done" | "blocked";
  completedAt: string | null; // ISO 8601 datetime or null
  blockedReason?: string; // Present when status is "blocked"
  needsHuman?: boolean; // When true, item is blocked awaiting a human decision (RAUF_NEEDS_HUMAN) — `rauf reset`/`resume` leave these blocked
  deferred?: boolean; // When true, item is blocked because the runner gave up (no signal after maxRetries) — a "false block" requeued by `rauf reset`/`resume`
  humanAnswer?: string; // A human's answer injected via `rauf resume --answer <id> "<text>"`; threaded into the next prompt and auto-cleared when the item completes
  dependsOn?: string[]; // Item IDs this depends on
  notes?: string; // Free-text context, links, hints
  estimatedIterations?: number; // Expected iterations to complete
  model?: string; // Per-item model override. Prefer tier aliases ("opus", "sonnet"); append "[1m]" for the 1M window ("opus[1m]"). Overrides CLI arg and project default.
  agentDelegation?: AgentDelegation;
  specReferences?: string[]; // Paths to spec docs
  provider?: string; // Per-item LLM provider override
  source?: "human" | "review"; // Origin: manually created or review-generated
  reviewBatch?: string; // ISO timestamp grouping review-created items
}

interface AgentDelegation {
  recommendedConcurrency?: number; // Min 2
  strategy?: string;
  subtasks?: string[];
}
```

### ID Assignment

- `max(existing IDs as numbers) + 1`, zero-padded to 3 digits
- IDs never renumbered; gaps from deletions are acceptable
- Example sequence: "001", "002", "003" → delete "002" → next is "004"

### Status Transitions (valid)

```
pending → in_progress | blocked
in_progress → done | blocked | pending
blocked → pending
done → pending
```

All other transitions are rejected.

### Smart Default Acceptance Criteria

When creating an item with no explicit criteria, auto-inject: `"{{verifyCommand}} passes"` (resolved from project profile). This criterion gets an "auto" badge in UI.

## Backlog (full file)

```typescript
interface Backlog {
  project: string; // Project name
  description: string; // Project description
  items: BacklogItem[];
}
```

File: `.rauf/backlog.json`

## MarkerFile (.rauf.json)

```typescript
interface MarkerFile {
  rauf: true; // Sentinel — must be literal true
  version: string; // Schema version, currently "1"
  variant: "backlog-json"; // Artifact variant
  installedAt: string; // ISO 8601
  installedBy: string; // Tool version string
  profile: ProjectProfile;
  artifactHashes: Record<string, string>; // filename → SHA-256 hex
  options: MarkerOptions;
}

interface ProjectProfile {
  stack: string; // e.g., "node-typescript", "python", "go", "unknown"
  packageManager: string | null; // "pnpm" | "npm" | "yarn" | "bun" | null
  monorepo: boolean;
  commands: ProfileCommands;
  verify: string; // Composite: non-null commands joined with " && "
}

interface ProfileCommands {
  test: string | null;
  typecheck: string | null;
  lint: string | null;
  build: string | null;
  format: string | null;
}

interface MarkerOptions {
  ignoreInTool: boolean; // Default: false
  gitignoreScripts: boolean; // Default: false
  maxIterations: number; // Default: 20
  model?: string; // Project-level default model (e.g., "sonnet"). Prefer tier aliases; append "[1m]" for the 1M window. Overridden by CLI --model flag and per-item BacklogItem.model.
  autoSweep?: boolean; // If true, loop runner automatically sweeps done items on startup. Default: false.
  sweepMinAgeDays?: number; // Only sweep done items older than N days. 0 = sweep all done items. Default: 0.
  sessionTimeout?: number; // Max minutes per Claude session before kill+retry. Default: 60.
  runtime?: "shell" | "global"; // Loop runtime mode. "shell" = legacy scripts (deprecated), "global" = TypeScript loop runner. Defaults to "shell" when omitted for backward compat.
  provider?: string; // Default LLM provider for this project
  providerConfig?: Record<string, unknown>; // Per-provider configuration
}
```

## LoopState (state.json)

```typescript
interface LoopState {
  status:
    | "idle" // No loop active (initial state)
    | "starting"
    | "running"
    | "paused"
    | "complete"
    | "paused_human"
    | "limit_reached"
    | "error"
    | "sleeping_limit" // Sleeping until 5-hour Claude usage window resets
    | "weekly_limit" // 7-day weekly Claude usage cap exhausted
    | "reviewing" // Running post-loop review pass
    | "paused_usage_limit"; // Clean halt when usage limit hit and sleepOnLimit=false — resumable via `rauf resume`
  iteration: number;
  maxIterations: number;
  currentItem: string | null; // Backlog item ID
  lastSignal: "clean" | "blocked" | "needs_human" | "error";
  startedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  completedItems: string[]; // Item IDs
  blockedItems: string[]; // Item IDs (genuine agent blocks)
  deferredItems: string[]; // Item IDs the runner gave up on ("false blocks" — distinct from genuine agent blocks)
  baseCommitHash: string | null; // HEAD commit captured at loop start — used as `sinceRef` to bound commit reconciliation to commits after the baseline (prevents false-recovery from a prior backlog cycle; see SPEC-CORE.md § Commit Reconciliation)
  error: string | null;
  sleepUntil?: string | null; // ISO 8601 — present when status is sleeping_limit or weekly_limit
}
```

| Status value         | Meaning                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `idle`               | No loop active (initial state)                                                               |
| `starting`           | Loop initializing                                                                            |
| `running`            | Actively processing an item                                                                  |
| `paused`             | Gracefully stopped (CANCEL signal)                                                           |
| `complete`           | All items resolved                                                                           |
| `paused_human`       | Waiting for human input (`RAUF_NEEDS_HUMAN`)                                                 |
| `limit_reached`      | Max iterations config exceeded                                                               |
| `error`              | Unexpected termination                                                                       |
| `sleeping_limit`     | Sleeping until 5-hour Claude usage window resets                                             |
| `weekly_limit`       | 7-day weekly Claude usage cap exhausted                                                      |
| `reviewing`          | Running post-loop review pass                                                                |
| `paused_usage_limit` | Usage limit hit with `sleepOnLimit=false` — loop halted cleanly, resumable via `rauf resume` |

File: `.rauf/state.json` (written by the loop runner, read by status derivation)

## ToolConfig (~/.rauf/config.json)

```typescript
interface ToolConfig {
  rootDirectory: string; // Absolute path
  port: number; // Default: 5173
  theme: "light" | "dark" | "system"; // Default: "system"
  defaultProvider?: string; // Default LLM provider
  providers?: Record<string, Record<string, unknown>>; // Per-provider configuration
}
```

## LockSummary

Liveness of a backlog root's `.loop.lock`, included in `DerivedStatus`. Derived from `checkLock` in `packages/core` — never reimplements PID checks.

```typescript
interface LockSummary {
  present: boolean; // Whether a lock file exists on disk
  pid: number | null; // PID recorded in the lock file, if any
  startedAt: string | null; // ISO timestamp the lock was acquired, if recorded
  alive: boolean; // A live process still holds the lock (present and not stale)
  stale: boolean; // The lock is stale — its PID is dead, recycled, or unreadable
}
```

## DerivedStatus (output of status module)

> `DerivedStatus` is the canonical `rauf status --json` **machine-observation surface**. These shapes are the source of truth for the data; the stability _promise_ (versioning, the blocked-vs-needsHuman-vs-deferred distinction, the exit-code table) lives in [SPEC-BACKLOG-TOOL-CONTRACT.md §A.7](./SPEC-BACKLOG-TOOL-CONTRACT.md#a7-machine-observation-surfaces-versioned).

```typescript
interface DerivedStatus {
  loopState: LoopStateEnum; // IDLE | RUNNING | PAUSED | COMPLETE | PAUSED_HUMAN | LIMIT_REACHED | ERROR | NOT_INSTALLED | SLEEPING_LIMIT | WEEKLY_LIMIT
  stateSource: "state.json" | "log-parsing" | "none";
  iteration: number | null;
  maxIterations: number | null;
  currentItem: string | null;
  lastSignal: string | null;
  startedAt: string | null;
  elapsed: number | null; // Seconds
  backlogSummary: BacklogSummary;
  lock?: LockSummary; // Lock-file liveness (present/alive/stale + PID)
  sleepUntil?: string | null; // ISO 8601 — present when loopState is SLEEPING_LIMIT or WEEKLY_LIMIT
}

interface BacklogSummary {
  pending: number;
  inProgress: number;
  blocked: number; // All items with status "blocked" (genuine + deferred)
  needsHuman?: number; // Subset of blocked awaiting a human decision (needsHuman flag)
  deferred?: number; // Subset of blocked the runner gave up on (deferred flag — "false blocks")
  done: number;
  total: number;
}

type LoopStateEnum =
  | "IDLE"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETE"
  | "PAUSED_HUMAN"
  | "LIMIT_REACHED"
  | "ERROR"
  | "NOT_INSTALLED"
  | "SLEEPING_LIMIT" // Sleeping until 5-hour usage window resets
  | "WEEKLY_LIMIT"; // 7-day weekly cap exhausted
```

## DiscoveredProject

```typescript
interface DiscoveredProject {
  id: string; // Directory name (used in API routes)
  path: string; // Absolute path to project root
  name: string; // From backlog.json project field, or directory name
  marker: MarkerFile; // Parsed .rauf.json
}
```

## InstallationReport

```typescript
interface InstallationReport {
  projectName: string;
  projectPath: string;
  actions: InstallAction[];
  profile: ProjectProfile;
  warnings: string[];
}

interface InstallAction {
  file: string; // Relative path
  action: "created" | "updated" | "skipped" | "merged" | "rendered";
  detail: string; // Human-readable description
}
```

## API Response Wrappers

```typescript
// Success
interface ApiSuccess<T> {
  data: T;
}

// Error
interface ApiError {
  error: {
    code: string; // e.g., "VALIDATION_ERROR", "NOT_FOUND", "CONFLICT"
    message: string;
    details?: Record<string, unknown>;
  };
}
```

## Result Type (core internal)

```typescript
type Result<T, E = RaufError> = { ok: true; value: T } | { ok: false; error: E };

interface RaufError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

### ErrorCodes

`code` values come from the `ErrorCodes` const in `packages/core/src/errors.ts`:
`FILE_NOT_FOUND`, `INVALID_JSON`, `VALIDATION_ERROR`, `PATH_VIOLATION`, `ALREADY_INSTALLED`,
`NOT_INSTALLED`, `CONFLICT`, `TRANSITION_INVALID`, `LOCK_CONFLICT`, and `IO_ERROR`.

`IO_ERROR` is returned by the filesystem append/read primitives (`appendLine`, `readNdjson`) and the
event-log / registry modules on an fs failure — distinct from `FILE_NOT_FOUND` (graceful absence is
handled by returning `ok([])`, not an error) and from `INVALID_JSON`/`VALIDATION_ERROR` (content
shape, not fs failure).

## BacklogPaths

Resolved absolute paths for a backlog root (`packages/core/src/backlog-root.ts`), produced by
`resolveBacklogPaths()`. Fields: `projectPath`, `root`, `stateDir`, `backlog`, `state`, `log`,
`done`, `cancel`, `progress`, `iterationStatus`, `archive`, `lock`, and `eventsLog`.

- `eventsLog` — path to `events.ndjson`, the persisted per-run event stream (= `stateDir/events.ndjson`).

## Template Variables

Variables available in .tmpl files ({{variableName}} syntax):

| Variable             | Source                       |
| -------------------- | ---------------------------- |
| `projectName`        | Marker file / user input     |
| `projectDescription` | User input                   |
| `testCommand`        | profile.commands.test        |
| `typecheckCommand`   | profile.commands.typecheck   |
| `lintCommand`        | profile.commands.lint        |
| `buildCommand`       | profile.commands.build       |
| `formatCommand`      | profile.commands.format      |
| `verifyCommand`      | profile.verify (composite)   |
| `stackDescription`   | Human-readable stack label   |
| `requirements`       | User input (greenfield only) |

## LoopStartOptions

Options passed to LoopRunner when starting a loop.

```typescript
interface LoopStartOptions {
  maxIterations: number; // Positive integer. Max loop iterations. See computeMaxIterations for the default derivation.
  maxRetries: number; // Positive integer. Max retries on genuine_retry before deferring the item.
  model?: string; // Optional model override. Prefer tier aliases ("opus", "sonnet"); append "[1m]" for the 1M window ("opus[1m]"). Overridden by per-item BacklogItem.model.
  sessionTimeoutMinutes: number; // Positive integer. Max minutes per Claude session before kill+retry.
  provider?: string; // Optional LLM provider override.
  review?: boolean; // Enable post-loop review pass after all items complete.
  reviewOnly?: boolean; // Review only — create fix items but don't process them (implies review).
  backlogRoot?: string; // Override the backlog root directory (default: .rauf/).
  suppressIterationReview?: boolean; // Suppress per-iteration review/security hooks in child sessions (single-gate review model). Default: false.
  childEnv?: Record<string, string>; // Generic env var overrides applied to every child session. Takes precedence over the suppressIterationReview suppression set.
  sleepOnLimit?: boolean; // When false, halt with paused_usage_limit instead of sleeping at a usage limit. Default: true (sleep and continue).
  circuitBreakerThreshold?: number; // Halt after N consecutive infra_error spawn deaths (fast non-zero exits, no usage banner). Default: 3.
  pauseOnNeedsHuman?: boolean; // When true, halt the loop in paused_human (emitting loop_paused) on the first needs-human item instead of setting it aside and continuing. Default: false. See `rauf loop run --pause-on-needs-human`.
}
```

## LoopEvent (discriminated union)

All events emitted by LoopRunner during the loop lifecycle. Discriminated on the `type` field. All events share a common base shape.

> These shapes back the `rauf loop run --ndjson` **machine-observation surface**. This section is the source of truth for the data; the stability _promise_ and the `signal_parsed` `review` / circuit-breaker→`loop_error` gotchas live in [SPEC-BACKLOG-TOOL-CONTRACT.md §A.7](./SPEC-BACKLOG-TOOL-CONTRACT.md#a7-machine-observation-surfaces-versioned).

```typescript
// Base fields shared by all events
interface LoopEventBase {
  type: string; // Discriminator
  timestamp: string; // ISO 8601
  projectPath: string; // Absolute path to the project
}
```

### All 24 Event Types

| Type                  | Additional Fields                                                    | Emitted When                                             |
| --------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `loop_started`        | `maxIterations`, `model?`                                            | Loop begins                                              |
| `iteration_start`     | `iteration`, `maxIterations`                                         | Each iteration starts                                    |
| `item_selected`       | `itemId`, `title`, `priority`                                        | Next item picked from backlog                            |
| `llm_spawned`         | `itemId`, `provider`, `model?`, `timeoutMinutes`                     | LLM process launched                                     |
| `llm_exited`          | `itemId`, `provider`, `exitCode`, `timedOut`, `durationMs`           | LLM process exits                                        |
| `signal_parsed`       | `itemId`, `signal` (done/blocked/needs_human/review/none), `reason?` | Exit signal extracted from stdout                        |
| `item_completed`      | `itemId`, `title`                                                    | Item marked done                                         |
| `item_blocked`        | `itemId`, `reason`                                                   | Item marked blocked                                      |
| `item_retried`        | `itemId`, `attempt`, `maxRetries`                                    | Item re-queued for retry                                 |
| `needs_human`         | `itemId`, `reason`                                                   | Loop paused for human input                              |
| `loop_paused`         | `reason` ("needs_human"), `itemId`                                   | Loop halted in `paused_human` (`--pause-on-needs-human`) |
| `usage_limit_hit`     | `limitType` ("5h" \| "7d"), `utilization`                            | Claude API usage limit detected                          |
| `usage_limit_cleared` | `limitType` ("5h" \| "7d")                                           | Usage limit window reset                                 |
| `sleep_start`         | `sleepUntil`, `reason`                                               | Loop enters sleep (usage limit)                          |
| `sleep_end`           | _(base only)_                                                        | Loop wakes from sleep                                    |
| `loop_completed`      | `completedCount`, `blockedCount`, `needsHumanCount?`                 | Loop finishes normally                                   |
| `loop_error`          | `error`                                                              | Unexpected error terminates loop                         |
| `loop_cancelled`      | _(base only)_                                                        | Loop cancelled via AbortController or CANCEL file        |
| `review_started`      | `completedItemIds`                                                   | Post-loop review pass begins                             |
| `review_completed`    | `itemsCreated`, `summary`                                            | Review pass finished                                     |
| `review_failed`       | `reason`                                                             | Review pass failed (non-fatal)                           |
| `llm_tool_activity`   | `itemId`, `toolName`, `phase` ("start" \| "end")                     | Tool call starts or finishes in child session            |
| `llm_token_update`    | `itemId`, `inputTokens`, `outputTokens`                              | Token count update from child session                    |
| `llm_stuck_warning`   | `itemId`, `silentMs`                                                 | Child session silent for too long                        |

```typescript
// Full union type (inferred from Zod schema)
type LoopEvent =
  | {
      type: "loop_started";
      timestamp: string;
      projectPath: string;
      maxIterations: number;
      model?: string;
    }
  | {
      type: "iteration_start";
      timestamp: string;
      projectPath: string;
      iteration: number;
      maxIterations: number;
    }
  | {
      type: "item_selected";
      timestamp: string;
      projectPath: string;
      itemId: string;
      title: string;
      priority: number;
    }
  | {
      type: "llm_spawned";
      timestamp: string;
      projectPath: string;
      itemId: string;
      provider: string;
      model?: string;
      timeoutMinutes: number;
    }
  | {
      type: "llm_exited";
      timestamp: string;
      projectPath: string;
      itemId: string;
      provider: string;
      exitCode: number;
      timedOut: boolean;
      durationMs: number;
    }
  | {
      type: "signal_parsed";
      timestamp: string;
      projectPath: string;
      itemId: string;
      signal: "done" | "blocked" | "needs_human" | "review" | "none";
      reason?: string;
    }
  | {
      type: "item_completed";
      timestamp: string;
      projectPath: string;
      itemId: string;
      title: string;
    }
  | { type: "item_blocked"; timestamp: string; projectPath: string; itemId: string; reason: string }
  | {
      type: "item_retried";
      timestamp: string;
      projectPath: string;
      itemId: string;
      attempt: number;
      maxRetries: number;
    }
  | { type: "needs_human"; timestamp: string; projectPath: string; itemId: string; reason: string }
  | {
      type: "loop_paused";
      timestamp: string;
      projectPath: string;
      reason: "needs_human";
      itemId: string;
    }
  | {
      type: "usage_limit_hit";
      timestamp: string;
      projectPath: string;
      limitType: "5h" | "7d";
      utilization: number;
    }
  | { type: "usage_limit_cleared"; timestamp: string; projectPath: string; limitType: "5h" | "7d" }
  | {
      type: "sleep_start";
      timestamp: string;
      projectPath: string;
      sleepUntil: string;
      reason: string;
    }
  | { type: "sleep_end"; timestamp: string; projectPath: string }
  | {
      type: "loop_completed";
      timestamp: string;
      projectPath: string;
      completedCount: number;
      blockedCount: number;
    }
  | { type: "loop_error"; timestamp: string; projectPath: string; error: string }
  | { type: "loop_cancelled"; timestamp: string; projectPath: string }
  | {
      type: "review_started";
      timestamp: string;
      projectPath: string;
      completedItemIds: string[];
    }
  | {
      type: "review_completed";
      timestamp: string;
      projectPath: string;
      itemsCreated: number;
      summary: string;
    }
  | { type: "review_failed"; timestamp: string; projectPath: string; reason: string }
  | {
      type: "llm_tool_activity";
      timestamp: string;
      projectPath: string;
      itemId: string;
      toolName: string;
      phase: "start" | "end";
    }
  | {
      type: "llm_token_update";
      timestamp: string;
      projectPath: string;
      itemId: string;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      type: "llm_stuck_warning";
      timestamp: string;
      projectPath: string;
      itemId: string;
      silentMs: number;
    };
```

## PersistedEvent (events.ndjson)

One line of `events.ndjson` — a full `LoopEvent` intersected with a two-field envelope. **Flat
by design**: the entire `LoopEvent` is preserved, so a reader needs no join against another
surface to interpret a record. Defined as `PersistedEventSchema = z.intersection(LoopEventSchema, …)`
(the first `z.intersection` in the codebase; `LoopEventSchema.and(envelope)` is an equivalent terser
spelling).

```typescript
type PersistedEvent = LoopEvent & {
  seq: number; // Monotonic, dense, per-run sequence number (non-negative int). Assigned ONLY when
  //              a record is actually written to disk, so coalesced/dropped token updates never
  //              consume a seq. Reset to 0 at the start of each run.
  schemaVersion: string; // Event-log schema version. "1" for Phase 1. Forward-stable machine contract.
};
```

### Event-log constants

| Constant                | Value             | Meaning                                                                                                                                                    |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EVENTS_SCHEMA_VERSION` | `"1"`             | `events.ndjson` record schema version. Forward-stable machine contract; bumped only under the versioning discipline below.                                 |
| `TOKEN_COALESCE_MS`     | `1000`            | Coalescing window for `llm_token_update` persistence: at most one token-update record per interval. Independent of the runner's `TOKEN_EVENT_THROTTLE_MS`. |
| `EVENTS_LOG_FILENAME`   | `"events.ndjson"` | Per-run event log file name within a backlog root's state directory.                                                                                       |

**`events.ndjson` versioning discipline.** The persisted event log is a stable,
versioned, **additive-only-within-a-major** machine surface (the same `LoopEvent`
shapes as the `--ndjson` stream, plus the `seq` + `schemaVersion` envelope):

1. Within a major version, no event `type` discriminator value is renamed or
   removed, and no documented field is removed.
2. Adding a new event `type` to the union, or a new optional field to an existing
   event, is **additive** and requires **no** version bump.
3. Readers MUST ignore unknown `type` values and unknown fields rather than
   failing on them.
4. `EVENTS_SCHEMA_VERSION` is incremented **only** on a breaking change — a
   renamed or removed `type` or documented field.

`EVENTS_SCHEMA_VERSION` stays `"1"` in v0.5.0: adding `"review"` to the
`signal_parsed.signal` enum is an additive change to an existing field's value
set (rule 2), so it triggers no bump.

## ActiveLoopEntry (~/.rauf/active/&lt;hash&gt;.json)

One entry in the machine-wide active-loop registry: a single file `~/.rauf/active/<hash>.json` per
running loop, keyed by `sha256(resolvedStateDir)[:16]`. Written at loop start, refreshed on each
status transition, removed at loop exit.

```typescript
interface ActiveLoopEntry {
  stateDir: string; // Resolved (absolute) state directory — registry key source AND reconciliation anchor.
  projectPath: string; // Project root the loop runs against (contains .rauf.json marker).
  backlogRoot: string; // The --backlog root (equals projectPath/.rauf for the default root).
  pid: number; // OS process id of the runner, used for liveness reconciliation.
  startedAt: string; // ISO-8601 timestamp the loop registered.
  status: LoopStateStatus; // Advisory last-known status. state.json remains authoritative; do NOT trust over state.json.
}
```

## ReviewPayload / ReviewItem

Parsed from the `RAUF_REVIEW:{json}` signal emitted during a review pass.

```typescript
interface ReviewItem {
  type: "bug" | "bugfix" | "refactor" | "feature" | "chore" | "test";
  priority: 1 | 2 | 3 | 4;
  title: string; // Non-empty
  description: string;
  acceptanceCriteria: string[]; // Min 1
}

interface ReviewPayload {
  items: ReviewItem[]; // Min 1
  summary: string;
}
```

## LoopResult

Returned by `LoopRunner.start()` and `LoopRunner.startReviewOnly()` when the loop finishes.

```typescript
interface LoopResult {
  completedCount: number;
  blockedCount: number;
  cancelled: boolean;
  reviewItemsCreated?: number; // Present if review pass created items
  reviewSummary?: string; // Present if review pass ran
}
```

## Log Line Patterns (fallback parsing)

Used by `status.ts` Tier 2 fallback to derive loop state from `rauf.log` when `state.json` is unavailable. Patterns match the log output written by the TypeScript loop runner (`packages/loop`).

```typescript
const LOG_PATTERNS = {
  loopStart: /Loop started \(maxIterations=(\d+)\)/,
  iteration: /--- Iteration (\d+) \/ (\d+) ---/,
  done: /Item \d{3,} completed: .+/,
  blocked: /Item \d{3,} blocked: (.+)/,
  needsHuman: /Item \d{3,} needs human input: (.+)/,
  complete: /Loop completed/,
  limitReached: /Max iterations reached \((\d+)\)/,
  timestamp: /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/,
};
```
