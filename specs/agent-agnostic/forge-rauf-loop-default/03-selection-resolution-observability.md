# 03 — Selection, Resolution & Observability

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Source of truth: `PRD.md` (v1) §3.2–3.3, §4.3, §4.5 + `tech-spec.md` (v1) §3.2, §3.4.
> Shared types/constants/tokens are defined in `00-core-definitions.md`; this document
> references them by name and does **not** redefine them. Cross-references use exact filenames.

This document specifies the **run-level agent selector**, the **forge-side resolution** that
collapses forge's run+project layers into the single `--agent` value rauf's run layer accepts,
the **precedence** mapping (and why forge never re-implements rauf's resolver), and the
**observability** of the resolved agent + its source layer. It builds directly on the
`Resolution` / `AgentSource` result types and the `RUNNER_DEFAULT_ID` constant from
`00-core-definitions.md §2, §4`, and the capability gate + `defaultAgent` field from
`02-config-schema-and-gating.md`. The Step 2d *availability* verdicts that this document's UX
surfaces (member-available / known-unavailable / unknown) are owned by
`04-availability-precheck.md` and only **consumed** here.

The only callable code this document specifies is the `resolve(...)` function of the executable
spec `references/loop-agent-selection.py` (Python 3.10+); all other artifacts are skill prose
(`skills/forge-5-loop/SKILL.md`) and contract reference text
(`skills/forge-5-loop/references/runner-contract.md`).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-AGENT-01 | Per-run agent selector in the Step 2d optional-flags surface | §2 |
| REQ-AGENT-02 | Resolution consumes `loopRunner.defaultAgent` (project default) | §3 |
| REQ-AGENT-03 | No agent at any layer ⇒ identical to today (rauf's default drives) | §3, §5 |
| REQ-AGENT-05 | Per-item `BacklogItem.provider` is pass-through; forge never reads/overrides it | §3, §4 |
| REQ-PREC-01 | Precedence parallel to model selection: item > run > project > default | §4 |
| REQ-PREC-02 | Run-level occupies the run layer only (below item, above project) | §4 |
| REQ-OBS-01 | Resolved agent + source layer visible at confirm AND "loop started" | §6 |
| REQ-OBS-02 | No new event types; NDJSON / status JSON unchanged | §6 |
| REQ-PERF-01 | Default path adds no runtime cost (no extra probe) | §5 |
| REQ-COMPAT-01 | Additive; existing claude-default projects unchanged | §5 |
| REQ-COMPAT-02 | Per-run, no shared state ⇒ concurrent loops unaffected | §7 |

## 1. Where this lives in feature-forge

Per `01-architecture-layout.md §2`, the canonical edits this document drives are:

| Path | Change | This doc's part |
|------|--------|-----------------|
| `skills/forge-5-loop/SKILL.md` | **edit** Step 2d (add the agent choice + inline `--agent` mention), Step 3c (show resolved agent + source) | §2, §6 |
| `skills/forge-5-loop/references/runner-contract.md` | **edit** add `## Agent selection` section parallel to `## Model selection precedence`; add `--agent` to the optional-flags catalog; add the agent line to the Step 3c template | §2, §4, §6 |
| `references/loop-agent-selection.py` | **new** define `resolve(run_selection, default_agent, runner_default_id) -> Resolution` | §3 |

After editing the canonical `skills/`, regenerate `adapters/**` with
`python3 scripts/build-adapters.py` and run the gate `bash scripts/validate.sh` (CON-05,
`01-architecture-layout.md §4`). Never hand-edit `adapters/**`.

The selector, resolution, and observability described here are **presence-gated** on
`loopRunner.agentArgument` (`02-config-schema-and-gating.md §2`). When that field is absent the
entire surface in this document vanishes (REQ-PLUG-01/02) — see §5 and `02 §2` for the gate
mechanics; this document assumes the gate is **on** except where it says otherwise.

## 2. Step 2d selector (REQ-AGENT-01)

### 2.1 What exists today

`skills/forge-5-loop/SKILL.md` Step 2d ("Confirm with User") routes a confirmation through
`AskUserQuestion`. The current verbatim block (the content for `AskUserQuestion`, **not** output
as text) ends with this optional-flags mention:

```
Optional flags you can add (rauf): --review, --model <model>, --timeout <min>,
--retry-blocked. For the full optional-flags catalog and the model-selection
precedence (item.model > --model/options > project default > provider default),
read references/runner-contract.md.
```

and `references/runner-contract.md` carries the catalog itself under `## Optional flags catalog
(Step 2d, rauf)`:

```
  --review          Run a review pass after all iterations (extra agent session)
  --model <model>   Override the model (see precedence above)
  --timeout <min>   Per-session timeout in minutes (default: 60)
  --retry-blocked   Unblock and retry previously blocked items
```

### 2.2 The augmentation

**The agent choice is surfaced ONLY when the capability gate is on** — i.e. when the effective
`loopRunner.agentArgument` is present and non-empty (`02-config-schema-and-gating.md §2`). When
the gate is off, Step 2d is unchanged byte-for-byte from today (REQ-PLUG-02, REQ-COMPAT-01) and
nothing in this section applies.

When the gate is on, Step 2d gains an **"agent"** question in the same `AskUserQuestion` surface
as the existing optional flags. Its options are populated from the availability probe's parsed
rows (`04-availability-precheck.md`; the probe is run **before** the Step 2d confirmation so its
results can populate the listing — REQ-AGENT-04, deferred to `04`), **plus** an explicit default
choice:

- **One option per advertised row**, labelled `"{displayName} ({id})"` with the row's
  availability annotated — e.g. `"Codex CLI (codex) — available"` or `"Gemini CLI (gemini) —
  not found"` — sourced from the parsed `AgentAvailability` rows (`00-core-definitions.md §1.1`:
  `id`, `displayName`, `available`, `detail`). The annotation lets the user choose from what is
  actually installed (REQ-AGENT-04); the availability classification and the
  unavailable/unknown handling are owned by `04-availability-precheck.md` and are **not**
  re-specified here.
- **One explicit `"default (claude-cli)"` choice** that maps to "no run-level selection" — i.e.
  forge passes nothing for the run layer and lets resolution fall through to the project default
  or the runner default (§3). The literal label uses the runner default id, which for rauf is
  `claude-cli` (`00-core-definitions.md §1.2`, `RUNNER_DEFAULT_ID`).

The user's pick becomes `run_selection` for §3:
- picking an advertised row → `run_selection = that row's id`,
- picking `"default (claude-cli)"` → `run_selection = None`.

The inline optional-flags mention in Step 2d's `AskUserQuestion` block is amended to add the new
flag (the only change to the existing line):

```
Optional flags you can add (rauf): --agent <id>, --review, --model <model>,
--timeout <min>, --retry-blocked. For the full optional-flags catalog, the
model-selection precedence (item.model > --model/options > project default >
provider default), and the parallel agent-selection precedence (item.provider >
--agent > project defaultAgent > runner default), read references/runner-contract.md.
```

The amended optional-flags catalog line added to `references/runner-contract.md`'s
`## Optional flags catalog (Step 2d, rauf)` block (inserted as the first entry so it parallels
`--model`):

```
  --agent <id>      Coding agent rauf drives this run (see Agent selection below).
                    Only the runner's advertised ids are valid; an unknown id is
                    rejected before launch. Shown only when the runner advertises
                    an agent surface (loopRunner.agentArgument present).
```

The new `## Agent selection` operational section added to `references/runner-contract.md` is
**parallel** to the existing `## Model selection precedence (Step 2d)` section; its precedence
text is specified in §4 below, and it cross-references `04-availability-precheck.md` for the
probe/disambiguation and `02-config-schema-and-gating.md` for the capability gate.

## 3. forge-side resolution (REQ-AGENT-02, REQ-AGENT-03, REQ-AGENT-05)

forge owns **only** its run and project layers and collapses them into **one** value before
emitting a single `--agent`. The rule (tech-spec §3.2):

```
resolved = run_selection                       # from Step 2d, if an advertised id was chosen
        or default_agent (non-empty)           # loopRunner.defaultAgent (02-config-schema-and-gating.md)
        or <none>                              # ⇒ append nothing; rauf applies its own default
```

This is captured once as the `resolve(...)` function in the executable spec
`references/loop-agent-selection.py`, importing the `Resolution` / `AgentSource` types verbatim
from `00-core-definitions.md §4`. The skill prose in `skills/forge-5-loop/SKILL.md` Step 2d
prescribes exactly this rule; the function is the test-only executable spec of it
(`07-testing-strategy.md`; OQ-T1 resolved test-only + doc).

### 3.1 `resolve` — Python signature

The function as it will appear in `references/loop-agent-selection.py` (Python 3.10+, full type
annotations, Google-style docstring per the Python stack profile):

```python
from __future__ import annotations

# Resolution and AgentSource are defined in this same module per
# 00-core-definitions.md §4; reproduced there. Shown here as imports for clarity.
from loop_agent_selection import AgentSource, Resolution  # same module (self-reference)


def resolve(
    run_selection: str | None,
    default_agent: str,
    runner_default_id: str,
) -> Resolution:
    """Collapse forge's run + project layers into one agent value.

    Implements the run-over-project decision forge owns (REQ-PREC-02). forge
    feeds ONLY this resolved value to rauf's run layer via the rendered
    ``--agent {agent}`` argument; rauf alone applies the per-item override
    (``BacklogItem.provider``) ABOVE it (REQ-AGENT-05) and falls through to its
    own ``runner_default_id`` when forge sends nothing (REQ-AGENT-03). forge
    never reads any item-, project-, or global-level agent from rauf's surfaces
    (CON-02/CON-04) — see ``00-core-definitions.md §1.3, §5``.

    Precedence collapsed here (highest wins): run_selection > default_agent.
    A whitespace-only ``default_agent`` is treated as unset (matching rauf's
    own empty/whitespace handling in ``resolveAgentId`` — see §4).

    Args:
        run_selection: The id picked in the Step 2d selector, or None when the
            user picked "default (claude-cli)" / made no run-level choice
            (§2.2). An empty/whitespace string is treated as None.
        default_agent: ``loopRunner.defaultAgent`` from ``forge.config.json``
            (``02-config-schema-and-gating.md``). Empty/whitespace ⇒ no project
            default.
        runner_default_id: The runner's own default id sentinel
            (``RUNNER_DEFAULT_ID`` from ``00-core-definitions.md §2`` —
            ``"claude-cli"`` for rauf). Used to classify the source as DEFAULT
            when the resolved value equals it (and is therefore on the
            default path — §5).

    Returns:
        A :class:`Resolution` whose ``agent`` is the chosen id or None (the
        default path: append no argument, run no probe), and whose ``source``
        is RUN, PROJECT, or DEFAULT.
    """
    def _clean(value: str | None) -> str | None:
        stripped = value.strip() if value is not None else None
        return stripped or None

    run = _clean(run_selection)
    project = _clean(default_agent)

    if run is not None:
        # A run-level pick of the runner default id is still the DEFAULT path:
        # forge sends nothing and rauf applies its own default (§5).
        if run == runner_default_id:
            return Resolution(agent=None, source=AgentSource.DEFAULT)
        return Resolution(agent=run, source=AgentSource.RUN)

    if project is not None:
        if project == runner_default_id:
            return Resolution(agent=None, source=AgentSource.DEFAULT)
        return Resolution(agent=project, source=AgentSource.PROJECT)

    return Resolution(agent=None, source=AgentSource.DEFAULT)
```

### 3.2 Source-layer determination

The `source` field of the returned `Resolution` (`AgentSource`, `00-core-definitions.md §4`) is
determined as:

| Condition | `agent` | `source` |
|-----------|---------|----------|
| `run_selection` is a non-empty id ≠ `runner_default_id` | that id | `RUN` |
| no run pick; `default_agent` non-empty and ≠ `runner_default_id` | that id | `PROJECT` |
| neither set, OR the chosen id equals `runner_default_id` | `None` | `DEFAULT` |

The `DEFAULT` row covers both "no forge layer set anything" and "a layer explicitly chose the
runner's own default id" — both are the **default path** (§5): forge appends no argument and runs
no probe. Collapsing an explicit `claude-cli` pick to `agent=None` is what guarantees the default
launch command is byte-identical to today (REQ-COMPAT-01) regardless of whether the user picked
"default (claude-cli)" or set `defaultAgent: "claude-cli"`.

### 3.3 What forge never does (REQ-AGENT-05)

forge **never reads, writes, or overrides** `BacklogItem.provider` (`00-core-definitions.md
§1.4`, `packages/core/src/schemas.ts:72` in rauf: `provider: z.string().optional()`). The
resolved value forge emits is *only* a run-layer value; rauf applies any per-item agent above it
(§4). A backlog item with its own `provider` therefore always wins, and forge's `--agent` is
inert for that item — by rauf's design, not by anything forge does. The `07-testing-strategy.md`
pytest asserts forge **never emits an `--agent` derived from a backlog item** (it has no code
path that reads one).

### 3.4 `render_launch` — appending the agent argument (REQ-AGENT-01, REQ-SEC-01)

Rendering the launch command from a `Resolution` is forge's run/project concern, so the helper
lives here in the executable spec alongside `resolve()`. It appends the rendered `agentArgument`
**iff** `resolved.agent` is a non-default, validated id; otherwise it returns the base command
unchanged. The only value ever substituted into `{agent}` has already passed the
`04-availability-precheck.md` allow-list (`AdvertisedSet`) — `render_launch` is the single
interpolation point, but it is reached for a non-default id only after `classify` returns a
non-`UNKNOWN` verdict (REQ-SEC-01).

```python
def render_launch(
    base_cmd: str,
    agent_argument: str | None,
    resolved: Resolution,
    runner_default_id: str = RUNNER_DEFAULT_ID,
) -> str:
    """Append the rendered ``agentArgument`` to the launch command, or return it unchanged.

    Appends ``agent_argument`` (with ``{agent}`` substituted by ``resolved.agent``)
    exactly when an agent surface is present AND a non-default agent was resolved.
    Returns ``base_cmd`` byte-identical to the pre-feature command otherwise — the
    default path and the capability-gated-off path (REQ-COMPAT-01, REQ-PLUG-02).

    Args:
        base_cmd: The rendered run/eventStream command before any agent argument.
        agent_argument: ``loopRunner.agentArgument`` (e.g. ``"--agent {agent}"``), or
            None when the capability gate is off (``agentArgument`` absent — §`02`).
        resolved: The :class:`Resolution` from :func:`resolve`.
        runner_default_id: The runner's own default id (``"claude-cli"`` for rauf).

    Returns:
        ``base_cmd`` with ``" " + agent_argument`` appended (``{agent}`` → ``resolved.agent``)
        when ``agent_argument`` is non-empty AND ``resolved.agent`` is a non-None id that
        differs from ``runner_default_id``; otherwise ``base_cmd`` unchanged.
    """
    if not agent_argument:                       # capability gate off (REQ-PLUG-02)
        return base_cmd
    agent = resolved.agent
    if agent is None or agent == runner_default_id:  # default path (REQ-AGENT-03, REQ-COMPAT-01)
        return base_cmd
    return f"{base_cmd} {agent_argument.replace('{agent}', agent)}"
```

`render_launch` is **pure and total**: it never runs the probe (that is
`04-availability-precheck.md`) and never reads a backlog item. Its three no-op cases — gate off,
`agent is None`, and `agent == runner_default_id` — are exactly the default/gated-off paths whose
launch command must equal today's (`07-testing-strategy.md §3.3–3.4`).

## 4. Precedence (REQ-PREC-01, REQ-PREC-02)

### 4.1 The observable precedence

The agent precedence is **parallel to the model-selection precedence** already documented in
`references/runner-contract.md` (`## Model selection precedence`: `item.model > --model/options
> project default > provider default`). Stated for agents (the text added to the new
`## Agent selection` section, mirroring `00-core-definitions.md §5`):

```
item.provider  >  --agent (run selection)  >  loopRunner.defaultAgent (project)  >  runner default (claude-cli)
```

Realized as (`00-core-definitions.md §5`, tech-spec §3.2):

```
item     ▸ rauf, from BacklogItem.provider   (forge never touches it — §3.3)
run      ▸ forge's Step 2d selector  ┐ forge collapses these two into ONE
project  ▸ loopRunner.defaultAgent   ┘ --agent {agent} value (resolve(), §3)
default  ▸ rauf's RUNNER_DEFAULT_ID ("claude-cli") when forge sends nothing
```

### 4.2 The ownership boundary — why forge never re-implements rauf's resolver

This is the precise meaning of "forge owns run/project/default; it never re-implements rauf's
resolution" (REQ-PREC-01 note, CON-02/CON-04):

- forge decides **run-over-project inside itself** (`resolve()`, §3) and emits **one**
  `--agent {agent}` value occupying rauf's **run layer only** (REQ-PREC-02).
- rauf alone resolves **item-vs-run** (and project/global below) via its 5-layer resolver, which
  sits the per-item agent *above* forge's run layer. So the run selection can **never clobber a
  deliberate per-item agent** (REQ-PREC-02, REQ-AGENT-05).

The consumed rauf resolver (reproduced in `00-core-definitions.md §1.3`):

```ts
// packages/loop/src/agent-selection.ts:24 (rauf)
export function resolveAgentId(input: {
  itemProvider?: string;    // BacklogItem.provider — HIGHEST precedence
  runProvider?: string;     // LoopStartOptions.provider — set from `--agent`  ← forge feeds THIS layer only
  projectProvider?: string; // project .rauf.json → MarkerOptions.provider
  globalProvider?: string;  // global ~/.rauf/config.json → ToolConfig.defaultProvider
}): string;
// returns: itemProvider ?? runProvider ?? projectProvider ?? globalProvider ?? DEFAULT_AGENT_ID
// (empty/whitespace-only treated as unset)
```

`DEFAULT_AGENT_ID = "claude-cli"` is defined at `packages/loop/src/constants.ts:2` (rauf).
forge's `resolve()` (§3) feeds rauf's `runProvider` slot (and nothing else); rauf's `itemProvider`
sits above it. forge's empty/whitespace-as-unset handling in `resolve()` matches rauf's `pick()`
helper (`agent-selection.ts:35`) so the two layers compose without surprises. Note that rauf's
resolver has a `globalProvider` layer between project and default that forge does not surface;
forge's `defaultAgent` maps to rauf's `runProvider` decision input only insofar as forge collapses
it — rauf's own `projectProvider`/`globalProvider` (read from `.rauf.json` / `~/.rauf/config.json`)
remain rauf's concern and are never read by forge (CON-01). forge's three-name precedence
(run/project/default) is the *forge-observable* slice of rauf's 5-layer chain; the contract doc
`06-loop-runner-contract-doc.md` documents the full alignment.

## 5. Default path is untouched (REQ-AGENT-03, REQ-COMPAT-01, REQ-PERF-01)

When `resolve()` returns `Resolution(agent=None, source=DEFAULT)` — i.e. no run pick and no
non-default `defaultAgent`, **or** a layer explicitly chose `runner_default_id` (§3.2) — forge:

- appends **no** `agentArgument` to the launch command (no `{agent}` substitution occurs —
  `00-core-definitions.md §6`), so the rendered command is **byte-identical to today**
  (REQ-COMPAT-01); and
- runs **no** availability probe — the probe is invoked only for a non-default resolved id
  (`04-availability-precheck.md`), so the default path incurs **zero** extra runtime cost
  (REQ-PERF-01).

This is the same default-path guarantee from two other angles:
- `04-availability-precheck.md` — the pre-check never runs on the default path (no probe).
- `05-runner-discovery-version-gate.md` — the version gate does no extra agent work beyond the
  one-time `minRunnerVersion` floor bump (REQ-PERF-01); it is unchanged by agent selection.

The `07-testing-strategy.md` pytest asserts: with neither `run_selection` nor a non-default
`default_agent`, `resolve()` yields `agent=None` and `render_launch` (§3.4) appends
nothing — a launch command identical to baseline (REQ-AGENT-03, REQ-COMPAT-01, REQ-PERF-01).

## 6. Observability (REQ-OBS-01, REQ-OBS-02)

The resolved agent id **and its source layer** are shown to the user in two places, so it is
auditable which agent drove a run (REQ-OBS-01). The source string is the `AgentSource` value
(`00-core-definitions.md §4`: `run` / `project` / `default`).

### 6.1 Step 2d pre-launch confirmation

The Step 2d `AskUserQuestion` confirmation block in `skills/forge-5-loop/SKILL.md` gains an
**agent** line (shown only when the gate is on). It states the resolved id and source, using a
human phrasing of `AgentSource`:

```
Agent: {resolved.agent or runnerDefaultId} (source: {sourceLabel})
```

where `sourceLabel` is:
- `AgentSource.RUN` → `"per-run selection"`,
- `AgentSource.PROJECT` → `"project default (loopRunner.defaultAgent)"`,
- `AgentSource.DEFAULT` → `"runner default — claude-cli"` (and `{resolved.agent or
  runnerDefaultId}` renders the literal `claude-cli`, since `resolved.agent` is `None`).

When the gate is off, this line is **absent** (REQ-PLUG-02) and the confirmation is unchanged
from today.

### 6.2 Step 3c "Loop started…" inform-user template

The verbatim "Loop started…" template lives in `references/runner-contract.md` under
`## Inform-user output template (Step 3c)`. One line is **added** immediately after the opening
`Loop started for {feature} ({N} items to process).` line (shown only when the gate is on):

```
Coding agent: {resolved.agent or runnerDefaultId} (source: {sourceLabel}).
```

using the same `sourceLabel` mapping as §6.1. The existing template body (the watch-directly
commands and the state-file listing) is otherwise unchanged. `skills/forge-5-loop/SKILL.md` Step
3c continues to point at this template; the only edit is the added agent line in the template.

### 6.3 No new event types (REQ-OBS-02)

This observability is **session-side prose only** — it is rendered by the skill into the
`AskUserQuestion` confirmation and the inform-user text. It introduces **no new event types**:
the NDJSON event stream (`events.ndjson`) and the status JSON (`statusJsonCommand` output) are
**unchanged**. The agent id already appears in rauf's own events; forge reads no new event field
and emits none. The Monitor filter in `references/runner-contract.md` (Step 3d) is not modified.

## 7. Concurrency (REQ-COMPAT-02)

Agent selection is **per-run and carries no shared state**. `resolve()` (§3) is a pure function
of its three arguments — the run pick, the project `defaultAgent`, and the runner default id —
and produces a single launch-time value; it persists nothing (`00-core-definitions.md §4`:
`Resolution` is a frozen dataclass, not persisted). The resolved `--agent` is appended to the one
launch command for that run only.

Concurrent loop runs for different features (isolated per `--backlog` state dir, per the existing
Step 2b/3b state-dir isolation in `skills/forge-5-loop/SKILL.md`) therefore do **not** interact
through agent selection: each run resolves its own agent from its own config + its own Step 2d
pick, and writes to its own `{backlogDir}/{loopRunner.stateDir}/`. No global agent state is read
or written by forge (CON-01; rauf's own `~/.rauf/config.json` global layer is rauf's concern,
never read by forge — §4.2). Existing concurrent-loop behavior is unaffected (REQ-COMPAT-02).

## Dependencies

Implement after (per `01-architecture-layout.md §6`):

- **`00-core-definitions.md`** — `Resolution`, `AgentSource`, `RUNNER_DEFAULT_ID` (§2, §4);
  the `{agent}` token (§6); the consumed `resolveAgentId` / `DEFAULT_AGENT_ID` /
  `BacklogItem.provider` references (§1).
- **`02-config-schema-and-gating.md`** — the `defaultAgent` field consumed by `resolve()` (§3)
  and the capability gate that decides whether the Step 2d selector and the observability lines
  appear at all (§2, §5, §6).
- **`04-availability-precheck.md`** — the probe rows + verdicts (member-available /
  known-unavailable / unknown) that populate and gate the Step 2d selector options (§2.2), and the
  allow-list guarantee that the id reaching `render_launch` (§3.4) is always a validated member of
  `AdvertisedSet`; this document **consumes** those verdicts and does not redefine them.

This document is in turn referenced by `06-loop-runner-contract-doc.md` (which restates the
precedence and ownership boundary as the authoritative expose) and `07-testing-strategy.md`
(which tests `resolve()` and the default-path/precedence assertions).

## Verification

Concrete checks an implementation must satisfy:

- [ ] `resolve("codex", "", "claude-cli")` returns `Resolution(agent="codex", source=RUN)`.
- [ ] `resolve(None, "codex", "claude-cli")` returns `Resolution(agent="codex", source=PROJECT)`
      (run beats project, but with no run pick the project default applies — REQ-AGENT-02).
- [ ] `resolve("gemini", "codex", "claude-cli")` returns `Resolution(agent="gemini",
      source=RUN)` — run-selection beats `defaultAgent` (REQ-PREC-02).
- [ ] `resolve(None, "", "claude-cli")` returns `Resolution(agent=None, source=DEFAULT)` — the
      default path (REQ-AGENT-03, REQ-COMPAT-01).
- [ ] `resolve("claude-cli", "", "claude-cli")` and `resolve(None, "claude-cli", "claude-cli")`
      both return `Resolution(agent=None, source=DEFAULT)` — an explicit default pick collapses to
      the default path (byte-identical launch — REQ-COMPAT-01).
- [ ] Whitespace-only `run_selection` / `default_agent` are treated as unset (matches rauf's
      `pick()` at `agent-selection.ts:35`).
- [ ] The `07-testing-strategy.md` pytest asserts forge **never emits an `--agent` derived from a
      backlog item** — there is no code path in `resolve()` (or its callers) that reads
      `BacklogItem.provider` (REQ-AGENT-05).
- [ ] When the resolved agent is `None`, no `--agent` is appended and no probe runs (the launch
      command equals the pre-feature command — REQ-AGENT-03, REQ-PERF-01); cross-checked against
      `render_launch` (§3.4).
- [ ] Step 2d (in `skills/forge-5-loop/SKILL.md`) shows the agent choice + the resolved-agent
      line **only** when `loopRunner.agentArgument` is present (gate on); absent otherwise
      (REQ-PLUG-02) — cross-checked against `02-config-schema-and-gating.md §2`.
- [ ] The Step 2d inline optional-flags line lists `--agent <id>` and the
      `references/runner-contract.md` optional-flags catalog has the `--agent <id>` entry
      (REQ-AGENT-01).
- [ ] The Step 3c template in `references/runner-contract.md` contains the
      `Coding agent: … (source: …)` line (REQ-OBS-01).
- [ ] `events.ndjson` schema, the `statusJsonCommand` output, and the Step 3d Monitor filter are
      unchanged — no new event type is introduced (REQ-OBS-02): grep confirms no new event-type
      string added to the Monitor filter.
- [ ] After editing canonical `skills/` + `references/`, `python3 scripts/build-adapters.py
      --check` passes (no stale/hand-edited adapters) and `bash scripts/validate.sh` is green
      (CON-05).
