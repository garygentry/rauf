# Ralph Runtime Architecture: Analysis & Recommendations

> **Status**: Approved for implementation
> **Date**: 2026-02-26
> **Pre-migration snapshot**: tag `pre-global-loop-migration` on commit `ba616a9`

## Context

Ralph deploys ~2,100 lines of bash scripts per-project to run autonomous Claude coding loops. As the loop runner grows in complexity (usage limit handling, session timeouts, agent delegation, model resolution), maintaining these scripts across all deployed projects becomes increasingly costly. The three-way hash update mechanism works but adds friction — every bug fix requires `ralph update` on each project. Meanwhile, Windows support is impossible without a rewrite, and macOS has `date` command incompatibilities.

This document proposes a new architecture that:

1. Centralizes loop logic into a global Bun/TypeScript runtime
2. Leverages the existing web server as a loop process manager
3. Enables real-time updates to both CLI and web UI via SSE
4. Allows starting/monitoring loops from either CLI or web app
5. Supports Windows natively via compiled binary
6. Retains a direct-mode escape hatch for serverless execution

---

## 1. Per-Project Scripts → Global Runtime

### What self-containment costs today

The "works without the manager tool" promise breaks down under scrutiny:

- **ralph.sh already depends on global tools**: `jq`, `claude`, `git`, and optionally `ralph` itself (for auto-sweep)
- **Code duplication**: `ensure_command()` is copy-pasted across three scripts (171 lines of pure duplication)
- **Update burden**: Every loop fix requires `ralph update` on each project. The three-way hash comparison in `installer.ts` (~80 lines) exists solely to manage script drift.
- **Untestable**: Shell scripts have zero automated tests. The most critical code path is tested only manually.
- **Embedding pipeline**: Scripts are serialized into `embedded-artifacts.ts` (63.8KB generated file). Every change triggers regeneration.

### What a global runtime gains

| Concern | Per-Project (Current) | Global Runtime |
|---|---|---|
| Bug fixes | `ralph update` on every project | Update `ralph` binary once |
| Version skew | Projects on different loop versions | All projects use same version |
| External deps | jq, timeout/gtimeout, GNU date | Only `claude` and `git` |
| Testing | Manual only | Unit + integration tests via Vitest |
| Code reuse | Shell reimplements what core already does | Loop imports `packages/core` directly |
| Windows | Not possible | Supported via compiled binary |

### What stays per-project (unchanged)

All project-specific **data and configuration** remains in the project directory:

- `.ralph/backlog.json`, `state.json`, `progress.md`, `ralph.log`, `RALPH.md`
- `.ralph.json` marker file with profile and options
- `CLAUDE.md` section

### Verdict

Global runtime is the clear winner. The only real loss is `./ralph.sh` as a standalone command — replaced by `ralph loop run`.

---

## 2. Server-Centric Loop Architecture

This is the key architectural evolution. Rather than the loop being a standalone process (whether bash or TypeScript), the **ralph server becomes the loop process manager**.

### Architecture

```
┌──────────────┐         ┌──────────────┐
│     CLI      │         │   Web UI     │
│ (thin client)│         │ (React SPA)  │
└──────┬───────┘         └──────┬───────┘
       │ REST API               │ REST + SSE
       └─────────┬──────────────┘
                 │
        ┌────────▼─────────┐
        │   Ralph Server   │
        │   (Hono daemon)  │
        │                  │
        │   Loop Manager   │
        │  ┌────────────┐  │
        │  │ Project A  │──│──→ claude -p (child process)
        │  │ Project B  │──│──→ claude -p (child process)
        │  └────────────┘  │
        │                  │
        │  Event Bus       │
        │  (in-process)    │
        └──────────────────┘
```

### How it works

**Loop Manager** (new module in the server) maintains a registry of active loops. Each loop is a supervised child process:

1. **Start loop**: Server spawns the loop runner as a managed async task. The loop runner (TypeScript, in-process) selects backlog items, spawns `claude -p` as a child process, monitors output, updates state.
2. **Real-time events**: The loop manager emits events (iteration_start, iteration_complete, status_change, log_line, usage_limit_hit, etc.) to an in-process event bus.
3. **SSE streaming**: The existing SSE infrastructure (`/api/projects/:id/log/stream`) subscribes to the event bus instead of polling `state.json` every 5 seconds. Status changes are instant.
4. **CLI as thin client**: `ralph loop start .` → POST to server API. `ralph loop follow .` → connects to SSE stream. `ralph loop stop .` → POST to server API.
5. **Web UI**: Same APIs. Start/stop buttons on dashboard. Live log streaming already works via SSE.

### API surface (new endpoints)

```
POST   /api/projects/:id/loop/start   → Start loop for project
POST   /api/projects/:id/loop/stop    → Graceful cancel
GET    /api/projects/:id/loop/events  → SSE: structured LoopEvent stream
```

> **Note**: No `/loop/status` endpoint needed. The existing `/api/projects/:id/status` (which calls `deriveStatus()`) already covers this — the LoopManager writes state.json in real-time, and `deriveStatus` reads it. This avoids duplicate status APIs.

### CLI commands

```bash
ralph loop start [path]     # Start loop (sends to server, or auto-starts server)
ralph loop stop [path]      # Graceful cancel
ralph loop follow [path]    # Stream real-time events to terminal (SSE client)
ralph loop run [path]       # Direct mode: run loop in-process without server
```

> **Note**: No `ralph loop status` — the existing `ralph status` command already queries `deriveStatus()` which reads from state.json. `ralph loop` subcommands are lifecycle-only (start/stop/follow/run). `ralph status` stays as the read-only project query that works regardless of how the loop runs.

### Why SSE is sufficient (no WebSocket needed)

- **Server → Client** updates (log lines, status changes) are unidirectional — SSE handles this perfectly
- **Client → Server** commands (start, stop) are one-shot REST calls — no persistent connection needed
- SSE is already implemented and working in the codebase
- WebSocket would add connection upgrade complexity, reconnection logic, and protocol framing for no real benefit
- If bidirectional streaming is ever needed (e.g., interactive terminal passthrough), WebSocket can be added later for that specific feature

### Advantages of server-centric model

1. **Unified control plane**: One process manages all loops across all projects. Start from CLI, monitor from web, or vice versa.
2. **Instant status**: Loop state lives in server memory, not in `state.json` files that need to be polled. Status queries are instant.
3. **Rich real-time events**: Instead of parsing log files for status changes (current 5-second polling), the loop emits structured events directly. The SSE stream carries typed events (iteration_start, item_selected, claude_invoked, signal_detected, etc.).
4. **Resource coordination**: Server can limit concurrent loops, queue requests, manage API rate limits across projects.
5. **Web UI becomes fully interactive**: Start/stop loops from the dashboard, not just monitor them. The web app becomes a real control panel.
6. **Crash recovery**: Server can detect orphaned claude processes on restart and clean up state.
7. **Future extensibility**: Scheduling (cron-like loop triggers), notifications (email/Slack on completion), multi-machine coordination.

### Disadvantages and mitigations

| Disadvantage | Severity | Mitigation |
|---|---|---|
| **Server must be running** for loops to work | Medium | CLI auto-starts server on first `loop start`. Also provide `ralph loop run` for serverless direct mode. |
| **Server crash kills all loops** | Medium | Graceful shutdown saves state. On restart, detect incomplete iterations and reset items to pending. Claude processes are independent — they finish or timeout on their own. |
| **More complex than a script** | Low | The complexity exists either way (ralph.sh is already 1,783 lines). TypeScript is more maintainable and testable than bash. |
| **Debugging is harder** | Low | `ralph loop run` provides direct mode for debugging. Server mode has structured logging. |
| **Single point of failure** | Medium | The server is localhost-only and single-user. Systemd/launchd service management can auto-restart it. |

### Direct mode as escape hatch

`ralph loop run [path]` runs the loop in-process without requiring the server. This is useful for:

- Debugging loop behavior
- Running on systems where the server isn't wanted
- CI/CD environments
- Quick one-off runs

Same TypeScript loop runner code, just invoked directly instead of through the server. The loop module is designed to work both ways.

### Cancellation mechanism

**AbortController** is the primary cancellation mechanism inside the runner:

- **Server mode**: `POST /api/projects/:id/loop/stop` → LoopManager calls `runner.cancel()` which aborts the controller
- **Direct mode**: SIGTERM handler aborts the controller. The `.ralph/CANCEL` file is also checked at iteration boundaries for backward compatibility.
- AbortController signal is checked at: iteration boundary, during usage limit sleeps, before spawning claude
- The CANCEL file mechanism remains as a backward-compat path during migration

### Server restart recovery

On server startup, the LoopManager runs recovery:

1. Scan all discovered projects for state.json with `status: "running"` or `"starting"`
2. Check if `updatedAt` is stale (>5 minutes) — reuse the existing staleness heuristic from `deriveStatus()`
3. If stale: reset any `in_progress` items to `pending` via `core.updateItem()`, write state as `"paused"`
4. Do NOT try to detect running claude processes — too fragile across platforms
5. Log recovery actions for user visibility

---

## 3. Cross-Platform: Why This Architecture Solves It

Every platform incompatibility in the current shell scripts disappears:

| Problem | Shell Script | TypeScript Runtime |
|---|---|---|
| JSON manipulation | Requires `jq` binary | `JSON.parse()` — native |
| Process timeout | `timeout`/`gtimeout` | `setTimeout` + `proc.kill()` |
| ISO date formatting | `date -Iseconds` (GNU only) | `new Date().toISOString()` |
| Date parsing | `date -d` (GNU only) | `new Date(str)` |
| File permissions | `chmod 755` | Not needed (no scripts deployed) |
| Signal handling | `trap EXIT` (POSIX only) | `process.on('exit')` — cross-platform |
| Desktop notifications | `notify-send` (Linux only) | Deferred — web UI is the better notification path |

Remaining deps (unavoidable): `claude` CLI and `git`.

---

## 4. Implementation Technology: Bun/TypeScript

This isn't a close call. Ralph is already a Bun/TypeScript monorepo with:

- `packages/core` implementing backlog CRUD, atomic writes, status derivation, Zod schemas
- `packages/web` with Hono server, SSE streaming, daemon management
- `packages/cli` with command routing, server lifecycle
- A proven `bun build --compile` pipeline producing single binaries
- Vitest test infrastructure

The loop runner becomes a new module that imports existing core functions directly — no reimplementation needed. The server gains loop management endpoints alongside existing project/backlog routes.

### Alternatives considered

| Approach | Reuses core? | Cross-platform? | Single binary? | Team velocity |
|---|---|---|---|---|
| **Bun/TypeScript** | Yes — direct imports | Yes | Yes (proven) | Highest |
| Go | No — full rewrite | Yes | Yes | Low (new language) |
| Rust | No — full rewrite | Yes | Yes | Lowest |
| Python | No | Partial (needs runtime) | Fragile (PyInstaller) | Medium |
| Keep bash + shims | No | No (dual maintenance) | No | Low |

---

## 5. Package Structure

```
packages/
  core/        — Existing + NEW: writeLoopState, appendLog, selectNextItem, event schemas
  loop/        — NEW: Loop runner engine, event emitter, Claude process manager
  web/         — Existing + NEW: loop management API routes, LoopManager singleton
  cli/         — Existing + NEW: ralph loop start|stop|follow|run
```

### `packages/loop/` — New workspace package

Depends on `@rauf/core`. Owns HTTP client (usage API), child process management, and event emission — concerns that don't belong in core's pure data/filesystem layer.

**Module structure:**
```
packages/loop/src/
  index.ts              — Public API: LoopRunner class + types
  runner.ts             — Main LoopRunner class
  prompt-builder.ts     — Prompt construction from project files + item
  claude-process.ts     — claude -p spawn, timeout, output capture
  signal-parser.ts      — Parse RALPH_DONE/BLOCKED/NEEDS_HUMAN from output
  usage-checker.ts      — Anthropic OAuth API integration
  git-commit.ts         — Auto-commit after RALPH_DONE
  events.ts             — EventEmitter typed wrapper, LoopEvent types
```

**LoopRunner class API:**
```typescript
class LoopRunner extends TypedEventEmitter<LoopEvent> {
  constructor(projectPath: string, options: LoopStartOptions)

  // Lifecycle
  start(): Promise<LoopResult>    // Runs the full loop, resolves when done
  cancel(): void                  // Triggers graceful cancellation via AbortController

  // State (read-only)
  get status(): LoopRunnerStatus
  get currentItem(): BacklogItem | null
  get iteration(): number
}
```

**Key design decisions:**
- `start()` is async and long-running. It runs the main loop internally, emitting events.
- `cancel()` sets an AbortController signal. Checked at iteration boundary + during sleeps.
- Events are the primary output channel. Log writing and state.json updates happen inside the runner.
- The runner calls `core.updateItem()` for status transitions — reuses validation logic, no raw jq writes.
- The runner calls `core.writeLoopState()` for state.json updates.
- `claude-process.ts` uses `Bun.spawn()` with timeout via `setTimeout` + `proc.kill('SIGTERM')` → 30s grace → `proc.kill('SIGKILL')`.

### `packages/loop/` responsibilities

- **Runner**: Iterates backlog items, invokes Claude, parses exit signals, manages retries
- **Prompt builder**: Constructs the claude prompt from RALPH.md + item JSON + acceptance criteria + dependencies + agent delegation + backlog context + progress.md
- **Process manager**: Spawns `claude -p` with stdin prompt piping, timeout, captures stdout (for signal parsing) and stderr (for usage limit detection) separately
- **Signal parser**: Detects RALPH_DONE, RALPH_BLOCKED:reason, RALPH_NEEDS_HUMAN:reason, or no-signal (retry)
- **Usage limit handler**: Reads OAuth token from `~/.config/claude-code/credentials.json`, queries `https://api.anthropic.com/api/oauth/usage`, distinguishes 5-hour vs 7-day limits, implements interruptible sleep via AbortController
- **Git commit**: After RALPH_DONE, runs `git add -A && git commit` as child process (non-fatal on failure)
- **Event emitter**: Emits structured events (not log strings) for each state change
- **State writer**: Writes `state.json` and `ralph.log` (for backward compatibility with file-based status)

The module exports a `LoopRunner` class that can be used:
- **By the server**: as a managed async task with event subscription
- **By the CLI**: directly in `ralph loop run` mode

### Event schema (discriminated union)

All events carry a base shape: `{ type, timestamp, projectPath }` plus type-specific payload.

```typescript
type LoopEvent =
  | { type: "loop_started"; maxIterations: number; model?: string }
  | { type: "iteration_start"; iteration: number; maxIterations: number }
  | { type: "item_selected"; itemId: string; title: string; priority: number }
  | { type: "claude_spawned"; itemId: string; model?: string; timeoutMinutes: number }
  | { type: "claude_exited"; itemId: string; exitCode: number; timedOut: boolean; durationMs: number }
  | { type: "signal_parsed"; itemId: string; signal: "done" | "blocked" | "needs_human" | "none"; reason?: string }
  | { type: "item_completed"; itemId: string; title: string }
  | { type: "item_blocked"; itemId: string; reason: string }
  | { type: "item_retried"; itemId: string; attempt: number; maxRetries: number }
  | { type: "needs_human"; itemId: string; reason: string }
  | { type: "usage_limit_hit"; limitType: "5h" | "7d"; utilization: number }
  | { type: "usage_limit_cleared"; limitType: "5h" | "7d" }
  | { type: "sleep_start"; sleepUntil: string; reason: string }
  | { type: "sleep_end" }
  | { type: "loop_completed"; completedCount: number; blockedCount: number }
  | { type: "loop_error"; error: string }
  | { type: "loop_cancelled" }
  | { type: "log_line"; message: string }
```

Event flow per iteration:
```
iteration_start → item_selected → claude_spawned →
  claude_exited → signal_parsed →
    (item_completed | item_blocked | item_retried | needs_human) →
      iteration_end (next iteration_start or loop_completed)
```

Usage limit flow:
```
usage_limit_hit → sleep_start → [periodic log_line events] →
  (sleep_end | loop_cancelled)
```

### Server integration

The Hono server gains a `LoopManager` singleton that:
- Tracks active loops by project path (one loop per project, configurable total max)
- Creates LoopRunner instances and subscribes to their events
- Fans events out to SSE clients via `/api/projects/:id/loop/events`
- Handles graceful shutdown (stop all loops on SIGTERM)
- Runs recovery on startup (reset stale loops)

```typescript
class LoopManager {
  startLoop(projectPath: string, options: LoopStartOptions): Result<void>
  stopLoop(projectPath: string): Result<void>
  getActiveLoops(): Map<string, LoopRunnerStatus>
  subscribe(projectPath: string, listener: (event: LoopEvent) => void): () => void
  shutdownAll(): Promise<void>
  recoverStaleLoops(): Promise<void>
}
```

### CLI integration

The CLI gains smart routing:
- If server is running → send HTTP request (thin client mode)
- If server is not running → for `loop run`: execute directly; for `loop start`: auto-start server first
- `ralph loop follow` always connects to server SSE (requires server)
- `ralph loop stop` requires server (error if not running)

---

## 6. Core Package Additions (Prerequisites)

Before building the loop package, core needs new write primitives. These are pure additions with no breaking changes.

### New functions in `packages/core/src/status.ts`

- `writeLoopState(projectPath, state: LoopState): Result<void>` — atomic write with `LoopStateSchema` validation, auto-sets `updatedAt`
- `appendLog(projectPath, message: string): Result<void>` — append timestamped line to `.ralph/ralph.log`
- `writeDoneFile(projectPath, content: string): Result<void>` — write `.ralph/DONE` marker
- `clearDoneFile(projectPath): Result<void>` — remove DONE file at loop start

### New functions in `packages/core/src/backlog.ts`

- `selectNextItem(backlog: Backlog): BacklogItem | null` — first pending item by priority, respecting dependency order (all items in `dependsOn` must have status `"done"`)
- `resetStalledItems(projectPath): Result<{ resetCount: number }>` — find `in_progress` items when state.json is stale, reset to `pending`

### New functions in `packages/core/src/config.ts`

- `readClaudeOAuthToken(): Result<string>` — reads bearer token from `~/.config/claude-code/credentials.json`

### New helpers in `packages/core/src/status.ts`

- `checkCancelRequested(projectPath): boolean` — check if `.ralph/CANCEL` file exists
- `clearCancelFile(projectPath): Result<boolean>` — remove CANCEL file, return whether it existed

### New schemas in `packages/core/src/schemas.ts`

- `LoopEventSchema` — Zod discriminated union covering all 17 event types above
- `LoopStartOptionsSchema` — `{ maxIterations, maxRetries, model, sessionTimeoutMinutes }`
- Export corresponding TypeScript types

---

## 7. Migration Path

### Phase 1A: Core Foundation

Add missing core primitives. Pure additions, no breaking changes.

**Files to modify:**
- `packages/core/src/status.ts` — writeLoopState, appendLog, writeDoneFile, clearDoneFile, checkCancelRequested, clearCancelFile
- `packages/core/src/schemas.ts` — LoopEventSchema, LoopStartOptionsSchema
- `packages/core/src/backlog.ts` — selectNextItem, resetStalledItems
- `packages/core/src/config.ts` — readClaudeOAuthToken
- `packages/core/src/index.ts` — export new functions

**Verification:** `pnpm test` + `pnpm typecheck` pass. Unit tests for selectNextItem dependency resolution.

### Phase 1B: Loop Runner Module

New `packages/loop/` workspace package. Port all logic from ralph.sh.

**New files:**
- `packages/loop/package.json`, `tsconfig.json`
- `packages/loop/src/index.ts` — public API
- `packages/loop/src/runner.ts` — LoopRunner class
- `packages/loop/src/prompt-builder.ts` — prompt construction
- `packages/loop/src/claude-process.ts` — claude -p spawn + timeout
- `packages/loop/src/signal-parser.ts` — output signal detection
- `packages/loop/src/usage-checker.ts` — Anthropic usage API
- `packages/loop/src/git-commit.ts` — auto-commit utility
- `packages/loop/src/events.ts` — typed event emitter

**Key porting decisions:**
- Shell's jq targeted writes → `core.updateItem()` (already validates transitions, does atomic writes)
- Shell's `write_state()` → `core.writeLoopState()` (new in 1A)
- Shell's `select_next_item()` → `core.selectNextItem()` (new in 1A)
- Shell's associative array retry counts → `Map<string, number>` (in-memory, resets on restart — acceptable)
- Shell's `timeout` wrapper → `setTimeout` + `proc.kill()` (cross-platform)
- Shell's `sleep_with_cancel()` → `AbortController` with periodic checks
- Shell's `curl` for usage API → `fetch()` (native in Bun/Node 18+)
- Shell's auto-sweep → direct import of `sweepItems` from core's archive module

**Verification:** Unit tests for signal parser, prompt builder, usage checker. Integration test with mock claude script outputting RALPH_DONE.

### Phase 1C: Server Integration (can parallel with 1D)

Wire the loop runner into the Hono server.

**New files:**
- `packages/web/src/server/loop-manager.ts` — LoopManager singleton
- `packages/web/src/server/routes/loop.ts` — Loop API routes

**Files to modify:**
- `packages/web/src/server/app.ts` — mount loop routes, initialize LoopManager
- `packages/web/src/server/start.ts` — recoverStaleLoops on startup, shutdownAll on SIGTERM

**SSE approach:** New `/loop/events` endpoint streams structured LoopEvent objects. Existing `/log/stream` continues to work unchanged (reads from ralph.log, which the runner still writes to). No migration needed for existing frontends.

**Verification:** Start loop via API → observe events on SSE → stop via API → verify graceful cancellation. Existing `/log/stream` still works.

### Phase 1D: CLI Integration (can parallel with 1C)

Add `ralph loop` subcommands.

**Files to modify:**
- `packages/cli/src/commands.ts` — register `loop` subcommand group

**New files:**
- `packages/cli/src/loop-commands.ts` — handleLoopStart, handleLoopStop, handleLoopFollow, handleLoopRun

**Verification:** `ralph loop run .` works without server. `ralph loop start .` auto-starts server. `ralph loop follow .` streams events. `ralph loop stop .` cancels gracefully.

### Phase 1E: Frontend Enhancements (minimal)

**Files to modify:**
- `packages/web/src/client/routes/projects/status.tsx` — Add Start/Stop buttons to status view header
- `packages/web/src/client/lib/fetch.ts` — Add loop API mutation helpers

**Minimal scope:**
- Start button visible when IDLE/PAUSED/COMPLETE/ERROR
- Stop button visible when RUNNING
- Use TanStack Query invalidation to refresh status after mutations
- Keep existing LogPanel SSE — it still works since the runner writes ralph.log

**Verification:** Start/stop buttons appear with correct visibility. Clicking triggers loop, status updates live.

### Phase 2: Default to Global Runtime

Only after Phase 1 is stable and tested.

- Add `runtime: "shell" | "global"` field to `MarkerOptionsSchema` in `.ralph.json`
- Existing projects default to `"shell"` (no change)
- New `ralph install` defaults to `"global"` (no scripts deployed)
- `ralph update` detects `runtime: "shell"` and offers migration to `"global"`
- When `runtime: "global"`, installer skips script deployment and removes script hashes from `artifactHashes`
- Three-way hash comparison for scripts warns but doesn't auto-remove customized scripts (`local_only`)

### Phase 3: Remove Shell Script Artifacts

- Remove `artifacts/variants/backlog-json/ralph.sh`, `ralph-status.sh`, `ralph-add.sh`, `ralph-stop.sh`
- Simplify `embedded-artifacts.ts` generation (no more script content)
- Remove three-way hash comparison for scripts in `installer.ts`
- Simplify embedded-artifacts pipeline in `scripts/generate-embedded-artifacts.ts`

### Implementation dependency graph

```
Phase 1A (core foundations) — no dependencies, do first
    ↓
Phase 1B (loop runner) — depends on 1A
    ↓
Phase 1C (server integration) ─┐
Phase 1D (CLI integration)  ───┤ can develop in parallel, both depend on 1B
                                ↓
Phase 1E (frontend) — depends on 1C
    ↓
Phase 2 (default switch) — depends on 1A-1E being stable
    ↓
Phase 3 (cleanup) — depends on Phase 2 rollout
```

---

## 8. What Changes in the Installer

**Phase 1** (no installer changes):
- Shell scripts continue to be deployed
- Both shell and global runtime work side-by-side

**Phase 2** (installer aware of runtime mode):
- `MarkerOptionsSchema` gains `runtime: "shell" | "global"` field
- New installs default to `runtime: "global"` — no scripts deployed
- `ralph update` offers runtime migration for existing projects
- When `runtime: "global"`: skip script deployment, remove script hashes from `artifactHashes`
- Still deploys `.ralph/` directory contents (RALPH.md, backlog.json, progress.md, schema)
- Still manages CLAUDE.md sentinel sections
- Three-way hash comparison simplifies (only needed for RALPH.md template)

**Phase 3** (installer cleanup):
- Remove all script-related code paths
- Remove script content from embedded-artifacts
- Simplify hash tracking

---

## 9. Key Risks

| Risk | Mitigation |
|---|---|
| Bun Windows maturity | Code uses standard Node APIs (`node:fs`, `node:child_process`); can fall back to Node runtime |
| Behavioral parity with shell scripts | Port function-by-function with tests; run both side-by-side during Phase 1 |
| Users with customized ralph.sh | Three-way hash detects `local_only` — warn during migration, don't auto-remove |
| Server reliability | Auto-restart via systemd/launchd; direct mode as fallback; graceful state recovery on restart |
| Retry counter loss on server restart | Accepted as non-critical. Retry counts are a safety net. Document behavior. Can persist to state.json later if needed. |

---

## 10. Key Files Reference

### Files to port from (shell scripts)
- `artifacts/variants/backlog-json/ralph.sh` — Main loop runner (783 functions, 1,783 total lines), source of all loop logic
- `artifacts/variants/backlog-json/ralph-status.sh` — Status reporting (192 lines) — largely replaced by core's `deriveStatus()`
- `artifacts/variants/backlog-json/ralph-add.sh` — Item addition (180 lines) — already replaced by core's `addItem()`
- `artifacts/variants/backlog-json/ralph-stop.sh` — Graceful cancel (21 lines) — trivial: create CANCEL file

### Existing core modules to reuse
- `packages/core/src/backlog.ts` — readBacklog, writeBacklog, updateItem, validateStatusTransition
- `packages/core/src/status.ts` — deriveStatus, readLogTail, watchLog (+ new write functions in Phase 1A)
- `packages/core/src/config.ts` — readMarkerFile, readToolConfig, resolveRootDirectory
- `packages/core/src/fs-utils.ts` — atomicWrite, readJsonFile, fileExists, ensureDir
- `packages/core/src/schemas.ts` — LoopStateSchema, BacklogItemSchema, MarkerOptionsSchema, VALID_STATUS_TRANSITIONS
- `packages/core/src/archive.ts` — sweepItems (for auto-sweep at loop start)
- `packages/core/src/errors.ts` — Result<T,E>, ok, err, ErrorCodes

### Files to modify
- `packages/core/src/status.ts` — Add writeLoopState, appendLog, CANCEL/DONE file helpers (Phase 1A)
- `packages/core/src/backlog.ts` — Add selectNextItem, resetStalledItems (Phase 1A)
- `packages/core/src/schemas.ts` — Add LoopEventSchema, LoopStartOptionsSchema (Phase 1A)
- `packages/core/src/config.ts` — Add readClaudeOAuthToken (Phase 1A)
- `packages/web/src/server/app.ts` — Mount loop routes, init LoopManager (Phase 1C)
- `packages/web/src/server/start.ts` — Recovery + shutdown hooks (Phase 1C)
- `packages/cli/src/commands.ts` — Register `loop` subcommand group (Phase 1D)
- `packages/web/src/client/routes/projects/status.tsx` — Start/Stop buttons (Phase 1E)
- `packages/core/src/installer.ts` — Runtime-aware script deployment (Phase 2)
- `pnpm-workspace.yaml` — Add packages/loop (Phase 1B)

---

## 11. Summary

The recommended architecture is:

1. **Global Bun/TypeScript runtime** — eliminates per-project script deployment, update friction, and all platform dependencies (jq, timeout, GNU date)
2. **Server-managed loops** — the ralph daemon becomes the loop process manager, with real-time events flowing to both CLI and web UI via SSE
3. **CLI as thin client** — `ralph loop start/stop/follow` communicate with the server via REST + SSE
4. **Direct mode escape hatch** — `ralph loop run` for serverless execution, debugging, and CI
5. **Same per-project data model** — `.ralph/` directory, `backlog.json`, `state.json`, `RALPH.md` all unchanged
6. **Phased migration** — parallel operation first (1A-1E), then default switch (2), then cleanup (3)
7. **Structured event system** — typed LoopEvent discriminated union as the contract between loop/server/CLI/frontend
