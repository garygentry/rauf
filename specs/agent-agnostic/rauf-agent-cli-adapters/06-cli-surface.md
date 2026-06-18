# 06 — CLI Surface (`--agent` flag, `--help` enumeration, `rauf agents`)

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, target repo **rauf**).
> Source of truth: `PRD.md` (v2, §3.6 Discoverability) + `tech-spec.md` (v2, §5.2 CLI).
> Depends on `00-core-definitions.md` for shared type/constant names and the naming model,
> on `02-agent-registry-and-detection.md` for `getAgentDescriptors` / `listAgents`, and on
> `04-agent-selection.md` for how `--agent` feeds `resolveAgentId`. Cross-references use exact
> filenames.
>
> This document specifies the **user-facing CLI surface** added in `packages/cli/src/loop-commands.ts`
> (and the command registration in `packages/cli/src/commands.ts`): the `--agent <id>` flag on
> `rauf loop run [path]`, the supported-id enumeration in `--help`, and the new `rauf agents`
> discovery command. It **plumbs** the flag into `LoopStartOptions.provider` and the detached-server
> body; it does **not** own the selection precedence (that is `04-agent-selection.md`), provider
> construction or detection primitives (that is `02-agent-registry-and-detection.md`), nor the
> runner wiring / fail-fast (that is `05-runner-wiring.md`).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-SEL-01 | `--agent <id>` flag on `rauf loop run`, mapped onto `LoopStartOptions.provider` (in-process) and `body.provider` (detached) | 3.1, 4.1 |
| REQ-DISC-01 | Supported agent ids enumerable from `--help`; surfaced in selection-error messages | 3.2, 5 |
| REQ-DISC-02 | `rauf agents` discovery command listing each agent + live availability (P1) | 3.3, 4.2 |

> Cross-cutting requirements touched but **owned elsewhere**: REQ-SEL-02/03/04 (precedence —
> `04-agent-selection.md`); REQ-DET-02 / `AgentUnavailableError` message assembly + fail-fast
> (`05-runner-wiring.md`); REQ-OBS-01 (`llm_spawned`/`llm_exited` carry the real id — value owned by
> `05-runner-wiring.md`; this doc confirms the formatter needs **no change**, §3.4).

## 1. Purpose & scope

The provider seam, registry, selection resolver, and runner wiring are delivered by `02`–`05`. What
remains is the **operator-facing CLI**: how a human picks an agent and discovers which agents exist
and which are installed. Three deliverables, all additive within `packages/cli`:

1. **`--agent <id>`** — a run-level flag on `rauf loop run [path]` (REQ-SEL-01). It is read with the
   existing string-flag helper and lands in `LoopStartOptions.provider` for the in-process path and
   in the POST `body.provider` for the detached/server path. It is the user-facing alias for the
   internal `provider` value (`00-core-definitions.md §4`).
2. **`--help` enumeration** — `rauf loop run --help` lists the supported agent ids, sourced from
   `getAgentDescriptors()` (REQ-DISC-01). The same id list is what selection-error messages embed
   (the message itself is assembled in `04`/`05`; this doc only confirms the id source and the help
   rendering).
3. **`rauf agents`** — a new top-level command listing each registered agent's id, display name, and
   **live availability**, sourced from `listAgents()` (REQ-DISC-02, P1).

### 1.1 Out of scope (delegated)

- **Selection precedence** (item → run → project → global → default) — `04-agent-selection.md §3.1`.
  This doc supplies only the `runProvider` layer (the `--agent` flag value).
- **Provider construction, the registry, `detectAgent`/`listAgents`/`getAgentDescriptors`
  implementations** — `02-agent-registry-and-detection.md`. This doc **consumes** those exports; it
  does not define them.
- **Pre-loop fail-fast, the `AgentUnavailableError` message, per-iteration resolve, event-`provider`
  value** — `05-runner-wiring.md`. This doc only surfaces the wrapped `Result` error those layers
  produce (§5) and confirms the event formatter is unchanged (§3.4).
- **The detached **server route** that consumes `body.provider`** — already exists
  (`tech-spec.md §5.2`, `01-architecture-layout.md §3`: `@rauf/web` needs no change). This doc only
  **sends** `body.provider`, mirroring the existing `body.model` send.

### 1.2 Verified source anchors

All edits are in `packages/cli/src/loop-commands.ts` and `packages/cli/src/commands.ts`. Verified
against source (file path + line):

| Anchor | Source | Verified |
|---|---|---|
| `handleLoopRun(ctx)` entry | `packages/cli/src/loop-commands.ts:688` | ✓ |
| In-process options assembly `LoopStartOptionsSchema.parse({...})` | `loop-commands.ts:813` | ✓ (fields end at `:823`) |
| In-process flag reads (`model` via `extractStringFlag`) | `loop-commands.ts:802` | ✓ |
| Detached body assembly, `if (model !== null) body.model = model;` | `loop-commands.ts:385` (model read at `:369`) | ✓ |
| `extractStringFlag` helper | imported `loop-commands.ts:49` from `./parser.js`; def `parser.ts:188` | ✓ |
| `llm_spawned` / `llm_exited` formatting (prints `event.provider`) | `loop-commands.ts:1184` / `:1195` | ✓ |
| `loop run` subcommand def + `flags` array | `commands.ts:162-224` (flags `:165-223`) | ✓ |
| `appendFlagLines` (renders `FlagDef[]` as a table) | `commands.ts:584` | ✓ |
| `FlagDef` / `SubcommandDef` / `CommandDef` types | `commands.ts:58-81` | ✓ |
| `COMMANDS` registry array + `commandMap` dispatch | `commands.ts:120-401`; top-level handler dispatch `main.ts:160-166` | ✓ |
| `renderTable` / `TableColumn` | `packages/cli/src/formatter.ts:134` / `:119` | ✓ |
| `LoopStartOptions.provider` schema field | `packages/core/src/schemas.ts:377` (`z.string().optional()`) | ✓ |

## 2. Naming: `--agent` (surface) → `provider` (internal)

Per `00-core-definitions.md §4`, the user-facing token is `--agent`; the internal field it lands in
is `provider`. **No committed schema field is renamed.** The flag value flows:

```
--agent <id>  ──extractStringFlag(ctx.flags, "agent")──►  options.provider  (LoopStartOptions.provider, schemas.ts:377)
                                                       └►  body.provider     (detached POST body, consumed by the existing web start route)
                                                              │
                                                              ▼
                                          04-agent-selection.md  resolveAgentId({ runProvider: options.provider, ... })
```

The CLI surface deliberately says `agent` everywhere a human reads it (flag name, help, the `rauf
agents` command) and `provider` only where it crosses into the committed in-memory option / request
shape.

## 3. Public surface

### 3.1 `--agent <id>` flag on `rauf loop run [path]` (REQ-SEL-01)

#### 3.1.1 In-process path (`handleLoopRun`, `loop-commands.ts:688`)

Read the flag alongside the existing string-flag reads (next to `model` at `loop-commands.ts:802`),
and add `provider` to the `LoopStartOptionsSchema.parse({...})` assembly at `loop-commands.ts:813`.
`extractStringFlag` returns `string | null` (`parser.ts:188`); coalesce `null` to `undefined` so the
optional schema field is simply absent when the flag is not passed (matching how `model` is handled
at `:802`).

```ts
// packages/cli/src/loop-commands.ts — inside handleLoopRun, alongside the existing flag reads
// (model is read at :802 the same way; add this line beside it):
const agent = extractStringFlag(ctx.flags, "agent") ?? undefined; // REQ-SEL-01 (00 §4: agent → provider)

// ... then in the existing LoopStartOptionsSchema.parse({...}) assembly at :813, add `provider`:
const options = LoopStartOptionsSchema.parse({
  maxIterations: iterations,
  maxRetries: retries,
  model,
  provider: agent, // NEW — REQ-SEL-01; lands in LoopStartOptions.provider (schemas.ts:377)
  sessionTimeoutMinutes: timeout,
  review,
  reviewOnly,
  suppressIterationReview,
  pauseOnNeedsHuman,
  backlogRoot: backlogRootResult.value,
});
```

- `LoopStartOptionsSchema` is already imported (`loop-commands.ts:17` from `@rauf/core`) and
  `LoopStartOptions.provider` is already a committed `z.string().optional()` field
  (`schemas.ts:377`) — **no schema change** (`00 §4`, `01-architecture-layout.md §3`). `parse` strips
  `undefined` optionals, so omitting `--agent` produces an options object identical to today
  (REQ-SEL-03 invariant; preserves SC-2).
- `options.provider` is then consumed by the runner as `runProvider` in
  `resolveAgentId({ runProvider: this.options.provider, ... })` (`04-agent-selection.md §3.1`,
  `05-runner-wiring.md`). This doc does **not** call `resolveAgentId`.
- No validation of `<id>` happens here: an unknown id is surfaced later by the runner's pre-loop
  detection / per-iteration resolve as a `Result` error listing supported ids (§5). The CLI does not
  pre-validate against the registry, keeping the flag-plumbing layer free of registry coupling
  (parallels how `--model` is not validated CLI-side).

#### 3.1.2 Detached / server path (`runDetached`, `loop-commands.ts:348`)

The detached path builds a POST body from flags and sends it to the server start route. Mirror the
existing `body.model` send at `loop-commands.ts:385` (model read at `:369`):

```ts
// packages/cli/src/loop-commands.ts — inside runDetached, alongside the existing body assembly
const agent = extractStringFlag(ctx.flags, "agent"); // read beside `model` at :369
// ...
if (model !== null) body.model = model;       // EXISTING (:385)
if (agent !== null) body.provider = agent;     // NEW — REQ-SEL-01; mirrors body.model send
```

- The body key is `provider` (the wire/option name), not `agent` — it maps to
  `LoopStartOptions.provider` server-side. The existing web start route already accepts
  `body.provider` (it deserializes into `LoopStartOptionsSchema`); `@rauf/web` needs **no change**
  (`01-architecture-layout.md §3`, `tech-spec.md §5.2`). This doc only emits the field.
- `extractStringFlag` consumes (deletes) the flag from the map, so it never leaks into any other
  body field — identical to the `model` handling pattern.

> **WARNING — verify before implementing:** the server-side start route's acceptance of
> `body.provider` was **not** re-verified line-by-line in this doc (the tech-spec states the field
> already exists and `@rauf/web` is unchanged). Confirm the web start handler deserializes
> `body.provider` into `LoopStartOptionsSchema` (it should, since `provider` is a committed schema
> field) before relying on the detached path; the in-process path (§3.1.1) is fully verified.

### 3.2 `--agent` flag registration + `--help` enumeration (REQ-DISC-01)

The `rauf loop run` subcommand's documented flags live in a static `FlagDef[]` array
(`commands.ts:165-223`), rendered by `appendFlagLines` (`commands.ts:584`) → `renderTable`. Add a new
`--agent <id>` `FlagDef` whose description **enumerates the supported ids** from
`getAgentDescriptors()` (`02-agent-registry-and-detection.md §4` — synchronous, no I/O).

Because `FlagDef.description` is a plain `string` and the `COMMANDS` array is a module-level constant
(`commands.ts:120`), the enumeration is computed **once at module load** — after the provider
side-effect registration in `@rauf/loop` (`providers/index.ts` registers all built-ins;
`02-agent-registry-and-detection.md §6`). Adding the `@rauf/loop` registry import to `commands.ts`
ensures the side-effect registration has run before `getAgentDescriptors()` is read.

```ts
// packages/cli/src/commands.ts — add import (triggers + reads the registry; side-effect registration
// of all built-in adapters runs via @rauf/loop's barrel):
import { getAgentDescriptors } from "@rauf/loop"; // 02-agent-registry-and-detection.md §4

// Computed once at module load (sync, no I/O — REQ-DISC-01). getAgentDescriptors() returns the
// STATIC descriptors (no availability probe) — exactly the cheap enumeration the help path needs.
const SUPPORTED_AGENT_IDS = getAgentDescriptors()
  .map((d) => d.id)
  .join(", ");
// e.g. "claude-cli, codex, gemini, copilot, cursor, generic-cli"

// ... within the `run` subcommand's `flags` array (commands.ts:165-223), add:
{
  name: "--agent <id>",
  description: `Coding agent CLI that drives iterations (default: claude-cli). Supported: ${SUPPORTED_AGENT_IDS}. See \`rauf agents\` for live availability.`,
},
```

- **Synchronous source (REQ-DISC-01):** `getAgentDescriptors()` is explicitly the synchronous,
  no-I/O enumeration (`02-agent-registry-and-detection.md §2`, §4). The help path must never block on
  PATH probing — availability is the job of `rauf agents` (`listAgents`, §3.3). Using
  `getAgentDescriptors()` here (not `listAgents()`) is required: `--help` is a hot, sync render path.
- **Where the help text renders:** `rauf loop run --help` (and `rauf help loop run`) routes to
  `showSubcommandHelp` → `appendFlagLines` (`commands.ts:577/584`), which tables every `FlagDef`
  including the new `--agent <id>` row. No change to the help renderer is required — only the new
  `FlagDef` entry.
- **`--json` help:** `showSubcommandHelp` emits `flags: sub.flags ?? []` under `--json`
  (`commands.ts:570`); the `--agent` `FlagDef` (with its enumerated description) is included
  automatically. No special-casing.
- **Selection-error messages also list the ids (REQ-DISC-01):** when a selected agent is unknown or
  unavailable, the error message embeds the supported-id list. That message is assembled by the
  selection/runner layers (`04-agent-selection.md §6`, `05-runner-wiring.md`; `00 §5` template:
  `... Supported agents: <ids>.`) from the same `getAgentDescriptors()` source. This doc's
  responsibility is limited to (a) the help enumeration above and (b) printing the wrapped `Result`
  error those layers return (§5). The CLI does not re-derive the id list for errors.

> **Why module-load-time, not per-invocation:** `COMMANDS` is a `const` array consumed by the help
> renderer; the descriptor set is fixed once side-effect registration completes (built-in adapters
> only — no per-run config agents appear in `--agent` help, by design, since help is run-context-free).
> Computing `SUPPORTED_AGENT_IDS` once at load is correct and avoids probing on every help render.
> Named config agents from `ToolConfig.providers` are **not** enumerated in `--help` (they are
> per-project/run config, not built-ins) — they DO appear in `rauf agents` when a run context /
> config is available (§3.3 note).

### 3.3 `rauf agents` discovery command (REQ-DISC-02, P1)

A new **top-level** command `rauf agents` lists every registered agent with its id, display name, and
**live availability**. Placement is `rauf agents` (top-level), settled in `tech-spec.md §10` over the
alternative `rauf loop agents`.

> **Placement decision (tech-spec §10).** `rauf agents` (top-level) is chosen because agent
> availability is a machine-wide capability question, not a per-loop operation — it parallels other
> top-level capability/inventory commands (`rauf projects`, `rauf version`). The rejected alternative
> `rauf loop agents` would nest a discovery query under the loop-operation namespace, implying it
> needs a project/loop context (it does not). If a future change wants both spellings, `rauf loop
> agents` can be added as a thin alias subcommand delegating to the same handler — out of scope here.

#### 3.3.1 Command registration (`commands.ts`)

Add a top-level `CommandDef` to the `COMMANDS` array (`commands.ts:120`). It has a `handler` and **no
subcommands**, so it dispatches via the top-level handler path (`main.ts:161-166`):

```ts
// packages/cli/src/commands.ts — new import + COMMANDS entry
import { handleAgents } from "./loop-commands.js"; // handler defined in §4.2

// ... appended to the COMMANDS array (top-level, alongside `version`, `projects`, etc.):
{
  name: "agents",
  description: "List supported coding agents and whether each is available on this machine",
  usage: "rauf agents [--json]",
  flags: [
    { name: "--json", description: "Emit the agent availability list as JSON" },
  ],
  handler: handleAgents,
},
```

- Dispatch: `findCommand("agents")` → `cmd.handler(ctx)` (`main.ts:71`, `:166`). No subcommand
  plumbing needed.
- `--help` for the command (`rauf agents --help` / `rauf help agents`) is handled by the generic
  `showCommandHelp` → `appendFlagLines` path using the `flags` array above — no extra work.

#### 3.3.2 Output format

A table with four columns — **ID, NAME, AVAILABLE, DETAIL** — rendered with the existing
`renderTable` (`formatter.ts:134`). Data source: `listAgents()`
(`02-agent-registry-and-detection.md §4`), which awaits each descriptor's `detect` (default PATH
probe, claude credential check, or generic-cli config probe) and returns `AgentAvailability[]`
(`{ id, displayName, binaryName?, available, detail? }`).

Human (non-`--json`) example:

```text
$ rauf agents
ID           NAME                            AVAILABLE  DETAIL
───────────  ──────────────────────────────  ─────────  ────────────────────────────────────────────────
claude-cli   Claude Code (CLI)               yes        Claude OAuth credentials present
codex        OpenAI Codex (CLI)              yes        found at /usr/local/bin/codex
gemini       Gemini (CLI)                    no         binary "gemini" not found on PATH
copilot      GitHub Copilot (CLI)            no         binary "copilot" not found on PATH
cursor       Cursor (CLI)                    yes        found at /usr/local/bin/cursor-agent
generic-cli  Generic CLI agent (configurable) yes       configurable; binary resolved at run time
```

- The `AVAILABLE` cell renders `yes`/`no` from the boolean `available`. Color is applied per cell
  (green for `yes`, dim/yellow for `no`) via the `formatter` color helpers (`c.green` / `c.yellow`),
  consistent with the rest of the CLI; color is suppressed under `--no-color` by the formatter.
- The `DETAIL` cell is the descriptor's `detail` string verbatim (PATH location, "not found", or
  credential status) — sourced from `DetectionResult.detail` (`00 §3.3`).

`--json` example (machine-readable; emitted via `outputJson`):

```json
{
  "agents": [
    { "id": "claude-cli", "displayName": "Claude Code (CLI)", "binaryName": "claude", "available": true, "detail": "Claude OAuth credentials present" },
    { "id": "codex", "displayName": "OpenAI Codex (CLI)", "binaryName": "codex", "available": true, "detail": "found at /usr/local/bin/codex" },
    { "id": "gemini", "displayName": "Gemini (CLI)", "binaryName": "gemini", "available": false, "detail": "binary \"gemini\" not found on PATH" }
  ]
}
```

The `--json` shape is exactly the `AgentAvailability[]` rows under an `agents` key (no transformation
beyond wrapping), so it is a stable, parseable surface for tooling.

### 3.4 No change to `llm_spawned` / `llm_exited` formatting (REQ-OBS-01, for completeness)

The event renderer at `loop-commands.ts:1184` (`llm_spawned`) and `:1195` (`llm_exited`) already
prints `event.provider` (verified). The agent-id value carried by the event becomes the **real**
selected agent id rather than a hardcoded `"claude-cli"` — but that is the `provider` *value*, set in
the runner (`05-runner-wiring.md`, REQ-OBS-01). **No formatter change is needed in this doc**; the
existing `${event.provider} spawned ...` / `${event.provider} exited ...` lines render the new value
unchanged. Listed here only to make the CLI surface's relationship to REQ-OBS-01 explicit.

## 4. Internal implementation

### 4.1 `--agent` flag plumbing (no new helper)

The flag uses the existing `extractStringFlag(ctx.flags, "agent")` helper (`parser.ts:188`, imported
at `loop-commands.ts:49`) — **no new parsing code**. Two call sites:

- `handleLoopRun` (in-process): read → `options.provider` in the `:813` assembly (§3.1.1).
- `runDetached` (detached): read → `body.provider` mirroring `body.model` at `:385` (§3.1.2).

Both call sites read the flag exactly once and let the helper delete it from the flags map (so it
cannot collide with downstream flag handling). The flag is registered for help/parsing via the new
`FlagDef` (§3.2); the generic argument parser accepts any `--key value` flag, so no allow-list change
is needed.

### 4.2 `handleAgents` command handler

New exported handler in `packages/cli/src/loop-commands.ts` (colocated with the other loop-area
handlers; imported by `commands.ts` §3.3.1):

```ts
// packages/cli/src/loop-commands.ts
import { listAgents } from "@rauf/loop"; // 02-agent-registry-and-detection.md §4
import type { AgentAvailability } from "@rauf/loop"; // 02 §4 (discovery DTO)
import { renderTable, type TableColumn } from "./formatter.js"; // formatter.ts:134/:119
// (c, print, outputJson, error are already imported at loop-commands.ts:50)

/**
 * `rauf agents` — list every registered coding agent and whether its CLI is available on this
 * machine (REQ-DISC-02). Pure read + PATH/credential probe only: NO agent subprocess is spawned
 * (availability derivation is `listAgents()` → per-descriptor `detect`, which is a stat-style PATH
 * resolution or a credential read — consistent with CLAUDE.md "status reads files, not
 * subprocesses"). Never fails on an unavailable agent: an absent CLI is reported as
 * `available: false`, not an error.
 *
 * @param ctx - CLI command context (honors `--json` via ctx.globalFlags.json).
 * @returns ExitCode.SUCCESS (0) on success; ExitCode.ERROR (1) only on an unexpected internal
 *          failure (listAgents never rejects per 02 §8, so this is a defensive backstop).
 */
export async function handleAgents(ctx: CommandContext): Promise<number> {
  let rows: AgentAvailability[];
  try {
    rows = await listAgents(); // 02 §4 — never rejects; unavailable agents are data, not errors
  } catch (e) {
    // Defensive only: listAgents is specified never to reject (02 §8). Surface as a generic error.
    error(`Failed to list agents: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }

  if (ctx.globalFlags.json) {
    outputJson({ agents: rows });
    return ExitCode.SUCCESS;
  }

  const columns: TableColumn[] = [
    { header: "ID", key: "id" },
    { header: "NAME", key: "name" },
    { header: "AVAILABLE", key: "available" },
    { header: "DETAIL", key: "detail" },
  ];
  const tableRows = rows.map((r) => ({
    id: r.id,
    name: r.displayName,
    available: r.available ? c.green("yes") : c.yellow("no"),
    detail: r.detail ?? "",
  }));
  print(renderTable(columns, tableRows));
  return ExitCode.SUCCESS;
}
```

- **Availability derivation is a pure read + PATH probe — no agent subprocess.** `listAgents()` calls
  each descriptor's `detect`, which is the default PATH `fs.access` stat
  (`02-agent-registry-and-detection.md §5.1`), the claude credential read, or the generic-cli config
  probe — never an agent invocation (CLAUDE.md rule 6: "status reads files, not subprocesses"; PATH
  resolution is a stat). This handler therefore satisfies the "status reads files" constraint.
- **Never fails on an unavailable agent.** `listAgents()` reports an absent CLI as
  `{ available: false, detail }` and never rejects (`02 §8`); the handler always returns
  `ExitCode.SUCCESS` (0) for a successful listing regardless of how many agents are available. The
  `try/catch` is a defensive backstop only.
- **Exit code:** `0` on a successful listing (even if every agent is unavailable). `1`
  (`ExitCode.ERROR`) only on an unexpected internal failure — which `listAgents`'s contract makes
  effectively unreachable.
- **Generic config agents (note):** `listAgents()` enumerates the **registered descriptors**
  (built-ins: claude-cli + presets + the reserved `generic-cli`). Named config agents from
  `ToolConfig.providers` become descriptors only when the selection layer builds them for a run
  (`04-agent-selection.md`, `02 §5.4`), so a context-free `rauf agents` lists the built-ins plus the
  reserved `generic-cli` row (reported `available: true` / "configurable", per `02 §5.4`). Surfacing
  configured generic agents from project/global config is a possible enhancement (read
  `ToolConfig.providers` via the existing `readToolConfig` loader and append synthesized rows); it is
  **not required** for REQ-DISC-02 and is left to the implementation if a project context is
  available. The required behavior is: every registered descriptor is listed with live availability.

## 5. Error handling

The CLI surface is intentionally thin and defers all *expected* selection errors to the layers that
own them; it only **renders** their `Result` errors. Per CLAUDE.md, expected errors are `Result`
values, not throws.

| Situation | Where detected | CLI behavior | REQ |
|---|---|---|---|
| `--agent <id>` with an unknown/mistyped id | runner per-iteration resolve / pre-loop detection wraps `createProvider`'s throw into a `Result` error listing `getAgentDescriptors()` ids (`04 §6`, `05`, `00 §5`) | `handleLoopRun` already prints `runnerResult.error.message` (`loop-commands.ts:840-842`) and any loop-result error; the wrapped message includes the supported-id list (REQ-DISC-01) | REQ-DISC-01 |
| `--agent <id>` whose CLI is absent | runner pre-loop `detectAgent` fail-fast → `AgentUnavailableError`-shaped `Result` error before any state write (`05`, `00 §5`) | CLI prints that error message (which names the agent + remediation + supported ids) and returns the runner's non-zero exit code; no state written, no fallback (REQ-DET-02, SC-3) | (REQ-DET-02 owned by `05`) |
| `--agent` flag omitted | n/a — `options.provider` is `undefined`; selection falls through to `claude-cli` (`04 §3.1` row 5) | identical to today (REQ-SEL-03 / SC-2) | REQ-SEL-03 |
| `rauf agents` with one or more unavailable agents | `listAgents()` reports them `available: false` | command succeeds (exit 0), table/JSON shows `no` + detail; **never an error** | REQ-DISC-02 |
| `rauf agents` unexpected internal failure | defensive `try/catch` (§4.2) | `error(...)` + `ExitCode.ERROR` (1); unreachable given `listAgents`'s no-reject contract | REQ-DISC-02 |
| `--agent` value missing (e.g. `--agent` with no argument) | `extractStringFlag` returns `null` for a valueless flag (`parser.ts:192`) | treated as "not provided" → `undefined`; falls through to default selection (REQ-SEL-03). No crash. | REQ-SEL-01 |

The `--agent` flag-plumbing code itself has **no expected-error surface**: `extractStringFlag` cannot
throw, `LoopStartOptionsSchema.parse` accepts any string for the optional `provider` field, and the
detached `body.provider` is a plain string assignment. The validation of *whether the id is a real,
available agent* is owned entirely by `04`/`05` and surfaced to the operator via the existing
error-printing in `handleLoopRun`.

## 6. Configuration

No new config files, keys, or schema fields (`00 §4`, `01-architecture-layout.md §3`,
`tech-spec.md §4`):

- `--agent` lands in the **committed** `LoopStartOptions.provider` field (`schemas.ts:377`) — no
  schema change.
- `rauf agents` reads no project/config files for its required behavior; its only inputs are the
  registry descriptors and (via `detect`) `process.env.PATH` / the claude OAuth credential — all
  owned by `02-agent-registry-and-detection.md`. The optional "configured generic agents" enhancement
  (§4.2 note) would read `ToolConfig` via the existing sandboxed `readToolConfig` loader (within
  `~/.rauf/`), adding no new config surface.
- The detached `body.provider` is an in-memory request field consumed by the existing web start
  route — no config, no schema change (`@rauf/web` unchanged, `01 §3`).

## Dependencies

Must be implemented **after**:

- **`00-core-definitions.md`** — the `agent` ↔ `provider` naming model (§4), `DEFAULT_AGENT_ID`
  (`"claude-cli"`, §6), and the selection-error message template (§5) the CLI renders.
- **`02-agent-registry-and-detection.md`** — provides `getAgentDescriptors()` (sync, for the
  `--help` enumeration and id list) and `listAgents()` + `AgentAvailability` (async, for `rauf
  agents`). These MUST be exported from the `@rauf/loop` barrel
  (`01-architecture-layout.md §4`) before this doc's `commands.ts`/`loop-commands.ts` imports resolve.
- **`04-agent-selection.md`** — defines how `LoopStartOptions.provider` (the `--agent` value) is
  consumed as `runProvider` in `resolveAgentId`, and owns the selection-error wrapping whose message
  this doc prints.

Reuses (no change to these — verified against source):

- `packages/cli/src/loop-commands.ts` — `handleLoopRun` (`:688`), in-process options assembly
  (`:813`), `runDetached` body assembly (`:385`), `extractStringFlag` import (`:49`),
  `llm_spawned`/`llm_exited` formatter (`:1184`/`:1195`). EDIT: add `--agent` reads at both sites; add
  the `handleAgents` handler.
- `packages/cli/src/commands.ts` — `loop run` subcommand `flags` array (`:165-223`), `COMMANDS`
  registry (`:120`), `FlagDef`/`CommandDef` types (`:58-81`), `appendFlagLines` (`:584`). EDIT: add
  the `--agent <id>` `FlagDef`, the `SUPPORTED_AGENT_IDS` enumeration + `getAgentDescriptors` import,
  and the `agents` command entry + `handleAgents` import.
- `packages/cli/src/parser.ts` — `extractStringFlag` (`:188`). Reused, unchanged.
- `packages/cli/src/formatter.ts` — `renderTable` (`:134`), `TableColumn` (`:119`), `outputJson`,
  `print`, `error`, `c` color helpers. Reused, unchanged.
- `packages/core/src/schemas.ts` — `LoopStartOptions.provider` (`:377`). Reused, unchanged.
- `@rauf/loop` barrel — `getAgentDescriptors`, `listAgents`, `AgentAvailability`
  (`01-architecture-layout.md §4`, `02 §4`). Consumed, not defined here.

Depended on **by**:

- **`07-testing-strategy.md`** — `loop-commands.test.ts` (flag plumbing into `options.provider` and
  `body.provider`; `handleAgents` listing + `--json`) and `commands.test.ts` (the `--agent` `FlagDef`
  in help, the `agents` command registration).

## Verification (maps to SC-5: `--agent` selection + discovery surface)

- [ ] `rauf loop run [path] --agent codex` sets `options.provider === "codex"` in the
  `LoopStartOptionsSchema.parse({...})` assembly (`loop-commands.ts:813`), via
  `extractStringFlag(ctx.flags, "agent")` (REQ-SEL-01).
- [ ] Omitting `--agent` leaves `options.provider` `undefined`, producing an options object identical
  to today (REQ-SEL-03 / SC-2 — no behavioral change to the default claude path).
- [ ] `rauf loop run [path] --detached --agent codex` sends `body.provider === "codex"` in the POST
  body, mirroring the existing `body.model` send (`loop-commands.ts:385`); no other body field is
  affected (REQ-SEL-01).
- [ ] `rauf loop run --help` (and `rauf help loop run`) lists a `--agent <id>` flag whose description
  enumerates the supported ids from `getAgentDescriptors()` (e.g. includes `claude-cli, codex, gemini,
  copilot, cursor, generic-cli`) (REQ-DISC-01).
- [ ] The `--help` enumeration is computed synchronously (no PATH probe / no `await` on the help
  path) — sourced from `getAgentDescriptors()`, NOT `listAgents()`.
- [ ] A selection error from an unknown/absent `--agent` id is printed by `handleLoopRun` and its
  message includes the supported-id list (the message is assembled by `04`/`05`; this verifies the
  CLI surfaces it) (REQ-DISC-01).
- [ ] `rauf agents` prints a table with columns **ID, NAME, AVAILABLE, DETAIL**, one row per
  registered descriptor, with `available` rendered `yes`/`no` from `listAgents()` (REQ-DISC-02).
- [ ] `rauf agents --json` emits `{ "agents": AgentAvailability[] }` (REQ-DISC-02).
- [ ] `rauf agents` returns exit code 0 even when some/all agents are unavailable, and never spawns an
  agent subprocess (availability is a PATH stat / credential read only — CLAUDE.md "status reads
  files, not subprocesses") (REQ-DISC-02).
- [ ] `rauf agents` is registered as a **top-level** command (`commands.ts` `COMMANDS` array) with a
  handler and no subcommands; `findCommand("agents").handler` dispatches via `main.ts:166`.
- [ ] The `llm_spawned`/`llm_exited` formatter (`loop-commands.ts:1184`/`:1195`) is **unchanged** —
  it already prints `event.provider`; only the value differs (owned by `05`).
- [ ] `pnpm build && pnpm gate` is green for `@rauf/cli` (SC-7); `@rauf/cli` typechecks against the
  built `@rauf/loop` `dist/*.d.ts` exporting `getAgentDescriptors`/`listAgents`/`AgentAvailability`.
