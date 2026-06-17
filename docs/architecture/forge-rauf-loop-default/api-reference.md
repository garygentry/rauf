# API Reference

Three surfaces make up this feature: the `loopRunner` **config fields**, the runner
**probe contract**, and the **executable-spec functions** in
`references/loop-agent-selection.py`.

## `loopRunner` config fields (`forge.config.json`)

All three are flat string fields on the `loopRunner` object, tokenized like the existing
`*Command` fields. The **presence** of `agentArgument` is the capability gate.

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `agentArgument` | string | `"--agent {agent}"` | Tokenized argument appended to the launch command (`eventStreamCommand`/`runCommand`) when forge resolves a non-default agent. `{agent}` is substituted **only** with a validated, advertised id. Its presence arms the entire agent surface; omit it to disable. |
| `agentsProbeCommand` | string | `"{bin} agents --json"` | Availability probe. MUST emit `{ agents: [{ id, displayName, available, ... }] }` and exit 0. Run **once** (no retries) before launching a non-default agent. |
| `defaultAgent` | string | `""` | Project-default agent id, so a project can fix its agent once. `""` ⇒ no project default (the runner's own default applies). Overridden by the per-run selector. |

Two existing fields changed:

| Field | Change |
|-------|--------|
| `minRunnerVersion` | Default bumped `0.5.0` → **`0.6.0`** — the agent-surface floor (the rauf release shipping `--agent`, the `agents` probe, and the preset registry). |
| `installHint` | Now names two binary-provisioning paths: the cross-agent installer (`npx feature-forge install`, recording the pinned `rauf@0.6.0`) **and** the direct rauf CLI one-liner (`curl … install-binary.sh \| bash`). `setupHint` is unchanged. |

## Probe contract (`agents --json`)

The probe command MUST:

- **Always exit 0.** Availability is conveyed in the data, never the exit code. An
  unknown id is *absent*; a known-unavailable id is *present* with `available: false`.
- Emit `{ "agents": [ AgentAvailability, … ] }` on stdout.

Each `AgentAvailability` row:

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Stable registry key — the only field read for the advertised (allow-list) set. |
| `displayName` | yes | Human-readable name (e.g. `"Claude Code (CLI)"`). |
| `available` | yes | Whether the agent's CLI / credentials are currently present. |
| `binaryName` | no | Executable probed on PATH (absent for binary-less descriptors). |
| `detail` | no | PATH location, `"not found"`, or credential status — surfaced in the UNAVAILABLE warning. |

## `loop-agent-selection.py`

The executable spec. **Test-only + documentation**: pure, total, stdlib-only (Python
3.10+), takes no backlog item and accepts no item-provider/backlog argument
(REQ-AGENT-05). Not wired into any adapter.

### Constants

```python
RUNNER_DEFAULT_ID: str = "claude-cli"   # rauf's own default agent id (the "default path" sentinel)
MIN_RUNNER_VERSION: str = "0.6.0"       # agent-surface floor; verified in rauf source
```

### Types

```python
AdvertisedSet = frozenset[str]          # { row.id for row in agents } — also REQ-SEC-01's allow-list

class AgentSource(str, Enum):           # which layer supplied the resolved agent
    RUN = "run"; PROJECT = "project"; DEFAULT = "default"

@dataclass(frozen=True)
class Resolution:
    agent: str | None                   # resolved id, or None on the default path
    source: AgentSource

class Verdict(str, Enum):
    AVAILABLE = "available"; UNAVAILABLE = "unavailable"; UNKNOWN = "unknown"

@dataclass(frozen=True)
class Classification:
    verdict: Verdict
    detail: str | None = None           # set iff UNAVAILABLE (the row's detail)
    valid_ids: tuple[str, ...] | None = None   # set iff UNKNOWN (sorted advertised ids)
```

### Functions

#### `resolve(run_selection, default_agent, runner_default_id) -> Resolution`

Collapses forge's run + project layers into one value. Precedence `run_selection >
default_agent`; empty/whitespace is unset; a pick equal to `runner_default_id` collapses
to `Resolution(None, DEFAULT)`.

```python
from loop_agent_selection import resolve, AgentSource, Resolution

resolve("codex", "gemini", "claude-cli")   == Resolution("codex", AgentSource.RUN)
resolve(None,    "gemini", "claude-cli")   == Resolution("gemini", AgentSource.PROJECT)
resolve(None,    "",       "claude-cli")   == Resolution(None,    AgentSource.DEFAULT)
resolve("claude-cli", "gemini", "claude-cli") == Resolution(None, AgentSource.DEFAULT)
```

#### `render_launch(base_cmd, agent_argument, resolved, runner_default_id) -> str`

Appends the agent argument, or returns `base_cmd` unchanged. Returns unchanged when
`agent_argument` is falsy (gate off), `resolved.agent` is None, or it equals the runner
default.

```python
from loop_agent_selection import render_launch, resolve

base = "rauf loop run . --backlog specs/auth --iterations 12"
render_launch(base, "--agent {agent}", resolve("codex", "", "claude-cli"), "claude-cli")
# → "rauf loop run . --backlog specs/auth --iterations 12 --agent codex"

render_launch(base, "--agent {agent}", resolve(None, "", "claude-cli"), "claude-cli")
# → base  (unchanged — default path)

render_launch(base, None, resolve("codex", "", "claude-cli"), "claude-cli")
# → base  (unchanged — capability gate off)
```

#### `needs_precheck(resolution_agent, runner_default_id) -> bool`

True iff the resolved agent is non-None and not the runner default — i.e. the pre-check
must run. The default path is skipped, so the common case runs no probe.

```python
from loop_agent_selection import needs_precheck

needs_precheck("codex", "claude-cli")       # True
needs_precheck(None, "claude-cli")          # False
needs_precheck("claude-cli", "claude-cli")  # False
```

#### `advertised_set(agents) -> AdvertisedSet`

`frozenset` of every row's `id`. The allow-list and the basis for unknown/unavailable
disambiguation.

```python
from loop_agent_selection import advertised_set

advertised_set([{"id": "claude-cli", ...}, {"id": "codex", ...}])
# → frozenset({"claude-cli", "codex"})
```

#### `classify(resolved_agent, agents, runner_default_id) -> Classification`

Three-way verdict by membership, then `available`. **Total — never raises** (probe
failure is handled by the caller before this point).

```python
from loop_agent_selection import classify, Verdict

agents = [
    {"id": "claude-cli", "displayName": "Claude Code (CLI)", "available": True},
    {"id": "codex",      "displayName": "Codex (CLI)",       "available": True},
    {"id": "gemini",     "displayName": "Gemini (CLI)",      "available": False,
     "detail": "gemini CLI not found on PATH"},
]

classify("codex",  agents, "claude-cli").verdict      # Verdict.AVAILABLE
c = classify("gemini", agents, "claude-cli")
c.verdict, c.detail                                   # (Verdict.UNAVAILABLE, "gemini CLI not found on PATH")
u = classify("bogus", agents, "claude-cli")
u.verdict, u.valid_ids                                # (Verdict.UNKNOWN, ("claude-cli", "codex", "gemini"))
```

## Exit-code / signal note

This feature adds **no** new event type and does not change forge-5-loop's NDJSON
Monitor filter (REQ-OBS-02). The resolved agent is surfaced only as human-readable
confirmation text (`Agent: <id> (source: <layer>)` at confirm time; `Coding agent: …` in
the "Loop started" template).
