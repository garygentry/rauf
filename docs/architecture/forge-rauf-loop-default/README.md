# Forge ↔ Rauf Loop-Runner Contract (Agent-Agnostic Loop)

This feature formalizes the contract between **feature-forge**'s pipeline and the
**rauf** loop runner, and threads a _coding-agent_ dimension through forge's existing
tokenized `loopRunner` seam — so a forge loop can be driven by Claude Code, Codex,
Gemini, Copilot, or Cursor, with rauf as the default and reference implementation.

The whole feature is **additive and presence-gated**: it activates only when a runner
advertises a `loopRunner.agentArgument`. A runner that omits that field behaves
byte-identically to before — no selector, no probe, no extra output (REQ-PLUG-02,
REQ-COMPAT-01).

> **Where the code lives.** All implementation ships in the `feature-forge` repo
> (skill prose + JSON references + a Python helper); rauf is _consumed_, not modified.
> The canonical files are `references/forge-config-schema.json`,
> `references/loop-agent-selection.py`, `references/ralph-loop-contract.md`, and
> `skills/forge-5-loop/` (`SKILL.md` + `references/runner-contract.md`). The per-agent
> adapters under `adapters/` are regenerated, never hand-edited.

## Quick Start

A coding agent for a forge loop is chosen at three layers; forge owns the middle two
and feeds a single resolved value to rauf:

```jsonc
// forge.config.json — fix a project-default agent once (optional)
{
  "loopRunner": {
    "bin": "rauf",
    "agentArgument": "--agent {agent}", // presence of this field arms the agent surface
    "agentsProbeCommand": "{bin} agents --json",
    "defaultAgent": "codex", // "" ⇒ no project default (rauf's own default applies)
  },
}
```

```bash
# Per-run selection happens interactively in forge-5-loop's Step 2d confirmation.
# The rendered launch command simply gains the resolved agent argument:
rauf loop run . --backlog specs/auth --iterations 12 --agent codex
#                                                      └── appended only for a non-default, validated agent
```

When no agent is selected (the **default path**), the command is rendered exactly as it
always was — rauf applies its own default (`claude-cli`).

## Key Concepts

- **The seam.** feature-forge never hardcodes `rauf …`. Every runner command is a
  template with `{bin}` / `{backlogDir}` / `{specsDir}` / `{iterations}` tokens. This
  feature adds exactly one token — `{agent}` — and three config fields that carry it.
- **Three config fields.** `agentArgument` (the tokenized flag, default `--agent {agent}`),
  `agentsProbeCommand` (the availability probe, default `{bin} agents --json`), and
  `defaultAgent` (the project default, default `""`). See [api-reference](./api-reference.md).
- **Resolution precedence** (highest wins): `item.provider` _(rauf's per-item override)_ >
  run selector _(forge)_ > `defaultAgent` _(forge)_ > runner default _(`claude-cli`)_. forge
  owns only the run + project layers and collapses them into one `--agent` value; rauf
  alone applies the per-item override above it. forge never re-implements rauf's resolver.
- **Availability pre-check.** Before launching a _non-default_ agent, forge runs the probe
  **once** (no retries) and classifies the choice three ways against the advertised set:
  **AVAILABLE** (proceed), **UNAVAILABLE** (known id, CLI/creds missing → warn + proceed-or-choose),
  **UNKNOWN** (id not advertised → **hard-reject** before any loop side-effect, listing valid ids).
  Disambiguation is by _membership_, not exit code — the probe always exits 0.
- **The advertised set is the allow-list.** Only an id that the probe reports is ever
  interpolated into `{agent}` (REQ-SEC-01).
- **Capability gate.** Everything above is gated on `agentArgument` being present and
  non-empty. Absent ⇒ the loop renders and behaves exactly as before this feature.
- **`validate` is agent-agnostic.** No agent argument is _ever_ passed to backlog
  validation, in any stage. Only the loop-running stage (forge-5-loop) is agent-aware.

## Package Exports

This feature is documentation + an executable spec, not a shipped runtime library.

| Entry point                           | Description                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `references/loop-agent-selection.py`  | The executable spec (test-only): `resolve`, `render_launch`, `classify`, `needs_precheck`, `advertised_set` + the shared types/constants. Pure, total, stdlib-only. NOT adapter-wired. |
| `references/forge-config-schema.json` | The `loopRunner` config schema — the three agent fields + the `0.6.0` version floor + dual-path `installHint`.                                                                         |
| `references/ralph-loop-contract.md`   | The authoritative loop-runner contract (the `forge-loop-runner-contract` expose consumed by `packaging-docs-ci`).                                                                      |
| `skills/forge-5-loop/**`              | The skill prose that _operates_ the contract (Step 2d selector + pre-check + observability).                                                                                           |

## Further Reading

- [Architecture](./architecture.md) — the seam, the resolution/pre-check data flow, and why the algorithm is captured as an executable spec.
- [API Reference](./api-reference.md) — the `loopRunner` config fields, the probe shape, and the `loop-agent-selection.py` function signatures.
- [Integration Guide](./guides/integration.md) — arming the agent surface, swapping in an alternate runner, and the per-stage applicability rules.
