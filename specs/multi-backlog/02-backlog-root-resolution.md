# 02 — Backlog Root Resolution

The `backlog-root.ts` module — the centerpiece of multi-backlog. All path resolution for state files, backlog files, instruction files, and lock files flows through this module.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ROOT-01 | Backlog root is a directory containing backlog.json | 2.3 resolveBacklogPaths |
| REQ-ROOT-02 | Each root has isolated runtime state files | 2.3 resolveBacklogPaths |
| REQ-ROOT-03 | Default root is .ralph/ when no --backlog flag | 2.1 resolveBacklogRoot |
| REQ-ROOT-04 | Default root not special-cased in model | 2.2 resolveStateDir |
| REQ-STATE-01 | State files in .ralph/ subdir within root | 2.2 resolveStateDir |
| REQ-STATE-02 | No .ralph/.ralph/ nesting for default root | 2.2 resolveStateDir |
| REQ-STATE-03 | State dir auto-created on first loop run | 2.5 ensureStateDir |
| REQ-STATE-04 | backlog.json inside or outside .ralph/ | 2.3 resolveBacklogPaths |
| REQ-CLI-02 | --backlog accepts directory path, not file path | 2.1 resolveBacklogRoot |
| REQ-CLI-04 | Validate backlog root within project root | 2.1 resolveBacklogRoot |
| REQ-ARCH-01 | Path resolution from single backlog root param | All |
| REQ-ARCH-02 | Core is single source of path resolution | All |
| REQ-SEC-01 | Path sandboxing within project root | 2.1 resolveBacklogRoot |
| REQ-INST-01 | RALPH.md fallback resolution | 2.4 resolveInstructionPaths |
| REQ-INST-02 | REVIEW.md fallback resolution | 2.4 resolveInstructionPaths |
| REQ-INST-03 | progress.md always per-root | 2.3 resolveBacklogPaths |
| REQ-REL-01 | Auto-create state dir if missing | 2.5 ensureStateDir |
| REQ-REL-03 | Atomic write guarantees in any root | 2.3 resolveBacklogPaths (note) |

## 1. Module Overview

**File:** `packages/core/src/backlog-root.ts`

**Imports:**
```typescript
import * as path from "node:path";
import { fileExists, validatePath, ensureDir } from "./fs-utils.js";
import { type Result, ok, err, ErrorCodes } from "./errors.js";
```

**Exports:** `BacklogPaths`, `InstructionPaths`, `resolveBacklogRoot`, `resolveStateDir`, `resolveBacklogPaths`, `resolveInstructionPaths`, `ensureStateDir`

The type definitions for `BacklogPaths` and `InstructionPaths` are specified in `00-core-definitions.md`.

## 2. Functions

### 2.1 `resolveBacklogRoot` (REQ-ROOT-03, REQ-CLI-02, REQ-CLI-04, REQ-SEC-01)

Resolve the absolute backlog root path from a project path and an optional `--backlog` flag value.

```typescript
/**
 * Resolve the absolute backlog root path from a project path and optional --backlog flag.
 *
 * When `backlogFlag` is omitted or undefined, returns the default root: `{projectPath}/.ralph`.
 * When provided, resolves relative to `projectPath` and validates that the result
 * is within the project root (path sandboxing per REQ-SEC-01).
 *
 * @param projectPath - Absolute path to the project root (directory containing .ralph.json)
 * @param backlogFlag - Optional --backlog flag value (relative directory path)
 * @returns Absolute path to the backlog root directory
 */
export function resolveBacklogRoot(
  projectPath: string,
  backlogFlag?: string,
): Result<string>;
```

**Implementation logic:**

1. If `backlogFlag` is `undefined` or empty string → return `ok(path.join(path.resolve(projectPath), ".ralph"))`
2. Resolve: `const resolved = path.resolve(projectPath, backlogFlag)`
3. Validate sandboxing: call `validatePath(resolved, [path.resolve(projectPath)])`
   - If validation fails → return `err({ code: PATH_VIOLATION, message: "Backlog root '{resolved}' is outside the project root" })`
4. Return `ok(resolved)`

**Error handling:**

| Scenario | Error Code | Message |
|----------|-----------|---------|
| `--backlog ../../outside` resolves outside project | `PATH_VIOLATION` | `"Backlog root '{path}' is outside the project root"` |

**Note:** This function does NOT check whether the directory exists. Existence checking happens in `resolveBacklogPaths()` which is the next step in the resolution chain. This separation allows `resolveBacklogRoot()` to be used for path validation alone (e.g., in CLI flag parsing before any filesystem access).

### 2.2 `resolveStateDir` (REQ-STATE-01, REQ-STATE-02, REQ-ROOT-04)

Determine where state files live for a given backlog root.

```typescript
/**
 * Resolve the state directory for a backlog root.
 *
 * Detection rule: if the backlog root's basename is ".ralph", state files
 * coexist in the root directory itself (no nesting). Otherwise, state files
 * live in a ".ralph/" subdirectory within the root.
 *
 * This means the default root `.ralph/` stores state directly (avoiding
 * `.ralph/.ralph/`), while custom roots like `specs/auth/` store state
 * in `specs/auth/.ralph/`.
 *
 * @param backlogRoot - Absolute path to the backlog root directory
 * @returns Absolute path to the state directory
 */
export function resolveStateDir(backlogRoot: string): string;
```

**Implementation logic:**

```typescript
export function resolveStateDir(backlogRoot: string): string {
  const resolved = path.resolve(backlogRoot);
  if (path.basename(resolved) === ".ralph") {
    return resolved; // default root: no nesting
  }
  return path.join(resolved, ".ralph");
}
```

**This is a pure function** — no filesystem access, no Result wrapper needed. It is deterministic based solely on the path string.

**Examples:**

| `backlogRoot` | `resolveStateDir()` result |
|---------------|---------------------------|
| `/project/.ralph` | `/project/.ralph` (same directory) |
| `/project/specs/auth` | `/project/specs/auth/.ralph` |
| `/project/specs/auth/.ralph` | `/project/specs/auth/.ralph` (basename is `.ralph`) |

### 2.3 `resolveBacklogPaths` (REQ-ROOT-01, REQ-ROOT-02, REQ-STATE-04, REQ-ARCH-01)

Build the complete set of resolved paths for a backlog root.

```typescript
/**
 * Build the complete `BacklogPaths` object for a backlog root.
 *
 * Resolves the state directory via `resolveStateDir()`, then probes for
 * `backlog.json` in two locations:
 *   1. `{backlogRoot}/backlog.json` (feature-forge convention)
 *   2. `{stateDir}/backlog.json` (traditional layout, when stateDir differs from root)
 *
 * Returns an error if the backlog root directory does not exist or if
 * backlog.json cannot be found in either location.
 *
 * @param projectPath - Absolute path to the project root
 * @param backlogRoot - Absolute path to the backlog root (from resolveBacklogRoot)
 * @returns Complete BacklogPaths object with all resolved paths
 */
export function resolveBacklogPaths(
  projectPath: string,
  backlogRoot: string,
): Result<BacklogPaths>;
```

**Implementation logic:**

1. Validate `backlogRoot` is within `projectPath` using `validatePath(backlogRoot, [path.resolve(projectPath)])`
   - On failure → return `err({ code: PATH_VIOLATION, ... })`
2. Check that `backlogRoot` exists as a directory
   - If not → return `err({ code: FILE_NOT_FOUND, message: "Backlog root directory not found: {backlogRoot}" })`
3. Compute `stateDir = resolveStateDir(backlogRoot)`
4. Locate `backlog.json`:
   - `const rootBacklog = path.join(backlogRoot, "backlog.json")`
   - `const stateDirBacklog = path.join(stateDir, "backlog.json")`
   - If `fileExists(rootBacklog)` → use `rootBacklog`
   - Else if `stateDir !== backlogRoot && fileExists(stateDirBacklog)` → use `stateDirBacklog`
   - Else → return `err({ code: FILE_NOT_FOUND, message: "No backlog.json found in {backlogRoot} or {stateDir}" })`
5. Build and return `BacklogPaths`:

```typescript
return ok({
  projectPath: path.resolve(projectPath),
  root: path.resolve(backlogRoot),
  stateDir,
  backlog: backlogPath, // resolved in step 4
  state: path.join(stateDir, "state.json"),
  log: path.join(stateDir, "ralph.log"),
  done: path.join(stateDir, "DONE"),
  cancel: path.join(stateDir, "CANCEL"),
  progress: path.join(stateDir, "progress.md"),
  iterationStatus: path.join(stateDir, "iteration-status.json"),
  archive: path.join(stateDir, "archive"),
  lock: path.join(stateDir, ".loop.lock"),
});
```

**Error handling:**

| Scenario | Error Code | Message |
|----------|-----------|---------|
| backlogRoot outside projectPath | `PATH_VIOLATION` | `"Backlog root '{path}' is outside the project root"` |
| backlogRoot directory doesn't exist | `FILE_NOT_FOUND` | `"Backlog root directory not found: {path}"` |
| No backlog.json in root or stateDir | `FILE_NOT_FOUND` | `"No backlog.json found in {root} or {stateDir}"` |

**Path examples:**

| Backlog root | stateDir | backlog.json location | Notes |
|-------------|----------|----------------------|-------|
| `.ralph` | `.ralph` | `.ralph/backlog.json` | Default root — state and backlog coexist |
| `specs/auth` | `specs/auth/.ralph` | `specs/auth/backlog.json` | Feature-forge convention — backlog outside .ralph/ |
| `specs/auth` | `specs/auth/.ralph` | `specs/auth/.ralph/backlog.json` | Alternative — backlog inside .ralph/ |

**Note on atomic writes (REQ-REL-03):** The `atomicWrite` utility in `fs-utils.ts` is path-agnostic — it works on any absolute path. By routing all paths through `BacklogPaths`, atomic write guarantees automatically extend to any backlog root. No changes needed to `atomicWrite` itself.

### 2.4 `resolveInstructionPaths` (REQ-INST-01, REQ-INST-02)

Resolve instruction file paths with per-root then project-level fallback.

```typescript
/**
 * Resolve instruction file paths with per-root → project-level fallback.
 *
 * For RALPH.md: checks `{stateDir}/RALPH.md` first, then `{projectPath}/.ralph/RALPH.md`.
 * For REVIEW.md: same fallback logic.
 *
 * Returns `null` for a file if it exists in neither location. The caller
 * (loop runner) decides whether a missing RALPH.md is an error.
 *
 * progress.md has no fallback — it is always at `{stateDir}/progress.md`
 * and is accessed via `BacklogPaths.progress` directly (REQ-INST-03).
 *
 * @param paths - BacklogPaths object (must have projectPath and stateDir)
 * @returns Resolved paths for RALPH.md and REVIEW.md, or null if missing
 */
export function resolveInstructionPaths(
  paths: BacklogPaths,
): InstructionPaths;
```

**Implementation logic:**

```typescript
export function resolveInstructionPaths(paths: BacklogPaths): InstructionPaths {
  const projectRalphDir = path.join(paths.projectPath, ".ralph");

  function resolveWithFallback(filename: string): string | null {
    // 1. Per-root override
    const perRoot = path.join(paths.stateDir, filename);
    if (fileExists(perRoot)) return perRoot;

    // 2. Project-level fallback (only if stateDir differs from project .ralph/)
    if (paths.stateDir !== projectRalphDir) {
      const projectLevel = path.join(projectRalphDir, filename);
      if (fileExists(projectLevel)) return projectLevel;
    }

    return null;
  }

  return {
    ralphMd: resolveWithFallback("RALPH.md"),
    reviewMd: resolveWithFallback("REVIEW.md"),
  };
}
```

**This is a synchronous function** performing only `fileExists` checks. No Result wrapper because the output semantics use `null` to indicate absence (which is not an error at this layer — the loop runner decides if it's fatal).

**Fallback examples:**

| Root | stateDir | RALPH.md exists in stateDir? | Result |
|------|----------|------------------------------|--------|
| `.ralph` | `.ralph` | Yes | `.ralph/RALPH.md` (no fallback needed — stateDir IS project .ralph/) |
| `specs/auth` | `specs/auth/.ralph` | Yes | `specs/auth/.ralph/RALPH.md` |
| `specs/auth` | `specs/auth/.ralph` | No | `.ralph/RALPH.md` (project-level fallback) |
| `specs/auth` | `specs/auth/.ralph` | No (and project-level also missing) | `null` |

### 2.5 `ensureStateDir` (REQ-STATE-03, REQ-REL-01)

Ensure the state directory exists, creating it and parents if needed.

```typescript
/**
 * Ensure the state directory for a backlog root exists.
 * Creates the directory and all parent directories if they don't exist.
 *
 * Called by the loop runner before first access to state files.
 *
 * @param paths - BacklogPaths object (uses paths.stateDir)
 * @returns ok(undefined) on success, err on filesystem failure
 */
export function ensureStateDir(paths: BacklogPaths): Result<void>;
```

**Implementation:** Delegates to the existing `ensureDir(paths.stateDir)` from `fs-utils.ts`.

```typescript
export function ensureStateDir(paths: BacklogPaths): Result<void> {
  return ensureDir(paths.stateDir);
}
```

## 3. Resolution Flow

The complete resolution chain used at every CLI/web entry point:

```
CLI flag: --backlog specs/auth
                │
                ▼
    resolveBacklogRoot(projectPath, "specs/auth")
        → "/abs/project/specs/auth"
                │
                ▼
    resolveBacklogPaths(projectPath, backlogRoot)
        → BacklogPaths { root, stateDir, backlog, state, log, ... }
                │
                ▼
    ensureStateDir(paths)    [loop runner only]
        → creates specs/auth/.ralph/ if needed
                │
                ▼
    resolveInstructionPaths(paths)    [loop runner only]
        → InstructionPaths { ralphMd, reviewMd }
```

For the default root (no `--backlog` flag):

```
    resolveBacklogRoot(projectPath, undefined)
        → "/abs/project/.ralph"
                │
                ▼
    resolveBacklogPaths(projectPath, "/abs/project/.ralph")
        → BacklogPaths { root: ".ralph", stateDir: ".ralph", backlog: ".ralph/backlog.json", ... }
```

## Dependencies

- `00-core-definitions.md` — `BacklogPaths` and `InstructionPaths` type definitions
- `fs-utils.ts` — `fileExists()` at `packages/core/src/fs-utils.ts:163`, `validatePath()` at `packages/core/src/fs-utils.ts:136`, `ensureDir()` at `packages/core/src/fs-utils.ts:176`
- `errors.ts` — `Result`, `ok`, `err`, `ErrorCodes` at `packages/core/src/errors.ts`

## Verification

- [ ] `resolveBacklogRoot(projectPath)` (no flag) returns `{projectPath}/.ralph`
- [ ] `resolveBacklogRoot(projectPath, "specs/auth")` returns `{projectPath}/specs/auth`
- [ ] `resolveBacklogRoot(projectPath, "../../outside")` returns `PATH_VIOLATION` error
- [ ] `resolveStateDir` for `.ralph` basename returns same directory (no nesting)
- [ ] `resolveStateDir` for `specs/auth` returns `specs/auth/.ralph`
- [ ] `resolveBacklogPaths` finds backlog.json in root directory first
- [ ] `resolveBacklogPaths` falls back to stateDir for backlog.json
- [ ] `resolveBacklogPaths` returns `FILE_NOT_FOUND` when neither location has backlog.json
- [ ] `resolveBacklogPaths` returns `FILE_NOT_FOUND` when root directory doesn't exist
- [ ] `resolveInstructionPaths` finds per-root RALPH.md when present
- [ ] `resolveInstructionPaths` falls back to project-level RALPH.md
- [ ] `resolveInstructionPaths` returns null when RALPH.md missing in both locations
- [ ] `resolveInstructionPaths` never falls back for the default root (stateDir === project .ralph/)
- [ ] `ensureStateDir` creates directory with parents
- [ ] `pnpm typecheck` passes
