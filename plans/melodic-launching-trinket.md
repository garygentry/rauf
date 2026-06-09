# Plan: Review RALPH.md ↔ .ralph.json Command Duplication

## Context

The previous iteration fixed `deployRalphMd()` to use sentinel-aware updates (preserving project-specific content). But this raised a design question: **verification commands exist in both `.ralph.json` (profile.commands) and `.ralph/RALPH.md` (managed section)** — is this duplication the right design?

## Current Data Flow

```
detectProfile() → .ralph.json (profile.commands, profile.verify)
                        ↓ (install/update only)
              buildTemplateVars(profile) → renderTemplate(RALPH.md.tmpl)
                        ↓
              .ralph/RALPH.md (managed section with rendered commands)
                        ↓ (loop runtime)
              prompt-builder reads RALPH.md as text → Claude's system prompt
```

**Key facts:**
- `.ralph.json` is the **source of truth** — editable via `ralph profile set`
- `RALPH.md` is a **derived artifact** — its managed section is re-rendered from .ralph.json on `ralph update`
- The loop runner reads `.ralph.json` for **options only** (autoSweep, model, etc.) — NOT for commands
- The loop runner reads `RALPH.md` as **plain text** for the agent prompt — commands reach Claude through RALPH.md
- Changing commands requires: `ralph profile set` → `ralph update` (two steps)

## Analysis: Is This Duplication a Problem?

**Sync failure scenario:** User runs `ralph profile set . commands.test "new-cmd"` but forgets `ralph update`. Result: .ralph.json says "new-cmd" but RALPH.md still shows the old command. The loop agent uses the stale command.

**Three design options:**

### Option A: Keep current design (source-of-truth + derived artifact)

The duplication is intentional. `.ralph.json` is the machine-readable config; RALPH.md is the agent-readable prompt. `ralph update` is the explicit sync point.

- **Pro:** RALPH.md is a self-contained, human-readable document. Users can inspect exactly what the agent sees.
- **Pro:** No runtime template rendering — loop stays simple and deterministic.
- **Pro:** Matches the CLAUDE.md pattern (sentinel-managed block derived from template).
- **Con:** Two-step command update (`profile set` + `update`). Forgetting `update` causes stale commands.

**Mitigation for the con:** `ralph profile set` could auto-run `update` after writing .ralph.json.

### Option B: Inject commands from .ralph.json at prompt-build time

Remove the managed section from RALPH.md entirely. The prompt builder reads commands directly from .ralph.json and injects them into the prompt at runtime.

- **Pro:** Single source of truth — `ralph profile set` takes effect immediately.
- **Con:** RALPH.md is no longer self-contained (humans can't read it to see what the agent sees).
- **Con:** Requires refactoring prompt-builder, which currently just reads RALPH.md as a string.
- **Con:** The managed section template + sentinel pattern was just fixed — this would undo that work.

### Option C: Make RALPH.md the sole source of truth (remove commands from .ralph.json)

- **Pro:** Simplest mental model — one file, one truth.
- **Con:** Loses programmatic command editing via CLI (`ralph profile set`).
- **Con:** Profile detection results would have nowhere to persist for re-use.

## Recommendation

**Option A (keep current design) + auto-update on profile set.**

The current design is sound. The duplication is the standard "config → rendered artifact" pattern (like package.json → lockfile, or terraform config → plan). The sentinel fix already landed makes `ralph update` safe for project-specific content.

The only real risk is the sync gap, which we can close by having `ralph profile set` automatically call `update()` after writing the profile change. This makes the two-step flow into a one-step flow while keeping the architecture clean.

### Implementation

**File:** `packages/cli/src/profile-config-commands.ts` — `handleProfileSet()` (line 142-155)

After the existing `writeMarkerFile()` call (line 142), add:

```ts
import { update } from "@rauf/core";

// After writeMarkerFile succeeds...
const updateResult = update(resolved);
if (!updateResult.ok) {
  // Non-fatal — profile was saved, just warn that RALPH.md wasn't re-rendered
  info(`Profile saved but RALPH.md could not be updated: ${updateResult.error.message}`);
  info(`Run 'ralph update ${targetPath}' manually to sync.`);
}
```

Update the success message to indicate both files were updated:
```
success(`Profile updated: ${key} = ${value}`);
info("RALPH.md verification commands synced.");
```

This keeps the change minimal — `update()` from core already does the right thing (sentinel-aware RALPH.md update + CLAUDE.md sentinel update + schema update). The only new behavior is calling it automatically.

### Skill improvements: `skills/review-ralph-guidance/SKILL.md`

The skill was already updated in the previous iteration to remove CLAUDE.md scope. Now improve the verification guidance:

**a) Make command verification an explicit procedural step (not advisory).**

Step 2 currently says "How to verify: Run each command..." as a tip. Change to: explicitly instruct the agent to run each non-empty command and record pass/fail. This is the most important part of the skill — the agent must actually execute, not just read.

**b) Add .ralph.json ↔ RALPH.md sync check.**

New step between current Steps 1 and 2: Compare `profile.commands` and `profile.verify` from `.ralph.json` against the rendered commands in RALPH.md's managed section. If they don't match, the files are out of sync — likely `ralph profile set` was run without `ralph update`. Flag this as a critical issue.

**c) Fix guidance when `ralph` CLI isn't available.**

The target project agent may not have `ralph` CLI. The skill should say: if `ralph` CLI is available, use `ralph profile set` + `ralph update`. If not, edit `.ralph.json` profile fields directly AND update the managed section in RALPH.md to match. Both files must agree.

**d) Workflow step 6 inconsistency note.**

Step 4 checks whether workflow step 6 matches the managed section. Add: if they differ, update workflow step 6 directly since it's outside managed sentinels and won't be auto-updated.

## Files to modify

1. `packages/cli/src/profile-config-commands.ts` — add `update()` call after `writeMarkerFile()` in `handleProfileSet()`
2. `skills/review-ralph-guidance/SKILL.md` — improve verification guidance (items a-d above)

## Verification

1. `npx vitest run packages/core/src/installer.test.ts` — existing + new sentinel tests pass
2. `npx vitest run` — all tests pass
3. `npx tsc --noEmit -p packages/core/tsconfig.json && npx tsc --noEmit -p packages/cli/tsconfig.json` — no type errors
