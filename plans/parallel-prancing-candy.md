# Fix: `backlog reset --clear` should reset project/description fields

## Context

When running `ralph backlog reset . --yes --clear`, the backlog items are archived and the `items` array is emptied, but the `project` and `description` fields from the previous backlog are preserved. This means a cleared backlog retains stale metadata from a prior run, which is confusing when the user intends a full reset (especially if they're about to repopulate for a different project context).

The current behavior at `packages/core/src/reset.ts:144-157` explicitly preserves these fields via object spread:

```typescript
const writeResult = writeBacklog(resolved, {
  ...backlog,       // <-- preserves project, description
  items: [],
});
```

## Recommended Fix

**File:** `packages/core/src/reset.ts` (lines 144-157)

When `clearBacklog` is true, reset `project` and `description` to empty strings alongside clearing items:

```typescript
const writeResult = writeBacklog(resolved, {
  ...backlog,
  project: '',
  description: '',
  items: [],
});
```

Update the comment on line 144 to reflect the new behavior:
```
// 8. Optionally clear backlog (empty items, reset project/description)
```

**That's it.** Single change, ~3 lines modified in one file.

## Files to Modify

- `packages/core/src/reset.ts` — lines 144-154

## Verification

1. `pnpm typecheck` — ensure no type errors
2. `pnpm test` — run existing tests (check if reset tests exist and whether they assert on preserved fields)
3. Manual test: `ralph backlog reset . --yes --clear` on a project with populated project/description, then inspect `.ralph/backlog.json` to confirm both fields are empty strings
