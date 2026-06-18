# 05 — Runner Wiring

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, target repo **rauf**).
> Source of truth: `PRD.md` (v2) + `tech-spec.md` (v2, esp. §3.2, §3.5, §3.6, §3.7, §6, §7).
> Depends on `00-core-definitions.md` for all shared types/constants/error contracts, and on
> `02-agent-registry-and-detection.md`, `03-cli-agent-engine-and-presets.md`,
> `04-agent-selection.md` for the primitives this document orchestrates. Cross-references use
> exact filenames. **No shared type is redefined here** — all are imported from their cited
> sources.

This document specifies the **runner integration** — the heart of the wiring. It converts
`packages/loop/src/runner.ts` from a hardcoded-`claude` driver into one that drives **every**
agent (claude included) through the resolved `LLMProvider` (`AgentAdapter`) abstraction across
**both** execution paths, with no behavioral change to the claude path (SC-2). It also extends
`packages/loop/src/signal-redactor.ts` with the pre-detection neutralization required by
REQ-SEC-02.

It owns the *orchestration* that consumes the primitives specified elsewhere: `resolveAgentId`
(`04`), `createProvider` / `detectAgent` / `getAgentDescriptors` (`02`), the `CliAgent`/preset/
`generic-cli` providers (`03`), the reused `parseSignal` / `classifyExit` / `hasUsageLimitInText`
(`00 §7`), and the `LLMProvider` contract (`00 §7`).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ADP-01 | Runner drives EVERY agent (incl. claude) through the abstraction | 3.1, 4.1 |
| REQ-ADP-06 | Both execution paths wired; neither bypasses the adapter | 3.1, 3.2, 4.1 |
| REQ-OBS-01 | Lifecycle events carry the real selected agent id | 3.3 |
| REQ-USAGE-01 | Claude usage preflight/pause/resume preserved unchanged | 4.3 |
| REQ-USAGE-02 | Non-claude usage skipped cleanly; no spurious limit | 4.3 |
| REQ-SEC-02 | Signal-token neutralization before detection, uniform across adapters | 3.5, 4.4 |
| REQ-SIG-01 | Uniform `RAUF_*` signal contract for every agent | 3.4, 4.4 |
| REQ-SIG-02 | Signal detection on plain-text output path | 3.4, 4.4 |
| REQ-EXEC-03 | Exit classified into existing `ExitClass` vocabulary, every agent | 3.6, 6 |
| REQ-PERF-01 | No measurable claude-path degradation (cache, one indirection) | 4.2 |
| REQ-DET-02 | Pre-loop fail-fast detection before any iteration / state write | 3.7, 4.5 |
| REQ-MODEL-01 | Model precedence intact, handed to `provider.execute({ model })` | 3.8 |

> Cross-cutting, **owned elsewhere** but consumed here: REQ-SEL-02/03/04 (`resolveAgentId`, `04`);
> REQ-DET-01 (`detectAgent` primitive, `02`); REQ-ADP-02/03/04 (`CliAgent`/presets/generic, `03`);
> REQ-DISC-01 (`getAgentDescriptors` ids in error messages, `02`).

## 1. Purpose & scope

### 1.1 In scope

- Replacing the two direct `spawnClaude(...)` call sites in `runner.ts` (work iteration
  `runner.ts:609`, review pass `runner.ts:969`) with `provider.execute(...)` (§3.1).
- Resolving the agent id **per iteration** via `resolveAgentId` (`04`), constructing the provider
  via `createProvider` (`02`/`00 §7`), **caching one instance per distinct agent id** within a run,
  and **disposing** every cached instance on every loop-exit path (§3.2, §4.2).
- Replacing the hardcoded `provider: "claude-cli"` event field at `runner.ts:512` (`llm_spawned`)
  and `runner.ts:633` (`llm_exited`) with `provider: provider.id` (§3.3).
- **Gating** all Anthropic usage handling on `provider.checkUsage` being defined — preflight
  (`runner.ts:252`/`:1393`), between-iterations (`:1577`), and the mid-iteration banner scans
  (`:651`, `:803`, `:1471`) — so claude is byte-for-byte unchanged and non-claude agents skip every
  usage path cleanly (§4.3).
- Extending `signal-redactor.ts` with `neutralizeForDetection(text)` and adding `RAUF_REVIEW` to its
  token set, then applying `neutralizeForDetection` uniformly **immediately before** `parseSignal`
  at **both** sites: work iteration on `signalText` (`runner.ts:670`) and review pass on raw
  `stdout` (`runner.ts:986`) (§3.5, §4.4).
- Pre-loop **fail-fast detection** orchestration (§3.7, §4.5).
- Dropping the now-unused `spawnClaude` import at `runner.ts:47` (§3.1).

### 1.2 Out of scope (delegated)

- `resolveAgentId` precedence logic and the layer→source map — `04-agent-selection.md`.
- `createProvider`/`detectAgent`/`getAgentDescriptors` semantics, the descriptor layer, and the
  default PATH probe — `02-agent-registry-and-detection.md`.
- The `CliAgent` engine, presets, `generic-cli`, and the shared `process-group.ts` — and the fact
  that `CliAgent` deliberately omits `checkUsage` — `03-cli-agent-engine-and-presets.md`.
- The `--agent` flag plumbing into `LoopStartOptions.provider`, the detached-server `body.provider`,
  and the `rauf agents` command — `06-cli-surface.md`.
- Tests (the runner-wiring unit/sandbox assertions) — `07-testing-strategy.md`.

### 1.3 The two execution paths (verified)

`runner.ts` spawns the agent at exactly two sites, both currently calling `spawnClaude` directly:

| Path | Method context | Spawn site | Signal parse site | Event sites |
|---|---|---|---|---|
| **Work iteration** | the per-item iteration | `runner.ts:609` (stream-json, `onStreamEvent`) | `parseSignal(signalText)` at `:670` (`signalText` from `:644`) | `llm_spawned` `:510-515`, `llm_exited` `:631-637` |
| **Review pass** | `startReview`-style review method | `runner.ts:969` (no `outputFormat` ⇒ text) | `parseSignal(stdout)` at `:986` (raw `stdout` from `:983`) | (no `llm_*` events emitted on this path) |

Both MUST route through `provider.execute` (REQ-ADP-06). The review path emits no `llm_spawned`/
`llm_exited` today, so REQ-OBS-01's event rewrite (§3.3) touches only the work path; the review path
gains provider routing and neutralization (§3.1, §4.4) but no new events.

## 2. Dependencies

Implement **after** (per `01-architecture-layout.md §5`): `00` → `01` → `02` → `03` → `04`, then
this document. Specifically it depends on:

- **`00-core-definitions.md`** — `LLMProvider` (`providers/types.ts:12-33`, `§7`), `ExecuteOptions`
  (`types.ts:35-45`), `ExecutionResult` (`types.ts:47-64`), `DEFAULT_AGENT_ID` / `GENERIC_AGENT_ID`
  (`§6`), `SIGNAL_TOKENS` (`§6`, the authoritative neutralization list including `RAUF_REVIEW`), the
  error contracts (`§5`, incl. the `AgentUnavailableError` *semantic label* message template).
- **`02-agent-registry-and-detection.md`** — `createProvider` (throws on unknown id,
  `registry.ts:15`), `detectAgent(id): Promise<DetectionResult>`, `getAgentDescriptors():
  AgentDescriptor[]` (for the available-ids list in error messages).
- **`03-cli-agent-engine-and-presets.md`** — the providers that `createProvider` constructs for
  non-claude ids; the load-bearing fact that `CliAgent` omits `checkUsage` (so §4.3 gating skips
  usage cleanly) and omits `dispose` (so §4.2 dispose is a no-op for them).
- **`04-agent-selection.md`** — `resolveAgentId(input): string` and the layer→source reads (its §5.1
  shows where the runner reads `projectProvider`/`globalProvider`; this document owns those call
  sites).
- **`signal-redactor.ts`** (extended here) and **`signal-parser.ts`** `parseSignal`
  (`signal-parser.ts:27`, reused unchanged).
- **`exit-classifier.ts`** — `classifyExit` (`:59`), `ExitClass` (`:22-29`), `hasUsageLimitInText`
  (`:16`) — reused unchanged (REQ-EXEC-03); `hasUsageLimitInText` gated per §4.3.

### 2.1 Reused source contracts (verified against actual files)

| Symbol | Source (verbatim) | Use here |
|---|---|---|
| `LLMProvider` (`id`, `displayName`, `execute`, `checkUsage?`, `validateCredentials`, `dispose?`) | `providers/types.ts:12-33` | the abstraction the runner drives |
| `ExecuteOptions` | `providers/types.ts:35-45` (`{ model?; timeoutMinutes; signal?; onProgress?; outputFormat?; onStreamEvent? }`) | the options object passed to `execute` |
| `ExecutionResult` | `providers/types.ts:47-64` (`{ stdout; stderr; exitCode; timedOut; durationMs; reconstructedText?; … }`) | `execute` return |
| `spawnClaude` | `claude-process.ts` (imported at `runner.ts:47`) | **removed** from runner imports (§3.1); still re-exported at `index.ts:12` (retained) |
| `parseSignal(stdout): ParsedSignal` | `signal-parser.ts:27` | uniform signal contract (REQ-SIG-01) |
| `redactSignalTokens(text): string` | `signal-redactor.ts:4` | log-preview redaction, kept (used at `runner.ts:680`) |
| `SIGNAL_TOKENS` (token set) | `signal-redactor.ts:1` — **lacks `RAUF_REVIEW`** | extended to the `00 §6` list; reused by both redactor functions |
| `classifyExit(result, signal): ExitClass` | `exit-classifier.ts:59` | exit classification (REQ-EXEC-03) |
| `hasUsageLimitInText(text): boolean` | `exit-classifier.ts:16` (patterns `:4-10`); **also called inside `classifyExit` at `exit-classifier.ts:68`** | gated claude-only (§4.3) |
| model precedence | `runner.ts:494` `item.model ?? this.options.model ?? projectModel` | untouched (REQ-MODEL-01, §3.8) |

## 3. The wiring change list (per call site)

Each change cites the exact `runner.ts` line and gives before → after. All citations verified against
source on the feature branch.

### 3.1 Replace both `spawnClaude` call sites with `provider.execute(...)` (REQ-ADP-01, REQ-ADP-06)

**Work iteration — `runner.ts:609`.** The current direct call:

```ts
// runner.ts:609 (BEFORE)
const claudeResult = await spawnClaude(promptResult.value, {
  sessionTimeoutMinutes: this.options.sessionTimeoutMinutes,
  model: resolvedModel,
  signal: this.abortController.signal,
  outputFormat: "stream-json",
  onStreamEvent,
  ...(this.childEnv ? { env: this.childEnv } : {}),
});
```

becomes a call through the resolved provider (`provider` obtained per §4.1):

```ts
// runner.ts:609 (AFTER) — provider resolved per §4.1; result type is Result<ExecutionResult>
const execResult = await provider.execute(promptResult.value, {
  outputFormat: "stream-json",
  onStreamEvent,
  signal: this.abortController.signal,
  model: resolvedModel,                          // resolvedModel from runner.ts:494 (REQ-MODEL-01)
  timeoutMinutes: this.options.sessionTimeoutMinutes,
  ...(this.childEnv ? { env: this.childEnv } : {}),   // childEnv now travels via ExecuteOptions.env
});
```

- `SpawnClaudeOptions.sessionTimeoutMinutes` maps to `ExecuteOptions.timeoutMinutes`
  (`providers/types.ts:35-45`); the claude adapter translates it back internally — its behavior is
  preserved (SC-2).
- **Child-env (SC-2 — resolved, not deferred):** the runner's `this.childEnv` (review-hook
  suppression + child-session overrides from `resolveChildEnv`, `runner.ts:148`) MUST keep reaching
  the agent. Because `ExecuteOptions` has no `env` field today, this feature **adds
  `ExecuteOptions.env?`** (`00-core-definitions.md §3.4`) and the runner passes `this.childEnv`
  through it at **both** call sites (here and the review pass). `ClaudeCliProvider.execute`
  (`claude-cli.ts:14-20`) is updated to forward `options.env` into `spawnClaude`'s
  `SpawnClaudeOptions.env` (`claude-process.ts:17-22`) — restoring today's behavior exactly (without
  this, routing through `execute` would silently drop childEnv and regress review-hook suppression).
  `CliAgent.execute` merges `options.env` over `CliAgentConfig.env` (`03 §4.5`), so non-claude agents
  receive the same child env uniformly.
- The downstream destructure of the result (`runner.ts:629-630`
  `{ exitCode, stdout, stderr, timedOut, durationMs, reconstructedText }`) is unchanged — both
  `SpawnClaudeResult` and `ExecutionResult` expose those fields (`ExecutionResult` at
  `providers/types.ts:47-64`). The `!claudeResult.ok` spawn-failure guard at `runner.ts:621-627`
  stays identical (rename the local to `execResult` for clarity; the `Result` shape is the same).

**Review pass — `runner.ts:969`.** The current direct call:

```ts
// runner.ts:969 (BEFORE) — note: NO outputFormat (defaults to text today)
const claudeResult = await spawnClaude(promptResult.value, {
  sessionTimeoutMinutes: this.options.sessionTimeoutMinutes,
  model: resolvedModel,
  signal: this.abortController.signal,
  ...(this.childEnv ? { env: this.childEnv } : {}),
});
```

becomes:

```ts
// runner.ts:969 (AFTER)
const execResult = await provider.execute(promptResult.value, {
  signal: this.abortController.signal,
  model: resolvedModel,                          // review model resolve at runner.ts:964 (unchanged)
  timeoutMinutes: this.options.sessionTimeoutMinutes,
  ...(this.childEnv ? { env: this.childEnv } : {}),   // childEnv via ExecuteOptions.env (SC-2)
  // outputFormat intentionally OMITTED — preserves today's text review behavior (tech-spec §3.2)
});
```

- **Why pass the options object instead of a bare prompt:** the review path historically omits
  `outputFormat`. Passing the same options object (minus `outputFormat`) lets stream-capable adapters
  behave consistently while `claude-cli` defaults to text when `outputFormat` is unset — preserving
  today's review behavior byte-for-byte (tech-spec §3.2, SC-2). The result destructure
  (`runner.ts:983` `const { stdout } = claudeResult.value;`) is unchanged.

**Import removal — `runner.ts:47`.** `import { spawnClaude } from "./claude-process.js";` is
**removed**. After this change the only *runtime caller* of `spawnClaude` is
`providers/claude-cli.ts` (`claude-cli.ts:14`).

> **Test guard (REQ-ADP-06).** A test asserts the runner no longer calls `spawnClaude` directly by
> grepping **`packages/loop/src/runner.ts` ONLY** for a `spawnClaude(` call-site pattern (expect zero
> matches). It MUST NOT grep the whole package: the public re-export at
> `packages/loop/src/index.ts:12` (`export { spawnClaude } from "./claude-process.js";`) is
> **retained** as external surface (tech-spec §3.2, `01-architecture-layout.md §4`) and the adapter
> at `claude-cli.ts:14` legitimately calls it. Grepping only `runner.ts` avoids false-positives on
> both. See `07-testing-strategy.md`.

### 3.2 Per-iteration provider resolution + cache + dispose (REQ-SEL-04, REQ-PERF-01)

Because a backlog item may select its own agent (REQ-SEL-04), the resolved agent id can vary per
iteration. The runner resolves and constructs the provider **per iteration**, caching one instance
per distinct agent id within a run (REQ-PERF-01). Construction wraps `createProvider` in try/catch and
returns a `Result` error (no throw — CLAUDE.md). Every cached instance is `dispose`d in a `finally`
that runs on **all** loop-exit paths. Full algorithm in §4.1–§4.2.

### 3.3 Event provider id (REQ-OBS-01)

Replace the two hardcoded `provider: "claude-cli"` literals with `provider: provider.id`:

```ts
// runner.ts:510-515 (llm_spawned) — BEFORE: provider: "claude-cli"  →  AFTER: provider: provider.id
this.emitEvent("llm_spawned", {
  itemId: item.id,
  provider: provider.id,                         // REQ-OBS-01 — real selected agent id
  model: resolvedModel,
  timeoutMinutes: this.options.sessionTimeoutMinutes,
});

// runner.ts:631-637 (llm_exited) — BEFORE: provider: "claude-cli"  →  AFTER: provider: provider.id
this.emitEvent("llm_exited", {
  itemId: item.id,
  provider: provider.id,                         // REQ-OBS-01
  exitCode,
  timedOut,
  durationMs,
});
```

- **No event-shape change.** The `llm_spawned`/`llm_exited` schema already carries `provider: string`
  (`core/schemas.ts:448-463`, `00 §7`); the CLI already renders `event.provider`
  (`loop-commands.ts:1184`, tech-spec §3.2). Only the *value* changes from a hardcoded string to the
  real `provider.id` (e.g. `"codex"`). For a claude run `provider.id === "claude-cli"`, so claude
  events are unchanged (SC-2). This satisfies SC-4 ("a codex run emits codex, not `claude-cli`").
- The free-text log lines (`runner.ts:516-519` "Spawning claude for item …", `:638-641` "Claude
  exited …") MAY mention the real agent id for clarity but are not contract; rewording them to use
  `provider.displayName`/`provider.id` is optional and does not affect any assertion.

### 3.4 Signal text & the plain-text path (REQ-SIG-01/02)

`parseSignal` (`signal-parser.ts:27`) is reused unchanged as the uniform completion contract for
every agent (REQ-SIG-01). The work path's existing signal-text fallback is **already** the
plain-text path:

```ts
// runner.ts:644 (UNCHANGED) — reconstructed-or-stdout fallback
const signalText =
  reconstructedText && reconstructedText.length > 0 ? reconstructedText : stdout;
```

For non-claude adapters, `CliAgent.execute` leaves `reconstructedText` **unset** (`03 §4.4`), so this
fallback naturally selects raw `stdout` — the plain-text signal path (REQ-SIG-02). **No new code
path** is added for plain text; the fallback at `:644` already exists. The review path parses raw
`stdout` directly at `runner.ts:986`, which is inherently plain-text already.

### 3.5 Signal neutralization — extend `signal-redactor.ts` (REQ-SEC-02, SC-6)

Today `redactSignalTokens` (`signal-redactor.ts:4`) is applied **only to debug log previews**
(`runner.ts:680`) — never before detection — and its token set (`signal-redactor.ts:1`) **omits
`RAUF_REVIEW`**. To honor REQ-SEC-02 literally and pass SC-6, this document:

1. Extends the shared token set to the `00 §6` authoritative `SIGNAL_TOKENS` list (adds
   `RAUF_REVIEW`).
2. Adds a **new** `neutralizeForDetection(text)` that rewrites signal tokens **only where they are
   NOT a standalone trimmed line** (quoted/inline occurrences), leaving a genuine final-line signal
   intact.
3. Keeps `redactSignalTokens` exactly as-is for log previews (unconditional, log-only).
4. Applies `neutralizeForDetection` uniformly, immediately before `parseSignal`, at **both** sites
   (§4.4): work iteration on `signalText` (`runner.ts:670`), review pass on raw `stdout`
   (`runner.ts:986`).

Full algorithm and the `redactSignalTokens`-vs-`neutralizeForDetection` contrast are in §4.4.

### 3.6 Exit classification (REQ-EXEC-03)

`classifyExit` / `ExitClass` (`exit-classifier.ts:22-29`, `:59`) are reused **unchanged** for every
agent — the runner keeps classifying every agent's exit exactly as it classifies claude today
(REQ-EXEC-03). The PRD outcome vocabulary maps onto `ExitClass` per the tech-spec §6 table (§6 here).
The one subtlety — `classifyExit` internally calls `hasUsageLimitInText` (`exit-classifier.ts:68`),
which can mint `usage_limited` for any agent that prints a banner phrase — is handled by the
usage-gating in §4.3.

### 3.7 Pre-loop fail-fast detection (REQ-DET-02, SC-3)

Before any iteration runs or any state is written, the runner collects the **set of all agent ids
that could run this loop** (the run-level resolved id + every distinct per-item `provider` in the
pending backlog), calls `detectAgent` (`02`) on each, and if any is unavailable returns an
`AgentUnavailableError`-shaped `Result` error (the `00 §5` message template) — **before** writing
state, with **no** fallback to claude. It runs **first**, before the existing usage preflight at
`runner.ts:252`. Full orchestration in §4.5.

### 3.8 Model handoff (REQ-MODEL-01)

`runner.ts:494` (`const resolvedModel = item.model ?? this.options.model ?? projectModel;`) is
**untouched**. The resolved string is handed to `provider.execute({ model: resolvedModel })` (§3.1).
Each adapter translates it (claude → `--model`; presets via `modelFlag`, `03 §4.1`) or omits it when
unset (REQ-MODEL-02). Model selection remains fully independent of agent selection (`04 §2`).

## 4. Internal implementation

### 4.1 Per-iteration resolve + the cache (REQ-ADP-01, REQ-SEL-04, REQ-PERF-01)

A per-run cache (`Map<string, LLMProvider>`) lives on the `LoopRunner` instance, holding one provider
per distinct resolved agent id. A private helper resolves the id (via `resolveAgentId`, `04`) and
returns the cached-or-constructed provider as a `Result` (wrapping the `createProvider` throw —
CLAUDE.md "no throw for expected errors", `00 §5`):

```ts
// runner.ts — new private members
import type { LLMProvider } from "./providers/types.js";
import { createProvider, getAgentDescriptors } from "./providers/registry.js"; // 02 (or barrel)
import { resolveAgentId } from "./agent-selection.js";                          // 04
import { err, ok, ErrorCodes } from "@rauf/core";
import type { Result, RaufError } from "@rauf/core";
import type { BacklogItem } from "@rauf/core";
// `LoopResult` is declared in this same runner.ts (`runner.ts:62`) — in scope, no import.

/** One provider instance per distinct resolved agent id, for the lifetime of one run (REQ-PERF-01). */
private readonly providerCache = new Map<string, LLMProvider>();

/** Project-level agent id, read once at loop start alongside projectModel (04 §5.1). */
private projectProvider?: string;
/** Global default agent id, read once at loop start (04 §5.1). */
private globalProvider?: string;

/**
 * Resolve and construct the provider for one iteration. Per-item agent wins (REQ-SEL-04), then
 * run-level, then project, then global, then DEFAULT_AGENT_ID (resolveAgentId, 04). Caches one
 * instance per distinct agent id (REQ-PERF-01). Wraps createProvider's throw-on-unknown-id
 * (registry.ts:15) into a Result error listing getAgentDescriptors() ids (REQ-DISC-01, 00 §5) —
 * never throws for an expected (mistyped/unknown) id.
 */
private resolveProviderForItem(item: BacklogItem): Result<LLMProvider> {
  const agentId = resolveAgentId({
    itemProvider: item.provider,            // BacklogItem.provider (schemas.ts:72)
    runProvider: this.options.provider,     // LoopStartOptions.provider (schemas.ts:377)
    projectProvider: this.projectProvider,  // MarkerOptions.provider (schemas.ts:148), read once
    globalProvider: this.globalProvider,    // ToolConfig.defaultProvider (schemas.ts:222), read once
  });

  const cached = this.providerCache.get(agentId);
  if (cached) return ok(cached);

  try {
    const provider = createProvider(agentId); // may throw on unknown id (registry.ts:15)
    this.providerCache.set(agentId, provider);
    return ok(provider);
  } catch (e) {
    const ids = getAgentDescriptors().map((d) => d.id).join(", ");
    return err({
      code: ErrorCodes.VALIDATION_ERROR, // VALIDATION_ERROR for unknown/mistyped id (resolved, errors.ts:21-32)
      message:
        `Unknown agent "${agentId}": ${e instanceof Error ? e.message : String(e)}. ` +
        `Supported agents: ${ids || "(none)"}.`,
    });
  }
}
```

- **Where it is called (work path):** immediately before the `llm_spawned` emit at `runner.ts:510`,
  the iteration calls `resolveProviderForItem(item)`. On a `Result` error it logs, resets the item to
  pending (mirroring the existing `buildPrompt`-failure handling at `runner.ts:501-507`), emits
  `loop_error` with the message, and returns the same control value that path uses for a non-fatal
  per-item failure. The §3.7 pre-loop detection normally catches unknown/absent ids before iteration
  1; this per-iteration guard is the backstop (`00 §5`, tech-spec §7).
- **Where it is called (review path):** the review pass resolves the **run-level** provider (no
  per-item context — review is loop-level). It calls `resolveProviderForItem`-equivalent with no
  `itemProvider`, i.e. `resolveAgentId({ runProvider: this.options.provider, projectProvider,
  globalProvider })`, reusing the same cache. On a `Result` error it emits `review_failed` (mirroring
  the existing review-prompt-failure handling at `runner.ts:955-958`) and returns `"failed"`.
- **`this.options.provider`** is `LoopStartOptions.provider` (`schemas.ts:377`), set from `--agent`
  by `06-cli-surface.md`. **`this.projectProvider`/`this.globalProvider`** are read once at loop start
  (§4.2).
- For a claude run every layer is unset ⇒ `agentId === "claude-cli"` ⇒ the cache constructs the
  committed `claude-cli` adapter once and reuses it for every iteration (SC-2, REQ-PERF-01).

### 4.1.1 Run-level resolve + setup failure (`resolveRunLevelProvider` / `failRunSetup`)

The review pass (§4.1 above) and the pre-loop usage gating (§4.3) need a **run-level** provider —
the same resolution as `resolveProviderForItem` but with **no per-item context** (review and
preflight are loop-level, not item-level). It is the item-less sibling, sharing the same cache and
the same throw→`Result` wrapping:

```ts
/**
 * Resolve the run-level provider (no BacklogItem). Item-less sibling of resolveProviderForItem:
 * same precedence (minus itemProvider), same per-id cache, same createProvider-throw → Result
 * wrapping. Used by the review pass (§4.1) and pre-loop usage gating (§4.3). Never throws for an
 * expected (mistyped/unknown) id.
 */
private resolveRunLevelProvider(): Result<LLMProvider> {
  const agentId = resolveAgentId({
    runProvider: this.options.provider,     // LoopStartOptions.provider (schemas.ts:377)
    projectProvider: this.projectProvider,  // MarkerOptions.provider (schemas.ts:148)
    globalProvider: this.globalProvider,    // ToolConfig.defaultProvider (schemas.ts:222)
  });
  const cached = this.providerCache.get(agentId);
  if (cached) return ok(cached);
  try {
    const provider = createProvider(agentId); // may throw on unknown id (registry.ts:15)
    this.providerCache.set(agentId, provider);
    return ok(provider);
  } catch (e) {
    const ids = getAgentDescriptors().map((d) => d.id).join(", ");
    return err({
      code: ErrorCodes.VALIDATION_ERROR, // VALIDATION_ERROR for unknown/mistyped id (resolved, errors.ts:21-32)
      message:
        `Unknown agent "${agentId}": ${e instanceof Error ? e.message : String(e)}. ` +
        `Supported agents: ${ids || "(none)"}.`,
    });
  }
}
```

> The work-path `resolveProviderForItem(item)` and `resolveRunLevelProvider()` share one body
> modulo `itemProvider`; an implementer MAY collapse them into a single
> `resolveProvider(item?: BacklogItem)` — the two-name form here is for spec clarity.

**`failRunSetup(error)` — the pre-iteration abort path.** Both the pre-loop fail-fast detection
(§4.5) and a run-level resolve failure must terminate the run **before any state is written or any
iteration runs** (REQ-DET-02). `failRunSetup` is that single early-return path:

```ts
/**
 * Abort the run during setup, before iteration 1 and before any state write (REQ-DET-02, SC-3).
 * Emits loop_error with the message, and returns the zero-iteration LoopResult. Writes NO state
 * (no writeState, no backlog mutation), so a failed setup leaves the project untouched.
 */
private failRunSetup(error: RaufError): LoopResult {
  this.emitEvent("loop_error", { error: error.message }); // error surfaced via the event
  // Real LoopResult shape (runner.ts:62-79): zero-iteration terminal, no state written.
  return { completedCount: 0, blockedCount: 0, cancelled: false };
}
```

- Called from §4.3 (`this.failRunSetup(runProviderResult.error)`) and §4.5 (after a failed
  `detectAllCandidateAgents`). It runs **before** the existing `writeState("starting", …)` at
  `runner.ts:249`, so SC-3's "no state written" holds. The `{ completedCount: 0, blockedCount: 0,
  cancelled: false }` return is the committed `LoopResult` zero-iteration shape (`runner.ts:62-79`) —
  identical to the §4.5 pre-state-write early return; the error text is surfaced via the `loop_error`
  event (the contract is "zero iterations, no state write").

### 4.2 Reads at loop start; dispose in `finally` (REQ-PERF-01, lifecycle)

**Project/global reads (once per run).** Alongside the existing project-marker read at
`runner.ts:229-240` (which sets `projectModel = opts.model`), add the symmetric agent read; and read
the global default once:

```ts
// runner.ts:235-240 region (ADD the agent-axis read alongside projectModel)
if (markerResult.ok) {
  const opts = markerResult.value.options;
  autoSweep = opts.autoSweep ?? false;
  sweepMinAgeDays = opts.sweepMinAgeDays ?? 0;
  projectModel = opts.model;
  this.projectProvider = opts.provider;          // MarkerOptions.provider (schemas.ts:148) — NEW
}
// Read global default agent once (ToolConfig.defaultProvider, schemas.ts:222). Reuses the existing
// @rauf/core readToolConfig loader (config.ts:46); stays within ~/.rauf/ (CLAUDE.md sandboxing).
const toolConfig = readToolConfig();
this.globalProvider = toolConfig.ok ? toolConfig.value.defaultProvider : undefined;
```

Both reads are **hoisted out of the iteration loop** — they do not vary per item; only `itemProvider`
is re-read per iteration (REQ-SEL-04), exactly as `item.model` is today (`04 §5.1`).

**Dispose every cached provider on every loop-exit path.** The `run()` method already has a
`try { … } finally { … }` whose `finally` (`runner.ts:379-399`) resets the in-progress item and
releases the lock on every exit path (normal completion, thrown error, cancel). Dispose hooks into the
**same** `finally` so no instance leaks regardless of how the run ends — normal completion, the §4.5
fail-fast detection error, abort/cancel, or a thrown error:

```ts
// runner.ts:379 finally block — ADD provider disposal (runs on ALL exit paths)
} finally {
  // ... existing: reset currentItemId to pending, releaseLock(this.paths),
  //     deregisterLoop(this.paths.stateDir) (runner.ts:380-398) — UNCHANGED ...

  // Dispose every cached provider (REQ-PERF-01 lifecycle). dispose? is optional
  // (LLMProvider, providers/types.ts:33): claude-cli MAY implement it; CliAgent does NOT
  // (03 §3.1). Best-effort and awaited; a rejecting dispose must not mask the original outcome.
  for (const provider of this.providerCache.values()) {
    try {
      await provider.dispose?.();
    } catch {
      // best-effort: a failing dispose never changes the run's result or rethrows
    }
  }
  this.providerCache.clear();
}
```

- The §4.5 pre-loop fail-fast path returns its `Result` error **inside** the `try` (before any
  iteration), so this `finally` still runs and disposes the (empty-or-claude) cache — covering the
  "fail-fast detection error" exit path the brief calls out. Because fail-fast runs before any
  provider is constructed, the cache is typically empty there; the loop is still safe (iterates zero
  entries).
- **Performance (REQ-PERF-01):** the claude path gains exactly one indirection
  (`provider.execute(...)` instead of `spawnClaude(...)`) plus a single `Map.get` per iteration and
  one construction per run. No added per-iteration latency beyond negligible dispatch
  (`01-architecture-layout.md §6`). The claude adapter still calls `spawnClaude` internally
  (`claude-cli.ts:14`).

### 4.3 Usage gating (REQ-USAGE-01, REQ-USAGE-02)

**Rule:** all Anthropic usage handling becomes **gated on `provider.checkUsage` being defined.** The
claude adapter defines `checkUsage` (`claude-cli.ts:41-47`); `CliAgent` deliberately does **not**
(`03 §3.1`). Gating on the *capability* (not a hardcoded `id === "claude-cli"`) keeps the usage path
claude-only while allowing a future adapter to opt in (REQ-USAGE-02 "An adapter MAY optionally provide
its own usage check"). The gated touchpoints (all verified in source):

| Touchpoint | Site | Gating |
|---|---|---|
| Pre-loop usage preflight | call `runner.ts:252` → `runUsagePreflight` `:1393` | Run only when the **run-level** provider exposes `checkUsage` (§Note). |
| Mid-iteration pre-signal banner scan | `runner.ts:651` (`if exitCode !== 0 && (hasUsageLimitInText(stderr) || hasUsageLimitInText(signalText))`) | Wrap inside `if (provider.checkUsage) { … }` (REQ-USAGE-02, SC-1). |
| Mid-iteration post-signal classification | `runner.ts:803-814` (`classifyExit(...) === "usage_limited"` → `handleStderrUsageLimit` `:1471`) | Gate the `usage_limited` arm on `provider.checkUsage` (see "classifyExit subtlety"). |
| Between-iterations usage check | call `runner.ts:305`/`:331` → `checkBetweenIterations` `:1577` | Run only when the run-level provider exposes `checkUsage`. |

**Pre-loop / between-iterations gating (claude-only).** `runUsagePreflight` (`:1393`) and
`checkBetweenIterations` (`:1577`) both begin by reading the Claude OAuth token
(`readClaudeOAuthToken`, `:1394`/`:1587`). Gate their *invocation* on the run-level provider's
`checkUsage`:

```ts
// runner.ts:252 (BEFORE) const preflightResult = await this.runUsagePreflight();
// AFTER — resolve the run-level provider first (no item context), gate the preflight on checkUsage:
const runProviderResult = this.resolveRunLevelProvider(); // resolveAgentId with no itemProvider
if (!runProviderResult.ok) return this.failRunSetup(runProviderResult.error); // before state write
const runProvider = runProviderResult.value;

if (runProvider.checkUsage) {
  const preflightResult = await this.runUsagePreflight();
  if (preflightResult === "exit") {
    return { completedCount: 0, blockedCount: 0, cancelled: false,
             ...(this.limitTerminal ? { limitReached: true } : {}) };
  }
}
// when checkUsage is undefined (non-claude run-level agent): preflight skipped cleanly, no OAuth
// read, no crash, no spurious limit (REQ-USAGE-02). For claude-cli the block runs exactly as today
// (REQ-USAGE-01) — byte-for-byte behavior preserved (SC-2).
```

`checkBetweenIterations` (called at `runner.ts:305` and `:331`) is gated identically: call it only
when `runProvider.checkUsage` is defined; otherwise treat as `"continue"`. (Its own cancellation
check at `:1579-1585` is orthogonal to usage and is NOT gated — cancellation must work for every
agent; only the OAuth/usage portion is claude-gated.)

> **Note — which provider gates the loop-level usage paths.** Preflight and between-iterations are
> loop-level (no per-item context), so they gate on the **run-level** provider (the one
> `resolveAgentId` returns with no `itemProvider`). A backlog that *mixes* a claude run-level default
> with a non-claude per-item override still runs the claude preflight once at loop start (correct —
> the loop's default agent is claude); the per-item non-claude iteration simply has no `checkUsage`
> and skips the mid-iteration scan (next paragraph). This matches today's single-preflight model and
> SC-2.

**Mid-iteration pre-signal scan gating (REQ-USAGE-02, SC-1 — critical).** The scan at `runner.ts:651`
calls `hasUsageLimitInText` on stderr and `signalText`. `hasUsageLimitInText`
(`exit-classifier.ts:16`, patterns `:4-10`) substring-matches phrases like "rate limit" / "usage
limit" in **arbitrary** output. A non-claude plain-text agent that merely prints such a phrase in
normal output would be misclassified `usage_limited`. Therefore this entire block MUST sit **inside**
the `checkUsage` gate using the **iteration's** provider:

```ts
// runner.ts:651 (AFTER) — gate the whole pre-signal usage-banner block on the iteration provider's
// checkUsage so a non-claude agent that prints "rate limit" in normal output is NOT misclassified.
if (provider.checkUsage && exitCode !== 0 &&
    (hasUsageLimitInText(stderr) || hasUsageLimitInText(signalText))) {
  appendLog(this.paths, "Usage limit detected in claude output");
  updateItem(this.paths, item.id, { status: "pending" });
  this.currentItemId = null;
  this.uncountIteration("usage_limited");
  const stderrLimitResult = await this.handleStderrUsageLimit(`${stderr}\n${signalText}`);
  if (stderrLimitResult === "exit") return "exit";
  return "continue";
}
```

For non-claude adapters (`provider.checkUsage` undefined) the scan is **skipped entirely** and exit
classification proceeds via the normal signal/exit-code path (REQ-USAGE-02 "no spurious limit
detection"; SC-1 "no error raised"). For claude-cli the condition's later operands are evaluated
exactly as today (SC-2).

**The `classifyExit` subtlety (post-signal path, `runner.ts:803-814`).** `classifyExit`
(`exit-classifier.ts:59`) **internally** calls `hasUsageLimitInText` (`exit-classifier.ts:68`) and can
return `"usage_limited"` for **any** agent's output. The switch arm at `runner.ts:805` then calls
`handleStderrUsageLimit` (`:1471`, which reads the Claude OAuth token). To avoid a non-claude agent
being routed into the claude usage-pause path, the `usage_limited` arm MUST be guarded on the
iteration provider's `checkUsage`:

```ts
// runner.ts:804-815 (AFTER) — guard the usage_limited arm on the iteration provider's checkUsage.
const exitClass = classifyExit(execResult.value, parsed);
switch (exitClass) {
  case "usage_limited": {
    if (provider.checkUsage) {
      // claude path — unchanged (SC-2): route to the OAuth-aware pause/resume handler.
      appendLog(this.paths, "Usage limit detected (post-signal classification)");
      updateItem(this.paths, item.id, { status: "pending" });
      this.currentItemId = null;
      this.uncountIteration("usage_limited");
      const usageResult = await this.handleStderrUsageLimit(`${stderr}\n${signalText}`);
      return usageResult === "exit" ? "exit" : "continue";
    }
    // non-claude: a "usage_limited" classification here can only be a false substring match on
    // plain-text output (the agent has no usage semantics). Fall through to the genuine_retry
    // handling so the iteration is classified by signal/exit-code like any other non-claude exit
    // (REQ-USAGE-02, REQ-EXEC-03). Do NOT call handleStderrUsageLimit (would read claude OAuth).
    // (Implementation: handle by re-dispatching to the genuine_retry arm's logic.)
  }
  // ... existing timeout / infra_error / genuine_retry arms unchanged ...
}
```

> Equivalent, cleaner alternative the implementer MAY choose: compute the effective class as
> `const exitClass = provider.checkUsage ? classifyExit(...) : downgradeUsageLimited(classifyExit(...))`,
> where `downgradeUsageLimited` maps `"usage_limited"` → `"genuine_retry"` for non-claude agents and
> is identity otherwise. This keeps the switch untouched and confines the gate to one expression.
> Either form satisfies REQ-USAGE-02/SC-1; `classifyExit`/`ExitClass` themselves stay **unchanged**
> (REQ-EXEC-03) — the gating is in the runner, not the classifier.

### 4.4 Neutralization algorithm & application (REQ-SEC-02, SC-6)

**Extend `signal-redactor.ts`.** Align the token set with `00 §6` and add the line-aware
neutralizer, keeping `redactSignalTokens` unchanged:

```ts
// packages/loop/src/signal-redactor.ts (EDIT)

/**
 * Signal tokens neutralized inside agent output (REQ-SEC-02). EXTENDS the prior set
 * (signal-redactor.ts:1) which omitted RAUF_REVIEW; now matches 00-core-definitions.md §6
 * SIGNAL_TOKENS so a quoted RAUF_REVIEW is also defused (SC-6).
 */
const SIGNAL_TOKENS = ["RAUF_DONE", "RAUF_BLOCKED", "RAUF_NEEDS_HUMAN", "RAUF_REVIEW"] as const;

/**
 * Replace literal RAUF_* tokens with a visually similar, non-matchable form (`_` → `·`).
 * UNCONDITIONAL and LOG-ONLY — used for debug log previews (runner.ts:680), never before
 * detection. Behavior unchanged except the widened token set. (REQ-SEC-02 / observability.)
 */
export function redactSignalTokens(text: string): string {
  let result = text;
  for (const token of SIGNAL_TOKENS) {
    result = result.replaceAll(token, token.replace("_", "·"));
  }
  return result;
}

/**
 * Neutralize RAUF_* tokens that appear inside an agent's output so a quoted/inline token cannot be
 * mis-parsed as a real completion signal (REQ-SEC-02, SC-6), while leaving a GENUINE final-line
 * signal intact. Line-aware: a token is neutralized ONLY when it is NOT the (trimmed) standalone
 * content of its line — i.e. when something else shares the line (quotes, prose, indentation +
 * trailing words). A line whose trimmed content begins with a bare token (e.g. `RAUF_DONE` or
 * `RAUF_BLOCKED:<reason>`) is left UNTOUCHED, because parseSignal (signal-parser.ts:27) matches
 * whole-line signals and that is exactly the legitimate completion case.
 *
 * Applied to EVERY adapter's output immediately before parseSignal, at BOTH execution paths
 * (runner.ts:670 work, runner.ts:986 review) — tech-spec §3.7. Contrast with redactSignalTokens:
 * that is unconditional and log-only; this is line-aware and pre-detection.
 *
 * @param text the agent output about to be signal-parsed.
 * @returns text with only NON-signal-line token occurrences neutralized.
 */
export function neutralizeForDetection(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;                       // noUncheckedIndexedAccess: index is in range
    const trimmed = line.trim();
    // Is this line a STANDALONE signal line? (trimmed content is exactly a token, or a token
    // immediately followed by ":" for the reason-bearing forms RAUF_BLOCKED:/RAUF_NEEDS_HUMAN:/
    // RAUF_REVIEW:). If so, leave the line untouched — it is the legitimate completion signal.
    const isSignalLine = SIGNAL_TOKENS.some(
      (tok) => trimmed === tok || trimmed.startsWith(`${tok}:`),
    );
    if (isSignalLine) continue;
    // Otherwise neutralize every token occurrence on this (non-signal) line.
    let rewritten = line;
    for (const tok of SIGNAL_TOKENS) {
      rewritten = rewritten.replaceAll(tok, tok.replace("_", "·"));
    }
    lines[i] = rewritten;
  }
  return lines.join("\n");
}
```

- **Algorithm rationale.** `parseSignal` scans lines backward and matches a token only as the
  whole-line content (`signal-parser.ts:27`, `00 §7`). A quoted/inline occurrence (e.g.
  `print("RAUF_DONE")` or `the RAUF_DONE token`) shares its line with other text, so it is **not** a
  standalone signal line ⇒ it is neutralized. A genuine final-line signal (`RAUF_DONE` alone, or
  `RAUF_BLOCKED:reason`) is the trimmed standalone content ⇒ left intact. This defuses false signals
  (SC-6) without breaking real ones — including `RAUF_REVIEW:<json>` on the review path, now that
  `RAUF_REVIEW` is in the token set.
- The reason-bearing forms (`RAUF_BLOCKED:<reason>`, `RAUF_NEEDS_HUMAN:<reason>`,
  `RAUF_REVIEW:<json>`) are recognized by `trimmed.startsWith(`${tok}:`)`, matching how `parseSignal`
  accepts a token followed by a colon and payload as a whole-line signal. A token appearing
  mid-prose (not at line start) is neutralized.

**Apply at both detection sites.** Insert `neutralizeForDetection` immediately before `parseSignal`:

```ts
// runner.ts:670 (work iteration) — AFTER the §4.3 usage gate, BEFORE parseSignal
const parsed = parseSignal(neutralizeForDetection(signalText)); // signalText from runner.ts:644

// runner.ts:986 (review pass) — review parses raw stdout (no reconstructedText fallback)
const parsed = parseSignal(neutralizeForDetection(stdout));     // stdout from runner.ts:983
```

- Both sites are required to satisfy REQ-SEC-02 ("uniformly across all adapters") and REQ-ADP-06
  ("both runner execution paths"). The work path applies it to `signalText` (reconstructed-or-stdout
  from `:644`); the review path applies it to raw `stdout`.
- The existing log-preview use of `redactSignalTokens` at `runner.ts:680` is **kept unchanged** — it
  defuses tokens in the *logged preview* (so logs never print a live-looking token) and is
  independent of detection. Both functions now share the widened token set.
- Add `neutralizeForDetection` to the runner's import from `./signal-redactor.js` (`runner.ts:57`
  currently imports only `redactSignalTokens`).

### 4.5 Pre-loop fail-fast detection orchestration (REQ-DET-02, SC-3)

Runs **first**, before the usage preflight (`runner.ts:252`) and before `this.writeState("starting",
null)` (`runner.ts:249`) — i.e. before any iteration runs and before any state is written. It uses
the `detectAgent` primitive from `02` (which never throws; an absent CLI is
`{ available: false, detail }` data):

```ts
// runner.ts — new private method, called near the top of run()'s try, BEFORE writeState(:249)
import { detectAgent, getAgentDescriptors } from "./providers/registry.js"; // 02 (or barrel)

/**
 * Collect every agent id that could drive this run and probe each (REQ-DET-02). The candidate set
 * is: the run-level resolved id (resolveAgentId with no item) PLUS every distinct per-item
 * `provider` among PENDING backlog items. If ANY is unavailable, return an AgentUnavailableError-
 * shaped Result error (00 §5 template) WITHOUT writing state, with NO fallback to claude (SC-3).
 *
 * @param pendingItems the pending backlog items (their `.provider` values are the per-item candidates).
 */
private async detectAllCandidateAgents(pendingItems: readonly BacklogItem[]): Promise<Result<void>> {
  const runLevelId = resolveAgentId({
    runProvider: this.options.provider,
    projectProvider: this.projectProvider,   // read at §4.2 (must run before this)
    globalProvider: this.globalProvider,
  });

  const candidateIds = new Set<string>([runLevelId]);
  for (const item of pendingItems) {
    const id = resolveAgentId({
      itemProvider: item.provider,
      runProvider: this.options.provider,
      projectProvider: this.projectProvider,
      globalProvider: this.globalProvider,
    });
    candidateIds.add(id);
  }

  for (const id of candidateIds) {
    const result = await detectAgent(id); // never throws (02 §5.2)
    if (!result.available) {
      const ids = getAgentDescriptors().map((d) => d.id).join(", ");
      const descriptor = getAgentDescriptors().find((d) => d.id === id);
      const binary = descriptor?.binaryName ?? id;
      // AgentUnavailableError is a SEMANTIC label, not a class (00 §5). Construct the Result error
      // with the existing ErrorCodes member and the 00 §5 message template.
      return err({
        code: ErrorCodes.FILE_NOT_FOUND, // FILE_NOT_FOUND for absent binary (resolved, errors.ts:21-32)
        message:
          `Agent "${id}" is not available: ${result.detail ?? "not detected"}. ` +
          `Install it or ensure "${binary}" is on PATH. Supported agents: ${ids || "(none)"}.`,
      });
    }
  }
  return ok(undefined);
}
```

**Call site & ordering** in `run()`:

```ts
// Inside run()'s try, AFTER the §4.2 project/global reads, BEFORE writeState("starting", null) (:249):
const pendingItems = /* the pending items from the backlog already read at loop start */;
const detection = await this.detectAllCandidateAgents(pendingItems);
if (!detection.ok) {
  appendLog(this.paths, detection.error.message);
  this.emitEvent("loop_error", { error: detection.error.message });
  // RETURN before writeState — no state written, no fallback (REQ-DET-02, SC-3).
  return { completedCount: 0, blockedCount: 0, cancelled: false };
}
// ... only now: writeState("starting", null) (:249), then the §4.3-gated usage preflight (:252) ...
```

- **No silent fallback to claude** anywhere — an unavailable agent ends the run with the named,
  remediation-bearing error (SC-3).
- **No state written on failure:** the early `return` precedes `writeState` (`:249`). The `run()`
  `finally` (§4.2) still runs (disposing the empty cache, releasing the lock), which is correct —
  releasing a lock you acquired and disposing nothing is safe and idempotent.
- The candidate set deliberately includes per-item ids so a backlog whose item 3 selects an
  uninstalled `codex` fails at loop start, not on iteration 3 (the per-iteration resolve in §4.1 is
  the backstop for any id that slips through, e.g. an item added mid-run).
- Detecting the run-level id covers REQ-DET-01 for the default/`--agent` case; detecting each
  per-item id covers REQ-SEL-04 selections.

## 5. Error handling

Per CLAUDE.md, expected errors are `Result<T, E>`, never thrown. The `00 §5` error table applied to
the runner's paths:

| Situation | Where (this doc) | Result / behavior | Code (`@rauf/core`) | REQ |
|---|---|---|---|---|
| Selected agent's CLI unavailable (pre-loop) | §4.5 `detectAllCandidateAgents` | `Result` error naming agent + remediation + `getAgentDescriptors()` ids; **returned before `writeState`**, no fallback | `FILE_NOT_FOUND` (PATH) / validation (credential) | REQ-DET-02, SC-3 |
| Unknown / mistyped agent id (per-item or run-level) surfaced mid-run | §4.1 `resolveProviderForItem` | `createProvider` throw caught; `Result` error listing available ids; item reset to pending (work) / `review_failed` (review) | validation member | REQ-DISC-01 |
| Claude credentials missing | claude adapter `validateCredentials` (`claude-cli.ts:30-39`) / §4.5 claude `detect` (`02 §3.3`) | unchanged — surfaces as unavailable in pre-loop detection | `FILE_NOT_FOUND` | REQ-USAGE-01 |
| Agent process spawn failure | the `!execResult.ok` guard (`runner.ts:621-627` work; `:976-981` review) | unchanged control flow: log, reset item / `review_failed`, `loop_error` / `return` | `FILE_NOT_FOUND` (from adapter, `03 §8`) | REQ-EXEC-02 |
| Agent exits nonzero / timed out | normal flow into `classifyExit` (§3.6, §4.3) | **data, not error** — mapped to `ExitClass` uniformly | n/a | REQ-EXEC-03 |
| Usage check unsupported (non-claude) | §4.3 gating | every usage path skipped cleanly — **no error, no crash, no spurious limit** | n/a | REQ-USAGE-02 |
| Missing telemetry (plain-text agent) | result assembly (`03 §4.4`) | `reconstructedText` unset ⇒ `:644` falls back to stdout; progress events absent — **not an error** | n/a | REQ-OBS-02 |
| `provider.dispose?.()` rejects on cleanup | §4.2 `finally` | swallowed best-effort; never masks the run's outcome | n/a | lifecycle |

## 6. PRD outcome vocabulary → `ExitClass` (REQ-EXEC-03)

`classifyExit`/`ExitClass` (`exit-classifier.ts:22-29`, `:59`) are reused **unchanged** for every
agent. "Unchanged" means the runner keeps classifying every agent's exit through the existing
`ExitClass` exactly as for claude today; the PRD's five terms map onto it (tech-spec §6):

| PRD term (REQ-EXEC-03) | `ExitClass` value(s) | Notes |
|---|---|---|
| done | `done` | from a `RAUF_DONE` signal (`parseSignal`) |
| blocked | `blocked` | from `RAUF_BLOCKED:<reason>` |
| needs-human | `needs_human` | from `RAUF_NEEDS_HUMAN:<reason>` |
| limit | `usage_limited` | **claude-only** — gated per §4.3; for non-claude a `usage_limited` classification is downgraded so it never triggers the OAuth pause path |
| error | `timeout`, `infra_error`, `genuine_retry` | timeout / fast non-zero exit / exhausted retry — agent-agnostic |

## 7. Verification checklist

Maps to SC-1..SC-6 and the per-REQ coverage. `07-testing-strategy.md` owns the colocated tests; these
are the assertions an implementation must satisfy.

### REQ-ADP-01 / REQ-ADP-06 — both paths through the abstraction
- [ ] `runner.ts:609` calls `provider.execute(prompt, { outputFormat: "stream-json", onStreamEvent,
  signal, model, timeoutMinutes })`; no `spawnClaude(` remains in `runner.ts`.
- [ ] `runner.ts:969` calls `provider.execute(prompt, { signal, model, timeoutMinutes })` (no
  `outputFormat`) — review preserves text behavior (SC-2).
- [ ] `runner.ts:47` no longer imports `spawnClaude`; the test guard greps **`runner.ts` only** for a
  `spawnClaude(` call site (zero matches) and does NOT flag `index.ts:12` or `claude-cli.ts:14`.
- [ ] A mock codex/gemini/copilot/cursor agent and a `generic-cli` mock each reach `RAUF_DONE` and
  commit as today (SC-1).

### REQ-OBS-01 — real agent id in events (SC-4)
- [ ] `llm_spawned` (`runner.ts:512`) and `llm_exited` (`:633`) emit `provider: provider.id`; a codex
  run emits `provider: "codex"`, never `"claude-cli"`.
- [ ] A claude run still emits `provider: "claude-cli"` (SC-2). No event-shape change.

### REQ-USAGE-01 / REQ-USAGE-02 — usage gating (SC-2, SC-4, SC-1)
- [ ] For claude-cli: preflight (`:252`/`:1393`), between-iterations (`:1577`), pre-signal scan
  (`:651`), and post-signal `usage_limited` arm (`:803`) all run exactly as today — all existing
  claude sandbox scenarios (incl. usage-limit pause/resume) pass byte-for-byte (SC-2).
- [ ] For a non-claude agent (`checkUsage` undefined): no OAuth read, no preflight, no
  between-iterations usage check.
- [ ] A non-claude plain-text agent that prints "rate limit" / "usage limit" in normal output is
  **NOT** classified `usage_limited` (the `:651` scan is skipped and the `:803` `usage_limited` arm is
  downgraded) — no error raised (SC-1, SC-4).

### REQ-SEC-02 — neutralization (SC-6)
- [ ] `signal-redactor.ts` `SIGNAL_TOKENS` includes `RAUF_REVIEW`; both `redactSignalTokens` and
  `neutralizeForDetection` use the widened set.
- [ ] `neutralizeForDetection` leaves a standalone final-line signal (`RAUF_DONE`,
  `RAUF_BLOCKED:reason`, `RAUF_REVIEW:{…}`) intact and neutralizes quoted/inline occurrences.
- [ ] `neutralizeForDetection` is applied immediately before `parseSignal` at **both**
  `runner.ts:670` (work, on `signalText`) and `runner.ts:986` (review, on `stdout`).
- [ ] A quoted `RAUF_*` token inside any agent's output does not trigger a false signal (SC-6).
- [ ] The log-preview `redactSignalTokens` use at `runner.ts:680` is retained.

### REQ-SIG-01 / REQ-SIG-02 — uniform signal incl. plain text
- [ ] `parseSignal` is the sole signal contract for every agent (unchanged).
- [ ] For non-claude agents `reconstructedText` is unset, so `runner.ts:644` falls back to raw stdout;
  a plain-text mock reaches `RAUF_DONE` via that path (no new code path).

### REQ-EXEC-03 — exit classification
- [ ] `classifyExit`/`ExitClass` are unchanged and applied to every agent; the PRD→ExitClass mapping
  (§6) holds; non-claude `usage_limited` is downgraded in the runner (not in the classifier).

### REQ-PERF-01 — no claude-path degradation
- [ ] One provider instance per distinct agent id per run (`providerCache`); claude is constructed
  once and reused across iterations; the claude path adds exactly one indirection.
- [ ] `provider.dispose?.()` is called for **every** cached instance in the `run()` `finally`
  (`runner.ts:379`), on normal completion, fail-fast detection error, abort/cancel, and thrown error;
  the cache is cleared.

### REQ-DET-02 — pre-loop fail-fast (SC-3)
- [ ] `detectAllCandidateAgents` runs **before** `writeState("starting", null)` (`:249`) and before
  the usage preflight (`:252`).
- [ ] The candidate set = run-level resolved id + every distinct per-item `provider` among pending
  items.
- [ ] An absent agent returns an error naming the agent + remediation + supported ids, **no state is
  written**, and there is **no fallback to claude** (SC-3).

### REQ-MODEL-01 — model precedence intact
- [ ] `runner.ts:494` is unmodified; `resolvedModel` is passed to `provider.execute({ model })`.

## Dependencies

Must be implemented **after**: `00-core-definitions.md`, `02-agent-registry-and-detection.md`,
`03-cli-agent-engine-and-presets.md`, `04-agent-selection.md`, and the `signal-redactor.ts` /
`exit-classifier.ts` reuse contracts. It is the last `packages/loop` runtime node before
`06-cli-surface.md`. Depended on by `06-cli-surface.md` (which supplies `runProvider` via `--agent`)
and `07-testing-strategy.md` (runner-wiring assertions).

## Resolved during cross-reference validation

- **`ErrorCodes` members — RESOLVED.** Confirmed against `packages/core/src/errors.ts:21-32`:
  members are `FILE_NOT_FOUND`, `INVALID_JSON`, `VALIDATION_ERROR`, `PATH_VIOLATION`,
  `ALREADY_INSTALLED`, `NOT_INSTALLED`, `CONFLICT`, `TRANSITION_INVALID`, `LOCK_CONFLICT`, `IO_ERROR`
  — there is **no `INVALID_INPUT`**. Use `FILE_NOT_FOUND` for absent-binary fail-fast and
  `VALIDATION_ERROR` for unknown/malformed-id wrapping (`00 §5`).
- **Child-env forwarding — RESOLVED (was an SC-2 risk).** Verified the committed
  `ClaudeCliProvider.execute` (`claude-cli.ts:14-20`) does **not** forward env, and `ExecuteOptions`
  (`providers/types.ts:35-45`) has **no `env` field** — so naively routing through `execute` would
  drop the runner's `childEnv` (`runner.ts:615`/`:973`) and regress review-hook suppression. The
  resolution is committed in the wiring above: this feature **adds `ExecuteOptions.env?`**
  (`00 §3.4`), the runner passes `this.childEnv` through it at both call sites, `ClaudeCliProvider.execute`
  forwards `options.env` into `spawnClaude` (`SpawnClaudeOptions.env`, `claude-process.ts:17-22`),
  and `CliAgent.execute` merges it over `CliAgentConfig.env` (`03 §4.5`). `07-testing-strategy.md`
  must assert childEnv still reaches the claude process (SC-2 review-hook scenario).

## Warnings (confirm at implementation)

- **Review-pass provider resolution:** the review method's exact name and surrounding control values
  (`"failed"` / `"clean"`) were verified around `runner.ts:955-994`; confirm the method signature when
  inserting the run-level provider resolve.
