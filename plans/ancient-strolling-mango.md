# Plan: Monorepo workspace awareness

## Context

Ralph's autonomous agent gets no information about monorepo structure. Two gaps:

1. **Profile detection reads only root `package.json`** — the agent doesn't know what workspace packages exist, their paths, or their scripts. In monorepos the root `package.json` is minimal; the interesting code is in `packages/*`.
2. **RALPH.md verification is a single global command** — if a backlog item targets `packages/web`, the agent still runs all workspace tests with no guidance about scoped verification.

**Goal:** detect workspace packages at profile time, surface them in RALPH.md, and allow backlog items to target a specific package.

## Changes

### 1. Extend schemas (`packages/core/src/schemas.ts`)

Add `WorkspacePackageSchema` and wire it into existing schemas:

```typescript
// New — after ProfileCommandsSchema
export const WorkspacePackageSchema = z.object({
  name: z.string(),             // e.g. "@ralph/core"
  path: z.string(),             // e.g. "packages/core" (relative)
  scripts: z.array(z.string()), // e.g. ["build", "test", "typecheck"]
});
export type WorkspacePackage = z.infer<typeof WorkspacePackageSchema>;
```

Modify existing schemas (both `.optional()` — backward-compatible):
- `ProjectProfileSchema`: add `workspaces: z.array(WorkspacePackageSchema).optional()`
- `BacklogItemSchema`: add `package: z.string().optional()`

### 2. Add workspace detection (`packages/core/src/profile.ts`)

New exported function `detectWorkspaces(projectPath) → WorkspacePackage[]`:
- Read workspace patterns from `pnpm-workspace.yaml` (simple line-based YAML parse) or `package.json.workspaces`
- Resolve each pattern (handle trailing `*` glob) to actual directories
- For each directory with a `package.json`: extract `name`, relative `path`, and `scripts` keys
- Return sorted by path

Modify `detectProfile()`: when `monorepo === true`, call `detectWorkspaces()` and include result in the returned profile.

Add `name?: string` to the existing `PackageJsonPartial` interface (to read package names).

### 3. Build workspace RALPH.md section (`packages/core/src/installer.ts`)

New function `buildWorkspacesSection(profile) → string`:
- Returns `""` for non-monorepo or empty workspaces (no noise in template)
- For monorepos, returns a markdown block:
  - "## Monorepo Structure" header
  - Table of packages (name, path, scripts)
  - "### Scoped Verification" guidance telling the agent to verify the target package first, then run full workspace verify

Modify `buildTemplateVars()`: add `workspacesSection: buildWorkspacesSection(profile)`.

### 4. Update RALPH.md template (`artifacts/variants/backlog-json/.ralph/RALPH.md.tmpl`)

Insert `{{workspacesSection}}` inside the `<!-- ralph:managed -->` block, between the individual commands list and the `<!-- ralph:managed:end -->` sentinel. For non-monorepo projects this renders as empty string — zero noise.

### 5. Add per-item package hint in `ralph.sh` (`artifacts/variants/backlog-json/ralph.sh`)

After the "Notes" section in the prompt builder (~line 492), extract the item's `package` field:

```bash
ITEM_PACKAGE=$(echo "$ITEM_JSON" | jq -r '.package // empty' 2>/dev/null)
```

If non-empty, inject a "### Package Scope" section into the prompt telling the agent which package this task targets.

### 6. Re-generate embedded artifacts

Run `bun run scripts/generate-embedded-artifacts.ts` after template changes.

### 7. Tests

| Test file | What to add |
|-----------|-------------|
| `packages/core/src/profile.test.ts` | `detectWorkspaces`: pnpm-workspace.yaml parsing, package.json workspaces, non-monorepo returns undefined, directories without package.json are skipped |
| `packages/core/src/schemas.test.ts` | Backward compat: old profiles without `workspaces` still parse; old backlog items without `package` still parse |
| `packages/core/src/installer.test.ts` | `buildWorkspacesSection`: monorepo produces table, non-monorepo produces empty string |

### 8. Update docs (`docs/SCHEMAS.md`)

Document `WorkspacePackage` type and `package` field on `BacklogItem`.

## Key files

| File | Action |
|------|--------|
| `packages/core/src/schemas.ts` | Modify — add `WorkspacePackageSchema`, extend `ProjectProfileSchema` + `BacklogItemSchema` |
| `packages/core/src/profile.ts` | Modify — add `detectWorkspaces()`, `getWorkspacePatterns()`, `resolveWorkspacePattern()` |
| `packages/core/src/installer.ts` | Modify — add `buildWorkspacesSection()`, extend `buildTemplateVars()` |
| `artifacts/variants/backlog-json/.ralph/RALPH.md.tmpl` | Modify — insert `{{workspacesSection}}` |
| `artifacts/variants/backlog-json/ralph.sh` | Modify — add `ITEM_PACKAGE` extraction + prompt hint |
| `packages/core/src/profile.test.ts` | Modify — add workspace detection tests |
| `packages/core/src/schemas.test.ts` | Modify — add backward compat tests |
| `packages/core/src/installer.test.ts` | Modify — add `buildWorkspacesSection` tests |
| `docs/SCHEMAS.md` | Modify — document new types |

## Implementation order

1. `schemas.ts` — types first, everything depends on them
2. `profile.ts` + `profile.test.ts` — detection logic, testable in isolation
3. `installer.ts` + `installer.test.ts` — template var building
4. `RALPH.md.tmpl` — template placeholder
5. Re-generate embedded artifacts
6. `ralph.sh` — prompt-time package hint
7. `schemas.test.ts` — backward compat
8. `docs/SCHEMAS.md` — documentation

## Verification

1. `pnpm test` — all new + existing tests pass
2. `pnpm typecheck` — no type errors
3. `pnpm lint && pnpm format:check` — clean
4. `pnpm build` — builds successfully
5. Manual: run `ralph install` on a monorepo → confirm RALPH.md includes workspace table
6. Manual: add `"package": "packages/web"` to a backlog item → run ralph loop → confirm prompt includes package scope hint
