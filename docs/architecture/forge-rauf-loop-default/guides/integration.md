# Integration Guide

How to arm the agent surface, select an agent for a run, swap in an alternate runner,
and stay inside the per-stage rules.

## When to use

- You want a forge loop to run under a coding agent other than Claude Code (Codex,
  Gemini, Copilot, Cursor) — per run, or fixed per project.
- You're integrating a non-rauf loop runner and want forge to drive its agent selection
  through config alone.

## When NOT to use

- You only ever use the default agent. Then do nothing — the default path is byte-identical
  to pre-feature behavior, and leaving `agentArgument` unset keeps the surface off.
- You're in forge-4-backlog or forge-verify. Those stages are **agent-agnostic** by rule;
  there is no agent knob there, by design.

## Arming the agent surface

The surface activates when `loopRunner.agentArgument` is present and non-empty. With the
rauf defaults you can simply spell out the block:

```jsonc
// forge.config.json
{
  "loopRunner": {
    "bin": "rauf",
    "minRunnerVersion": "0.6.0",
    "agentArgument": "--agent {agent}",
    "agentsProbeCommand": "{bin} agents --json",
    "defaultAgent": ""              // or e.g. "codex" to fix a project default
  }
}
```

To **disable** the surface entirely, omit `agentArgument` (or set it to `""`). forge-5-loop
then renders Step 2d and the launch command exactly as before — no selector, no probe.

## Selecting an agent for a run

Selection is interactive, in forge-5-loop's **Step 2d** confirmation:

1. forge runs `agentsProbeCommand` **once** and parses `agents[]`.
2. The confirmation adds an agent choice — one option per advertised row
   (`{displayName} ({id}) — available/not found`) plus an explicit **`default (claude-cli)`**
   choice that maps to "send nothing".
3. forge resolves run > project > default and, for a non-default pick, classifies it:
   - **AVAILABLE** → proceed; the launch command gains `--agent <id>`.
   - **UNAVAILABLE** (known id, CLI/creds missing) → warn with the probe `detail`, then
     offer **proceed-anyway** or **choose-another**. Never silent.
   - **UNKNOWN** (id not advertised) → **hard-reject before any loop side-effect**, listing
     the sorted valid ids. No proceed-anyway.
   - **probe failure** → surface it and offer choose-another/abort; never launch unvalidated.
4. The confirmation shows `Agent: <resolved or claude-cli> (source: run|project|default)`,
   and the "Loop started" template echoes `Coding agent: <id> (source: …)`.

To fix an agent without choosing every run, set `defaultAgent` — the per-run selector
still overrides it.

## Version gate

forge-5-loop's Step 1c enforces `minRunnerVersion` (≥ `0.6.0`) **before** any runner
side-effect, parsing the `--json` form of the version command (never the human
`rauf vX.Y.Z` output). If the binary is missing or too old, forge stops and prints the
`installHint`, which points at either:

```bash
# Multi-agent provisioning (records the pinned rauf@0.6.0):
npx feature-forge install

# Or just the rauf CLI:
curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash
```

## Swapping in an alternate runner

Because every command — including the agent surface — is tokenized config, a different
ralph-style runner that conforms to the contract drops in with no skill edits. It must:

- expose `agentArgument` / `agentsProbeCommand` (+ optional `defaultAgent`) in its
  `loopRunner` block to *get* agent selection, or omit them to degrade silently;
- make its probe **always exit 0** and emit `{ agents: [{ id, displayName, available, … }] }`;
- apply any per-item agent override itself (forge feeds only the run layer).

A runner that advertises no `agentArgument` is fully supported — it just runs the loop
the way forge always has. See [`ralph-loop-contract.md`](../../../specs/agent-agnostic/forge-rauf-loop-default/) →
the contract is the authoritative spec (`forge-loop-runner-contract` expose).

## Testing without a live agent

The whole selection/pre-check algorithm is verifiable offline:

```bash
cd <feature-forge repo>
python3 -m pytest tests/test_loop_agent_selection.py -q
```

The suite imports `references/loop-agent-selection.py` and drives a fake runner
(`tests/fixtures/mock-rauf/rauf`) that answers `version --json` and `agents --json`,
recording its argv to `$MOCK_RAUF_ARGV_LOG` so tests can assert the probe ran **exactly
once** for a non-default launch and **zero** times on the default / gate-off paths. This
mock stands in for the maintainer-run live multi-agent end-to-end run — it is **not**
full E2E coverage.

## Boundary with `packaging-docs-ci`

This feature *produces* the authoritative `forge-loop-runner-contract` (the contract doc
plus the `loopRunner` schema block). The epic capstone `packaging-docs-ci` *consumes* it
for user-facing packaging and CI docs; it is not part of this feature.
