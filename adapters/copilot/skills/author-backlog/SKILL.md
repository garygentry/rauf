---
# GENERATED — DO NOT EDIT. Source: skills/author-backlog/SKILL.md. Regenerate: bun run scripts/build-copilot-bundle.ts
name: author-backlog
description: >
  Author a high-quality rauf backlog.json — well-scoped, verifiable items for the
  rauf autonomous coding loop. Use this skill when the user asks to "create a rauf
  backlog", "author a backlog", "build a rauf backlog", "populate backlog.json",
  "generate the .rauf/backlog.json", "add backlog items", or "create the rauf task
  list". Serves BOTH the repo-wide ad-hoc flow AND feature-pipeline tools (e.g.
  feature-forge) that delegate backlog authoring here — parameterized by a target
  backlog directory (default `<project>/.rauf/`, or `--backlog <dir>` for
  feature/multi-backlog setups). Do NOT trigger for general planning or work
  breakdown that doesn't specifically mention a rauf backlog.
---

# Author Rauf Backlog

You are authoring a `backlog.json` file for a rauf autonomous coding loop. The rauf loop is an automated agent that picks up one task at a time, implements it, runs verification, and commits — so the quality of your backlog directly determines how effectively the loop operates. Each item runs in a FRESH context: every item description must be fully self-contained.

This skill is the canonical home for backlog-authoring craft. It serves two flows:

- **Ad-hoc / repo-wide:** the backlog lives at `<project>/.rauf/backlog.json`.
- **Feature pipeline / multi-backlog:** a tool (e.g. feature-forge) delegates here with a target backlog directory, e.g. `<specsDir>/<feature>/`. The backlog file is `<backlogDir>/backlog.json` and specs live in a sibling specs directory.

Throughout this document, `<backlogDir>` means the chosen target directory and `<project>` means the project root.

The full machine contract — CLI flags, exit codes, JSON shape, schema source rules — is specified in `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` (Part A). Read it if you need the authoritative details; this skill summarizes the authoring-relevant parts.

## Target Backlog Directory

**There are exactly two valid backlog locations. Do not invent a third.**

1. **Repo-wide / ad-hoc → `<project>/.rauf/backlog.json`** — the project's one and only state
   directory. This is where you author when working the repo on your own initiative (no
   pipeline caller). Even for a "separate" or "temporary" batch of work, this is still the home:
   one project, one backlog, reused across cycles.
2. **Feature pipeline / multi-backlog → a caller-supplied `--backlog <specsDir>/<feature>/`** —
   a feature-scoped directory under the specs tree, its state dir derived automatically as
   `<backlogDir>/.rauf/`. This is legitimate **only when a caller/pipeline tool (e.g.
   feature-forge) passes the dir**. Write `<backlogDir>/backlog.json`; specs may live in a
   separate `--specs-dir <dir>`.

**Do NOT create a bespoke or nested `.rauf/`-style directory** — e.g. `subdir/.rauf/`,
`.rauf-experiment/`, `.rauf-foo/`, or a second top-level backlog — to hold "a separate batch of
work." `rauf` recursively discovers every directory containing a `backlog.json`, so each stray
backlog shows up as a candidate in `rauf status` disambiguation and the web root selector,
cluttering the list and leaving the next reader unable to tell which backlog is live. It is
never archived or cleaned by the normal lifecycle.

**If you feel the urge to make a new dir, redirect it:**

- _Want to run a focused/temporary batch that isn't the current backlog?_ → use the main
  `<project>/.rauf/` backlog. If it's full of `done` items, **reset it first** (see
  [Resetting a Completed Backlog](#resetting-a-completed-backlog)) — don't fork a new dir to
  avoid the reset.
- _Genuinely a parallel feature with its own lifecycle?_ → that's the feature-pipeline case:
  use `--backlog <specsDir>/<feature>/`, and only when a caller/pipeline drives it. Don't
  conjure one unprompted.

So: if a pipeline **caller** passed an explicit `--backlog` dir, honor it. Otherwise default to
`<project>/.rauf/` — never substitute a directory of your own making.

## Before You Start

1. **Read the input material** — specs, plans, docs, or whatever the user/caller provides.
2. **Read the target project's structure** if it exists — understand what code is already there.
3. **Resolve the schema source** (see below) to confirm the exact item shape.
4. **Check for an existing `backlog.json`** in the target dir. If one exists, understand what's already there, then pick the right path — do NOT hand-edit `backlog.json` to make room:
   - **All items `done` / nothing `pending`** (a finished cycle) → the backlog must be **reset before authoring**, not hand-edited. Go to [Resetting a Completed Backlog](#resetting-a-completed-backlog).
   - **Some `pending` / `in_progress` items remain** (an in-flight backlog) → the user wants to **add** items. Append, continuing IDs from the highest existing one — do NOT reset.
   - **Empty or no backlog** → author normally.
5. **Read `references/backlog-examples.md`** for gold-standard example items.

## Resetting a Completed Backlog

_Applies to the **default `<project>/.rauf/` backlog** only — see the caveats at the end._

When a loop cycle finishes, `.rauf/backlog.json` is left full of `done` items with nothing
`pending`, so the loop won't run again. Starting a fresh cycle means **clearing the old
backlog first, then authoring new items** — but this is where agents commonly go wrong.

**Never hand-edit `backlog.json` to clear it.** Emptying the `items` array by hand loses the
completed history and desyncs `state.json` / `DONE` / `CANCEL` markers. Use the CLI, which
archives everything and resets state atomically:

```bash
rauf backlog reset <projectPath> --clear --yes
```

**Full reset (`--clear`)** — the normal "new cycle" case — does all of this:

- `done` items → archived to `.rauf/archive/YYYY-MM.json` (grouped by completion month).
- `progress.md` and `rauf.log` → archived with timestamped names, and a fresh `progress.md`
  template is redeployed (`rauf.log` is recreated on the next run).
- The `items` array is **emptied** (top-level `project` / `description` metadata preserved).
- `state.json` deleted; `DONE` / `CANCEL` markers cleared; any `in_progress` items reset to
  `pending`.

**Soft reset** (omit `--clear`) archives `done` items and clears state but **keeps** the
`items` array, `progress.md`, and `rauf.log` — use it only when you're re-running the same
backlog, not repopulating. `--keep-progress` / `--keep-log` preserve those files during a
`--clear` reset.

**Propose, then run — don't surprise-destroy.** First show the user what will be archived, then
run the reset:

```bash
rauf backlog list <projectPath> --status done   # summarize how many items will be archived
rauf backlog reset <projectPath> --clear --yes  # then reset
```

This mirrors the skill's "wait for approval before writing" discipline. After the reset, the
backlog is empty — **author fresh items** per the rest of this skill and finish with
`rauf backlog validate` (see [Validate](#validate--run-the-cli)).

**Caveats:**

- **Multi-backlog / feature-pipeline (`--backlog <dir>`):** skip this section entirely. Those
  backlogs live outside a project `.rauf/` and are managed by the pipeline tool (e.g.
  feature-forge), not `rauf backlog reset`.
- **Self-hosting / live loops:** never run `reset` against a project whose loop is currently
  running (e.g. rauf's own `.rauf/` while it is self-hosting). Reset is a between-cycles
  operator action, not something to do mid-loop.

## Schema Source

The backlog item shape is defined by a Zod-generated JSON Schema. To confirm the exact contract, resolve the schema in this order:

1. **PREFER the installed copy:** `<backlogDir>/.rauf/backlog.schema.json`, falling back to `<project>/.rauf/backlog.schema.json`. An installed rauf project ships this local copy.
2. **FALL BACK to the published `$id` URL** if no installed copy is present:
   `https://raw.githubusercontent.com/garygentry/rauf/main/schemas/backlog.schema.json`

Never hard-fail just because the installed copy is missing — fall back to the published URL. **Never vendor a schema copy** inside this skill or the project; always reference the installed file or the published `$id`.

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
      "description": "Full, self-contained description of what to do",
      "acceptanceCriteria": ["Each criterion is a checkable statement"],
      "status": "pending",
      "completedAt": null,
      "dependsOn": ["000"],
      "notes": "Context, links, hints for the agent",
      "estimatedIterations": 1,
      "agentDelegation": {
        "recommendedConcurrency": 3,
        "strategy": "How to parallelize",
        "subtasks": ["Subtask 1", "Subtask 2", "Subtask 3"]
      },
      "specReferences": ["docs/SPEC.md"]
    }
  ]
}
```

> The shape above omits `provider` and `model` on purpose — that's the portable
> default. Add them only for an item that intentionally requires a specific agent
> or Claude tier (see the optional-fields notes below).

### Top-level fields

- `schemaVersion` — **Optional** string, default `"1"`. Authors MAY omit it; rauf stamps it on read. Don't require it.
- `project` — Human-readable project name (not a path).
- `description` — Brief description of what this backlog represents — the milestone, initiative, or goal. Gives the agent context for how items fit together.
- `items` — The array of work items.

### Required item fields

- `id` — Zero-padded sequential string: `"001"`, `"002"`, etc. Never reused. Numeric IDs are strongly preferred for consistent ordering; any non-empty string is accepted.
- `type` — One of exactly: `bug`, `bugfix`, `refactor`, `feature`, `chore`, `test`.
- `priority` — Integer 1–4 (1 = highest, 4 = lowest).
- `title` — Short imperative phrase (like a commit subject), under ~80 chars.
- `description` — Detailed, self-contained explanation of the work.
- `acceptanceCriteria` — Array of objectively checkable statements.
- `status` — Always `"pending"` for new items.
- `completedAt` — Always `null` for new items.

### Optional item fields

- `dependsOn` — Array of item IDs that must be `done` first. **Use `dependsOn`, never `dependencies`.**
- `notes` — Free-text hints, context, gotchas for the agent.
- `estimatedIterations` — Expected loop cycles (default: 1).
- `model` — Per-item model override. **Omit by default** so the item stays portable across agents. Only set it to opt into a **Claude tier** (`"opus"`, `"sonnet"`, `"opus[1m]"`) — tier aliases are Claude-only and bind the item to Claude agents. See [`model` — Right-sizing the intelligence (opt-in, Claude-only)](#model--right-sizing-the-intelligence-opt-in-claude-only).
- `agentDelegation` — Parallelization hints (`recommendedConcurrency`, `strategy`, `subtasks`).
- `specReferences` — File paths (relative to project root) of specs the agent should read before starting.
- `provider` — Per-item agent/provider override (e.g. `"claude-cli"`, `"codex"`). **Omit by default.** rauf's precedence is `item.provider > --agent`, so a per-item `provider` **overrides the run-level `--agent` selection** and makes that item non-portable — an item pinned to `"claude-cli"` ignores `rauf loop run --agent codex`. Set it only when an item intentionally requires a specific agent, and say why in `notes`.

### Enums — get these exactly right

- **`type`** is EXACTLY one of: `bug | bugfix | refactor | feature | chore | test`. Do not invent `docs` and do not drop `bugfix` or `test`.
- **`status`** is EXACTLY one of: `pending | in_progress | done | blocked`. NOT `complete`, NOT `in-progress`, NOT `docs`. New items are always `pending`.

| Type       | Use when...                                              | Examples                                                 |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `feature`  | Adding new functionality that didn't exist before        | New API endpoint, new UI component, new module           |
| `bug`      | A defect to investigate/fix (cause may be unknown)       | Crash on empty input, incorrect calculation              |
| `bugfix`   | A scoped fix for a known defect                          | Apply the patch for the queue race condition             |
| `refactor` | Restructuring existing code without changing behavior    | Extract module, rename across codebase, reorganize files |
| `chore`    | Non-functional work: docs, config, CI, dependencies      | Update docs, add CI pipeline, bump dependencies          |
| `test`     | Adding or strengthening tests as the primary deliverable | Add coverage for the auth edge cases                     |

(Prefer folding tests into the implementation item's acceptance criteria — use a standalone `test` item only when the test work is the deliverable.)

## Decomposition Strategy

The rauf loop processes ONE item per iteration. Each item should be:

### Right-sized

- **Completable in a single loop iteration** and produce a WORKING increment — after the item, the code should typecheck and any new tests should pass.
- A good item touches at most 5–8 files (fewer is better). If you're describing changes across more files than that, split it.
- **Hard limits:** if an item's description exceeds ~300 words, STOP and split it before continuing. If an item modifies more than ~6 files, it MUST be split — no exceptions.
- If you find yourself writing "and then also..." in a description, that's two items.
- Exception: items with `agentDelegation` can be larger because sub-agents handle parallel work that shares one verification step.
- Foundation items (scaffold, shared types, error hierarchy) should be separate from feature items. Integration wiring (connecting the new feature into existing code) should be its own item(s), not buried in feature items.

### Ordered by dependency, then priority

- Items that others depend on come first (lower ID numbers). Items with no dependencies get the lowest numbers.
- Within the same dependency tier, order by priority (1 before 4).
- The loop's item selector respects `dependsOn` — it won't pick an item whose dependencies aren't `done`.

### Independent where possible

- Minimize dependencies. The fewer `dependsOn` entries, the more flexibility the loop has.
- Items that CAN run in parallel SHOULD be independent (no shared `dependsOn` chains).
- Group changes that MUST be atomic into a single item rather than splitting with dependencies.

## How to Write Each Field

### `title` — Imperative, concise

Write titles as imperative commands, like commit message subjects:

- "Add user authentication endpoint" (not "User authentication" or "Adding auth")
- "Fix race condition in queue processor" (not "Queue processor bug")
- "Rename ClaudeProcess to LlmProcess across codebase" (not "Renaming stuff")

Keep titles under ~80 characters and meaningful enough to scan without reading the description.

### `description` — The agent's complete briefing

The description is the most important field. The autonomous agent reads ONLY this (plus the codebase and any `specReferences`) to understand what to implement. Write it for a skilled developer who has the codebase but no other context. Never write "same as above" or "continue from the previous item."

**Include:**

- Exact files to create or modify.
- The interface/API surface — function signatures, endpoints, component props, types.
- Exact import paths.
- The approach: which patterns to follow, which existing code to reference.
- What NOT to do: boundaries, things to leave alone, common mistakes to avoid.
- Numbered steps (1, 2, 3...) for multi-part work.
- Any gotchas or special considerations.

**Structure by type:**

- **features:** files to create/modify, the interface, how it integrates, edge cases.
- **bug / bugfix:** current incorrect behavior, expected behavior, root cause (if known), the fix approach.
- **refactor:** what's restructured and why, before/after organization, what must NOT change (external behavior, contracts), migration steps.
- **chore:** exactly what to update, the target state, any validation.
- **test:** what behavior to cover, where the tests live, the command that proves coverage.

### `acceptanceCriteria` — The definition of done

Each criterion is a **verifiable statement** the agent can check. The loop won't mark an item `done` unless all criteria pass.

**Good criteria are:**

- Objectively verifiable (checkable by running a command, reading code, or testing behavior).
- Specific (name exact functions, files, behaviors).
- Independent (each checks one thing).

**Examples of good acceptance criteria:**

```json
[
  "UserService.create() returns Result<User, ValidationError>",
  "POST /api/users returns 201 with the user object on success",
  "POST /api/users returns 400 with error details for an invalid email",
  "Unit test covers: valid input, duplicate email, missing required fields",
  "pnpm test && pnpm typecheck passes"
]
```

**Always include a verification criterion** as the last item. Use the project's actual verify command (read it from the project's `.rauf.json` profile or `.rauf/RAUF.md` if available):

- Code changes: `"pnpm test && pnpm typecheck passes"` (or `"bun run typecheck passes for @repo/auth"`, `"mypy src/auth/ passes"`, `"go vet ./auth/... passes"` — match the stack).
- Config/docs: `"No TypeScript errors introduced"` or similar.

**Anti-patterns to avoid:**

- "Works correctly" — too vague, not verifiable.
- "Code is clean" — subjective.
- "Handles edge cases" — which ones? List them.
- "Performance is acceptable" — define the threshold.

**Generated artifacts and `--check` freshness gates.** If the project's verify command gates on
staleness of **generated** artifacts — sub-commands of the shape `<generator> --check` / `--verify`
/ `:check` that fail when a checked-in generated file is out of date with its source — then an item
that regenerates **one** such artifact must regenerate **and commit all** the sibling artifacts
those same `--check` gates depend on. Enumerate the whole gated set from the verify command, not
just the artifact the item is "about": regenerating `partner-programs` + `analysis` but skipping
`benchmarks` when the gate runs `build-benchmarks --check` leaves a stale generated file that
red-gates every commit, even though the code change itself is correct. Spell the full
regeneration + commit sequence into the item's description/steps and add the verify command as the
last acceptance criterion so the staleness gate actually runs.

**Human-gated or published artifact states.** If an item's acceptance criteria (or a test it adds)
assert that a named artifact is in a **human-gated lifecycle state** — _published_, _released_,
_approved_, _reviewed_, _signed-off_ — that state must be **produced by a real item the test item
depends on**, not conjured by the test itself. The autonomous loop cannot publish a package, cut a
release, or stand in for a human reviewer; handed a test whose only path to green is "artifact X is
published / approved", it will **fabricate** the publication or sign-off to make the check pass — a
provenance defect. So a test/e2e item asserting such a state must either (a) `dependsOn` an explicit,
human-gated publish/review item that legitimately produces it, or (b) assert the state via a
**dev-build / fixture path** (a local build output, a seeded fixture) instead of the real gated
artifact. Never let a test item be the **sole driver** of a lifecycle transition another item pins
the other way — one item keeps `X` _draft_, a test demands it _published_, and nothing between them
publishes it.

### `dependsOn` — Execution order constraints

Use `dependsOn` (never `dependencies`). Only add a dependency when there's a genuine technical reason:

- Item B imports types/functions defined in item A → B depends on A.
- Item B modifies a function that item A creates → B depends on A.
- Item B runs tests that require infrastructure from item A → B depends on A.

Do NOT add dependencies for logical-ordering preference, risk reduction ("let's see if this works first"), or items that touch different parts of the codebase independently. The most common dependency mistake is the opposite, though: if item 005 imports types created by item 002, it MUST list `"002"` in `dependsOn`, even if it seems obvious.

### `notes` — Agent hints and context

Use notes for information that doesn't fit in the description:

- References to external docs or spec sections.
- Known gotchas ("The parser uses 1-based indexing, not 0-based").
- Architecture decisions that explain WHY ("We use atomic writes here because the loop runner may crash mid-write").
- Testing-approach hints ("Use the mock binary from tests/fixtures/").
- Links between items ("This lays groundwork for items 005–007").

### `estimatedIterations` — Multi-iteration work

Most items take 1 iteration (the default). Set 2+ only when the work realistically needs multiple passes (substantial implementation AND testing) or the scope is intentionally large because splitting would lose atomicity. The loop uses this as a hint, not a hard cap.

### `agentDelegation` — Parallel execution

Use `agentDelegation` when a task has clearly independent subtasks that can run in parallel and share a single verification step. The loop agent spawns sub-agents (via the Task tool) for each subtask.

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

**When to use it:**

- Multiple files need similar but independent changes (same field added to 5 components; multiple route handlers/command groups).
- Multiple new modules need creating with no cross-dependencies (multiple provider adapters).
- A broad refactor touches many files but each file change is independent.
- An item is large but its parts share one verification step and must ship together — parallelize internally rather than splitting into separate backlog items.

**When NOT to use it:**

- Subtasks have ordering dependencies (use separate items with `dependsOn` instead).
- Subtasks are tightly coupled (one sub-agent's output is another's input).
- Each subtask has its own independent verification step — split into separate items instead.
- Only 1–2 small subtasks — delegation overhead exceeds the benefit.

**Writing good subtask descriptions:** each subtask string is self-contained — the sub-agent gets ONLY this string plus codebase access. Include exactly which file(s) to create/modify, what interface/pattern to follow (reference existing code), and whether to write tests (and where). Set `recommendedConcurrency` to match the number of subtasks.

### `specReferences` — Pointing the agent to docs

List file paths **relative to the project root** (e.g., `specs/auth/00-core-definitions.md`, `docs/SPEC-CORE.md`), NOT relative to the backlog file. `rauf backlog validate --specs-dir …` resolves these from the project root and flags any that don't exist (or that are absolute / escape the project root), so make sure each file actually exists. Use this when the item implements a specific spec section or relies on architectural context not in the description.

### `model` — Right-sizing the intelligence (opt-in, Claude-only)

**Default → omit `model`.** Leave it off and the item inherits whatever agent the
loop is launched with (`rauf loop run --agent <agent>`, or the project default).
This keeps the backlog **agent-portable** — the same items run under Claude, Codex,
or any other provider without edits.

> **Tier aliases are Claude-only.** `"opus"`, `"sonnet"`, `"haiku"`, and the `[1m]`
> suffix are **Claude tier aliases**, not provider-neutral values. rauf's resolution
> precedence is `item.model > --agent`, so a value written here is forwarded
> **verbatim** to whatever agent runs the loop. Under a non-Claude agent it is not
> recognized and the spawn fails — e.g. Codex returns
> `The 'sonnet' model is not supported when using Codex with a ChatGPT account`,
> every iteration exits 1, and rauf halts on the circuit breaker
> (`3 consecutive infra failures`) with no hint of the cause. **An item with a tier
> alias is silently bound to Claude agents.** Only set `model` when the user has
> explicitly chosen Claude _and_ wants per-item tiering. If you're unsure which
> agent the backlog will run under, omit it.

When the user has opted into Claude tiering, prefer **tier aliases** over pinned
model ids — an alias tracks the latest model in its tier, so a backlog written today
doesn't pin to a model that ages out. `claude --model` accepts these aliases (and the
`[1m]` suffix) verbatim.

- **Complex / architectural → `"opus"`** — the latest Opus (200K context). Best for novel implementations and architectural work.
- **Simple / mechanical → `"sonnet"`** — well-specified, low-ambiguity tasks (small edits, mechanical refactors, docs touch-ups). Cheaper and faster than Opus.
- **Needs the 1M window → `"opus[1m]"`** — use **only** for items that genuinely require the 1M-token context window: large-codebase reads, long multi-file refactors, or tasks that must hold many large files in context at once. The 1M window is **opt-in** — it is enabled solely by the `[1m]` suffix on the alias (or on a full model id). Standard Opus is 200K; `opus[1m]` raises it to 1M with **no cost premium** over standard Opus (note: Sonnet's 1M window, by contrast, requires extra credits — Opus 1M does not). Do **not** add `[1m]` by default — only when the work needs it.

## Common Patterns

- **Foundation-first:** for greenfield work, start with schema/types (priority 1), then core implementation (1–2), then integration/UI (2), then polish/docs (3–4). Each layer depends on the one before it.
- **Parallel providers:** create the interface first (001), then multiple independent items (002, 003, 004) that all `dependsOn: ["001"]` but not each other. Use `agentDelegation` if they fit in one item.
- **Refactor-then-extend:** when adding a feature to messy code, create a refactor item first (clean up, extract interfaces) and have the feature item depend on it.
- **Test-alongside:** don't create separate "write tests for X" items by default. Include testing in the implementation item's acceptance criteria. Use a standalone `test` item only when the testing is the deliverable.

## Output

Write the complete backlog to `<backlogDir>/backlog.json`. The file must:

1. Be valid JSON.
2. Conform to the resolved schema.
3. Have every item in `"pending"` status with `"completedAt": null`.
4. Have properly sequenced, zero-padded IDs (`"001"`, `"002"`, ...).
5. Have no circular dependencies.
6. Have no `dependsOn` references to non-existent item IDs.
7. Use `dependsOn` (never `dependencies`) and only valid enum values.

`schemaVersion` may be omitted; rauf stamps `"1"` on read.

## Validate — Run the CLI

Validation is done by RUNNING THE RAUF CLI. Never validate by reading the file back manually and eyeballing it, and never validate against a vendored schema copy.

After writing, run the validator and fix any findings until it passes:

**Repo-wide / default backlog:**

```bash
rauf backlog validate <projectPath>
```

**Feature / multi-backlog (explicit dirs, machine-readable output):**

```bash
rauf backlog validate <projectPath> --backlog <backlogDir> [--specs-dir <specsDir>] --json
```

**Exit codes:**

- `0` — valid.
- `1` — validation findings (errors). Read them, fix the backlog, re-run.
- `2` — usage/IO error (bad path, unreadable file). Fix the invocation.

With `--json`, the CLI emits `{ valid, findings[] }` — parse `findings` to drive your fixes. Do NOT present the backlog to the user as done until `rauf backlog validate` exits `0`.

## Checklist Before Finalizing

- [ ] Every item has specific, verifiable acceptance criteria (not vague statements).
- [ ] Descriptions are detailed and self-contained — implementable by an agent with no other context.
- [ ] Dependencies form a DAG (no cycles); no phantom `dependsOn` IDs.
- [ ] The dependency graph isn't over-constrained.
- [ ] Items are right-sized (≤5–8 files, ≤~300-word descriptions, 1 iteration unless justified).
- [ ] `agentDelegation` used where genuine parallelism exists (and concurrency matches subtask count).
- [ ] A verification command is the last acceptance criterion on every code-change item.
- [ ] IDs are sequential and zero-padded; all statuses `"pending"`, all `completedAt` `null`.
- [ ] Only valid enums: `type` in `bug|bugfix|refactor|feature|chore|test`, `status` in `pending|in_progress|done|blocked`.
- [ ] `project` and `description` accurately describe the work.
- [ ] Backlog is at one of the two sanctioned locations (`<project>/.rauf/` or a caller-supplied `--backlog <specsDir>/<feature>/`) — no bespoke or nested `.rauf/` dir was invented.
- [ ] If a completed backlog existed, it was **reset via `rauf backlog reset`** (not hand-edited) before authoring.
- [ ] `rauf backlog validate` exits `0`.

## Interaction with the User

After drafting (or before writing JSON for a large pipeline backlog), present a summary:

1. Total items, broken down by type and priority.
2. The dependency graph (which items block which) and chain depth.
3. Items with `agentDelegation` and their parallelism strategy.
4. Any assumptions you made or questions you have.

Wait for the user to approve before writing the file — the backlog is the plan and should be reviewed before execution. After writing, run `rauf backlog validate`, fix any findings, and confirm the validated result.

See `references/backlog-examples.md` for gold-standard items, and `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` (Part A) for the full machine contract.
