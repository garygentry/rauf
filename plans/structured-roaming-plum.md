# Plan: Backlog Archive / Sweep Feature

## Context

Completed backlog items accumulate in `backlog.json` indefinitely. With 31 of 44 current items already "done", the backlog is 70% noise for active work. This plan implements a sweep/archive mechanism that moves done items into monthly archive files (`.ralph/archive/YYYY-MM.json`), keeping the active backlog lean while preserving all history for querying or purging. The feature is triggered manually via CLI or Web UI, and optionally auto-triggered by `ralph.sh` on loop startup.

---

## Archive File Strategy

- **Location**: `.ralph/archive/YYYY-MM.json` (one file per calendar month)
- **Grouping**: Each done item goes into the file matching its `completedAt` month (e.g., `2026-02.json`). Items with `completedAt: null` fall back to the sweep's current month.
- **Format**: `{ month: "YYYY-MM", items: BacklogItem[] }` — appends to existing file if present.
- **Write order**: Archive files written first, then `backlog.json` updated. Safer failure mode (items temporarily in both) vs. data loss.

---

## Implementation Steps

### Step 1 — Schema extensions
**File:** `packages/core/src/schemas.ts`

Add two new schemas:
```typescript
export const ArchiveMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  items: z.array(BacklogItemSchema),
});

export const SweepResultSchema = z.object({
  archivedCount: z.number().int().nonnegative(),
  archivedMonths: z.array(z.string()),
});

export type ArchiveMonth = z.infer<typeof ArchiveMonthSchema>;
export type SweepResult = z.infer<typeof SweepResultSchema>;
```

Extend `MarkerOptionsSchema` with two optional fields:
```typescript
autoSweep: z.boolean().optional(),         // If true, ralph.sh sweeps on startup
sweepMinAgeDays: z.number().int().nonnegative().optional(),  // Default: 0 (all done)
```

---

### Step 2 — New core module
**File:** `packages/core/src/archive.ts` (create new)

Uses existing utilities: `atomicWrite`, `readJsonFile`, `ensureDir`, `fileExists` from `fs-utils.ts`; `readBacklog`, `writeBacklog` from `backlog.ts`.

**Constant:**
```typescript
const ARCHIVE_SUBDIR = ".ralph/archive";
```

**`sweepBacklog(projectPath, options?: { minAgeDays?: number }): Result<SweepResult>`**
1. Read backlog via `readBacklog()`. Return error on failure.
2. Compute cutoff: if `minAgeDays > 0`, cutoff = `Date.now() - minAgeDays * 86_400_000`. Items completed after cutoff are kept. If `minAgeDays` is 0 or omitted, all done items are swept.
3. Separate `toArchive` (status === "done" and passes age check) from `toKeep`.
4. If `toArchive` is empty, return early with `{ archivedCount: 0, archivedMonths: [] }`.
5. Group `toArchive` by month: `completedAt.slice(0, 7)` or `new Date().toISOString().slice(0, 7)` fallback.
6. `ensureDir(archiveDir)` — create `.ralph/archive/` if absent.
7. For each month group: read existing archive file (if present, validate with `ArchiveMonthSchema`), merge items, `atomicWrite` the file. Return error immediately on any failure.
8. `writeBacklog(projectPath, { ...backlog, items: toKeep })`. Return error on failure.
9. Return `ok({ archivedCount, archivedMonths: sorted keys })`.

**`listArchiveMonths(projectPath): Result<string[]>`**
- If archive dir absent: return `ok([])`.
- Read dir, filter for `/^\d{4}-\d{2}\.json$/`, strip `.json`, sort ascending.

**`readArchiveMonth(projectPath, month): Result<ArchiveMonth>`**
- Validate month format (`/^\d{4}-\d{2}$/`).
- `readJsonFile(archivePath, ArchiveMonthSchema)`.

**`purgeArchive(projectPath, month?: string): Result<{ purgedCount: number, purgedMonths: string[] }>`**
- If `month` provided: validate, delete that file, return `{ purgedCount: 1 }`.
- If no `month`: list all months, delete each, attempt `rmdir` on archive dir, return `{ purgedCount: N }`.

---

### Step 3 — Export from core index
**File:** `packages/core/src/index.ts`

Add after `export * from "./backlog.js";`:
```typescript
export * from "./archive.js";
```

---

### Step 4 — CLI handlers
**File:** `packages/cli/src/backlog-commands.ts`

Add four handlers and one dispatcher:

**`handleBacklogSweep(ctx)`** — `ralph backlog sweep <path> [--min-age-days N] [--dry-run] [--yes]`
- Without `--yes`: print confirmation message, return `INVALID_ARGS`.
- `--dry-run`: read backlog, compute what would be swept, print preview table (ID, title, completedAt, target month), no writes.
- Otherwise: call `sweepBacklog(resolved, { minAgeDays })`, output result.

**`handleBacklogArchiveList(ctx)`** — `ralph backlog archive list <path>`
- `listArchiveMonths()`, then read each for item count. Print table: `Month | Items`.

**`handleBacklogArchiveView(ctx)`** — `ralph backlog archive view <path> <month>`
- `readArchiveMonth()`. Print item table (ID, type, priority, title, completedAt date).

**`handleBacklogArchivePurge(ctx)`** — `ralph backlog archive purge <path> [--month YYYY-MM] [--yes]`
- Requires `--yes`. Calls `purgeArchive()`.

**`handleBacklogArchiveDispatch(ctx)`** — dispatches `ctx.args[0]` to list/view/purge.

---

### Step 5 — Register CLI subcommands
**File:** `packages/cli/src/commands.ts`

Add to `backlog` subcommands array (after `restore`):
```typescript
{ name: "sweep",   description: "Archive done items into .ralph/archive/",       handler: handleBacklogSweep },
{ name: "archive", description: "Manage archive files (list, view, purge)",      handler: handleBacklogArchiveDispatch },
```

---

### Step 6 — Web API routes
**File:** `packages/web/src/server/routes/projects.ts`

Add `SweepBodySchema = z.object({ minAgeDays: z.number().int().nonnegative().optional() })`.

New routes (register before existing conflicting routes following the `restore` pattern):

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/:id/backlog/sweep` | CSRF | Sweep done items; body `{ minAgeDays? }` → `SweepResult` |
| `GET` | `/:id/archive` | — | List months with counts → `{ months: { month, count }[] }` |
| `GET` | `/:id/archive/:month` | — | Get one month → `ArchiveMonth` |
| `DELETE` | `/:id/archive/:month` | CSRF | Purge specific month |

For "purge all", the frontend will call individual month deletes — no separate purge-all route needed.

---

### Step 7 — Web UI
**Files:**
- `packages/web/src/client/routes/projects/backlog.tsx` — add Sweep button
- `packages/web/src/client/routes/projects/archive.tsx` — new `ArchiveView` component
- `packages/web/src/client/router.tsx` — register archive route

**In `backlog.tsx` header button group** (alongside Refresh and Add Item):
- Add "↓ Sweep" button that fires `POST /backlog/sweep` mutation and shows toast with result (e.g., "Archived 12 items → 2026-02").
- Add "Archive →" link pointing to `/projects/$id/archive`.

**`archive.tsx`** — new `ArchiveView` component:
- `useParams()` to get `id`
- `useQuery` for `GET /api/projects/:id/archive` → list of `{ month, count }`
- Renders table of months with item counts
- "View" button: lazy-loads `GET /api/projects/:id/archive/:month` and shows read-only item list inline
- "Purge" button: confirmation-on-second-click pattern (matches existing backlog delete pattern), calls `DELETE /:id/archive/:month`, invalidates archive query

**`router.tsx`** additions:
```typescript
import { ArchiveView } from "./routes/projects/archive";

const archiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$id/archive",
  component: ArchiveView,
});

// Add archiveRoute to routeTree
```

---

### Step 8 — ralph.sh auto-sweep
**File:** `artifacts/variants/backlog-json/ralph.sh`

Insert after preflight checks, before `log "Ralph Loop starting..."`:

```bash
# ── Auto-sweep ────────────────────────────────────────────────────
if [[ -f ".ralph.json" ]]; then
  AUTO_SWEEP=$(jq -r '.options.autoSweep // false' ".ralph.json" 2>/dev/null || echo "false")
  if [[ "$AUTO_SWEEP" == "true" ]]; then
    SWEEP_MIN_AGE=$(jq -r '.options.sweepMinAgeDays // 0' ".ralph.json" 2>/dev/null || echo "0")
    log "Auto-sweep: archiving done items (minAgeDays=$SWEEP_MIN_AGE)..."
    if command -v ralph &>/dev/null; then
      SWEEP_FLAGS="--yes"
      [[ "$SWEEP_MIN_AGE" -gt 0 ]] && SWEEP_FLAGS="$SWEEP_FLAGS --min-age-days $SWEEP_MIN_AGE"
      # shellcheck disable=SC2086
      if ralph backlog sweep . $SWEEP_FLAGS >> "$LOG" 2>&1; then
        log "Auto-sweep complete."
      else
        log "⚠ Auto-sweep failed (exit $?) — continuing."
      fi
    else
      log "⚠ Auto-sweep: 'ralph' not in PATH — skipping."
    fi
  fi
fi
```

Failure is non-fatal — loop continues regardless.

---

### Step 9 — Tests
**File:** `packages/core/src/archive.test.ts` (create new)

Test cases:
1. `sweepBacklog` with no done items → no writes, returns `{ archivedCount: 0 }`
2. `sweepBacklog` with done items → archive file created, items removed from backlog
3. `sweepBacklog` with `minAgeDays: 7` → recent done items stay in backlog
4. `sweepBacklog` run twice → second run is a no-op if no new done items; first run's archive preserved
5. `sweepBacklog` with done items across 2 months → two archive files created
6. `sweepBacklog` with `completedAt: null` → falls back to current month
7. `listArchiveMonths` with no archive dir → `ok([])`
8. `listArchiveMonths` after sweep → correct sorted months
9. `readArchiveMonth` non-existent month → `FILE_NOT_FOUND` error
10. `readArchiveMonth` existing month → correct items
11. `purgeArchive` specific month → only that file deleted
12. `purgeArchive` all → all files deleted
13. `purgeArchive` non-existent month → `ok({ purgedCount: 0 })`
14. `sweepBacklog` on non-ralph path → `FILE_NOT_FOUND` error

---

### Step 10 — Documentation
Update the following docs to describe new types, functions, commands, routes, and ralph.sh behavior:
- `docs/SCHEMAS.md` — `ArchiveMonth`, `SweepResult`, updated `MarkerOptions`
- `docs/SPEC-CORE.md` — new `archive.ts` module section
- `docs/SPEC-CLI.md` — `backlog sweep`, `backlog archive list|view|purge`
- `docs/SPEC-WEB.md` — new sweep and archive routes
- `docs/SPEC-ARTIFACTS.md` — ralph.sh auto-sweep hook, `autoSweep`/`sweepMinAgeDays` options

---

## Critical Files

| File | Action |
|------|--------|
| `packages/core/src/schemas.ts` | Extend `MarkerOptionsSchema`; add `ArchiveMonth`, `SweepResult` |
| `packages/core/src/archive.ts` | **Create** — core archive logic |
| `packages/core/src/archive.test.ts` | **Create** — tests |
| `packages/core/src/index.ts` | Add `export * from "./archive.js"` |
| `packages/cli/src/backlog-commands.ts` | Add 5 handlers |
| `packages/cli/src/commands.ts` | Register `sweep` and `archive` subcommands |
| `packages/web/src/server/routes/projects.ts` | Add 4 new routes |
| `packages/web/src/client/routes/projects/backlog.tsx` | Add Sweep button + Archive link |
| `packages/web/src/client/routes/projects/archive.tsx` | **Create** — ArchiveView component |
| `packages/web/src/client/router.tsx` | Register archive route |
| `artifacts/variants/backlog-json/ralph.sh` | Add auto-sweep startup hook |
| `docs/SCHEMAS.md`, `SPEC-CORE.md`, `SPEC-CLI.md`, `SPEC-WEB.md`, `SPEC-ARTIFACTS.md` | Update |

---

## Execution Order

```
1. schemas.ts           (foundation — no deps)
2. archive.ts           (needs step 1)
3. archive.test.ts      (needs step 2)
4. index.ts             (needs step 2)
5. backlog-commands.ts  (needs step 4)
6. commands.ts          (needs step 5)
7. projects.ts routes   (needs step 4)
8. archive.tsx          (needs step 7)
9. backlog.tsx          (needs step 7)
10. router.tsx          (needs step 8)
11. ralph.sh            (independent artifact)
12. docs                (independent)
```

---

## Delivery Recommendation

**The system is fully ready for this feature.** All infrastructure exists: `fs-utils` (atomicWrite, readJsonFile, ensureDir), Zod schemas, CLI handler patterns, Hono route patterns, React route patterns, and ralph.sh. No pending backlog items block this work.

**Recommended: Add to backlog for ralph loop delivery** (rather than implement in one session).

This is a multi-file feature perfectly suited to the ralph loop's iteration model. Suggested breakdown into 4 sequential backlog items — each is one iteration:

| Item | Scope | References |
|------|-------|------------|
| `archive-1` | Schemas + core `archive.ts` + `archive.test.ts` + `index.ts` export | Steps 1–3 + 9 |
| `archive-2` | CLI handlers + command registration | Steps 4–5 |
| `archive-3` | Web API routes + frontend (`archive.tsx`, sweep button, router) | Steps 6–8 (web) |
| `archive-4` | ralph.sh auto-sweep hook + all doc updates | Steps 8 (ralph.sh) + 10 |

Each item's description should reference this plan file: `plans/structured-roaming-plum.md`.

---

## Verification

```bash
# Build and typecheck
pnpm build && pnpm typecheck

# Run tests (including new archive.test.ts)
pnpm test

# Manual CLI test
ralph backlog sweep /path/to/project --dry-run   # Preview items
ralph backlog sweep /path/to/project --yes        # Sweep all done
ralph backlog archive list /path/to/project       # Confirm archive files created
ralph backlog archive view /path/to/project 2026-02  # Read archived items
ralph backlog archive purge /path/to/project --month 2026-02 --yes  # Purge month

# Manual Web test (with dev server running)
# 1. Navigate to project backlog → confirm "↓ Sweep" button present
# 2. Click Sweep → confirm toast shows archived count
# 3. Click "Archive →" → confirm archive.tsx view loads with month list
# 4. Click "View" on a month → confirm items display
# 5. Click "Purge" on a month → confirm confirmation prompt, then deletion

# Auto-sweep test
# Set .ralph.json options.autoSweep = true
# Run ralph.sh — confirm archive created in .ralph/archive/ and backlog cleaned
```

---

## Edge Cases & Notes

- **Duplicate items across runs**: if backlog write fails after archive write, items appear in both. Re-running sweep is safe — same items re-archived (appended) but since they'll still be "done" in backlog, it works. The UI/CLI queries show current state correctly.
- **Archive files in git**: `.ralph/archive/` is not auto-gitignored by the template. Document in `SPEC-ARTIFACTS.md` that users can add to `.gitignore` if preferred.
- **AtomicWrite and `.bak`**: archive files are not named `backlog.json` so they get `.tmp` rename but no `.bak`. Intentional — archive files are append-only and source data is backlog.
- **MarkerOptions backward compat**: new fields use `.optional()` — existing `.ralph.json` files parse without changes.
- **Hono route ordering**: `POST /:id/backlog/sweep` must be registered before `POST /:id/backlog/:itemId` to avoid matching `sweep` as an item ID. Follow the existing `restore` route placement as the model.
