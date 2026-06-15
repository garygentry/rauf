# 03 — CliAgent Engine, Presets & generic-cli

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, repo **rauf**). Based on `PRD.md` v2,
> `tech-spec.md` v2 (esp. §3.4, §3.8, §10). Depends on `00-core-definitions.md` for all shared
> types (`CliAgentConfig`, `PromptDelivery`, `BuildArgsContext`, `LLMProvider`, `ExecuteOptions`,
> `ExecutionResult`, `DEFAULT_AGENT_ID`, `GENERIC_AGENT_ID`) and on `01-architecture-layout.md` for
> the directory layout (`providers/cli-agent.ts`, `providers/presets.ts`, `providers/generic-cli.ts`,
> the extracted `process-group.ts`). Cross-references use exact filenames.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ADP-02 | Adapter encapsulates its own invocation contract | 3.1, 6 |
| REQ-ADP-03 | Ship `codex`/`gemini`/`copilot`/`cursor` presets | 6 |
| REQ-ADP-04 | Configurable generic-cli adapter | 7 |
| REQ-EXEC-01 | Non-interactive (auto-approve) invocation | 4.1, 6 |
| REQ-EXEC-02 | Per-iteration timeout + clean process-group kill | 4.2, 5 |
| REQ-MODEL-01 | Model independent of agent; adapter translates | 4.1 |
| REQ-MODEL-02 | Agent default model when none resolved | 4.1, 6 |
| REQ-OBS-02 | Token/tool telemetry gracefully absent (plain-text) | 3.1, 4.4, 8 |
| REQ-SIG-02 | Signal detection on plain-text output path | 3.1, 4.4 |
| REQ-SCALE-01 | Add an agent without changing runner code | 7 |
| OQ-3 | Engine + presets shape (config-driven core) | 1, 3.1 |

## 1. Purpose & scope

This document specifies the **config-driven CLI engine** (`CliAgent`) that backs every non-claude
coding-agent adapter, the four shipped **presets** (`codex`, `gemini`, `copilot`, `cursor`), the
**`generic-cli`** adapter, and the **shared process-group helper** they all use to spawn, time out,
and kill an agent subprocess cleanly.

It resolves tech-spec **OQ-3** ("config-driven engine + thin presets" — *not* bespoke per-agent
classes): one `CliAgent implements LLMProvider`, consuming a declarative `CliAgentConfig`
(`00-core-definitions.md §3.2`), is the single implementation. Presets and `generic-cli` are just
different sources of that config. Adding an agent is therefore a config literal or a config entry,
never new orchestration code (REQ-SCALE-01, §7).

In scope:
- `providers/cli-agent.ts` — the `CliAgent` class (engine) + its private `execute` algorithm.
- `process-group.ts` — the shared spawn/timeout/kill/group helper, **extracted** from
  `claude-process.ts` so both it and `CliAgent` share one implementation (tech-spec §10).
- `providers/presets.ts` — the four `CliAgentConfig` literals.
- `providers/generic-cli.ts` — the reserved `generic-cli` adapter (config from marker
  `providerConfig`) plus the rule for building a `CliAgent` from an arbitrary named
  `ToolConfig.providers[<id>]` entry.

Out of scope (specified elsewhere): registration/detection of these adapters
(`02-agent-registry-and-detection.md`); selection precedence (`04-agent-selection.md`); runner
wiring, usage gating, and signal neutralization (`05-runner-wiring.md`); the `--agent` flag /
`rauf agents` command (`06-cli-surface.md`); tests (`07-testing-strategy.md`).

The claude adapter (`providers/claude-cli.ts`) is **not** a `CliAgent` — it stays its own bespoke
adapter wrapping `spawnClaude` (tech-spec §3.4). It is mentioned here only because
`claude-process.ts` refactors to share `process-group.ts` (§5), which must preserve its behavior
exactly (SC-2).

## 2. Dependencies

This document depends on:

- `00-core-definitions.md` — `CliAgentConfig`, `PromptDelivery`, `BuildArgsContext` (`§3.2`);
  reused `LLMProvider`, `ExecuteOptions`, `ExecutionResult`, `ProviderFactory` (`§7`); constants
  `DEFAULT_AGENT_ID`, `GENERIC_AGENT_ID` (`§6`). **None of these are redefined here** — they are
  imported from their cited sources.
- `01-architecture-layout.md` — file locations and the extracted-`process-group.ts` decision.

Reused source contracts (verified against the actual files, paths verbatim):

| Symbol | Source | Used for |
|---|---|---|
| `LLMProvider`, `ExecuteOptions`, `ExecutionResult` | `packages/loop/src/providers/types.ts:12-33 / 35-45 / 47-64` | engine interface + return shape |
| `ProviderFactory` | `packages/loop/src/providers/types.ts:81-82` | `generic-cli` factory (§7) |
| `Result`, `ok`, `err`, `ErrorCodes` | `@rauf/core` (as imported at `claude-process.ts:4-5`) | error contracts (§8) |
| `spawnClaude` / `SpawnClaudeOptions` / `SpawnClaudeResult` | `packages/loop/src/claude-process.ts:67 / 11-23 / 25-32` | refactored to delegate to `process-group.ts` (§5) |
| `killTree` pattern | `packages/loop/src/claude-process.ts:38-51` | extracted into `process-group.ts` (§5) |
| `GRACE_PERIOD_MS = 30_000` | `packages/loop/src/claude-process.ts:9` | reused, moved into `process-group.ts` (§5) |

**Implementation order:** this document is implemented after `02-agent-registry-and-detection.md`
(the descriptor layer those adapters register against) and before `05-runner-wiring.md`
(per `01-architecture-layout.md §5`). The `process-group.ts` extraction (§5) should land first so
both `claude-process.ts` and `cli-agent.ts` build against it.

## 3. Public API

### 3.1 `CliAgent` (`providers/cli-agent.ts`)

`CliAgent` is the single config-driven engine. It `implements LLMProvider` (`types.ts:12-33`) but
deliberately implements **only** `id`, `displayName`, `execute`, and `validateCredentials` — it does
**not** implement `checkUsage`. Omitting `checkUsage` is load-bearing: the runner gates all
Anthropic usage handling on `provider.checkUsage` being defined (`05-runner-wiring.md §usage
gating`, tech-spec §3.6), so a `CliAgent` automatically skips every usage path with no crash and no
spurious limit detection (REQ-USAGE-02). It also does not implement the optional `dispose` (no
persistent resource to release; temp prompt files are cleaned up inline per invocation, §4.3).

```ts
import { ok, err, ErrorCodes } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnProcessGroup } from "../process-group.js";
import type { LLMProvider, ExecuteOptions, ExecutionResult } from "./types.js";
import type { CliAgentConfig, BuildArgsContext } from "./cli-agent.js"; // CliAgentConfig lives in this file

/**
 * Config-driven CLI coding-agent adapter (REQ-ADP-02, tech-spec §3.4, OQ-3).
 *
 * One engine backs every non-claude CLI agent: the named presets
 * (`codex`/`gemini`/`copilot`/`cursor`, see {@link ./presets.ts}) and the configurable
 * `generic-cli` adapter ({@link ./generic-cli.ts}). All invocation specifics — binary, args,
 * prompt delivery, non-interactive flags, model flag, env — come from the supplied
 * {@link CliAgentConfig}; this class contains no agent-specific knowledge (REQ-SCALE-01).
 *
 * The agent is always driven in **plain-text** mode (no stream parsing): the returned
 * {@link ExecutionResult} leaves `reconstructedText`, `parsedSignal`, and `progressEvents`
 * unset, so token/tool telemetry is gracefully absent without error (REQ-OBS-02, REQ-SIG-02).
 * Signal detection runs over raw `stdout` in the runner's existing fallback path
 * (`05-runner-wiring.md`).
 */
export class CliAgent implements LLMProvider {
  /** Stable agent id (= the `provider` value, e.g. "codex"). From `config.id`. */
  readonly id: string;
  /** Human-readable name for help/discovery. From `config.displayName`. */
  readonly displayName: string;

  /** @param config Declarative invocation contract (`00-core-definitions.md §3.2`). */
  constructor(private readonly config: CliAgentConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
  }

  /**
   * Execute one loop iteration non-interactively (REQ-EXEC-01). See §4 for the full algorithm.
   * Spawn failure / nonzero exit / timeout are returned via Result/ExecutionResult — never
   * thrown for expected errors (§8).
   */
  async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>>;

  /**
   * Minimal credential gate. A `CliAgent` carries no credentials of its own — credential/PATH
   * availability is the registry's job (`02-agent-registry-and-detection.md`, via the descriptor
   * `detect` probe run pre-loop). This therefore returns `ok(undefined)` unconditionally; it MUST
   * NOT spawn the agent or probe PATH (that duplicates detection and would add latency).
   */
  validateCredentials(): Result<void>;

  // NOTE: no `checkUsage` — intentional (REQ-USAGE-02). No `dispose` — nothing to release.
}
```

> **`CliAgentConfig` / `PromptDelivery` / `BuildArgsContext` are defined in
> `00-core-definitions.md §3.2`** and live in `providers/cli-agent.ts`. They are **not** redefined
> here. This file *declares* them (per the foundation doc) and *consumes* them in `CliAgent`.

`validateCredentials` body:

```ts
validateCredentials(): Result<void> {
  // Availability/PATH is verified pre-loop by the registry's descriptor detect probe
  // (02-agent-registry-and-detection.md). A bare CliAgent has no credentials to validate.
  return ok(undefined);
}
```

### 3.2 Presets factory (`providers/presets.ts`)

```ts
import type { CliAgentConfig } from "./cli-agent.js";

/**
 * Best-known invocation contracts for the four shipped named agents (REQ-ADP-03).
 * See the WARNING in §6 — the non-interactive/model flags are correctable config literals
 * (OQ-2), not code.
 */
export const PRESET_CONFIGS: readonly CliAgentConfig[];

/** Construct a fresh `CliAgent` config by preset id, or `undefined` if `id` is not a preset. */
export function getPresetConfig(id: string): CliAgentConfig | undefined;
```

Registration of these presets as descriptors is specified in
`02-agent-registry-and-detection.md` (each preset's `binaryName` is its `config.binary`, and the
factory is `() => new CliAgent(config)`).

### 3.3 generic-cli factory (`providers/generic-cli.ts`)

```ts
import type { ProviderFactory } from "./types.js";
import type { CliAgentConfig } from "./cli-agent.js";

/**
 * Factory for the reserved `generic-cli` adapter (id === GENERIC_AGENT_ID). Builds a `CliAgent`
 * from the per-run marker `providerConfig` (`MarkerOptions.providerConfig`,
 * `core/schemas.ts:149`). Throws an expected-shape Result-free error only when invoked with no
 * usable config — see §7 for the contract and the named-agent (case 1) path.
 */
export const createGenericCliProvider: ProviderFactory;

/**
 * Normalize an untyped config record (marker `providerConfig` or a `ToolConfig.providers[id]`
 * entry) into a validated `CliAgentConfig`. Returns a Result so a malformed entry is an expected
 * error, not a throw (§7, §8).
 */
export function configToCliAgentConfig(
  id: string,
  raw: Record<string, unknown>,
): Result<CliAgentConfig>;
```

## 4. Internal implementation — `CliAgent.execute`

### 4.1 Argv assembly (REQ-EXEC-01, REQ-MODEL-01/02)

`execute` builds the argument vector from the config, in this fixed order:

```
argv = [ ...config.buildArgs(ctx),
         ...config.nonInteractive,
         ...(options.model && config.modelFlag ? config.modelFlag(options.model) : []) ]
```

where `ctx: BuildArgsContext = { model: options.model, promptFile }` (`promptFile` set only for
file delivery, §4.3).

- `buildArgs(ctx)` produces the agent's subcommand/positional args (e.g. `["exec"]` for codex). It
  **must not** include the prompt for `stdin` delivery (the engine writes stdin) and **must not**
  include model flags (the engine appends them) — see the per-preset `buildArgs` in §6.
- `config.nonInteractive` is **always** appended, guaranteeing auto-approve / no confirmation
  prompts so the loop runs unattended (REQ-EXEC-01).
- The model flag is appended **only when both** a model was resolved (`options.model` truthy) **and**
  `config.modelFlag` is defined. If no model is resolved, no model flag is passed and the agent uses
  its own default model (REQ-MODEL-02). If the agent has no model flag (`modelFlag` omitted), the
  resolved model is silently ignored — the adapter "may ignore it if unsupported" (REQ-MODEL-01).

Model resolution itself happens in the runner (`item.model ?? options.model ?? projectModel`,
`runner.ts:494`, untouched per tech-spec §3.8); `execute` only *translates* the already-resolved
string. This keeps model selection fully independent of agent selection (REQ-MODEL-01).

### 4.2 Spawn, timeout & kill (REQ-EXEC-02)

`execute` delegates all process plumbing to the shared `spawnProcessGroup` helper (§5), passing:

- `cmd = config.binary`, `args = argv` (§4.1).
- `timeoutMs = options.timeoutMinutes * 60 * 1000`.
- `signal = options.signal` (the runner's `AbortSignal` for cancel/stop).
- `env = config.env` (merged over `process.env` only when present — §5).
- `stdin`: the prompt string for `stdin` delivery, otherwise `undefined` (§4.3).

The helper spawns with `detached: true` (own process group), enforces the timeout via
`SIGTERM → GRACE_PERIOD_MS (30s) → SIGKILL` on the **negative PID** (whole group), and honors the
abort signal by sending `SIGTERM` to the group. This is the exact pattern lifted from
`claude-process.ts` (spawn `:87`, `killTree` `:38-51`, grace timers `:165-167`, abort `:170-173`,
timeout `:221-223`), now shared so behavior is uniform across every agent (REQ-EXEC-02) and the
claude path is unchanged (SC-2).

### 4.3 Prompt delivery (`PromptDelivery`)

`execute` delivers the prompt per `config.promptDelivery`:

- **`"stdin"`** — pass the prompt as the helper's `stdin` input; the helper writes it to the child's
  stdin and calls `end()`, ignoring `EPIPE` if the child exits early (mirrors
  `claude-process.ts:214-218`). `buildArgs` receives no `promptFile`.
- **`"arg"`** — append the prompt as the **final** element of `argv` (after model flags), and pass
  no stdin. Concretely the assembled argv becomes `[...argv, prompt]`. `buildArgs` receives no
  `promptFile`.
- **`"file"`** — before spawning, write the prompt to a temp file, set `ctx.promptFile` to its
  absolute path so `buildArgs` can place it in the argv (e.g. `["--prompt-file", ctx.promptFile!]`),
  pass no stdin, and **always** delete the temp file in a `finally` after the process resolves
  (success, timeout, abort, or spawn failure). The temp file MUST be created **inside the loop's
  sandbox/working directory** (the process `cwd`, which is `ROOT_DIRECTORY`) — never outside it —
  to honor the path-sandboxing guarantee (REQ-SEC-01, CLAUDE.md). Use a collision-resistant name
  such as `.rauf-prompt-<pid-or-random>.txt`; on cleanup failure, swallow the error (best-effort
  unlink, never fail the iteration).

> The shipped presets use only `"stdin"` and `"arg"` (§6). `"file"` exists for `generic-cli` /
> arbitrary named agents whose CLI takes the prompt from a file path (REQ-ADP-04). It is fully
> specified so an implementer can support it, even though no preset exercises it.

### 4.4 Result assembly (REQ-OBS-02, REQ-SIG-02)

On process resolution the helper returns `{ exitCode, stdout, stderr, timedOut, durationMs }`.
`execute` maps that into an `ExecutionResult` (`types.ts:47-64`) and wraps it in `ok(...)`:

```ts
return ok({
  stdout,
  stderr,
  exitCode,
  timedOut,
  durationMs,
  // reconstructedText: UNSET   — plain-text agent, no stream to reconstruct (REQ-OBS-02)
  // parsedSignal:      UNSET   — runner parses RAUF_* from raw stdout (REQ-SIG-02)
  // progressEvents:    UNSET   — no tool/token telemetry for plain-text agents (REQ-OBS-02)
});
```

Leaving `reconstructedText` unset is what makes the runner's signal fallback
`signalText = reconstructedText?.length ? reconstructedText : stdout` (`runner.ts:644`,
`05-runner-wiring.md`) parse the **raw stdout** — the plain-text signal path (REQ-SIG-02). The
absent `progressEvents`/`reconstructedText` are the "telemetry gracefully absent" guarantee: the
runner emits only spawn+exit lifecycle for these agents and treats the absence as normal, never an
error (REQ-OBS-02). `parsesStream` on the config is `false`/omitted (`00-core-definitions.md §3.2`),
so `execute` never requests stream-json and never constructs a `StreamParser`.

A nonzero `exitCode` and `timedOut: true` are **data, not errors** — they flow back so the runner's
`classifyExit` (`exit-classifier.ts`, `05-runner-wiring.md`) maps them into the existing
`ExitClass` vocabulary uniformly (REQ-EXEC-03). `execute` returns `err(...)` only when the process
could not be spawned at all (§8).

### 4.5 `execute` algorithm (concrete)

```ts
async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>> {
  const delivery = this.config.promptDelivery;

  let promptFile: string | undefined;
  if (delivery === "file") {
    const written = await writePromptToSandboxTempFile(prompt); // cwd === ROOT_DIRECTORY
    if (!written.ok) return written;                            // spawn-side IO error -> Result err
    promptFile = written.value;
  }

  try {
    const ctx: BuildArgsContext = { model: options.model, promptFile };
    const argv = [
      ...this.config.buildArgs(ctx),
      ...this.config.nonInteractive,
      ...(options.model && this.config.modelFlag ? this.config.modelFlag(options.model) : []),
    ];
    if (delivery === "arg") argv.push(prompt);

    const res = await spawnProcessGroup(this.config.binary, argv, {
      timeoutMs: options.timeoutMinutes * 60 * 1000,
      signal: options.signal,
      // Runner-supplied child env (options.env, e.g. REVIEW_HOOK_SUPPRESSION_ENV) is merged
      // OVER the adapter's static config.env so the runner's childEnv reaches every agent
      // uniformly (see 00 §7 ExecuteOptions extension + 05-runner-wiring.md §childEnv).
      env:
        this.config.env || options.env
          ? { ...this.config.env, ...options.env }
          : undefined,
      stdin: delivery === "stdin" ? prompt : undefined,
    });
    if (!res.ok) return res; // spawn failure -> err (§8)

    const { exitCode, stdout, stderr, timedOut, durationMs } = res.value;
    return ok({ stdout, stderr, exitCode, timedOut, durationMs });
  } finally {
    if (promptFile) await unlinkBestEffort(promptFile); // never throws (§4.3)
  }
}
```

(`writePromptToSandboxTempFile` and `unlinkBestEffort` are small private helpers in
`cli-agent.ts`; the temp-file path rules are §4.3.)

## 5. Shared process-group helper (`process-group.ts`)

Tech-spec §10 and `01-architecture-layout.md §2` lean **extraction** to avoid duplicating the
kill/timeout/group logic between `claude-process.ts` and `CliAgent`. This document **adopts
extraction**: the spawn/timeout/group-kill/abort machinery currently inlined in `spawnClaude`
(`claude-process.ts:38-51` + `:101-233`) moves into a new reusable `process-group.ts`. Rationale:
SC-2 demands the claude path is behaviorally identical, and two divergent copies of a
SIGTERM→grace→SIGKILL routine is exactly the kind of drift that breaks that guarantee; one helper
keeps them in lockstep (REQ-PERF-01 / maintainability).

### 5.1 Signatures

```ts
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { ok, err, ErrorCodes } from "@rauf/core";
import type { Result } from "@rauf/core";

/** Grace period between SIGTERM and SIGKILL (moved from claude-process.ts:9). */
export const GRACE_PERIOD_MS = 30_000;

/** Options for {@link spawnProcessGroup}. */
export interface SpawnProcessGroupOptions {
  /** Hard timeout in milliseconds. On expiry: SIGTERM → GRACE_PERIOD_MS → SIGKILL on the group. */
  timeoutMs: number;
  /** External cancellation. On abort the process group receives SIGTERM. */
  signal?: AbortSignal;
  /** Env overrides merged over `process.env`; when omitted the child inherits the parent env. */
  env?: Record<string, string>;
  /** When set, written to the child's stdin then closed (EPIPE ignored). Omit for no stdin input. */
  stdin?: string;
  /**
   * Optional per-stdout-chunk hook (used by claude-process for stream parsing). `CliAgent` does
   * NOT pass this — it consumes only the final aggregated `stdout` (plain-text path, REQ-OBS-02).
   */
  onStdout?: (chunk: Buffer) => void;
}

/** Aggregated outcome of a spawned process group. */
export interface ProcessGroupResult {
  /** Process exit code (the close-event code, defaulting to 1 when null). */
  exitCode: number;
  /** Full captured stdout (UTF-8). */
  stdout: string;
  /** Full captured stderr (UTF-8). */
  stderr: string;
  /** True when the process was terminated by the timeout. */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/**
 * Spawn `cmd args` as a detached process group, capture stdout/stderr, enforce a timeout with a
 * SIGTERM→grace→SIGKILL escalation on the whole group (negative PID), and honor an AbortSignal.
 * Resolves with `ok(ProcessGroupResult)` on any process exit (including nonzero / timeout), or
 * `err(FILE_NOT_FOUND)` when the binary cannot be spawned (ENOENT / synchronous spawn throw).
 * Never throws for expected errors (CLAUDE.md).
 */
export function spawnProcessGroup(
  cmd: string,
  args: string[],
  options: SpawnProcessGroupOptions,
): Promise<Result<ProcessGroupResult>>;

/** Send a signal to the process group (negative PID), falling back to the bare pid. */
export function killTree(proc: ChildProcess, signal: NodeJS.Signals): void;
```

### 5.2 Behavior (verbatim from the existing claude code, generalized)

The helper reproduces, exactly, the resolved-guard / chunk-capture / timer / abort / kill behavior
of `spawnClaude` (`claude-process.ts:101-233`), with two generalizations:

1. `cmd`/`args` are parameters instead of the hardcoded `"claude"` + its fixed flags.
2. stdin and the stdout hook are optional (claude always pipes a prompt + a parser hook; `CliAgent`
   passes stdin only for `stdin` delivery and never a hook).

Specifically it MUST preserve: `detached: true` (`:89`); `stdio: ["pipe","pipe","pipe"]` (`:88`); the
env-merge-only-when-supplied behavior (`:92`); the synchronous spawn try/catch returning
`err(FILE_NOT_FOUND)` (`:94-99`); the async `proc.on("error", …)` returning `err(FILE_NOT_FOUND)`
(`:176-186`); the single-`resolved` guard (`:102`,`:128`); SIGTERM-then-grace-then-SIGKILL on the
group (`:162-168`); abort → group SIGTERM, including the already-aborted-at-call case
(`:170-173`,`:226-232`); EPIPE-tolerant stdin write/end (`:214-218`); and `exitCode = code ?? 1`
on `close` (`:209-211`).

### 5.3 `claude-process.ts` refactor (SC-2)

`claude-process.ts` is refactored to **delegate** to `spawnProcessGroup` while keeping its public
`spawnClaude(prompt, SpawnClaudeOptions): Promise<Result<SpawnClaudeResult>>` signature and behavior
byte-for-byte:

- `spawnClaude` still builds the claude-specific argv
  (`["-p","--dangerously-skip-permissions","--output-format", format]`, `+ "--verbose"` for
  stream-json, `+ "--model", model`, `:72-80`), and still owns the `StreamParser` /
  `reconstructedText` reconstruction (`:111-149`).
- The stream line-splitting that was inline in the stdout handler (`:189-202`) is wired via the new
  `onStdout` hook: `spawnClaude` passes `onStdout: (chunk) => { /* feed line-splitter + parser */ }`.
- The timeout/kill/group/abort/stdin plumbing (`:154-233`) is **removed** from `spawnClaude` and
  provided by `spawnProcessGroup`. `GRACE_PERIOD_MS` and `killTree` are imported from
  `process-group.ts` (no longer declared in `claude-process.ts`).
- `SpawnClaudeResult` is assembled from the helper's `ProcessGroupResult` plus the parser's
  `reconstructedText`.

This is a pure internal refactor — no caller of `spawnClaude` (`providers/claude-cli.ts:14`, the
`index.ts:12` re-export) sees any change, and all existing claude sandbox scenarios must pass
unchanged (SC-2).

> **Alternative considered (rejected): keep the logic inline in `claude-process.ts` and have
> `CliAgent` import a non-extracted helper from it.** That couples a generic engine to the
> claude-specific module and leaves the kill/timeout routine without a clear home. Extraction into
> `process-group.ts` is the layout shown in `01-architecture-layout.md §2` and is preferred.

## 6. Presets (`providers/presets.ts`) — `CliAgentConfig` literals

Each preset is a `CliAgentConfig` literal (REQ-ADP-03). They are plain data — the engine (§3.1,
§4) is identical for all of them. `parsesStream` is omitted (⇒ plain-text, REQ-OBS-02). `displayName`
strings are illustrative.

```ts
import type { CliAgentConfig } from "./cli-agent.js";

const codex: CliAgentConfig = {
  id: "codex",
  displayName: "OpenAI Codex (CLI)",
  binary: "codex",
  promptDelivery: "arg",                       // prompt appended as final argv element (§4.3)
  buildArgs: () => ["exec"],                    // non-interactive exec subcommand
  nonInteractive: ["--full-auto"],             // auto-approve (REQ-EXEC-01) — VERIFY (§ WARNING)
  modelFlag: (m) => ["--model", m],            // REQ-MODEL-01/02
};

const gemini: CliAgentConfig = {
  id: "gemini",
  displayName: "Google Gemini (CLI)",
  binary: "gemini",
  promptDelivery: "stdin",                      // prompt piped to stdin (§4.3)
  buildArgs: () => [],
  nonInteractive: ["--yolo"],                   // auto-approve — VERIFY
  modelFlag: (m) => ["-m", m],
};

const copilot: CliAgentConfig = {
  id: "copilot",
  displayName: "GitHub Copilot (CLI)",
  binary: "copilot",
  promptDelivery: "stdin",
  buildArgs: () => [],
  nonInteractive: ["--allow-all-tools"],        // best-known, TBD — VERIFY
  modelFlag: (m) => ["--model", m],
};

const cursor: CliAgentConfig = {
  id: "cursor",
  displayName: "Cursor Agent (CLI)",
  binary: "cursor-agent",                       // NOTE: binary name differs from id
  promptDelivery: "arg",
  buildArgs: () => [],
  nonInteractive: ["--force"],                  // non-interactive — VERIFY
  modelFlag: (m) => ["--model", m],
};

export const PRESET_CONFIGS: readonly CliAgentConfig[] = [codex, gemini, copilot, cursor];

export function getPresetConfig(id: string): CliAgentConfig | undefined {
  return PRESET_CONFIGS.find((c) => c.id === id);
}
```

This is the tech-spec §3.4 table, made executable:

| id      | binary         | prompt via | non-interactive (best-known) | model flag      |
|---------|----------------|------------|------------------------------|-----------------|
| codex   | `codex`        | arg        | `--full-auto` / `exec`       | `--model <m>`   |
| gemini  | `gemini`       | stdin      | `--yolo`                     | `-m <m>`        |
| copilot | `copilot`      | stdin      | `--allow-all-tools` (tbd)    | `--model <m>`   |
| cursor  | `cursor-agent` | arg        | `--force` / non-interactive  | `--model <m>`   |

> **WARNING (OQ-2) — verify before shipping.** The non-interactive and model flags above are
> **best-known** and MUST be confirmed against each installed CLI's actual version at implementation
> time. They are **correctable config literals** — wrong flags are fixed by editing this file, with
> **no engine code change** (REQ-SCALE-01). SC-1 proves the *mechanism* (plain-text agent reaches
> `RAUF_DONE`, telemetry gracefully absent) using mock agents in `test-sandbox/`, **not** the exact
> real flags. If, when implementing, an export/flag cannot be confirmed for an agent, leave the
> best-known literal and annotate it inline rather than guessing silently. (See
> `07-testing-strategy.md` for the mock agents that exercise these presets.)

## 7. `generic-cli` & arbitrary named agents (`providers/generic-cli.ts`)

Both paths below use the **same `CliAgent` engine** (§3.1) — there is one resolution rule with two
config sources (tech-spec §3.4). Adding any new agent is therefore: (a) a preset literal (§6), (b) a
`ToolConfig.providers` entry, or (c) a marker `providerConfig` — and **the runner orchestration
never changes** (REQ-SCALE-01).

### 7.1 Case 1 — arbitrary named agent (`ToolConfig.providers[<id>]`)

When `--agent <id>` names an `<id>` that matches a key in `ToolConfig.providers[<id>]`
(project/global config; `core/schemas.ts:223`), the selection layer (`04-agent-selection.md`) builds
a `CliAgent` from that config entry via `configToCliAgentConfig(id, raw)`. Because the entry carries
its own `binary`, the **descriptor** for such an agent has a real `binaryName` (taken from the
config), so the registry's default PATH probe detects it normally
(`02-agent-registry-and-detection.md`, satisfying REQ-DET-01 for config-driven agents). This is the
primary "add an agent without code" path (REQ-ADP-04, REQ-SCALE-01).

### 7.2 Case 2 — reserved `generic-cli` id (marker `providerConfig`)

The literal id `generic-cli` (`GENERIC_AGENT_ID`, `00-core-definitions.md §6`) is a **single
built-in adapter** whose `CliAgentConfig` comes from `MarkerOptions.providerConfig` (the per-run
marker; `core/schemas.ts:149`, typed `z.record(z.string(), z.unknown()).optional()`). Its binary is
not known until that marker config is read, so:

- Its **descriptor omits `binaryName`** and supplies a **custom `detect`** that resolves the binary
  from the supplied `providerConfig` at probe time, falling back to "available / unknown" when no
  config is present rather than failing enumeration (full rule in
  `02-agent-registry-and-detection.md`, per `00-core-definitions.md §3.3`).
- Its factory builds the `CliAgent` from the `config` argument the registry/runner passes in
  (the `providerConfig` record). The factory is a `ProviderFactory`
  (`(config?: Record<string, unknown>) => LLMProvider`, `types.ts:81-82`).

```ts
import { CliAgent } from "./cli-agent.js";
import { GENERIC_AGENT_ID } from "../agent-selection.js"; // re-exports 00 §6 constant (01 §4)
import type { ProviderFactory } from "./types.js";

export const createGenericCliProvider: ProviderFactory = (config) => {
  const parsed = configToCliAgentConfig(GENERIC_AGENT_ID, config ?? {});
  if (!parsed.ok) {
    // Misconfigured generic-cli is surfaced as an expected error by the caller; the factory
    // itself throws here only as the inherited createProvider contract (registry.ts:14) — the
    // runner's per-iteration resolve wraps createProvider in try/catch (05-runner-wiring.md §8).
    throw new Error(parsed.error.message);
  }
  return new CliAgent(parsed.value);
};
```

### 7.3 `configToCliAgentConfig` — record → validated config

`configToCliAgentConfig(id, raw)` normalizes an untyped config record (marker `providerConfig` or a
`ToolConfig.providers[id]` entry) into a `CliAgentConfig`, returning a `Result` so a malformed entry
is an expected error (§8), not a crash. It MUST:

- require `binary: string` (non-empty) — else `err(VALIDATION_ERROR)` naming the missing/invalid field;
- accept `args: string[]` (default `[]`) and build `buildArgs: () => args` (a static arg list);
  generic configs use a static arg vector, since they cannot supply a closure through JSON;
- accept `promptDelivery: PromptDelivery` (default `"stdin"`); reject any value outside
  `"stdin" | "arg" | "file"`;
- accept `nonInteractive: string[]` (default `[]`);
- accept an optional `modelFlagTemplate: string` (e.g. `"--model"`) and, when present, build
  `modelFlag: (m) => [modelFlagTemplate, m]`; when absent, omit `modelFlag` (agent default model,
  REQ-MODEL-02);
- accept optional `env: Record<string,string>`;
- set `displayName` from `raw.displayName` (string) or default to the `id`;
- never set `parsesStream` to anything but `false`/omitted (plain-text only, REQ-OBS-02).

```ts
export function configToCliAgentConfig(
  id: string,
  raw: Record<string, unknown>,
): Result<CliAgentConfig> {
  const binary = raw.binary;
  if (typeof binary !== "string" || binary.length === 0) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `generic agent "${id}" config is missing a non-empty "binary" field`,
    });
  }
  const promptDelivery = (raw.promptDelivery ?? "stdin") as PromptDelivery;
  if (!["stdin", "arg", "file"].includes(promptDelivery)) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `generic agent "${id}" has invalid promptDelivery "${String(raw.promptDelivery)}"`,
    });
  }
  const args = Array.isArray(raw.args) ? (raw.args as string[]) : [];
  const nonInteractive = Array.isArray(raw.nonInteractive) ? (raw.nonInteractive as string[]) : [];
  const mft = typeof raw.modelFlagTemplate === "string" ? raw.modelFlagTemplate : undefined;
  const env =
    raw.env && typeof raw.env === "object" ? (raw.env as Record<string, string>) : undefined;

  return ok({
    id,
    displayName: typeof raw.displayName === "string" ? raw.displayName : id,
    binary,
    buildArgs: () => [...args],
    promptDelivery,
    nonInteractive,
    ...(mft ? { modelFlag: (m: string) => [mft, m] } : {}),
    ...(env ? { env } : {}),
  });
}
```

> Malformed input uses `ErrorCodes.VALIDATION_ERROR` — confirmed against `packages/core/src/errors.ts:21-32`
> (members: `FILE_NOT_FOUND`, `INVALID_JSON`, `VALIDATION_ERROR`, `PATH_VIOLATION`, `ALREADY_INSTALLED`,
> `NOT_INSTALLED`, `CONFLICT`, `TRANSITION_INVALID`, `LOCK_CONFLICT`, `IO_ERROR`; there is **no**
> `INVALID_INPUT`). The shape (`{ code, message }` carried by `Result`, per `00-core-definitions.md §5`)
> is fixed.

### 7.4 Example — a generic agent via marker `providerConfig`

```jsonc
// .rauf marker fragment — drives the reserved "generic-cli" adapter, no rauf code change
{
  "provider": "generic-cli",
  "providerConfig": {
    "binary": "my-agent",
    "args": ["run", "--headless"],
    "promptDelivery": "stdin",
    "nonInteractive": ["--auto-approve"],
    "modelFlagTemplate": "--model"
  }
}
```

## 8. Error handling

No throwing for expected errors (CLAUDE.md, `00-core-definitions.md §5`). Per operation:

| Situation | Where | Result | REQ |
|---|---|---|---|
| Agent binary cannot be spawned (ENOENT / synchronous spawn throw) | `spawnProcessGroup` | `err({ code: FILE_NOT_FOUND, message: "Failed to spawn <binary>: …" })`, propagated by `CliAgent.execute` | REQ-EXEC-02 |
| Agent exits nonzero | `CliAgent.execute` | `ok(ExecutionResult)` with that `exitCode` — **not** an error; runner classifies via `classifyExit` (`05`) | REQ-EXEC-03 |
| Timeout (process killed) | `spawnProcessGroup` | `ok(ExecutionResult)` with `timedOut: true`; group SIGTERM→30s→SIGKILL | REQ-EXEC-02 |
| Abort/cancel (`options.signal`) | `spawnProcessGroup` | group receives SIGTERM; resolves with whatever was captured | REQ-EXEC-02 |
| Missing telemetry (plain-text) | `CliAgent.execute` | `reconstructedText`/`progressEvents` simply unset — **not an error** | REQ-OBS-02 |
| Usage check requested | n/a | `CliAgent` defines no `checkUsage`; runner skips usage paths cleanly | REQ-USAGE-02 |
| Temp prompt-file write fails (file delivery) | `CliAgent.execute` | `err({ code: <IO/FILE code>, … })` before spawn | REQ-SEC-01 |
| Temp prompt-file unlink fails (cleanup) | `CliAgent.execute` `finally` | swallowed (best-effort) — never fails the iteration | — |
| Malformed generic/named config | `configToCliAgentConfig` | `err({ code: VALIDATION_ERROR, message })` naming the bad field | REQ-ADP-04 |
| Unknown generic config at factory time | `createGenericCliProvider` | throws (inherited `createProvider` contract); runner's per-iteration resolve wraps it (`05`) | REQ-DISC-01 |

`CliAgent` never `dispose`s anything (no persistent resource); temp files are cleaned inline (§4.3).

## 9. Verification checklist

- [ ] `CliAgent` is declared in `providers/cli-agent.ts`, `implements LLMProvider`, and exposes
  exactly `id`, `displayName`, `execute`, `validateCredentials` — **no `checkUsage`, no `dispose`**.
- [ ] `CliAgent` does not redefine `CliAgentConfig` / `PromptDelivery` / `BuildArgsContext` beyond
  the declarations from `00-core-definitions.md §3.2` (which live in this file).
- [ ] `execute` assembles argv in the order `buildArgs → nonInteractive → modelFlag` and appends the
  prompt as the final arg only for `promptDelivery === "arg"` (§4.1, §4.3).
- [ ] No model flag is passed when `options.model` is unset **or** `config.modelFlag` is omitted
  (REQ-MODEL-02); resolved model is otherwise translated via `modelFlag` (REQ-MODEL-01).
- [ ] `config.nonInteractive` is always present in the argv (REQ-EXEC-01).
- [ ] `stdin` delivery pipes the prompt to the child and closes it; `file` delivery writes a temp
  file **inside `ROOT_DIRECTORY`**, passes its path via `ctx.promptFile`, and unlinks it in
  `finally` on every exit path (REQ-SEC-01).
- [ ] Returned `ExecutionResult` leaves `reconstructedText`, `parsedSignal`, and `progressEvents`
  **unset**; nonzero exit and timeout are returned as data, not errors (REQ-OBS-02, REQ-SIG-02,
  REQ-EXEC-03).
- [ ] `process-group.ts` exists, exports `spawnProcessGroup`, `killTree`, `GRACE_PERIOD_MS`, and
  reproduces the `claude-process.ts` spawn/timeout/group-kill/abort behavior (detached group,
  SIGTERM→30s→SIGKILL on negative PID, EPIPE-tolerant stdin) (REQ-EXEC-02).
- [ ] `claude-process.ts` delegates to `spawnProcessGroup` and `spawnClaude`'s public signature +
  behavior are unchanged; all existing claude sandbox scenarios pass (SC-2).
- [ ] `presets.ts` exports `PRESET_CONFIGS` (codex/gemini/copilot/cursor) and `getPresetConfig`;
  cursor's `binary` is `cursor-agent` (REQ-ADP-03).
- [ ] The OQ-2 WARNING (§6) is present and the preset flags match the tech-spec §3.4 table.
- [ ] `generic-cli.ts` exports `createGenericCliProvider` (a `ProviderFactory`) and
  `configToCliAgentConfig`; both the named-agent (case 1) and reserved-`generic-cli` (case 2) paths
  build a `CliAgent` with no engine change (REQ-ADP-04, REQ-SCALE-01).
- [ ] `configToCliAgentConfig` returns `Result`, rejecting a missing `binary` and an invalid
  `promptDelivery` with an expected error (no throw) (§8).
- [ ] A mock plain-text agent driven through `CliAgent` reaches `RAUF_DONE` with telemetry absent
  and no error raised — exercised in `07-testing-strategy.md` (SC-1).
- [ ] `pnpm build && pnpm gate` is green (SC-7).
