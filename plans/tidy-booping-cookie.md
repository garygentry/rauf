# Plan: Model Selection, Graceful Cancel, Script Symlinks

## Context

Three improvements to the ralph loop runner. User decisions:
- **Symlinks**: Implement now (minor fix)
- **Model selection**: Add to specs + backlog for ralph loop to implement (3-tier design)
- **Graceful cancel**: Add to specs + backlog for ralph loop to implement (defer implementation)

---

## Part 1: Implement Now — Script Symlinks

### Problem
`ralph.sh` at the repo root is correctly a symlink to `artifacts/variants/backlog-json/ralph.sh`,
but `ralph-add.sh` and `ralph-status.sh` are regular files (4.2 KB and 5.4 KB respectively).
They should be symlinks too, consistent with the established pattern, so edits to the canonical
artifact always reflect at the repo root.

### Fix

```bash
# Replace root copies with relative symlinks
rm ralph-add.sh
ln -s artifacts/variants/backlog-json/ralph-add.sh ralph-add.sh

rm ralph-status.sh
ln -s artifacts/variants/backlog-json/ralph-status.sh ralph-status.sh
```

Note: content at root and canonical are identical (verified by file size), so the symlink is a
safe replacement with no functional change.

### Test update: `packages/core/src/repo-integrity.test.ts`

Add two new `it()` blocks following the exact same structure as the existing `ralph.sh` test:

```typescript
it("ralph-add.sh at repo root is a symlink to artifacts/variants/backlog-json/ralph-add.sh", () => {
  const rootScript = resolve(REPO_ROOT, "ralph-add.sh");
  const canonicalScript = resolve(REPO_ROOT, "artifacts/variants/backlog-json/ralph-add.sh");
  expect(existsSync(canonicalScript)).toBe(true);
  expect(lstatSync(canonicalScript).isFile()).toBe(true);
  expect(lstatSync(rootScript).isSymbolicLink()).toBe(true);
  expect(readlinkSync(rootScript)).toBe("artifacts/variants/backlog-json/ralph-add.sh");
});

it("ralph-status.sh at repo root is a symlink to artifacts/variants/backlog-json/ralph-status.sh", () => {
  // same pattern
  expect(readlinkSync(rootScript)).toBe("artifacts/variants/backlog-json/ralph-status.sh");
});
```

---

## Part 2: Spec Updates — Model Selection

### Schema changes needed (for ralph loop to implement)

**`docs/SCHEMAS.md`** — Document `model` field in two schemas:

- `BacklogItem`: add `model?: string` — per-item model override (e.g. `"claude-haiku-4-5-20251001"`)
- `MarkerOptions`: add `model?: string` — project-level default model

**`docs/SPEC-ARTIFACTS.md`** — Document 3-tier model resolution in ralph.sh:

```
Model resolution priority:
  1. BacklogItem.model  (per-task override, read from backlog item JSON)
  2. CLI arg $3         (e.g. ./ralph.sh 20 3 claude-opus-4-6)
  3. MarkerOptions.model (from .ralph.json options.model)
  4. Claude default     (no --model flag passed)

Invocation: claude -p --dangerously-skip-permissions --output-format text [--model <model>]
```

### Backlog item

Add new item to `.ralph/backlog.json`:

```json
{
  "id": "043",
  "type": "feature",
  "priority": 2,
  "title": "Model selection: 3-tier model override for ralph sessions",
  "description": "Allow users to specify which Claude model ralph.sh uses, with three levels of priority: per-task (BacklogItem.model), per-run (CLI arg $3), and project-default (MarkerOptions.model in .ralph.json). When a model is specified, pass --model <model> to the claude -p invocation.",
  "acceptanceCriteria": [
    "Add model?: string to BacklogItemSchema (Zod optional field)",
    "Add model?: string to MarkerOptionsSchema (Zod optional field)",
    "ralph.sh reads model from CLI arg $3 (./ralph.sh [iterations] [retries] [model])",
    "ralph.sh reads project-level default from .ralph.json options.model (jq .options.model // empty)",
    "ralph.sh reads per-item override from backlog item .model field",
    "Resolution order: item.model > CLI arg > options.model > no flag (Claude default)",
    "When resolved model is non-empty, passes --model <model> to claude -p",
    "Existing .ralph.json files without model field continue to work (optional field, no migration)",
    "Unit tests: schemas accept/reject model field correctly",
    "pnpm test && pnpm -r typecheck passes"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["002", "035"],
  "notes": "Reference docs/SCHEMAS.md and docs/SPEC-ARTIFACTS.md for model field definitions. The --model flag for claude CLI accepts model IDs like claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001."
}
```

---

## Part 3: Spec Updates — Graceful Cancel

### Design (for ralph loop to implement)

**Signal file pattern**: Create `.ralph/CANCEL` → loop detects it at next iteration boundary →
exits cleanly after current Claude session completes. Mirrors the existing `DONE` file mechanism.

**New artifacts** (to be created by ralph loop):
- `artifacts/variants/backlog-json/ralph-stop.sh` — creates `.ralph/CANCEL` file
- Root symlink: `ralph-stop.sh → artifacts/variants/backlog-json/ralph-stop.sh`

**`docs/SPEC-ARTIFACTS.md`** — Document cancel mechanism:

```
Graceful cancel:
  - Create .ralph/CANCEL to request stop (ralph-stop.sh does this)
  - Loop checks for this file at the start of each iteration (after current iteration finishes)
  - On detection: removes CANCEL file, writes state.json status="paused", writes DONE file "cancel", exits 0
  - Item currently in progress is not reset — it was already resolved before the check runs
```

### Backlog item

Add new item to `.ralph/backlog.json`:

```json
{
  "id": "044",
  "type": "feature",
  "priority": 2,
  "title": "Graceful cancel: ralph-stop.sh and CANCEL signal file mechanism",
  "description": "Implement graceful loop cancellation via a .ralph/CANCEL signal file. The loop checks for this file at each iteration boundary (after the current Claude session completes). On detection, the loop exits cleanly with state paused. A ralph-stop.sh script creates the CANCEL file. Add root symlink and repo-integrity test.",
  "acceptanceCriteria": [
    "Create artifacts/variants/backlog-json/ralph-stop.sh that writes .ralph/CANCEL",
    "ralph.sh checks for .ralph/CANCEL at top of each while-loop iteration (before item selection)",
    "On CANCEL detection: remove .ralph/CANCEL, write state.json status=paused lastSignal=clean, write DONE file with content 'cancel', exit 0",
    "Current in-progress item is NOT reset — cancel only fires at iteration boundary, item was already resolved",
    "ralph-stop.sh symlinked at repo root: ralph-stop.sh -> artifacts/variants/backlog-json/ralph-stop.sh",
    "repo-integrity.test.ts verifies ralph-stop.sh symlink",
    "ralph-stop.sh outputs helpful message: 'Cancel requested. Loop will stop after current iteration.'",
    "pnpm test && pnpm -r typecheck passes"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["035"],
  "notes": "Reference docs/SPEC-ARTIFACTS.md for the CANCEL signal file protocol. LoopStateStatus already includes 'paused' — no schema change needed."
}
```

---

## Critical Files

| File | Action |
|------|--------|
| `packages/core/src/repo-integrity.test.ts` | Add 2 symlink tests |
| `ralph-add.sh` (root) | Replace with symlink |
| `ralph-status.sh` (root) | Replace with symlink |
| `docs/SCHEMAS.md` | Document `model` field on BacklogItem + MarkerOptions |
| `docs/SPEC-ARTIFACTS.md` | Document model resolution + cancel mechanism |
| `.ralph/backlog.json` | Add items 043 (model) and 044 (cancel) |

---

## Implementation Order

1. **Symlinks** — Replace root files, add tests, run `pnpm test`
2. **Spec: SCHEMAS.md** — Add model field documentation
3. **Spec: SPEC-ARTIFACTS.md** — Add model + cancel protocol documentation
4. **Backlog** — Append items 043 and 044 to `.ralph/backlog.json`

---

## Verification

```bash
# Verify symlinks
ls -la ralph-add.sh ralph-status.sh  # Should show symlink arrows

# Run tests (should see 2 new passing repo-integrity tests)
pnpm test

# Verify backlog items added
jq '.items | length' .ralph/backlog.json
jq '.items[-2:] | .[].id' .ralph/backlog.json  # Should show "043" "044"
```
