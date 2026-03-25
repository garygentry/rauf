# 04 — Core Module Refactor

Signature changes to existing core modules: `backlog.ts`, `status.ts`, `iteration-status.ts`, `archive.ts`, and `reset.ts`. Each module replaces its internal path helpers and `projectPath: string` parameters with the centralized `BacklogPaths` object.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ARCH-01 | Path resolution from single backlog root param | All sections |
| REQ-ARCH-02 | Core is single source of path resolution | All sections |
| REQ-ROOT-02 | Each root has isolated runtime state | All sections |
| REQ-STATUS-01 | Show all active backlog roots | 3. status.ts — scanActiveRoots |
| REQ-STATUS-03 | Status identifies which root each block refers to | 3. status.ts — scanActiveRoots |
| REQ-PERF-01 | Status scan under 500ms for 20 roots | 3. status.ts — scanActiveRoots |
| REQ-OBS-01 | Log records which backlog root is active | 3. status.ts — appendLog |

## 1. Refactor Pattern

Every module follows the same transformation:

1. **Delete** internal path constants (`BACKLOG_DIR`, `RALPH_DIR`, `ARCHIVE_SUBDIR`) and path helper functions (`getBacklogPath()`, `getStatePath()`, `getLogPath()`, etc.)
2. **Add** import: `import type { BacklogPaths } from "./backlog-root.js";`
3. **Change** first parameter of every exported function from `projectPath: string` to `paths: BacklogPaths`
4. **Replace** all internal path construction with direct field access on `paths` (e.g., `getBacklogPath(projectPath)` → `paths.backlog`)

Functions that operate on in-memory data only (e.g., `selectNextItem(backlog)`, `validateStatusTransition()`) are **unchanged** — they don't take `projectPath` today and don't need `BacklogPaths`.

## 2. `backlog.ts`

**File:** `packages/core/src/backlog.ts`

### 2.1 Removals

```typescript
// DELETE these constants and functions:
const BACKLOG_DIR = ".ralph";
const BACKLOG_FILENAME = "backlog.json";
const STATE_FILENAME = "state.json";

function getBacklogPath(projectPath: string): string { ... }
function getStatePath(projectPath: string): string { ... }
```

### 2.2 New Import

```typescript
import type { BacklogPaths } from "./backlog-root.js";
```

### 2.3 Signature Changes

| Function | Before | After |
|----------|--------|-------|
| `readBacklog` | `(projectPath: string): Result<Backlog>` | `(paths: BacklogPaths): Result<Backlog>` |
| `writeBacklog` | `(projectPath: string, backlog: Backlog): Result<void>` | `(paths: BacklogPaths, backlog: Backlog): Result<void>` |
| `addItem` | `(projectPath: string, input: CreateItemInput): Result<BacklogItem>` | `(paths: BacklogPaths, input: CreateItemInput): Result<BacklogItem>` |
| `updateItem` | `(projectPath: string, itemId: string, updates: UpdateItemInput): Result<BacklogItem>` | `(paths: BacklogPaths, itemId: string, updates: UpdateItemInput): Result<BacklogItem>` |
| `deleteItem` | `(projectPath: string, itemId: string): Result<void>` | `(paths: BacklogPaths, itemId: string): Result<void>` |
| `restoreFromBackup` | `(projectPath: string): Result<void>` | `(paths: BacklogPaths): Result<void>` |
| `resetStalledItems` | `(projectPath: string): Result<{ resetCount: number }>` | `(paths: BacklogPaths): Result<{ resetCount: number }>` |
| `ensureBacklog` | `(projectPath: string): Result<void>` | `(paths: BacklogPaths): Result<void>` |
| `unblockItems` | `(projectPath: string, itemId?: string): Result<...>` | `(paths: BacklogPaths, itemId?: string): Result<...>` |

**Unchanged:** `selectNextItem(backlog: Backlog)`, `validateStatusTransition(current, target)`

### 2.4 Key Internal Changes

**`readBacklog`:**
```typescript
// Before:
return readJsonFile(getBacklogPath(projectPath), BacklogSchema, normalizeBacklogItems);

// After:
return readJsonFile(paths.backlog, BacklogSchema, normalizeBacklogItems);
```

**`writeBacklog`:**
```typescript
// Before:
return atomicWrite(getBacklogPath(projectPath), content);

// After:
return atomicWrite(paths.backlog, content);
```

**`deleteItem` — state.json check:**
```typescript
// Before:
const statePath = getStatePath(projectPath);
const stateResult = readJsonFile(statePath, LoopStateSchema);

// After:
const stateResult = readJsonFile(paths.state, LoopStateSchema);
```

**`addItem` — smart default criteria:**
The `addItem` function currently calls `readMarkerFile(projectPath)` for the verify command. This call uses `projectPath` (the project root, not backlog root) and should continue to do so — the marker file is always at project level. Access `paths.projectPath`:
```typescript
// Before:
const markerResult = readMarkerFile(projectPath);

// After:
const markerResult = readMarkerFile(paths.projectPath);
```

**`ensureBacklog`:**
The current implementation checks if `.ralph/` directory exists. With multi-backlog, it should check if the state directory exists:
```typescript
// Before:
const ralphDir = path.join(resolved, BACKLOG_DIR);
if (!fileExists(ralphDir)) { return err(...NOT_INSTALLED...) }

// After:
// For non-default roots, the state dir may not exist yet (it gets created by ensureStateDir).
// ensureBacklog checks if backlog.json exists at paths.backlog — if not, creates an empty one.
// The NOT_INSTALLED check only applies to the default root case.
if (!fileExists(paths.backlog)) {
  // For default root: check if .ralph/ dir exists
  if (path.basename(paths.root) === ".ralph" && !fileExists(paths.root)) {
    return err({ code: ErrorCodes.NOT_INSTALLED, ... });
  }
  // Create empty backlog
  const projectName = path.basename(paths.projectPath);
  return writeBacklog(paths, { project: projectName, description: "", items: [] });
}
return ok(undefined);
```

**`restoreFromBackup`:**
```typescript
// Before:
const backlogPath = getBacklogPath(projectPath);
const bakPath = `${backlogPath}.bak`;

// After:
const bakPath = `${paths.backlog}.bak`;
// fs.copyFileSync(bakPath, paths.backlog);
```

**Internal calls between functions:**
Functions like `addItem`, `resetStalledItems`, and `unblockItems` call `readBacklog` and `writeBacklog` internally. These calls change from `readBacklog(projectPath)` to `readBacklog(paths)`:
```typescript
// resetStalledItems — before:
const backlogResult = readBacklog(projectPath);
const result = updateItem(projectPath, item.id, { status: "pending" });

// After:
const backlogResult = readBacklog(paths);
const result = updateItem(paths, item.id, { status: "pending" });
```

### 2.5 Exported Constants

The exported constants `BACKLOG_DIR`, `BACKLOG_FILENAME`, `STATE_FILENAME` are removed from `backlog.ts`. If any tests reference them, they should import the equivalents from `backlog-root.ts` (`DEFAULT_ROOT_DIR`, `BACKLOG_FILENAME`, `STATE_FILENAME` — see `00-core-definitions.md` section 3).

## 3. `status.ts`

**File:** `packages/core/src/status.ts`

### 3.1 Removals

```typescript
// DELETE these constants and functions:
const RALPH_DIR = ".ralph";
const STATE_FILENAME = "state.json";
const LOG_FILENAME = "ralph.log";
const DONE_FILENAME = "DONE";
const CANCEL_FILENAME = "CANCEL";

function getStatePath(projectPath: string): string { ... }
function getLogPath(projectPath: string): string { ... }
function getDonePath(projectPath: string): string { ... }
function getCancelPath(projectPath: string): string { ... }
```

### 3.2 New Imports

```typescript
import type { BacklogPaths, ActiveRoot } from "./backlog-root.js";
```

### 3.3 Signature Changes

| Function | Before | After |
|----------|--------|-------|
| `deriveStatus` | `(projectPath: string): Result<DerivedStatus>` | `(paths: BacklogPaths): Result<DerivedStatus>` |
| `readLogTail` | `(projectPath: string, lines?: number): Result<string[]>` | `(paths: BacklogPaths, lines?: number): Result<string[]>` |
| `watchLog` | `(projectPath: string, callback: ...): () => void` | `(paths: BacklogPaths, callback: ...): () => void` |
| `writeLoopState` | `(projectPath: string, state: ...): Result<void>` | `(paths: BacklogPaths, state: ...): Result<void>` |
| `appendLog` | `(projectPath: string, message: string): Result<void>` | `(paths: BacklogPaths, message: string): Result<void>` |
| `writeDoneFile` | `(projectPath: string, content: string): Result<void>` | `(paths: BacklogPaths, content: string): Result<void>` |
| `clearDoneFile` | `(projectPath: string): Result<void>` | `(paths: BacklogPaths): Result<void>` |
| `checkCancelRequested` | `(projectPath: string): boolean` | `(paths: BacklogPaths): boolean` |
| `clearCancelFile` | `(projectPath: string): Result<boolean>` | `(paths: BacklogPaths): Result<boolean>` |

### 3.4 Key Internal Changes

All path construction becomes direct field access:
```typescript
// Before:
const statePath = getStatePath(projectPath);
const logPath = getLogPath(projectPath);

// After:
const statePath = paths.state;
const logPath = paths.log;
```

**`computeBacklogSummary`** (private function):
```typescript
// Before:
function computeBacklogSummary(projectPath: string): BacklogSummary {
  const backlogResult = readBacklog(projectPath);

// After:
function computeBacklogSummary(paths: BacklogPaths): BacklogSummary {
  const backlogResult = readBacklog(paths);
```

**`deriveStatus` — NOT_INSTALLED check:**
The current code checks `fileExists(ralphDir)`. With multi-backlog, the check changes to whether the state directory exists. For the default root, the state dir IS `.ralph/`, so the behavior is preserved. For non-default roots, `NOT_INSTALLED` doesn't apply (the root was explicitly specified):
```typescript
// Before:
const ralphDir = path.join(resolved, RALPH_DIR);
if (!fileExists(ralphDir)) { return ok({ loopState: "NOT_INSTALLED", ... }) }

// After:
// NOT_INSTALLED only applies when no explicit backlog root was specified
// and the default .ralph/ dir doesn't exist. The caller (CLI) handles this.
// deriveStatus itself always has a valid BacklogPaths, so it just proceeds.
// If state.json doesn't exist, tier 1 returns null and tier 2 handles it.
```

### 3.5 New Function: `scanActiveRoots` (REQ-STATUS-01, REQ-STATUS-03, REQ-PERF-01)

```typescript
/**
 * Scan the project for backlog roots with active (non-idle) loops.
 *
 * Walks the project directory looking for state.json files inside .ralph/
 * directories. For each found, reads the state and returns roots with
 * non-idle status. Also detects .loop.lock files as activity indicators.
 *
 * Skips: node_modules, .git, dist, build, coverage
 *
 * @param projectPath - Absolute path to the project root
 * @returns Array of active roots with their status
 */
export function scanActiveRoots(projectPath: string): Result<ActiveRoot[]>;
```

**Implementation logic:**

1. Initialize `results: ActiveRoot[]`
2. Recursively walk `projectPath`:
   - Skip directories in `SCAN_SKIP_DIRS` (from `00-core-definitions.md`)
   - For each directory entry named `.ralph`, check for `state.json` inside it
3. For each `state.json` found:
   - Parse with `LoopStateSchema`
   - If `status !== "idle"`, compute the backlog root:
     - If the parent directory of the `.ralph/` dir has a `backlog.json`, the backlog root is the parent
     - Otherwise the backlog root is the `.ralph/` dir itself (default root pattern)
   - Add to results: `{ relativePath: path.relative(projectPath, backlogRoot), loopState: mapLoopStateStatus(status), currentItem }`
4. Also check for `.loop.lock` files without a corresponding active state.json (indicates a loop that crashed before writing state)
5. Sort results by `relativePath` for deterministic output
6. Return `ok(results)`

**Implementation approach — synchronous recursive walk:**
```typescript
function walkForStateFiles(dir: string, projectPath: string, results: ActiveRoot[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or deleted — skip
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    if (SCAN_SKIP_DIRS.includes(name as any)) continue;

    const fullPath = path.join(dir, name);

    if (name === ".ralph") {
      // Check for state.json in this .ralph dir
      const statePath = path.join(fullPath, "state.json");
      checkAndAddRoot(statePath, fullPath, projectPath, results);
      // Don't recurse into .ralph dirs
      continue;
    }

    // Recurse into non-.ralph directories
    walkForStateFiles(fullPath, projectPath, results);
  }
}
```

**Performance note (REQ-PERF-01):** For projects with < 20 roots, this scan reads at most ~20 small JSON files. On modern SSDs, the full walk+parse completes well under 100ms. The skip-list prevents crawling `node_modules` (which would be the primary performance concern).

### 3.6 Exported Constants

Remove exported constants `RALPH_DIR`, `LOG_FILENAME`, `DONE_FILENAME`, `CANCEL_FILENAME`. Keep `STALENESS_THRESHOLD_MS` and `LOG_ACTIVE_THRESHOLD_MS` (used by tests).

## 4. `iteration-status.ts`

**File:** `packages/core/src/iteration-status.ts`

### 4.1 Removals

```typescript
// DELETE:
const STATUS_FILENAME = "iteration-status.json";

function statusPath(projectPath: string): string { ... }
```

### 4.2 Signature Changes

| Function | Before | After |
|----------|--------|-------|
| `writeIterationStatus` | `(projectPath: string, status: IterationStatus, force?: boolean): Result<boolean>` | `(paths: BacklogPaths, status: IterationStatus, force?: boolean): Result<boolean>` |
| `readIterationStatus` | `(projectPath: string): IterationStatus \| null` | `(paths: BacklogPaths): IterationStatus \| null` |
| `clearIterationStatus` | `(projectPath: string): void` | `(paths: BacklogPaths): void` |

### 4.3 Key Internal Changes

```typescript
// Before:
const result = atomicWrite(statusPath(projectPath), content);
lastWriteAt.set(projectPath, now);

// After:
const result = atomicWrite(paths.iterationStatus, content);
lastWriteAt.set(paths.iterationStatus, now);  // Key by path, not projectPath
```

**Throttle key change:** The `lastWriteAt` map was keyed by `projectPath`. With multi-backlog, multiple roots per project need independent throttling. Key by `paths.iterationStatus` (the full file path) instead.

## 5. `archive.ts`

**File:** `packages/core/src/archive.ts`

### 5.1 Removals

```typescript
// DELETE:
const ARCHIVE_SUBDIR = ".ralph/archive";

function getArchiveDir(projectPath: string): string { ... }
function getArchiveFilePath(projectPath: string, month: string): string { ... }
```

### 5.2 Signature Changes

| Function | Before | After |
|----------|--------|-------|
| `sweepBacklog` | `(projectPath: string, options?): Result<SweepResult>` | `(paths: BacklogPaths, options?): Result<SweepResult>` |
| `listArchiveMonths` | `(projectPath: string): Result<string[]>` | `(paths: BacklogPaths): Result<string[]>` |
| `readArchiveMonth` | `(projectPath: string, month: string): Result<ArchiveMonth>` | `(paths: BacklogPaths, month: string): Result<ArchiveMonth>` |
| `purgeArchive` | `(projectPath: string, month?: string): Result<...>` | `(paths: BacklogPaths, month?: string): Result<...>` |

### 5.3 Key Internal Changes

```typescript
// Before:
const archiveDir = getArchiveDir(projectPath);
const archivePath = getArchiveFilePath(projectPath, month);
const backlogResult = readBacklog(projectPath);
writeBacklog(projectPath, { ...backlog, items: toKeep });

// After:
const archiveDir = paths.archive;
const archivePath = path.join(paths.archive, `${month}.json`);
const backlogResult = readBacklog(paths);
writeBacklog(paths, { ...backlog, items: toKeep });
```

The archive file path helper becomes a simple inline `path.join(paths.archive, \`${month}.json\`)` since the archive directory is already resolved in `BacklogPaths`.

## 6. `reset.ts`

**File:** `packages/core/src/reset.ts`

### 6.1 Removals

```typescript
// DELETE:
const RALPH_DIR = ".ralph";
const STATE_FILENAME = "state.json";
```

### 6.2 Signature Change

| Function | Before | After |
|----------|--------|-------|
| `resetProject` | `(projectPath: string, options?: ResetProjectOptions): Result<ResetProjectResult>` | `(paths: BacklogPaths, options?: ResetProjectOptions): Result<ResetProjectResult>` |

### 6.3 Key Internal Changes

```typescript
// Before:
const ensureResult = ensureBacklog(resolved);
const sweepResult = sweepBacklog(resolved);
const stalledResult = resetStalledItems(resolved);
const statePath = path.join(resolved, RALPH_DIR, STATE_FILENAME);
const doneResult = clearDoneFile(resolved);
const cancelResult = clearCancelFile(resolved);
const progressPath = path.join(ralphDir, "progress.md");

// After:
const ensureResult = ensureBacklog(paths);
const sweepResult = sweepBacklog(paths);
const stalledResult = resetStalledItems(paths);
const statePath = paths.state;
const doneResult = clearDoneFile(paths);
const cancelResult = clearCancelFile(paths);
const progressPath = paths.progress;
```

**Progress archiving:**
```typescript
// Before:
const ralphDir = path.join(resolved, RALPH_DIR);
const archiveDir = path.join(ralphDir, "archive");

// After:
const archiveDir = paths.archive;
```

**`deployProgress` call:**
The current code calls `deployProgress(ralphDir)` after archiving progress.md. This function is from `installer.ts` and creates a fresh `progress.md` from a template. With multi-backlog, it should use the state directory:
```typescript
// Before:
const deployResult = deployProgress(ralphDir);

// After:
const deployResult = deployProgress(paths.stateDir);
```

WARNING: Could not verify that `deployProgress` accepts a `stateDir` parameter — currently it takes a `ralphDir: string`. This function may need its signature updated or an adapter. Verify during implementation.

## Dependencies

- `00-core-definitions.md` — `BacklogPaths`, `ActiveRoot`, `SCAN_SKIP_DIRS`, `STATE_FILENAME` constants
- `02-backlog-root-resolution.md` — `resolveBacklogPaths` (callers construct `BacklogPaths` before passing to these modules)
- `fs-utils.ts` — unchanged utilities: `atomicWrite`, `readJsonFile`, `fileExists`, `ensureDir`

## Verification

- [ ] All exported functions in `backlog.ts` accept `BacklogPaths` as first parameter
- [ ] All exported functions in `status.ts` accept `BacklogPaths` as first parameter
- [ ] All exported functions in `iteration-status.ts` accept `BacklogPaths` as first parameter
- [ ] All exported functions in `archive.ts` accept `BacklogPaths` as first parameter
- [ ] `resetProject` in `reset.ts` accepts `BacklogPaths` as first parameter
- [ ] No internal path constants (`BACKLOG_DIR`, `RALPH_DIR`, etc.) remain in refactored modules
- [ ] No internal path helper functions (`getBacklogPath`, `getStatePath`, etc.) remain
- [ ] `scanActiveRoots` returns active roots sorted by relative path
- [ ] `scanActiveRoots` skips `node_modules`, `.git`, `dist`, `build`, `coverage`
- [ ] `scanActiveRoots` completes in under 500ms for 20 roots
- [ ] `selectNextItem` and `validateStatusTransition` signatures are unchanged
- [ ] Iteration status throttle key uses file path, not project path
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (after updating test files to construct `BacklogPaths`)
