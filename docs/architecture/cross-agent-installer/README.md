# Cross-Agent Installer

A zero-dependency, `npx`-style installer that drops the **feature-forge** skill suite
into whichever coding agents are present on a machine — Claude Code, Codex, Copilot,
Cursor, and Gemini — and provisions the **rauf** loop runner alongside them.

It detects the agents you actually have, plans exactly what it would change, applies
the change atomically into a self-contained `feature-forge/` namespace under each
agent's config directory, and records a manifest so a later `update` or `uninstall`
touches **only** the files it installed. Every run is safe to repeat.

> **Where the code lives.** The installer ships in the `feature-forge` repo at
> `installer/` (a standalone TypeScript/Node package, bin name `feature-forge`,
> zero runtime dependencies, `node >= 18`). The adapter bundles it installs are
> produced by the sibling [`forge-agent-adapters-build`](../forge-agent-adapters-build/)
> feature and consumed **read-only**.

## Quick Start

```bash
# Install into every detected agent (project-local), with a plan you can see first
npx feature-forge install --dry-run     # show the plan, change nothing
npx feature-forge install -y            # apply it (non-interactive)

# Scope to one agent, or to the user-level config dir
npx feature-forge install -a claude
npx feature-forge install --global

# See per-agent status (detected / installed / up-to-date / drifted)
npx feature-forge list
npx feature-forge list --json           # machine-readable

# Reconcile an existing install to the current bundles, or remove it
npx feature-forge update
npx feature-forge uninstall
```

## Key Concepts

- **Agents.** The five supported targets are `claude`, `codex`, `copilot`, `cursor`,
  `gemini` (the canonical `AGENT_IDS` order). Detection probes each agent's config
  directory; nothing is installed for an agent that isn't present. _Zero detected is
  success, not failure_ — a fresh machine with no agents exits cleanly.
- **Scope.** `project` (default — installs into the repo-local config dir) or
  `global` (`--global`, the user-level config dir). Each scope has its own manifest,
  so project and global installs never collide.
- **Mode.** `copy` (default — per-file copy) or `symlink` (`--symlink` — links the
  whole namespace directory at the source bundle). Symlink mode keeps an install
  live-synced to the source checkout; copy mode is self-contained.
- **Namespace + manifest.** Files land under a `feature-forge/` subtree inside the
  agent's install dir, and a sibling manifest `.feature-forge.<scope>.json` records
  every installed path with its SHA-256. The manifest is the source of truth for
  drift detection, idempotent re-runs, and exact uninstall.
- **Plan → apply.** Planning is a pure function (no I/O) that classifies each file as
  add / change / unchanged / remove / skip-modified; applying executes the plan
  through sandboxed, atomic filesystem primitives. `--dry-run` stops after the plan.
- **rauf provisioning.** The installer pins the rauf loop runner
  (`RAUF_PIN = rauf@0.6.0`) and runs a resolvability **preflight** at install time.
  rauf is an _external_ published artifact (invoked later via `npx`), not bundled
  source. `--skip-rauf` records `raufPin: null` and skips the check; skills still
  install if the pin is unresolvable.

## Package Exports

The package is both a CLI and a small Node library.

| Entry point              | Description                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feature-forge` (bin)    | The CLI: `install` / `update` / `uninstall` / `list`.                                                                                                                                                        |
| `feature-forge` (import) | Library barrel — the agent-detection-map surface (`AGENT_TARGETS`, `detectAgent`, `detectAgents`, `resolveRoots`, `destinationFor`, `formatZeroDetection`), the `RAUF_PIN` coordinate, and the shared types. |

## Further Reading

- [Architecture](./architecture.md) — module graph, data flow, and the safety design (sandboxing, atomic writes, read-only source).
- [API Reference](./api-reference.md) — CLI commands, flags, exit codes, and the library API.
- [Integration Guide](./guides/integration.md) — running it, the rauf bundle relationship, CI dry-runs, and the boundary with `packaging-docs-ci`.
