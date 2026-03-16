---
name: create-ralph-backlog
description: >
  Create and populate a ralph backlog.json for the ralph autonomous coding loop.
  Use this skill ONLY when the user explicitly asks to create, populate, or generate
  a ralph backlog — e.g., "create the ralph backlog", "populate backlog.json",
  "generate the .ralph/backlog.json", "build the ralph task list", or "create backlog
  items for ralph". Do NOT trigger for general planning, task decomposition, or work
  breakdown requests that don't specifically mention ralph or backlog.json.
---

# Create Ralph Backlog

You are creating a `backlog.json` file for a ralph autonomous coding loop. The ralph loop is an automated agent that picks up tasks one at a time, implements them, runs verification, and commits — so the quality of your backlog directly determines how effectively the loop operates.

## Before You Start

1. **Read the input material** — specs, docs, descriptions, or whatever the user provides
2. **Read the target project's structure** if it exists — understand what code is already there
3. **Read `.ralph/backlog.schema.json`** in the target project (or use the schema reference below) to confirm the exact shape
4. **Check for an existing `.ralph/backlog.json`** — if one exists, understand what's already there before overwriting

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
      "status": "pending",
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
- `id` — Zero-padded sequential string: "001", "002", etc. Never reused.
- `type` — One of: `feature`, `bug`, `refactor`, `chore`
- `priority` — Integer 1-4 (1 = highest, 4 = lowest)
- `title` — Short imperative phrase (like a commit message subject)
- `description` — Detailed explanation of the work
- `acceptanceCriteria` — Array of checkable statements
- `status` — Always `"pending"` for new items
- `completedAt` — Always `null` for new items

### Optional fields
- `dependsOn` — Array of item IDs that must be `done` first
- `notes` — Free-text hints, context, gotchas for the agent
- `estimatedIterations` — How many loop cycles this might take (default: 1)
- `model` — Per-item model override (e.g., `"claude-opus-4-6"` for complex tasks, `"claude-sonnet-4-6"` for simpler ones)
- `agentDelegation` — Parallelization hints (see below)
- `specReferences` — File paths to specs the agent should read before starting
- `provider` — Per-item LLM provider override

## Decomposition Strategy

The ralph loop processes ONE item per iteration. Each item should be:

### Right-sized
- **Completable in a single loop iteration** (typically 5-15 minutes of agent work)
- A good item touches 1-5 files. If you're describing changes across 10+ files, split it up
- If you find yourself writing "and then also..." in a description, that's two items
- Exception: items with `agentDelegation` can be larger because sub-agents handle parallel work

### Ordered by dependency, then priority
- Items that other items depend on come first (lower ID numbers)
- Within the same dependency tier, order by priority (1 before 4)
- The loop's item selector respects `dependsOn` — it won't pick an item whose dependencies aren't `done`

### Independent where possible
- Minimize dependencies between items. The fewer `dependsOn` entries, the more flexibility the loop has
- Items that CAN run in parallel SHOULD be independent (no shared `dependsOn` chains)
- Group related changes that MUST be atomic into a single item rather than splitting with dependencies

## How to Write Each Field

### `type` — Categorizing work

| Type | Use when... | Examples |
|------|-------------|----------|
| `feature` | Adding new functionality that didn't exist before | New API endpoint, new UI component, new module |
| `bug` | Fixing something that's broken or behaving incorrectly | Fix crash on empty input, correct calculation error |
| `refactor` | Restructuring existing code without changing behavior | Extract module, rename across codebase, reorganize files |
| `chore` | Non-functional work: docs, config, CI, dependencies | Update docs, add CI pipeline, bump dependencies |

### `priority` — What matters most

| Priority | Meaning | Use when... |
|----------|---------|-------------|
| 1 | Critical | Foundational work everything depends on; blocking issues |
| 2 | High | Core features needed for the milestone; important fixes |
| 3 | Medium | Nice-to-have features; non-critical improvements |
| 4 | Low | Polish, cleanup, documentation; do last |

**Guideline:** In a typical backlog, most items should be priority 1-2. If everything is priority 1, you haven't differentiated enough. If most things are priority 3-4, reconsider whether they're needed at all.

### `title` — Imperative, concise

Write titles as imperative commands, like commit message subjects:
- "Add user authentication endpoint" (not "User authentication" or "Adding auth")
- "Fix race condition in queue processor" (not "Queue processor bug")
- "Rename ClaudeProcess to LlmProcess across codebase" (not "Renaming stuff")

Keep titles under 80 characters. The title should be meaningful enough that someone scanning the backlog understands what the item does without reading the description.

### `description` — The agent's complete briefing

The description is the most important field. The autonomous agent reads this to understand what to implement. Write it as if briefing a skilled developer who has access to the codebase but no other context.

**Include:**
- What to create, modify, or fix — be specific about files and functions
- The approach: which patterns to follow, which existing code to reference
- What NOT to do: boundaries, things to leave alone, common mistakes to avoid
- Concrete details: function signatures, schema shapes, config keys — the agent works better with specifics

**Structure for different types:**

For **features**, describe:
- What files to create or modify
- The interface/API surface (function signatures, endpoints, component props)
- How it integrates with existing code
- Edge cases to handle

For **bugs**, describe:
- The current incorrect behavior
- The expected correct behavior
- The root cause (if known)
- The fix approach

For **refactors**, describe:
- What's being restructured and why
- The before/after code organization
- What must NOT change (external behavior, API contracts)
- Migration steps if relevant

For **chores**, describe:
- Exactly what needs updating
- The target state
- Any validation to perform

### `acceptanceCriteria` — The definition of done

Each criterion should be a **verifiable statement** that the agent can check. The loop won't mark an item as done unless all criteria pass.

**Good criteria are:**
- Objectively verifiable (can be checked by running a command, reading code, or testing behavior)
- Specific (names exact functions, files, behaviors)
- Independent (each one checks one thing)

**Examples of good acceptance criteria:**
```json
[
  "UserService.create() returns Result<User, ValidationError>",
  "POST /api/users returns 201 with user object on success",
  "POST /api/users returns 400 with error details for invalid email",
  "Unit test covers: valid input, duplicate email, missing required fields",
  "pnpm test && pnpm typecheck passes"
]
```

**Always include a verification criterion** as the last item:
- For code changes: `"pnpm test && pnpm typecheck passes"` (or whatever the project's verify command is)
- For config/docs: `"No TypeScript errors introduced"` or similar

**Anti-patterns to avoid:**
- "Works correctly" — too vague, not verifiable
- "Code is clean" — subjective
- "Handles edge cases" — which ones? List them
- "Performance is acceptable" — define the threshold

### `dependsOn` — Execution order constraints

Only add dependencies when there's a genuine technical reason:
- Item B imports types defined in item A → B depends on A
- Item B modifies a function that item A creates → B depends on A
- Item B runs tests that require infrastructure from item A → B depends on A

Do NOT add dependencies for:
- Logical ordering preference ("it makes sense to do this first")
- Risk reduction ("let's see if this works before doing that")
- Items that touch different parts of the codebase independently

### `notes` — Agent hints and context

Use notes for information that doesn't fit in the description:
- References to external docs or spec sections
- Known gotchas or tricky parts ("The parser uses 1-based indexing, not 0-based")
- Architecture decisions that explain WHY ("We use atomic writes here because the loop runner may crash mid-write")
- Hints about testing approach ("Use the mock binary from tests/fixtures/")
- Links between items ("This lays the groundwork for items 005-007")

### `estimatedIterations` — Multi-iteration work

Most items should take 1 iteration (the default). Set `estimatedIterations` to 2+ only when:
- The item involves substantial implementation AND testing that realistically needs multiple passes
- The scope is intentionally large because splitting would lose atomicity
- The agent will likely need to iterate on getting tests/types right

The loop uses this hint to plan but doesn't enforce it — an item can take more or fewer iterations than estimated.

### `agentDelegation` — Parallel execution

Use `agentDelegation` when a task has clearly independent subtasks that can run in parallel. The ralph loop agent will spawn sub-agents using the Task tool for each subtask.

```json
{
  "agentDelegation": {
    "recommendedConcurrency": 3,
    "strategy": "Each sub-agent handles one provider adapter independently. They share the LLMProvider interface but don't touch each other's files.",
    "subtasks": [
      "Implement OpenAI Codex CLI provider in providers/openai-codex.ts with tests",
      "Implement Gemini CLI provider in providers/gemini-cli.ts with tests",
      "Implement generic CLI provider in providers/generic-cli.ts with tests"
    ]
  }
}
```

**When to use agentDelegation:**
- Multiple files need similar but independent changes (e.g., adding the same field to 5 different components)
- Multiple new modules need creating with no cross-dependencies (e.g., multiple provider adapters)
- A broad refactor touches many files but each file change is independent

**When NOT to use it:**
- The subtasks have ordering dependencies (use separate items with `dependsOn` instead)
- The changes are tightly coupled (one sub-agent's output affects another's input)
- There's only 2 subtasks with very small scope (overhead of delegation exceeds benefit)

**Writing good subtask descriptions:**
Each subtask string must be self-contained — the sub-agent gets ONLY this string plus access to the codebase. Include:
- Exactly which file(s) to create or modify
- What interface/pattern to follow (reference existing code)
- Whether to write tests (and where to put them)

### `specReferences` — Pointing the agent to docs

List file paths (relative to project root) of spec documents the agent should read before starting work:

```json
{
  "specReferences": ["docs/ARCHITECTURE.md", "docs/SPEC-CORE.md"]
}
```

Use this when:
- The item implements a specific section of a spec
- There's architectural context the agent needs that isn't in the description
- The description references design decisions documented elsewhere

### `model` — Right-sizing the intelligence

Use `model` to assign appropriate AI capability to each task:
- Complex architectural work, novel implementations → `"claude-opus-4-6"` (or omit for default)
- Straightforward mechanical changes, well-specified tasks → `"claude-sonnet-4-6"`
- Simple chores, docs updates → `"claude-haiku-4-5-20251001"`

## Backlog-Level Fields

### `project`
The human-readable project name. Use the actual project name, not a path.

### `description`
A brief description of what this backlog represents — the milestone, initiative, or goal. This gives the agent context for understanding how individual items fit together.

Example: "LLM-agnostic execution architecture — decouple loop runner from Claude Code, support multiple providers via adapter pattern"

## Output

Write the complete backlog.json to `.ralph/backlog.json` in the target project directory. The file must:
1. Be valid JSON
2. Conform to the schema above
3. Have all items in `"pending"` status with `"completedAt": null`
4. Have properly sequenced IDs ("001", "002", "003"...)
5. Have no circular dependencies
6. Have no references to non-existent item IDs in `dependsOn`

After writing, validate by reading back and checking the structure. If the project has a `backlog.schema.json`, validate against it.

## Common Patterns

### The foundation-first pattern
For greenfield work, start with schema/types (priority 1), then core implementation (priority 1-2), then integration/UI (priority 2), then polish/docs (priority 3-4). Each layer depends on the one before it.

### The parallel providers pattern
When implementing multiple similar adapters/implementations of an interface, create the interface first (item 001), then multiple independent items (002, 003, 004) that all `dependsOn: ["001"]` but not each other. Use `agentDelegation` if they can fit in one item.

### The refactor-then-extend pattern
When adding a feature to messy code, create a refactor item first (clean up the module, extract interfaces) and then the feature item depends on it. This gives the agent a clean surface to work with.

### The test-alongside pattern
Don't create separate "write tests for X" items. Include testing in the acceptance criteria of the implementation item. The agent should write tests as part of implementing the feature, not as an afterthought.

## Checklist Before Finalizing

- [ ] Every item has specific, verifiable acceptance criteria (not vague statements)
- [ ] Descriptions are detailed enough for an agent with no context to implement
- [ ] Dependencies form a DAG (no cycles)
- [ ] The dependency graph isn't over-constrained (items that could run independently aren't chained)
- [ ] Items are right-sized (1 iteration unless justified)
- [ ] `agentDelegation` used where genuine parallelism exists
- [ ] A verification command criterion is on every code-change item
- [ ] IDs are sequential and zero-padded
- [ ] All statuses are "pending" and completedAt is null
- [ ] The project name and description accurately describe the work

## Interaction with the User

After drafting the backlog, present a summary to the user:
1. Total items, broken down by type and priority
2. The dependency graph (which items block which)
3. Items with `agentDelegation` and their parallelism strategy
4. Any assumptions you made or questions you have

Wait for the user to approve before writing the file. The backlog is the plan — it should be reviewed before execution begins.
