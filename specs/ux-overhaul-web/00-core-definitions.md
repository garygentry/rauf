# 00 — Core Definitions (shared types & contracts)

> Foundation document for `ux-overhaul-web`. Every other spec in this suite builds on the types
> defined here. Implements the type surface of `tech-spec.md` §2.1, §3.3, §3.5, §4. All signatures are
> the project's TypeScript (strict, `noUncheckedIndexedAccess`), named exports, `node:` prefix for
> built-ins. Where a type already exists in the codebase it is shown for reference and marked
> **(exists)**; new types are marked **(new)**.

## Requirement Coverage

| Requirement | Section |
|---|---|
| REQ-VOCAB-02, 03, 04, 06 | §2 Derived status enum |
| REQ-VOCAB-01, 05, 07 | §3 Label-map types |
| REQ-WEB-02, 08 | §4 Relocated recovery types |
| REQ-WEB-01, 04, 05 | §5 Reused core result types |
| REQ-WEB-02, 06 | §6 New web DTOs (`ResumeResult`) |
| REQ-WEB-01..05, REQ-SEC-01, REQ-OBS-01 | §7 Route request/response schemas |
| REQ-WEB-09, REQ-EXIT-01 | §8 Error codes & exit codes |

## Dependencies

None — this is the root foundation document. `01-architecture-layout.md` consumes the module
placement; `02`–`06` consume these types.

## 1. Existing anchors (unchanged, shown for reference)

These are imported, not redefined. Verified against source.

```ts
// @rauf/core — errors.ts
export type Result<T, E = RaufError> = { ok: true; value: T } | { ok: false; error: E };
export function ok<T>(value: T): Result<T, never>;
export function err<E = RaufError>(error: E): Result<never, E>;
export interface RaufError { code: string; message: string; details?: unknown }

// @rauf/core — errors.ts — ErrorCodes (string enum-like const). Members used by this feature:
//   FILE_NOT_FOUND · INVALID_JSON · VALIDATION_ERROR · PATH_VIOLATION · LOCK_CONFLICT · IO_ERROR
// (full set also includes ALREADY_INSTALLED, NOT_INSTALLED, CONFLICT, TRANSITION_INVALID)

// @rauf/core — backlog-root.ts
export interface BacklogPaths {
  projectPath: string;
  // …resolved file paths incl. `state`, `lock`, `backlog`, `done`, `cancel`, `log`, etc.
}

// @rauf/core — lock.ts:243 / :198
export function checkLock(paths: BacklogPaths): Result<LockStatus>;       // path-resolving wrapper
export function checkLockFile(lockPath: string): Result<LockStatus>;      // raw path variant
export interface LockStatus { locked: boolean; pid?: number; startedAt?: string; stale?: boolean }
// "live" = locked === true && stale !== true
```

## 2. Derived status enum (extended) — REQ-VOCAB-02/03/04/06

The raw `LoopStateStatusSchema` (`schemas.ts:167`, 12 values) is **unchanged**. The **derived**
`LoopStateEnumSchema` (`schemas.ts:228`) gains the two values that today collapse into other states:

```ts
// @rauf/core — schemas.ts  (TWO new members added: REVIEWING, PAUSED_USAGE_LIMIT)
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
  "REVIEWING",          // (new) raw `reviewing` — was collapsed to RUNNING
  "PAUSED_USAGE_LIMIT", // (new) raw `paused_usage_limit` — was collapsed to PAUSED
]);
export type LoopStateEnum = z.infer<typeof LoopStateEnumSchema>;
```

The machine enum value (SCREAMING_SNAKE) is the wire form in `--json`/API responses (REQ-VOCAB-06);
human display labels come exclusively from §3. The raw→derived mapping (`mapLoopStateStatus`) is
remapped in `02-status-vocabulary.md` and stays **total** over the 12 raw statuses (REQ-VOCAB-02).

## 3. Label-map types (new module `state-labels.ts`) — REQ-VOCAB-01/05/07

```ts
// @rauf/core — src/state-labels.ts  (new, exported from the package index)

/** Semantic severity category — surface-agnostic; each consumer maps it to its own palette. */
export type StateTone = "neutral" | "info" | "success" | "warning" | "danger";

/** One display entry per derived state. Carries NO color/CSS (REQ-ARCH-01). */
export interface StateLabel {
  /** Title-Case human label (REQ-VOCAB-06). */
  label: string;
  /** Semantic tone the surface maps to a concrete color. */
  tone: StateTone;
}

/** Single source of truth — total over LoopStateEnum (one entry per value, no gaps). */
export const STATE_LABELS: Record<LoopStateEnum, StateLabel>;

/** Total accessor — never returns undefined (the Record is total over the enum). */
export function getStateLabel(state: LoopStateEnum): StateLabel;
```

The concrete `STATE_LABELS` table (labels + tones for all 12 values) and the per-surface tone→palette
tables are defined in `02-status-vocabulary.md`. `getStateLabel` exists so consumers needn't index the
`Record` directly (keeps the totality invariant in one place).

## 4. Relocated recovery types (move cli → `@rauf/loop`) — REQ-WEB-02/08

These types currently live in `packages/cli/src/recovery.ts` and **move verbatim** to
`packages/loop/src/recovery.ts` (re-exported from `@rauf/loop`'s index) so web and CLI share one
definition (tech-spec D3.1). Bodies are unchanged — shown so downstream specs reference exact shapes.

```ts
// @rauf/loop — src/recovery.ts (MOVED from @rauf/cli; shapes unchanged)

export interface KeptBlock { id: string; reason: string }

export interface InterruptedItem { id: string; title: string }

export interface ReconcileSummary {
  recovered: string[];      // promoted to done (clean `[rauf] <id>:` commit landed)
  requeued: string[];       // runner-deferred false blocks returned to pending
  keptBlocked: KeptBlock[]; // genuine agent blocks / needsHuman, left blocked
  interrupted: InterruptedItem[]; // in_progress + uncommitted, only on a dirty tree
  treeClean: boolean;       // whether commit reconciliation ran
}

export interface RecoverySummary extends ReconcileSummary {
  stalledReset: number;     // count of in_progress → pending resets
  stateCleared: boolean;    // whether state.json was present and removed
}

export interface AcquiredRecoveryLock { cleared: boolean } // a stale lock was cleared on acquire
```

**Functions relocated with them** (full signatures in `03-recovery-relocation.md` / tech-spec §6):
`detectInterruptedItems`, `reconcileAndRequeue`, `acquireRecoveryLock`, `releaseRecoveryLock`,
`recoverInterruptedLoop` (async — `Promise<Result<RecoverySummary>>`).

**Stays in `@rauf/cli`** (subprocess-bound, `--recover` path — CLI-only per D3.1): `VerifyOutcome`,
`VerifyRunner`, `defaultVerifyRunner`, `ItemRecoveryResult`, `reverifyAndCommitInterrupted`.

## 5. Reused core result types (the recovery actions wrap these) — REQ-WEB-01/04/05

```ts
// @rauf/core — reset.ts:19 / :25 / :48   (exists, called by POST /reset)
export interface ResetProjectOptions { clearBacklog?: boolean; keepProgress?: boolean; keepLog?: boolean }
export interface ResetProjectResult {
  sweptCount: number; sweptMonths: string[]; stalledResetCount: number;
  stateCleared: boolean; doneCleared: boolean; cancelCleared: boolean;
  backlogCleared: boolean; progressArchived: boolean; logArchived: boolean;
}
export function resetProject(paths: BacklogPaths, options?: ResetProjectOptions): Result<ResetProjectResult>;

// @rauf/core — backlog.ts:431   (exists, called by POST /backlog/unblock)
export function unblockItems(paths: BacklogPaths, itemId?: string):
  Result<{ unblockedCount: number; unblockedIds: string[] }>;

// @rauf/core — backlog-validate.ts:11 / :23 / :47   (exists, called by GET /backlog/validate)
export interface ValidationFinding {
  severity: "error" | "warning";
  code: string;        // SCHEMA · DUPLICATE_ID · MISSING_DEPENDENCY · DEPENDENCY_CYCLE · EMPTY_AC · SPEC_PATH_INVALID · MISSING_SPEC
  message: string; itemId?: string; path?: string;
}
export interface ValidateBacklogResult { valid: boolean; findings: ValidationFinding[] }
export function validateBacklog(paths: BacklogPaths, opts?: ValidateBacklogOptions): Result<ValidateBacklogResult>;

// @rauf/core — updateItem(paths, itemId, patch): Result<…>   (exists, used for resume `--answer` injection)
```

## 6. New web DTOs — REQ-WEB-02/06

```ts
// @rauf/web — the resume route's success payload
export interface ResumeResult {
  /** The RecoverySummary that `recoverInterruptedLoop` resolved (§4). */
  reconciled: RecoverySummary;
  /** Whether an eligible item was found and a detached loop was relaunched. */
  relaunched: boolean;
  /** When `relaunched` is false, the human-readable reason (e.g. "no eligible items",
   *  "interrupted work needs `rauf resume --recover` from the CLI"). */
  reason?: string;
}
```

The other four actions return existing shapes directly: `reset → ResetProjectResult`,
`unblock → { unblockedCount, unblockedIds }`, `validate → ValidateBacklogResult`,
`review → { started: true }`.

## 7. Route request/response schemas — REQ-WEB-01..05, REQ-SEC-01, REQ-OBS-01

Request bodies are validated with Zod `safeParse` (parse failure → `400`), mirroring the existing
`StartLoopBodySchema`/`StopLoopBodySchema` pattern. All bodies are optional-field objects (an empty
`{}` is valid for reset/unblock/review). Response envelope is the established `{ data }` / `{ error }`.

```ts
// @rauf/web — recovery route body schemas (new)

const ResetBodySchema = z.object({
  clearBacklog: z.boolean().optional(),
  keepProgress: z.boolean().optional(),
  keepLog: z.boolean().optional(),
  backlogRoot: z.string().optional(),
}).strict();

const ResumeBodySchema = z.object({
  backlogRoot: z.string().optional(),
  retryBlocked: z.boolean().optional(),
  // OQ-T2 RESOLVED: field name `text` matches the CLI's AnswerInjection { itemId, text }
  // (resume-commands.ts:54) — one vocabulary across CLI + web. Passed to updateItem as humanAnswer.
  answers: z.array(z.object({ itemId: z.string(), text: z.string() })).optional(),
}).strict();

const ReviewBodySchema = z.object({
  model: z.string().optional(),
  sessionTimeoutMinutes: z.number().int().positive().optional(),
  backlogRoot: z.string().optional(),
}).strict();

const UnblockBodySchema = z.object({
  itemId: z.string().optional(),       // omitted → unblock ALL blocked items
  backlogRoot: z.string().optional(),
}).strict();

// GET /backlog/validate takes no body; optional query `?backlogRoot=<dir>`.
```

> **OQ-T2 resolution (binding for this suite):** the resume request body uses `answers: { itemId,
> text }[]` to match the CLI's `AnswerInjection` vocabulary. `04-web-recovery-routes.md` wires `text`
> into `updateItem(..., { humanAnswer: text, status: "pending", needsHuman: false, blockedReason:
> null })`.

## 8. Error codes & exit codes — REQ-WEB-09, REQ-EXIT-01

### 8.1 Result → HTTP status (recovery routes)

| `ErrorCodes` member | HTTP | When |
|---|---|---|
| `FILE_NOT_FOUND` | 404 | backlog/state file absent for the resolved root |
| `LOCK_CONFLICT` | 409 | a live loop holds the lock (guarded mutations — §D3.4) |
| `VALIDATION_ERROR`, `INVALID_JSON` | 400 | bad body / unparseable backlog |
| `IO_ERROR` | 500 | filesystem failure |
| (any other) | 400 | default |

- **403 `FORBIDDEN`** (missing `X-Rauf-Request: true`) is **not** per-route — the app-level CSRF
  middleware (`app.ts:54-69`) enforces it on every POST and the new routes inherit it (REQ-SEC-01).
- **Sandbox breach** is rejected by `validateProjectPath` (`projects.ts:159-162`) → 400 using the
  underlying `validatePath` error code (confirm the exact code at impl; do not assume `PATH_VIOLATION`).

### 8.2 Status exit codes (unchanged table, two states now mapped) — REQ-EXIT-01

The unified v0.5.0 `ExitCode` table (`commands.ts`, codes 0–6) is unchanged. `statusExitCode` adds two
cases: `REVIEWING → RUNNING (6)` (preserves prior observable behavior), `PAUSED_USAGE_LIMIT → LIMIT
(4)` (corrects today's silent `0`). Full mapping in `02-status-vocabulary.md` §exit-codes.

## Verification

- `STATE_LABELS` type-checks as `Record<LoopStateEnum, StateLabel>` — a missing key is a compile error.
- The relocated recovery types resolve from `@rauf/loop` in both `@rauf/cli` and `@rauf/web` with no
  `@rauf/cli` import remaining in `@rauf/web` (rule #1 preserved).
- `pnpm typecheck` passes across all packages after the enum + type additions.
