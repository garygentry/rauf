# 04 — Web Recovery Routes & Status-Page Controls

> Domain document for `ux-overhaul-web` (Phase 4 of the UX/DX overhaul). Specifies the **five web
> recovery endpoints** (`reset`, `resume`, `loop/review`, `backlog/unblock`, `backlog/validate`), the
> `LoopManager.startReviewLoop` method, the `assertNoLiveLoop` guard helper, and the status-page
> "Recovery" control group. Implements `tech-spec.md` §3.1, §3.2, §3.4, §5, §6, §7 and the route/UI
> halves of decisions D3.1 / D3.2 / D3.4. Resolves **OQ-T2** wiring.
>
> Builds on `00-core-definitions.md` (shared types, route body Zod schemas, `ResumeResult`,
> error→HTTP table) and `01-architecture-layout.md` (route placement). Calls the `@rauf/loop`
> recovery API relocated by `03-recovery-relocation.md`. **Does not redefine** any type from `00` —
> references them.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-WEB-01 | Web reset action (backend + frontend) | §3, §8.1 |
| REQ-WEB-02 | Web resume action (reconcile + relaunch) | §4, §8.2 |
| REQ-WEB-03 | Web review action (standalone review pass) | §5, §6, §8.3 |
| REQ-WEB-04 | Web unblock action | §7.1, §8.4 |
| REQ-WEB-05 | Web validate action (machine-readable) | §7.2, §8.5 |
| REQ-WEB-06 | Recovery results are visible | §8 (result surfacing) |
| REQ-WEB-07 | Controls reflect applicability | §8.6, §8.7 |
| REQ-WEB-09 | Mutations safe under concurrency | §2 (guards), §3, §4, §7.1 |
| REQ-SEC-01 | Mutation auth (`X-Rauf-Request`) | §2.4 (inherited CSRF) |
| REQ-SEC-02 | Path sandboxing | §2.1 (`validateProjectPath`) |
| REQ-OBS-01 | Validation findings structured | §7.2, §8.5 |

## Dependencies

Implement these first:
- **`00-core-definitions.md`** — `Result`/`ok`/`err`/`RaufError`, `ErrorCodes`, `BacklogPaths`,
  `checkLock`/`LockStatus`, the extended `LoopStateEnum`, the relocated recovery types
  (`RecoverySummary`, `AcquiredRecoveryLock`, …), the reused core result types (`ResetProjectResult`,
  `unblockItems`, `ValidateBacklogResult`, `updateItem`), the `ResumeResult` DTO (§6), and the route
  body Zod schemas + **OQ-T2 resolution** (resume `answers: { itemId, text }[]`) (§7).
- **`01-architecture-layout.md`** — route placement (§6.1), `LoopManager.startReviewLoop` placement
  (§6.2), the `assertNoLiveLoop` guard placement (§6.3), the version bump.
- **`03-recovery-relocation.md`** — the `@rauf/loop` recovery API this doc calls: `acquireRecoveryLock`,
  `releaseRecoveryLock`, `recoverInterruptedLoop` (async), and their exact signatures. **Until 03 is
  implemented these symbols still live in `@rauf/cli` and must NOT be imported by web** (would violate
  rule #1). This document assumes the post-03 import path `@rauf/loop`.

This doc is consumed by `06-testing-strategy.md` (route tests) and the docs update (`SPEC-WEB.md`).

## 1. Overview & route inventory

Five recovery actions reach web parity with their CLI counterparts. All wrap **existing** core/loop
logic (REQ-WEB-08) — no new recovery business logic in the web layer.

| Method · Path | File | Body / query | Core/loop call | Success envelope | Guard |
|---|---|---|---|---|---|
| `POST /api/projects/:id/reset` | `routes/projects.ts` | `ResetBodySchema` | `resetProject(paths, opts)` | `200 { data: ResetProjectResult }` | acquire-and-hold (D3.4) |
| `POST /api/projects/:id/resume` | `routes/projects.ts` | `ResumeBodySchema` | `updateItem`→`recoverInterruptedLoop`→`startLoop` | `200 { data: ResumeResult }` | acquire-and-hold (D3.4) |
| `POST /api/projects/:id/loop/review` | `routes/loop.ts` | `ReviewBodySchema` | `loopManager.startReviewLoop` | `200 { data: { started: true } }` | start-path 409 (loop already running) |
| `POST /api/projects/:id/backlog/unblock` | `routes/projects.ts` | `UnblockBodySchema` | `unblockItems(paths, itemId?)` | `200 { data: { unblockedCount, unblockedIds } }` | `assertNoLiveLoop` (lightweight) |
| `GET /api/projects/:id/backlog/validate` | `routes/projects.ts` | query `?backlogRoot=` | `validateBacklog(paths, {})` | `200 { data: ValidateBacklogResult }` | none (read-only) |

Body schemas (`ResetBodySchema`, `ResumeBodySchema`, `ReviewBodySchema`, `UnblockBodySchema`) are
defined verbatim in `00-core-definitions.md §7` — **do not redefine them**; import/colocate per the
existing per-file pattern (`StartLoopBodySchema` in `loop.ts:35`, `SweepBodySchema` in
`projects.ts:61`). The `GET validate` route takes no body.

**Route registration ordering (critical).** Both `unblock` and `validate` live under `/:id/backlog/…`
where `/:id/backlog/:itemId` already exists. Following the existing precedent
(`POST /:id/backlog/restore` and `/:id/backlog/sweep` are registered **before** `/:id/backlog/:itemId`
so `"restore"`/`"sweep"` are never mismatched as an `itemId` — `projects.ts:484-528`), register
`POST /:id/backlog/unblock` and `GET /:id/backlog/validate` **before** the `:itemId` routes so
`"unblock"`/`"validate"` are never captured as item IDs.

## 2. Shared route preamble & guard model

### 2.1 The four-step preamble (every route)

Every recovery handler reuses the **closures already defined in the router factory** — `resolveProjectPath`
(`projects.ts:151` / `loop.ts:133`, wrapping `resolve-project.ts:18`), `validateProjectPath`
(`projects.ts:159`), `resolveBacklogPathsFromParam` (`projects.ts:169`), and `errorResponse`
(`app.ts:26`). **Do not write new path-resolution logic.**

1. **Resolve project path** — `resolveProjectPath(id)`; `null` → `400 INVALID_ID`
   (`errorResponse("INVALID_ID", \`Invalid project ID: ${id}\`)`).
2. **Validate sandbox (REQ-SEC-02)** — `validateProjectPath(projectPath)`; non-null (a violation code)
   → `400 PATH_VIOLATION` (`errorResponse("PATH_VIOLATION", "Project ID escapes root directory")`).
   Per `tech-spec §7`, `validateProjectPath` returns the underlying `validatePath` error **code**; the
   existing handlers all map it to the literal `"PATH_VIOLATION"` response — match that convention.
3. **Parse body** — `await c.req.json().catch(() => ({}))` then `<Schema>.safeParse(raw)`; failure →
   `400 VALIDATION_ERROR` with `parseResult.error.flatten()` as `details`. (Mirrors `loop.ts:157-164`.
   An empty `{}` body is valid for reset/unblock/review.) The `GET validate` route skips this step.
4. **Resolve `BacklogPaths`** — `resolveBacklogPathsFromParam(projectPath, body.backlogRoot)`; on
   `!ok` → `400` with `errorResponse(resolved.code, resolved.message)`. (Mirrors `projects.ts:550-553`.)

The `id` is read via `c.req.param("id")` exactly as every existing handler does.

### 2.2 The `Result<T>` → HTTP mapping (from `00 §8.1`)

After the core/loop call returns `Result<T>`, map `result.error.code` to status using the table in
`00-core-definitions.md §8.1`. Implement once as a small local helper so all four mutating routes agree:

```ts
// routes/projects.ts (and loop.ts) — local to the router factory
function recoveryErrorStatus(code: string): 400 | 404 | 409 | 500 {
  switch (code) {
    case ErrorCodes.FILE_NOT_FOUND:
      return 404;
    case ErrorCodes.LOCK_CONFLICT:
      return 409;
    case ErrorCodes.IO_ERROR:
      return 500;
    case ErrorCodes.VALIDATION_ERROR:
    case ErrorCodes.INVALID_JSON:
      return 400;
    default:
      return 400;
  }
}
```

`ErrorCodes` is already imported in `projects.ts:42`; add it to `loop.ts`'s `@rauf/core` import for the
review route. On `!result.ok`:

```ts
const status = recoveryErrorStatus(result.error.code);
return c.json(
  errorResponse(result.error.code, result.error.message, result.error.details),
  status,
);
```

### 2.3 The concurrency guard model (D3.4, REQ-WEB-09)

Three guard strengths, by action — see the per-route handlers for placement:

- **`reset`, `resume` — acquire-and-hold.** A bare pre-check is **insufficient**: these call
  `recoverInterruptedLoop`, which by contract does **not** touch the lock (the caller must hold it),
  and a check-then-act leaves a TOCTOU window where a CLI `rauf loop run` acquires the lock between the
  web check and the web mutation. So both `acquireRecoveryLock(paths)` and **hold** the lock across the
  whole reconcile (+ relaunch handoff for resume), releasing in a `finally` via the owner-aware
  `releaseRecoveryLock(paths)`. This mirrors exactly what the CLI `resume` does
  (`resume-commands.ts:268-424`). A failed acquire whose code is `LOCK_CONFLICT` → `409`. See `03` for
  the acquire/release contract. (Cross-ref: this is why reset/resume do **not** use the lightweight
  `assertNoLiveLoop` helper — they need to *hold* the lock, not just sample it.)
- **`unblock` — lightweight check-then-act (`assertNoLiveLoop`).** A single `unblockItems` write is
  short enough that the residual window is acceptable; a `checkLock`-based pre-check (cross-process —
  catches a detached/CLI loop, not just loops this server started) is sufficient. Live →
  `409 LOCK_CONFLICT`. See §2.5.
- **`review` — start-path 409.** Goes through `LoopManager.startReviewLoop`, which already refuses a
  second loop on the same backlog root with the start path's existing 409.
- **`validate` — none.** Read-only; safe during a live run; never guarded.

### 2.4 CSRF / auth (REQ-SEC-01) — inherited, not per-route

The four POST routes inherit the app-level CSRF middleware (`app.ts:54-69`): any POST/PUT/DELETE
missing `X-Rauf-Request: true` returns `403 FORBIDDEN` **before** the handler runs. **No per-route 403
mapping is written** — the `06` test "403 missing header" is satisfied by the inherited middleware.
The `GET validate` route is a read and is *not* subject to the CSRF check (and needs no header). The
server binds `127.0.0.1` only (unchanged).

### 2.5 `assertNoLiveLoop(paths)` helper (web layer)

A small web-server-layer helper wrapping core `checkLock` (`00 §1`; `lock.ts:243`, already imported by
`LoopManager`). Place it in a shared `packages/web/src/server/routes/recovery-guard.ts` (or inline in
`projects.ts`) per `01 §6.3`.

```ts
// packages/web/src/server/routes/recovery-guard.ts
import { checkLock, err, ok, ErrorCodes, type Result, type BacklogPaths } from "@rauf/core";

/**
 * Reject a recovery mutation when a loop is *live* on this backlog root.
 * "Live" = lock present AND not stale (a stale lock is a crashed loop, not a
 * conflict). Cross-process: detects a detached/CLI loop, not only loops this
 * server started. A checkLock IO failure is treated as "not live" (fail-open)
 * so a transient lock-read error does not block recovery — the subsequent
 * core call still carries core's atomic-write guarantees (rule #2).
 *
 * @param paths - resolved BacklogPaths for the target backlog root
 * @returns ok(void) when no live loop holds the lock; err(LOCK_CONFLICT) otherwise
 */
export function assertNoLiveLoop(paths: BacklogPaths): Result<void> {
  const lock = checkLock(paths);
  if (lock.ok && lock.value.locked && lock.value.stale !== true) {
    return err({
      code: ErrorCodes.LOCK_CONFLICT,
      message: "a loop is running on this backlog root — stop it first",
    });
  }
  return ok(undefined);
}
```

**Error handling:** the only failure path is the `LOCK_CONFLICT` it constructs → mapped to `409` by
`recoveryErrorStatus`. A `checkLock` IO error is intentionally non-fatal (fail-open) — the heavier
acquire-and-hold guard is used precisely where the window must be closed (reset/resume).

## 3. `POST /:id/reset` (REQ-WEB-01, REQ-WEB-09, D3.4)

Reset a project's loop state (web equivalent of CLI `reset`) with the CLI's option surface:
`clearBacklog`, `keepProgress`, `keepLog` (from `ResetProjectOptions`, `00 §5`) + optional
`backlogRoot`. Acquire-and-hold guarded.

```ts
// routes/projects.ts — registered alongside the other /:id recovery verbs
router.post("/:id/reset", async (c) => {
  // 1–2. path + sandbox (§2.1)
  const id = c.req.param("id");
  const projectPath = resolveProjectPath(id);
  if (!projectPath) {
    return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
  }
  const violation = validateProjectPath(projectPath);
  if (violation) {
    return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
  }

  // 3. body
  const raw = await c.req.json().catch(() => ({}));
  const parsed = ResetBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorResponse("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      400,
    );
  }
  const body = parsed.data;

  // 4. paths
  const resolved = resolveBacklogPathsFromParam(projectPath, body.backlogRoot);
  if (!resolved.ok) {
    return c.json(errorResponse(resolved.code, resolved.message), 400);
  }
  const paths = resolved.paths;

  // Guard: acquire-and-hold (D3.4). A live loop → 409; a stale lock is cleared.
  const acquired = acquireRecoveryLock(paths);
  if (!acquired.ok) {
    const status = acquired.error.code === ErrorCodes.LOCK_CONFLICT ? 409 : 400;
    return c.json(errorResponse(acquired.error.code, acquired.error.message), status);
  }

  try {
    const result = resetProject(paths, {
      clearBacklog: body.clearBacklog,
      keepProgress: body.keepProgress,
      keepLog: body.keepLog,
    });
    if (!result.ok) {
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        recoveryErrorStatus(result.error.code),
      );
    }
    return c.json({ data: result.value });
  } finally {
    // Always release — reset does not relaunch, so release unconditionally.
    releaseRecoveryLock(paths);
  }
});
```

**Why acquire-and-hold (not `assertNoLiveLoop`):** `resetProject` performs multiple atomic writes
(stalled-item reset, state/done/cancel clear, archive). Holding the lock across the whole reset closes
the window where a CLI `loop run` could grab the lock and start mid-reset. See `03` for the
acquire/release contract.

**Error handling:**
- `LOCK_CONFLICT` on acquire → `409` ("a loop is running…"); other acquire errors → `400`.
- `resetProject` errors map via `recoveryErrorStatus` (`FILE_NOT_FOUND`→404, `IO_ERROR`→500, else 400).
- The `finally` releases the lock on every path including a thrown error (`releaseRecoveryLock` is
  owner-aware and a no-op if not held).

**Success:** `200 { data: ResetProjectResult }` (`00 §5`) — the frontend renders a summary
(e.g. "Reset: cleared state, reset N stalled, archived progress").

## 4. `POST /:id/resume` (REQ-WEB-02, REQ-WEB-06, REQ-WEB-09, D3.1, D3.4; resolves OQ-T2)

Resume a paused/stopped loop (web equivalent of CLI `resume`) — **reconcile + relaunch only**. The
heavier `--recover` sub-path (re-verify the project's verify command in a subprocess, then `gitCommit`)
is **CLI-only** for Phase 4 (D3.1 scope) and is **not** exposed here; interrupted-but-uncommitted work
is surfaced in `ResumeResult.reason` (see below), not auto-committed.

Orchestration (mirrors `resume-commands.ts:268-424`, minus the `--recover` branch):

1. Preamble (§2.1) with `ResumeBodySchema`.
2. `acquireRecoveryLock(paths)` — held across the whole reconcile + the relaunch handoff (D3.4).
3. **Answer injection (OQ-T2 resolution).** For each `{ itemId, text }` in `body.answers ?? []`, call
   `updateItem(paths, itemId, { humanAnswer: text, status: "pending", needsHuman: false,
   blockedReason: null })` — identical to the CLI's injection (`resume-commands.ts:301-306`). The
   request field is **`text`** (matching the CLI's `AnswerInjection { itemId, text }`,
   `resume-commands.ts:55`) and is written to the item as `humanAnswer` (`00 §7` binding). The
   `retryBlocked` body flag is the web equivalent of the CLI retry-blocked convenience: when set,
   re-queue genuinely-blocked items before reconciling (call `unblockItems(paths)` — but only AFTER the
   lock is held; it shares the same paths).
4. `await recoverInterruptedLoop(paths)` — **async**, must `await` (`03`; `Promise<Result<RecoverySummary>>`).
5. **Relaunch decision.** Read the post-reconcile backlog (`readBacklog(paths)`); if
   `selectNextItem(backlog) === null` → nothing eligible, `relaunched: false`,
   `reason: "no eligible items"`. Otherwise hand off to `loopManager.startLoop(projectPath, options)`
   (detached, server-owned) → `relaunched: true`.
6. `releaseRecoveryLock(paths)` in a `finally` — released **before** `startLoop` is *not* required here
   because the web's `startLoop` runs the loop in-process under the manager; however to match the CLI
   contract (the loop's own entrypoint re-acquires the lock) the relaunch must happen **after** release.
   Structure it as: do reconcile + decision inside the `try`, set a `relaunch` flag + captured
   `options`, release in `finally`, then call `startLoop` after the `try/finally` — exactly the CLI's
   shape (`resume-commands.ts:291-426`).

```ts
// routes/projects.ts
router.post("/:id/resume", async (c) => {
  // 1. preamble (path/sandbox/body/paths) — same four steps as §3
  const id = c.req.param("id");
  const projectPath = resolveProjectPath(id);
  if (!projectPath) return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
  const violation = validateProjectPath(projectPath);
  if (violation)
    return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);

  const raw = await c.req.json().catch(() => ({}));
  const parsed = ResumeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorResponse("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      400,
    );
  }
  const body = parsed.data;

  const resolved = resolveBacklogPathsFromParam(projectPath, body.backlogRoot);
  if (!resolved.ok) return c.json(errorResponse(resolved.code, resolved.message), 400);
  const paths = resolved.paths;

  // 2. acquire-and-hold (D3.4)
  const acquired = acquireRecoveryLock(paths);
  if (!acquired.ok) {
    const status = acquired.error.code === ErrorCodes.LOCK_CONFLICT ? 409 : 400;
    return c.json(errorResponse(acquired.error.code, acquired.error.message), status);
  }

  let relaunch = false;
  let relaunchOptions: LoopStartOptions | null = null;
  let reconciled: RecoverySummary | null = null;
  let reason: string | undefined;

  try {
    // 3. answer injection (OQ-T2: { itemId, text } → humanAnswer)
    for (const { itemId, text } of body.answers ?? []) {
      const upd = updateItem(paths, itemId, {
        humanAnswer: text,
        status: "pending",
        needsHuman: false,
        blockedReason: null,
      });
      if (!upd.ok) {
        return c.json(
          errorResponse(upd.error.code, `Could not inject answer into ${itemId}: ${upd.error.message}`),
          recoveryErrorStatus(upd.error.code),
        );
      }
    }

    // 3b. retry-blocked convenience (REQ-WEB-02): re-queue genuine blocks first
    if (body.retryBlocked) {
      const ub = unblockItems(paths);
      if (!ub.ok) {
        return c.json(
          errorResponse(ub.error.code, ub.error.message, ub.error.details),
          recoveryErrorStatus(ub.error.code),
        );
      }
    }

    // 4. reconcile (async) — recoverInterruptedLoop does NOT touch the lock; we hold it
    const recovery = await recoverInterruptedLoop(paths);
    if (!recovery.ok) {
      return c.json(
        errorResponse(recovery.error.code, recovery.error.message, recovery.error.details),
        recoveryErrorStatus(recovery.error.code),
      );
    }
    reconciled = recovery.value;

    // 4b. interrupted-but-uncommitted work is the CLI-only --recover path; surface, don't commit
    if (reconciled.interrupted.length > 0) {
      reason = `${reconciled.interrupted.length} item(s) have uncommitted work — run \`rauf resume --recover\` from the CLI to re-verify and commit before resuming.`;
      relaunch = false;
    } else {
      // 5. relaunch decision
      const post = readBacklog(paths);
      if (post.ok && selectNextItem(post.value) === null) {
        reason = "no eligible items";
        relaunch = false;
      } else {
        relaunch = true;
        relaunchOptions = LoopStartOptionsSchema.parse({
          maxIterations: resolveRequestMaxIterations(projectPath, null, body.backlogRoot),
          maxRetries: DEFAULT_MAX_RETRIES,
          sessionTimeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
          backlogRoot: paths === defaultBacklogPaths(projectPath) ? undefined : body.backlogRoot,
        });
      }
    }
  } finally {
    // Release BEFORE relaunch so the loop's own lock acquisition succeeds (CLI contract).
    releaseRecoveryLock(paths);
  }

  // 6. relaunch after release
  let relaunched = false;
  if (relaunch && relaunchOptions) {
    const started = loopManager.startLoop(projectPath, relaunchOptions);
    relaunched = started.ok;
    if (!started.ok) reason = started.error; // e.g. "Loop already running…"
  }

  const result: ResumeResult = { reconciled: reconciled!, relaunched, reason };
  return c.json({ data: result });
});
```

> **Notes on the relaunch path.** `resolveRequestMaxIterations`, `DEFAULT_MAX_RETRIES`, and
> `DEFAULT_SESSION_TIMEOUT_MINUTES` are the loop-route helpers/constants (`loop.ts:54-87, :186`). If
> the resume handler lives in `projects.ts`, either lift these to a shared module
> (`packages/web/src/server/loop-defaults.ts`) or import them; do **not** duplicate the default
> values (single source). `loopManager` is `getLoopManager()` (`loop-manager.ts:279`).
> `LoopStartOptionsSchema`, `readBacklog`, `selectNextItem`, `defaultBacklogPaths`, `updateItem`,
> `unblockItems` are `@rauf/core`; `acquireRecoveryLock`/`releaseRecoveryLock`/`recoverInterruptedLoop`
> and `RecoverySummary` are `@rauf/loop` (post-03).

**Why this is reconcile+relaunch only (the `--recover` boundary).** The CLI's `resume` has a
`--recover` mode that spawns the project's verify command and `gitCommit`s verified-but-uncommitted
work (`resume-commands.ts:350-362`, `reverifyAndCommitInterrupted`). Per D3.1 that subprocess-bound path
**stays in `@rauf/cli`** and is not relocated to `@rauf/loop`, so the web cannot call it without forking
logic (would violate REQ-WEB-08). The web therefore reconciles committed work + requeues false blocks +
resets stalled items + relaunches, and when it detects interrupted-but-uncommitted items it **surfaces
them in `reason`** with `relaunched: false` (a partial success, not an HTTP error — `tech-spec §7`).

**Error handling:**
- Acquire `LOCK_CONFLICT` → `409`; other acquire errors → `400`.
- `updateItem` / `unblockItems` / `recoverInterruptedLoop` errors → mapped via `recoveryErrorStatus`
  (these `return` inside the `try`; the `finally` still releases the lock).
- A failed **relaunch** (`startLoop` returns `{ ok:false }`, e.g. a loop raced in after release) is
  **not** an HTTP error — it is reported as `relaunched:false` + `reason` in a `200` `ResumeResult`
  (the reconcile already succeeded; partial success per `tech-spec §7`).
- The `finally` releases the lock on every path including thrown errors.

**Success:** `200 { data: ResumeResult }` (`00 §6`) — `{ reconciled, relaunched, reason? }`.

## 5. `POST /:id/loop/review` (REQ-WEB-03, D3.2)

Run a standalone review pass (web equivalent of CLI `loop review`). Lives in `routes/loop.ts` beside
the loop-lifecycle routes (`01 §6.1`). Builds `LoopStartOptions` via `LoopStartOptionsSchema.parse`
(the start route's pattern, `loop.ts:178-189`) and calls the new `LoopManager.startReviewLoop`. Returns
immediately; the review runs server-side and is observed via the existing events SSE (Phase 1 read
path).

```ts
// routes/loop.ts — registered with the loop lifecycle routes
router.post("/:id/loop/review", async (c) => {
  const id = c.req.param("id");
  const projectPath = resolveProjectPath(id);
  if (!projectPath) return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
  const violation = validateProjectPath(projectPath);
  if (violation)
    return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);

  const raw = await c.req.json().catch(() => ({}));
  const parsed = ReviewBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorResponse("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      400,
    );
  }
  const body = parsed.data ?? {};

  // Resolve backlog root (relative → absolute), same as the start route.
  let backlogRoot: string | undefined;
  if (body.backlogRoot) {
    const rootResult = resolveBacklogRoot(projectPath, body.backlogRoot);
    if (!rootResult.ok) {
      return c.json(errorResponse(rootResult.error.code, rootResult.error.message), 400);
    }
    backlogRoot = rootResult.value;
  }

  const options = LoopStartOptionsSchema.parse({
    maxIterations: 1,
    maxRetries: 1,
    review: true,
    reviewOnly: true,
    // sessionTimeoutMinutes is REQUIRED by the schema — reuse the start route's default.
    sessionTimeoutMinutes: body.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
    model: body.model,
    backlogRoot,
  });

  const manager = getLoopManager();
  const result = manager.startReviewLoop(projectPath, options);
  if (!result.ok) {
    // Inherits the start path's loop-already-running 409.
    return c.json(errorResponse("CONFLICT", result.error), 409);
  }

  return c.json({ data: { started: true } });
});
```

**Guard:** no separate lock guard — `startReviewLoop` uses the same in-manager map-key dedupe as
`startLoop`, so a review pass on a backlog root that already has a live (server-started) loop is
refused with the start path's 409 (`loop-manager.ts:92-94`). A detached/CLI loop on the same root is
not in the manager map; the underlying `LoopRunner.create`/`startReviewOnly` carries core's own lock
acquisition (unchanged engine behavior, D3.2).

**Error handling:** `400` for path/sandbox/body/backlog-root resolution; `409 CONFLICT` when a loop is
already running for the backlog root. The review's own internal failures surface as `review_failed`
events on the SSE stream (`status.tsx:542`), not as an HTTP error (the action started successfully).

**Success:** `200 { data: { started: true } }`.

## 6. `LoopManager.startReviewLoop` (D3.2)

Add beside `startLoop` (`loop-manager.ts:86`). Identical structure — same `resolveKey`, same
already-running guard, same event subscription, same promise tracking and map cleanup — but calls
`runner.startReviewOnly()` (`runner.ts:406`, `Promise<LoopResult>`) instead of `runner.start()`.

```ts
// packages/web/src/server/loop-manager.ts — beside startLoop
/**
 * Start a STANDALONE REVIEW pass for a project (D3.2). Mirrors startLoop but
 * runs LoopRunner.startReviewOnly() instead of start(). Returns an error string
 * if a loop is already running for the same backlog root.
 *
 * @param projectPath - absolute project path
 * @param options - LoopStartOptions (reviewOnly:true, maxIterations:1, …)
 */
startReviewLoop(
  projectPath: string,
  options: LoopStartOptions,
): { ok: true } | { ok: false; error: string } {
  const key = this.resolveKey(projectPath, options.backlogRoot);

  if (this.activeLoops.has(key)) {
    return { ok: false, error: "Loop already running for this backlog root" };
  }

  const runnerResult = LoopRunner.create(projectPath, options);
  if (!runnerResult.ok) {
    return { ok: false, error: runnerResult.error.message };
  }
  const runner = runnerResult.value;

  for (const eventType of LOOP_EVENT_TYPES) {
    runner.on(eventType, (event: LoopEvent) => {
      this.fanOut(key, event);
    });
  }

  const promise = runner.startReviewOnly().then(
    (result) => {
      this.activeLoops.delete(key);
      this.deferBufferCleanup(key);
      return result;
    },
    (error) => {
      this.activeLoops.delete(key);
      this.deferBufferCleanup(key);
      throw error;
    },
  );

  this.activeLoops.set(key, { runner, projectPath, promise });
  return { ok: true };
}
```

**Error handling:** returns `{ ok:false, error }` for already-running (mapped to 409 by the route) and
for `LoopRunner.create` failure (mapped to 409 by the route's generic `CONFLICT` mapping — matching the
start route's existing behavior, `loop.ts:194-196`). No new business logic; the runner is unchanged
(REQ-WEB-08).

**Verification:** `startReviewLoop` and `startLoop` share `resolveKey`, the dedupe guard, the event
subscription loop, and the promise/cleanup wiring — only the `runner.start()` → `runner.startReviewOnly()`
call differs.

## 7. `POST /:id/backlog/unblock` and `GET /:id/backlog/validate`

### 7.1 `POST /:id/backlog/unblock` (REQ-WEB-04, REQ-WEB-09)

Unblock all blocked items, or a specific item (web equivalent of CLI `backlog unblock`). Lightweight
guard (`assertNoLiveLoop`, §2.5). Registered before `/:id/backlog/:itemId` (see §1).

```ts
// routes/projects.ts — before the /:id/backlog/:itemId routes
router.post("/:id/backlog/unblock", async (c) => {
  const id = c.req.param("id");
  const projectPath = resolveProjectPath(id);
  if (!projectPath) return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
  const violation = validateProjectPath(projectPath);
  if (violation)
    return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);

  const raw = await c.req.json().catch(() => ({}));
  const parsed = UnblockBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorResponse("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
      400,
    );
  }
  const body = parsed.data;

  const resolved = resolveBacklogPathsFromParam(projectPath, body.backlogRoot);
  if (!resolved.ok) return c.json(errorResponse(resolved.code, resolved.message), 400);
  const paths = resolved.paths;

  // Lightweight guard (D3.4): refuse if a loop is live on this root.
  const live = assertNoLiveLoop(paths);
  if (!live.ok) {
    return c.json(errorResponse(live.error.code, live.error.message), 409);
  }

  const result = unblockItems(paths, body.itemId);
  if (!result.ok) {
    return c.json(
      errorResponse(result.error.code, result.error.message, result.error.details),
      recoveryErrorStatus(result.error.code),
    );
  }
  return c.json({ data: result.value }); // { unblockedCount, unblockedIds }
});
```

**Error handling:**
- `assertNoLiveLoop` → `409 LOCK_CONFLICT` when a loop is live.
- `unblockItems` errors map via `recoveryErrorStatus` (`FILE_NOT_FOUND`→404 when no backlog,
  `IO_ERROR`→500, else 400). An empty/no-blocked-items backlog is **success** with `unblockedCount:0`
  (not an error).

**Success:** `200 { data: { unblockedCount, unblockedIds } }` (`00 §5`).

### 7.2 `GET /:id/backlog/validate` (REQ-WEB-05, REQ-OBS-01)

Validate the backlog and return machine-readable findings (web equivalent of CLI `backlog validate
--json`). **`GET`** — read-only, mutates nothing, so it needs **no** `X-Rauf-Request` header (not
subject to the CSRF middleware, which only gates POST/PUT/DELETE) and **no** lock guard (safe during a
live run). Optional `?backlogRoot=`. Registered before `/:id/backlog/:itemId`.

```ts
// routes/projects.ts — before the /:id/backlog/:itemId routes
router.get("/:id/backlog/validate", (c) => {
  const id = c.req.param("id");
  const projectPath = resolveProjectPath(id);
  if (!projectPath) return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
  const violation = validateProjectPath(projectPath);
  if (violation)
    return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);

  const resolved = resolveBacklogPathsFromParam(projectPath, c.req.query("backlogRoot"));
  if (!resolved.ok) return c.json(errorResponse(resolved.code, resolved.message), 400);

  const result = validateBacklog(resolved.paths, {});
  if (!result.ok) {
    return c.json(
      errorResponse(result.error.code, result.error.message, result.error.details),
      recoveryErrorStatus(result.error.code),
    );
  }
  return c.json({ data: result.value }); // ValidateBacklogResult { valid, findings[] }
});
```

**Error handling:** `400` for path/sandbox/backlog-root resolution; `validateBacklog` errors map via
`recoveryErrorStatus` (`FILE_NOT_FOUND`→404 when no backlog.json, `INVALID_JSON`→400 for an
unparseable file, `IO_ERROR`→500). A backlog with **findings** is **not** an HTTP error — it returns
`200 { data: { valid:false, findings:[…] } }` (REQ-OBS-01: the result is the payload, not the status).

**Success:** `200 { data: ValidateBacklogResult }` — `{ valid, findings[] }` with
`findings[].{severity, code, message, itemId?, path?}` (`00 §5`).

## 8. Frontend — the "Recovery" control group (REQ-WEB-06, REQ-WEB-07)

Add a "Recovery" control group to the project status page
(`packages/web/src/client/routes/projects/status.tsx`), in or just below the loop-state Card (near the
existing Start/Stop controls, `status.tsx:997-1027`). Per REQ-TEST-03 there is **no** React test
harness; coverage comes from the backend route tests (§9). Use the same TanStack Query + `raufFetch`
patterns already in the file (`status.tsx:776-816`). `raufFetch` (`../../lib/fetch`) already injects
`X-Rauf-Request: true` on mutating requests — verify it does so for these new POSTs; if it only adds
the header for specific verbs, pass it explicitly.

Five controls: **Reset** (POST, confirm), **Resume** (POST), **Review** (POST), **Unblock** (POST),
**Validate** (GET query). Each surfaces its result (REQ-WEB-06). On any `409` show the friendly copy
"a loop is running — stop it first" rather than a generic error (`tech-spec §5.1`).

### 8.1 Result + error surfacing (REQ-WEB-06)

Add a `recoveryMessage` state (success/info string) alongside the existing `loopError`, plus a
`validationResult` state for the findings list. A shared helper extracts the error body:

```ts
// inside StatusView
const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
const [validationResult, setValidationResult] = useState<ValidateBacklogResult | null>(null);
const [confirmReset, setConfirmReset] = useState(false);

/** Friendly copy for known codes; raw message otherwise. */
async function recoveryErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (res.status === 409) return "a loop is running — stop it first";
  return body.error?.message ?? `HTTP ${res.status}`;
}
```

Each mutation: `onSuccess` sets `recoveryMessage` (e.g. `` `Unblocked ${data.unblockedCount} item(s)` ``),
clears `loopError`, and invalidates `["projects", projectId]`; `onError` sets `loopError`. Render
`recoveryMessage` in a dismissible info banner mirroring the existing `loopError` banner
(`status.tsx:1031-1048`).

### 8.2 Reset mutation (REQ-WEB-01, REQ-WEB-07 confirm)

```ts
const resetMutation = useMutation({
  mutationFn: async () => {
    const res = await raufFetch(`/api/projects/${encodeURIComponent(projectId)}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // default options; surface advanced flags later
    });
    if (!res.ok) throw new Error(await recoveryErrorMessage(res));
    return (await res.json()).data as ResetProjectResult;
  },
  onSuccess: (data) => {
    setLoopError(null);
    setRecoveryMessage(
      `Reset complete — ${data.stalledResetCount} stalled reset` +
        (data.stateCleared ? ", state cleared" : ""),
    );
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
  },
  onError: (err: Error) => setLoopError(err.message),
});
```

Reset is destructive → gate behind a confirm dialog (REQ-WEB-07): the "Reset" button sets
`confirmReset(true)`, which renders a small inline confirm ("This clears loop state. Continue?") with
Confirm → `resetMutation.mutate()` and Cancel.

### 8.3 Resume mutation (REQ-WEB-02)

POST `/resume` with an optional `{ answers?, retryBlocked? }` body (the status page's quick action
sends `{}`; an answers UI can be layered later). `onSuccess` surfaces the `ResumeResult`:
`relaunched ? "Resumed — loop relaunched" : \`Reconciled — ${reason ?? "nothing to relaunch"}\``.

### 8.4 Review mutation (REQ-WEB-03)

POST `/loop/review` with `{}` (default timeout). `onSuccess`: "Review pass started — watch the Event
Timeline." A `409` → "a loop is running — stop it first."

### 8.5 Unblock mutation (REQ-WEB-04, REQ-WEB-06)

POST `/backlog/unblock` with `{}` (all blocked) — or `{ itemId }` when triggered from a specific
`BlockedItemCard` (`status.tsx:203-224`; an "Unblock" button can be added there). `onSuccess`:
`` `Unblocked ${data.unblockedCount} item(s)` ``.

### 8.6 Validate query (REQ-WEB-05, REQ-OBS-01, REQ-WEB-07)

Validate is a **query**, not a mutation (GET), triggered on demand (`enabled:false` + `refetch()`, or a
manual fetch button):

```ts
const validateQuery = useQuery({
  queryKey: ["projects", projectId, "validate"],
  queryFn: () =>
    raufFetchJson<ValidateBacklogResult>(
      `/api/projects/${encodeURIComponent(projectId)}/backlog/validate`,
    ),
  enabled: false, // fired by the "Validate" button via refetch()
});
```

On success render the findings: if `valid` → "Backlog is valid" (success tone); otherwise a list of
`{severity, code, message, itemId?}` rows (error rows danger tone, warning rows warning tone). This is
the human rendering of the machine-readable result (REQ-OBS-01).

### 8.7 Applicability-based disabling (REQ-WEB-07)

Disable controls that are not meaningful for the current `status.loopState` (the derived enum, now
including `REVIEWING`/`PAUSED_USAGE_LIMIT` — `00 §2`):

| Control | Enabled when | Disabled when |
|---|---|---|
| Reset | always (but confirm-gated) | while `resetMutation.isPending` |
| Resume | `loopState ∈ {PAUSED, PAUSED_HUMAN, PAUSED_USAGE_LIMIT, ERROR, IDLE}` **and** there is non-done work | `RUNNING`/`REVIEWING`/`STARTING`, or nothing paused/pending |
| Review | `loopState ∉ {RUNNING, REVIEWING, STARTING}` | a loop already running (would 409) |
| Unblock | `status.backlogSummary.blocked > 0` | no blocked items, or loop live |
| Validate | always (read-only, safe during a run) | while `validateQuery.isFetching` |

"Nothing paused" for Resume = `loopState` is a running/idle-complete state with no pending+blocked work
(derive from `status.backlogSummary`). Disabling is a UX nicety; the backend still enforces every guard
(a disabled-bypass POST still hits the 409/400 paths). Use the existing button styling
(`status.tsx:1003-1011`) and `disabled:opacity-50` pattern.

## 9. Verification

- **Backend route tests pass** — see `06-testing-strategy.md`. Each endpoint (Vitest, `createApp`/router
  factory + temp dir, mirroring `routes/loop.test.ts` / `routes/projects.test.ts`):
  - **success** (200 + correct `{ data }` envelope shape per §1);
  - **403 missing `X-Rauf-Request`** on the four POSTs (inherited CSRF, §2.4) — and the GET `validate`
    succeeds **without** the header;
  - **409 when a loop is live** — seed a live (non-stale) lock, assert reset/resume/unblock return 409
    `LOCK_CONFLICT`; review returns 409 `CONFLICT` when a manager loop is already running;
  - **404** missing backlog/state file (`FILE_NOT_FOUND`);
  - **400** bad body (`safeParse` failure) and sandbox-escaping `:id`.
- **`assertNoLiveLoop`** returns `err(LOCK_CONFLICT)` for a live lock and `ok` for absent/stale/IO-error
  locks (fail-open).
- **`startReviewLoop`** parity: a unit/integration check that it dedupes on backlog root (second call
  returns `{ ok:false }`) and drives `runner.startReviewOnly()`.
- **OQ-T2 wiring:** a resume test posting `{ answers: [{ itemId, text }] }` asserts the item gains
  `humanAnswer === text`, `status === "pending"`, `needsHuman === false`, `blockedReason === null`.
- **No rule-#1 violation:** `grep -R "@rauf/cli" packages/web/src` returns nothing; the recovery
  symbols resolve from `@rauf/loop` (`01 §Verification`).
- **Full gate:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` green.

**Manual curl smoke (server on `127.0.0.1:5173`):**

```bash
# 403 — missing CSRF header on a POST
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://127.0.0.1:5173/api/projects/<id>/reset
# → 403

# 200 — reset with the header
curl -s -X POST http://127.0.0.1:5173/api/projects/<id>/reset \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' -d '{}'
# → { "data": { "stalledResetCount": …, "stateCleared": …, … } }

# 200 — validate is GET, no header required
curl -s 'http://127.0.0.1:5173/api/projects/<id>/backlog/validate'
# → { "data": { "valid": …, "findings": [ … ] } }

# 409 — unblock while a loop holds the lock
curl -s -X POST http://127.0.0.1:5173/api/projects/<id>/backlog/unblock \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' -d '{}'
# → 409 { "error": { "code": "LOCK_CONFLICT", "message": "a loop is running …" } }
```
