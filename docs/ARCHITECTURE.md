---
title: System Architecture
description: High-level system diagram, data flow, and architectural principles for the ralph manager.
---

## System Diagram

![System Architecture](images/architecture.svg)

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

| Module          | Responsibility                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `discovery.ts`  | Scan ROOT_DIRECTORY for .ralph.json files, return project list                 |
| `config.ts`     | Read/write .ralph.json marker files, read/write ~/.ralph/config.json           |
| `profile.ts`    | Tech-stack detection heuristics, profile management                            |
| `template.ts`   | Render .tmpl files with {{variable}} interpolation, sentinel block handling    |
| `installer.ts`  | Orchestrate artifact installation (existing projects)                          |
| `greenfield.ts` | Orchestrate greenfield project initialization                                  |
| `backlog.ts`    | CRUD operations on backlog.json, validation, atomic writes                     |
| `status.ts`     | Derive loop state from state.json (primary) or ralph.log (fallback)            |
| `fs-utils.ts`   | Atomic write, JSON read with error handling, path validation, hash computation |
| `schemas.ts`    | Zod schemas + TypeScript types for all data structures                         |
| `errors.ts`     | Result type, error codes, structured error types                               |

### packages/loop

Loop runner engine. Orchestrates the autonomous coding loop lifecycle.

| Module              | Responsibility                                                      |
| ------------------- | ------------------------------------------------------------------- |
| `runner.ts`         | LoopRunner class — main loop lifecycle, iteration management        |
| `events.ts`         | TypedEventEmitter — typed wrapper around EventEmitter for LoopEvent |
| `claude-process.ts` | Spawn `claude -p` as child process with timeout and cancellation    |
| `signal-parser.ts`  | Parse RALPH_DONE/BLOCKED/NEEDS_HUMAN/RALPH_REVIEW from Claude stdout |
| `prompt-builder.ts` | Build the prompt string from RALPH.md, item, backlog, and progress; build review prompts from REVIEW.md |
| `usage-checker.ts`  | Check Claude API usage limits, interruptible sleep                  |
| `git-commit.ts`     | Run `git add -A && git commit` after successful iterations          |

### packages/cli

Command-line interface. Parses arguments, calls core functions, formats output.

- Each command is a separate file in `src/commands/`
- Can call core functions directly (headless) or HTTP API (when server running)
- `ralph loop run` creates a LoopRunner in-process (no server required)
- `ralph loop start/stop/follow/review` route through the server API or run directly
- Outputs human-readable by default, `--json` for machine-readable
- Exit codes follow standard (0=success, 1=error, 2=bad args, etc.)

### packages/web

Hono HTTP server + React SPA.

**Server (`src/server/`):**

- API route handlers that call core functions
- LoopManager singleton for server-centric loop management
- CSRF middleware (X-Ralph-Request header check on mutations)
- SSE endpoints for log streaming and loop event streaming
- Static file serving for built React app

**Client (`src/client/`):**

- React + TanStack Router for routing
- TanStack Query for server state
- Tailwind CSS for styling
- Shared fetch wrapper with automatic X-Ralph-Request header
- Start/Stop loop buttons on the status view

**Shared (`src/shared/`):**

- API type definitions shared between server and client

## Loop Management Model

Ralph uses a **server-centric loop management** model. The LoopManager singleton in `packages/web` is the central coordinator:

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
  1. Capture git baseline commit hash (for review diff)
  2. Clear DONE/CANCEL files
  3. Read .ralph.json marker options (autoSweep, model, etc.)
  4. Run auto-sweep if enabled
  5. Pre-loop usage limit preflight (weekly check, 5h check)
  6. Main loop:
     a. Select next eligible item (dependency-aware priority queue)
     b. Resolve model (item.model > options.model > marker.model)
     c. Build prompt (RALPH.md + item + backlog + progress)
     d. Spawn claude -p with timeout
     e. Check stderr for usage limit patterns
     f. Parse exit signal (DONE/BLOCKED/NEEDS_HUMAN/REVIEW/none)
     g. Update item status, write state.json, git commit on DONE
     h. Check usage limits + cancel between iterations
  7. After main loop: if --review enabled, run review pass
  8. If review creates items and not --review-only, re-enter main loop for fix iterations
  9. Write DONE file on all terminal exit paths
  10. Crash cleanup: try/finally resets in_progress items
```

## Data Flow Examples

### Installation Flow

```
User → CLI `ralph install ./project`
       → core/installer.ts
         → core/profile.ts (detect tech stack)
         → core/template.ts (render RALPH.md)
         → core/fs-utils.ts (atomic writes)
         → core/config.ts (write .ralph.json)
       → CLI formats installation report
```

### Loop Lifecycle (server mode)

```
User → CLI `ralph loop start ./project`
       → CLI auto-starts server daemon if needed
       → POST /api/projects/:id/loop/start
       → LoopManager.startLoop()
         → Creates LoopRunner(projectPath, options)
         → LoopRunner.start()
           → selectNextItem → buildPrompt → spawnClaude → parseSignal
           → Emits LoopEvents at each lifecycle point
         → LoopManager fans events to SSE listeners
       → CLI `ralph loop follow` or web frontend
         → GET /api/projects/:id/loop/events (SSE)
         → Receives LoopEvent stream, renders in terminal/UI
```

### Loop Lifecycle (direct mode)

```
User → CLI `ralph loop run ./project`
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
  → Parse RALPH_REVIEW or RALPH_DONE
  → If issues: addItem() with source="review", reviewBatch=<ISO timestamp>
  → If !reviewOnly: re-enter main loop for fix iterations
```

### Loop Event Flow

```
LoopRunner ──emits──► LoopEvent
  │
  ├──► LoopManager ──fans out──► SSE clients
  │                                ├── CLI `ralph loop follow`
  │                                └── Web frontend EventSource
  │
  └──► Direct mode: CLI `ralph loop run` event handler
```

### Status View

```
User → Web UI "Status" tab
       → GET /api/projects/:id/status
       → core/status.ts
         → Read .ralph/state.json (primary)
         → Read .ralph/backlog.json (summary)
         → Fallback: parse .ralph/ralph.log
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
2. `RALPH_ROOT` environment variable
3. `rootDirectory` in `~/.ralph/config.json`
4. Current working directory

## Security Model

- Server binds to 127.0.0.1 ONLY (never 0.0.0.0)
- No CORS headers set (blocks cross-origin reads)
- Custom `X-Ralph-Request: true` header required on all POST/PUT/DELETE
- Path sandboxing: all writes validated against ROOT_DIRECTORY
- No authentication (localhost single-user only)

## Concurrency Model

- Manager tool: atomic writes (write .tmp → rename)
- Loop runner: uses core's updateItem() for status transitions (atomic writes with .bak backup)
- No file locking — last-write-wins is acceptable for single-developer use
- Backup on every backlog write (.ralph/backlog.json.bak)
