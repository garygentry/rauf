# Architecture

This feature adds a coding-agent dimension to feature-forge's loop-running stage
without changing the shape of the forge↔rauf seam. It is best understood as **one new
token (`{agent}`), three config fields that carry it, a small pure resolution/pre-check
algorithm, and a capability gate that makes all of it vanish when a runner doesn't
opt in.**

## The seam (unchanged in shape)

feature-forge drives the loop runner entirely through the `loopRunner` block in
`forge.config.json`. Every command is a token template:

```
{bin} loop run . --backlog {backlogDir} --iterations {iterations}
```

There are no hardcoded `rauf …` strings anywhere in the skills — rauf is the _default_
that fills in when `loopRunner` is absent, and the _reference implementation_ of the
contract. This feature preserves that property: the only new vocabulary is `{agent}`,
and it appears in exactly one place — the default of `agentArgument`.

## Components

| Component       | Repo / path                                                            | Role                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Config schema   | `references/forge-config-schema.json`                                  | Declares `agentArgument`, `agentsProbeCommand`, `defaultAgent`; floors `minRunnerVersion` at `0.6.0`; dual-path `installHint`.          |
| Executable spec | `references/loop-agent-selection.py`                                   | Pure, total functions capturing the resolution + pre-check algorithm so tests can't drift from the prose. Test-only; not adapter-wired. |
| Operating skill | `skills/forge-5-loop/SKILL.md` + `references/runner-contract.md`       | Step 2d selector + availability listing + verdict handling + the resolved-agent observability line. Adapter-wired.                      |
| Contract doc    | `references/ralph-loop-contract.md`                                    | The authoritative, runner-neutral contract — the `forge-loop-runner-contract` expose.                                                   |
| Tests           | `tests/test_loop_agent_selection.py` + `tests/fixtures/mock-rauf/rauf` | Exercise the executable spec + schema defaults against a fake runner, no live agent.                                                    |

## Resolution: how forge picks the agent

forge owns two layers and collapses them into a single value. `resolve()` implements the
decision:

```
run_selection  (Step 2d picker)      ─┐
                                      ├─►  Resolution{ agent, source }
defaultAgent   (forge.config.json)   ─┘
```

- Precedence collapsed here: `run_selection` > `defaultAgent`.
- Empty/whitespace is treated as unset (mirrors rauf's own `resolveAgentId`).
- A pick equal to the runner's own default id (`claude-cli`) collapses to the **default
  path** — `Resolution(agent=None, source=DEFAULT)` — meaning _forge sends nothing_ and
  rauf applies its default. This is why selecting "default (claude-cli)" and selecting
  nothing render identically.

The full precedence chain spans both repos: `item.provider` (rauf, per-item) > the
resolved run value (forge) > `defaultAgent` (forge) > `claude-cli` (rauf default). forge
deliberately feeds only the run layer to rauf via `--agent {agent}`; **rauf alone**
applies the per-item override above it. forge never reads rauf's item/global agent
surfaces (REQ-AGENT-05).

## Launch rendering

`render_launch()` is the single chokepoint that turns a `Resolution` into a command:

```
agent_argument falsy?  ── yes ──►  base_cmd unchanged   (capability gate off)
resolved.agent None?   ── yes ──►  base_cmd unchanged   (default path)
resolved.agent == runner default? ─ yes ─► base_cmd unchanged
otherwise            ──────────►  base_cmd + " " + agentArgument.replace("{agent}", agent)
```

Three of four branches return the **byte-identical** pre-feature command. Only a
non-default, validated agent appends an argument. This is the mechanical guarantee
behind REQ-COMPAT-01 / REQ-PLUG-02.

## Availability pre-check: unknown vs. unavailable

For a non-default agent (`needs_precheck()` returns True), forge runs the probe once and
classifies:

```
                       ┌───────────────────────────────────────────────┐
 agents --json (exit 0)│  advertised_set = { row.id for row in agents }  │
 every time            └───────────────────────────────────────────────┘
                                          │
                 classify(resolved_agent, agents, runner_default_id)
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
   id ∉ advertised                  id ∈, available:true              id ∈, available:false
        │                                  │                                  │
     UNKNOWN                            AVAILABLE                        UNAVAILABLE
  hard-reject before                    proceed                  warn (with detail) +
  any side-effect;                                                proceed-anyway OR
  list valid ids;                                                 choose-another
  NO proceed-anyway
```

**Why membership, not exit code:** `rauf agents --json` always exits 0. An unknown id is
simply _absent_ from `agents[]`; a known-but-unavailable one is _present_ with
`available: false`. Keying off exit code couldn't tell those apart. The advertised set
also doubles as the security allow-list (REQ-SEC-01) — only an advertised id is ever
substituted into `{agent}`.

**Probe failure** (non-zero exit, unparseable JSON, missing/empty `agents[]`, a row with
no `id`) is handled by the _caller_ before `classify` is ever reached — surface the
failure and offer choose-another/abort; never launch a non-default agent unvalidated.
`classify` itself is total and never raises.

The default path runs **no probe at all**, so the common case incurs zero added latency
(REQ-PERF-01).

## The capability gate

Every agent-surface behavior — the Step 2d picker, the probe, the availability listing,
the verdict handling, the resolved-agent line — is gated on `loopRunner.agentArgument`
being present and non-empty. When it's absent, forge-5-loop's Step 2d and Step 3c render
exactly as they did before this feature. This makes the agent dimension a pure opt-in for
any runner that conforms to the contract, and keeps the "swap in an alternate runner"
story working: a runner advertises the surface to get agent selection, or omits it to
degrade silently to today's behavior.

## Why an executable spec

The selection algorithm is described in skill _prose_ (the skills don't import Python).
To stop the prose and the tests from drifting, the algorithm is _also_ captured once in
`references/loop-agent-selection.py` — pure, total, stdlib-only functions that the
pytest suite imports and the prose mirrors. The module is intentionally **not** wired
into any generated adapter, so it's exempt from the adapter drift guard. It is the
single source of truth the tests pin against.

## Per-stage applicability

Only stages that _run the loop_ are agent-aware:

| Stage           | Runner commands used                 | Agent-aware? |
| --------------- | ------------------------------------ | ------------ |
| forge-5-loop    | run / eventStream / status / version | **Full**     |
| forge-4-backlog | validate                             | None         |
| forge-verify    | validate                             | None         |

`validate` is agent-agnostic by rule: no `--agent`, no `{agent}`, no agent id may ever be
passed to backlog validation in any stage (REQ-SEAM-02). Backlog validation is about
_data_, not _who runs the loop_.

## Version floor

The agent surface requires rauf ≥ `0.6.0` — the release that ships `--agent`, the
`rauf agents` probe, and the preset agent registry. forge-5-loop's Step 1c version gate
enforces this _before_ any runner side-effect, using the `--json` form of the version
command (never the human `rauf vX.Y.Z` output). The `installHint` names two distinct
ways to provision the binary: the cross-agent installer (`npx feature-forge install`,
which records the pinned `rauf@0.6.0`) and the direct rauf CLI one-liner.
