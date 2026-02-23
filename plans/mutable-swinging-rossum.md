# Plan: Fix Disabled "Up to Date" Button + RALPH.md Badge Gap

## Context

After implementing the pre-flight staleness check, the settings page for a freshly-installed
project (like anvil2, installed today) shows every artifact as "current" — and therefore renders
the update button as **disabled** with label "Up to Date". This means users have **no way to
trigger an artifact update** from the web UI, even if they want to force a reinstall or simply
verify everything is current by running the update action.

Additionally, RALPH.md appears in the artifact hash list with no status badge (it's in
`artifactHashes` but not in `SCRIPT_ARTIFACTS` that `checkArtifactStaleness()` covers), which
looks like a visual gap.

## Changes — one file only

**`packages/web/src/client/routes/projects/settings.tsx`**

### Fix 1: Never disable the update button based on staleness (line ~670–673)

Change the "Up to Date" button case from `buttonDisabled = true` to `buttonDisabled = false`,
and rename the label from `"Up to Date"` to `"Update Artifacts"` (standard fallback label).
The staleness summary badge in the section header already tells the user everything is current —
the button doesn't need to be disabled to communicate that.

The new button logic becomes:

```typescript
if (updatePending) {
  // Updating… — disabled (only case where button is locked)
} else if (staleness && staleness.updatesAvailable > 0) {
  // "Update N File(s)" — accent color, enabled
} else if (staleness && staleness.conflicts > 0) {
  // "Update (review conflicts)" — amber, enabled
} else {
  // "Update Artifacts" — standard style, ALWAYS ENABLED
  // Covers: no staleness data yet, all up to date, loading
}
```

### Fix 2: Show a "rendered" badge for RALPH.md entries (line ~697–710)

When iterating `artifactHashes`, if `fileStatus` is `undefined` (not covered by staleness
check — i.e., RALPH.md), show a neutral "rendered" badge instead of nothing:

```tsx
{fileStatus ? (
  <ArtifactStatusBadge status={fileStatus} />
) : staleness ? (
  <span className="rounded px-1.5 py-0.5 text-xs font-medium"
    style={{ backgroundColor: "var(--color-surface-raised)", color: "var(--color-text-muted)" }}>
    rendered
  </span>
) : null}
```

The condition `staleness ?` ensures the badge only appears after the query resolves (not
during the "Checking…" phase where undefined is ambiguous).

## Critical file

- `packages/web/src/client/routes/projects/settings.tsx` — the only file to modify
  - Button logic: ~lines 660–683
  - File row badge: ~lines 697–715

## What is NOT changed

- `packages/core/src/installer.ts` — `checkArtifactStaleness()` correctly excludes RALPH.md
- `packages/web/src/server/routes/projects.ts` — no API changes
- No new components, types, or files

## Verification

1. `pnpm build` — confirm no TypeScript errors
2. Open anvil2 settings page — confirm "Update Artifacts" button is **enabled** (not green-disabled)
3. Confirm RALPH.md row shows a "rendered" badge
4. Click "Update Artifacts" — confirm action log appears (all "skipped"), staleness refreshes
5. `pnpm test` — confirm all tests still pass
