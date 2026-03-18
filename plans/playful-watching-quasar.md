# Plan: Timestamp-based archive naming for progress.md and ralph.log

## Context

When `ralph backlog reset --clear` archives `progress.md` and `ralph.log`, the archive filenames use only **YYYY-MM** granularity (e.g., `2026-03-progress.md`, `2026-03-ralph.log`). Since ralph loops often correspond to discrete feature sets and multiple resets can occur in a single day (or month), a second reset **silently overwrites** the previous archive — losing data.

Backlog item archives (`YYYY-MM.json`) are unaffected because they **merge** items into existing files. But progress and log archives are simple file copies/renames with no merge logic.

**Goal:** Switch to timestamp-based naming so each reset creates a unique archive file, preserving all history.

## Current behavior

| File | Archive name | Collision behavior |
|------|-------------|-------------------|
| Backlog items | `YYYY-MM.json` | **Merge** (safe) |
| progress.md | `YYYY-MM-progress.md` | **Overwrite** (data loss) |
| ralph.log | `YYYY-MM-ralph.log` | **Overwrite** (data loss) |

## Proposed change

Switch progress.md and ralph.log archive names to use ISO timestamp:

| File | New archive name | Example |
|------|-----------------|---------|
| progress.md | `YYYYMMDD-HHmmss-progress.md` | `20260317-143052-progress.md` |
| ralph.log | `YYYYMMDD-HHmmss-ralph.log` | `20260317-143052-ralph.log` |

The format `YYYYMMDD-HHmmss` is compact, sorts chronologically, avoids colons (filesystem-safe), and makes collisions virtually impossible.

Backlog item archives (`YYYY-MM.json`) remain unchanged — their merge behavior already handles multiple resets correctly.

## Files to modify

1. **`packages/core/src/reset.ts`** (lines 87, 93, 111, 116)
   - Extract a shared timestamp string at the top of the function
   - Replace `${currentMonth}-progress.md` → `${timestamp}-progress.md`
   - Replace `${currentMonth}-ralph.log` → `${timestamp}-ralph.log`

2. **`packages/core/src/reset.test.ts`** (lines 184-186, 234-236)
   - Update archive filename assertions to match the new pattern
   - Use regex or glob-style matching since exact timestamp is unpredictable in tests

## Implementation details

### Timestamp helper (inline in reset.ts)

```typescript
// Compact, filesystem-safe timestamp: 20260317-143052
function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
```

Compute once at the start of `resetProject()` so progress and log get the same timestamp.

### reset.ts changes

Replace the two `currentMonth` usages (lines 87, 111) with a single `archiveTimestamp()` call at function start. The archive path patterns change from:
- `${currentMonth}-progress.md` → `${ts}-progress.md`
- `${currentMonth}-ralph.log` → `${ts}-ralph.log`

### Test updates

Since timestamps are non-deterministic, tests should:
- List archive directory files and assert a single match for the pattern `*-progress.md` / `*-ralph.log`
- Verify the matched file has expected content
- A helper like `findArchiveFile(dir, suffix)` can scan for files ending in the suffix

## Verification

```bash
pnpm test -- packages/core/src/reset.test.ts   # Updated tests pass
pnpm test                                        # Full suite still green
pnpm typecheck                                   # No type errors
```

Manual test: run `ralph backlog reset --clear .` twice on a test project and confirm two separate archive files appear.
