# Multi-Backlog Support — Technical Specification

## 1. Overview

This feature introduces a **backlog root** abstraction — a self-contained directory holding a `backlog.json` and isolated runtime state — so ralph can operate on any backlog location without manual file shuffling. The central change is a new `packages/core/src/backlog-root.ts` module that becomes the single source of truth for all path resolution, replacing the hardcoded `.ralph/` constants scattered across every core module.

Key architectural decisions:

- **Centralized path resolution** via a `BacklogPaths` interface returned by `resolveBacklogPaths()`
- **Basename detection** for the default-root special case (no `.ralph/.ralph/` nesting)
- **Filesystem scan** for discovering active backlog roots (no index file)
- **PID + timestamp lock file** (`.loop.lock`) for concurrency safety
- **Minimal web changes** — just enough to satisfy REQ-CLI-05 (pass backlog root through loop start/stop)

## 2. Module Structure

### 2.1 New Module: `packages/core/src/backlog-root.ts` (REQ-ARCH-01, REQ-ARCH-02)

This is the centerpiece. All path resolution for state files, backlog files, instruction files, and lock files flows through this module.

```ts
import * as path from "node:path";
import { fileExists } from "./fs-utils.js";

// ─── Types ──────────────────────────────────────────────────────

/** All resolved paths for a backlog root */
export interface BacklogPaths {
  /** The project root (directory containing .ralph.json) */
  projectPath: string;
  /** The backlog root directory (contains backlog.json or has .ralph/ subdir) */
  root: string;
  /** Where state files live. Same as root when root IS .ralph/, otherwise root/.ralph/ */
  stateDir: string;
  /** Path to backlog.json (resolved from root or stateDir) */
  backlog: string;
  /** Path to state.json */
  state: string;
  /** Path to ralph.log */
  log: string;
  /** Path to DONE sentinel */
  done: string;
  /** Path to CANCEL sentinel */
  cancel: string;
  /** Path to progress.md */
  progress: string;
  /** Path to iteration-status.json */
  iterationStatus: string;
  /** Path to archive/ directory */
  archive: string;
  /** Path to .loop.lock */
  lock: string;
}

/** Instruction file paths with fallback resolution */
export interface InstructionPaths {
  /** Resolved RALPH.md path (per-root or project-level fallback) */
  ralphMd: string | null;
  /** Resolved REVIEW.md path (per-root or project-level fallback) */
  reviewMd: string | null;
}
```

### 2.2 Key Functions

```ts
/**
 * Resolve the absolute backlog root path from a project path and optional --backlog flag.
 *
 * When backlogFlag is omitted, returns path.join(projectPath, ".ralph").
 * When provided, resolves relative to projectPath and validates sandboxing.
 */
export function resolveBacklogRoot(projectPath: string, backlogFlag?: string): Result<string>;

/**
 * Resolve the state directory for a backlog root.
 *
 * If the root's basename is ".ralph" (the default root), state files coexist in the root.
 * Otherwise, state files live in a ".ralph/" subdirectory within the root.
 */
export function resolveStateDir(backlogRoot: string): string;

/**
 * Build the complete set of resolved paths for a backlog root.
 *
 * Locates backlog.json in the root directory first, then falls back to stateDir.
 * Throws PATH_VIOLATION if backlogRoot is outside projectPath.
 */
export function resolveBacklogPaths(projectPath: string, backlogRoot: string): BacklogPaths;

/**
 * Resolve instruction file paths with per-root → project-level fallback.
 *
 * Checks stateDir/RALPH.md first, then projectPath/.ralph/RALPH.md.
 * Same for REVIEW.md.
 */
export function resolveInstructionPaths(paths: BacklogPaths): InstructionPaths;

/**
 * Ensure the state directory exists, creating it (and parents) if needed.
 */
export function ensureStateDir(paths: BacklogPaths): void;
```

### 2.3 Modified Modules

| Module                                    | Change                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/backlog.ts`            | Replace internal `getBacklogPath()`/`getStatePath()` with `BacklogPaths` parameter on all exported functions    |
| `packages/core/src/status.ts`             | Replace internal path helpers; `deriveStatus()` accepts `BacklogPaths`; add `scanActiveRoots()`                 |
| `packages/core/src/iteration-status.ts`   | Replace internal `statusPath()` with `BacklogPaths` parameter                                                   |
| `packages/core/src/archive.ts`            | Replace internal `getArchiveDir()` with `BacklogPaths` parameter                                                |
| `packages/core/src/reset.ts`              | Replace inline path construction with `BacklogPaths` parameter                                                  |
| `packages/core/src/schemas.ts`            | Add `backlogRoot` to `LoopStartOptionsSchema`                                                                   |
| `packages/core/src/errors.ts`             | Add `LOCK_CONFLICT` error code                                                                                  |
| `packages/core/src/index.ts`              | Add `export * from "./backlog-root.js"` and `export * from "./lock.js"`                                         |
| `packages/loop/src/runner.ts`             | Accept `BacklogPaths` via options; pass to all core calls                                                       |
| `packages/loop/src/prompt-builder.ts`     | Accept `BacklogPaths` + `InstructionPaths`; remove hardcoded `.ralph/`; inject backlog root context into prompt |
| `packages/cli/src/loop-commands.ts`       | Extract `--backlog` flag; call `resolveBacklogRoot()`; pass to LoopRunner                                       |
| `packages/cli/src/backlog-commands.ts`    | Extract `--backlog` flag; pass `BacklogPaths` to core                                                           |
| `packages/cli/src/status-commands.ts`     | Extract `--backlog` flag; call `scanActiveRoots()` when no flag; fix inline `.ralph/progress.md` path           |
| `packages/web/src/server/routes/loop.ts`  | Accept `backlogRoot` in request body; pass through to LoopManager                                               |
| `packages/web/src/server/loop-manager.ts` | Key active loops by backlog root path instead of project path                                                   |

### 2.4 New Module: `packages/core/src/lock.ts` (REQ-LOCK-01 through REQ-LOCK-05)

Lock file management for preventing concurrent loop execution on the same backlog root.

## 3. Technical Decisions

### 3.1 Centralized Path Resolution via `backlog-root.ts` (REQ-ARCH-01, REQ-ARCH-02, REQ-ROOT-01)

**Decision:** Create a single `backlog-root.ts` module that exports `resolveBacklogPaths()`, returning a typed `BacklogPaths` object. All other modules receive `BacklogPaths` instead of constructing paths internally.

**Rationale:** Currently, 6 modules each define private `RALPH_DIR` constants and path helpers. Threading a `backlogRoot` parameter through each would duplicate the state-dir detection logic. Centralizing it means the `.ralph/`-basename special case (REQ-STATE-02) lives in exactly one place.

**Alternatives Considered:** Thread `backlogRoot` string through each function — rejected because it spreads the detection logic for REQ-STATE-02 across every module.

### 3.2 State Directory Detection via Basename (REQ-STATE-02)

**Decision:** `resolveStateDir(backlogRoot)` checks `path.basename(backlogRoot) === ".ralph"`. If true, state files live directly in the root (no nesting). Otherwise, state files live in `{backlogRoot}/.ralph/`.

**Rationale:** Simple, deterministic, no filesystem access needed. Any directory named `.ralph` gets the no-nesting behavior, which is the correct semantic — `.ralph` directories are always state directories themselves.

```ts
export function resolveStateDir(backlogRoot: string): string {
  const resolved = path.resolve(backlogRoot);
  if (path.basename(resolved) === ".ralph") {
    return resolved; // default root: state coexists with backlog.json
  }
  return path.join(resolved, ".ralph"); // non-default: state in subdirectory
}
```

### 3.3 Backlog.json Location Resolution (REQ-STATE-04, REQ-ROOT-01)

**Decision:** Look for `backlog.json` at `{backlogRoot}/backlog.json` first. If not found and `stateDir` differs from `root`, check `{stateDir}/backlog.json`. This supports both feature-forge convention (`specs/auth/backlog.json`) and the traditional layout (`specs/auth/.ralph/backlog.json`).

**Rationale:** Feature-forge places `backlog.json` at `specs/{feature}/backlog.json`. The default root has it at `.ralph/backlog.json` (root and stateDir are the same). Checking root first, then stateDir, handles both cases without configuration.

### 3.4 Lock File Implementation (REQ-LOCK-01 through REQ-LOCK-05, REQ-REL-02)

**Decision:** Lock file at `{stateDir}/.loop.lock` containing JSON `{ pid: number, startedAt: string, processStartTime: number }`. PID liveness checked via `process.kill(pid, 0)` plus `/proc/{pid}/stat` process start time comparison to detect PID recycling.

**Rationale:** PID-only checks have a small window for false positives when PIDs are recycled. By recording the process start time at lock creation and comparing it against the current occupant of that PID, we eliminate this class of false positive. On Linux (the primary target), `/proc/{pid}/stat` field 22 gives the start time in clock ticks. On macOS, fall back to PID-only check (recycling is even rarer due to larger PID space).

```ts
export interface LockFileContent {
  /** PID of the loop process */
  pid: number;
  /** ISO timestamp when the lock was acquired */
  startedAt: string;
  /** Process start time in clock ticks (from /proc/{pid}/stat), or null if unavailable */
  processStartTime: number | null;
}
```

**Lock lifecycle:**

1. `acquireLock(stateDir)` — check existing lock; if stale (dead PID or recycled PID), remove and proceed; if live, return `LOCK_CONFLICT` error
2. Lock acquired: write `{stateDir}/.loop.lock` atomically
3. `releaseLock(stateDir)` — remove lock file (called in `LoopRunner` finally block)
4. `--force` flag: call `releaseLock()` before `acquireLock()` with a warning

### 3.5 Active Root Discovery via Filesystem Scan (REQ-STATUS-01, REQ-PERF-01)

**Decision:** `scanActiveRoots(projectPath)` globs for `state.json` files under the project root, reads each, and returns roots with non-idle status. Excludes `node_modules/`, `.git/`, and other common non-project directories.

**Rationale:** For < 20 roots, reading ~20 small JSON files is well under the 500ms target (~10ms in practice). An index file (`roots.json`) would require registration/deregistration bookkeeping that adds complexity without measurable benefit at this scale.

```ts
export interface ActiveRoot {
  /** Relative path from project root to the backlog root */
  relativePath: string;
  /** Current loop status */
  loopState: LoopStateEnum;
  /** Current item being worked on, if any */
  currentItem: string | null;
}

export function scanActiveRoots(projectPath: string): ActiveRoot[];
```

**Synchronous scan algorithm** (using `fs.readdirSync`/`fs.readFileSync`, consistent with existing core conventions):

1. Recursively walk `projectPath` for files named `state.json` inside `.ralph/` directories
2. Skip: `node_modules`, `.git`, `dist`, `build`, `coverage`
3. For each `state.json`: parse, check `status !== "idle"`, extract backlog root from parent path
4. Also check for `.loop.lock` files — a lock without a state.json still indicates activity

This function lives in `status.ts` (the natural home, since it already handles status derivation).

### 3.6 Prompt Builder Backlog Root Context (REQ-INST-01, REQ-ARCH-03)

**Decision:** `buildPrompt()` receives `BacklogPaths` and `InstructionPaths`. It injects a section into the prompt telling the agent which backlog root is active:

```
## Active Backlog Root
You are working against the backlog at: specs/auth/backlog.json
State directory: specs/auth/.ralph/
Do NOT modify files outside this state directory.
```

**Rationale:** Per REQ-INST-01 notes: "the loop runner must provide the active backlog root path as context to the agent." When RALPH.md falls back to the project-level version, the agent needs to know which state directory to target. Injecting this as a prompt section (rather than rewriting RALPH.md content) is non-invasive and always accurate.

### 3.7 Web API Scope (REQ-CLI-05)

**Decision:** Minimal changes to satisfy REQ-CLI-05 (CLI `--backlog` works when server is running):

- Add `backlogRoot?: string` to the loop start/stop request body
- `LoopManager` changes its internal map key from `projectPath` to `backlogRoot` (the full resolved path)
- Status and backlog CRUD routes accept an optional `backlog` query parameter

No UI changes. The web dashboard multi-root views are explicitly out of scope (P1 follow-up per PRD Section 6).

### 3.8 Backup File Location (OQ-03)

**Decision:** `.bak` files are written alongside the original `backlog.json`, wherever it was found.

**Rationale:** Matches current behavior. The `atomicWrite` utility in `fs-utils.ts` writes `.bak` to `${filePath}.bak` — this already works correctly regardless of where the file is located. No changes needed to `atomicWrite` itself.

### 3.9 Instruction File Fallback (REQ-INST-01, REQ-INST-02)

**Decision:** `resolveInstructionPaths()` checks:

1. `{stateDir}/RALPH.md` — per-root override
2. `{projectPath}/.ralph/RALPH.md` — project-level fallback

Same for `REVIEW.md`. Returns `null` if neither exists (REVIEW.md is optional).

If neither per-root nor project-level RALPH.md exists, `resolveInstructionPaths()` returns `ralphMd: null`. The loop runner treats a null `ralphMd` as a startup error and returns a `FILE_NOT_FOUND` Result, consistent with current behavior where missing RALPH.md prevents loop execution.

`progress.md` has no fallback — always per-root at `{stateDir}/progress.md` (REQ-INST-03).

## 4. Data Model

### 4.1 `BacklogPaths` Interface

See Section 2.1. This is a pure data object (no methods) containing resolved absolute paths. It's created once at command entry and threaded through all function calls.

### 4.2 `.loop.lock` File Schema

```json
{
  "pid": 12345,
  "startedAt": "2026-03-24T10:00:00Z",
  "processStartTime": 5678901234
}
```

- `pid`: Process ID of the loop runner
- `startedAt`: ISO 8601 timestamp
- `processStartTime`: Value from `/proc/{pid}/stat` field 22 (clock ticks since boot), or `null` on non-Linux platforms

### 4.3 `LoopStartOptions` Extension

```ts
export const LoopStartOptionsSchema = z.object({
  maxIterations: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
  model: z.string().optional(),
  sessionTimeoutMinutes: z.number().int().positive(),
  provider: z.string().optional(),
  review: z.boolean().optional(),
  reviewOnly: z.boolean().optional(),
  backlogRoot: z.string().optional(), // NEW: absolute path to backlog root
});
```

## 5. API Design

### 5.1 Core Functions — Signature Changes

Every core function that currently takes `projectPath: string` and uses it for state file access will change to accept `BacklogPaths`:

```ts
// backlog.ts
export function readBacklog(paths: BacklogPaths): Result<Backlog>;
export function writeBacklog(paths: BacklogPaths, backlog: Backlog): Result<void>;
export function addItem(paths: BacklogPaths, input: CreateItemInput): Result<BacklogItem>;
export function updateItem(
  paths: BacklogPaths,
  id: string,
  updates: UpdateItemInput,
): Result<BacklogItem>;
export function deleteItem(paths: BacklogPaths, id: string): Result<void>;
export function restoreFromBackup(paths: BacklogPaths): Result<void>;
export function resetStalledItems(paths: BacklogPaths): Result<{ resetCount: number }>;
export function ensureBacklog(paths: BacklogPaths): Result<Backlog>;
export function unblockItems(
  paths: BacklogPaths,
  itemId?: string,
): Result<{ unblockedCount: number; unblockedIds: string[] }>;

// status.ts
export function deriveStatus(paths: BacklogPaths): Result<DerivedStatus>;
export function readLogTail(paths: BacklogPaths, lines?: number): Result<string[]>;
export function writeLoopState(paths: BacklogPaths, state: LoopState): Result<void>;
export function appendLog(paths: BacklogPaths, message: string): Result<void>;
export function writeDoneFile(paths: BacklogPaths, content: string): Result<void>;
export function clearDoneFile(paths: BacklogPaths): Result<void>;
export function checkCancelRequested(paths: BacklogPaths): boolean;
export function clearCancelFile(paths: BacklogPaths): Result<void>;
export function watchLog(paths: BacklogPaths, callback: (lines: string[]) => void): () => void;

// iteration-status.ts
export function writeIterationStatus(
  paths: BacklogPaths,
  status: IterationStatus,
  force?: boolean,
): Result<boolean>;
export function readIterationStatus(paths: BacklogPaths): IterationStatus | null;
export function clearIterationStatus(paths: BacklogPaths): void;

// archive.ts
export function sweepBacklog(paths: BacklogPaths, options?: SweepOptions): Result<SweepResult>;
export function listArchiveMonths(paths: BacklogPaths): Result<string[]>;
export function readArchiveMonth(paths: BacklogPaths, month: string): Result<ArchiveMonth>;
export function purgeArchive(paths: BacklogPaths): Result<void>;

// reset.ts
export function resetProject(paths: BacklogPaths, options?: ResetOptions): Result<void>;
```

> **Note:** Signature changes are limited to replacing the `projectPath: string` parameter with `paths: BacklogPaths`. Return types are preserved to avoid breaking existing callers. Functions that do not currently accept `projectPath` (e.g., `selectNextItem(backlog: Backlog)`) are unchanged — they operate on in-memory data and need no path parameter.

### 5.2 Lock Module Functions

```ts
// lock.ts
export function acquireLock(paths: BacklogPaths): Result<void>;
export function releaseLock(paths: BacklogPaths): Result<void>;
export function checkLock(paths: BacklogPaths): Result<LockStatus>;
export function forceClearLock(paths: BacklogPaths): Result<void>;

export interface LockStatus {
  locked: boolean;
  pid?: number;
  startedAt?: string;
  stale?: boolean;
}
```

### 5.3 CLI `--backlog` Flag (REQ-CLI-01 through REQ-CLI-04)

All affected commands gain the flag via `extractStringFlag(ctx.flags, "backlog")`:

```bash
ralph loop run <project> [--backlog <dir>]
ralph loop start <project> [--backlog <dir>]
ralph loop stop <project> [--backlog <dir>]
ralph loop follow <project> [--backlog <dir>]
ralph loop review <project> [--backlog <dir>]
ralph backlog list <project> [--backlog <dir>]
ralph backlog add <project> [--backlog <dir>]
ralph backlog update <project> [--backlog <dir>]
ralph backlog delete <project> [--backlog <dir>]
ralph backlog unblock <project> [--backlog <dir>]
ralph status <project> [--backlog <dir>]
ralph reset <project> [--backlog <dir>]
```

Resolution flow in CLI handlers:

```ts
const projectPath = resolveProjectPath(ctx);
const backlogFlag = extractStringFlag(ctx.flags, "backlog");
const backlogRoot = resolveBacklogRoot(projectPath, backlogFlag);
const paths = resolveBacklogPaths(projectPath, backlogRoot);
```

### 5.4 Web API Endpoints

```
POST   /:id/loop/start          body: { ...options, backlogRoot?: string }
POST   /:id/loop/stop           body: { backlogRoot?: string }
GET    /:id/status              ?backlog=specs/auth
GET    /:id/backlog             ?backlog=specs/auth
GET    /:id/backlog/:itemId     ?backlog=specs/auth
POST   /:id/backlog             body: { ...item, backlogRoot?: string }
PUT    /:id/backlog/:itemId     body: { ...updates, backlogRoot?: string }
DELETE /:id/backlog/:itemId     ?backlog=specs/auth
```

The `backlog` query parameter is a relative path (same as CLI `--backlog`). The server resolves it against the project path with the same sandboxing validation. For mutation endpoints (`POST`, `PUT`), the backlog root is passed in the request body as `backlogRoot`. For read/delete endpoints (`GET`, `DELETE`), it is passed as the `backlog` query parameter.

### 5.5 Migration Strategy

All signature changes in section 5.1 are source-breaking. The recommended implementation order is:

1. **Create `backlog-root.ts` and `lock.ts`** with all new types and functions — no existing code changes yet
2. **Update core modules one at a time** to accept `BacklogPaths`, adding thin adapter functions at each callsite that construct `BacklogPaths` from `projectPath`
3. **Update `LoopRunner` and CLI/web callers** to construct `BacklogPaths` at the entry point and thread it through, removing the adapter shims

Each step should map to a separate backlog item to keep changes reviewable.

## 6. Integration Points

### 6.1 `packages/core/src/backlog.ts` → `backlog-root.ts`

- **Current:** Imports nothing for path resolution; uses internal constants
- **After:** Imports `BacklogPaths` type. All exported functions replace `projectPath: string` with `paths: BacklogPaths`. Internal path helpers are deleted — use `paths.backlog`, `paths.state` directly.
- **Shared contracts:** `BacklogPaths.backlog` (read/write location), `BacklogPaths.state` (for `readBacklog` which also reads state for `selectNextItem`)

### 6.2 `packages/core/src/status.ts` → `backlog-root.ts`

- **Current:** Imports `readBacklog` from `./backlog.js`; uses internal constants
- **After:** Imports `BacklogPaths`, `ActiveRoot`, and `scanActiveRoots`. `deriveStatus()` uses `paths.state`, `paths.log`, `paths.done`, `paths.cancel`. New `scanActiveRoots()` is added here in `status.ts` (the natural home since it already handles status derivation).
- **Data flow:** `deriveStatus(paths)` reads `paths.state` → `paths.log` → `paths.done` in that priority order

### 6.3 `packages/loop/src/runner.ts` → `@ralph/core` (backlog-root, lock)

- **Current:** Stores `this.projectPath`, passes to all core functions
- **After:** Constructor computes `this.paths = resolveBacklogPaths(projectPath, options.backlogRoot)`. All core function calls use `this.paths`. Calls `acquireLock(this.paths)` at start, `releaseLock(this.paths)` in finally block.
- **Key change:** `readMarkerFile()` still uses `projectPath` (it reads `.ralph.json` at the project root, not in the backlog root). This is the one function where `projectPath` and `backlogRoot` diverge.

### 6.4 `packages/loop/src/prompt-builder.ts` → `@ralph/core` (backlog-root)

- **Current:** Constructs `ralphMdPath`, `progressPath` internally via `.ralph/` constant
- **After:** Receives `BacklogPaths` and `InstructionPaths`. Uses `instructionPaths.ralphMd` for RALPH.md, `paths.progress` for progress.md. Adds "Active Backlog Root" section to prompt.
- **Signature change:** `buildPrompt(paths: BacklogPaths, instructionPaths: InstructionPaths, item: BacklogItem, backlog: Backlog)`

### 6.5 `packages/cli/src/*-commands.ts` → `@ralph/core` (backlog-root)

- **Current:** `resolveProjectPath(ctx)` → pass to core
- **After:** `resolveProjectPath(ctx)` + `resolveBacklogRoot(projectPath, backlogFlag)` + `resolveBacklogPaths(projectPath, backlogRoot)` → pass `paths` to core
- **Pattern:** Every command handler follows the same 3-line resolution preamble

### 6.6 `packages/web/src/server/loop-manager.ts` → keying change

- **Current:** `Map<string, LoopRunner>` keyed by `projectPath`
- **After:** Keyed by resolved `backlogRoot` path. `startLoop()` accepts `backlogRoot` in options; `stopLoop()` and `getRunner()` take `backlogRoot` as identifier.
- **Impact:** Existing callers that pass `projectPath` must now pass `backlogRoot` (which defaults to `{projectPath}/.ralph` when not specified)

### 6.7 Cross-Feature Conflicts

No other features are in progress under `specs/`. No conflicts detected.

## 7. Error Handling

### 7.1 New Error Code

```ts
export const ErrorCodes = {
  // ... existing codes ...
  LOCK_CONFLICT: "LOCK_CONFLICT",
} as const;
```

### 7.2 Error Scenarios

| Scenario                                       | Error Code       | Message                                                       |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `--backlog` path resolves outside project root | `PATH_VIOLATION` | "Backlog root '{path}' is outside the project root"           |
| `--backlog` directory does not exist           | `FILE_NOT_FOUND` | "Backlog root directory not found: {path}"                    |
| No `backlog.json` found in root or stateDir    | `FILE_NOT_FOUND` | "No backlog.json found in {root} or {stateDir}"               |
| Lock held by another live process              | `LOCK_CONFLICT`  | "Loop already running for {root} (PID {pid}, started {time})" |
| Lock file unreadable/corrupt                   | _(auto-recover)_ | Remove stale lock, log warning, proceed                       |

All errors use the existing `Result<T, RalphError>` pattern. No new error types — just the new `LOCK_CONFLICT` code.

## 8. Testing Approach

### 8.1 Shared Test Helper

Create `packages/core/src/test-helpers.ts` (not exported from the package barrel — test-only):

```ts
interface MultiRootProjectOptions {
  /** Backlog roots to create (relative paths). Default root (.ralph/) is always created. */
  roots?: Array<{
    path: string;
    backlog?: Partial<Backlog>;
    state?: Partial<LoopState>;
    hasRalphMd?: boolean;
  }>;
}

/**
 * Create a temp directory with a multi-root project structure.
 * Returns { projectPath, cleanup }.
 */
export function createMultiRootProject(options?: MultiRootProjectOptions): {
  projectPath: string;
  cleanup: () => void;
};
```

### 8.2 Test Scenarios by Module

**`backlog-root.test.ts`:**

- Resolve default root (no flag) → `.ralph/`
- Resolve custom root (`specs/auth`) → `specs/auth/`
- State dir for default root → same directory (no nesting)
- State dir for custom root → `specs/auth/.ralph/`
- Backlog.json found in root directory
- Backlog.json found in stateDir (fallback)
- Path traversal rejected (`../../other`)
- Nonexistent directory rejected

**`lock.test.ts`:**

- Acquire lock on fresh state dir → success
- Acquire when already locked by live PID → LOCK_CONFLICT
- Acquire when locked by dead PID → stale removal → success
- Release lock → file removed
- Force clear → file removed regardless of PID status
- Lock file corruption → treated as stale

**`status.test.ts` (scan additions):**

- Scan project with 0 active roots → empty list
- Scan with 1 active, 2 idle → returns 1
- Scan skips node_modules
- Scan handles missing state.json gracefully

**`backlog.test.ts` / `archive.test.ts` / etc. (updated):**

- Existing tests updated to construct `BacklogPaths` instead of passing `projectPath`
- Add parallel tests for non-default root paths

**`prompt-builder.test.ts` (updated):**

- RALPH.md found in per-root stateDir
- RALPH.md fallback to project-level `.ralph/`
- Active backlog root context injected into prompt
- progress.md read from per-root stateDir (no fallback)

### 8.3 Integration / CLI Tests

- `ralph loop run . --backlog specs/auth` runs against the correct root
- `ralph status .` shows default root + active non-default roots
- `ralph backlog list . --backlog specs/auth` lists items from correct backlog
- Lock prevents concurrent `loop run` on same root
- Two concurrent `loop run` on different roots succeeds

### 8.4 Test Sandbox Updates

Update `test-sandbox/` to support `--backlog` flag testing. Add a scenario that runs against a non-default backlog root.

## 9. Dependencies

**No new external dependencies.** All functionality uses Node.js built-ins:

- `node:fs` — file operations, directory creation, lock file I/O
- `node:path` — path resolution, basename detection
- `node:process` — `process.kill(pid, 0)` for PID liveness check

For process start time comparison on Linux: read `/proc/{pid}/stat` via `node:fs` (field 22, measured in clock ticks). On non-Linux platforms, fall back to PID-only check.

**Internal dependencies:**

- `backlog-root.ts` imports from `./fs-utils.js` (for `fileExists`)
- `lock.ts` imports from `./fs-utils.js` (for `atomicWrite`, `fileExists`) and `./errors.js`
- All existing core modules gain an import of `BacklogPaths` type from `./backlog-root.js`

## 10. Open Technical Questions

None — all PRD open questions (OQ-01 through OQ-03) and interview decisions have been resolved:

| Question                     | Resolution                                                              |
| ---------------------------- | ----------------------------------------------------------------------- |
| OQ-01: Lock file name        | `.loop.lock` (hidden file, no collision with existing files)            |
| OQ-02: Active root discovery | Filesystem scan for `state.json` files (no index)                       |
| OQ-03: Backup file location  | Alongside the original `backlog.json` (existing `atomicWrite` behavior) |
