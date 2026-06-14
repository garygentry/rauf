# ux-overhaul-web — Technical Specification

> Phase 4 (final) of the UX/DX overhaul. Implements `specs/ux-overhaul-web/PRD.md`, grounded in
> `specs/ux-overhaul/CANON.md` (§4.3, §4.4, §4.6). This spec answers HOW; requirements (WHAT) live in
> the PRD and are referenced by ID. All integration signatures below were verified against source
> (file:line cited).

## 1. Overview

Three workstreams, all **additive** (C-1: no breaking flip, no `minRunnerVersion` bump, no
feature-forge edit):

1. **Web recovery parity** — five actions (`reset`, `resume`, `review`, `unblock`, `validate`) exposed
   as Hono routes that wrap **existing** core/loop logic, plus React controls on the status page.
2. **Shared status label-map** — one core module (`state-labels.ts`) is the single source of truth
   for the human display label + a semantic *tone* per derived state, consumed by the CLI and both
   web pages; the derived enum gains `REVIEWING` and `PAUSED_USAGE_LIMIT`.
3. **Exit-code alignment + agent-contract docs** — `statusExitCode` maps the two new states; the
   agent templates gain the signal spec, model cascade, and a `progress.md` stub.

Key architectural decisions (ratified): resume's reusable core (`recoverInterruptedLoop`) **moves to
`@rauf/loop`** so web and CLI share one implementation (D3.1); the label map exports **label + semantic
tone** (D3.5); all state-mutating recovery actions are **lock-guarded** (D3.4). Two engine pieces are
reused as-is: `LoopRunner` (review pass) and `LoopManager` (loop hosting).

## 2. Module Structure

No new package. Changes by package (dependency direction unchanged: `core ← loop ← cli/web`):

| Package | Change |
|---------|--------|
| `@rauf/core` | NEW `src/state-labels.ts` (exported from index); extend `LoopStateEnumSchema` (+`REVIEWING`,+`PAUSED_USAGE_LIMIT`) and `mapLoopStateStatus` in `status.ts`. |
| `@rauf/loop` | NEW `src/recovery.ts` — `recoverInterruptedLoop` + types **moved from `packages/cli/src/recovery.ts`**, re-exported from the package index. |
| `@rauf/cli` | `resume-commands.ts` imports the relocated `recoverInterruptedLoop` from `@rauf/loop`; `status-commands.ts` `colorLoopState` consumes `state-labels` + handles 2 new states; `statusExitCode` maps the 2 new states. |
| `@rauf/web` | NEW routes (`reset`, `resume`, `loop/review`, `backlog/unblock`, `backlog/validate`); `LoopManager.startReviewLoop()`; a route-layer liveness guard; status-page recovery controls; both `STATE_BADGE` copies replaced by the shared map. |
| docs | `SPEC-WEB.md`, `SCHEMAS.md`, `SPEC-CLI.md`/`ARCHITECTURE.md` (vocabulary), `SPEC-ARTIFACTS.md` + the agent templates (contract doc items). |

### 2.1 Public API surface (new core exports)

```ts
// @rauf/core — src/state-labels.ts
export type StateTone = "neutral" | "info" | "success" | "warning" | "danger";
export interface StateLabel { label: string; tone: StateTone }
export const STATE_LABELS: Record<LoopStateEnum, StateLabel>; // total — one entry per enum value
export function getStateLabel(state: LoopStateEnum): StateLabel; // never undefined
```

The map carries **no color/CSS** (REQ-ARCH-01): `tone` is a semantic category; each surface owns the
tone→palette mapping (terminal colors in CLI, CSS in web).

## 3. Technical Decisions

### 3.1 Resume: relocate `recoverInterruptedLoop` to `@rauf/loop` (REQ-WEB-02, REQ-WEB-08, OQ-1)

`recoverInterruptedLoop` currently lives in `packages/cli/src/recovery.ts` and depends on `@rauf/loop`
primitives (`findItemCommit`, `isTreeClean`, `gitCommit`) — so it cannot move to core (would invert the
dependency direction), but it **can** move down to `@rauf/loop`, which both CLI and web may import.

- **Move** `recoverInterruptedLoop` and its types (`ReconcileSummary`, `KeptBlock`, `InterruptedItem`)
  to `packages/loop/src/recovery.ts`, re-exported from the package index. Move its unit tests with it.
- **CLI** `resume-commands.ts` updates its import path only — **no behavior change** to `rauf resume`.
- **Web** `POST /:id/resume` (D5): resolve paths → optional `--answer` injection via `updateItem`
  (`@rauf/core`) → `recoverInterruptedLoop(paths)` (`@rauf/loop`) → if `selectNextItem` finds an
  eligible item, `loopManager.startReviewLoop`/`startLoop` to relaunch (detached, server-owned).
- **Scope (ratified):** the heavier `--recover` sub-path (`reverifyAndCommitInterrupted` — spawns the
  project's verify command as a subprocess, then `gitCommit`) is **CLI-only** for Phase 4. The web
  resume performs reconcile + relaunch, not reverify-and-commit. Documented as a known parity edge.
- **Alternative considered:** extract a pure `resumeProject` into core — rejected (needs `@rauf/loop`
  git/tree primitives; no clean core home).

### 3.2 Review pass: reuse the runner via a new LoopManager method (REQ-WEB-03)

`LoopRunner.startReviewOnly()` (`packages/loop/src/runner.ts:406`) already implements a standalone
review pass; the CLI's `handleLoopReview` is the reference. The web reuses the engine:

- Add `startReviewLoop(projectPath, options)` to `LoopManager` (`packages/web/src/server/loop-manager.ts`)
  — identical to `startLoop` but calls `runner.startReviewOnly()` instead of `runner.start()`, with the
  same map-key + promise tracking.
- `POST /:id/loop/review` builds `LoopStartOptions` (`maxIterations:1, maxRetries:1, review:true,
  reviewOnly:true, model?, backlogRoot?`) and calls `startReviewLoop`. Returns immediately (the review
  runs server-side; observed via the existing events SSE — Phase 1 read path).
- No new review business logic; the runner is unchanged.

### 3.3 Derived enum extension + exit codes (REQ-VOCAB-02/03/04, REQ-EXIT-01)

- Add `REVIEWING` and `PAUSED_USAGE_LIMIT` to `LoopStateEnumSchema` (`packages/core/src/schemas.ts`).
- Update `mapLoopStateStatus` (`packages/core/src/status.ts:106`): `reviewing → REVIEWING` (was
  `RUNNING`), `paused_usage_limit → PAUSED_USAGE_LIMIT` (was `PAUSED`). All other mappings unchanged.
  The mapping stays **total** over the 12 raw statuses (REQ-VOCAB-02) — TS exhaustiveness on the
  `Record<LoopState["status"], LoopStateEnum>` enforces this at compile time.
- `statusExitCode` (`packages/cli/src/status-commands.ts:512`) adds two cases: `REVIEWING →
  ExitCode.RUNNING (6)` (preserves prior observable behavior), `PAUSED_USAGE_LIMIT → ExitCode.LIMIT
  (4)` (corrects today's silent `0`). The `switch` is exhaustive over `LoopStateEnum`, so the two new
  values are a compile error until handled — guaranteeing no silent fallthrough.
- **Ripple:** every exhaustive `switch`/`Record` over `LoopStateEnum` (CLI `colorLoopState`, web
  `STATE_BADGE`) must handle the new values; the shared map (D3.5) makes the web sites total by
  construction.

### 3.4 Concurrency guard for recovery mutations (REQ-WEB-09, OQ-1)

State-mutating recovery (`reset`, `resume`, `unblock`) must not run against a live loop on the same
backlog root.

- A route-layer helper `assertNoLiveLoop(paths): Result<void>` calls core's `checkLock(lockPath)` —
  **cross-process** (detects any live PID via the lock file), not just loops this server started, so it
  catches a detached/CLI loop too. (Preferred over `loopManager.isRunning`, which only knows
  server-hosted loops.)
- A live lock → reject `409 CONFLICT` with code `LOCK_CONFLICT` and an actionable message ("a loop is
  running on this backlog root — stop it first"). A stale lock does not block.
- `validate` is read-only → never guarded, always allowed. `review` goes through the start path, which
  already guards loop-already-running (409).
- This mirrors the CLI's `acquireRecoveryLock` semantics in `resume-commands.ts`.

### 3.5 Shared label-map: label + semantic tone (REQ-VOCAB-01/05/06/07, OQ-2)

- `state-labels.ts` exports `STATE_LABELS: Record<LoopStateEnum, { label, tone }>` — total over the
  (now 12-value) enum. Labels are **Title Case** (REQ-VOCAB-06): e.g. `PAUSED_HUMAN → "Needs Human"`
  (REQ-VOCAB-05), `REVIEWING → "Reviewing"`, `PAUSED_USAGE_LIMIT → "Usage Limit (Paused)"`,
  `SLEEPING_LIMIT → "Sleeping (Limit)"`, `WEEKLY_LIMIT → "Weekly Limit"`, `LIMIT_REACHED → "Limit
  Reached"`, `NOT_INSTALLED → "Not Installed"` (per CANON §4.3 table).
- **Tone** per state (semantic, surface-agnostic): `RUNNING`/`STARTING`→info, `COMPLETE`→success,
  `IDLE`/`NOT_INSTALLED`→neutral, `PAUSED`/`REVIEWING`→info, `PAUSED_HUMAN`→warning,
  `PAUSED_USAGE_LIMIT`/`SLEEPING_LIMIT`/`WEEKLY_LIMIT`/`LIMIT_REACHED`→warning, `ERROR`→danger.
  (Exact tone table finalized in the implementation spec.)
- **CLI** `colorLoopState` maps `tone`→terminal color (replaces its per-state `switch`).
- **Web** both `STATE_BADGE` copies (`projects/status.tsx:18`, `projects/index.tsx:48`) are replaced by
  a single badge component that reads `STATE_LABELS[state]` for the label and maps `tone`→a CSS palette
  (one tone→color table in the web client). The machine enum value (SCREAMING_SNAKE) is unchanged in
  `--json`/API responses (REQ-VOCAB-06) — only display labels come from the map.

### 3.6 Agent-contract documentation items (REQ-AGENT-01/02/03)

Doc-only (no code). The rename is **out of scope** (deferred to Part-B — PRD §6). Targets:

- **Signal spec** (REQ-AGENT-01) — add to `RAUF.md` template, the agent addon
  (`CLAUDE_ADDON.md` — name unchanged this phase), and `SPEC-ARTIFACTS.md`: the exact tokens
  (`RAUF_DONE`, `RAUF_BLOCKED:<reason>`, `RAUF_NEEDS_HUMAN:<reason>`, `RAUF_REVIEW:<json>`), "on a line
  by itself," the backward-scan-from-end rule (trailing summaries/commit text don't break detection),
  and "no signal → classified by exit context, never auto-blocked."
- **Model cascade** (REQ-AGENT-02) — document precedence `item.model > --model/options > project
  default > provider default` in the agent-facing docs.
- **`progress.md` stub** (REQ-AGENT-03) — ship a session-log format stub in the artifact templates.
- Regenerate `packages/core/src/embedded-artifacts.ts` via `pnpm --filter @rauf/core build` if any
  template the embedded artifacts include changes (the installed-source landmine from Phase 1).

## 4. Data Model

No new persistent entities; `backlog.json`/`state.json` schemas are unchanged (CANON §8). Additions:

- **Derived enum** `LoopStateEnum` gains 2 values (D3.3). Raw `LoopStateStatusSchema` already contains
  `reviewing`/`paused_usage_limit` (no change).
- **Static table** `STATE_LABELS` (D3.5) — compile-time constant, not persisted.
- **Response DTOs** (transient): `ResetProjectResult` (exists), `{ unblockedCount, unblockedIds }`
  (exists), `ValidateBacklogResult` `{ valid, findings[] }` (exists), and a new `ResumeResult`
  `{ reconciled: ReconcileSummary, relaunched: boolean, reason?: string }`.

## 5. API Design

All routes are under the projects router, inherit the global CSRF guard (POST requires
`X-Rauf-Request: true`, `app.ts:54`) and the two path guards (`resolveProjectPath` null→400;
`validateProjectPath` sandbox→400), and resolve `BacklogPaths` via `resolveBacklogPathsFromParam`. The
`Result<T>`→HTTP mapping reuses the established convention (D7). Response envelope: success `{ data }`,
error `{ error: { code, message, details? } }`.

| Method · Path | Body | Core/loop call | Success | Guarded? |
|---|---|---|---|---|
| `POST /api/projects/:id/reset` | `{ clearBacklog?, keepProgress?, keepLog?, backlogRoot? }` | `resetProject(paths, opts)` | `200 { data: ResetProjectResult }` | 409 if live (D3.4) |
| `POST /api/projects/:id/resume` | `{ backlogRoot?, retryBlocked?, answers?: {itemId,answer}[] }` | `updateItem`→`recoverInterruptedLoop`→`startLoop` | `200 { data: ResumeResult }` | 409 if live |
| `POST /api/projects/:id/loop/review` | `{ model?, backlogRoot? }` | `loopManager.startReviewLoop` | `200 { data: { started: true } }` | 409 if a loop already running (start path) |
| `POST /api/projects/:id/backlog/unblock` | `{ itemId?, backlogRoot? }` | `unblockItems(paths, itemId?)` | `200 { data: { unblockedCount, unblockedIds } }` | 409 if live |
| `GET /api/projects/:id/backlog/validate` | — (query `?backlogRoot=`) | `validateBacklog(paths, {})` | `200 { data: ValidateBacklogResult }` | none (read-only) |

Notes:
- **`validate` is `GET`** — it mutates nothing (read-only), so it needs neither the CSRF header nor the
  liveness guard, and is safe during a run (satisfies REQ-WEB-05 + REQ-OBS-01 machine-readable result).
  The frontend "Validate" control issues the GET.
- `unblock` lives under `backlog/` to sit beside the existing `backlog/sweep`/`backlog/restore`
  conventions; the other recovery verbs sit at the project root like the existing `loop/stop`.
- 404 when no backlog/state file exists (`FILE_NOT_FOUND`); 400 for bad args/JSON/sandbox; 409 for
  `LOCK_CONFLICT`; 500 only for `IO_ERROR`.

### 5.1 Frontend (REQ-WEB-01..07)

Recovery controls live on the project **status page** (`packages/web/src/client/routes/projects/
status.tsx`) as a "Recovery" control group. Each control is a TanStack Query **mutation** (validate is
a query) sending `X-Rauf-Request: true`. Per REQ-WEB-06 each surfaces its result (toast/inline:
"unblocked 3 items", the validation findings list, or the error reason). Per REQ-WEB-07 controls
disable when not meaningful (resume disabled when nothing is paused; reset confirms before firing). A
`409 LOCK_CONFLICT` renders as "a loop is running — stop it first," not a generic error.

## 6. Integration Points

Verified signatures (file:line):

- `resetProject(paths: BacklogPaths, options?: ResetProjectOptions): Result<ResetProjectResult>` —
  `packages/core/src/reset.ts:48`. Synchronous; atomic writes.
- `unblockItems(paths: BacklogPaths, itemId?: string): Result<{ unblockedCount; unblockedIds }>` —
  `packages/core/src/backlog.ts:431`.
- `validateBacklog(paths: BacklogPaths, opts?: ValidateBacklogOptions): Result<ValidateBacklogResult>`
  — `packages/core/src/backlog-validate.ts:47`. `ValidateBacklogResult = { valid, findings[] }`.
- `updateItem(paths, itemId, patch): Result<…>` — `@rauf/core` (used for `--answer` injection).
- `recoverInterruptedLoop(paths)` — currently `packages/cli/src/recovery.ts`; **to be moved** to
  `packages/loop/src/recovery.ts` (D3.1). Uses `findItemCommit`/`isTreeClean`/`gitCommit` (already in
  `@rauf/loop`).
- `LoopRunner.startReviewOnly(): Promise<LoopResult>` — `packages/loop/src/runner.ts:406`.
- `LoopManager.startLoop(projectPath, options)` — `packages/web/src/server/loop-manager.ts`; **add**
  `startReviewLoop(projectPath, options)` beside it.
- `checkLock(lockPath): Result<LockStatus>` — `@rauf/core` (already imported by `LoopManager`); basis
  for `assertNoLiveLoop` (D3.4).
- `resolveProjectPath` (`resolve-project.ts:18`), `validateProjectPath` (`projects.ts:159`),
  `resolveBacklogPathsFromParam` (`projects.ts:169`), `errorResponse` (`app.ts`) — reused verbatim.
- `LoopStateEnumSchema` (`schemas.ts:228`), `mapLoopStateStatus` (`status.ts:106`), `statusExitCode`
  (`status-commands.ts:512`), `colorLoopState` (`status-commands.ts:538`), web `STATE_BADGE`
  (`status.tsx:18`, `index.tsx:48`) — modified per D3.3/D3.5.

**Packages importing this feature's new code:** `@rauf/cli` (relocated `recoverInterruptedLoop`,
`state-labels`), `@rauf/web` (recovery routes, `state-labels`, `startReviewLoop`).
**Conflict check:** no other in-progress spec dirs touch these files (the grammar feature is merged).

## 7. Error Handling

- Core/loop functions return `Result<T, RaufError>` (`errors.ts:9`); routes map: `FILE_NOT_FOUND`→404,
  `LOCK_CONFLICT`→409, `VALIDATION_ERROR`/`INVALID_JSON`/`PATH_VIOLATION`→400, `IO_ERROR`→500, else 400.
- `errorResponse(code, message, details?)` builds `{ error: { code, message, details? } }`.
- The liveness guard returns `err({ code: LOCK_CONFLICT, … })` → 409 (D3.4).
- Frontend maps known codes to friendly copy; unknown codes show `message` verbatim.
- Resume reconcile failures (e.g. dirty tree it can't reconcile) surface as the `reason` in
  `ResumeResult` with `relaunched:false` — not an HTTP error (the action partially succeeded).

## 8. Testing Approach

Per REQ-TEST-01/02/03 (backend + core unit; **no React harness**):

- **Backend route tests** (`packages/web/src/server/routes/*.test.ts`, Vitest, `createApp`/router
  factory + temp dir) for each new endpoint: success, **403 missing `X-Rauf-Request`**, **409 when a
  loop is live** (seed a live lock), 404 missing files, 400 bad body. Mirror `routes/loop.test.ts` /
  `routes/projects.test.ts`.
- **Core unit tests** for `state-labels.ts`: assert `STATE_LABELS` has an entry for **every**
  `LoopStateEnum` value (total coverage — iterate the enum), correct label + tone for each, and that
  `getStateLabel` never returns undefined.
- **Core unit tests** for the extended `mapLoopStateStatus` (`reviewing→REVIEWING`,
  `paused_usage_limit→PAUSED_USAGE_LIMIT`, all 12 raw mapped) and `statusExitCode`
  (`REVIEWING→6`, `PAUSED_USAGE_LIMIT→4`).
- **Relocated tests:** move `recoverInterruptedLoop`'s existing tests to `packages/loop` with the
  function; CLI keeps an import-smoke assertion.
- Full gate: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.

## 9. Dependencies

No new external dependencies. Internal: web → `@rauf/core` + `@rauf/loop` (existing); cli → `@rauf/loop`
(existing). TS strict / `noUncheckedIndexedAccess`, named exports, `node:` prefix (D-conventions).
**Version:** a normal **minor** bump (→ `0.6.0`) for the new web features (`packages/core/src/version.ts`)
— additive, **not** a contract break; `minRunnerVersion` and feature-forge are untouched (C-1).

## 10. Open Technical Questions

- **OQ-T1 (implementation spec):** exact `tone`→palette tables — terminal colors (CLI) and the CSS
  color values (web) per tone. Functional behavior is fixed (D3.5); only the concrete color values
  remain, settled in the implementation spec / during impl.
- **OQ-T2 (implementation spec):** resume `answers` request shape — confirm the `{itemId, answer}[]`
  field names match the CLI `--answer` parsing so the contract reads consistently.
- All PRD open questions (OQ-1, OQ-2) are **resolved** by D3.1 and D3.5 respectively.
