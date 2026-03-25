# 01 — Architecture Layout

Directory structure, new module locations, barrel exports, and module dependency graph for multi-backlog.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ARCH-01 | Path resolution derived from backlog root parameter | 1. New Modules |
| REQ-ARCH-02 | Core is single source of path resolution | 2. Module Dependency Graph |
| REQ-ROOT-04 | Default root is not special-cased in the model | 1. New Modules |

## 1. New Modules

Two new source files are added to `packages/core/src/`:

```
packages/core/src/
  backlog-root.ts          # NEW — BacklogPaths resolution, state dir detection, instruction fallback
  backlog-root.test.ts     # NEW — Unit tests
  lock.ts                  # NEW — Lock file acquire/release/check
  lock.test.ts             # NEW — Unit tests
  test-helpers.ts          # NEW — createMultiRootProject() shared test fixture (not exported from barrel)
```

No new packages are created. No new directories outside existing package boundaries.

## 2. Module Dependency Graph

After multi-backlog, the internal dependency structure of `packages/core/src/` is:

```
backlog-root.ts
  ├── imports: fs-utils.ts (fileExists, validatePath, ensureDir)
  ├── imports: errors.ts (Result, ok, err, ErrorCodes)
  └── exports: BacklogPaths, InstructionPaths, resolveBacklogRoot, resolveStateDir,
               resolveBacklogPaths, resolveInstructionPaths, ensureStateDir

lock.ts
  ├── imports: fs-utils.ts (atomicWrite, fileExists)
  ├── imports: errors.ts (Result, ok, err, ErrorCodes)
  ├── imports: backlog-root.ts (BacklogPaths — type only)
  └── exports: LockFileContent, LockFileContentSchema, LockStatus,
               acquireLock, releaseLock, checkLock, forceClearLock

backlog.ts
  ├── imports: backlog-root.ts (BacklogPaths — type only)  # CHANGED: was self-contained
  └── (all functions change first param from projectPath to paths: BacklogPaths)

status.ts
  ├── imports: backlog-root.ts (BacklogPaths, ActiveRoot — types)  # CHANGED
  └── (all functions change first param; adds scanActiveRoots)

iteration-status.ts
  ├── imports: backlog-root.ts (BacklogPaths — type only)  # CHANGED
  └── (all functions change first param)

archive.ts
  ├── imports: backlog-root.ts (BacklogPaths — type only)  # CHANGED
  └── (all functions change first param)

reset.ts
  ├── imports: backlog-root.ts (BacklogPaths — type only)  # CHANGED
  └── (all functions change first param)
```

Consumer packages:

```
packages/loop/src/runner.ts
  ├── imports: @ralph/core (BacklogPaths, resolveBacklogPaths, acquireLock, releaseLock)
  └── Constructs BacklogPaths in constructor, threads through all core calls

packages/loop/src/prompt-builder.ts
  ├── imports: @ralph/core (BacklogPaths, InstructionPaths)
  └── Receives BacklogPaths + InstructionPaths, no longer constructs paths internally

packages/cli/src/loop-commands.ts
  ├── imports: @ralph/core (resolveBacklogRoot, resolveBacklogPaths)
  └── Extracts --backlog flag, resolves paths at entry point

packages/cli/src/backlog-commands.ts
  ├── imports: @ralph/core (resolveBacklogRoot, resolveBacklogPaths)
  └── Same pattern as loop-commands

packages/cli/src/status-commands.ts
  ├── imports: @ralph/core (resolveBacklogRoot, resolveBacklogPaths, scanActiveRoots)
  └── Calls scanActiveRoots when no --backlog flag

packages/web/src/server/routes/loop.ts
  ├── imports: @ralph/core (resolveBacklogRoot, resolveBacklogPaths)
  └── Resolves backlogRoot from request body/query param

packages/web/src/server/loop-manager.ts
  └── Re-keys activeLoops map from projectPath to backlogRoot
```

## 3. Barrel Export Changes

`packages/core/src/index.ts` gains two new re-exports:

```typescript
// @ralph/core — Shared business logic

export const VERSION = "0.1.0";

export * from "./schemas.js";
export * from "./errors.js";
export * from "./fs-utils.js";
export * from "./discovery.js";
export * from "./config.js";
export * from "./profile.js";
export * from "./template.js";
export * from "./claude-md.js";
export * from "./backlog-root.js"; // NEW
export * from "./lock.js";         // NEW
export * from "./backlog.js";
export * from "./archive.js";
export * from "./status.js";
export * from "./installer.js";
export * from "./greenfield.js";
export * from "./reset.js";
export * from "./embedded-artifacts.js";
export * from "./iteration-status.js";
```

**Order matters:** `backlog-root.js` and `lock.js` are exported before `backlog.js` and `status.js` because the latter modules import types from the former. The barrel re-export order doesn't affect runtime behavior (TypeScript resolves imports at the module level), but it communicates the dependency direction to readers.

`test-helpers.ts` is intentionally NOT exported from the barrel — it is imported directly by test files via relative paths.

## 4. No Build or Config Changes

- No new `package.json` files
- No `tsconfig.json` changes (new `.ts` files are auto-included by the existing `include` patterns)
- No new external dependencies
- No changes to `pnpm-workspace.yaml`

## Dependencies

- `00-core-definitions.md` — types defined there are implemented in the modules listed here

## Verification

- [ ] `packages/core/src/backlog-root.ts` exists and exports `BacklogPaths`, `InstructionPaths`, `resolveBacklogRoot`, `resolveStateDir`, `resolveBacklogPaths`, `resolveInstructionPaths`, `ensureStateDir`
- [ ] `packages/core/src/lock.ts` exists and exports `LockFileContent`, `LockFileContentSchema`, `LockStatus`, `acquireLock`, `releaseLock`, `checkLock`, `forceClearLock`
- [ ] `packages/core/src/test-helpers.ts` exists but is NOT in the barrel export
- [ ] `packages/core/src/index.ts` re-exports both new modules
- [ ] `pnpm typecheck` passes with no errors
- [ ] No circular dependencies between new and existing modules
