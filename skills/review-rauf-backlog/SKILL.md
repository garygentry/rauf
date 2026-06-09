---
name: review-rauf-backlog
description: >
  Review and improve an existing rauf backlog.json against reference documents (specs, plans, architecture docs).
  Use this skill when the user asks to "review the backlog", "audit backlog.json", "check backlog against spec",
  "QA the rauf backlog", "validate backlog items", "review backlog quality", or "compare backlog to spec".
  Do NOT trigger for creating new backlogs — use create-rauf-backlog for that.
---

# Review Rauf Backlog

You are reviewing an existing `backlog.json` for a rauf autonomous coding loop. Your role is QA second opinion — you compare the backlog against reference documents, check for anti-patterns, and propose concrete improvements.

## Before You Start

1. **Read `.rauf/backlog.json`** in the target project — this is what you're reviewing
2. **Read all reference documents** the user provides (specs, plans, architecture docs)
3. **Read `.rauf/backlog.schema.json`** if it exists in the target project (or use the schema reference below)
4. **Read the project codebase** enough to understand what already exists vs what the backlog proposes

## The Schema

The backlog.json file has this structure:

```json
{
  "project": "project-name",
  "description": "Brief description of the project and what this backlog accomplishes",
  "items": [
    {
      "id": "001",
      "type": "feature|bug|refactor|chore",
      "priority": 1,
      "title": "Short imperative title",
      "description": "Full description of what to do",
      "acceptanceCriteria": ["Each criterion is a checkable statement"],
      "status": "pending|in_progress|done|blocked",
      "completedAt": null,
      "dependsOn": ["001"],
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

### Required fields

- `id` — Zero-padded sequential string: "001", "002", etc.
- `type` — One of: `feature`, `bug`, `refactor`, `chore`
- `priority` — Integer 1-4 (1 = highest)
- `title` — Short imperative phrase
- `description` — Detailed explanation of the work
- `acceptanceCriteria` — Array of checkable statements
- `status` — `pending`, `in_progress`, `done`, or `blocked`
- `completedAt` — ISO date string or `null`

### Optional fields

- `dependsOn` — Array of item IDs that must be `done` first
- `notes` — Free-text hints and context
- `estimatedIterations` — Expected loop cycles (default: 1)
- `model` — Per-item model override
- `agentDelegation` — Parallelization hints (`recommendedConcurrency`, `strategy`, `subtasks`)
- `specReferences` — File paths to specs the agent should read
- `provider` — Per-item LLM provider override

## Status-Based Rules

**Items you may modify:** `pending`, `blocked`

**Items you must NOT modify:** `done`, `in_progress`

- Review these for informational purposes only (e.g., noting that a done item's approach may affect pending items)
- Include them in the coverage map but never propose changes to their content

**New items** you propose get IDs continuing from the highest existing ID (e.g., if the last item is "047", new items start at "048").

## Review Dimensions

Evaluate the backlog across all 7 dimensions, in this order:

### 1. Coverage

Map each requirement from the reference documents to backlog items. Present as a table:

```
| Requirement / Spec Section       | Backlog Item(s)   | Status   |
|----------------------------------|--------------------|----------|
| User authentication (SPEC §3.1)  | 005, 006           | Covered  |
| Rate limiting (SPEC §3.4)        | —                  | GAP      |
| Error handling (SPEC §4.2)       | 012 (partial)      | Partial  |
```

Be thorough — read the reference documents section by section and ensure every substantive requirement has at least one backlog item. A "requirement" is anything that implies work: a feature to build, a behavior to implement, a constraint to enforce.

### 2. Gaps

For each GAP or Partial entry in the coverage map, propose a new backlog item with full JSON. New items must:

- Continue the ID sequence from the highest existing ID
- Have `"status": "pending"` and `"completedAt": null`
- Include proper `dependsOn` references to existing items where relevant
- Follow all the quality standards in dimension 4

### 3. Accuracy

For each existing item, compare its description and acceptance criteria against what the reference documents actually say. Flag:

- **Misinterpretations** — the item describes something different from the spec
- **Outdated references** — the item references spec sections that have changed
- **Missing constraints** — the spec has requirements the item doesn't capture
- **Over-specification** — the item adds requirements not in the spec

**specReferences cross-check:** If an item has `specReferences`, read each referenced file and verify the item's description and acceptance criteria are consistent with what those documents actually say. Flag discrepancies where the item contradicts or ignores requirements from its own referenced specs. Also flag items that reference specs but miss key requirements from those specs — the agent will read these files during execution, so the item should align with what the agent will find there.

### 4. Quality

Check each item for:

**Description quality:**

- Sufficient detail for an agent with no context to implement (features should generally be 100+ characters)
- Specifies files to create/modify
- References patterns to follow in existing code
- Includes edge cases and boundaries

**Acceptance criteria quality:**

- Each criterion is objectively verifiable
- Criteria are specific (name exact functions, files, behaviors)
- Each criterion tests one thing
- A verification command is the last criterion (e.g., `"pnpm test && pnpm typecheck passes"`)

**Title quality:**

- Imperative mood ("Add X", not "Adding X" or "X feature")
- Under 80 characters
- Meaningful without reading the description

**specReferences usage:**

- Items implementing spec-defined behavior should have `specReferences` pointing to the relevant docs
- Referenced files must actually exist in the project
- References should be specific enough to be useful (prefer `docs/SPEC-CORE.md` over a generic `docs/` if the item only needs one spec)

### 5. Dependencies

Validate the dependency graph:

- **No circular dependencies** — trace every dependency chain to confirm it terminates
- **No phantom dependencies** — every ID in `dependsOn` must exist in the backlog
- **Not over-constrained** — items that touch different parts of the codebase independently shouldn't be chained
- **Not under-constrained** — items that import types/functions from another item should depend on it
- **Done dependencies** — if an item depends on a `done` item, that's fine; if it depends on a `blocked` item, flag it

### 6. Sizing

Check each item is right-sized for a single loop iteration:

- **Too large** — touches 10+ files, has 15+ acceptance criteria, description is 500+ words, or combines multiple logical changes ("and then also...")
- **Too small** — trivial one-line changes that could be folded into an adjacent item
- **agentDelegation opportunities** — items with clearly independent subtasks that could benefit from parallel execution but don't use `agentDelegation`
- **Inappropriate agentDelegation** — items using delegation where subtasks are actually interdependent

### 7. Structural

Check schema conformance:

- All required fields present on every item
- IDs are sequential zero-padded strings with no gaps (unless gaps are from done items). Non-numeric IDs (e.g. `"notif-001"`) are tolerated but numeric IDs are preferred.
- `type` is one of the valid enum values
- `priority` is 1-4
- `status` is a valid value
- `completedAt` is present and set to `null` for pending/blocked items, ISO date for done items. Flag items where `completedAt` is missing entirely.
- Field naming: use `dependsOn` (not `dependencies`). Flag any items using the wrong field name — rauf can normalize this at read time, but the canonical name should be used.
- `dependsOn` contains only valid item IDs
- Project-level `project` and `description` fields are present and meaningful

## Anti-Patterns to Flag

Flag these with severity levels:

| Anti-Pattern         | Severity  | Description                                                                                 |
| -------------------- | --------- | ------------------------------------------------------------------------------------------- |
| God item             | CRITICAL  | 15+ acceptance criteria or 10+ files touched — must be split                                |
| Missing verification | CRITICAL  | No verification command in acceptance criteria                                              |
| Vague description    | IMPORTANT | Description under 100 chars for a feature item                                              |
| Priority inflation   | IMPORTANT | More than 60% of items are priority 1                                                       |
| Phantom dependency   | CRITICAL  | `dependsOn` references a non-existent item ID                                               |
| Circular dependency  | CRITICAL  | Dependency chain forms a cycle                                                              |
| Wrong type           | INFO      | Item classified as wrong type (e.g., a feature called a chore)                              |
| Orphan item          | INFO      | Item that nothing depends on AND doesn't depend on anything (may be fine, but worth noting) |
| Stale blocked        | IMPORTANT | Blocked item whose blocker has been resolved (dependency is now done)                       |
| Over-constrained     | IMPORTANT | Items chained by `dependsOn` that could run independently                                   |
| Under-constrained    | IMPORTANT | Item uses types/functions from another item but doesn't depend on it                        |

## Report Format

Present your findings in this structure:

### Coverage Map

The full requirement-to-item mapping table from dimension 1.

### Findings

Group by severity, then by dimension:

```
## CRITICAL

### [Dimension] Finding title
**Item(s):** 005, 012
**Issue:** Description of what's wrong
**Proposed fix:** Specific change to make

## IMPORTANT

### [Dimension] Finding title
...

## INFO

### [Dimension] Finding title
...
```

### Proposed New Items

For each gap, present the full JSON for the new item:

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

- Total items reviewed: X (Y pending, Z done, W blocked, V in_progress)
- Coverage: X/Y requirements covered
- Findings: X critical, Y important, Z info
- New items proposed: X
- Items to modify: X

## Applying Changes

After presenting the report, **wait for user approval** before making any changes.

When the user approves (in whole or in part):

1. Read the current `.rauf/backlog.json` again (it may have changed)
2. Apply only approved modifications to `pending` and `blocked` items
3. Append new items at the end, continuing the ID sequence
4. Never modify `done` or `in_progress` items
5. Write the updated file
6. Validate the result by reading it back and checking:
   - Valid JSON
   - No circular dependencies
   - All `dependsOn` references resolve
   - IDs are sequential
   - Schema conformance

## Interaction with the User

1. **Present the full report** with all 7 dimensions
2. **Ask which changes to apply** — the user may approve all, some, or none
3. **Apply approved changes** and confirm the result
4. If the user wants to iterate, re-review the modified backlog against the same reference documents
