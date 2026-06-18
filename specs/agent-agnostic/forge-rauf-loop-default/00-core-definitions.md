# 00 — Core Definitions

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Source of truth: `PRD.md` (v1) + `tech-spec.md` (v1, §3.1–3.6, §4). Every later document in
> this suite references the types, constants, tokens, and result shapes defined here.
> Cross-references use exact filenames.

This document is the **shared contract surface** for the feature. It collects, in one place:
the consumed rauf types (fixed by CON-02, verified at source), the three new `loopRunner`
config fields this feature owns, the new `{agent}` template token, and the small result/finding
shapes the resolution + availability algorithm produces. The feature ships **no compiled
module** — feature-forge is a Claude-plugin repo of skill prose, JSON references, and Python
helpers (§`01-architecture-layout.md`). The only *callable* code is the executable spec
`references/loop-agent-selection.py` (Python 3.10+), so the owned result types below are given
as Python; the consumed rauf types are given as TypeScript exactly as they appear in rauf source.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-AGENT-02 | Project-default agent field | §3 (`defaultAgent`) |
| REQ-AGENT-05 | Per-item agent is pass-through (never read by forge) | §1.4 (`BacklogItem.provider`), §5 (note) |
| REQ-PREC-01 | Documented precedence parallel to model selection | §1.3 (`resolveAgentId`), §5 (`AgentSource`) |
| REQ-PLUG-01/02 | Capability gating on `agentArgument` presence | §3 (`agentArgument`), §6 |
| REQ-AVAIL-04 | Unknown-id classification | §4 (`Classification`, `UNKNOWN`) |
| REQ-AVAIL-02 | Known-but-unavailable classification | §4 (`Classification`, `UNAVAILABLE`) |
| REQ-SEC-01 | Allow-list = advertised id set | §4 (`AdvertisedSet`), §1.1 |
| REQ-BIN-02 | Version floor = 0.6.0 | §2 (`MIN_RUNNER_VERSION`) |
| REQ-AGENT-03 / REQ-COMPAT-01 | Runner default id ⇒ identical-to-today | §2 (`RUNNER_DEFAULT_ID`), §1.2 |
| CON-02 | Consumed surfaces fixed, not redesigned | §1 (all) |

## 1. Consumed rauf types (fixed by CON-02 — verified at source)

These are **not** defined or modified by this feature; they are the surfaces forge consumes.
Reproduced verbatim from rauf source so later docs can reference exact field names. All of these
exist in rauf **at VERSION `0.6.0`** (verified — see §2 and `05-runner-discovery-version-gate.md`).

### 1.1 `AgentAvailability` — the probe row

`packages/loop/src/providers/registry.ts:14` (rauf). Returned by `listAgents()`, rendered by
`rauf agents --json` as `{ agents: AgentAvailability[] }`.

```ts
/**
 * One row of the discovery surface: a static descriptor flattened with its
 * resolved live availability. Returned by listAgents(); rendered by `rauf agents`.
 * Not persisted; no schema impact.
 */
export interface AgentAvailability {
  /** Stable agent id (registry key). claude-cli | codex | gemini | copilot | cursor | generic-cli */
  id: string;
  /** Human-readable name (from the descriptor's displayName), e.g. "Claude Code (CLI)". */
  displayName: string;
  /** Executable probed on PATH, or undefined for binary-less descriptors (e.g. generic-cli). */
  binaryName?: string;
  /** Whether the agent's CLI / credentials are currently available (from detect). */
  available: boolean;
  /** Human-readable detail (PATH location, "not found", or credential status). */
  detail?: string;
}
```

The set of `id`s present in `agents[]` is the feature's **allow-list** (REQ-SEC-01) and the basis
for unknown-vs-unavailable disambiguation (§4, `04-availability-precheck.md`).

### 1.2 `RUNNER_DEFAULT_ID` / `DEFAULT_AGENT_ID`

`packages/loop/src/constants.ts:2` (rauf): `export const DEFAULT_AGENT_ID = "claude-cli";`

This is the agent rauf drives when no layer sets one. forge calls it `RUNNER_DEFAULT_ID` (§2): it
is the **id forge treats as "the default path"** — when the resolved agent is `none` *or* equals
this id, forge appends no agent argument and runs no probe (REQ-AGENT-03, REQ-COMPAT-01,
REQ-AVAIL-03, REQ-PERF-01). For rauf, `RUNNER_DEFAULT_ID == "claude-cli"`.

### 1.3 `resolveAgentId` — rauf's 5-layer precedence (NOT re-implemented by forge)

`packages/loop/src/agent-selection.ts:24` (rauf). Reproduced so the precedence forge documents
(§5, `03-selection-resolution-observability.md`) provably parallels rauf's:

```ts
export function resolveAgentId(input: {
  itemProvider?: string;   // BacklogItem.provider — per-item agent, HIGHEST precedence
  runProvider?: string;    // LoopStartOptions.provider — set from `--agent`
  projectProvider?: string;// project .rauf.json → MarkerOptions.provider
  globalProvider?: string; // global ~/.rauf/config.json → ToolConfig.defaultProvider
}): string;
// returns: itemProvider ?? runProvider ?? projectProvider ?? globalProvider ?? DEFAULT_AGENT_ID
// (empty/whitespace-only treated as unset)
```

**forge feeds only the `runProvider` (run) layer** via the rendered `--agent {agent}`. rauf alone
applies `itemProvider` *above* it. forge never reads `itemProvider`, `projectProvider`, or
`globalProvider` from rauf's surfaces — see §5 and `03-selection-resolution-observability.md §3`.

### 1.4 `BacklogItem.provider` — pass-through only

`packages/core/src/schemas.ts:72` (rauf): `provider: z.string().optional()`.

The per-item agent. **forge MUST NOT read, write, or override it** (REQ-AGENT-05). It is rauf's
`itemProvider` layer (§1.3), which sits *above* forge's run layer, so a per-item agent always wins.

## 2. Constants owned / pinned by this feature

```python
# references/loop-agent-selection.py (executable spec, Python 3.10+)

#: rauf's own default agent id — the "default path" sentinel (§1.2). For rauf == "claude-cli".
#: Passed into resolve()/classify() as a parameter, never hardcoded into the algorithm, so an
#: alternate runner with a different default id is handled without edits (CON-04).
RUNNER_DEFAULT_ID: str = "claude-cli"

#: Minimum rauf version that ships the agent-selection surface (--agent flag, `rauf agents`
#: probe, preset registry). Verified present in rauf source at VERSION 0.6.0
#: (packages/core/src/version.ts == "0.6.0"). REQ-BIN-02; resolves OQ-01.
MIN_RUNNER_VERSION: str = "0.6.0"
```

`MIN_RUNNER_VERSION` is the value the schema's `loopRunner.minRunnerVersion` default is bumped to
(0.5.0 → 0.6.0; `02-config-schema-and-gating.md`, `05-runner-discovery-version-gate.md`). It is
**not** a new persisted constant in feature-forge runtime code — feature-forge has none; it is the
schema default and the test's asserted value (`07-testing-strategy.md`).

## 3. New `loopRunner` config fields (owned by this feature)

Three flat string properties added to the `loopRunner` object in
`references/forge-config-schema.json`, matching the existing flat `*Command` convention (§3.8 of
the tech spec rejects a nested sub-object). Canonical definitions (full JSON Schema + the
capability-gate semantics are specified in `02-config-schema-and-gating.md`):

| Field | Type | Default | Role |
|-------|------|---------|------|
| `agentArgument` | `string` | `"--agent {agent}"` | Tokenized arg appended to the launch command when an agent is resolved. **Presence advertises the agent surface** (REQ-PLUG-01). `{agent}` is substituted only with a validated, advertised id (REQ-SEC-01). |
| `agentsProbeCommand` | `string` | `"{bin} agents --json"` | Availability probe. MUST emit `{ agents: AgentAvailability[] }` and exit 0. Run **once, no retries** before a non-default agent (REQ-PERF-02). |
| `defaultAgent` | `string` | `""` | Project-default agent id (REQ-AGENT-02). Empty ⇒ no project default (runner's own default applies). Overridden by the per-run selector. Ignored when `agentArgument` is absent. |

**Capability gate (REQ-PLUG-01/02):** `agentArgument` *present and non-empty* ⇒ "this runner has
an agent surface." When absent ⇒ no selector, no probe, no `{agent}` substitution, no agent
argument — byte-identical to today (REQ-COMPAT-01). The gate is a pure config-presence check,
requiring no runner round-trip. See `02-config-schema-and-gating.md §2`.

## 4. Owned result types — resolution & classification

The executable spec (`references/loop-agent-selection.py`) defines these; every consumer doc
(03, 04, 07) references them by name. Python 3.10+ (`X | Y` unions, `match`).

```python
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import TypedDict

#: The advertised id set parsed from the probe — { row.id for row in agents }. Doubles as
#: REQ-SEC-01's allow-list: the ONLY values ever interpolated into {agent}.
AdvertisedSet = frozenset[str]


class _AgentRow(TypedDict):
    """Required fields of one `rauf agents --json` probe row."""
    id: str            # stable registry key — the only field read for the advertised set
    displayName: str   # human-readable name (e.g. "Claude Code (CLI)")
    available: bool     # whether the agent's CLI / credentials are currently available


class AgentAvailability(_AgentRow, total=False):
    """One probe row — the Python mirror of the TS `AgentAvailability` interface in §1.1
    (what `rauf agents --json` emits per agent). The base `_AgentRow` carries the required
    fields; the optional fields below default to absent (`total=False`). Consumed by
    `classify` / `advertised_set` in `04-availability-precheck.md` — only `id` is read for
    the advertised set; `detail` is surfaced for the UNAVAILABLE warning. Split into a
    required base + optional subclass to stay Python 3.10-compatible (no `NotRequired`)."""
    binaryName: str    # executable probed on PATH, or absent for binary-less descriptors
    detail: str        # PATH location, "not found", or credential status


class AgentSource(str, Enum):
    """Which layer supplied the resolved agent — shown to the user (REQ-OBS-01)."""
    RUN = "run"          # per-run selector (Step 2d)
    PROJECT = "project"  # loopRunner.defaultAgent
    DEFAULT = "default"  # runner's own default (no forge layer set)


@dataclass(frozen=True)
class Resolution:
    """Result of forge collapsing its run+project layers into one value (§5).

    Attributes:
        agent: The resolved agent id, or None when no forge layer is set (the
            default path — append nothing; rauf applies RUNNER_DEFAULT_ID).
        source: Which layer supplied it (RUN/PROJECT/DEFAULT) — for observability.
    """
    agent: str | None
    source: AgentSource


class Verdict(str, Enum):
    """Outcome of classifying a non-default resolved agent against the probe (§4, REQ-AVAIL-*)."""
    AVAILABLE = "available"      # id ∈ advertised set AND available == true ⇒ proceed
    UNAVAILABLE = "unavailable"  # id ∈ advertised set AND available == false ⇒ warn/proceed-or-choose (REQ-AVAIL-02)
    UNKNOWN = "unknown"          # id ∉ advertised set ⇒ HARD-REJECT before launch (REQ-AVAIL-04)


@dataclass(frozen=True)
class Classification:
    """Verdict plus the context needed to act on it.

    Attributes:
        verdict: AVAILABLE | UNAVAILABLE | UNKNOWN.
        detail: For UNAVAILABLE, the probe row's `detail` (PATH/credential status). None otherwise.
        valid_ids: For UNKNOWN, sorted(advertised set) to list in the rejection error. None otherwise.

    Invariant: `detail` is set iff `verdict == UNAVAILABLE`; `valid_ids` is set iff
    `verdict == UNKNOWN`; both are None for AVAILABLE. Enforced by `classify`'s construction
    (04 §3.2), not by the dataclass itself.
    """
    verdict: Verdict
    detail: str | None = None
    valid_ids: tuple[str, ...] | None = None
```

**Disambiguation rule (REQ-AVAIL-04 vs REQ-AVAIL-02), verified against rauf source:**
`rauf agents --json` **always exits 0**; an unknown id simply never appears in `agents[]`, while a
known-unavailable one appears with `available: false`. So unknown-vs-unavailable is decidable
**only by set membership** in `AdvertisedSet` — not by exit code. Full algorithm in
`04-availability-precheck.md`.

## 5. Precedence & forge's ownership boundary (REQ-PREC-01/02, REQ-AGENT-05)

The **observable precedence** is `item > run > project > default`, realized as:

```
item        ▸ rauf, from BacklogItem.provider (forge never touches it — §1.4)
run         ▸ forge's per-run selector  ┐ forge collapses these two into ONE
project     ▸ forge's defaultAgent      ┘ `--agent {agent}` value (Resolution.agent)
default     ▸ rauf's RUNNER_DEFAULT_ID ("claude-cli") when forge sends nothing
```

forge owns **only** the run and project layers, and decides run-over-project *inside itself*
before emitting the single `--agent` (REQ-PREC-02). rauf applies the item override above forge's
run layer (REQ-AGENT-05) and falls through to `RUNNER_DEFAULT_ID`. **forge never re-implements
rauf's resolver** (CON-02/CON-04) — see `03-selection-resolution-observability.md §3`.

## 6. The `{agent}` template token

The existing token vocabulary (`{bin}`, `{backlogDir}`, `{specsDir}`, `{iterations}`) gains
**`{agent}`**, substituted **only** inside `agentArgument` and **only** with a member of the
advertised id set (the allow-list, §4 / REQ-SEC-01). No `{agent}` substitution occurs on the
default path or when the capability gate (§3) is off. Token-substitution mechanics:
`02-config-schema-and-gating.md`.

## Dependencies

None — this is the foundation document. Every other document in the suite depends on it.

## Verification

- [ ] `AgentAvailability` field names here match `packages/loop/src/providers/registry.ts:14` in rauf.
- [ ] `RUNNER_DEFAULT_ID == "claude-cli"` matches `packages/loop/src/constants.ts:2`.
- [ ] `MIN_RUNNER_VERSION == "0.6.0"` matches `packages/core/src/version.ts`.
- [ ] The three `loopRunner` field names/defaults match `02-config-schema-and-gating.md` exactly.
- [ ] `Resolution`, `Classification`, `Verdict`, `AgentSource` names are used unchanged by docs 03/04/07.
- [ ] `{agent}` is the only new token, and only appears inside `agentArgument`.
