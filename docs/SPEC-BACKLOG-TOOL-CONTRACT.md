---
title: "Backlog-Tool / Loop-Runner Contract"
description: The protocol a ralph-style loop runner exposes so a pipeline tool can drive it (Part A), plus rauf's LLM-agnostic execution architecture (Part B). rauf is the default and reference implementation.
status: Part A is STABLE (current surface); Part B is HISTORICAL (the provider refactor it planned is now implemented — see the banner under "Part B")
---

# SPEC: Backlog-Tool / Loop-Runner Contract

This spec is the single authority for two **orthogonal** axes. Keep them
distinct:

- **Part A, Backlog-Tool / Loop-Runner Contract.** WHICH backlog tool / loop
  runner a pipeline talks to: the backlog schema, the signal protocol, the
  state-directory layout, and the CLI verbs a conforming runner exposes. This
  is the surface a pipeline (e.g. `feature-forge`) depends on. **rauf is the
  default and reference implementation.**
- **Part B, LLM-Agnostic Execution Architecture.** WHICH LLM drives a single
  rauf iteration (Claude Code, Codex, Gemini, and so on): the _provider_ axis.

> **Not to be confused.** "Loop runner" (Part A) is not "provider" (Part B).
> Swapping the runner (rauf for some other ralph tool) is a Part-A concern;
> swapping the LLM that the runner spawns is a Part-B concern. The word
> "provider" refers only to the Part-B axis. The state-directory layout and
> `.rauf.json` marker are defined **once**, authoritatively, in Part A §A.3;
> Part B references that definition rather than restating it.

---

# Part A: Backlog-Tool / Loop-Runner Contract

A conforming loop runner consumes a `backlog.json`, executes work items, emits
signals, maintains a state directory, and exposes a small set of CLI verbs. A
pipeline tool drives the runner entirely through this contract; it never reads
the runner's internals. rauf is the reference implementation; an alternative
ralph-style runner conforms by supplying its own implementation of this surface
(its own schema + `validate` verb, signal vocabulary, and CLI verbs).

## A.1 Data surface: the backlog schema

- **Canonical JSON Schema:** [`schemas/backlog.schema.json`](https://github.com/garygentry/rauf/blob/main/schemas/backlog.schema.json),
  published with
  `$id = https://raw.githubusercontent.com/garygentry/rauf/main/schemas/backlog.schema.json`.
- **Single source of truth:** the JSON Schema is **generated** from the Zod
  schema in `packages/core/src/schemas.ts` by
  `scripts/generate-json-schemas.ts`. A CI drift guard
  (`pnpm schema:check`) fails the build if the committed copies diverge from the
  Zod source; there is no hand-maintained schema copy.
- **`schemaVersion`:** top-level optional string, **default `"1"`**, stamped on
  read. It is intentionally _not_ in the JSON Schema `required` array, so
  backlogs written before the field existed keep validating.
- **Item `type`:** `bug | bugfix | refactor | feature | chore | test`.
- **Item `status`:** `pending | in_progress | done | blocked`.
  (Note: `complete`, `in-progress`, `docs` are **not** valid. A runner-agnostic
  pipeline must author to these exact values.)
- Full field shape: see the JSON Schema and `docs/SCHEMAS.md`.

## A.2 Signal protocol

A work item's execution communicates its outcome by emitting a signal token
**on a line by itself**. The runner scans the output **backwards from the end**
and uses the **last** such signal line, so the signal should be the agent's
final meaningful output, but **trailing text after it (commit messages,
summaries, tool epilogues) does not break detection**. The token must be the
entire trimmed content of its line (e.g. a bare `RAUF_DONE`, or
`RAUF_BLOCKED:<reason>` / `RAUF_NEEDS_HUMAN:<reason>` / `RAUF_REVIEW:<json>` with
no other text on that line). Blank lines are ignored. If multiple signal lines
appear, the last one wins.

| Signal                      | Meaning                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `RAUF_DONE`                 | All acceptance criteria pass; mark the item done.                   |
| `RAUF_BLOCKED:<reason>`     | Cannot proceed (missing dependency, unclear requirement).           |
| `RAUF_NEEDS_HUMAN:<reason>` | Human input required (API key, design decision).                    |
| `RAUF_REVIEW:<json>`        | Review pass output: a JSON `ReviewPayload` of new items to enqueue. |

These tokens are part of the contract; an alternative runner that reuses rauf's
artifacts MUST emit the same tokens (or supply its own artifact templates).

## A.3 State-directory layout (authoritative)

A runner keeps per-backlog state in a **state directory**, resolved as follows:

- **Default root:** `<project>/.rauf/`, used when no `--backlog` is given.
- **Per-feature root:** with `--backlog <dir>`, the backlog root is
  `<project>/<dir>` and its state directory is `<dir>/.rauf/` (unless `<dir>`
  itself is named `.rauf`, in which case it is used directly). **State is
  isolated per backlog dir:** two `--backlog` targets (or a per-feature loop
  and the project's own loop) never collide on state.

**One state dir per backlog root — no hand-made parallels.** Every state directory is either
the project default (`<project>/.rauf/`) or is **derived by the runner** from a `--backlog`
root via the rule above (`resolveStateDir` in `packages/core/src/backlog-root.ts`). A project
therefore has exactly one `<project>/.rauf/`, and each feature pipeline gets a `.rauf/` derived
from _its_ `--backlog` dir. Authors and agents must **not** hand-create a bespoke or nested
`.rauf/` (e.g. `subdir/.rauf/`, `.rauf-foo/`) to hold a separate backlog: `scanBacklogRoots`
discovers every directory containing a `backlog.json`, so a stray one becomes noise in
`status`/root-selection and is never cleaned by the normal lifecycle. A separate batch of work
belongs in the project's own backlog (reset and reuse it), and a genuine parallel feature
belongs under a caller-driven `--backlog <specsDir>/<feature>/` — never a self-invented
directory.

Files within a state directory:

| File                    | Role                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `backlog.json`          | The work queue (schema per §A.1). May live in the backlog root or its `.rauf/`. |
| `state.json`            | Loop state (status, iteration, current item, signals).                          |
| `rauf.log`              | Append-only event log (fallback status source).                                 |
| `iteration-status.json` | Live per-iteration status (current tool, tokens).                               |
| `progress.md`           | Accumulated project learnings.                                                  |
| `archive/`              | Swept done items, by month.                                                     |
| `.loop.lock`            | Single-runner lock.                                                             |
| `DONE` / `CANCEL`       | Sentinels.                                                                      |
| `RAUF.md` / `REVIEW.md` | Per-iteration / review instructions (per-root, with project-level fallback).    |

The **`.rauf.json` marker** at the project root identifies an installed project
(version, profile, options incl. the Part-B `provider`). Its full shape is
`MarkerFileSchema` in `packages/core/src/schemas.ts` (see also Part B §6.2).

## A.4 CLI verbs

A conforming runner exposes these verbs. `<path>` is the project root; `--json`
selects machine-readable output where noted.

| Verb     | Invocation                                                                    | Purpose                                         |
| -------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| run      | `rauf loop run <path> --backlog <dir> [--iterations N]`                       | Execute iterations against a backlog.           |
| validate | `rauf backlog validate <path> [--backlog <dir>] [--specs-dir <dir>] [--json]` | Validate a backlog (schema + semantics).        |
| status   | `rauf status <path> [--backlog <dir>] [--json]`                               | Derived loop status.                            |
| list     | `rauf backlog list <path> [--backlog <dir>] [--json]`                         | List backlog items.                             |
| follow   | `rauf follow <path> [--backlog <dir>]`                                        | Stream loop events.                             |
| log      | `rauf log <path> [--backlog <dir>] [--follow]`                                | Tail the event log.                             |
| version  | `rauf version --json` → `{ "version": "<semver>" }`                           | Report runner version (for min-version gating). |

**`validate` exit codes (contract):** `0` = valid (warnings allowed), `1` =
validation findings (one or more errors), `2` = usage / IO error (missing path,
unreadable file, bad JSON). With `--json` it emits `{ valid, findings[] }`,
where each finding has `{ severity, code, message, itemId?, path? }`.
`specReferences` are **project-root-relative** and resolved against the project
root (so a ref may point inside or outside the specs dir, e.g.
`docs/SPEC-CORE.md`); a ref that is absolute or escapes the project root is a
`SPEC_PATH_INVALID` error. The existence check runs **only** when `--specs-dir`
is provided (its presence is the gate, not a resolution base), so the
repo-wide ad-hoc flow (no `--specs-dir`) is never failed for it.

## A.5 Versioning & conformance

- The runner reports its version via `rauf version --json` as a bare semver
  string (no `v` prefix). Consumers semver-compare this against a required
  minimum; they MUST NOT string-compare.
- `rauf backlog validate` and backlog `schemaVersion` first ship in **rauf
  0.2.0**. A consumer that depends on them MUST require `>= 0.2.0`
  (`minRunnerVersion`).

## A.6 Distribution

The runner is obtained as a **self-contained compiled binary**, distinct from
any per-project artifact install:

- rauf compiles via `bun build --compile` to a single `rauf-bin` that bundles
  its runtime: the installed `rauf` needs **neither this repo nor Bun/Node**.
- Distribution channel: **GitHub Releases** + an install script
  (`scripts/install-binary.sh` → `~/.local/bin/rauf`; supports `--local` to
  install a freshly-built binary from a clone). npm / Homebrew may layer on top
  later.
- **`rauf install <path>` is a different thing:** it installs per-project
  artifacts (`.rauf/`, `RAUF.md`, schema copy, marker) into a _target_ repo. It
  does **not** provide or upgrade the rauf CLI itself. A consumer's
  "install/upgrade the runner" hint must point at the binary install above, not
  at `rauf install`.

## A.7 Machine-observation surfaces (versioned)

rauf exposes two **machine-readable** observation surfaces that a supervising
pipeline may parse and rely on: the `--ndjson` event stream from `rauf loop run`
and the `--json` output of `rauf status`. They are part of the stable Part-A
contract and carry the **additive-only / versioned** compatibility promise of
§A.5. The canonical _shapes_ (TypeScript/Zod) live in `docs/SCHEMAS.md`; this
section is the _promise_: the field/event/enum names below match
`packages/core/src/schemas.ts` exactly.

### A.7.1 NDJSON event stream: `rauf loop run … --ndjson`

With `--ndjson`, `rauf loop run` emits one JSON object per line to stdout for
every `LoopEvent`, then a trailing JSON line for the final `LoopResult` (the
result object has `completedCount`/`blockedCount` and **no** `type` field; that
absence distinguishes it from event lines). The human renderer and status line
are suppressed; stdout is a clean NDJSON stream (implies `--no-color`).

**Base fields**, every event object carries:

| Field         | Type     | Meaning                                |
| ------------- | -------- | -------------------------------------- |
| `type`        | `string` | Discriminator (the event-type values). |
| `timestamp`   | `string` | ISO-8601 emission time.                |
| `projectPath` | `string` | Absolute path to the project.          |

**Event `type` vocabulary** (the full discriminated union; consumers MUST
ignore any `type` they do not recognize, per the promise below):

`loop_started`, `iteration_start`, `item_selected`, `llm_spawned`,
`llm_exited`, `signal_parsed`, `item_completed`, `item_blocked`,
`item_retried`, `needs_human`, `loop_paused`, `usage_limit_hit`,
`usage_limit_cleared`, `sleep_start`, `sleep_end`, `loop_completed`,
`loop_error`, `loop_cancelled`, `review_started`, `review_completed`,
`review_failed`, `llm_tool_activity`, `llm_token_update`,
`llm_stuck_warning`.

**Consumer-critical event payloads** (fields beyond the base three) follow:

| Event               | Payload fields                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `item_completed`    | `itemId`, `title`                                                                          |
| `item_blocked`      | `itemId`, `reason`                                                                         |
| `needs_human`       | `itemId`, `reason`                                                                         |
| `loop_paused`       | `reason` (`needs_human`), `itemId`                                                         |
| `signal_parsed`     | `itemId`, `signal` (`done` \| `blocked` \| `needs_human` \| `review` \| `none`), `reason?` |
| `loop_completed`    | `completedCount`, `blockedCount`, `needsHumanCount?`                                       |
| `loop_error`        | `error`                                                                                    |
| `loop_cancelled`    | _(base fields only)_                                                                       |
| `llm_stuck_warning` | `itemId`, `silentMs`                                                                       |

**Two gotchas a supervisor MUST account for:**

1. **`signal_parsed.signal` distinguishes `review`.** As of v0.5.0 the
   on-the-wire `signal` enum is `done | blocked | needs_human | review | none`. A
   `RAUF_REVIEW` review-pass signal is reported as `signal === "review"`
   (previously it was collapsed to `"done"`; that collapse is removed). A
   `review` value indicates the item emitted a review-pass payload; consult the
   review-pass handling (not item completion) to interpret it.
2. **A circuit-breaker halt is emitted as `loop_error`.** There is **no**
   distinct `circuit_breaker` event type. When the loop halts because
   consecutive infra-failure spawns trip the circuit breaker, it emits
   `loop_error` whose `error` string begins `Circuit breaker: …`. Match on the
   message, not on a dedicated type.

**Pause-on-needs-human (live supervision).** With `rauf loop run
--pause-on-needs-human`, when an item emits `RAUF_NEEDS_HUMAN` the runner sets
it aside (as always: status `blocked` + `needsHuman`) **and then halts** in the
resumable `paused_human` state instead of continuing to other items. On this
stream the order is: the `needs_human` event (`itemId`, `reason`), then a
`loop_paused` event (`reason: "needs_human"`, `itemId`). `loop run` then exits
with code **`3`** (`NEEDS_HUMAN`). Without the flag, the default is unchanged:
the item is set aside and the loop keeps running, so no `loop_paused` is emitted.
A supervisor resolves the pause with `rauf resume --answer <id> "<text>"`, which
re-queues the item with the answer and relaunches the loop.

> **Note, one unified exit-code scheme (v0.5.0).** `rauf status` and `rauf loop
run` share the single exit-code table (§A.7.2): a needs-human state is `3`
> (NEEDS_HUMAN) on **both**. The only status-exclusive code is `6` (RUNNING), a
> query-time state a `loop run` never terminates with. Branch on the same codes
> regardless of which command you ran.

**Supervisor pattern:** run `rauf loop run . --ndjson --pause-on-needs-human`;
on a `loop_paused` (or `needs_human`) event, or on the exit code `3` (NEEDS_HUMAN), gather
the human's answer and call `rauf resume . --answer <id> "<answer>"` to inject
it and continue.

### A.7.2 Canonical status surface: `rauf status … --json`

`rauf status --json` emits a `DerivedStatus` object: the canonical,
file-derived snapshot of a backlog root's loop state (no subprocesses are
invoked to derive it). Its fields:

- **`loopState`**: one of `IDLE`, `RUNNING`, `REVIEWING`, `PAUSED`, `COMPLETE`,
  `PAUSED_HUMAN`, `PAUSED_USAGE_LIMIT`, `LIMIT_REACHED`, `ERROR`, `NOT_INSTALLED`,
  `SLEEPING_LIMIT`, `WEEKLY_LIMIT`.
- **`stateSource`**: `state.json` | `log-parsing` | `none`.
- **`iteration`**, **`maxIterations`**, **`currentItem`**, **`lastSignal`**,
  **`startedAt`**, **`elapsed`**: progress fields (nullable).
- **`backlogSummary`**: `{ pending, inProgress, blocked, needsHuman?,
deferred?, done, total }`. **`blocked` is the TOTAL** of items with status
  `blocked`; **`needsHuman`** (blocked on a human decision) and **`deferred`**
  (a runner "false block") are **distinct, disjoint subsets** of it. Treat the
  three as separate: a genuine agent block, a needs-human block, and a deferred
  block are not interchangeable.
- **`lock?`**: `LockSummary` (`present`, `pid`, `startedAt`, `alive`, `stale`):
  lock-file liveness for this backlog root.
- **`sleepUntil?`**: ISO timestamp, present when `loopState` is
  `SLEEPING_LIMIT` or `WEEKLY_LIMIT`.
- **`statusSchemaVersion`**: the literal `"1"` — a top-level version marker for
  the `DerivedStatus` surface, mirroring `EVENTS_SCHEMA_VERSION`. It follows the
  same additive-only-within-a-major discipline (§A.7.3) and starts at `"1"`.
- **`health`**: a nested block, or **`null`** when no live iteration exists.
  When present it mirrors `.rauf/iteration-status.json` so a supervisor never
  has to read that file to decide:
  - **`stuckWarning`** (`boolean`): the runner's stall hint — an iteration
    appears to have stopped making progress. A **decision aid, not a verdict**.
  - **`iterationFresh`** (`boolean`): whether the iteration-status file was
    updated within the freshness window (60 s).
  - **`lastActivityAt`** (ISO string): the last activity timestamp.
  - **`secondsSinceActivity`** (`number ≥ 0`): whole seconds since
    `lastActivityAt` (clamped to `0` for a future timestamp) — a supplementary
    time-based signal if an agent prefers age over a poll count.

**The agent single-poll decision contract.** A supervisor answers **all four**
of its decisions from **one** `rauf status … --json` poll — it **never** reads
`.rauf/iteration-status.json` or `events.ndjson` to decide (those remain
available for narration/diagnosis only). Evaluate the branches **top-to-bottom,
first match wins**:

| #   | Condition (from ONE `status --json` poll)                                                             | Decision                | Action                                                         |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- |
| 1   | `loopState ∈ {COMPLETE, IDLE}` **and** `backlogSummary` has nothing `pending`/`inProgress`            | **Done**                | Report the outcome and stop.                                   |
| 2   | `loopState = PAUSED_HUMAN` **or** `lastSignal = "needs_human"` **or** `backlogSummary.needsHuman > 0` | **Needs human**         | Surface to the user — the only true stop. Do not auto-recover. |
| 3   | `health?.stuckWarning === true`                                                                       | **Recoverable stall**   | Apply the persist-then-escalate recovery ladder.               |
| 4   | `loopState ∈ {RUNNING, REVIEWING}`, no stall hint                                                     | **Healthy in-progress** | Keep polling at the interval.                                  |

`needs-human` (row 2) outranks the stall hint (row 3); `health` may be `null`
(no live iteration), so `health?.stuckWarning` short-circuits to falsy and row 3
does not fire. The **`drive-rauf-loop`** skill is the **authoritative recipe**
for this loop (poll interval, N=3 escalation threshold, the persist-then-escalate
ladder, and `reset`-only-on-dead-lock); this contract defines the surface it
reads.

**Exit-code table** (the unified v0.5.0 scheme; `rauf status` and `rauf loop
run` share it so a supervisor can branch without parsing JSON):

| Exit code | Meaning                                             | `loopState` (from `rauf status`)                                        |
| --------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| `0`       | Success (clean terminal)                            | `IDLE`, `COMPLETE`, `PAUSED`, `NOT_INSTALLED`                           |
| `1`       | Error                                               | `ERROR`                                                                 |
| `2`       | Usage error (bad args / IO)                         | (none)                                                                  |
| `3`       | Needs human                                         | `PAUSED_HUMAN`                                                          |
| `4`       | Limit / usage-paused / sleeping                     | `LIMIT_REACHED`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `PAUSED_USAGE_LIMIT` |
| `5`       | Blocked (clean terminal with genuine blocked items) | `IDLE`/`COMPLETE`/`PAUSED` when `backlogSummary` has genuine blocks     |
| `6`       | Running (query-time only)                           | `RUNNING`, `REVIEWING`                                                  |

(`backlog validate` keeps its own triad: `0` valid · `1` findings · `2` usage/IO.)

### A.7.3 Compatibility promise (anchored to §A.5)

These two surfaces are **additive-only** within a major version, gated by the
runner version of §A.5:

- New event `type` values, new optional event fields, and new optional
  `DerivedStatus` / `backlogSummary` fields MAY be added in a minor release.
  - The nested **`health`** block and the top-level **`statusSchemaVersion`**
    marker are exactly such **additive** `DerivedStatus` fields — added, never a
    rename or removal of any existing field. `statusSchemaVersion` starts at
    `"1"` and follows the same additive-only-within-a-major discipline as
    `EVENTS_SCHEMA_VERSION`.
- Existing event-type discriminator values and their documented fields, the
  `signal` enum, the `loopState` enum values, and the exit-code mapping are
  **stable within a major**: they are not renamed or removed.
- Consumers MUST therefore **ignore unknown event types and unknown fields**
  rather than failing on them, and MUST gate on `rauf version` (§A.5) when they
  depend on a field or event added in a specific release.

**`events.ndjson` versioning discipline.** The persisted `events.ndjson` log
(the file-backed counterpart of the `--ndjson` stream, with the same `LoopEvent`
shapes plus a `seq` + `schemaVersion` envelope) follows an
**additive-only-within-a-major** discipline, stamped with
`EVENTS_SCHEMA_VERSION` (`packages/core/src/schemas.ts`):

1. **Additive-only within a major.** No event `type` discriminator value is
   renamed or removed, and no documented field is removed, within a major version.
2. **New types/fields are additive.** Adding a new event `type` to the union, or a
   new optional field to an existing event, requires **no** version bump.
3. **Readers MUST tolerate the unknown.** Consumers ignore unknown `type` values
   and unknown fields.
4. **Bump only on a breaking change.** `EVENTS_SCHEMA_VERSION` is incremented
   **only** when a `type` or documented field is renamed/removed.

`EVENTS_SCHEMA_VERSION` stays **`"1"`** in v0.5.0: adding `"review"` to the
`signal_parsed.signal` enum is an additive change to an existing field's value
set (rule 2), so it triggers no bump. Logs written before and after this release
remain version `"1"` and inter-readable.

### A.7.4 Machine vs human surfaces (do not cross them)

| Surface                          | Audience | Parse programmatically?                               |
| -------------------------------- | -------- | ----------------------------------------------------- |
| `rauf loop run … --ndjson`       | machine  | **Yes** (stable contract)                             |
| `rauf status … --json`           | machine  | **Yes** (stable contract)                             |
| `rauf follow`                    | human    | **No** (formatted for display)                        |
| `rauf log` / `rauf log --follow` | human    | **No** (formatted for display)                        |
| `rauf.log` (file)                | human    | **No** (append-only human log / status fallback only) |

`rauf follow`, `rauf log --follow`, and the `rauf.log` file are
**human-formatted** (colors, icons, prose) and carry **no** stability promise;
a supervisor MUST NOT parse them. Use `--ndjson` for events and `status --json`
for state.

**The item-level `follow` altitude filter is human-render-only.** `rauf follow`'s
default item-level narration (and its sticky progress header) is a presentation
concern of the human view alone — it **never** touches any machine surface.
`rauf follow --json` and `rauf loop run … --ndjson` emit **every** event with no
altitude filter applied.

---

# Part B: LLM-Agnostic Execution Architecture

> **HISTORICAL — kept for design rationale, not current state.** Part B was the
> DRAFT plan for the provider/agent refactor. That refactor is **implemented**: the
> provider registry, the `LLMProvider` interface, `--agent` selection, per-item
> `provider`, the `claude-cli`/`cli-agent`/`generic-cli` adapters, and
> provider-neutral `<provider.id>` events all ship today. For the **current**
> architecture, read the implemented docs instead:
>
> - `docs/architecture/rauf-agent-cli-adapters/README.md`
> - `docs/architecture/rauf-agent-cli-adapters/architecture.md`
> - `docs/architecture/rauf-agent-cli-adapters/api-reference.md`
>
> Two known drifts between this draft and the shipped code: (1) the user-facing CLI
> flag is **`--agent`**, not the `--provider` this draft names (`provider` survives
> only as the persisted/internal `.rauf.json` and per-item schema key); (2) some
> "Must Change" code paths below (e.g. `claude-process.ts`) were since reorganized
> into the `packages/loop/src/providers/` adapters. Where this draft and the
> implemented docs disagree, the implemented docs win.
>
> This part is the **provider** axis (which LLM drives an iteration). The
> state-directory layout and `.rauf.json` marker it references are defined
> authoritatively in Part A §A.3.

## 1. Problem Statement

Rauf's loop runner is currently hard-coupled to Claude Code CLI. The coupling exists in five concentrated areas:

1. **Process spawning:** `packages/loop/src/claude-process.ts` spawns the `claude` binary with Claude-specific flags (`-p`, `--dangerously-skip-permissions`, `--output-format text`)
2. **Credential reading:** `packages/core/src/config.ts` reads `~/.config/claude-code/credentials.json` and extracts `claudeAiOauth.accessToken`
3. **Usage limit API:** `packages/loop/src/usage-checker.ts` calls `https://api.anthropic.com/api/oauth/usage` with Anthropic-specific headers
4. **Event naming:** `claude_spawned` and `claude_exited` events in schemas, runner, CLI formatter, loop manager, and web frontend
5. **Template language:** `RAUF.md.tmpl` references "Task tool" and "Claude Code Tasks"; `CLAUDE_ADDON.md` and `CLAUDE_GREENFIELD.md.tmpl` are named for Claude

The core business logic (backlog CRUD, signal parsing (`RAUF_DONE`/`RAUF_BLOCKED`/`RAUF_NEEDS_HUMAN`), git operations, state management, discovery, status derivation) is already LLM-agnostic.

### Why Change

- **Vendor lock-in:** Users cannot use Rauf with any other coding agent
- **Cost inflexibility:** Claude Code subscription is the only billing option; some users want API billing, local models, or alternative providers
- **Ecosystem growth:** OpenAI Codex CLI, Google Gemini CLI, Aider, and other coding agents are mature enough to drive autonomous loops
- **Future-proofing:** The adapter pattern enables new providers without touching core loop logic

---

## 2. Requirements

### 2.1 Functional Requirements

| ID    | Requirement                                                                                                                                                                                                                                      | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-1  | Rauf MUST support multiple LLM providers through a common interface                                                                                                                                                                              | P0       |
| FR-2  | The `claude-cli` provider MUST replicate current behavior exactly (zero regression)                                                                                                                                                              | P0       |
| FR-3  | A `generic-cli` provider MUST allow users to configure any CLI agent via `.rauf.json` or `~/.rauf/config.json`                                                                                                                                   | P0       |
| FR-4  | A `claude-sdk` provider MUST support the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) with API key auth                                                                                                                                   | P1       |
| FR-5  | Provider selection MUST be configurable at three levels: per-item, per-project, and global default                                                                                                                                               | P1       |
| FR-6  | The signal protocol (`RAUF_DONE`, `RAUF_BLOCKED`, `RAUF_NEEDS_HUMAN`) MUST remain the standard completion mechanism for all CLI-based providers                                                                                                  | P0       |
| FR-7  | SDK-based providers MAY use structured signal capture (e.g., MCP tool call) as a more reliable alternative to text parsing                                                                                                                       | P1       |
| FR-8  | Each provider MUST be able to report usage/rate limits in a normalized format                                                                                                                                                                    | P1       |
| FR-9  | Each provider MUST validate that required credentials exist before starting a loop                                                                                                                                                               | P0       |
| FR-10 | SDK-based providers SHOULD stream progress events (tool use, thinking) for live dashboard visibility                                                                                                                                             | P2       |
| FR-11 | Additional providers (`codex`, `gemini`, `pi`) SHOULD be implementable without modifying core loop logic                                                                                                                                         | P1       |
| FR-12 | The CLI MUST accept a `--provider` flag on `rauf loop run` (and the detached `--detached` form). _Note: `loop start` was removed in v0.5.0; this deferred Part-B FR predates that and should be re-scoped to `loop run` when Part-B is specced._ | P1       |

### 2.2 Non-Functional Requirements

| ID    | Requirement                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------- |
| NFR-1 | Existing users who don't configure a provider MUST see no behavioral change (`claude-cli` is default) |
| NFR-2 | Adding a new provider MUST NOT require changes to `packages/core`                                     |
| NFR-3 | The provider interface MUST be testable with mock implementations (no real LLM calls in unit tests)   |
| NFR-4 | All existing tests MUST continue to pass after the refactor                                           |

### 2.3 Out of Scope (Deferred)

| Item                                                       | Reason                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raw LLM providers (OpenRouter chat completion, Ollama raw) | These are not coding agents; they lack file/shell tools. Supporting them would require Rauf to implement its own tool layer and agent loop. Large scope expansion. |
| Per-item provider routing                                  | Schema field added in Phase 1, but runtime routing deferred to Phase 4                                                                                             |
| Rauf-provided tool layer                                   | Building Read/Write/Edit/Bash tools within Rauf for raw LLMs                                                                                                       |
| Multi-provider parallel execution                          | Running the same item against multiple providers simultaneously                                                                                                    |

---

## 3. Current State Inventory

### 3.1 Claude-Specific Code (Must Change)

| File                                                        | What's Claude-Specific                                                                                                                                      | Lines                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `packages/loop/src/claude-process.ts`                       | Entire file: spawns `claude` binary, Claude CLI flags                                                                                                       | 1-171                                  |
| `packages/loop/src/usage-checker.ts`                        | `USAGE_API_URL`, `anthropic-beta` header, `UsageApiResponse` interface                                                                                      | 1-77                                   |
| `packages/core/src/config.ts`                               | `readClaudeOAuthToken()`, `CLAUDE_CREDENTIALS_REL`, reads `~/.config/claude-code/credentials.json`                                                          | 103-172                                |
| `packages/core/src/schemas.ts`                              | `ClaudeSpawnedSchema` (type `claude_spawned`), `ClaudeExitedSchema` (type `claude_exited`)                                                                  | 296-309                                |
| `packages/loop/src/runner.ts`                               | Imports `spawnClaude`, calls it directly; calls `readClaudeOAuthToken` + `checkUsageLimit` for Anthropic API; emits `claude_spawned`/`claude_exited` events | 18, 192-206, 472-534, 537-611, 614-681 |
| `packages/cli/src/loop-commands.ts`                         | Formats `claude_spawned`/`claude_exited` events with "Claude spawned"/"Claude exited" labels                                                                | 430-444                                |
| `packages/web/src/server/loop-manager.ts`                   | `LOOP_EVENT_TYPES` array includes `claude_spawned`/`claude_exited`                                                                                          | 34-35                                  |
| `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl`        | "Task tool", "Claude Code Tasks" reference                                                                                                                  | 41, 58                                 |
| `artifacts/variants/backlog-json/CLAUDE_ADDON.md`           | Filename is Claude-branded (content is generic)                                                                                                             | filename                               |
| `artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl` | Filename is Claude-branded (content is generic)                                                                                                             | filename                               |
| `packages/loop/src/prompt-builder.ts`                       | `formatAgentDelegation()` mentions "Task tool"; `formatEstimatedIterationsHint()` mentions "Task tool"                                                      | 96, 115-118, 128                       |

### 3.2 Already Generic (No Change Needed)

| File                                                                             | What It Does                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/loop/src/signal-parser.ts`                                             | Parses `RAUF_DONE`/`RAUF_BLOCKED`/`RAUF_NEEDS_HUMAN` from stdout; works with any LLM |
| `packages/loop/src/git-commit.ts`                                                | `git add -A && git commit`; LLM-agnostic                                             |
| `packages/loop/src/events.ts`                                                    | `TypedEventEmitter`; generic wrapper, driven by schema types                         |
| `packages/core/src/backlog.ts`                                                   | Backlog CRUD; no LLM references                                                      |
| `packages/core/src/discovery.ts`                                                 | Project scanning; no LLM references                                                  |
| `packages/core/src/status.ts`                                                    | Status derivation; reads files only                                                  |
| `packages/core/src/installer.ts`                                                 | Artifact installation; no LLM references                                             |
| `packages/core/src/profile.ts`                                                   | Tech stack detection; no LLM references                                              |
| `packages/core/src/template.ts`                                                  | Template rendering; no LLM references                                                |
| `packages/core/src/fs-utils.ts`                                                  | Atomic writes; no LLM references                                                     |
| `packages/loop/src/usage-checker.ts` (`interruptibleSleep`, `computeRetryAfter`) | Utility functions; generic                                                           |

---

## 4. Provider Adapter Architecture

### 4.1 Execution Models

LLM coding agents exist in two forms:

**CLI Agents:** External binaries spawned as subprocesses. Rauf pipes a prompt via stdin or args, captures stdout/stderr, parses signals from output text.

- Claude Code (`claude -p`)
- OpenAI Codex (`codex`)
- Google Gemini CLI (`gemini`)
- Pi (`pi`)
- Aider (`aider`)
- Any configurable binary

**SDK/API Agents:** In-process programmatic invocation. Rauf calls a function, iterates structured messages, captures results directly.

- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` `query()`)
- OpenAI Agents SDK (future)

The adapter layer abstracts over both models behind a single interface.

### 4.2 Provider Interface

```typescript
// packages/loop/src/providers/types.ts

import type { Result } from "@rauf/core";

/** Uniquely identifies a provider */
type ProviderId = string; // "claude-cli" | "claude-sdk" | "codex" | "gemini" | "pi" | "generic-cli" | string

interface LLMProvider {
  /** Unique identifier (e.g., "claude-cli", "generic-cli") */
  readonly id: ProviderId;

  /** Human-readable name for UI/logs (e.g., "Claude Code (CLI)") */
  readonly displayName: string;

  /**
   * Execute a single loop iteration with the given prompt.
   * CLI providers spawn a subprocess; SDK providers call an API.
   * Returns stdout/stderr/exitCode for signal parsing, plus optional
   * structured signal if the provider can extract it directly.
   */
  execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>>;

  /**
   * Check provider-specific usage/rate limits.
   * Returns normalized UsageLimitResult.
   * Optional — providers without rate limit APIs return undefined.
   */
  checkUsage?(): Promise<UsageLimitResult>;

  /**
   * Validate that required credentials exist and are readable.
   * Called before the loop starts. Returns err if missing.
   */
  validateCredentials(): Result<void>;

  /**
   * Provider-specific cleanup (kill orphaned processes, close connections).
   * Called when the loop finishes or is cancelled.
   */
  dispose?(): Promise<void>;
}

interface ExecuteOptions {
  model?: string;
  timeoutMinutes: number;
  signal?: AbortSignal;
  /** Callback for streaming progress (SDK providers only) */
  onProgress?: (event: ProviderProgressEvent) => void;
}

interface ExecutionResult {
  /** Raw text output for signal parsing */
  stdout: string;
  /** Raw error output */
  stderr: string;
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Whether the execution was terminated by timeout */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Structured signal if provider can extract directly (SDK providers) */
  parsedSignal?: ParsedSignal;
  /** Streaming events collected during execution (SDK providers) */
  progressEvents?: ProviderProgressEvent[];
}

interface ProviderProgressEvent {
  type: "tool_use" | "thinking" | "text" | "error";
  timestamp: string;
  detail: string;
}

/** Normalized usage/rate limit result across providers */
interface UsageLimitResult {
  limited: boolean;
  limitType?: string; // Provider-specific: "5h", "7d", "rpm", "tpm", etc.
  utilization?: number; // 0-100+
  retryAfter?: number; // Seconds until limit resets
  resetsAt?: string; // ISO timestamp
}
```

### 4.3 Provider Registry

```typescript
// packages/loop/src/providers/registry.ts

interface ProviderFactory {
  create(config: ProviderConfig): LLMProvider;
}

/** Register built-in providers, resolve by ID */
function createProvider(providerId: string, config: ProviderConfig): LLMProvider;
function getAvailableProviders(): ProviderId[];
```

### 4.4 How the Runner Changes

Current (`runner.ts`):

```typescript
// Direct call to Claude-specific function
const claudeResult = await spawnClaude(promptResult.value, {
  sessionTimeoutMinutes: this.options.sessionTimeoutMinutes,
  model: resolvedModel,
  signal: this.abortController.signal,
});
```

New (`runner.ts`):

```typescript
// Call through provider interface
const execResult = await this.provider.execute(promptResult.value, {
  timeoutMinutes: this.options.sessionTimeoutMinutes,
  model: resolvedModel,
  signal: this.abortController.signal,
  onProgress: (event) => this.emitEvent("llm_progress", { itemId: item.id, ...event }),
});
```

### 4.5 Mapping: Current Code → New Architecture

| Current                                   | New                                                   | Notes             |
| ----------------------------------------- | ----------------------------------------------------- | ----------------- |
| `spawnClaude(prompt, opts)`               | `provider.execute(prompt, opts)`                      | Core execution    |
| `readClaudeOAuthToken()`                  | `provider.validateCredentials()`                      | Pre-loop check    |
| `checkUsageLimit(token)`                  | `provider.checkUsage?.()`                             | Usage checking    |
| `parseSignal(stdout)`                     | `parseSignal(result.stdout)` or `result.parsedSignal` | Signal extraction |
| Hardcoded `claude` binary                 | Configured via `provider` field                       | Selection         |
| `claude_spawned` / `claude_exited` events | `llm_spawned` / `llm_exited` events                   | Event rename      |
| `"Claude spawned"` log text               | `"${provider.displayName} spawned"` log text          | Display           |

---

## 5. Provider Specifications

### 5.1 `claude-cli`: Claude Code CLI (Default)

**Behavior:** Identical to current implementation. Wraps existing `spawnClaude()`.

| Aspect      | Detail                                                                                  |
| ----------- | --------------------------------------------------------------------------------------- |
| Binary      | `claude`                                                                                |
| Flags       | `-p --dangerously-skip-permissions --output-format text [--model X]`                    |
| Credentials | `~/.config/claude-code/credentials.json` → `claudeAiOauth.accessToken`                  |
| Usage API   | `GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20` |
| Signal      | Text parsing from stdout via `parseSignal()`                                            |
| Billing     | Claude Code subscription (OAuth)                                                        |
| Progress    | None (batch output only)                                                                |

### 5.2 `claude-sdk`: Claude Agent SDK

**Behavior:** In-process execution via `@anthropic-ai/claude-agent-sdk` `query()`.

| Aspect          | Detail                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Package         | `@anthropic-ai/claude-agent-sdk`                                                                                  |
| Entry point     | `query({ prompt, options })` → async generator of `SDKMessage`                                                    |
| Credentials     | `ANTHROPIC_API_KEY` env var (required)                                                                            |
| Permission mode | `permissionMode: "bypassPermissions"`                                                                             |
| Signal          | Custom MCP tool `rauf_signal(signal, reason?)` captured during execution, with text parsing fallback              |
| Usage           | SDK returns structured `429` errors with `retry-after`                                                            |
| Billing         | Anthropic API (pay-per-token)                                                                                     |
| Progress        | Stream `tool_use`, `thinking`, `text` events from async generator                                                 |
| Auth policy     | **OAuth tokens NOT permitted** per [Anthropic legal policy](https://code.claude.com/docs/en/legal-and-compliance) |

**MCP Signal Tool:**

```typescript
const raufSignal = tool(
  "rauf_signal",
  "Signal task completion status to the rauf loop runner",
  z.object({
    signal: z.enum(["done", "blocked", "needs_human"]),
    reason: z.string().optional(),
  }),
  async (args) => {
    // Captured by execution backend, NOT parsed from stdout
    capturedSignal = { signal: args.signal, reason: args.reason };
    return { output: `Signal received: ${args.signal}` };
  },
);
```

### 5.3 `codex`: OpenAI Codex CLI

| Aspect      | Detail                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary      | `codex`                                                                                                                                      |
| Flags       | `--ask-for-approval <policy> exec [--json] --sandbox <mode> [-c sandbox_workspace_write.network_access=true] [...extraArgs] [--model <m>] -` |
| Credentials | Codex CLI's own configured auth (checked via PATH probe, not read by rauf)                                                                   |
| Signal      | Text parsing from stdout, or reconstructed text from JSONL (`--json`) telemetry (`RAUF_DONE` convention)                                     |
| Usage       | None in rauf; codex has no Anthropic-style usage semantics                                                                                   |
| Billing     | Whatever OpenAI/Codex plan the `codex` CLI is configured to use                                                                              |

**Dedicated adapter, not `generic-cli`.** `codex` has its own adapter
(`packages/loop/src/providers/codex-cli.ts`) rather than the generic preset, because current
Codex CLI rejects `--ask-for-approval` placed after `exec` (it's a top-level flag) and because it
parses Codex's JSONL event stream for streaming telemetry the generic adapter can't produce.

**Configuration** (`providerConfig`, same delivery mechanism as `generic-cli` — see §5.6):

```json
{
  "provider": "codex",
  "providerConfig": {
    "sandboxMode": "workspace-write",
    "networkAccess": true,
    "approvalPolicy": "never",
    "extraArgs": []
  }
}
```

| Key              | Default             | Meaning                                                                                                                                                                                                                |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandboxMode`    | `"workspace-write"` | `"read-only"` \| `"workspace-write"` \| `"danger-full-access"` — passed as `--sandbox <mode>`                                                                                                                          |
| `networkAccess`  | `true`              | Appends `-c sandbox_workspace_write.network_access=true` when `sandboxMode` is `"workspace-write"`. Set `false` to restore Codex's fully network-restricted default. Ignored for `"read-only"`/`"danger-full-access"`. |
| `approvalPolicy` | `"never"`           | Passed as `--ask-for-approval <policy>`                                                                                                                                                                                |
| `extraArgs`      | `[]`                | Appended verbatim before `--model`/the trailing stdin marker, for flags not otherwise modeled                                                                                                                          |

**Why network defaults on:** network-dependent loop work (dependency installs, lockfile
generation, schema/binary fetches) is a first-class use case and must work out of the box,
matching `claude-cli`'s unconditional `--dangerously-skip-permissions` trust posture. Codex's
`workspace-write` sandbox still confines file writes to the project tree — only the network
restriction is lifted by default.

**Effective policy in run diagnostics (#84 item 3):** every spawn (each iteration and the
review pass) logs the resolved `sandbox`/`network`/`approval` values to `rauf.log` — e.g.
`Spawning codex for item 001 [sandbox=workspace-write network=true approval=never]` — so an
operator can see what policy a run actually used without reconstructing argv by hand. Backed by
the optional `LLMProvider.describeConfig()` hook (`packages/loop/src/providers/types.ts`); any
provider with a configurable execution policy can implement it.

**Sandbox-denial diagnostics (#84 item 4, #95):** when a `codex`-driven iteration's
`RAUF_BLOCKED` / `RAUF_NEEDS_HUMAN` reason (or a fast signal-less exit) looks like a sandbox
denial (DNS/connectivity errors, `EPERM` on a subprocess spawn), rauf appends a hint to the
stored reason pointing at this config surface — see `packages/loop/src/codex-sandbox-diagnostics.ts`.
This heuristic is scoped to the `codex` provider; other providers' block reasons are never
annotated.

### 5.4 `gemini-cli`: Google Gemini CLI

| Aspect      | Detail                                            |
| ----------- | ------------------------------------------------- |
| Binary      | `gemini`                                          |
| Flags       | TBD: `--permissive-open` for headless             |
| Credentials | Google account or `GOOGLE_AI_STUDIO_KEY` env var  |
| Signal      | Text parsing from stdout (`RAUF_DONE` convention) |
| Usage       | Gemini API rate limits                            |
| Billing     | Free tier available, or Google AI Studio key      |

### 5.5 `pi`: Pi CLI

| Aspect      | Detail                                                          |
| ----------- | --------------------------------------------------------------- |
| Binary      | `pi`                                                            |
| Flags       | `-p --approve --no-session [--model X]`                         |
| Credentials | Pi-configured provider subscription or API key                  |
| Signal      | Text parsing from stdout (`RAUF_DONE` convention)               |
| Usage       | None in rauf; Pi/provider errors surface through process output |
| Billing     | Whatever provider/model Pi is configured to use                 |

Use `rauf loop run <project> --agent pi --no-model` when backlog items may contain Claude-only
model aliases such as `opus` or `sonnet`; otherwise rauf forwards the resolved model to Pi as
`--model <value>`.

### 5.6 `generic-cli`: Configurable CLI Agent

**Purpose:** Catch-all adapter that lets users configure ANY CLI agent without writing code.

| Aspect      | Detail                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Binary      | User-configured                                                            |
| Flags       | User-configured, with `{{model}}` and `{{prompt_file}}` template variables |
| Credentials | User-configured env vars                                                   |
| Signal      | Text parsing from stdout (`RAUF_DONE` convention)                          |
| Usage       | None (no built-in rate limit check)                                        |

**Configuration example** (`.rauf.json` or `~/.rauf/config.json`):

```json
{
  "provider": "generic-cli",
  "providerConfig": {
    "binary": "aider",
    "args": ["--yes", "--model", "{{model}}", "--message-file", "{{prompt_file}}"],
    "env": { "AIDER_AUTO_COMMITS": "false" },
    "promptDelivery": "file"
  }
}
```

**Prompt delivery modes:**

- `"stdin"` (default): Pipe prompt to stdin, close stdin
- `"file"`: Write prompt to temp file, pass path as `{{prompt_file}}` arg
- `"arg"`: Pass prompt as `{{prompt}}` arg (for short prompts only)

---

## 6. Configuration Model

### 6.1 Provider Resolution Order

```
BacklogItem.provider  >  .rauf.json options.provider  >  ~/.rauf/config.json defaultProvider  >  "claude-cli"
```

### 6.2 Schema Changes

**`MarkerOptionsSchema` (`.rauf.json`):**

```typescript
// Add to existing MarkerOptionsSchema
provider: z.string().optional(),           // Provider ID
providerConfig: z.record(z.string(), z.unknown()).optional(), // Provider-specific config
```

**`BacklogItemSchema`:**

```typescript
// Add to existing BacklogItemSchema
provider: z.string().optional(),           // Per-item provider override
```

**`LoopStartOptionsSchema`:**

```typescript
// Add to existing LoopStartOptionsSchema
provider: z.string().optional(),           // CLI flag override
```

**`ToolConfigSchema` (`~/.rauf/config.json`):**

```typescript
// Add to existing ToolConfigSchema
defaultProvider: z.string().optional(),
providers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
```

### 6.3 Event Schema Changes

**Rename:**

- `ClaudeSpawnedSchema` → `LlmSpawnedSchema` (type: `"llm_spawned"`)
- `ClaudeExitedSchema` → `LlmExitedSchema` (type: `"llm_exited"`)

**Add:**

- `LlmSpawnedSchema` gains `provider: z.string()` field
- `LlmExitedSchema` gains `provider: z.string()` field

**New event type:**

```typescript
const LlmProgressSchema = LoopEventBaseSchema.extend({
  type: z.literal("llm_progress"),
  itemId: z.string(),
  progressType: z.enum(["tool_use", "thinking", "text", "error"]),
  detail: z.string(),
});
```

### 6.4 Full Configuration Examples

**Per-project, Claude CLI (default, backward compatible):**

```json
{
  "rauf": true,
  "version": "0.1.0",
  "variant": "backlog-json",
  "options": {
    "maxIterations": 20,
    "model": "opus"
  }
}
```

**Per-project, Claude Agent SDK:**

```json
{
  "rauf": true,
  "version": "0.1.0",
  "variant": "backlog-json",
  "options": {
    "maxIterations": 20,
    "provider": "claude-sdk",
    "model": "opus"
  }
}
```

**Per-project, Generic CLI (Aider):**

```json
{
  "rauf": true,
  "version": "0.1.0",
  "variant": "backlog-json",
  "options": {
    "maxIterations": 10,
    "provider": "generic-cli",
    "model": "claude-3.5-sonnet",
    "providerConfig": {
      "binary": "aider",
      "args": ["--yes", "--model", "{{model}}", "--message-file", "{{prompt_file}}"],
      "env": { "AIDER_AUTO_COMMITS": "false" },
      "promptDelivery": "file"
    }
  }
}
```

**Global, default provider + provider configs:**

```json
{
  "rootDirectory": "/home/user/projects",
  "port": 5173,
  "theme": "dark",
  "defaultProvider": "claude-cli",
  "providers": {
    "claude-sdk": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    },
    "openai-codex": {
      "apiKey": "${OPENAI_API_KEY}"
    },
    "generic-cli": {
      "binary": "aider",
      "args": ["--yes", "--model", "{{model}}", "--message-file", "{{prompt_file}}"],
      "promptDelivery": "file"
    }
  }
}
```

---

## 7. File Change Inventory

### 7.1 New Files

| File                                          | Purpose                                                                                                   | Est. Lines |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `packages/loop/src/providers/types.ts`        | `LLMProvider` interface, `ExecuteOptions`, `ExecutionResult`, `ProviderProgressEvent`, `UsageLimitResult` | ~70        |
| `packages/loop/src/providers/registry.ts`     | Provider factory, registration, ID resolution                                                             | ~50        |
| `packages/loop/src/providers/claude-cli.ts`   | Claude Code CLI adapter (wraps existing `spawnClaude` + `checkUsageLimit`)                                | ~90        |
| `packages/loop/src/providers/claude-sdk.ts`   | Claude Agent SDK adapter (`query()`, MCP signal tool, streaming)                                          | ~160       |
| `packages/loop/src/providers/openai-codex.ts` | OpenAI Codex CLI adapter                                                                                  | ~90        |
| `packages/loop/src/providers/gemini-cli.ts`   | Gemini CLI adapter                                                                                        | ~90        |
| `packages/loop/src/providers/generic-cli.ts`  | Configurable CLI adapter (binary/args/env templating, prompt delivery modes)                              | ~120       |
| `packages/loop/src/providers/index.ts`        | Barrel export                                                                                             | ~10        |

### 7.2 Modified Files

| File                                                            | Change Description                                                                                                                                                                                                                                                                                                                               | Scope       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| **`packages/core/src/schemas.ts`**                              | Rename `ClaudeSpawnedSchema` → `LlmSpawnedSchema`, `ClaudeExitedSchema` → `LlmExitedSchema`; add `provider` field to both; add `LlmProgressSchema` event; add `provider?: string` and `providerConfig?` to `MarkerOptionsSchema`, `BacklogItemSchema`, `LoopStartOptionsSchema`; add `defaultProvider?` and `providers?` to `ToolConfigSchema`   | Moderate    |
| **`packages/loop/src/runner.ts`**                               | Accept `LLMProvider` (via constructor or factory); replace `spawnClaude()` call with `provider.execute()`; replace `readClaudeOAuthToken()` + `checkUsageLimit()` with `provider.checkUsage?.()` and `provider.validateCredentials()`; rename emitted event types; use `result.parsedSignal ?? parseSignal(result.stdout)` for signal extraction | Moderate    |
| **`packages/loop/src/usage-checker.ts`**                        | Keep `interruptibleSleep()` and `computeRetryAfter()` as generic utilities; keep `checkUsageLimit()` as-is but move the Anthropic-specific logic to be called only from `claude-cli` provider                                                                                                                                                    | Small       |
| **`packages/core/src/config.ts`**                               | Keep `readClaudeOAuthToken()` (used by `claude-cli` provider); add provider config fields to tool config read/write                                                                                                                                                                                                                              | Small       |
| **`packages/loop/src/prompt-builder.ts`**                       | Replace "Task tool" in `formatAgentDelegation()` with generic "sub-agent tool"; remove "Claude Code Tasks" from `formatEstimatedIterationsHint()`                                                                                                                                                                                                | Small       |
| **`packages/loop/src/events.ts`**                               | No structural change (driven by schema types), but event type names change via schema                                                                                                                                                                                                                                                            | None (auto) |
| **`packages/loop/src/index.ts`**                                | Export new provider types, registry, and provider implementations                                                                                                                                                                                                                                                                                | Small       |
| **`packages/loop/package.json`**                                | Add `@anthropic-ai/claude-agent-sdk` as optional peer dependency                                                                                                                                                                                                                                                                                 | Small       |
| **`packages/cli/src/loop-commands.ts`**                         | Add `--provider` flag parsing; update `formatAndPrintEvent()` for `llm_spawned`/`llm_exited`/`llm_progress` event types; use provider `displayName` instead of hardcoded "Claude"                                                                                                                                                                | Small       |
| **`packages/web/src/server/loop-manager.ts`**                   | Update `LOOP_EVENT_TYPES` array: `claude_spawned` → `llm_spawned`, `claude_exited` → `llm_exited`, add `llm_progress`; pass provider to LoopRunner                                                                                                                                                                                               | Small       |
| **`packages/web/` (frontend components)**                       | Update event type references; show provider name in status UI                                                                                                                                                                                                                                                                                    | Small       |
| **`artifacts/variants/backlog-json/CLAUDE_ADDON.md`**           | Rename → `AGENT_ADDON.md`; replace any Claude-specific language                                                                                                                                                                                                                                                                                  | Small       |
| **`artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl`** | Rename → `AGENT_GREENFIELD.md.tmpl`; remove Claude-specific language                                                                                                                                                                                                                                                                             | Small       |
| **`artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl`**        | Replace "Task tool" → "sub-agent tool"; remove "Claude Code Tasks" reference on line 58                                                                                                                                                                                                                                                          | Small       |

### 7.3 Documentation Updates

| File                        | Change                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `docs/ARCHITECTURE.md`      | Add provider adapter model diagram; update loop lifecycle to show provider interface; document provider resolution chain |
| `docs/SCHEMAS.md`           | Update event types; add provider config schemas; add provider field to backlog item and marker options                   |
| `docs/SPEC-CLI.md`          | Document `--provider` flag on `rauf loop run` (covers `--detached`)                                                      |
| `docs/CLAUDE-CODE-TASKS.md` | Reframe as Claude-specific provider notes (not system-wide)                                                              |
| `CLAUDE.md`                 | Update architectural references                                                                                          |

### 7.4 Files NOT Changed

| File                                  | Reason                                            |
| ------------------------------------- | ------------------------------------------------- |
| `packages/loop/src/claude-process.ts` | Kept as-is; `claude-cli` provider delegates to it |
| `packages/loop/src/signal-parser.ts`  | Already generic; works with any provider          |
| `packages/loop/src/git-commit.ts`     | Already generic                                   |
| `packages/core/src/backlog.ts`        | Already generic                                   |
| `packages/core/src/discovery.ts`      | Already generic                                   |
| `packages/core/src/status.ts`         | Already generic                                   |
| `packages/core/src/installer.ts`      | Already generic                                   |

---

## 8. Implementation Phases

### Phase 1: Provider Interface + Claude CLI Extraction

**Goal:** Introduce the `LLMProvider` interface and extract current behavior into `claude-cli` adapter. Zero behavioral change for users.

**Tasks:**

1. Create `packages/loop/src/providers/types.ts` with all interface definitions
2. Create `packages/loop/src/providers/registry.ts` with factory/resolution
3. Create `packages/loop/src/providers/claude-cli.ts` wrapping `spawnClaude()` + `checkUsageLimit()`
4. Refactor `packages/loop/src/runner.ts`:
   - Constructor accepts `LLMProvider` (or resolves from config)
   - Replace `spawnClaude()` call → `provider.execute()`
   - Replace `readClaudeOAuthToken()` + `checkUsageLimit()` → `provider.checkUsage?.()` and `provider.validateCredentials()`
   - Use `result.parsedSignal ?? parseSignal(result.stdout)` for signal
5. Update `packages/core/src/schemas.ts`:
   - Rename events: `claude_spawned` → `llm_spawned`, `claude_exited` → `llm_exited`
   - Add `provider` field to both event schemas
   - Add `provider?` to `MarkerOptionsSchema`, `LoopStartOptionsSchema`, `BacklogItemSchema`
   - Add `defaultProvider?`, `providers?` to `ToolConfigSchema`
6. Update `packages/cli/src/loop-commands.ts` for new event names
7. Update `packages/web/src/server/loop-manager.ts` for new event names
8. Update all tests

**Verification:** `pnpm test` passes. `rauf loop run` works identically.

### Phase 2: Generic CLI Adapter

**Goal:** Allow any CLI agent to be used via configuration.

**Tasks:**

1. Create `packages/loop/src/providers/generic-cli.ts`
   - Configurable binary, args, env
   - Template variables: `{{model}}`, `{{prompt_file}}`, `{{prompt}}`
   - Prompt delivery modes: stdin, file, arg
2. Add `--provider` flag to CLI commands
3. Update prompt builder: generalize "Task tool" references
4. Rename artifact templates: `CLAUDE_ADDON.md` → `AGENT_ADDON.md`, etc.
5. Update `.rauf/RAUF.md.tmpl`: remove "Claude Code Tasks" reference

**Verification:** Configure a mock agent (simple shell script that echoes `RAUF_DONE`). Run `rauf loop run --provider generic-cli`. Loop completes successfully.

### Phase 3: Claude Agent SDK Adapter

**Goal:** In-process Claude execution via Agent SDK with structured signals and streaming.

**Tasks:**

1. Add `@anthropic-ai/claude-agent-sdk` as optional peer dependency
2. Create `packages/loop/src/providers/claude-sdk.ts`
   - Implement `execute()` using `query()` async generator
   - Register `rauf_signal` MCP tool for structured signal capture
   - Stream progress events via `onProgress` callback
   - Map SDK errors to `UsageLimitResult`
3. Add `llm_progress` event type to schemas
4. Update CLI formatter and web frontend for `llm_progress` events

**Verification:** Integration test with real API key (or mock). Single iteration completes with `rauf_signal` tool call captured.

### Phase 4: Additional Providers + Per-Item Routing

**Goal:** Add Codex and Gemini adapters. Enable per-item provider selection.

**Tasks:**

1. Create `packages/loop/src/providers/openai-codex.ts`
2. Create `packages/loop/src/providers/gemini-cli.ts`
3. Implement per-item provider resolution in runner (read `item.provider` field)
4. Update documentation

**Verification:** Run iterations against two different providers in the same project.

---

## 9. Anthropic OAuth / Agent SDK Policy Context

The Claude Agent SDK **requires API key billing** (`ANTHROPIC_API_KEY`). Using OAuth tokens from Claude subscription plans (Free/Pro/Max) with the Agent SDK is technically functional but **explicitly prohibited** by Anthropic's [Legal and Compliance policy](https://code.claude.com/docs/en/legal-and-compliance):

> OAuth authentication (used with Free, Pro, and Max plans) is intended exclusively for Claude Code and Claude.ai. Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted and constitutes a violation of the Consumer Terms of Service.

There is **no non-commercial exception**. This is why `claude-cli` (which spawns the official Claude Code binary) must remain the default for subscription users, and `claude-sdk` is a separate opt-in provider requiring an API key.

---

## 10. Benefits

| Benefit                  | Detail                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| **No vendor lock-in**    | Users choose their preferred provider and billing model             |
| **Cost flexibility**     | Subscription (Claude CLI), pay-per-token (SDK/API), or free (local) |
| **Future-proof**         | New coding agents plug in via `LLMProvider` without touching core   |
| **Backward compatible**  | `claude-cli` remains default; existing users see no change          |
| **Community extensible** | `generic-cli` lets anyone add a provider via config alone           |
| **Live visibility**      | SDK providers stream progress events to dashboards                  |
| **Testable**             | Provider interface enables mock providers in tests                  |
| **Cleaner architecture** | Execution concerns isolated from orchestration concerns             |

## 11. Risks

| Risk                                                                                                                                                           | Mitigation                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signal protocol fragility:** Non-Claude agents must be taught RAUF_DONE via prompt instructions; some may not reliably produce it                            | Accept as inherent to text-based protocol; SDK providers use structured signals; document signal requirements prominently in RAUF.md        |
| **Lowest-common-denominator interface:** Different agents have vastly different capabilities (subagents, MCP, context windows); the interface may oversimplify | Keep interface minimal; provider-specific capabilities exposed via `providerConfig`; don't try to normalize advanced features               |
| **Maintenance surface:** Each adapter needs testing against real provider behavior; provider APIs change                                                       | Phase 1-2 are low maintenance (CLI spawning is stable); SDK adapters (Phase 3+) tracked as separate backlog items; community can contribute |
| **Raw LLM confusion:** Users may expect OpenRouter/Ollama to work like a coding agent                                                                          | Clear documentation: "coding agent" vs "raw LLM" distinction; `generic-cli` docs list known-compatible agents                               |
| **Event rename breaking change:** `claude_spawned` → `llm_spawned` breaks SSE consumers                                                                        | Do it in Phase 1 while user base is small; coordinate with frontend update                                                                  |
| **SDK maturity:** Claude Agent SDK is v0.2.x; API surface may change                                                                                           | Phase 3 is isolated; SDK adapter can be updated independently; `claude-cli` remains the stable default                                      |

---

## 12. Verification Plan

| Phase | Test                              | Method                                                           |
| ----- | --------------------------------- | ---------------------------------------------------------------- |
| 1     | All existing tests pass           | `pnpm test` (green)                                              |
| 1     | `rauf loop run` works identically | Manual E2E with real Claude Code CLI                             |
| 1     | New event names render correctly  | CLI + web frontend show `llm_spawned`/`llm_exited`               |
| 2     | Generic CLI with mock agent       | Shell script echoing `RAUF_DONE` completes a loop                |
| 2     | Provider flag works               | `rauf loop run --provider generic-cli` routes correctly          |
| 2     | Config resolution                 | Test: `item.provider > project > global > default`               |
| 3     | SDK signal capture                | `rauf_signal` MCP tool call → `parsedSignal` in result           |
| 3     | SDK streaming                     | `llm_progress` events reach web dashboard                        |
| 3     | SDK credential validation         | Missing `ANTHROPIC_API_KEY` → clear error before loop starts     |
| 4     | Multi-provider project            | Two items with different `provider` values complete successfully |
| All   | Type checking                     | `pnpm typecheck` (clean)                                         |
| All   | Lint                              | `pnpm lint` (clean)                                              |
