# Agent CLI Adapters

Rauf's loop runner is **agent-agnostic**: each iteration is driven by a pluggable
*agent adapter* rather than a hardcoded `claude` subprocess. This feature wires the
runner to a provider seam, adds a config-driven engine that can drive any non-Claude
coding-agent CLI (Codex, Gemini, Copilot, Cursor, or an arbitrary `generic-cli`), and
exposes agent selection through `--agent`, `.rauf.json`, and per-item config.

The default agent is unchanged: with no selection, the loop runs `claude-cli` exactly
as before.

> **Vocabulary.** Internally the code says `provider` / `LLMProvider`; the
> epic-`agent-agnostic` contract surface says `agent` / `AgentAdapter`. `AgentAdapter`
> is a type alias of `LLMProvider` — they are the same shape. The user-facing key is
> `agent` (an input alias); the persisted/canonical key is `provider`.

## Quick Start

Run the loop with a specific agent:

```bash
# Default — Claude Code CLI (unchanged behavior)
rauf loop run .

# Drive iterations with a different agent's CLI
rauf loop run . --agent codex
rauf loop run . --agent gemini
```

See which agents are registered and which are actually installed on this machine:

```bash
rauf agents
# Claude Code (CLI)    claude-cli   available    (credentials found)
# Codex CLI            codex        available    (found at /usr/local/bin/codex)
# Gemini CLI           gemini       unavailable  (binary 'gemini' not found on PATH)
# ...
rauf agents --json     # same data, machine-readable
```

Pin an agent per backlog item (highest precedence) in `backlog.json`:

```json
{ "id": "042", "title": "…", "provider": "codex" }
```

Or set a project default in `.rauf.json` (the `agent` alias folds onto `provider`):

```json
{ "agent": "codex" }
```

## Key Concepts

- **Agent adapter (`AgentAdapter` = `LLMProvider`)** — the per-iteration contract: given
  a prompt, spawn the agent, deliver the prompt, collect plain-text output, and return a
  resolved `ExecutionResult`. Claude has its own adapter (`claude-cli`); every other CLI
  agent is driven by one shared engine.
- **`CliAgent` engine** — a single config-driven class that backs every non-Claude agent.
  It carries **no** agent-specific knowledge; all invocation details (binary, args, prompt
  delivery, non-interactive flags, model flag) come from a plain-data `CliAgentConfig`.
- **Presets** — four shipped `CliAgentConfig`s (`codex`, `gemini`, `copilot`, `cursor`)
  registered at import time.
- **`generic-cli`** — a reserved adapter built at run time from a `providerConfig` you
  supply, so you can drive an unlisted CLI without writing code.
- **Descriptor registry** — every agent is registered as an `AgentDescriptor`, making the
  full set *enumerable* (for `--help` / `rauf agents`) and *probeable* (PATH/credential
  detection) without constructing a provider or reading run config.
- **Selection** — `resolveAgentId` collapses four precedence layers (item → run →
  project → global → default) into the single id that drives an iteration.

## Package Exports

All symbols are exported from the `@rauf/loop` package barrel (and its `providers`
subpath). There is **no** `exports` map change — the package keeps its single
`main`/`types` entry.

| Export | Description |
|---|---|
| `AgentAdapter`, `LLMProvider`, `ExecuteOptions`, `ExecutionResult` | The per-iteration adapter contract and its I/O types |
| `AgentDescriptor`, `DetectionResult`, `AgentAvailability` | Registry descriptor + availability-probe results |
| `registerAgent`, `registerProvider`, `createProvider` | Registration + construction |
| `getAgentDescriptors`, `listAgents`, `detectAgent` | Enumeration + availability probing |
| `CliAgent`, `CliAgentConfig`, `PromptDelivery`, `BuildArgsContext` | The config-driven engine |
| `PRESET_CONFIGS`, `getPresetConfig` | The four shipped presets |
| `createGenericCliProvider`, `configToCliAgentConfig` | The reserved `generic-cli` adapter |
| `resolveAgentId`, `normalizeAgentAlias` | Pure selection + alias-fold helpers |
| `DEFAULT_AGENT_ID` (`"claude-cli"`), `GENERIC_AGENT_ID` (`"generic-cli"`) | Reserved ids |

## When to use

- **`--agent <preset>`** — drive the loop with one of the four shipped CLIs.
- **`generic-cli` + `providerConfig`** — drive an unlisted CLI agent without code.
- **A full custom adapter (`registerAgent`)** — only when an agent needs behavior the
  declarative `CliAgentConfig` cannot express (e.g. streaming/usage telemetry, SDK calls).

## When NOT to use

- Don't add a new preset/adapter just to change *flags or model* for an existing agent —
  use `generic-cli` config or the model precedence instead.
- Don't reach for `CliAgent` to drive Claude — `claude-cli` has its own adapter with
  stream parsing and usage gating that `CliAgent` deliberately omits.

## Further Reading

- [Architecture](./architecture.md) — the registry/detection/engine design, runner wiring,
  the SC-2 env contract, and REQ-SEC-02 signal neutralization
- [API Reference](./api-reference.md) — every exported type and function with signatures
- [Adding an Agent](./guides/adding-an-agent.md) — preset vs `generic-cli` vs full adapter
