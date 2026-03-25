# 06 — CLI and Web Integration

Adding the `--backlog` flag to all CLI commands and updating web API routes to accept a backlog root parameter.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CLI-01 | All commands accept --backlog flag | 2. CLI Changes |
| REQ-CLI-02 | --backlog accepts directory path | 2.1 Resolution Pattern |
| REQ-CLI-03 | Default to .ralph/ when --backlog omitted | 2.1 Resolution Pattern |
| REQ-CLI-04 | Validate backlog root within project root | 2.1 Resolution Pattern |
| REQ-CLI-05 | CLI passes backlog root to server API | 3. Web API Changes |
| REQ-STATUS-01 | Status shows all active roots when no --backlog | 2.4 handleStatus |
| REQ-STATUS-02 | Status --backlog shows specific root | 2.4 handleStatus |
| REQ-STATUS-03 | Status identifies which root each block refers to | 2.4 handleStatus |
| REQ-LOCK-04 | --force flag overrides active lock | 2.2 handleLoopRun |

## 1. New Import in CLI Commands

All CLI command files gain:

```typescript
import { resolveBacklogRoot, resolveBacklogPaths, type BacklogPaths } from "@ralph/core";
```

`status-commands.ts` additionally imports:
```typescript
import { scanActiveRoots } from "@ralph/core";
```

## 2. CLI Changes

### 2.1 Resolution Pattern (REQ-CLI-01 through REQ-CLI-04)

Every command handler that operates on a backlog or loop gains the same 3-line preamble after resolving the project path:

```typescript
const projectPath = resolveProjectPath(ctx);
const backlogFlag = extractStringFlag(ctx.flags, "backlog");
const backlogRootResult = resolveBacklogRoot(projectPath, backlogFlag ?? undefined);
if (!backlogRootResult.ok) {
  error(backlogRootResult.error.message);
  return ExitCode.ERROR;
}
const pathsResult = resolveBacklogPaths(projectPath, backlogRootResult.value);
if (!pathsResult.ok) {
  error(pathsResult.error.message);
  return ExitCode.ERROR;
}
const paths = pathsResult.value;
```

When `--backlog` is omitted, `extractStringFlag` returns `null`, so `resolveBacklogRoot` defaults to `{projectPath}/.ralph`.

### 2.2 `handleLoopRun` (REQ-LOCK-04)

The direct-mode `loop run` command gains `--backlog` and `--force` flag extraction:

```typescript
export async function handleLoopRun(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const force = extractBoolFlag(ctx.flags, "force");

  // Resolve backlog paths (same pattern as 2.1)
  const backlogRootResult = resolveBacklogRoot(projectPath, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) { error(...); return ExitCode.ERROR; }
  const pathsResult = resolveBacklogPaths(projectPath, backlogRootResult.value);
  if (!pathsResult.ok) { error(...); return ExitCode.ERROR; }
  const paths = pathsResult.value;

  // Handle --force: clear existing lock with warning (REQ-LOCK-04)
  if (force) {
    const { forceClearLock, checkLock } = await import("@ralph/core");
    const lockStatus = checkLock(paths);
    if (lockStatus.ok && lockStatus.value.locked) {
      warn(`Force-clearing lock (PID ${lockStatus.value.pid}, started ${lockStatus.value.startedAt})`);
      forceClearLock(paths);
    }
  }

  // Extract remaining flags (unchanged)...
  const maxIterations = extractNumberFlag(ctx.flags, "iterations") ?? DEFAULT_MAX_ITERATIONS;
  // ...

  // Pass backlogRoot in options
  const options: LoopStartOptions = {
    maxIterations,
    maxRetries,
    model: model ?? undefined,
    sessionTimeoutMinutes,
    // ...
    backlogRoot: backlogRootResult.value, // NEW
  };

  // Use static factory (see spec 05, section 2.1)
  const runnerResult = LoopRunner.create(projectPath, options);
  if (!runnerResult.ok) {
    error(runnerResult.error.message);
    return ExitCode.ERROR;
  }
  const runner = runnerResult.value;
  // ... rest unchanged ...
}
```

### 2.3 `handleLoopStart` / `handleLoopStop` / `handleLoopFollow`

These commands route through the web server API. The `--backlog` flag is extracted and passed in the request body or query parameter:

**`handleLoopStart`:**
```typescript
const backlogFlag = extractStringFlag(ctx.flags, "backlog");

// In the POST body:
const body = {
  maxIterations,
  maxRetries,
  model,
  sessionTimeoutMinutes,
  backlogRoot: backlogFlag ?? undefined, // NEW — relative path, server resolves
};
```

**`handleLoopStop`:**
```typescript
const backlogFlag = extractStringFlag(ctx.flags, "backlog");

// POST body:
const body = { backlogRoot: backlogFlag ?? undefined };
```

**`handleLoopFollow`:**
```typescript
const backlogFlag = extractStringFlag(ctx.flags, "backlog");

// If server mode: append to SSE URL as query param
const url = backlogFlag
  ? `${eventsUrl}?backlog=${encodeURIComponent(backlogFlag)}`
  : eventsUrl;

// If direct mode: resolve paths and use paths.log for watchLog
```

### 2.4 `handleStatus` (REQ-STATUS-01, REQ-STATUS-02, REQ-STATUS-03)

```typescript
export async function handleStatus(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) { /* unchanged */ }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  if (backlogFlag) {
    // REQ-STATUS-02: Show status for specific root only
    const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag);
    if (!backlogRootResult.ok) { error(...); return ExitCode.ERROR; }
    const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
    if (!pathsResult.ok) { error(...); return ExitCode.ERROR; }

    const result = deriveStatus(pathsResult.value);
    // ... format and print (unchanged pattern) ...
  } else {
    // REQ-STATUS-01: Show default root + list active non-default roots
    const defaultRoot = path.join(resolved, ".ralph");
    const defaultPathsResult = resolveBacklogPaths(resolved, defaultRoot);

    if (defaultPathsResult.ok) {
      const result = deriveStatus(defaultPathsResult.value);
      if (result.ok) {
        printStatusSummary(result.value);
      }
    }

    // Scan for active non-default roots
    const activeRootsResult = scanActiveRoots(resolved);
    if (activeRootsResult.ok && activeRootsResult.value.length > 0) {
      print(""); // blank line separator
      print(c.bold("Active backlog roots:"));
      for (const root of activeRootsResult.value) {
        // REQ-STATUS-03: Identify each root by relative path
        if (root.relativePath === ".ralph") continue; // skip default (already shown)
        const stateLabel = root.loopState;
        const itemLabel = root.currentItem ? ` (item ${root.currentItem})` : "";
        print(`  ${c.cyan(root.relativePath)} — ${stateLabel}${itemLabel}`);
      }
    }
  }
}
```

### 2.5 Backlog Commands

All backlog CRUD handlers (`handleBacklogList`, `handleBacklogAdd`, `handleBacklogEdit`, `handleBacklogDelete`, `handleBacklogShow`, `handleBacklogRestore`, `handleBacklogSweep`, `handleBacklogReset`, `handleBacklogUnblock`) follow the same pattern:

```typescript
// Before (e.g., handleBacklogList):
const resolved = path.resolve(targetPath);
const result = readBacklog(resolved);

// After:
const resolved = path.resolve(targetPath);
const backlogFlag = extractStringFlag(ctx.flags, "backlog");
const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
if (!backlogRootResult.ok) { error(...); return ExitCode.INVALID_ARGS; }
const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
if (!pathsResult.ok) { error(...); return ExitCode.ERROR; }

const result = readBacklog(pathsResult.value);
```

### 2.6 `handleProgress`

The progress command currently reads `.ralph/progress.md` directly:

```typescript
// Before:
const progressPath = path.join(resolved, ".ralph", "progress.md");

// After:
const backlogFlag = extractStringFlag(ctx.flags, "backlog");
// ... resolve paths ...
const progressPath = paths.progress;
```

### 2.7 `handleLog`

```typescript
// Before:
const result = readLogTail(resolved, lines);

// After:
const result = readLogTail(paths, lines);
```

### 2.8 Affected Commands Summary

| Command | `--backlog` | `--force` |
|---------|:-----------:|:---------:|
| `ralph loop run` | Yes | Yes (new) |
| `ralph loop start` | Yes | Yes (new) |
| `ralph loop stop` | Yes | No |
| `ralph loop follow` | Yes | No |
| `ralph loop review` | Yes | No |
| `ralph backlog list` | Yes | No |
| `ralph backlog add` | Yes | No |
| `ralph backlog edit` | Yes | No |
| `ralph backlog delete` | Yes | No |
| `ralph backlog show` | Yes | No |
| `ralph backlog restore` | Yes | No |
| `ralph backlog sweep` | Yes | No |
| `ralph backlog unblock` | Yes | No |
| `ralph status` | Yes | No |
| `ralph reset` | Yes | No |
| `ralph log` | Yes | No |
| `ralph progress` | Yes | No |

## 3. Web API Changes (REQ-CLI-05)

### 3.1 Route Changes

**`routes/loop.ts`:**

```typescript
// Start loop — accept backlogRoot in body
const StartLoopBodySchema = z
  .object({
    maxIterations: z.number().int().positive().optional(),
    maxRetries: z.number().int().positive().optional(),
    model: z.string().optional(),
    sessionTimeoutMinutes: z.number().int().positive().optional(),
    backlogRoot: z.string().optional(), // NEW
  })
  .optional();
```

In the start handler:
```typescript
router.post("/:id/loop/start", async (c) => {
  const body = await c.req.json().catch(() => undefined);
  const parsed = StartLoopBodySchema.parse(body);

  const projectPath = resolveProjectPath(c.req.param("id"));
  // ...

  // Resolve backlog root from body (relative path → absolute)
  let backlogRoot: string | undefined;
  if (parsed?.backlogRoot) {
    const rootResult = resolveBacklogRoot(projectPath, parsed.backlogRoot);
    if (!rootResult.ok) return errorResponse(c, 400, rootResult.error);
    backlogRoot = rootResult.value;
  }

  const options: LoopStartOptions = {
    maxIterations: parsed?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    maxRetries: parsed?.maxRetries ?? DEFAULT_MAX_RETRIES,
    sessionTimeoutMinutes: parsed?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
    model: parsed?.model,
    backlogRoot, // NEW
  };

  const result = manager.startLoop(projectPath, options);
  // ...
});
```

**Stop loop:**
```typescript
router.post("/:id/loop/stop", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const backlogRoot = body?.backlogRoot;

  // If backlogRoot specified, resolve and pass to manager
  const resolvedRoot = backlogRoot
    ? resolveBacklogRoot(projectPath, backlogRoot)
    : undefined;

  const stopped = manager.stopLoop(projectPath, resolvedRoot?.value);
  // ...
});
```

**Status and backlog routes — accept `backlog` query parameter:**
```typescript
// GET /:id/status?backlog=specs/auth
router.get("/:id/status", async (c) => {
  const backlogParam = c.req.query("backlog");
  // ... resolve and derive status ...
});

// GET /:id/backlog?backlog=specs/auth
router.get("/:id/backlog", async (c) => {
  const backlogParam = c.req.query("backlog");
  // ... resolve and read backlog ...
});
```

### 3.2 LoopManager Changes

**File:** `packages/web/src/server/loop-manager.ts`

Re-key the `activeLoops` map from `projectPath` to the resolved backlog root path:

```typescript
export class LoopManager {
  /** Active loops keyed by resolved backlog root path (was: project path) */
  private activeLoops = new Map<string, ActiveLoop>();

  /** Event listeners keyed by backlog root path */
  private listeners = new Map<string, Set<LoopEventListener>>();

  startLoop(projectPath: string, options: LoopStartOptions): { ok: boolean; error?: string } {
    const runner = new LoopRunner(projectPath, options);

    // Key by backlog root (default: {projectPath}/.ralph)
    const backlogRoot = options.backlogRoot ?? path.join(projectPath, ".ralph");

    if (this.activeLoops.has(backlogRoot)) {
      return { ok: false, error: "Loop already running for this backlog root" };
    }

    // ... subscribe to events, store ActiveLoop keyed by backlogRoot ...
  }

  stopLoop(projectPath: string, backlogRoot?: string): boolean {
    const key = backlogRoot ?? path.join(projectPath, ".ralph");
    const active = this.activeLoops.get(key);
    if (!active) return false;
    active.runner.cancel();
    return true;
  }

  isRunning(projectPath: string, backlogRoot?: string): boolean {
    const key = backlogRoot ?? path.join(projectPath, ".ralph");
    return this.activeLoops.has(key);
  }
}
```

## Dependencies

- `00-core-definitions.md` — `BacklogPaths` type, `LoopStartOptions` extension with `backlogRoot`
- `02-backlog-root-resolution.md` — `resolveBacklogRoot`, `resolveBacklogPaths`
- `04-core-module-refactor.md` — refactored core function signatures
- `05-loop-runner-integration.md` — `LoopRunner` constructor accepts `backlogRoot` in options

## Verification

- [ ] `ralph loop run . --backlog specs/auth` resolves to `specs/auth/backlog.json`
- [ ] `ralph loop run .` (no flag) uses `.ralph/backlog.json` (unchanged behavior)
- [ ] `ralph loop run . --backlog ../../outside` produces a clear `PATH_VIOLATION` error
- [ ] `ralph loop run . --backlog specs/auth --force` clears existing lock before starting
- [ ] `ralph status .` shows default root status + lists active non-default roots
- [ ] `ralph status . --backlog specs/auth` shows only that root's status
- [ ] `ralph backlog list . --backlog specs/auth` lists items from correct backlog
- [ ] `ralph backlog add . --backlog specs/auth --title "test"` adds to correct backlog
- [ ] All commands pass `--backlog` to server API when server is running
- [ ] LoopManager keys active loops by backlog root, not project path
- [ ] Two concurrent loops on different roots (via server) do not conflict
- [ ] `pnpm typecheck` passes
