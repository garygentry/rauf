# API Reference

All symbols are exported from the `@rauf/loop` package barrel. Signatures below are taken
from the implementation (`packages/loop/src/providers/*`, `packages/loop/src/agent-selection.ts`,
`packages/loop/src/constants.ts`).

## Constants

```typescript
import { DEFAULT_AGENT_ID, GENERIC_AGENT_ID } from "@rauf/loop";

DEFAULT_AGENT_ID; // "claude-cli" — the agent used when nothing is selected
GENERIC_AGENT_ID; // "generic-cli" — the reserved configurable adapter id
```

## Adapter contract

### `interface LLMProvider` (alias `AgentAdapter`)

The per-iteration contract. `AgentAdapter` is a type alias of `LLMProvider`.

```typescript
interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>>;
  checkUsage?(): Promise<UsageLimitResult>;
  validateCredentials(): Result<void>;
  dispose?(): Promise<void>;
}
```

### `interface ExecuteOptions`

```typescript
interface ExecuteOptions {
  model?: string;
  timeoutMinutes: number;
  signal?: AbortSignal;
  onProgress?: (event: ProviderProgressEvent) => void;
  outputFormat?: "text" | "stream-json";
  onStreamEvent?: (event: ClaudeStreamEvent) => void;
  /** Env overrides for the agent's child process, merged over process.env (SC-2). */
  env?: Record<string, string>;
}
```

- `env` — the runner passes its resolved `childEnv` here. `ClaudeCliProvider` forwards it
  to `spawnClaude`; `CliAgent` merges it **over** `CliAgentConfig.env`. Omitted ⇒ the child
  inherits the parent env unchanged.

### `interface ExecutionResult`

```typescript
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  parsedSignal?: ParsedSignal; // SDK/stream providers only
  progressEvents?: ProviderProgressEvent[]; // SDK/stream providers only
  reconstructedText?: string; // set only for outputFormat: 'stream-json'
}
```

`CliAgent` leaves the last three unset (plain-text mode).

### `interface DetectionResult`

```typescript
interface DetectionResult {
  available: boolean;
  detail?: string; // e.g. "found at /usr/local/bin/codex" or "binary 'codex' not found on PATH"
}
```

## Registry

### `interface AgentDescriptor`

```typescript
interface AgentDescriptor {
  id: string;
  displayName: string;
  binaryName?: string; // omitted only for generic-cli (binary unknown until config)
  factory: ProviderFactory; // (config?: Record<string, unknown>) => LLMProvider
  detect?: () => Promise<DetectionResult>; // defaults to PATH probe of binaryName
}
```

### `interface AgentAvailability`

```typescript
interface AgentAvailability {
  id: string;
  displayName: string;
  binaryName?: string;
  available: boolean;
  detail?: string;
}
```

### `registerAgent(d: AgentDescriptor): void`

Register an agent via its full descriptor (canonical write path). Populates both the
factory and descriptor maps. Last write wins.

```typescript
import { registerAgent, CliAgent } from "@rauf/loop";

registerAgent({
  id: "mytool",
  displayName: "My Tool",
  binaryName: "mytool",
  factory: () =>
    new CliAgent({
      /* CliAgentConfig */
    } as never),
});
```

### `registerProvider(id: string, factory: ProviderFactory): void`

Existing surface (unchanged signature). Populates the factory map and **synthesizes** a
default descriptor (id used for `displayName`/`binaryName`) so legacy-registered providers
stay enumerable and probeable. A later `registerAgent` for the same id overwrites it.

### `createProvider(id: string, config?: Record<string, unknown>): LLMProvider`

Construct an adapter by id from its registered factory. **Throws** if the id is unknown or
the factory rejects the config (the runner's per-iteration resolve wraps the throw).

### `getAgentDescriptors(): AgentDescriptor[]`

Every registered descriptor. Pure read — constructs nothing, does no I/O.

### `detectAgent(id: string): Promise<DetectionResult>`

Probe one agent's availability via its descriptor's `detect`. **Never rejects** — an
unknown id returns `{ available: false, detail }`.

### `listAgents(): Promise<AgentAvailability[]>`

Enumerate every agent with its live availability (runs each descriptor's `detect`). **Never
rejects**; unavailable agents are data, not errors. Backs `rauf agents`.

### Also exported

`getAvailableProviders(): string[]`, `clearProviders(): void` (test helper),
`probeBinaryOnPath(binaryName): Promise<DetectionResult>` (exported within the package for
reuse by `generic-cli`'s custom `detect`; not part of the intended public surface).

## The `CliAgent` engine

### `interface CliAgentConfig`

```typescript
interface CliAgentConfig {
  id: string;
  displayName: string;
  binary: string;
  buildArgs(ctx: BuildArgsContext): string[]; // no prompt, no model flags
  promptDelivery: PromptDelivery; // 'stdin' | 'arg' | 'file'
  nonInteractive: string[]; // always appended (REQ-EXEC-01)
  modelFlag?(model: string): string[]; // omitted ⇒ agent default model
  env?: Record<string, string>; // merged under options.env
  parsesStream?: false; // CliAgent is plain-text only
}

type PromptDelivery = "stdin" | "arg" | "file";
interface BuildArgsContext {
  model?: string;
  promptFile?: string;
}
```

### `class CliAgent implements LLMProvider`

```typescript
import { CliAgent } from "@rauf/loop";

const agent = new CliAgent({
  id: "codex",
  displayName: "Codex CLI",
  binary: "codex",
  promptDelivery: "arg",
  buildArgs: () => ["exec"],
  nonInteractive: ["--full-auto"],
  modelFlag: (m) => ["--model", m],
});
```

Implements only `id`, `displayName`, `execute`, `validateCredentials` (no `checkUsage`, no
`dispose` — both omissions are intentional).

## Presets

### `PRESET_CONFIGS: readonly CliAgentConfig[]`

The four shipped configs: `codex`, `gemini`, `copilot`, `cursor`.

### `getPresetConfig(id: string): CliAgentConfig | undefined`

```typescript
import { getPresetConfig } from "@rauf/loop";
const codex = getPresetConfig("codex"); // CliAgentConfig | undefined
```

## Generic CLI adapter

### `configToCliAgentConfig(id: string, raw: Record<string, unknown>): Result<CliAgentConfig>`

Normalize an untyped config record into a validated `CliAgentConfig`. Returns
`err(VALIDATION_ERROR)` for a missing/empty `binary` or an invalid `promptDelivery`.
Defaults: `args` → `[]`, `promptDelivery` → `'stdin'`, `nonInteractive` → `[]`; an optional
`modelFlagTemplate` string becomes the `modelFlag`.

```typescript
import { configToCliAgentConfig } from "@rauf/loop";

const res = configToCliAgentConfig("mytool", {
  binary: "mytool",
  promptDelivery: "stdin",
  args: ["run"],
  nonInteractive: ["--yes"],
  modelFlagTemplate: "--model",
});
if (res.ok) {
  // res.value is a CliAgentConfig
}
```

### `createGenericCliProvider: ProviderFactory`

Factory for the reserved `generic-cli` agent. Builds a `CliAgent` from the per-run
`providerConfig`. **Throws** on a malformed config (the `createProvider` contract).

## Selection helpers

### `resolveAgentId(input): string`

```typescript
import { resolveAgentId } from "@rauf/loop";

const id = resolveAgentId({
  itemProvider, // backlog item — highest precedence
  runProvider, // --agent / detached server body
  projectProvider, // .rauf.json
  globalProvider, // ~/.rauf/config.json
}); // → first non-empty, else DEFAULT_AGENT_ID. Pure, total, never throws.
```

### `normalizeAgentAlias(raw, onWarn?)`

```typescript
import { normalizeAgentAlias } from "@rauf/loop";

const out = normalizeAgentAlias({ agent: "codex" }); // → { provider: 'codex' }
normalizeAgentAlias({ provider: "codex", agent: "gemini" }, console.warn);
//                  → { provider: 'codex' }  (provider wins; warns; agent dropped)
```

Run this **before** schema validation. The persisted key is always `provider`.

## CLI surface

### `rauf loop run . --agent <id>`

Selects the agent that drives iterations (default `claude-cli`). The `--help` text
enumerates the supported ids from `getAgentDescriptors()`. Live availability is the job of
`rauf agents`, never the help text.

### `rauf agents [--json]`

Lists every registered agent and whether its CLI/credentials are available on this machine
(via `listAgents()`). Never fails on an unavailable agent — unavailability is reported as
data. `--json` emits `{ "agents": AgentAvailability[] }`.
