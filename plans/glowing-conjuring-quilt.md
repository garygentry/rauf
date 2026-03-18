# Plan: Holistic State File Management for Multi-Cycle Workflows

## Context

Ralph projects go through multiple backlog cycles over time. Each cycle generates state files that accumulate:

| File | Growth | Current Size (this repo) | Managed Today? |
|------|--------|--------------------------|----------------|
| `backlog.json` | Per item added | 40 KB | Yes (sweep/reset) |
| `progress.md` | Per iteration (~1-2 KB) | 51 KB | No — never archived or rotated |
| `ralph.log` | Per iteration (~1-5 KB) | Unbounded | No — never archived or rotated |
| `state.json` | Fixed per run | ~500 B | Yes (deleted on reset) |
| `DONE` / `CANCEL` | Fixed | ~50 B | Yes (cleared on reset/startup) |
| `archive/*.json` | Per sweep | 37 KB | Yes (purge command) |

**Problem:** `progress.md` and `ralph.log` grow without bound across cycles. When starting a fresh cycle with `--clear`, stale progress gets fed to agents (wasting context, potentially misleading), and logs from old cycles clutter the audit trail with no rotation.

**Also:** `reset` lives under `backlog` but affects state.json, DONE, CANCEL, and now progress.md — it's really a project-level operation, not a backlog operation.

## Design: Two Tiers of State Management

### Tier 1: `backlog reset --clear` Does the Right Thing (implement now)

When you `--clear` the backlog for a fresh cycle, **all accumulated state should be archived together**. This is the common case — user wants a clean slate.

**`ralph backlog reset --yes`** (no `--clear`):
- Sweep done items → archive
- Reset stalled items → pending
- Clear state.json, DONE, CANCEL
- **progress.md untouched** (same cycle continues)
- **ralph.log untouched** (same cycle continues)

**`ralph backlog reset --clear --yes`** (fresh cycle):
- Everything above, plus:
- Empty backlog items array
- **Archive progress.md** → `.ralph/archive/YYYY-MM-progress.md`, deploy fresh template
- **Archive ralph.log** → `.ralph/archive/YYYY-MM-ralph.log`, start fresh empty log

Opt-out flags for `--clear`:
- `--keep-progress` — preserve progress.md (don't archive)
- `--keep-log` — preserve ralph.log (don't archive)

### Tier 2: Individual File Commands (implement later, backlog item)

For targeted cleanup without a full reset:

```
ralph log rotate <path>           # Archive current log, start fresh
ralph log clear <path> --yes      # Delete log entirely
ralph progress archive <path>     # Archive progress.md, deploy fresh template
ralph progress clear <path> --yes # Delete and redeploy template
```

These are additive — they don't change existing commands and can be built later. The important thing is that `reset --clear` handles the common case now.

## Implementation Plan (Tier 1 only)

### Step 1: Export `deployProgress` from installer.ts

**File:** `packages/core/src/installer.ts:849`

```typescript
export { buildTemplateVars, isCommandInPath, readArtifact, deployProgress };
```

### Step 2: Extend `ResetProjectOptions` and `ResetProjectResult`

**File:** `packages/core/src/reset.ts`

```typescript
export interface ResetProjectOptions {
  clearBacklog?: boolean;
  keepProgress?: boolean;  // opt-out of progress archival when clearing
  keepLog?: boolean;        // opt-out of log archival when clearing
}

export interface ResetProjectResult {
  sweptCount: number;
  sweptMonths: string[];
  stalledResetCount: number;
  stateCleared: boolean;
  doneCleared: boolean;
  cancelCleared: boolean;
  backlogCleared: boolean;
  progressArchived: boolean;
  logArchived: boolean;
}
```

### Step 3: Add progress.md archiving to `resetProject()`

**File:** `packages/core/src/reset.ts`

New step 6 (between clearing markers and clearing backlog):

When `clearBacklog && !keepProgress` and `.ralph/progress.md` exists:
1. `ensureDir(.ralph/archive)`
2. Read content, `atomicWrite` to `.ralph/archive/YYYY-MM-progress.md`
3. `unlinkSync` old file
4. `deployProgress(ralphDir)` for fresh template

### Step 4: Add ralph.log archiving to `resetProject()`

**File:** `packages/core/src/reset.ts`

New step 7 (after progress, before clearing backlog):

When `clearBacklog && !keepLog` and `.ralph/ralph.log` exists:
1. `ensureDir(.ralph/archive)`
2. Rename `.ralph/ralph.log` → `.ralph/archive/YYYY-MM-ralph.log`
3. (No need to create empty log — `appendLog()` creates on first write)

Use `fs.renameSync` (cheaper than read+write for potentially large logs).

### Step 5: Update CLI handler

**File:** `packages/cli/src/backlog-commands.ts`

- Extract `--keep-progress` and `--keep-log` flags
- Pass to `resetProject()` options
- Add output lines:
  ```typescript
  if (r.progressArchived) parts.push("archived progress.md");
  if (r.logArchived) parts.push("archived ralph.log");
  ```
- Update usage string to show new flags

### Step 6: Tests

**File:** `packages/core/src/reset.test.ts`

| Test case | Expected |
|-----------|----------|
| Reset without `--clear` | `progressArchived: false`, `logArchived: false`, files untouched |
| `--clear` with progress.md + ralph.log | Both archived, fresh progress.md deployed, log gone |
| `--clear` without progress.md/log | `false` for both, no error |
| `--clear --keep-progress` | Log archived, progress untouched |
| `--clear --keep-log` | Progress archived, log untouched |

### Step 7: Update docs

**File:** `docs/SPEC-CLI.md` — update `backlog reset` section with new flags and behavior.

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/installer.ts:849` | Export `deployProgress` |
| `packages/core/src/reset.ts` | Extended options/result types, progress + log archiving logic |
| `packages/cli/src/backlog-commands.ts` | New flags, updated output |
| `packages/core/src/reset.test.ts` | ~5 new test cases |
| `docs/SPEC-CLI.md` | Document new flags |

## Key Reuse

- `atomicWrite`, `fileExists`, `ensureDir` from `packages/core/src/fs-utils.ts`
- `deployProgress` from `packages/core/src/installer.ts`
- Archive dir convention from `packages/core/src/archive.ts` (`.ralph/archive/` flat files)
- `appendLog` from `packages/core/src/status.ts` (creates log on first write — no need to create empty)

## Edge Cases

- **No progress.md / log when `--clear`:** skip silently, report `false`
- **Multiple resets same month:** `atomicWrite` overwrites previous archive (most recent wins)
- **Archive dir doesn't exist:** `ensureDir` creates it
- **Large log file:** `renameSync` is O(1), no read/write needed
- **Log file in use by running loop:** `reset` should not be called while loop is running (existing guard)

## Archive Naming Convention

All archive files live flat in `.ralph/archive/`:
```
.ralph/archive/
├── 2026-01.json              # swept backlog items (existing)
├── 2026-02.json              # swept backlog items (existing)
├── 2026-03-progress.md       # archived progress (new)
└── 2026-03-ralph.log         # archived log (new)
```

## Verification

```bash
pnpm typecheck && pnpm test
ralph backlog reset . --clear --yes
ls .ralph/archive/                     # YYYY-MM-progress.md + YYYY-MM-ralph.log
cat .ralph/progress.md                 # fresh template
test ! -f .ralph/ralph.log             # log removed (recreated on next loop)
```
