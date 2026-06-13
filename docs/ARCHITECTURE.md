---
title: System Architecture
description: High-level system diagram, data flow, and architectural principles for the rauf manager.
---

## Package Dependency Graph

```
packages/web  ──imports──►  packages/loop  ──imports──►  packages/core
packages/web  ──imports──►  packages/core
packages/cli  ──imports──►  packages/loop  ──imports──►  packages/core
packages/cli  ──imports──►  packages/core
packages/core ──imports──►  (nothing — standalone)
```

**Rule: `core` NEVER imports from `loop`, `web`, or `cli`.** Core is the shared foundation. `loop` NEVER imports from `web` or `cli`.

## Package Responsibilities

### packages/core

All filesystem operations and business logic. Zero UI or CLI concerns.

| Module          | Responsibility                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| `discovery.ts`  | Scan ROOT_DIRECTORY for .rauf.json files, return project list                       |
| `config.ts`     | Read/write .rauf.json marker files, read/write ~/.rauf/config.json                  |
| `profile.ts`    | Tech-stack detection heuristics, profile management                                 |
| `template.ts`   | Render .tmpl files with {{variable}} interpolation, sentinel block handling         |
| `installer.ts`  | Orchestrate artifact installation (existing projects)                               |
| `greenfield.ts` | Orchestrate greenfield project initialization                                       |
| `backlog.ts`    | CRUD operations on backlog.json, validation, atomic writes                          |
| `status.ts`     | Derive loop state from state.json (primary) or rauf.log (fallback); lock liveness   |
| `fs-utils.ts`   | Atomic write, JSON read with error handling, path validation, hash computation      |
| `schemas.ts`    | Zod schemas + TypeScript types for all data structures                              |
| `errors.ts`     | Result type, error codes, structured error types                                    |
| `budget.ts`     | Derive right-sized iteration cap from backlog pending work (`computeMaxIterations`) |

### packages/loop

Loop runner engine. Orchestrates the autonomous coding loop lifecycle.

| Module               | Responsibility                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `runner.ts`          | LoopRunner class — main loop lifecycle, iteration management, exit classification, circuit breaker     |
| `events.ts`          | TypedEventEmitter — typed wrapper around EventEmitter for LoopEvent                                    |
| `claude-process.ts`  | Spawn `claude -p` as child process with timeout and cancellation                                       |
| `signal-parser.ts`   | Parse RAUF_DONE/BLOCKED/NEEDS_HUMAN/RAUF_REVIEW from Claude stdout                                     |
| `prompt-builder.ts`  | Build the prompt string from RAUF.md, item, backlog, and progress; build review prompts from REVIEW.md |
| `usage-checker.ts`   | Check Claude API usage limits, interruptible sleep                                                     |
| `git-commit.ts`      | Run `git add -A && git commit` after successful iterations                                             |
| `git-exec.ts`        | Shared `execGit(cwd, args)` helper used by all git operations in the loop package                      |
| `git-reconcile.ts`   | `findItemCommit` and `isTreeClean` — detect committed-but-unrecorded work for recovery                 |
| `exit-classifier.ts` | Pure classifier: `classifyExit` maps a finished spawn to an `ExitClass`; exports `hasUsageLimitInText` |
| `review-hooks.ts`    | `REVIEW_HOOK_SUPPRESSION_ENV` map and `resolveChildEnv` for single-gate review suppression             |

### packages/cli

Command-line interface. Parses arguments, calls core functions, formats output.

- Each command is a separate file in `src/commands/`
- Can call core functions directly (headless) or HTTP API (when server running)
- `rauf loop run` creates a LoopRunner in-process (no server required)
- `rauf loop run --detached`/`loop stop`/`follow`/`loop review` route through the server API or run directly
- `recovery.ts` provides shared helpers (`reconcileAndRequeue`, `guardLoopLock`, `recoverInterruptedLoop`) used by both `rauf reset` and `rauf resume`
- `rauf loop run` is the **unattended-safe mode** — the loop runs in the CLI process, so `rauf server stop`/`restart` cannot kill it. `rauf loop run --detached` routes through the server daemon and is interruptible.
- `maxIterations` bounds a **single process run** of `rauf loop run`, not the cumulative work across restarts. The iteration counter resets to zero each time the process starts. `rauf resume` applies a fresh budget for each continuation.
- Outputs human-readable by default, `--json` for machine-readable
- Exit codes: unified scheme — SUCCESS(0)/ERROR(1)/USAGE(2)/NEEDS_HUMAN(3)/LIMIT(4)/BLOCKED(5)/RUNNING(6)

### packages/web

Hono HTTP server + React SPA.

**Server (`src/server/`):**

- API route handlers that call core functions
- LoopManager singleton for server-centric loop management
- CSRF middleware (X-Rauf-Request header check on mutations)
- SSE endpoints for log streaming and loop event streaming
- Static file serving for built React app

**Client (`src/client/`):**

- React + TanStack Router for routing
- TanStack Query for server state
- Tailwind CSS for styling
- Shared fetch wrapper with automatic X-Rauf-Request header
- Start/Stop loop buttons on the status view

**Shared (`src/shared/`):**

- API type definitions shared between server and client

## Loop Management Model

Rauf uses a **server-centric loop management** model. The LoopManager singleton in `packages/web` is the central coordinator:

```
LoopManager (singleton in web server)
  ├── Tracks active loops by project path (max one per project)
  ├── Creates LoopRunner instances from packages/loop
  ├── Subscribes to all 20 LoopEvent types
  ├── Fans events out to SSE clients (CLI follow + web frontend)
  ├── Recovers stale loops on server startup (resetStalledItems)
  └── Gracefully cancels all loops on SIGTERM (shutdownAll)
```

**LoopRunner** (in `packages/loop`) is the engine that executes the loop:

```
LoopRunner lifecycle:
  1. Capture git baseline commit hash as `baseCommitHash` (persisted to state.json):
     — used for the review-pass `git diff baseCommit..HEAD`
     — used as `sinceRef` for bounded commit reconciliation (prevents false-recovery
       from a prior backlog cycle; IDs restart at 001 for each new backlog)
  2. Clear DONE/CANCEL files
  3. Read .rauf.json marker options (autoSweep, model, etc.)
  4. Run auto-sweep if enabled
  5. Pre-loop usage limit preflight (weekly check, 5h check)
     — if sleepOnLimit=false and 5h limit hit: write paused_usage_limit state + DONE, exit
  6. Main loop (iterationCount < maxIterations, no-op iterations don't count):
     a. Select next eligible item (dependency-aware priority queue)
     b. Resolve model (item.model > options.model > marker.model)
     c. Build prompt (RAUF.md + item + backlog + progress)
     d. Spawn claude -p with timeout (child env from childEnv/suppressIterationReview)
     e. Pre-signal check: scan reconstructedText/stdout AND stderr for usage-limit banner
        — if detected: reset item to pending, route to usage handler (sleep or halt)
     f. Parse exit signal (DONE/BLOCKED/NEEDS_HUMAN/REVIEW/none)
     g. For explicit DONE: git commit, update item done
        For explicit BLOCKED/NEEDS_HUMAN: record as genuine block
        For no signal (none/review): classifyExit → ExitClass dispatch:
          - usage_limited  → reset pending, route to usage handler
          - timeout        → genuine block ("Timed out after Ns")
          - infra_error    → item stays pending, consecutiveInfraFailures++,
                             do NOT block; iteration does not count toward budget
          - genuine_retry  → retry up to maxRetries; on exhaustion:
                             blocked + deferred:true, push to deferredItems
     h. Pre-block reconciliation: if non-done outcome, check
        findItemCommit(projectPath, itemId, baseCommitHash) — scoped to baseCommitHash..HEAD
        AND isTreeClean — if committed + clean: promote to done (recovered_via_commit), skip block
     i. If dirty tree after non-done: stash abandoned work before next item
     j. Circuit breaker: if consecutiveInfraFailures >= threshold → halt with error state
     k. Write state.json, check CANCEL file, check usage limits between iterations
  7. After main loop: if --review enabled, run review pass
  8. If review creates items and not --review-only, re-enter main loop for fix iterations
  9. Write DONE file on all terminal exit paths (includes paused_usage_limit resume hint)
  10. Crash cleanup: try/finally resets in_progress items
```

## Data Flow Examples

### Installation Flow

```
User → CLI `rauf install ./project`
       → core/installer.ts
         → core/profile.ts (detect tech stack)
         → core/template.ts (render RAUF.md)
         → core/fs-utils.ts (atomic writes)
         → core/config.ts (write .rauf.json)
       → CLI formats installation report
```

### Loop Lifecycle (detached mode)

```
User → CLI `rauf loop run --detached ./project`
       → CLI auto-starts server daemon if needed
       → POST /api/projects/:id/loop/start
       → LoopManager.startLoop()
         → Creates LoopRunner(projectPath, options)
         → LoopRunner.start()
           → selectNextItem → buildPrompt → spawnClaude → parseSignal
           → Emits LoopEvents at each lifecycle point
         → LoopManager fans events to SSE listeners
       → CLI `rauf loop follow` or web frontend
         → GET /api/projects/:id/loop/events (SSE)
         → Receives LoopEvent stream, renders in terminal/UI
```

### Loop Lifecycle (direct mode)

```
User → CLI `rauf loop run ./project`
       → Creates LoopRunner directly in-process (no server)
       → LoopRunner.start()
         → Same lifecycle as server mode
         → Events printed to terminal via formatAndPrintEvent()
```

### Review Pass Data Flow

```
Loop completes → runReviewPass()
  → Read completed items from backlog
  → git diff baseCommit..HEAD
  → buildReviewPrompt() (REVIEW.md template)
  → Spawn Claude with review prompt
  → Parse RAUF_REVIEW or RAUF_DONE
  → If issues: addItem() with source="review", reviewBatch=<ISO timestamp>
  → If !reviewOnly: re-enter main loop for fix iterations
```

### Loop Event Flow

```
LoopRunner ──emits──► LoopEvent
  │
  ├──► LoopManager ──fans out──► SSE clients
  │                                ├── CLI `rauf loop follow`
  │                                └── Web frontend EventSource
  │
  └──► Direct mode: CLI `rauf loop run` event handler
```

### Status View

```
User → Web UI "Status" tab
       → GET /api/projects/:id/status
       → core/status.ts
         → Read .rauf/state.json (primary)
         → Read .rauf/backlog.json (summary)
         → Fallback: parse .rauf/rauf.log
       → JSON response → React renders
```

### Backlog Add

```
User → Web UI "Add Item" form → POST /api/projects/:id/backlog
       → core/backlog.ts
         → Validate item schema
         → Auto-assign ID (max + 1)
         → Apply smart default acceptance criteria
         → Atomic write to backlog.json (with .bak backup)
       → JSON response → React updates list
```

## ROOT_DIRECTORY Resolution

Priority order:

1. `--root` CLI flag
2. `RAUF_ROOT` environment variable
3. `rootDirectory` in `~/.rauf/config.json`
4. Current working directory

## Security Model

- Server binds to 127.0.0.1 ONLY (never 0.0.0.0)
- No CORS headers set (blocks cross-origin reads)
- Custom `X-Rauf-Request: true` header required on all POST/PUT/DELETE
- Path sandboxing: all writes validated against ROOT_DIRECTORY
- No authentication (localhost single-user only)

## Concurrency Model

- Manager tool: atomic writes (write .tmp → rename)
- Loop runner: uses core's updateItem() for status transitions (atomic writes with .bak backup)
- No file locking — last-write-wins is acceptable for single-developer use
- Backup on every backlog write (.rauf/backlog.json.bak)
