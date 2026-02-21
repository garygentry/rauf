# Plan: Introduce `artifacts/variants/` Directory for Variant Organization

## Context

Ralph's `artifacts/` directory holds canonical template files deployed to target projects. The current variant is `backlog-json` (a simple JSON file for tracking items), but the architecture is designed for future variants (Linear, GitHub Issues, Beads, etc.). The `variant` field already exists in the `MarkerFile` schema (`.ralph.json`).

Currently the path is `artifacts/backlog-json/` — which works, but doesn't self-document that `backlog-json` is one of many possible *variants*. Adding an intermediate `variants/` directory makes the extensibility immediately visible:

```
artifacts/
└── variants/
    └── backlog-json/    ← current default variant
    # └── linear/        ← future
    # └── github-issues/ ← future
```

This also reserves `artifacts/` for potential shared/common files that aren't variant-specific in the future.

## Implementation

### Step 1: Move the directory

```bash
mkdir -p artifacts/variants
git mv artifacts/backlog-json artifacts/variants/backlog-json
```

### Step 2: Recreate the ralph.sh symlink

The root `ralph.sh` currently points to `artifacts/backlog-json/ralph.sh`. Update it:

```bash
rm ralph.sh
ln -s artifacts/variants/backlog-json/ralph.sh ralph.sh
```

### Step 3: Update documentation files

**`CLAUDE.md`** (repo root) — 2 locations:
- Line ~15: Repository layout tree (`artifacts/` → show `variants/backlog-json/`)
- Line ~84: Self-hosting note (`artifacts/backlog-json/` → `artifacts/variants/backlog-json/`)

**`docs/SPEC-ARTIFACTS.md`** — 3 locations:
- Line 3: Reference path
- Line 5: Prose description
- Lines 9-10: File inventory tree header

**`docs/SPEC-CORE.md`** — Line 80:
- Discovery filter: currently `exclude any path containing /artifacts/` — this still works since `/artifacts/` is a parent segment of the new path. **No change needed** for discovery logic itself, but update the comment if it references the exact path.

**`docs/SCHEMAS.md`** — **No change needed**. The `variant: "backlog-json"` field is the variant *name*, not a filesystem path.

**`docs/SPEC-CLI.md`** — **No change needed**. Only mentions "install artifacts" generically.

### Step 4: Update backlog item descriptions

**`.ralph/backlog.json`** — 2 items have path references in their descriptions:
- Item 035: `"Create the canonical ralph.sh script in artifacts/backlog-json/."` → `artifacts/variants/backlog-json/`
- Item 036: `"Create the ralph-status.sh and ralph-add.sh canonical scripts in artifacts/backlog-json/."` → `artifacts/variants/backlog-json/`

### Step 5: Update the repo-integrity test

**`packages/core/src/repo-integrity.test.ts`** — 3 string literals:
- Test description string
- `canonicalScript` path: `"artifacts/backlog-json/ralph.sh"` → `"artifacts/variants/backlog-json/ralph.sh"`
- Symlink target assertion: `"artifacts/backlog-json/ralph.sh"` → `"artifacts/variants/backlog-json/ralph.sh"`

### Step 6: Update `.ralph.json` maxIterations

While we're here, update `maxIterations` from 20 → 100 to match the ralph.sh change we already made:
- `.ralph.json` line 24: `"maxIterations": 20` → `"maxIterations": 100`

## Files Modified (complete list)

| File | Change |
|------|--------|
| `artifacts/variants/backlog-json/` | **Moved from** `artifacts/backlog-json/` |
| `ralph.sh` (symlink) | Retarget to `artifacts/variants/backlog-json/ralph.sh` |
| `CLAUDE.md` | Update 2 path references |
| `docs/SPEC-ARTIFACTS.md` | Update 3 path references |
| `.ralph/backlog.json` | Update items 035, 036 descriptions |
| `packages/core/src/repo-integrity.test.ts` | Update 3 string literals |
| `.ralph.json` | Update maxIterations to 100 |

**No changes needed:**
- `docs/SCHEMAS.md` — variant is a name, not a path
- `docs/SPEC-CORE.md` — discovery filter uses `/artifacts/` which still matches
- `docs/SPEC-CLI.md` — no specific path references
- `.ralph/RALPH.md` — no artifact path references

## Verification

1. `bash -n ralph.sh` — symlink resolves and script parses
2. `pnpm test` — repo-integrity test passes with new symlink target
3. `ls -la ralph.sh` — shows symlink to `artifacts/variants/backlog-json/ralph.sh`
4. `ls artifacts/variants/backlog-json/` — all 5 artifact files present
5. `grep -r "artifacts/backlog-json" .` (excluding node_modules, .git) — returns zero results, confirming no stale references
