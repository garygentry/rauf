# Plan: `ralph backlog reset` Command

## Context

There's no way to reset a project's loop state after a backlog cycle completes. The DONE marker, state.json, and stalled items remain, blocking a fresh `ralph loop run`. Users must manually delete files. This command automates that cleanup: sweep done items to archive, clear loop state, and optionally empty the backlog for repopulation.

## Implementation

### Step 1: Core function — `packages/core/src/reset.ts` (NEW)

Create `resetProject()` that orchestrates existing functions:

```typescript
export interface ResetProjectOptions {
  clearBacklog?: boolean;
}

export interface ResetProjectResult {
  sweptCount: number;
  sweptMonths: string[];
  stalledResetCount: number;
  stateCleared: boolean;
  doneCleared: boolean;
  cancelCleared: boolean;
  backlogCleared: boolean;
}

export function resetProject(
  projectPath: string,
  options?: ResetProjectOptions,
): Result<ResetProjectResult>
```

Sequential steps:
1. `sweepBacklog(projectPath)` — archive all done items (no min-age filter)
2. `resetStalledItems(projectPath)` — flip in_progress → pending
3. Delete `.ralph/state.json` (unlink, swallow ENOENT)
4. `clearDoneFile(projectPath)`
5. `clearCancelFile(projectPath)`
6. If `clearBacklog`: read backlog, write back with empty `items` array (preserve `project`/`description` fields)
7. Return composite result

Reuses: `sweepBacklog` (archive.ts), `resetStalledItems` (backlog.ts), `clearDoneFile`/`clearCancelFile` (status.ts), `readBacklog`/`writeBacklog` (backlog.ts).

### Step 2: Export from `packages/core/src/index.ts`

Add `export * from "./reset.js";`

### Step 3: CLI handler — `packages/cli/src/backlog-commands.ts`

Add `handleBacklogReset`:

```
Usage: ralph backlog reset <path> [--clear] [--yes] [--json]
```

- `--yes` — required for confirmation (consistent with sweep/delete/purge)
- `--clear` — also empty backlog.json items array
- `--json` — output ResetProjectResult as JSON

Handler: parse flags → validate → call `resetProject()` → format output → return ExitCode.

### Step 4: Register command — `packages/cli/src/commands.ts`

Add to backlog subcommands array (line ~173):
```typescript
{ name: "reset", description: "Reset project state for a fresh backlog cycle", handler: handleBacklogReset },
```

Import `handleBacklogReset` from `./backlog-commands.js`.

### Step 5: Tests

**`packages/core/src/reset.test.ts`** (NEW):
- Happy path: done items swept, in_progress reset, markers cleared
- With `clearBacklog: true`: backlog emptied, metadata preserved
- Idempotent: no state files exist, still succeeds
- No backlog file: returns error

**`packages/cli/src/backlog-commands.test.ts`** (ADD):
- Missing path → INVALID_ARGS
- Missing --yes → INVALID_ARGS with guidance
- Happy path → SUCCESS
- With --clear → backlog emptied

## Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/reset.ts` | NEW — `resetProject()` |
| `packages/core/src/index.ts` | Add export |
| `packages/cli/src/backlog-commands.ts` | Add `handleBacklogReset` handler |
| `packages/cli/src/commands.ts` | Register subcommand + import |
| `packages/core/src/reset.test.ts` | NEW — core tests |
| `packages/cli/src/backlog-commands.test.ts` | Add CLI handler tests |

## Verification

```bash
pnpm typecheck          # No type errors
pnpm test               # All tests pass (existing + new)
ralph backlog reset . --yes   # Clears state, sweeps done items
ralph status .           # Shows idle/clean state
ralph backlog list .     # Shows remaining pending/blocked items
ralph backlog reset . --clear --yes  # Also empties backlog
ralph backlog list .     # Shows 0 items
```
