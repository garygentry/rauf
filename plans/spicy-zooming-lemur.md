# Plan: Loop Recovery — `backlog unblock` Command + Retry UX

## Context

When the loop exhausts retries for an item (e.g., signal detection fails 3 times), the item is marked `blocked` and the loop ends. Recovery currently requires manually editing item status (`ralph backlog edit . 001 --status pending`) or the nuclear `ralph backlog reset`. There's no middle ground.

This was exposed when a signal-parsing bug caused item 001 to block — everything depended on it, so the entire loop stalled. Even after fixing the root cause, the user had to manually reset backlog status, delete DONE, etc. to re-run.

**Design decision:** Blocked items should still require deliberate intervention (the loop blocked them for a reason). But the UX should make recovery trivial.

## Changes

### 1. Core: `unblockItems()` function

**File:** `packages/core/src/backlog.ts`

Add exported function:

```typescript
export function unblockItems(
  projectPath: string,
  itemId?: string,
): Result<{ unblockedCount: number; unblockedIds: string[] }>
```

- If `itemId` provided: find that item, verify `status === "blocked"`, set to `pending`, clear `blockedReason`
- If no `itemId`: find ALL blocked items, transition each to `pending`, clear `blockedReason`
- Single atomic write (not per-item)
- Error if item not found or not blocked

**Important:** `updateItem()` doesn't clear `blockedReason` when transitioning — it only sets explicitly provided fields. `unblockItems` must explicitly delete `blockedReason` from the item.

**Tests** in `packages/core/src/backlog.test.ts`:
- Unblock single item (blocked → pending, blockedReason cleared)
- Unblock all blocked items
- Error on non-blocked item
- Error on non-existent item
- Zero blocked items returns success with count 0

### 2. CLI: `ralph backlog unblock` command

**File:** `packages/cli/src/backlog-commands.ts`

Add `handleBacklogUnblock(ctx: CommandContext): Promise<number>`.

Usage: `ralph backlog unblock <path> [id]`
- With `id`: unblock specific item
- Without `id`: unblock all blocked items
- Supports `--json` output
- No `--yes` needed (unblocking is safe/additive)

**File:** `packages/cli/src/commands.ts`

Add to backlog subcommands array and import:
```typescript
{ name: "unblock", description: "Unblock items for retry", handler: handleBacklogUnblock }
```

### 3. CLI: `--retry-blocked` flag on `ralph loop run`

**File:** `packages/cli/src/loop-commands.ts`

In `handleLoopRun`, before creating `LoopRunner`:

```typescript
const retryBlocked = extractBoolFlag(ctx.flags, "retry-blocked");
if (retryBlocked) {
  const result = unblockItems(projectPath);
  if (result.ok && result.value.unblockedCount > 0) {
    info(`Unblocked ${result.value.unblockedCount} items: ${result.value.unblockedIds.join(", ")}`);
  }
}
```

This is a CLI-layer concern — the runner just reads the backlog. Also add to `handleLoopStart` for server mode.

### 4. Improved completion output when blocked

**File:** `packages/cli/src/loop-commands.ts`

After the existing "Loop finished" line (~line 691), when `result.blockedCount > 0`:

```
✓ Loop finished: 0 completed, 1 blocked

  To retry blocked items:
    ralph backlog unblock .     # then re-run
    ralph loop run . --retry-blocked  # or in one step
```

Also in `formatAndPrintEvent` for `loop_completed` event when `blockedCount > 0`, add the hint.

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/backlog.ts` | Add `unblockItems()` |
| `packages/core/src/backlog.test.ts` | Tests for `unblockItems()` |
| `packages/cli/src/backlog-commands.ts` | Add `handleBacklogUnblock` |
| `packages/cli/src/commands.ts` | Register `unblock` subcommand + import |
| `packages/cli/src/loop-commands.ts` | Add `--retry-blocked` flag + recovery hints in output |

## What NOT to change

- No changes to runner loop logic or status transitions (already correct)
- No auto-retry in the runner — blocked requires deliberate action
- No changes to `resetProject` — it remains the nuclear option

## Verification

1. `pnpm test` — all existing tests pass
2. Create a blocked item: `ralph backlog edit . 001 --status blocked`
3. `ralph backlog unblock . 001` — verify item goes to pending, blockedReason cleared
4. `ralph backlog unblock .` — verify all blocked items unblocked
5. `ralph loop run . --retry-blocked` — verify blocked items are unblocked before loop starts
6. Run loop to completion with blocked items — verify recovery hints appear in output
