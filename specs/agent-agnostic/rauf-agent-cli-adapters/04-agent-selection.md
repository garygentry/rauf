# 04 — Agent Selection (`loop-agent-selection`)

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, target repo **rauf**).
> Source of truth: `PRD.md` (v2, §3.1 REQ-SEL) + `tech-spec.md` (v2, §3.1, §3.3, §4.1).
> Depends on `00-core-definitions.md` for all shared type/constant names and reused contracts.
> Cross-references use exact filenames.

This document specifies the **loop-agent-selection charter contract**: the pure precedence
resolver `resolveAgentId`, the layer→source map that feeds it, and the additive `agent`
input-alias normalization. It defines *which agent id drives an iteration*; it does **not**
construct providers, probe availability, or wire the runner — those are
`02-agent-registry-and-detection.md` (`createProvider`/`detectAgent`) and `05-runner-wiring.md`
(per-iteration resolve + fail-fast). No committed schema field is renamed (PRD §5).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-SEL-01 | `--agent`/`agent` user surface aliases internal `provider` | 3.2 (alias normalization), 5 (layer→source map) |
| REQ-SEL-02 | 5-layer precedence (item → run → project → global → default) | 3.1 (`resolveAgentId` + precedence matrix), 5 |
| REQ-SEL-03 | Default `claude-cli` ⇒ identical-to-today behavior | 3.1 (fall-through), 7 (verification) |
| REQ-SEL-04 | Per-item agent selection | 3.1 (`itemProvider`, highest), 5 (`BacklogItem.provider`) |
| REQ-MODEL-01 (cross-ref) | Model precedence independent of agent selection | 2, 6 (parallels `runner.ts:494`, see `05-runner-wiring.md`) |

## 1. Purpose & scope

### 1.1 In scope

- A single **pure, total** resolver `resolveAgentId` that collapses up to four optional
  agent-id layers into exactly one agent id, falling through to `DEFAULT_AGENT_ID`
  (`"claude-cli"`, `00-core-definitions.md §6`) when no layer is set (REQ-SEL-02, REQ-SEL-03).
- The **layer → schema-field source map** (§5): where each of the four inputs originates, which
  existing `@rauf/core` config loader reads it, and the sandboxing guarantees it inherits.
- The additive, non-breaking **`agent` input-alias** normalization helper (`normalizeAgentAlias`)
  applied at the load/parse boundary, mapping the user-facing `agent` key onto the canonical
  internal `provider` key before validation (REQ-SEL-01, tech-spec §4.1).

### 1.2 Out of scope (delegated)

- **Constructing** the resolved provider from its id — `createProvider(id)`
  (`02-agent-registry-and-detection.md`; `00-core-definitions.md §7`). `resolveAgentId` returns
  a *string*, never a provider.
- **Availability detection / fail-fast** when a resolved id has no installed CLI —
  `detectAgent(id)` + the pre-loop orchestration (`05-runner-wiring.md`; REQ-DET-01/02).
- **Calling** the resolver per iteration, caching providers, and dispatching both execution
  paths — `05-runner-wiring.md` (REQ-ADP-06).
- **Plumbing `--agent` from the CLI** into `LoopStartOptions.provider` and the detached-server
  body — `06-cli-surface.md` (REQ-SEL-01 surface).

`agent-selection.ts` imports no runner, no spawning, no filesystem of its own beyond the named
`@rauf/core` loaders used by its *callers* (the resolver itself takes plain string inputs — see
§3.1). It is the lowest-risk, most-unit-testable node in the dependency graph
(`01-architecture-layout.md §5`).

## 2. Relationship to model precedence (REQ-MODEL-01, cross-ref `05-runner-wiring.md`)

`resolveAgentId`'s precedence is **deliberately parallel** to the committed model-resolution
precedence in the runner, verified at source:

```ts
// packages/loop/src/runner.ts:494 (UNCHANGED by this feature — REQ-MODEL-01)
const resolvedModel = item.model ?? this.options.model ?? projectModel;
```

Model resolution stays **independent** of agent selection: the two resolvers run side by side,
neither consuming the other's result. `resolveAgentId` chooses *which agent CLI runs*; the model
string is resolved separately and handed to that agent's adapter (`05-runner-wiring.md`;
`03-cli-agent-engine-and-presets.md §modelFlag`). This document does not alter `runner.ts:494`.
The structural parallel (item wins, then run-level, then project, then a built-in default) is
intentional so operators reason about both axes identically.

## 3. Public API

Module: `packages/loop/src/agent-selection.ts` (NEW — `01-architecture-layout.md §2`).
Re-exported from `packages/loop/src/index.ts` as the `loop-agent-selection` charter contract
(`01-architecture-layout.md §4`), alongside re-exports of the `00-core-definitions.md §6`
constants `DEFAULT_AGENT_ID` / `GENERIC_AGENT_ID`.

### 3.1 `resolveAgentId` — the precedence resolver (REQ-SEL-02/03/04)

Exact signature (verbatim from tech-spec §3.3):

```ts
import { DEFAULT_AGENT_ID } from "./constants.js"; // 00 §6 constants live here; this module re-exports them (§4)

/**
 * Resolve the single agent id that drives an iteration, collapsing the four optional
 * selection layers by precedence (REQ-SEL-02). Pure and **total**: never throws, never
 * does I/O — every input is a plain optional string and the function always returns a
 * non-empty agent id (falling through to {@link DEFAULT_AGENT_ID} when nothing is set,
 * REQ-SEL-03). Validating that the returned id is a *known* agent is the consumer's job:
 * `createProvider(id)` / `detectAgent(id)` (02-agent-registry-and-detection.md,
 * 05-runner-wiring.md) — this resolver does not know the registry.
 *
 * Precedence (highest wins): itemProvider → runProvider → projectProvider → globalProvider
 * → DEFAULT_AGENT_ID. Deliberately parallels the model precedence at runner.ts:494
 * (item.model ?? options.model ?? projectModel), which is left intact (REQ-MODEL-01).
 *
 * @param input - the four candidate agent ids, each optional; absent/empty layers are skipped.
 * @returns the resolved agent id; `"claude-cli"` when every layer is absent (REQ-SEL-03).
 */
export function resolveAgentId(input: {
  /** BacklogItem.provider — per-item agent, highest precedence (REQ-SEL-04). */
  itemProvider?: string;
  /** LoopStartOptions.provider — set from `--agent` / detached server body (06-cli-surface.md). */
  runProvider?: string;
  /** Project `.rauf.json` → MarkerOptions.provider. */
  projectProvider?: string;
  /** Global `~/.rauf/config.json` → ToolConfig.defaultProvider. */
  globalProvider?: string;
}): string;
```

#### Reference implementation

The resolver is a left-to-right coalesce. Because the committed schema fields are
`z.string().optional()` (so a value, when present, is a non-empty string by upstream
contract), a plain `??` chain suffices; an explicit empty-string guard is added defensively so
a stray `""` from a hand-edited config does not win over a real lower layer.

```ts
import { DEFAULT_AGENT_ID } from "./constants.js"; // 00 §6 source (this module re-exports it, §4)

export function resolveAgentId(input: {
  itemProvider?: string;
  runProvider?: string;
  projectProvider?: string;
  globalProvider?: string;
}): string {
  // Treat empty/whitespace-only as "unset" so it does not shadow a real lower layer.
  const pick = (v?: string): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  return (
    pick(input.itemProvider) ??
    pick(input.runProvider) ??
    pick(input.projectProvider) ??
    pick(input.globalProvider) ??
    DEFAULT_AGENT_ID
  );
}
```

> `DEFAULT_AGENT_ID` is the `"claude-cli"` constant defined once in `00-core-definitions.md §6`
> and re-exported here (`01-architecture-layout.md §4`). It is **not** redefined in this module.

#### Precedence matrix (REQ-SEL-02/03/04)

Each row shows which layer's value the resolver returns. `—` means that layer is unset
(`undefined` or empty/whitespace). The **Result** column is exactly what `resolveAgentId`
returns.

| # | `itemProvider` | `runProvider` | `projectProvider` | `globalProvider` | Result | Winning layer |
|---|---|---|---|---|---|---|
| 1 | `codex` | `gemini` | `cursor` | `copilot` | `codex` | per-item (REQ-SEL-04) |
| 2 | — | `gemini` | `cursor` | `copilot` | `gemini` | run-level `--agent` |
| 3 | — | — | `cursor` | `copilot` | `cursor` | project `.rauf.json` |
| 4 | — | — | — | `copilot` | `copilot` | global `~/.rauf/config.json` |
| 5 | — | — | — | — | `claude-cli` | built-in default (REQ-SEL-03) |
| 6 | `codex` | — | — | `copilot` | `codex` | per-item beats global |
| 7 | — | `gemini` | — | `copilot` | `gemini` | run-level beats global |
| 8 | `""` (whitespace) | `gemini` | — | — | `gemini` | empty item skipped (defensive) |
| 9 | `cursor` | `cursor` | `cursor` | `cursor` | `cursor` | any layer (idempotent) |

- **Row 1** demonstrates per-item override (REQ-SEL-04): a single backlog can route different
  items to different agents because `itemProvider` always wins.
- **Row 5** is the keystone for REQ-SEL-03: with no selection at any layer the result is
  `"claude-cli"`, which `05-runner-wiring.md` resolves to the unchanged committed `claude-cli`
  adapter — behavior **identical to today**.
- **Row 8** shows the defensive empty-string skip; without it a blank persisted `provider:""`
  would incorrectly win over a real run-level flag.

#### Example usage (caller assembles the layers, then resolves)

```ts
import { resolveAgentId } from "@rauf/loop"; // re-export; or "./agent-selection.js" intra-package

// Per iteration (05-runner-wiring.md owns the actual call):
const agentId = resolveAgentId({
  itemProvider: item.provider,           // BacklogItem.provider (schemas.ts:72)
  runProvider: this.options.provider,    // LoopStartOptions.provider (schemas.ts:377)
  projectProvider,                       // MarkerOptions.provider (schemas.ts:148), read once at loop start
  globalProvider,                        // ToolConfig.defaultProvider (schemas.ts:222), read once at loop start
});
// agentId is now a string; 05-runner-wiring.md passes it to createProvider(agentId).
```

### 3.2 `normalizeAgentAlias` — `agent` input-alias normalization (REQ-SEL-01, tech-spec §4.1)

The user-facing authoring key is `agent`; the canonical persisted/internal key is `provider`
(`00-core-definitions.md §4` naming model). To accept `agent` in hand-authored backlog items and
config **without** a breaking schema change (PRD §6), a normalization helper folds an optional
`agent` key onto `provider` **before** Zod validation, at the load/parse boundary.

```ts
/**
 * Fold the user-facing `agent` input-alias key onto the canonical internal `provider` key
 * (REQ-SEL-01, 00-core-definitions.md §4). Additive and non-breaking: the persisted/canonical
 * key stays `provider`; `agent` is accepted only as an authoring convenience and is dropped
 * from the returned object. MUST run BEFORE schema validation (the committed schemas have no
 * `agent` field — see §3.3 for the exact boundary).
 *
 * Conflict rule (tech-spec §4.1): if BOTH keys are present, `provider` WINS and a warning is
 * logged; `agent` is discarded. This keeps the explicit canonical key authoritative.
 *
 * @typeParam T - the raw, pre-validation object (e.g. a parsed JSON backlog item or config).
 * @param raw - the raw object possibly carrying `agent` and/or `provider`.
 * @param onWarn - optional sink for the conflict warning (defaults to the module logger).
 * @returns a shallow copy with `agent` removed and `provider` set to the resolved value;
 *          if neither key is present the object is returned with neither key added.
 */
export function normalizeAgentAlias<T extends { provider?: string; agent?: string }>(
  raw: T,
  onWarn?: (message: string) => void,
): Omit<T, "agent"> & { provider?: string };
```

#### Reference implementation

```ts
import { appendLog } from "./..."; // existing logger sink; see §3.3 note. Or inject via onWarn.

export function normalizeAgentAlias<T extends { provider?: string; agent?: string }>(
  raw: T,
  onWarn?: (message: string) => void,
): Omit<T, "agent"> & { provider?: string } {
  const { agent, ...rest } = raw;
  const out = rest as Omit<T, "agent"> & { provider?: string };

  if (agent === undefined) {
    return out; // no alias present — pass through untouched.
  }
  if (out.provider !== undefined) {
    // Both present: canonical `provider` wins; `agent` discarded with a warning (tech-spec §4.1).
    onWarn?.(
      `Both "provider" (${out.provider}) and the "agent" alias (${agent}) were set; ` +
        `"provider" wins and "agent" is ignored. Use "provider" as the canonical key.`,
    );
    return out;
  }
  // Only the alias present: fold `agent` → `provider`.
  out.provider = agent;
  return out;
}
```

Properties:
- **Additive / non-breaking**: when no `agent` key is present, the input is returned unchanged —
  every existing backlog/config keeps validating exactly as before (PRD §6, tech-spec §4.1).
- **Canonical key preserved**: the output never contains `agent`; the persisted shape stays
  `provider` only, so re-serialization is stable and no schema field is added or renamed
  (`00-core-definitions.md §4`).
- **Total / never throws**: like the resolver, this is a pure transform (the only side effect is
  the optional warning), keeping all selection logic free of expected-error handling.

### 3.3 Where normalization is applied (the load/parse boundary)

`normalizeAgentAlias` MUST be invoked on the **raw parsed JSON, immediately before the Zod
schema parse**, at every load site that may carry the alias. The committed schemas
(`BacklogItemSchema`, `MarkerOptionsSchema`/`ToolConfigSchema`, `MarkerOptionsSchema`) have **no**
`agent` field, so applying the helper after validation would be too late (the unknown key is
stripped/ignored by Zod and the alias is lost). Boundary sites (verified loaders in
`@rauf/core`):

| Surface | Loader (source) | Where the alias is folded | Resulting canonical field |
|---|---|---|---|
| Backlog item (per-item agent, REQ-SEL-04) | `readBacklog` → `BacklogItemSchema` (`packages/core/src/backlog.ts`; field `provider` at `schemas.ts:72`) | each raw item object, before `BacklogItemSchema.parse` | `BacklogItem.provider` |
| Project marker `.rauf.json` | `readMarkerFile(projectPath)` → `MarkerFileSchema` (`packages/core/src/config.ts:27`; field `MarkerOptions.provider` at `schemas.ts:148`) | raw `options` object, before parse | `MarkerOptions.provider` |
| Global `~/.rauf/config.json` | `readToolConfig()` → `ToolConfigSchema` (`packages/core/src/config.ts:46`; field `ToolConfig.defaultProvider` at `schemas.ts:222`) | raw config object, before parse | `ToolConfig.defaultProvider` (see note) |

> **Global-config alias spelling.** The global default field is named `defaultProvider`, not
> `provider`. `normalizeAgentAlias` (which targets `provider`/`agent`) therefore does **not**
> apply verbatim to `ToolConfig`. For the global file the alias is the `defaultAgent` key folding
> onto `defaultProvider` — a one-line variant of the same rule (`defaultProvider` wins on
> conflict). The generic `normalizeAgentAlias<T>` covers the two `provider`-keyed surfaces
> (backlog item, marker options); the global surface uses the analogous `defaultAgent →
> defaultProvider` fold at `readToolConfig`. Both are additive and non-breaking.

> **`@rauf/core` boundary (CLAUDE.md).** `packages/core` must keep **zero** imports from
> `cli`/`web`, and this feature adds **no schema field** (`01-architecture-layout.md §3`). The
> normalization is a pre-parse transform applied at the load site. If the load sites live in
> `@rauf/core` loaders, the tiny pure helper(s) are added in `@rauf/core` (no cli/web import, no
> schema change). If a loader is wrapped in `packages/loop`, the helper lives alongside
> `agent-selection.ts`. Either placement satisfies the constraint; the helper imports nothing
> beyond the optional logger sink. **WARNING:** the exact backlog item-loading function name in
> `packages/core/src/backlog.ts` was not re-verified line-by-line here — confirm the parse site
> (`BacklogItemSchema.parse`) before inserting the fold; the `provider` field at `schemas.ts:72`
> and the loaders `readMarkerFile`/`readToolConfig` (`config.ts:27`/`:46`) ARE verified.

## 4. Internal implementation

`agent-selection.ts` contains exactly two pure exports — `resolveAgentId` (§3.1) and
`normalizeAgentAlias` (§3.2) — plus a re-export of the `00-core-definitions.md §6` constants
(`DEFAULT_AGENT_ID`, `GENERIC_AGENT_ID`) so the `loop-agent-selection` charter surface is
self-contained (`01-architecture-layout.md §4`):

```ts
// packages/loop/src/agent-selection.ts
export { DEFAULT_AGENT_ID, GENERIC_AGENT_ID } from "./constants.js"; // 00 §6 source
export function resolveAgentId(input: { /* §3.1 */ }): string { /* §3.1 impl */ }
export function normalizeAgentAlias<T extends { provider?: string; agent?: string }>(
  raw: T,
  onWarn?: (message: string) => void,
): Omit<T, "agent"> & { provider?: string } { /* §3.2 impl */ }
```

- The module has **no runtime imports** from the runner, the registry, or `node:child_process`
  / `node:fs`. This is what makes the whole agent-selection node trivially unit-testable
  (`07-testing-strategy.md`) and free of dispatch latency on the claude path (REQ-PERF-01).
- The `00-core-definitions.md §6` constants physically live in a small `packages/loop/src/constants.ts`;
  `agent-selection.ts` imports them from `./constants.js` and **re-exports** them, and the package
  barrel (`01-architecture-layout.md §4`) re-exports them in turn from `./agent-selection.js`. The
  chain is `constants.ts → agent-selection.ts → index.ts`. They are defined **once** in
  `constants.ts` (per the `00 §6` catalog), never duplicated, and `agent-selection.ts` never imports
  from itself.

## 5. Configuration — the layer → source map (REQ-SEL-01/02/04)

Each `resolveAgentId` input maps to exactly one committed schema field, read by exactly one
existing loader. **No new file formats, no new loaders, no schema changes** (PRD §6, tech-spec
§3.3, §4). Reads stay within `ROOT_DIRECTORY` / `~/.rauf/` (CLAUDE.md path sandboxing) because
they reuse the sandboxed core loaders verbatim.

| Resolver input | Schema field (source) | Loader (source) | Surface (REQ) | Sandbox |
|---|---|---|---|---|
| `itemProvider` | `BacklogItem.provider` — `z.string().optional()` (`schemas.ts:72`) | `readBacklog` per-item (`packages/core/src/backlog.ts`) + `normalizeAgentAlias` (§3.3) | per-item `agent` (REQ-SEL-04) | inside `ROOT_DIRECTORY` (backlog.json) |
| `runProvider` | `LoopStartOptions.provider` — `z.string().optional()` (`schemas.ts:377`) | set by `06-cli-surface.md` from `--agent` flag / detached-server `body.provider` | run-level `--agent` (REQ-SEL-01) | n/a (in-memory options) |
| `projectProvider` | `MarkerOptions.provider` — `z.string().optional()` (`schemas.ts:148`) | `readMarkerFile(projectPath)` (`config.ts:27`) → `.options.provider` + `normalizeAgentAlias` (§3.3) | project `.rauf.json` `agent` (REQ-SEL-02) | inside `ROOT_DIRECTORY` (`.rauf.json`) |
| `globalProvider` | `ToolConfig.defaultProvider` — `z.string().optional()` (`schemas.ts:222`) | `readToolConfig()` (`config.ts:46`) → `.defaultProvider` + `defaultAgent` fold (§3.3 note) | global `~/.rauf/config.json` (REQ-SEL-02) | inside `~/.rauf/` |

### 5.1 Where the runner reads project/global (verified)

The runner already reads the project marker once at loop start and already follows this exact
pattern for the parallel **model** axis — verified:

```ts
// packages/loop/src/runner.ts:229-240 (existing — read .rauf.json once at loop start)
const markerResult = readMarkerFile(this.projectPath);
let projectModel: string | undefined;
if (markerResult.ok) {
  const opts = markerResult.value.options;
  projectModel = opts.model;            // model axis (runner.ts:239)
  // agent axis (this feature): const projectProvider = opts.provider;  ← MarkerOptions.provider (schemas.ts:148)
}
```

`05-runner-wiring.md` adds the symmetric `projectProvider = markerResult.value.options.provider`
read alongside the existing `projectModel` read, and a `globalProvider =
readToolConfig().defaultProvider` read (both once per run, hoisted out of the iteration loop —
they do not vary per item). Only `itemProvider` is re-read per iteration (REQ-SEL-04), exactly
as `item.model` is per iteration today (`runner.ts:494`). This document specifies *which fields
and loaders* supply each layer; `05-runner-wiring.md` owns the call sites.

## 6. Error handling

`resolveAgentId` and `normalizeAgentAlias` are **pure and total** — they NEVER throw and perform
no I/O, so they have no expected-error surface of their own (CLAUDE.md "return `Result<T,E>`,
never throw for expected errors" is satisfied vacuously: there is nothing to fail). This is a
deliberate boundary:

- **`resolveAgentId` always returns a valid-shaped string** — a known id, or `DEFAULT_AGENT_ID`.
  It does **not** know the registry, so it cannot and does not validate that the resolved id is a
  *registered* agent.
- An **unknown / mistyped resolved id** becomes an error only when a *consumer* tries to use it:
  - `createProvider(id)` **throws** listing available ids (`registry.ts:15`,
    `00-core-definitions.md §7`); `05-runner-wiring.md` wraps this in a `Result` error enriched
    with `getAgentDescriptors()` ids (REQ-DISC-01) — an **expected error, not a crash**
    (tech-spec §7, `00-core-definitions.md §5`).
  - `detectAgent(id)` in the pre-loop fail-fast collects every candidate id (the run-level
    resolved id + each distinct per-item `provider`) and, for an absent CLI, returns the
    `AgentUnavailableError`-labelled `Result` error **before any state is written**, with no
    fallback to claude (REQ-DET-02, SC-3; `02-agent-registry-and-detection.md`,
    `05-runner-wiring.md`).

| Situation | Owner of the error | Code / shape | REQ |
|---|---|---|---|
| Resolved id is the empty case (no layer set) | none — returns `"claude-cli"` | not an error (REQ-SEL-03) | REQ-SEL-03 |
| Resolved id is unknown/mistyped | `05-runner-wiring.md` (wraps `createProvider` throw) | `Result` error listing `getAgentDescriptors()` ids | REQ-DISC-01 |
| Resolved id's CLI is absent | `05-runner-wiring.md` pre-loop `detectAgent` | `Result` error naming agent + remediation (`00 §5`) | REQ-DET-02 |
| Both `provider` and `agent` set on load | `normalizeAgentAlias` | not an error — `provider` wins, warning logged | REQ-SEL-01 |

`normalizeAgentAlias`'s conflict case is intentionally a **warning, not an error** (tech-spec
§4.1): authoring both keys is recoverable (the canonical `provider` is honored), so failing the
load would be hostile and breaking. The warning is emitted via the injected `onWarn` sink (or the
module logger) so it surfaces in loop logs without interrupting the run.

## 7. Verification

Confirm an implementation matches this spec by checking each item. `07-testing-strategy.md` owns
the colocated `agent-selection.test.ts`; these are the assertions it must cover.

### 7.1 `resolveAgentId` precedence matrix (REQ-SEL-02/03/04)

- [ ] Row 1 — all four layers set → returns `itemProvider` (`codex`) — per-item override wins
  (REQ-SEL-04).
- [ ] Row 2 — `itemProvider` unset, rest set → returns `runProvider` (`gemini`).
- [ ] Row 3 — only `projectProvider`/`globalProvider` set → returns `projectProvider` (`cursor`).
- [ ] Row 4 — only `globalProvider` set → returns `globalProvider` (`copilot`).
- [ ] **Row 5 (keystone) — all layers unset (`{}`) → returns exactly `"claude-cli"`**
  (REQ-SEL-03): proves the no-selection path is identical to today.
- [ ] Row 6 — `itemProvider` + `globalProvider` only → returns `itemProvider` (per-item beats
  global, REQ-SEL-04).
- [ ] Row 7 — `runProvider` + `globalProvider` only → returns `runProvider`.
- [ ] Row 8 — `itemProvider: "  "` (whitespace) + `runProvider: "gemini"` → returns `gemini`
  (empty/whitespace layer skipped defensively).
- [ ] Row 9 — all layers equal `cursor` → returns `cursor` (idempotent).
- [ ] `resolveAgentId` returns a non-empty string for **every** input combination (totality) and
  never throws.
- [ ] The resolved default equals `DEFAULT_AGENT_ID` imported from the `00-core-definitions.md §6`
  source (no hardcoded literal in the resolver beyond the imported constant).

### 7.2 `normalizeAgentAlias` (REQ-SEL-01)

- [ ] `{ agent: "codex" }` → `{ provider: "codex" }` (alias folded; no `agent` key remains).
- [ ] `{ provider: "codex" }` (no alias) → unchanged, no warning (additive/non-breaking).
- [ ] `{}` (neither key) → unchanged, no `provider`/`agent` keys added (additive/non-breaking).
- [ ] `{ provider: "codex", agent: "gemini" }` → `{ provider: "codex" }` AND a warning is emitted
  via `onWarn` (conflict: `provider` wins, tech-spec §4.1).
- [ ] Output never contains an `agent` key (canonical key stays `provider`).
- [ ] Re-serializing a normalized object produces a `provider`-only shape (no schema field added).

### 7.3 Integration / boundary (REQ-SEL-01/02)

- [ ] A backlog item authored with `"agent": "codex"` resolves to `provider: "codex"` after
  `readBacklog` + normalization, and `resolveAgentId({ itemProvider: "codex", ... })` returns
  `codex` (per-item agent end-to-end, REQ-SEL-04).
- [ ] A `.rauf.json` with `options.agent: "gemini"` (and no run/item override) drives the loop
  with `gemini` (project layer, REQ-SEL-02).
- [ ] A `~/.rauf/config.json` with `defaultAgent: "cursor"` (and nothing higher) drives the loop
  with `cursor` (global layer, REQ-SEL-02).
- [ ] With no `--agent`, no project/global agent, and no per-item agent, the loop drives
  `claude-cli` exactly as before (REQ-SEL-03; verified by the unchanged claude sandbox scenarios,
  SC-2 — `07-testing-strategy.md`).
- [ ] `runner.ts:494` (model precedence) is **unmodified** — agent selection did not alter the
  model axis (REQ-MODEL-01).

## Dependencies

Must be implemented after:

- **`00-core-definitions.md`** — `DEFAULT_AGENT_ID` / `GENERIC_AGENT_ID` constants (§6), the
  naming model (§4), and the reused-contract catalog (§7: schema fields, `createProvider`).
- **`01-architecture-layout.md`** — the `agent-selection.ts` location and the
  `loop-agent-selection` export surface (`§2`, `§4`).

Reuses (no change to these): `@rauf/core` config loaders `readMarkerFile` (`config.ts:27`),
`readToolConfig` (`config.ts:46`), and `readBacklog` (`packages/core/src/backlog.ts`); committed
schema fields `BacklogItem.provider` (`schemas.ts:72`), `MarkerOptions.provider` (`:148`),
`ToolConfig.defaultProvider` (`:222`), `LoopStartOptions.provider` (`:377`).

Depended on by:

- **`05-runner-wiring.md`** — calls `resolveAgentId` per iteration and applies the layer→source
  reads (§5.1); owns `createProvider`/`detectAgent` of the resolved id and the fail-fast.
- **`06-cli-surface.md`** — supplies `runProvider` via the `--agent` flag and detached-server
  `body.provider`.
- **`07-testing-strategy.md`** — `agent-selection.test.ts` exercises the §7 matrix.
