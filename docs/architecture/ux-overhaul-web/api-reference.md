# API Reference — v0.6.0 web recovery + status vocabulary

The machine-facing surface Phase 4 adds: the **web recovery endpoints**, the **shared status
label-map**, the **extended derived enum + exit codes**, and the **relocated `@rauf/loop` recovery
exports**. Verified against the landed code (`@rauf/core`, `@rauf/loop`, `@rauf/cli`, `@rauf/web`).

## Web recovery endpoints

All live under the projects router, bind `127.0.0.1` only, and inherit the app-level CSRF guard:
**every POST requires `X-Rauf-Request: true`** (missing → `403 FORBIDDEN`). Each resolves the project
(`resolveProjectPath` null → `400 INVALID_ID`), sandbox-checks it (`validateProjectPath` → `400
PATH_VIOLATION`), `safeParse`s the body (`400 VALIDATION_ERROR`), and resolves `BacklogPaths`
(optional `backlogRoot`). Response envelope: success `{ data: … }`, error `{ error: { code, message,
details? } }`.

| Method · Path                            | Body                                                            | Wraps                                         | Success                                          | Guard              |
| ---------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ | ------------------ |
| `POST /api/projects/:id/reset`           | `{ clearBacklog?, keepProgress?, keepLog?, backlogRoot? }`      | `resetProject` (core)                         | `200 { data: ResetProjectResult }`               | acquire-and-hold   |
| `POST /api/projects/:id/resume`          | `{ backlogRoot?, retryBlocked?, answers?: { itemId, text }[] }` | `recoverInterruptedLoop` (loop) → `startLoop` | `200 { data: ResumeResult }`                     | acquire-and-hold   |
| `POST /api/projects/:id/loop/review`     | `{ model?, sessionTimeoutMinutes?, backlogRoot? }`              | `LoopManager.startReviewLoop`                 | `200 { data: { started: true } }`                | start-path 409     |
| `POST /api/projects/:id/backlog/unblock` | `{ itemId?, backlogRoot? }`                                     | `unblockItems` (core)                         | `200 { data: { unblockedCount, unblockedIds } }` | `assertNoLiveLoop` |
| `GET /api/projects/:id/backlog/validate` | — (query `?backlogRoot=`)                                       | `validateBacklog` (core)                      | `200 { data: ValidateBacklogResult }`            | none (read-only)   |

Notes:

- **`validate` is `GET`** — read-only, so it needs no `X-Rauf-Request` header and no lock guard, and
  is safe to call during a live run. A backlog with findings returns `200 { data: { valid: false,
findings: [...] } }` — findings are the payload, **not** an HTTP error.
- **`resume` is reconcile + relaunch only.** `answers` inject human answers
  (`{ itemId, text }` → `updateItem(..., { humanAnswer: text, status: "pending", needsHuman: false,
blockedReason: null })`); `retryBlocked` re-queues genuine blocks first. Interrupted-but-uncommitted
  work is surfaced in `reason` with `relaunched: false` — the `--recover` re-verify+commit path is
  CLI-only.
- **`unblock`/`validate` are registered before `/:id/backlog/:itemId`** so `"unblock"`/`"validate"`
  are never captured as item IDs.

### `Result<T>` → HTTP status (`recoveryErrorStatus`)

| `ErrorCodes`                       | HTTP |
| ---------------------------------- | ---- |
| `FILE_NOT_FOUND`                   | 404  |
| `LOCK_CONFLICT`                    | 409  |
| `IO_ERROR`                         | 500  |
| `VALIDATION_ERROR`, `INVALID_JSON` | 400  |
| (any other)                        | 400  |

`403 FORBIDDEN` (missing `X-Rauf-Request`) is enforced by the app-level CSRF middleware, not
per-route.

### `ResumeResult` (new DTO)

```ts
interface ResumeResult {
  reconciled: RecoverySummary; // what recoverInterruptedLoop resolved
  relaunched: boolean; // whether an eligible item was found + a detached loop relaunched
  reason?: string; // why not relaunched ("no eligible items", "...run rauf resume --recover...")
}
```

## Shared status label map — `@rauf/core` `state-labels.ts`

```ts
export type StateTone = "neutral" | "info" | "success" | "warning" | "danger";
export interface StateLabel {
  label: string;
  tone: StateTone;
}
export const STATE_LABELS: Record<LoopStateEnum, StateLabel>; // total over the enum
export function getStateLabel(state: LoopStateEnum): StateLabel; // never undefined
```

The full table (labels are Title Case per CANON §4.3; the SCREAMING_SNAKE enum value stays the
machine wire form in `--json`/API):

| `LoopStateEnum`              | label                | tone    |
| ---------------------------- | -------------------- | ------- |
| `IDLE`                       | Idle                 | neutral |
| `RUNNING`                    | Running              | info    |
| `PAUSED`                     | Paused               | info    |
| `COMPLETE`                   | Complete             | success |
| `PAUSED_HUMAN`               | Needs Human          | warning |
| `LIMIT_REACHED`              | Limit Reached        | warning |
| `ERROR`                      | Error                | danger  |
| `NOT_INSTALLED`              | Not Installed        | neutral |
| `SLEEPING_LIMIT`             | Sleeping (Limit)     | warning |
| `WEEKLY_LIMIT`               | Weekly Limit         | warning |
| `REVIEWING` _(new)_          | Reviewing            | info    |
| `PAUSED_USAGE_LIMIT` _(new)_ | Usage Limit (Paused) | warning |

The map carries **no color**. Consumers map `tone` → palette: the CLI's `colorLoopState` uses
`Record<StateTone, (s) => string>` terminal colors (`neutral→dim, info→cyan, success→green,
warning→yellow, danger→red`); the web `StateBadge` component maps `tone` → a CSS `{ bg, text, border }`
palette. Both are total (no `default:`/`?? IDLE` fallback).

## Derived enum + raw mapping — `@rauf/core`

`LoopStateEnum` (12 values): `IDLE, RUNNING, PAUSED, COMPLETE, PAUSED_HUMAN, LIMIT_REACHED, ERROR,
NOT_INSTALLED, SLEEPING_LIMIT, WEEKLY_LIMIT, REVIEWING, PAUSED_USAGE_LIMIT`. The raw
`LoopStateStatusSchema` (12 values) is unchanged.

```ts
// status.ts — now EXPORTED, total over the 12 raw statuses
export function mapLoopStateStatus(status: LoopState["status"]): LoopStateEnum;
// reviewing → REVIEWING (was RUNNING);  paused_usage_limit → PAUSED_USAGE_LIMIT (was PAUSED)
```

## Status exit codes — `@rauf/cli` `statusExitCode`

The unified v0.5.0 table (codes 0–6) is unchanged; the two new states are now mapped:

| Derived state                                                           | Exit code                                          | Note                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `RUNNING`, `REVIEWING`                                                  | `6` (RUNNING)                                      | `REVIEWING` preserves prior behavior (was derived to RUNNING→6) |
| `PAUSED_HUMAN`                                                          | `3` (NEEDS_HUMAN)                                  |                                                                 |
| `LIMIT_REACHED`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `PAUSED_USAGE_LIMIT` | `4` (LIMIT)                                        | `PAUSED_USAGE_LIMIT` **corrects** today's silent `0`            |
| `ERROR`                                                                 | `1`                                                |                                                                 |
| `IDLE`, `COMPLETE`, `PAUSED`                                            | `5` (BLOCKED) if genuine blocks else `0` (SUCCESS) |                                                                 |
| `NOT_INSTALLED`                                                         | `0`                                                |                                                                 |

`statusExitCode` is a default-less `switch` — adding an enum value is a compile error until handled.

## Relocated recovery exports — `@rauf/loop`

Moved from `@rauf/cli` (re-exported from the package index; cli still re-exports them for back-compat):

```ts
// @rauf/loop
export function recoverInterruptedLoop(paths: BacklogPaths): Promise<Result<RecoverySummary>>; // async
export function reconcileAndRequeue(paths: BacklogPaths): Promise<Result<ReconcileSummary>>;
export function detectInterruptedItems(paths: BacklogPaths): Promise<Result<InterruptedItem[]>>;
export function acquireRecoveryLock(paths: BacklogPaths): Result<AcquiredRecoveryLock>;
export function releaseRecoveryLock(paths: BacklogPaths): Result<void>;
export type { KeptBlock, InterruptedItem, ReconcileSummary, RecoverySummary, AcquiredRecoveryLock };
```

**Lock contract:** `acquireRecoveryLock` closes the check-then-mutate TOCTOU (a live lock → propagated
`LOCK_CONFLICT`; a stale lock → cleared); `recoverInterruptedLoop` does **not** touch the lock (the
caller holds it); `releaseRecoveryLock` is owner-aware and safe in a `finally`. The CLI-only
`reverifyAndCommitInterrupted` / `defaultVerifyRunner` stay in `@rauf/cli`.

## Web server helpers — `@rauf/web`

```ts
// routes/recovery-guard.ts — lightweight guard for unblock
export function assertNoLiveLoop(paths: BacklogPaths): Result<void>;
// err(LOCK_CONFLICT) when a loop is live (locked && !stale); fail-open on a checkLock IO error.

// loop-manager.ts
startReviewLoop(projectPath: string, options: LoopStartOptions): { ok: true } | { ok: false; error: string };
// mirrors startLoop via a shared private launch(); calls runner.startReviewOnly().
```

## Version

`rauf version --json` → `{ "version": "0.6.0" }` (source `packages/core/src/version.ts`). Additive
minor bump — `minRunnerVersion` is unchanged and feature-forge is untouched.

## When to rely on this

- **Driving recovery from a tool / UI:** POST the endpoints with `X-Rauf-Request: true`; branch on the
  `{ data } / { error }` envelope + the status codes above.
- **Rendering loop state anywhere:** read `STATE_LABELS`/`getStateLabel` — never hard-code a label or
  re-derive a color table.

## When NOT to

- **Don't expect web `resume` to commit interrupted work** — that's the CLI-only `--recover`; web
  surfaces it in `reason`.
- **Don't gate `validate`** — it's a read-only GET; no header, no lock.
- **Don't add a second label/color table per surface** — the canon is one map, one tone→palette per
  surface.

## Further reading

- [Architecture](./architecture.md) · [Recovery Guide](./guides/recovery.md)
- `docs/SPEC-WEB.md`, `docs/SCHEMAS.md`, `docs/SPEC-ARTIFACTS.md` — the full project specs (updated to v0.6.0)
