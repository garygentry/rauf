# Plan: Relax Backlog Schema & Improve Compliance

## Context

The `create-ralph-backlog` skill (and potentially other agents) generates backlog.json files that don't conform to ralph's strict `BacklogItemSchema`. The starter-kitchen-sink-bun project's backlog has three violations:

1. **IDs like `"notif-001"`** — schema requires `/^\d{3,}$/` (pure digits)
2. **Missing `completedAt`** — schema requires it (nullable, but must be present)
3. **`dependencies` instead of `dependsOn`** — wrong field name

Since we can't guarantee agent compliance, the schema needs to be more forgiving, while still encouraging best practices through skills and documentation.

---

## Step 1: Relax `BacklogItemIdSchema`

**File:** `packages/core/src/schemas.ts` (line 12)

Change the ID regex from `/^\d{3,}$/` to allow alphanumeric IDs with optional prefixes:

```typescript
export const BacklogItemIdSchema = z.string().min(1, "ID must be non-empty");
```

Rationale: IDs are used as opaque string keys everywhere (Set lookups, Map keys, localeCompare sorting, commit messages). The only place that parses them numerically is `addItem()` in core, which auto-generates IDs — and that code already handles NaN gracefully since `parseInt("notif-001", 10)` returns `NaN` which loses the `> max` comparison, falling back to 0.

**However**, `addItem()` needs a small fix to handle mixed ID formats — if existing IDs are non-numeric, `parseInt` returns `NaN`. The `reduce` already handles this (NaN > 0 is false, so max stays), but we should add a comment for clarity. The generated next ID will be `"001"` which is fine — ralph-generated IDs are numeric, externally-created ones can be anything.

## Step 2: Make `completedAt` optional

**File:** `packages/core/src/schemas.ts` (line 36)

Change:
```typescript
completedAt: z.string().nullable(),
```
To:
```typescript
completedAt: z.string().nullable().optional(),
```

**Impact check — places that access `completedAt`:**
- `packages/core/src/backlog.ts` `updateItem()` (line 248-251): Sets `completedAt` when status→done. No issue — it writes, doesn't read existing.
- `packages/core/src/archive.ts` `sweepBacklog()` (line 56-57): Reads `item.completedAt` to age-filter. Already has a null check (`if (!item.completedAt)`). With `optional`, `undefined` is also falsy — **safe, no change needed**.
- Archive line 68-71: `item.completedAt?.slice(0, 7)` with fallback to current month — already uses optional chaining. **Safe**.

## Step 3: Accept `dependencies` as alias for `dependsOn`

**File:** `packages/core/src/schemas.ts` (line 38)

Add a Zod `.transform()` or `.preprocess()` to normalize `dependencies` → `dependsOn`. Two options:

**Option A — Transform at schema level:**
Add `dependencies` as an optional field, then use `.transform()` to merge it into `dependsOn`:

```typescript
export const BacklogItemSchema = z.object({
  // ... existing fields ...
  dependsOn: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),  // alias
}).transform(({ dependencies, dependsOn, ...rest }) => ({
  ...rest,
  dependsOn: dependsOn ?? dependencies,
}));
```

**Option B — Preprocess at read time:**
In `readBacklog()` or `readJsonFile()`, normalize the JSON before validation. This is messier.

**Recommendation:** Option A — keeps normalization co-located with the schema.

**Note:** Using `.transform()` changes the Zod schema from `ZodObject` to `ZodEffects`, which means `BacklogItemSchema.shape` won't be directly accessible. Check if anything uses `.shape` on the schema.

## Step 4: Update LOG_PATTERNS for non-numeric IDs

**File:** `packages/core/src/schemas.ts` (lines 241-243)

The fallback log parser uses patterns that hardcode `\d{3,}`:
```typescript
done: /Item \d{3,} completed: .+/,
blocked: /Item \d{3,} blocked: (.+)/,
needsHuman: /Item \d{3,} needs human input: (.+)/,
```

These match log lines like `"Item 001 completed: ..."` written by the runner (`runner.ts:536`). With alphanumeric IDs, these won't match.

Change to:
```typescript
done: /Item \S+ completed: .+/,
blocked: /Item \S+ blocked: (.+)/,
needsHuman: /Item \S+ needs human input: (.+)/,
```

`\S+` matches one or more non-whitespace characters — works for both `"001"` and `"notif-001"`.

## Step 5: Update `addItem()` to handle mixed ID formats

**File:** `packages/core/src/backlog.ts` (lines 110-114)

The current code:
```typescript
const maxId = backlog.items.reduce((max, item) => {
  const num = parseInt(item.id, 10);
  return num > max ? num : max;
}, 0);
```

`parseInt("notif-001", 10)` returns `NaN`, and `NaN > 0` is `false`, so it's already safe — the numeric max ignores non-numeric IDs. Add a clarifying comment:

```typescript
// Compute next numeric ID. Non-numeric IDs (e.g. "notif-001") are
// ignored — parseInt returns NaN which loses the > comparison.
const maxId = backlog.items.reduce((max, item) => {
  const num = parseInt(item.id, 10);
  return num > max ? num : max;
}, 0);
```

## Step 6: Handle `.transform()` type implications

If using `.transform()` in Step 3, the inferred `BacklogItem` type will automatically exclude `dependencies` (it's normalized to `dependsOn`). Verify that:
- `packages/core/src/backlog.ts` — all item access uses `dependsOn` ✓
- `packages/loop/src/prompt-builder.ts` — uses `item.dependsOn` ✓
- `packages/loop/src/runner.ts` — doesn't access dependsOn directly ✓
- `packages/web/` — renders from typed `BacklogItem` ✓

If `.transform()` causes issues with `readJsonFile()` generic typing (it expects `z.ZodType<T>`), we may need to adjust the generic constraint. Check `readJsonFile` signature.

## Step 7: Improve skill guidance for compliance

**File:** `skills/create-ralph-backlog/SKILL.md`

The skill already documents the correct format well. The issue is that agents don't always follow it. Strengthen compliance by:

1. Add a **"Schema Validation"** section near the end that emphasizes the machine-parseable constraints:
   - IDs should be zero-padded sequential digits (`"001"`, `"002"`)
   - `completedAt` must be present (set to `null` for new items)
   - Use `dependsOn` (not `dependencies`) for dependency references
   - Include `status: "pending"` on all new items

2. Add a final step: "Validate the generated JSON against the schema before writing" with a reminder that ralph will reject non-conforming backlogs.

**File:** `skills/review-ralph-backlog/SKILL.md`

The review skill already checks structural conformance (dimension 7). Ensure it explicitly calls out:
- Checking for `dependencies` vs `dependsOn` field naming
- Checking that `completedAt` is present (not missing)
- Checking ID format

## Step 8: Confirm loop resilience to schema issues

**Already verified — no additional code changes needed:**

- **Signal parsing** (`signal-parser.ts`): Does NOT embed item IDs in signals. Uses `RALPH_DONE`, `RALPH_BLOCKED:reason` format. Safe.
- **Item selection** (`backlog.ts:selectNextItem`): Uses string comparison, not numeric. Works with any ID format.
- **State tracking** (`runner.ts`): Stores IDs as opaque strings. Safe.
- **Commit messages** (`git-commit.ts`): Format is `[ralph] ${itemId}: ${title}` — works with any string ID.
- **Validation failure handling** (`runner.ts:313-318`): If `readBacklog()` fails validation, the loop logs the error and breaks the iteration cleanly — no crash.

The main risk is the loop **refusing to start** if the backlog doesn't validate. Steps 1-4 fix this by relaxing the schema to accept reasonable variations.

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/schemas.ts` | Relax ID regex, make completedAt optional, add dependencies alias, update LOG_PATTERNS |
| `packages/core/src/backlog.ts` | Add clarifying comment on addItem() ID parsing |
| `skills/create-ralph-backlog/SKILL.md` | Strengthen schema compliance guidance |
| `skills/review-ralph-backlog/SKILL.md` | Strengthen structural validation checks |

## Tests to Update

- `packages/core/src/backlog.test.ts` — add test cases for non-numeric IDs, missing completedAt, dependencies alias
- `packages/core/src/schemas.test.ts` (if exists) — update ID validation tests
- Run `pnpm test && pnpm typecheck` to verify nothing breaks

## Verification

1. `pnpm test` — all existing tests pass
2. `pnpm typecheck` — no type errors from schema changes
3. Manually validate that the starter-kitchen-sink-bun backlog.json now passes `readBacklog()`
4. Verify `addItem()` still generates numeric IDs correctly when existing IDs are non-numeric
5. Start the ralph web app and confirm the backlog loads for the starter-kitchen-sink-bun project
