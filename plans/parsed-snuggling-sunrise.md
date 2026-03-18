# Plan: Handle missing backlog.json gracefully in backlog commands

## Context

When `backlog.json` doesn't exist but ralph IS installed (`.ralph/` dir exists), commands like `backlog reset --clear` fail with "Ralph is not installed here." This is wrong — the project has ralph installed, it just doesn't have a backlog file yet. The fix should create an empty `backlog.json` on the fly rather than erroring out.

## Approach

Add a core function `ensureBacklog()` that checks if `.ralph/` exists and creates a default empty `backlog.json` if it's missing. Use this in `resetProject()` and potentially other backlog commands.

### Changes

**1. `packages/core/src/backlog.ts` — Add `ensureBacklog()` function**

```typescript
export function ensureBacklog(projectPath: string): Result<void> {
  const resolved = path.resolve(projectPath);
  const ralphDir = path.join(resolved, BACKLOG_DIR);
  const backlogPath = getBacklogPath(projectPath);

  // If backlog already exists, nothing to do
  if (fileExists(backlogPath)) return ok(undefined);

  // If .ralph/ dir doesn't exist, ralph is genuinely not installed
  if (!fileExists(ralphDir)) {
    return err({
      code: ErrorCodes.NOT_INSTALLED,
      message: `Ralph is not installed at ${resolved}`,
    });
  }

  // .ralph/ exists but backlog.json doesn't — create empty one
  // Try to read project name from .ralph.json marker
  const markerResult = readMarkerFile(projectPath);
  const projectName = markerResult.ok ? markerResult.value.project : path.basename(resolved);

  const emptyBacklog: Backlog = {
    project: projectName,
    description: "",
    items: [],
  };

  return writeBacklog(projectPath, emptyBacklog);
}
```

**2. `packages/core/src/reset.ts` — Call `ensureBacklog()` before sweep/reset**

At the top of `resetProject()`, before step 1 (sweep), add:

```typescript
const ensureResult = ensureBacklog(resolved);
if (!ensureResult.ok) return ensureResult;
```

This way `sweepBacklog` and `resetStalledItems` will find a valid (empty) backlog.

**3. `packages/cli/src/backlog-commands.ts` — Better error differentiation**

Update `handleCoreError` to distinguish `NOT_INSTALLED` from `FILE_NOT_FOUND`:
- `NOT_INSTALLED` → "Ralph is not installed here. Run: ralph install ..."
- `FILE_NOT_FOUND` → more specific message about the missing file

### Files to modify

- `packages/core/src/backlog.ts` — add `ensureBacklog()`, export it
- `packages/core/src/reset.ts` — call `ensureBacklog()` at start of `resetProject()`
- `packages/core/src/index.ts` — export `ensureBacklog` if not already re-exported
- `packages/core/src/backlog.test.ts` — add tests for `ensureBacklog()`
- `packages/core/src/reset.test.ts` — add test for reset with missing backlog.json

### Consideration: Other backlog commands

The same issue likely affects `backlog list`, `backlog add`, etc. when backlog.json is missing. We should consider whether those should also auto-create. The `reset --clear` case is the most obvious since it's explicitly about starting fresh. For now, scope to `resetProject` only — other commands can be addressed separately if needed.

## Verification

1. `pnpm test` — all existing tests pass
2. `pnpm typecheck` — no type errors
3. Manual test: create a `.ralph/` dir without `backlog.json`, run `ralph backlog reset . --yes --clear` — should succeed and create empty backlog
