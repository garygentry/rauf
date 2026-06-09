---
name: review-backlog
description: >
  Review and QA an existing rauf backlog.json — a second-opinion audit of coverage,
  scoping, dependency sanity, acceptance-criteria quality, and enum correctness. Use
  this skill when the user asks to "review a rauf backlog", "review the backlog",
  "QA the backlog", "audit backlog.json", "check backlog against spec", "validate
  backlog items", "review backlog quality", or wants "a second opinion on the
  backlog". Serves both the repo-wide backlog (`<project>/.rauf/backlog.json`) and
  feature/multi-backlog setups (`--backlog <dir>`). Do NOT trigger for creating new
  backlogs — use author-backlog for that.
---

# Review Rauf Backlog

You are reviewing an existing `backlog.json` for a rauf autonomous coding loop. Your role is QA second opinion: compare the backlog against any reference documents, check for anti-patterns, confirm it validates, and propose concrete improvements.

This skill works for both flows. `<backlogDir>` is the target backlog directory — `<project>/.rauf/` for the ad-hoc/repo-wide case, or a caller-supplied `--backlog <dir>` (with specs in `--specs-dir <dir>`) for feature/multi-backlog setups. `<project>` is the project root.

The authoring craft and full machine contract live in the `author-backlog` skill and `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` (Part A) — reference them when proposing fixes.

## Before You Start

1. **Read `<backlogDir>/backlog.json`** — this is what you're reviewing.
2. **Read all reference documents** the user provides (specs, plans, architecture docs).
3. **Resolve the schema** to confirm the contract: PREFER the installed `<backlogDir>/.rauf/backlog.schema.json` (or `<project>/.rauf/backlog.schema.json`); if absent, fall back to the published `$id`: `https://raw.githubusercontent.com/garygentry/rauf/main/schemas/backlog.schema.json`. Never vendor a schema copy; never hard-fail just because the installed copy is missing.
4. **Read the project codebase** enough to understand what already exists vs what the backlog proposes.

## The Backlog Shape

```json
{
  "schemaVersion": "1",
  "project": "project-name",
  "description": "Brief description of the project and what this backlog accomplishes",
  "items": [
    {
      "id": "001",
      "type": "feature",
      "priority": 1,
      "title": "Short imperative title",
      "description": "Full description of what to do",
      "acceptanceCriteria": ["Each criterion is a checkable statement"],
      "status": "pending",
      "completedAt": null,
      "dependsOn": ["000"],
      "notes": "Context, links, hints for the agent",
      "estimatedIterations": 1,
      "model": "claude-opus-4-6",
      "agentDelegation": {
        "recommendedConcurrency": 3,
        "strategy": "How to parallelize",
        "subtasks": ["Subtask 1", "Subtask 2", "Subtask 3"]
      },
      "specReferences": ["docs/SPEC.md"],
      "provider": "claude-cli"
    }
  ]
}
```

### Enums — what valid looks like

- **`type`** is EXACTLY one of: `bug | bugfix | refactor | feature | chore | test`. Flag anything else (e.g. `docs`, or a copy that omits `bugfix`/`test`).
- **`status`** is EXACTLY one of: `pending | in_progress | done | blocked`. Flag `complete`, `in-progress`, `docs`, or any other value.
- New items must be `"status": "pending"` with `"completedAt": null`. Done items carry an ISO date in `completedAt`.
- Dependency field is `dependsOn` (array of ids), NOT `dependencies`.
- Top-level `schemaVersion` is optional (string, default `"1"`); its absence is fine — rauf stamps it on read.

### Required item fields

`id`, `type`, `priority` (1–4), `title`, `description`, `acceptanceCriteria`, `status`, `completedAt`.

### Optional item fields

`dependsOn`, `notes`, `estimatedIterations`, `model`, `agentDelegation`, `specReferences`, `provider`.

## Status-Based Rules

- **Items you may modify:** `pending`, `blocked`.
- **Items you must NOT modify:** `done`, `in_progress`. Review them for information only (e.g. a done item's approach may affect pending items); include them in the coverage map but never propose content changes.
- **New items** you propose get IDs continuing from the highest existing ID (if the last is `"047"`, new ones start at `"048"`).

## Review Dimensions

Evaluate the backlog across all 7 dimensions, in this order.

### 1. Coverage

Map each requirement from the reference documents to backlog items:

```
| Requirement / Spec Section       | Backlog Item(s)   | Status   |
|----------------------------------|-------------------|----------|
| User authentication (SPEC §3.1)  | 005, 006          | Covered  |
| Rate limiting (SPEC §3.4)        | —                 | GAP      |
| Error handling (SPEC §4.2)       | 012 (partial)     | Partial  |
```

Read reference documents section by section. A "requirement" is anything implying work: a feature to build, a behavior to implement, a constraint to enforce. Ensure every substantive requirement has at least one item.

### 2. Gaps

For each GAP/Partial entry, propose a new item with full JSON. New items must continue the ID sequence, have `"status": "pending"` and `"completedAt": null`, include proper `dependsOn` references, and meet the quality bar in dimension 4.

### 3. Accuracy

For each existing item, compare its description and acceptance criteria against what the reference documents actually say. Flag:

- **Misinterpretations** — the item describes something different from the spec.
- **Outdated references** — references to spec sections that have changed.
- **Missing constraints** — spec requirements the item doesn't capture.
- **Over-specification** — requirements the item adds that aren't in the spec.

**specReferences cross-check:** if an item has `specReferences`, read each referenced file and verify the item is consistent with what those docs say (the agent will read them during execution). Flag contradictions and missed key requirements.

### 4. Quality

**Description quality:** sufficient detail for an agent with no context to implement (features generally 100+ chars); names files to create/modify; references patterns in existing code; includes edge cases and boundaries; self-contained (no "same as above").

**Acceptance criteria quality:** each criterion objectively verifiable and specific (names exact functions, files, behaviors); each tests one thing; a verification command is the last criterion (e.g. `"pnpm test && pnpm typecheck passes"`). Flag vague criteria ("works correctly", "code is clean", "handles edge cases").

**Title quality:** imperative mood ("Add X", not "Adding X" or "X feature"); under 80 chars; meaningful without the description.

**specReferences usage:** items implementing spec-defined behavior should point to the relevant docs; referenced files must exist; references should be specific (prefer `docs/SPEC-CORE.md` over a generic `docs/`).

### 5. Dependencies

- **No circular dependencies** — trace every chain to confirm it terminates.
- **No phantom dependencies** — every ID in `dependsOn` must exist in the backlog.
- **Correct field name** — `dependsOn`, not `dependencies`.
- **Not over-constrained** — items touching independent parts of the codebase shouldn't be chained.
- **Not under-constrained** — items that import types/functions from another item should depend on it.
- **Done/blocked dependencies** — depending on a `done` item is fine; depending on a `blocked` item should be flagged.

### 6. Sizing

- **Too large** — touches more than ~6–8 files, 15+ acceptance criteria, 300+ word description, or combines multiple logical changes ("and then also...").
- **Too small** — trivial one-line changes that could fold into an adjacent item.
- **agentDelegation opportunities** — clearly independent subtasks that share one verification step but don't use `agentDelegation`.
- **Inappropriate agentDelegation** — delegation used where subtasks are actually interdependent.

### 7. Structural

- All required fields present on every item.
- IDs are sequential, zero-padded strings with no gaps (unless gaps are from done items). Non-numeric IDs (e.g. `"notif-001"`) are tolerated but numeric is preferred.
- `type` ∈ `bug | bugfix | refactor | feature | chore | test`.
- `priority` is an integer 1–4.
- `status` ∈ `pending | in_progress | done | blocked`.
- `completedAt` present and `null` for pending/blocked items, ISO date for done items. Flag items where `completedAt` is missing entirely.
- Field naming uses `dependsOn` (not `dependencies`).
- `dependsOn` contains only valid item IDs.
- Project-level `project` and `description` are present and meaningful. `schemaVersion`, if present, is a string; if absent, that's fine.

## Run the Validator

Don't eyeball validity. Confirm the backlog actually validates by RUNNING THE RAUF CLI (never against a vendored schema copy):

**Repo-wide / default backlog:**

```bash
rauf backlog validate <projectPath>
```

**Feature / multi-backlog (machine-readable):**

```bash
rauf backlog validate <projectPath> --backlog <backlogDir> [--specs-dir <specsDir>] --json
```

Exit codes: `0` = valid; `1` = validation findings (errors); `2` = usage/IO error. With `--json` the CLI emits `{ valid, findings[] }` — fold any `findings` into your report under Structural/CRITICAL. Re-run after applying fixes to confirm it returns to `0`.

## Anti-Patterns to Flag

| Anti-Pattern         | Severity  | Description                                                                         |
| -------------------- | --------- | ----------------------------------------------------------------------------------- |
| God item             | CRITICAL  | 15+ acceptance criteria or 8+ files touched — must be split                         |
| Missing verification | CRITICAL  | No verification command in acceptance criteria                                      |
| Invalid enum         | CRITICAL  | `type` or `status` outside the allowed set (e.g. `complete`, `in-progress`, `docs`) |
| Phantom dependency   | CRITICAL  | `dependsOn` references a non-existent item ID                                       |
| Circular dependency  | CRITICAL  | Dependency chain forms a cycle                                                      |
| Wrong dep field      | IMPORTANT | Uses `dependencies` instead of `dependsOn`                                          |
| Vague description    | IMPORTANT | Description under 100 chars for a feature item                                      |
| Priority inflation   | IMPORTANT | More than 60% of items are priority 1                                               |
| Stale blocked        | IMPORTANT | Blocked item whose blocker is now done                                              |
| Over-constrained     | IMPORTANT | Items chained by `dependsOn` that could run independently                           |
| Under-constrained    | IMPORTANT | Item uses types/functions from another item but doesn't depend on it                |
| Wrong type           | INFO      | Item classified as the wrong (but valid) type                                       |
| Orphan item          | INFO      | Item nothing depends on AND that depends on nothing (may be fine, but worth noting) |

## Report Format

### Coverage Map

The full requirement-to-item mapping table from dimension 1.

### Findings

Group by severity, then dimension:

```
## CRITICAL

### [Dimension] Finding title
**Item(s):** 005, 012
**Issue:** What's wrong
**Proposed fix:** Specific change to make

## IMPORTANT
...

## INFO
...
```

### Proposed New Items

For each gap, present full JSON for the new item:

```json
{
  "id": "048",
  "type": "feature",
  "priority": 2,
  "title": "Add rate limiting to API endpoints",
  "description": "...",
  "acceptanceCriteria": ["..."],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["012"],
  "specReferences": ["docs/SPEC.md"]
}
```

### Summary

- Total items reviewed: X (Y pending, Z done, W blocked, V in_progress).
- `rauf backlog validate` result: valid / N findings.
- Coverage: X/Y requirements covered.
- Findings: X critical, Y important, Z info.
- New items proposed: X. Items to modify: X.

## Applying Changes

After presenting the report, **wait for user approval** before changing anything. When approved (in whole or in part):

1. Re-read the current `<backlogDir>/backlog.json` (it may have changed).
2. Apply only approved modifications to `pending`/`blocked` items.
3. Append new items at the end, continuing the ID sequence.
4. Never modify `done` or `in_progress` items.
5. Write the updated file.
6. **Run `rauf backlog validate`** (see forms above) and confirm exit code `0`. Fix any findings and re-run.

## Interaction with the User

1. **Present the full report** across all 7 dimensions plus the validator result.
2. **Ask which changes to apply** — the user may approve all, some, or none.
3. **Apply approved changes**, re-validate via the CLI, and confirm the result.
4. If the user wants to iterate, re-review the modified backlog against the same reference documents.
