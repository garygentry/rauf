# 07 — Testing Strategy

Test approach, shared helpers, unit and integration test scenarios, and test-sandbox updates for multi-backlog.

## Requirement Coverage

| REQ ID          | Requirement                | Section                  |
| --------------- | -------------------------- | ------------------------ |
| REQ-ROOT-01–04  | Backlog root concept       | 3.1 backlog-root.test.ts |
| REQ-STATE-01–04 | State directory resolution | 3.1 backlog-root.test.ts |
| REQ-LOCK-01–05  | Lock file mechanism        | 3.2 lock.test.ts         |
| REQ-CLI-01–04   | --backlog flag             | 4. Integration Tests     |
| REQ-STATUS-01   | Active root scanning       | 3.3 status.test.ts       |
| REQ-REL-01–03   | Reliability requirements   | 3.1, 3.2, 3.4            |

## 1. Framework and Conventions

- **Framework:** Vitest (existing project convention)
- **Test location:** Colocated with source as `*.test.ts`
- **Assertions:** Vitest `expect`, `describe`/`it` blocks
- **Filesystem:** Real temp directories via `fs.mkdtempSync` (no mocking `node:fs`)
- **Cleanup:** Each test creates a temp dir and removes it in `afterEach`

## 2. Shared Test Helper

**File:** `packages/core/src/test-helpers.ts` (NOT exported from barrel — test-only)

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Backlog, LoopState } from "./schemas.js";

interface BacklogRootConfig {
  /** Relative path from project root (e.g., "specs/auth", ".ralph") */
  path: string;
  /** Backlog content. If omitted, creates a minimal empty backlog */
  backlog?: Partial<Backlog>;
  /** State.json content. If omitted, no state.json is created */
  state?: Partial<LoopState>;
  /** Whether to create a RALPH.md in this root's state dir */
  hasRalphMd?: boolean;
  /** Whether to create a REVIEW.md in this root's state dir */
  hasReviewMd?: boolean;
  /** Whether to place backlog.json in the root (true) or stateDir (false). Default: true */
  backlogInRoot?: boolean;
}

interface MultiRootProject {
  /** Absolute path to the temporary project root */
  projectPath: string;
  /** Remove the temp directory and all contents */
  cleanup: () => void;
}

/**
 * Create a temporary project directory with multi-root structure.
 *
 * Always creates:
 * - .ralph.json marker file
 * - .ralph/ default root with empty backlog.json
 * - .ralph/RALPH.md (project-level instructions)
 *
 * Additional roots are created per the `roots` array. For each root:
 * - Creates the root directory
 * - Creates .ralph/ state subdirectory (unless root IS .ralph/)
 * - Writes backlog.json (in root or stateDir per backlogInRoot flag)
 * - Optionally writes state.json, RALPH.md, REVIEW.md
 *
 * @param options - Root configurations (default root is always created)
 * @returns Project path and cleanup function
 */
export function createMultiRootProject(options?: {
  roots?: BacklogRootConfig[];
}): MultiRootProject {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-test-"));

  // Create .ralph.json marker
  fs.writeFileSync(
    path.join(projectPath, ".ralph.json"),
    JSON.stringify({
      ralph: true,
      version: "0.1.0",
      variant: "backlog-json",
      installedAt: new Date().toISOString(),
      installedBy: "test",
      profile: {
        stack: "typescript",
        packageManager: "pnpm",
        monorepo: false,
        commands: { test: null, typecheck: null, lint: null, build: null, format: null },
        verify: "echo ok",
      },
      artifactHashes: {},
      options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
    }),
  );

  // Create default root (.ralph/) with empty backlog and RALPH.md
  const defaultDir = path.join(projectPath, ".ralph");
  fs.mkdirSync(defaultDir, { recursive: true });
  writeBacklogFile(path.join(defaultDir, "backlog.json"), {
    project: "test",
    description: "",
    items: [],
  });
  fs.writeFileSync(path.join(defaultDir, "RALPH.md"), "# Default RALPH.md\n");

  // Create additional roots
  for (const root of options?.roots ?? []) {
    if (root.path === ".ralph") continue; // default already created

    const rootDir = path.join(projectPath, root.path);
    fs.mkdirSync(rootDir, { recursive: true });

    // Determine state dir
    const stateDir = path.basename(rootDir) === ".ralph" ? rootDir : path.join(rootDir, ".ralph");
    fs.mkdirSync(stateDir, { recursive: true });

    // Write backlog.json
    const backlogContent: Backlog = {
      project: root.backlog?.project ?? "test",
      description: root.backlog?.description ?? "",
      items: root.backlog?.items ?? [],
    };
    const backlogLocation =
      (root.backlogInRoot ?? true)
        ? path.join(rootDir, "backlog.json")
        : path.join(stateDir, "backlog.json");
    writeBacklogFile(backlogLocation, backlogContent);

    // Write state.json if provided
    if (root.state) {
      const stateContent: LoopState = {
        status: "idle",
        iteration: 0,
        maxIterations: 20,
        currentItem: null,
        lastSignal: null,
        startedAt: null,
        updatedAt: null,
        completedItems: [],
        blockedItems: [],
        error: null,
        ...root.state,
      };
      fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify(stateContent, null, 2));
    }

    // Write instruction files if requested
    if (root.hasRalphMd) {
      fs.writeFileSync(path.join(stateDir, "RALPH.md"), `# RALPH.md for ${root.path}\n`);
    }
    if (root.hasReviewMd) {
      fs.writeFileSync(path.join(stateDir, "REVIEW.md"), `# REVIEW.md for ${root.path}\n`);
    }
  }

  return {
    projectPath,
    cleanup: () => fs.rmSync(projectPath, { recursive: true, force: true }),
  };
}

function writeBacklogFile(filePath: string, backlog: Backlog): void {
  fs.writeFileSync(filePath, JSON.stringify(backlog, null, 2) + "\n");
}
```

## 3. Unit Tests by Module

### 3.1 `backlog-root.test.ts`

**File:** `packages/core/src/backlog-root.test.ts`

| Test Case                                                       | Expected                                        |
| --------------------------------------------------------------- | ----------------------------------------------- |
| `resolveBacklogRoot` — no flag → returns `.ralph` default       | `{projectPath}/.ralph`                          |
| `resolveBacklogRoot` — `"specs/auth"` → correct absolute path   | `{projectPath}/specs/auth`                      |
| `resolveBacklogRoot` — `"../../outside"` → PATH_VIOLATION       | error with PATH_VIOLATION code                  |
| `resolveBacklogRoot` — empty string → returns `.ralph` default  | `{projectPath}/.ralph`                          |
| `resolveStateDir` — `.ralph` basename → same directory          | No nesting                                      |
| `resolveStateDir` — `specs/auth` → `specs/auth/.ralph`          | Subdirectory created                            |
| `resolveBacklogPaths` — backlog.json in root dir                | `paths.backlog` points to root/backlog.json     |
| `resolveBacklogPaths` — backlog.json in stateDir only           | `paths.backlog` points to stateDir/backlog.json |
| `resolveBacklogPaths` — no backlog.json → FILE_NOT_FOUND        | Error returned                                  |
| `resolveBacklogPaths` — root dir doesn't exist → FILE_NOT_FOUND | Error returned                                  |
| `resolveBacklogPaths` — all path fields are absolute            | Every field starts with `/`                     |
| `resolveInstructionPaths` — RALPH.md in per-root stateDir       | Uses per-root path                              |
| `resolveInstructionPaths` — RALPH.md only at project level      | Falls back to project `.ralph/`                 |
| `resolveInstructionPaths` — RALPH.md missing everywhere         | Returns `null`                                  |
| `resolveInstructionPaths` — default root (no fallback needed)   | Uses `.ralph/RALPH.md` directly                 |
| `ensureStateDir` — creates directory with parents               | Directory exists after call                     |
| `ensureStateDir` — existing directory → no-op                   | Returns ok                                      |

### 3.2 `lock.test.ts`

**File:** `packages/core/src/lock.test.ts`

| Test Case                                            | Expected                                               |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `acquireLock` — fresh state dir                      | Creates .loop.lock with pid/startedAt/processStartTime |
| `acquireLock` — already locked by current (live) PID | Returns LOCK_CONFLICT                                  |
| `acquireLock` — locked by dead PID                   | Removes stale lock, acquires new one                   |
| `acquireLock` — corrupt lock file                    | Treats as stale, acquires                              |
| `releaseLock` — lock exists                          | Removes file                                           |
| `releaseLock` — no lock file                         | Returns ok (idempotent)                                |
| `checkLock` — no lock file                           | `{ locked: false }`                                    |
| `checkLock` — live PID                               | `{ locked: true, stale: false }`                       |
| `checkLock` — dead PID                               | `{ locked: true, stale: true }`                        |
| `checkLock` — corrupt file                           | `{ locked: true, stale: true }`                        |
| `forceClearLock` — any lock state                    | File removed                                           |
| Lock file JSON is valid                              | Parses against LockFileContentSchema                   |

**Testing PID liveness:** Use `process.pid` (current process, always alive) and PID `999999999` (almost certainly dead) for reliable tests.

### 3.3 `status.test.ts` — `scanActiveRoots` Tests

| Test Case                                     | Expected                              |
| --------------------------------------------- | ------------------------------------- |
| Project with no active roots                  | Returns empty array                   |
| Project with 1 active root (running) + 2 idle | Returns 1 root                        |
| Project with 3 active roots                   | Returns all 3, sorted by relativePath |
| Scan skips `node_modules/`                    | No roots from node_modules            |
| Scan skips `.git/`                            | No roots from .git                    |
| Missing/corrupt state.json                    | Skipped gracefully, no error          |
| Root with `.loop.lock` but no state.json      | Detected as active                    |

### 3.4 Existing Test Updates

All existing tests for `backlog.ts`, `status.ts`, `iteration-status.ts`, `archive.ts`, and `reset.ts` must be updated:

**Pattern:**

```typescript
// Before (many existing tests):
const result = readBacklog(projectPath);

// After:
const paths = resolveBacklogPaths(projectPath, path.join(projectPath, ".ralph"));
expect(paths.ok).toBe(true);
if (!paths.ok) throw new Error("unexpected");
const result = readBacklog(paths.value);
```

**Simplification:** Use `createMultiRootProject()` from `test-helpers.ts` for setup:

```typescript
import { createMultiRootProject } from "./test-helpers.js";

let project: ReturnType<typeof createMultiRootProject>;

beforeEach(() => {
  project = createMultiRootProject();
});

afterEach(() => {
  project.cleanup();
});
```

**Add parallel tests for non-default roots:** Each test file should include at least one test that operates on a non-default backlog root (e.g., `specs/auth`) to verify path isolation:

```typescript
it("operates on non-default root", () => {
  const project = createMultiRootProject({
    roots: [
      { path: "specs/auth", backlog: { project: "auth", description: "Auth feature", items: [] } },
    ],
  });
  const paths = resolveBacklogPaths(
    project.projectPath,
    path.join(project.projectPath, "specs/auth"),
  );
  expect(paths.ok).toBe(true);
  // ... test against this root ...
  project.cleanup();
});
```

### 3.5 `prompt-builder.test.ts` Updates

| Test Case                                     | Expected                     |
| --------------------------------------------- | ---------------------------- |
| RALPH.md from per-root stateDir               | Uses per-root content        |
| RALPH.md fallback to project-level            | Uses project-level content   |
| Missing RALPH.md → error                      | FILE_NOT_FOUND returned      |
| progress.md always from stateDir              | No fallback to project-level |
| "Active Backlog Root" section in prompt       | Contains root relative path  |
| Review prompt uses per-root REVIEW.md         | Per-root takes precedence    |
| Review prompt falls back to embedded template | When no REVIEW.md exists     |

## 4. Integration Tests

### 4.1 CLI Integration

These test the full CLI flow from flag parsing through core execution:

| Test Case            | Command                                         | Expected                                   |
| -------------------- | ----------------------------------------------- | ------------------------------------------ |
| Default backlog root | `ralph backlog list .`                          | Lists items from `.ralph/backlog.json`     |
| Custom backlog root  | `ralph backlog list . --backlog specs/auth`     | Lists items from `specs/auth/backlog.json` |
| Invalid backlog root | `ralph backlog list . --backlog ../../outside`  | PATH_VIOLATION error                       |
| Lock conflict        | Two `ralph loop run . --backlog specs/auth`     | Second returns error                       |
| Force override       | `ralph loop run . --backlog specs/auth --force` | Clears lock, proceeds                      |
| Status all roots     | `ralph status .`                                | Shows default + active non-default         |
| Status specific root | `ralph status . --backlog specs/auth`           | Shows only that root                       |

### 4.2 Test-Sandbox Updates

**File:** `test-sandbox/`

Add a scenario that runs against a non-default backlog root:

1. Create `test-sandbox/scenarios/multi-backlog/` with:
   - `specs/feature-a/backlog.json` — backlog with 1-2 simple items
   - `specs/feature-a/.ralph/` — empty state dir (or none, to test auto-creation)
2. Update `test-sandbox/run.sh` to accept `--backlog` flag:
   ```bash
   bash test-sandbox/run.sh stream-done --backlog specs/feature-a
   ```
3. Add to `test-sandbox/verify.sh`:
   - Verify state files written to `specs/feature-a/.ralph/` (not `.ralph/`)
   - Verify `.loop.lock` created and cleaned up
   - Verify `progress.md` written to `specs/feature-a/.ralph/progress.md`

## 5. Coverage Targets

| Module                                   | Target                     | Notes                                                    |
| ---------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `backlog-root.ts`                        | 95%+                       | All paths are critical                                   |
| `lock.ts`                                | 90%+                       | PID recycling detection may be hard to test on non-Linux |
| `status.ts` (scanActiveRoots)            | 85%+                       | Filesystem walking edge cases                            |
| Updated modules (backlog, archive, etc.) | Maintain existing coverage | Just signature changes                                   |
| prompt-builder.ts                        | 85%+                       | Fallback logic is critical                               |

## Dependencies

- `00-core-definitions.md` — types used in test helper
- All other spec docs — tests verify their contracts

## Verification

- [ ] `packages/core/src/test-helpers.ts` exists and creates valid multi-root project structure
- [ ] `test-helpers.ts` is NOT exported from the barrel
- [ ] `backlog-root.test.ts` covers all resolution paths (default, custom, error)
- [ ] `lock.test.ts` covers acquire, release, stale detection, force clear
- [ ] `scanActiveRoots` tests cover empty, active, skip dirs, graceful error handling
- [ ] All existing tests pass after updating to use `BacklogPaths`
- [ ] At least one test per module operates on a non-default root
- [ ] prompt-builder tests verify RALPH.md fallback and "Active Backlog Root" section
- [ ] `pnpm test` passes with no failures
- [ ] Test sandbox supports `--backlog` flag
