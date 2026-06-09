# Plan: Pre-Flight Artifact Staleness Check

## Context

A freshly-initialized ralph project with no code (only spec docs) has a confusing settings page
experience. Before the recent "Update Artifacts" button addition, users had no way to update
artifacts from the web UI at all. Even after that fix, the UX is still suboptimal for this common
early-stage use case:

- The Artifact Status section is buried at the **bottom** of the settings page, below sections about
  verification commands that don't exist yet
- Users must **blindly click "Update Artifacts"** with no indication of whether updates are actually
  available — or whether their local modifications will be clobbered
- There is no way to distinguish "ralph.sh is already current" from "ralph.sh is 2 versions behind"

The fix is to add a **pre-flight staleness check** that answers "what *would* update do?" before
the user commits to it, and reorder the settings sections so the most relevant action for no-code
projects is prominently placed.

## Architecture

Three layers, each minimal:

1. **Core** — `checkArtifactStaleness()` function (read-only mirror of `update()`'s comparison step)
2. **API** — `GET /api/projects/:id/artifact-status` endpoint
3. **Frontend** — `useQuery` for staleness + decorated UI in `settings.tsx`

## Changes

### 1. `packages/core/src/installer.ts`

Add a new exported function **`checkArtifactStaleness(projectPath, options?)`** near the existing
`update()` function (around line 500+).

```typescript
export type ArtifactFileStatus = "up_to_date" | "safe_update" | "local_only" | "conflict" | "missing";

export type ArtifactStalenessReport = {
  files: Record<string, ArtifactFileStatus>;
  updatesAvailable: number;   // count of "safe_update"
  conflicts: number;          // count of "conflict"
};
```

Implementation:
- Read marker file with `readMarkerFile(resolved)` — error if not installed
- For each script in `SCRIPT_ARTIFACTS`:
  - Read canonical content via `readArtifact(script, artifactsDir?)`
  - If file doesn't exist on disk: `"missing"`
  - Otherwise call `threeWayCompareContent(storedHashes[script], destPath, canonicalContent)`:
    - `"up_to_date"` → `"up_to_date"`
    - `"safe_update"` → `"safe_update"`
    - `"local_only"` → `"local_only"`
    - `"conflict"` → `"conflict"`
- Return `ok({ files, updatesAvailable, conflicts })`

**Note:** RALPH.md is always re-rendered by `update()` (not three-way compared), so it is excluded
from the staleness check. Only `SCRIPT_ARTIFACTS` are tracked here.

`threeWayCompareContent` and `SCRIPT_ARTIFACTS` are already accessible within `installer.ts` (same
file). The new function is exported naturally via the existing `export * from "./installer.js"` in
`packages/core/src/index.ts`.

### 2. `packages/web/src/server/routes/projects.ts`

Add a new route **before** the existing `/:id/update` handler (around line 314):

```typescript
router.get("/:id/artifact-status", async (c) => {
  const id = c.req.param("id");
  const projectPath = resolveProjectPath(id);
  // ... same path validation as other handlers ...

  const result = checkArtifactStaleness(projectPath);
  if (!result.ok) {
    const status = result.error.code === ErrorCodes.NOT_INSTALLED ? 404 : 400;
    return c.json(errorResponse(result.error.code, result.error.message), status);
  }
  return c.json({ data: result.value });
});
```

Import `checkArtifactStaleness` from `@rauf/core` alongside the existing `update` import.

### 3. `packages/web/src/client/routes/projects/settings.tsx`

Three sub-changes:

**a) Add `ArtifactStalenessReport` to the import (line 4)**

**b) Add staleness query (after `updateMutation`, around line 135)**

```typescript
const stalenessQuery = useQuery({
  queryKey: ["projects", projectId, "artifact-status"],
  queryFn: () =>
    ralphFetchJson<ArtifactStalenessReport>(
      `/api/projects/${encodeURIComponent(projectId)}/artifact-status`,
    ),
  enabled: !!projectId,
});
```

Invalidate it after a successful update by adding to `updateMutation.onSuccess`:
```typescript
void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "artifact-status"] });
```

**c) Move and expand the "Artifact Status" section**

Move it to **second position** (after Tech Stack, before Verification Commands). Update the section
to show:

- **Summary badge** at the top of the section description area:
  - Grey: "Checking…" (while staleness query loading)
  - Green: "All artifacts up to date" (updatesAvailable === 0 && conflicts === 0)
  - Orange: "N update(s) available" (updatesAvailable > 0)
  - Amber: "N conflict(s)" (conflicts > 0)

- **Per-file status badge** next to each artifact in the hash list:
  - `up_to_date` → green dot / "current"
  - `safe_update` → orange badge / "update available"
  - `local_only` → muted badge / "locally modified"
  - `conflict` → amber badge / "conflict"
  - `missing` → red badge / "missing"

- **"Update Artifacts" button** adapts:
  - When `updatesAvailable > 0`: "Update N File(s)" with accent color
  - When `updatesAvailable === 0 && conflicts === 0`: "Up to Date" (disabled, green-tinted)
  - When only conflicts: "Update (review conflicts)" (enabled, amber-tinted)
  - While loading staleness: normal "Update Artifacts" label

The existing result table (from the previous plan's implementation) stays intact below the button —
shown after a successful mutation.

## Critical Files

- `packages/core/src/installer.ts` — add `checkArtifactStaleness()` near `update()` (line ~500)
- `packages/web/src/server/routes/projects.ts` — add `GET /:id/artifact-status` (before line 314)
- `packages/web/src/client/routes/projects/settings.tsx` — add query + update UI

## Existing utilities to reuse (do not re-implement)

- `threeWayCompareContent(storedHash, currentPath, canonicalContent)` — `installer.ts:847`
- `readArtifact(relativePath, artifactsDir?)` — `installer.ts:57` — reads embedded artifact as string
- `computeHash(filePath)` — `fs-utils.ts:103` — SHA-256 of file on disk, returns `Result<string>`
- `SCRIPT_ARTIFACTS` — `installer.ts:36` — `["ralph.sh", "ralph-status.sh", "ralph-add.sh"]`
- `readMarkerFile(projectPath)` — already used by `update()`
- `resolveProjectPath`, `validateProjectPath`, `errorResponse` — `projects.ts` shared helpers

## What is NOT changed

- `packages/core/src/schemas.ts` — `ArtifactStalenessReport` is a computation type, not stored
- `packages/core/src/index.ts` — wildcard re-export already covers new exports from `installer.ts`
- Backlog, profile, options, or any other settings sections

## Verification

1. `pnpm build` — confirm no TypeScript errors
2. Start dev server; open a project's Settings page
3. Before clicking Update: confirm the staleness badges show on each artifact row, and the button
   label reflects the actual count of updates available
4. Click "Update N File(s)" — confirm action log appears, then staleness badges refresh (via query
   invalidation) to show all "current"
5. Manually edit `ralph.sh` in a test project, reload Settings — confirm that file shows
   "locally modified" or "conflict" badge, not "update available"
6. Test with the anvil2 no-code project specifically — confirm the button is immediately useful
   without needing to configure any commands first
7. `pnpm test` — confirm all 157 existing tests pass
