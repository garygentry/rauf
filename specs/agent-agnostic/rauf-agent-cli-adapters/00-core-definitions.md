# 00 — Core Definitions

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, target repo **rauf**).
> Source of truth: `PRD.md` (v2) + `tech-spec.md` (v2). This document defines the shared
> type system, constants, and error contracts that every other spec document in this suite
> references. Cross-references use exact filenames (e.g. `02-agent-registry-and-detection.md`).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-SEL-01 | `--agent`/`agent` user surface aliases internal `provider` | 2, 4 |
| REQ-ADP-01 | Single `AgentAdapter` abstraction | 2, 3.1 |
| REQ-ADP-02 | Adapter encapsulates its invocation contract | 3.2 (`CliAgentConfig`) |
| REQ-ADP-04 | Configurable generic-cli adapter | 3.2 (`CliAgentConfig`) |
| REQ-ADP-05 | Registry keyed by stable agent id | 3.3 (`AgentDescriptor`) |
| REQ-DET-01/02 | Availability detection + fail-fast | 3.3 (`DetectionResult`), 5 (`AgentUnavailableError`) |
| REQ-MODEL-01/02 | Model independent of agent; default when unset | 3.2 (`modelFlag`) |
| REQ-OBS-02 | Telemetry gracefully absent for plain-text agents | 3.2 (`parsesStream`), 3.4 |
| REQ-SIG-01/02 | Uniform `RAUF_*` signal contract incl. plain-text | 3.4 (reused `ParsedSignal`/`SignalType`) |
| REQ-SEC-02 | Signal-token neutralization before detection | 3.4, 6 (`SIGNAL_TOKENS`) |
| REQ-EXEC-03 | Exit classified into existing vocabulary | 3.4 (reused `ExitClass`) |
| REQ-USAGE-02 | Usage check optional/absent without error | 3.4 (reused `LLMProvider.checkUsage?`) |
| REQ-SCALE-01 | Add agent via config or registration, no runner change | 3.2, 3.3 |

## 1. Conventions

- **Language/stack:** strict TypeScript (`strict`, `noUncheckedIndexedAccess`), Bun runtime,
  ESM with `.js` import specifiers (NodeNext), per `CLAUDE.md` and the TypeScript stack profile.
- **Named exports only.** Every type/function below is a named export.
- **Errors:** core functions return `Result<T, E>` (from `@rauf/core`) and never throw for
  expected errors (`CLAUDE.md`). The one inherited exception is `createProvider`, which throws
  on an unknown id (existing behavior); the selection/runner layers wrap it (see §5 and
  `04-agent-selection.md`, `05-runner-wiring.md`).
- **`node:` prefix** for Node built-ins.
- **Location:** all new types live in `packages/loop/src/` — adapter types in
  `providers/types.ts`, the config-driven engine config in `providers/cli-agent.ts`. None are
  persisted (no schema change); see `04-agent-selection.md §Data Model` for the one additive
  input-alias normalization.

## 2. The `AgentAdapter` charter alias (REQ-ADP-01, REQ-SEL-01)

The charter contract name `AgentAdapter` is satisfied as a **type alias** of the already-committed
`LLMProvider` interface — no internal rename (tech-spec §3.1). Defined in `providers/types.ts`,
re-exported from `packages/loop/src/index.ts`:

```ts
import type { LLMProvider } from "./types.js";

/**
 * Charter contract name (epic `agent-agnostic`) for the abstraction that drives one
 * coding-agent CLI through a single loop iteration: spawn the process, deliver the prompt,
 * consume output, and report a resolved outcome. Structurally identical to {@link LLMProvider};
 * the internal vocabulary stays `provider`/`LLMProvider`, the exported/contract vocabulary is
 * `agent`/`AgentAdapter`. (REQ-ADP-01, REQ-SEL-01, tech-spec §3.1.)
 */
export type AgentAdapter = LLMProvider;
```

Downstream epic consumers (`cross-agent-installer`, `forge-rauf-loop-default`) bind to
`AgentAdapter` and the registry/selection exports listed in `01-architecture-layout.md`.

## 3. New types

### 3.1 — none beyond the alias for the adapter abstraction itself

The adapter abstraction is the reused `LLMProvider` (see §7). The new types below describe
**registration/detection** (§3.3) and the **config-driven engine** (§3.2).

### 3.2 `CliAgentConfig` — config-driven CLI engine config (REQ-ADP-02/04, REQ-MODEL-01/02, REQ-OBS-02, REQ-SCALE-01)

Defined in `providers/cli-agent.ts`. One declarative config backs every non-claude adapter:
the named presets (`codex`/`gemini`/`copilot`/`cursor`) and the `generic-cli` adapter
(tech-spec §3.4). The `CliAgent` class that consumes it is specified in
`03-cli-agent-engine-and-presets.md`.

```ts
/** How an agent CLI receives the iteration prompt. */
export type PromptDelivery = "stdin" | "arg" | "file";

/** Context passed to {@link CliAgentConfig.buildArgs} when assembling the agent's argv. */
export interface BuildArgsContext {
  /** Resolved model string, or undefined to let the agent use its own default (REQ-MODEL-02). */
  model?: string;
  /**
   * Absolute path to a temp file containing the prompt, present only when
   * `promptDelivery === "file"`; undefined for "stdin"/"arg" delivery.
   */
  promptFile?: string;
}

/**
 * Declarative invocation contract for a CLI coding agent (REQ-ADP-02). Fully describes how to
 * spawn and drive the agent non-interactively, so a new agent is reachable by config alone
 * (REQ-ADP-04, REQ-SCALE-01) with no change to runner orchestration.
 */
export interface CliAgentConfig {
  /** Stable agent id used as the registry key and the `provider` value (e.g. "codex"). */
  id: string;
  /** Human-readable name for help/discovery output (e.g. "OpenAI Codex (CLI)"). */
  displayName: string;
  /** Executable name resolved on PATH (e.g. "codex", "cursor-agent"). */
  binary: string;
  /**
   * Builds the argument vector (excluding `binary`) for one invocation. Receives the resolved
   * model and, for file delivery, the prompt-file path. Must NOT include the prompt for
   * stdin delivery (the engine writes it to stdin).
   */
  buildArgs: (ctx: BuildArgsContext) => string[];
  /** How the prompt reaches the agent. `generic-cli` configures this; presets fix it. */
  promptDelivery: PromptDelivery;
  /**
   * Auto-approve / non-interactive flags ensuring the agent never prompts for confirmation
   * (REQ-EXEC-01). Always appended; e.g. `["--full-auto"]`, `["--yolo"]`.
   */
  nonInteractive: string[];
  /**
   * Maps a resolved model string to model-selection flags (e.g. `m => ["--model", m]`).
   * Omitted ⇒ the agent's own default model is used and no model flag is passed (REQ-MODEL-02).
   */
  modelFlag?: (model: string) => string[];
  /** Extra environment variables merged over `process.env` for the child process. */
  env?: Record<string, string>;
  /**
   * Whether this agent emits a rich structured stream. Non-claude CLI agents are plain-text:
   * this is `false` or omitted, so token/tool telemetry is gracefully absent (REQ-OBS-02).
   */
  parsesStream?: false;
}
```

### 3.3 `AgentDescriptor` / `DetectionResult` — registry + detection (REQ-ADP-05, REQ-DET-01/02, REQ-DISC-01/02)

Defined in `providers/types.ts` (consumed by `providers/registry.ts`). The descriptor layers
enumerable metadata + a detection probe over the existing factory map (tech-spec §3.5). Full
registry behavior is specified in `02-agent-registry-and-detection.md`.

```ts
import type { ProviderFactory } from "./types.js";

/** Result of probing whether an agent's CLI is available on the current machine. */
export interface DetectionResult {
  /** True when the agent's CLI can be invoked (e.g. its binary resolves on PATH). */
  available: boolean;
  /**
   * Human-readable detail for discovery output and fail-fast remediation messages
   * (e.g. "found at /usr/local/bin/codex", or "binary 'codex' not found on PATH").
   */
  detail?: string;
}

/**
 * Registry entry describing one selectable agent (REQ-ADP-05). Enumerable for help/discovery
 * (REQ-DISC-01/02) and probeable for availability (REQ-DET-01) without constructing a provider
 * or reading run config.
 */
export interface AgentDescriptor {
  /** Stable agent id (registry key, equals the provider id, e.g. "claude-cli", "codex"). */
  id: string;
  /** Human-readable name for help/discovery (e.g. "Claude Code (CLI)"). */
  displayName: string;
  /**
   * Executable resolved on PATH for the default detector. Omitted ONLY for the reserved
   * `generic-cli` descriptor, whose binary is unknown until its `providerConfig` is read
   * (tech-spec §3.4); such descriptors MUST supply a custom `detect` (tech-spec §3.5).
   */
  binaryName?: string;
  /** Factory that constructs the provider instance (reused {@link ProviderFactory}). */
  factory: ProviderFactory;
  /**
   * Availability probe. Defaults to a PATH resolution of `binaryName` (no agent subprocess —
   * a stat-style `which`, consistent with CLAUDE.md "status reads files, not subprocesses").
   * `claude-cli` overrides this with its credential check; `generic-cli` overrides it to
   * resolve the binary from the supplied `providerConfig`.
   */
  detect?: () => Promise<DetectionResult>;
}
```

### 3.4 `ExecuteOptions.env` — additive extension of a reused contract (SC-2)

The runner today passes `env: this.childEnv` directly into `spawnClaude` at **both** call sites
(`runner.ts:615` work, `:973` review). `childEnv` carries the review-hook suppression and other
child-session env overrides (`resolveChildEnv` / `REVIEW_HOOK_SUPPRESSION_ENV`, `review-hooks.ts`).
Once the runner drives iterations through `provider.execute(...)` instead of calling `spawnClaude`
directly (`05-runner-wiring.md`), that env must travel through the provider seam — otherwise the
claude path silently loses its child env, regressing review-hook suppression (an SC-2 break).

`ExecuteOptions` (`providers/types.ts:35-45`) currently has **no `env` field**, so this feature
**adds one** — a minimal, additive, optional field mirroring the existing
`SpawnClaudeOptions.env` (`claude-process.ts:17-22`):

```ts
export interface ExecuteOptions {
  // ...existing fields (model?, timeoutMinutes, signal?, onProgress?, outputFormat?, onStreamEvent?)...
  /**
   * Environment overrides for the agent's child process, merged over `process.env`. The runner
   * passes its resolved `childEnv` here so review-hook suppression and other child-session env
   * reach every adapter uniformly. `ClaudeCliProvider.execute` forwards it to `spawnClaude`
   * (`SpawnClaudeOptions.env`); `CliAgent.execute` merges it OVER `CliAgentConfig.env`
   * (`03-cli-agent-engine-and-presets.md §4.5`). Omitted ⇒ child inherits the parent env unchanged.
   */
  env?: Record<string, string>;
}
```

This is the one extension to a reused contract this feature makes. The runner wiring that supplies
it (and the claude-adapter forwarding that consumes it) is specified in `05-runner-wiring.md`.

## 4. Naming model — `agent` (surface) vs `provider` (internal)

| Layer | Token | Notes |
|---|---|---|
| CLI flag | `--agent <id>` | maps to `LoopStartOptions.provider` (`05-runner-wiring.md`, `06-cli-surface.md`) |
| Project/global config key | `agent` (input alias) → `provider`/`defaultProvider` | normalized at load (`04-agent-selection.md`) |
| Backlog item key | `agent` (input alias) → `provider` | normalized at load; canonical persisted key stays `provider` |
| Internal abstraction | `LLMProvider` / `provider` | unchanged committed vocabulary |
| Charter export | `AgentAdapter` (= `LLMProvider`) | §2 |
| Lifecycle events | `llm_spawned` / `llm_exited`, field `provider` | value becomes real id (REQ-OBS-01) |

No committed schema field is renamed (PRD §5, tech-spec §3.1). The `agent` key is an **additive,
optional input alias** only.

## 5. Error contracts

All new fallible operations return `Result<T, E>` using the committed `@rauf/core` `ErrorCodes`.
No new error class hierarchy is introduced; errors are the existing structured `{ code, message }`
shape carried by `Result`. The semantic error situations this feature adds:

| Situation | Code (`@rauf/core` `ErrorCodes`) | Surfaced where | REQ |
|---|---|---|---|
| Selected agent's CLI unavailable (pre-loop fail-fast, before any state write) | `FILE_NOT_FOUND` (binary not on PATH) / validation code for credential failure | `05-runner-wiring.md` pre-loop detection; message names the agent + install/PATH remediation, lists `getAgentDescriptors()` ids | REQ-DET-02, SC-3 |
| Unknown / mistyped agent id (per-item or run-level) | thrown by `createProvider` (`registry.ts:15`), wrapped into a `Result` error listing available ids | `04-agent-selection.md`, `05-runner-wiring.md §4.1` | REQ-DISC-01 |
| Claude credentials missing (claude-cli `validateCredentials`) | `FILE_NOT_FOUND` (existing `ClaudeCliProvider.validateCredentials`, `claude-cli.ts:30-39`) | unchanged | REQ-USAGE-01 |
| Usage check unsupported (non-claude) | not an error — `provider.checkUsage` undefined ⇒ usage paths skipped | `05-runner-wiring.md §4.3` | REQ-USAGE-02 |
| Missing telemetry (plain-text agent) | not an error — `reconstructedText` unset, progress events absent | `03-cli-agent-engine-and-presets.md` | REQ-OBS-02 |

> **`AgentUnavailableError` is a *semantic* label, not a new class.** Implementations construct a
> `Result` error with the appropriate existing `ErrorCodes` member and a message of the form:
> `Agent "<id>" is not available: <detail>. Install it or ensure "<binary>" is on PATH. Supported agents: <ids>.`
> The pre-loop detection orchestration owns this message (`05-runner-wiring.md`).

## 6. Constants

```ts
/** Built-in default agent id when nothing is selected at any layer (REQ-SEL-03). */
export const DEFAULT_AGENT_ID = "claude-cli";

/** Reserved id for the single marker-`providerConfig`-driven generic adapter (tech-spec §3.4). */
export const GENERIC_AGENT_ID = "generic-cli";

/**
 * Signal tokens neutralized inside agent output before detection (REQ-SEC-02). EXTENDS the
 * existing `signal-redactor.ts:1` set (which omits RAUF_REVIEW) — see
 * `05-runner-wiring.md §4.4`. Authoritative list:
 */
export const SIGNAL_TOKENS = ["RAUF_DONE", "RAUF_BLOCKED", "RAUF_NEEDS_HUMAN", "RAUF_REVIEW"] as const;
```

(`GRACE_PERIOD_MS = 30_000` and `INFRA_FAST_MS = 10_000` are existing constants in
`claude-process.ts:9` and `exit-classifier.ts:35` — reused unchanged, not redefined here.)

## 7. Reused contracts — DO NOT redefine

These are **already committed and tested**. Implementation specs reference them by name and import
path; they must NOT be re-declared or duplicated (tech-spec §1, §6). Verified against source.

| Type / symbol | Source (verbatim) | Shape (abridged) | Used by |
|---|---|---|---|
| `LLMProvider` | `providers/types.ts:12-33` | `{ id; displayName; execute(prompt, opts): Promise<Result<ExecutionResult>>; checkUsage?(): Promise<UsageLimitResult>; validateCredentials(): Result<void>; dispose?(): Promise<void> }` | all adapters, runner |
| `ExecuteOptions` | `providers/types.ts:35-45` | `{ model?; timeoutMinutes; signal?; onProgress?; outputFormat?: "text"\|"stream-json"; onStreamEvent? }` — **EXTENDED by this feature** with `env?: Record<string, string>` (see §3.4) | `execute` |
| `ExecutionResult` | `providers/types.ts:47-64` | `{ stdout; stderr; exitCode; timedOut; durationMs; parsedSignal?; progressEvents?; reconstructedText? }` | `execute` return |
| `ProviderProgressEvent` | `providers/types.ts:66-70` | `{ type; timestamp; detail }` | telemetry |
| `UsageLimitResult` | `providers/types.ts:72-79` | `{ limited; limitType?; utilization?; retryAfter?; resetsAt? }` | `checkUsage` |
| `ProviderFactory` | `providers/types.ts:81-82` | `(config?: Record<string, unknown>) => LLMProvider` | registry/descriptor |
| `ProviderId` | `providers/types.ts:6` | `string` | ids |
| `registerProvider` / `createProvider` / `getAvailableProviders` / `clearProviders` | `providers/registry.ts:6/11/23/28` | factory map ops; `createProvider` **throws** on unknown id | `02-agent-registry-and-detection.md` |
| `ParsedSignal` / `SignalType` | `signal-parser.ts:7-11` / `:4` | `SignalType = "done"\|"blocked"\|"needs_human"\|"review"\|"none"` | signal parsing (REQ-SIG-01) |
| `parseSignal` | `signal-parser.ts:27` | `(stdout: string) => ParsedSignal`; scans lines backward, whole-line match | `05-runner-wiring.md` |
| `redactSignalTokens` | `signal-redactor.ts:4` | `(text) => string`; replaces `_`→`·`; **token set lacks RAUF_REVIEW** | extended in `05` |
| `ExitClass` / `ExitResult` / `classifyExit` / `hasUsageLimitInText` / `INFRA_FAST_MS` | `exit-classifier.ts:22-29 / 38-45 / 59 / 16 / 35` | classification vocabulary (REQ-EXEC-03); `hasUsageLimitInText` matches `USAGE_LIMIT_PATTERNS` at `:4-10` | `05-runner-wiring.md` |
| `spawnClaude` / `SpawnClaudeOptions` / `SpawnClaudeResult` | `claude-process.ts:` (opts `:11-23`, result `:25-32`, spawn `:87` `detached:true`, stdin `:217`, kill `:162-173`, `GRACE_PERIOD_MS :9`) | claude internals + the kill/timeout/group pattern reused by `CliAgent` | `claude-cli.ts`, `03-...` |
| `createClaudeCliProvider` | `providers/claude-cli.ts:50` | `() => LLMProvider` (claude adapter) | re-registered via descriptor (`02-...`) |
| Schema fields `BacklogItem.provider`/`.model`, `LoopStartOptions.provider`, `ToolConfig.defaultProvider`/`.providers`, `MarkerOptions.provider`/`.providerConfig` | `core/schemas.ts:72/69/377/222/223/148/149` | all `z.string().optional()` / record | selection + data model |
| Events `llm_spawned` / `llm_exited` | `core/schemas.ts:448-463` | `{ type; provider: string; ... }` | REQ-OBS-01 |

## Dependencies

This is the foundation document — it depends on no other spec in this suite. All other documents
(`01`–`07`) depend on the types, constants, and reused-contract catalog defined here.

## Verification

- [ ] `AgentAdapter`, `AgentDescriptor`, `DetectionResult`, `CliAgentConfig`, `PromptDelivery`,
  `BuildArgsContext` compile as valid TS in `providers/types.ts` / `providers/cli-agent.ts`.
- [ ] `DEFAULT_AGENT_ID`, `GENERIC_AGENT_ID`, `SIGNAL_TOKENS` are exported and `SIGNAL_TOKENS`
  includes `RAUF_REVIEW`.
- [ ] No type in §7 is redeclared anywhere in the suite — each is imported from its cited source.
- [ ] `AgentAdapter` is structurally assignable to/from `LLMProvider` (alias, not a fork).
