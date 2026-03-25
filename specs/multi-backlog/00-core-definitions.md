# 00 — Core Definitions

Shared types, error codes, and constants for the multi-backlog feature. Every other spec document references definitions here.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ROOT-01 | Backlog root is a directory containing backlog.json | 1.1 BacklogPaths |
| REQ-ROOT-02 | Each root has isolated runtime state files | 1.1 BacklogPaths |
| REQ-STATE-01 | State files in .ralph/ subdirectory within root | 1.1 BacklogPaths |
| REQ-STATE-02 | No .ralph/.ralph/ nesting for default root | 1.1 BacklogPaths |
| REQ-STATE-04 | backlog.json inside or outside .ralph/ state dir | 1.1 BacklogPaths |
| REQ-INST-01 | RALPH.md fallback resolution | 1.2 InstructionPaths |
| REQ-INST-02 | REVIEW.md fallback resolution | 1.2 InstructionPaths |
| REQ-LOCK-01 | Lock file in state directory | 1.3 LockFileContent |
| REQ-LOCK-02 | Lock contains PID and timestamp | 1.3 LockFileContent |
| REQ-LOCK-03 | Stale lock detection | 1.4 LockStatus |
| REQ-REL-02 | PID recycling detection | 1.3 LockFileContent |
| REQ-STATUS-01 | Active root discovery | 1.5 ActiveRoot |
| REQ-OBS-02 | Lock conflict includes PID and start time | 2.1 LOCK_CONFLICT |

## 1. Types

### 1.1 `BacklogPaths` (REQ-ROOT-01, REQ-ROOT-02, REQ-STATE-01, REQ-STATE-02, REQ-STATE-04)

The central data object for this feature. Created once at command entry point, then threaded through all function calls. Contains resolved absolute paths for every file in a backlog root.

```typescript
import * as path from "node:path";

/**
 * All resolved absolute paths for a backlog root.
 *
 * Created by `resolveBacklogPaths()` and threaded through every core,
 * loop, CLI, and web function that touches backlog or state files.
 * Pure data — no methods, no filesystem access at construction time
 * (except for backlog.json location probing).
 */
export interface BacklogPaths {
  /** The project root directory (contains .ralph.json marker) */
  projectPath: string;
  /** The backlog root directory (contains backlog.json or has .ralph/ subdir with it) */
  root: string;
  /**
   * Where state files live (state.json, ralph.log, progress.md, etc.).
   * Same as `root` when root IS `.ralph/` (the default root case).
   * Otherwise `root/.ralph/`.
   */
  stateDir: string;
  /** Resolved path to backlog.json (found in root or stateDir) */
  backlog: string;
  /** Path to state.json */
  state: string;
  /** Path to ralph.log */
  log: string;
  /** Path to DONE sentinel file */
  done: string;
  /** Path to CANCEL sentinel file */
  cancel: string;
  /** Path to progress.md (always per-root, no fallback) */
  progress: string;
  /** Path to iteration-status.json */
  iterationStatus: string;
  /** Path to archive/ directory */
  archive: string;
  /** Path to .loop.lock */
  lock: string;
}
```

### 1.2 `InstructionPaths` (REQ-INST-01, REQ-INST-02)

Resolved instruction file paths with per-root-then-project-level fallback logic.

```typescript
/**
 * Instruction file paths resolved with fallback.
 *
 * For RALPH.md and REVIEW.md: checks the backlog root's state directory first,
 * then falls back to the project-level `.ralph/` directory.
 * Returns `null` if neither location has the file.
 */
export interface InstructionPaths {
  /** Resolved RALPH.md path (per-root override or project-level fallback), or null if missing */
  ralphMd: string | null;
  /** Resolved REVIEW.md path (per-root override or project-level fallback), or null if missing */
  reviewMd: string | null;
}
```

### 1.3 `LockFileContent` (REQ-LOCK-01, REQ-LOCK-02, REQ-REL-02)

JSON content of the `.loop.lock` file, written atomically when a loop starts.

```typescript
/**
 * Content of the `.loop.lock` file in a backlog root's state directory.
 * Used to prevent concurrent loop execution on the same backlog root.
 */
export interface LockFileContent {
  /** PID of the loop process that acquired the lock */
  pid: number;
  /** ISO 8601 timestamp when the lock was acquired */
  startedAt: string;
  /**
   * Process start time in clock ticks (from /proc/{pid}/stat field 22).
   * Used to detect PID recycling on Linux. Null on non-Linux platforms
   * where this information is unavailable.
   */
  processStartTime: number | null;
}
```

### 1.4 `LockStatus` (REQ-LOCK-03)

Return type from `checkLock()` describing the current lock state.

```typescript
/**
 * Describes the current state of a backlog root's lock file.
 * Returned by `checkLock()`.
 */
export interface LockStatus {
  /** Whether a lock file exists */
  locked: boolean;
  /** PID of the lock holder (if locked) */
  pid?: number;
  /** ISO 8601 timestamp when the lock was acquired (if locked) */
  startedAt?: string;
  /** Whether the lock is stale (PID dead or recycled) */
  stale?: boolean;
}
```

### 1.5 `ActiveRoot` (REQ-STATUS-01)

Represents a backlog root with a non-idle loop, discovered by filesystem scan.

```typescript
import type { LoopStateEnum } from "./schemas.js";

/**
 * A backlog root discovered to have an active (non-idle) loop.
 * Returned by `scanActiveRoots()` for the status display.
 */
export interface ActiveRoot {
  /** Relative path from project root to the backlog root directory */
  relativePath: string;
  /** Current loop status (from state.json or lock file presence) */
  loopState: LoopStateEnum;
  /** ID of the backlog item currently being worked on, if any */
  currentItem: string | null;
}
```

### 1.6 `LockFileContentSchema` (Zod validation)

```typescript
import { z } from "zod";

/** Zod schema for validating lock file JSON content */
export const LockFileContentSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string(),
  processStartTime: z.number().int().nullable(),
});
```

### 1.7 `LoopStartOptionsSchema` Extension

The existing `LoopStartOptionsSchema` in `schemas.ts` gains one optional field:

```typescript
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

## 2. Error Codes

### 2.1 `LOCK_CONFLICT` (REQ-OBS-02)

New error code added to the existing `ErrorCodes` const in `errors.ts`:

```typescript
export const ErrorCodes = {
  // ... existing codes preserved ...
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_JSON: "INVALID_JSON",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PATH_VIOLATION: "PATH_VIOLATION",
  ALREADY_INSTALLED: "ALREADY_INSTALLED",
  NOT_INSTALLED: "NOT_INSTALLED",
  CONFLICT: "CONFLICT",
  TRANSITION_INVALID: "TRANSITION_INVALID",
  LOCK_CONFLICT: "LOCK_CONFLICT", // NEW
} as const;
```

**Error shape for `LOCK_CONFLICT`:**

```typescript
{
  code: "LOCK_CONFLICT",
  message: "Loop already running for specs/auth (PID 12345, started 2026-03-24T10:00:00Z)",
  details: {
    backlogRoot: "/absolute/path/to/specs/auth",
    pid: 12345,
    startedAt: "2026-03-24T10:00:00Z",
  },
}
```

## 3. Constants

```typescript
/** Lock file name within the state directory */
export const LOCK_FILENAME = ".loop.lock";

/** Directories to skip during active root scanning */
export const SCAN_SKIP_DIRS = ["node_modules", ".git", "dist", "build", "coverage"] as const;

/** State file name (already exists in status.ts and backlog.ts — unified here) */
export const STATE_FILENAME = "state.json";

/** Backlog file name */
export const BACKLOG_FILENAME = "backlog.json";

/** Default backlog root directory name */
export const DEFAULT_ROOT_DIR = ".ralph";
```

## 4. Reused Types (No Changes)

The following existing types from `schemas.ts` are used by multi-backlog functions but require no modifications:

- `LoopStateEnum` — used in `ActiveRoot.loopState`
- `LoopState` / `LoopStateSchema` — read from state.json during active root scanning
- `Result<T, RalphError>` — return type for all new public functions
- `RalphError` — error shape used in `err()` calls
- `Backlog` / `BacklogSchema` — read/written via `BacklogPaths.backlog`
- `LoopStartOptions` — extended with `backlogRoot` field

## Dependencies

None — this is the foundation document. All other spec documents depend on this one.

## Verification

- [ ] `BacklogPaths` interface has fields for every state file listed in REQ-ROOT-02 (state.json, ralph.log, progress.md, iteration-status.json, DONE, CANCEL, archive/)
- [ ] `BacklogPaths` includes `lock` field for the lock file
- [ ] `LockFileContent` includes `pid`, `startedAt`, and `processStartTime` per REQ-LOCK-02 and REQ-REL-02
- [ ] `LOCK_CONFLICT` error code is added to `ErrorCodes`
- [ ] `LoopStartOptionsSchema` includes optional `backlogRoot` field
- [ ] All types have JSDoc on every field
- [ ] `LockFileContentSchema` validates against the `LockFileContent` interface
