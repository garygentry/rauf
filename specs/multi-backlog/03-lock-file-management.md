# 03 — Lock File Management

The `lock.ts` module — prevents concurrent loop execution on the same backlog root via a PID + timestamp lock file.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-LOCK-01 | Lock file in state directory | 2.1 acquireLock |
| REQ-LOCK-02 | Lock contains PID and timestamp | 2.1 acquireLock |
| REQ-LOCK-03 | Stale lock detection via PID liveness | 2.3 checkLock, 3. Stale Detection |
| REQ-LOCK-04 | --force flag overrides active lock | 2.4 forceClearLock |
| REQ-LOCK-05 | Lock cleaned up on loop termination | 2.2 releaseLock |
| REQ-REL-02 | PID recycling detection | 3. Stale Detection |
| REQ-PERF-02 | Lock operations under 50ms | 4. Performance |
| REQ-SEC-02 | Lock file permissions match state files | 2.1 acquireLock |
| REQ-OBS-02 | Lock conflict error includes PID and start time | 2.1 acquireLock |

## 1. Module Overview

**File:** `packages/core/src/lock.ts`

**Imports:**
```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { atomicWrite, fileExists } from "./fs-utils.js";
import type { BacklogPaths } from "./backlog-root.js";
import { LockFileContentSchema, type LockFileContent, type LockStatus } from "./schemas.js";
```

**Exports:** `acquireLock`, `releaseLock`, `checkLock`, `forceClearLock`

Type definitions for `LockFileContent`, `LockFileContentSchema`, and `LockStatus` are in `00-core-definitions.md` and live in `schemas.ts` / `backlog-root.ts`.

## 2. Functions

### 2.1 `acquireLock` (REQ-LOCK-01, REQ-LOCK-02, REQ-OBS-02)

Acquire a lock for the given backlog root. Checks for existing lock, handles stale locks automatically.

```typescript
/**
 * Acquire a loop lock for the given backlog root.
 *
 * If no lock exists, writes a new lock file with the current PID and timestamp.
 * If a lock exists:
 *   - Stale lock (dead PID or recycled PID): removes and re-acquires
 *   - Active lock (live PID): returns LOCK_CONFLICT error
 *
 * The lock file is written atomically via the standard atomicWrite utility.
 *
 * @param paths - BacklogPaths (uses paths.lock for the lock file location)
 * @returns ok(undefined) if lock acquired, err(LOCK_CONFLICT) if another loop is active
 */
export function acquireLock(paths: BacklogPaths): Result<void>;
```

**Implementation logic:**

1. Check for existing lock via `checkLock(paths)`
2. If `locked && !stale` → return `err({ code: LOCK_CONFLICT, message: "Loop already running for {relativePath} (PID {pid}, started {startedAt})", details: { backlogRoot: paths.root, pid, startedAt } })`
3. If `locked && stale` → remove stale lock file, log warning
4. Build lock content:
   ```typescript
   const content: LockFileContent = {
     pid: process.pid,
     startedAt: new Date().toISOString(),
     processStartTime: getProcessStartTime(process.pid),
   };
   ```
5. Write lock file: `atomicWrite(paths.lock, JSON.stringify(content, null, 2) + "\n")`
6. Return `ok(undefined)`

**Error shape (LOCK_CONFLICT):**
```typescript
{
  code: "LOCK_CONFLICT",
  message: "Loop already running for specs/auth (PID 12345, started 2026-03-24T10:00:00Z)",
  details: {
    backlogRoot: "/abs/project/specs/auth",
    pid: 12345,
    startedAt: "2026-03-24T10:00:00Z",
  },
}
```

The relative path in the message is computed as `path.relative(paths.projectPath, paths.root)` for readability.

### 2.2 `releaseLock` (REQ-LOCK-05)

Release the lock when the loop terminates.

```typescript
/**
 * Release the loop lock for the given backlog root.
 *
 * Removes the lock file. Returns ok even if the file doesn't exist
 * (idempotent — safe to call in finally blocks).
 *
 * @param paths - BacklogPaths (uses paths.lock)
 * @returns ok(undefined) on success
 */
export function releaseLock(paths: BacklogPaths): Result<void>;
```

**Implementation logic:**

```typescript
export function releaseLock(paths: BacklogPaths): Result<void> {
  try {
    fs.unlinkSync(paths.lock);
  } catch (e) {
    // ENOENT is fine — lock may have already been removed
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code !== "ENOENT") {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Failed to release lock: ${e.message}`,
        details: { path: paths.lock },
      });
    }
  }
  return ok(undefined);
}
```

### 2.3 `checkLock` (REQ-LOCK-03)

Check the current lock state without modifying it.

```typescript
/**
 * Check the current lock state for a backlog root.
 *
 * Reads the lock file, checks PID liveness, and detects PID recycling.
 * Does not acquire or release the lock — purely informational.
 *
 * @param paths - BacklogPaths (uses paths.lock)
 * @returns Lock status including stale detection
 */
export function checkLock(paths: BacklogPaths): Result<LockStatus>;
```

**Implementation logic:**

1. If `!fileExists(paths.lock)` → return `ok({ locked: false })`
2. Read and parse lock file:
   ```typescript
   let raw: string;
   try {
     raw = fs.readFileSync(paths.lock, "utf-8");
   } catch {
     // Unreadable lock file — treat as stale
     return ok({ locked: true, stale: true });
   }
   ```
3. Parse JSON and validate against `LockFileContentSchema`:
   - Parse failure → `ok({ locked: true, stale: true })` (corrupt lock = stale)
4. Check PID liveness via `isProcessAlive(content.pid)`
   - Dead PID → `ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true })`
5. If PID is alive, check for recycling via `isProcessRecycled(content.pid, content.processStartTime)`
   - Recycled → `ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true })`
6. PID alive and not recycled → `ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: false })`

### 2.4 `forceClearLock` (REQ-LOCK-04)

Force-remove a lock regardless of PID status. Used with `--force` flag.

```typescript
/**
 * Force-remove the lock file regardless of whether the PID is alive.
 * Used when the --force flag is specified. Logs a warning.
 *
 * @param paths - BacklogPaths (uses paths.lock)
 * @returns ok(undefined) on success
 */
export function forceClearLock(paths: BacklogPaths): Result<void>;
```

**Implementation:** Same as `releaseLock()` — delegates to `releaseLock(paths)`. The warning is printed by the CLI caller, not by this function (keeping core side-effect-free).

## 3. Stale Detection (REQ-LOCK-03, REQ-REL-02)

### 3.1 PID Liveness Check

```typescript
/**
 * Check if a process with the given PID is alive.
 * Uses `process.kill(pid, 0)` which sends no signal but checks existence.
 *
 * @param pid - Process ID to check
 * @returns true if the process exists
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

### 3.2 PID Recycling Detection (Linux)

```typescript
/**
 * Detect PID recycling by comparing the process start time recorded in
 * the lock file against the current occupant of that PID.
 *
 * On Linux: reads /proc/{pid}/stat field 22 (start time in clock ticks).
 * On non-Linux: returns false (no recycling detection — falls back to PID-only check).
 *
 * @param pid - Process ID to check
 * @param recordedStartTime - Start time from lock file, or null if unavailable
 * @returns true if the PID has been recycled (different process now holds it)
 */
function isProcessRecycled(pid: number, recordedStartTime: number | null): boolean;
```

**Implementation logic:**

1. If `recordedStartTime === null` → return `false` (can't detect recycling without baseline)
2. If `process.platform !== "linux"` → return `false` (no `/proc` on macOS/Windows)
3. Read `/proc/${pid}/stat`:
   ```typescript
   let statContent: string;
   try {
     statContent = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
   } catch {
     return false; // Can't read proc — assume not recycled
   }
   ```
4. Parse field 22 (start time). `/proc/{pid}/stat` format: `pid (comm) state ppid ... starttime ...`. The challenge is that `comm` can contain spaces and parentheses. Parse by finding the last `)` then splitting the remainder:
   ```typescript
   const lastParen = statContent.lastIndexOf(")");
   if (lastParen === -1) return false;
   const fields = statContent.slice(lastParen + 2).split(" ");
   // Field 22 is at index 19 in the post-paren fields (fields 3-52, 0-indexed from field 3)
   const currentStartTime = parseInt(fields[19]!, 10);
   ```
5. Compare: `return currentStartTime !== recordedStartTime`

### 3.3 `getProcessStartTime` helper

```typescript
/**
 * Get the start time of the current process (for recording in lock file).
 * Linux: reads /proc/self/stat field 22.
 * Non-Linux: returns null.
 */
function getProcessStartTime(pid: number): number | null;
```

**Implementation:** Same `/proc/{pid}/stat` parsing as `isProcessRecycled`, but for the current process (`/proc/self/stat` or `/proc/${pid}/stat`).

## 4. Performance (REQ-PERF-02)

All lock operations must complete in under 50ms. The implementation uses:

- Synchronous `fs.readFileSync` / `fs.writeFileSync` (no async overhead)
- `process.kill(pid, 0)` is a single syscall
- `/proc/{pid}/stat` is a procfs read (kernel-backed, effectively instant)
- `atomicWrite` is two syscalls (write + rename)

No operation involves network, child process, or external tool invocation.

## Dependencies

- `00-core-definitions.md` — `LockFileContent`, `LockFileContentSchema`, `LockStatus`, `LOCK_CONFLICT` error code
- `02-backlog-root-resolution.md` — `BacklogPaths` type (used for `paths.lock`)
- `fs-utils.ts` — `atomicWrite()` at `packages/core/src/fs-utils.ts:13`, `fileExists()` at `packages/core/src/fs-utils.ts:163`
- `errors.ts` — `Result`, `ok`, `err`, `ErrorCodes` at `packages/core/src/errors.ts`

## Verification

- [ ] `acquireLock` on a fresh state directory creates `.loop.lock` with pid, startedAt, processStartTime
- [ ] `acquireLock` when already locked by a live PID returns `LOCK_CONFLICT` with pid and startedAt in error details
- [ ] `acquireLock` when locked by a dead PID removes stale lock and acquires successfully
- [ ] `releaseLock` removes the lock file
- [ ] `releaseLock` returns ok even if lock file doesn't exist (idempotent)
- [ ] `checkLock` returns `{ locked: false }` when no lock file exists
- [ ] `checkLock` returns `{ locked: true, stale: true }` for dead PID
- [ ] `checkLock` returns `{ locked: true, stale: true }` for corrupt/unreadable lock file
- [ ] `checkLock` returns `{ locked: true, stale: false }` for live, non-recycled PID
- [ ] `forceClearLock` removes lock regardless of PID status
- [ ] PID recycling detection works on Linux (different start time → stale)
- [ ] PID recycling detection gracefully returns false on non-Linux
- [ ] All operations complete in under 50ms
- [ ] `pnpm typecheck` passes
