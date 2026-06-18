# 04 — Availability Pre-Check, Disambiguation & Security Allow-List

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Source of truth: `PRD.md` (v1, §3.4 availability pre-check, §4.2 security) + `tech-spec.md`
> (v1, §3.3 pre-check + unknown/unavailable disambiguation, §7 error-handling table). Shared
> types/constants live in `00-core-definitions.md`. Cross-references use exact filenames.

This document specifies the **availability pre-check** step of `forge-5-loop`: when it runs, how
the probe is invoked and parsed, how the advertised id set is built, the three-way classification
(UNKNOWN / UNAVAILABLE / AVAILABLE), how forge acts on each verdict, probe-failure handling, the
confirm-time agent listing, and the security allow-list. It builds on the `Verdict`,
`Classification`, and `AdvertisedSet` types defined in `00-core-definitions.md §4` and the
capability gate defined in `02-config-schema-and-gating.md`. It consumes the resolved agent
produced by `03-selection-resolution-observability.md` (`Resolution.agent`).

The only *callable* artifact this feature ships is the executable spec
`references/loop-agent-selection.py` (Python 3.10+); the `classify` function specified here is part
of it. All other behavior (probe invocation, the `AskUserQuestion` flow, the rejection error text)
is **skill prose** rendered in `skills/forge-5-loop/SKILL.md` Step 2d and
`skills/forge-5-loop/references/runner-contract.md` (see `01-architecture-layout.md §2`).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-AVAIL-01 | Non-default agent ⇒ verify available BEFORE launching | §1, §2 |
| REQ-AVAIL-02 | Known-but-unavailable ⇒ warn + proceed-anyway OR choose-another; never silent | §3 (UNAVAILABLE), §4.2 |
| REQ-AVAIL-03 | NO pre-check on the default / claude-cli path | §1 |
| REQ-AVAIL-04 | Unknown id ⇒ hard-reject before any side-effect, listing valid ids; no proceed-anyway | §3 (UNKNOWN), §4.1 |
| REQ-AGENT-04 | Pre-launch confirmation lists the available coding agents from the probe | §6 |
| REQ-SEC-01 | Advertised id set is the allow-list; only a member interpolates into `{agent}` | §3, §4.1, §7 |
| REQ-PERF-02 | Probe runs ONCE, no retries | §2 |

## 1. When the pre-check runs

The pre-check is **conditional on two gates**, both upstream of this document:

1. **Capability gate ON** — `loopRunner.agentArgument` is present and non-empty
   (`02-config-schema-and-gating.md §2`, `00-core-definitions.md §3`). When it is absent, there is
   no selector, no probe, and no `{agent}` substitution; this entire document is skipped
   (REQ-PLUG-01/02). The gate is a pure config-presence check requiring no runner round-trip.
2. **The resolved agent is a NON-default id** — `Resolution.agent` from
   `03-selection-resolution-observability.md §3` is **not `None`** and **does not equal
   `RUNNER_DEFAULT_ID`** (`claude-cli` for rauf; `00-core-definitions.md §1.2/§2`).

| `Resolution.agent` | Capability gate | Pre-check runs? | Rationale |
|--------------------|-----------------|-----------------|-----------|
| `None` (no forge layer set) | on | **No** | Default path — rauf applies its own default; append nothing (REQ-AVAIL-03, REQ-PERF-01). |
| `== RUNNER_DEFAULT_ID` (`"claude-cli"`) | on | **No** | Default/claude path — byte-identical to today (REQ-AVAIL-03, REQ-AGENT-03, REQ-COMPAT-01). |
| Non-default id (e.g. `"codex"`) | on | **Yes** | Must verify before a long run (REQ-AVAIL-01). |
| any | **off** (`agentArgument` absent) | **No** | Alternate runner with no agent surface (REQ-PLUG-01/02). |

**REQ-AVAIL-03 is structural, not a runtime branch inside the probe:** by
`03-selection-resolution-observability.md §3`, the default/claude-cli path never reaches this step,
so the common case incurs **no** extra probe and behaves exactly as today (REQ-PERF-01). The
"non-default" test below is the single guard:

```python
def needs_precheck(resolution_agent: str | None, runner_default_id: str) -> bool:
    """Whether the availability pre-check must run for this resolved agent.

    The pre-check runs only for a non-default agent on an agent-surface runner
    (the capability gate is checked separately, upstream — see §1). The default
    path (None or the runner's own default id) is skipped entirely so the common
    case incurs no extra probe (REQ-AVAIL-03, REQ-PERF-01).

    Args:
        resolution_agent: Resolution.agent from
            03-selection-resolution-observability.md — the agent id forge
            resolved from its run+project layers, or None for the default path.
        runner_default_id: The runner's own default agent id
            (RUNNER_DEFAULT_ID == "claude-cli" for rauf; 00-core-definitions.md §2).

    Returns:
        True iff resolution_agent is a non-empty, non-default id (the pre-check
        must run); False for None or the runner default (skip the probe).
    """
    return resolution_agent is not None and resolution_agent != runner_default_id
```

> Cross-ref: `02-config-schema-and-gating.md` owns the capability-gate definition; this document
> assumes the gate is ON. `03-selection-resolution-observability.md` owns producing
> `Resolution.agent`; this document consumes it.

## 2. Probe invocation

When §1's conditions hold, forge renders `loopRunner.agentsProbeCommand` **once** and executes it.

**Render.** `agentsProbeCommand` default is `"{bin} agents --json"` (`00-core-definitions.md §3`,
`02-config-schema-and-gating.md`). The only token substituted is `{bin}` (the located runner
binary, default `rauf` on PATH — `05-runner-discovery-version-gate.md`). The rendered command for
rauf is:

```
rauf agents --json
```

**No retries (REQ-PERF-02).** The probe is invoked exactly once. There is no retry loop, no
backoff, and no second probe later in the same launch. A single bounded invocation is the entire
pre-check cost, so launch is not delayed beyond that one call (PRD §4.1 REQ-PERF-02).

**Expected output (consumed contract, CON-02).** stdout is a single JSON object
`{ agents: AgentAvailability[] }` and the process **exits 0** — verified at rauf source
(`packages/cli/src/loop-commands.ts:1190` `handleAgents`; see §3 below for the exact citation and
exit-code guarantee). Each row is an `AgentAvailability` as defined in `00-core-definitions.md §1.1`
(`packages/loop/src/providers/registry.ts:14`): `{ id, displayName, binaryName?, available,
detail? }`.

**Parse + build the advertised set.** forge parses the JSON, reads `agents`, and builds the
allow-list:

```python
AdvertisedSet = frozenset[str]  # from 00-core-definitions.md §4

def advertised_set(agents: list[dict[str, object]]) -> AdvertisedSet:
    """Build the advertised id set (the allow-list) from parsed probe rows.

    AdvertisedSet = { row["id"] for row in agents }. This set is both the basis
    for unknown-vs-unavailable disambiguation (§3) and REQ-SEC-01's allow-list:
    the ONLY values ever interpolated into the {agent} token (§7).

    Args:
        agents: The parsed `agents` array from `{ agents: AgentAvailability[] }`.
            Each element is the dict form of an AgentAvailability row
            (00-core-definitions.md §1.1).

    Returns:
        A frozenset of every advertised agent id.
    """
    return frozenset(str(row["id"]) for row in agents)
```

**Parse-error / non-zero-exit handling** is specified in §5 (probe failure). Anything that is not
"exit 0 with parseable `{ agents: [...] }`" is a probe failure, never silently treated as an empty
set.

## 3. Classification

With `AdvertisedSet` built, forge classifies the resolved non-default agent into exactly one
`Verdict` (`00-core-definitions.md §4`). The decision is keyed on **set membership** and the row's
`available` flag — never on the probe's exit code (see "Why membership, not exit code" below).

### 3.1 Decision table

| Condition | Verdict | Classification fields | Action (§4) |
|-----------|---------|-----------------------|-------------|
| `agent ∉ AdvertisedSet` | `UNKNOWN` | `valid_ids = sorted(AdvertisedSet)` | **Hard-reject** before launch; error lists `valid_ids`; no proceed-anyway; no `{agent}` substitution (REQ-AVAIL-04, REQ-SEC-01). |
| `agent ∈ AdvertisedSet` and the matching row's `available == False` | `UNAVAILABLE` | `detail = row.detail` | Warn with `detail`; `AskUserQuestion` → proceed-anyway / choose-another; never silent (REQ-AVAIL-02). |
| `agent ∈ AdvertisedSet` and the matching row's `available == True` | `AVAILABLE` | (none) | Proceed (REQ-AVAIL-01 satisfied). |

### 3.2 `classify` — the executable-spec signature

This is the canonical signature as it appears in `references/loop-agent-selection.py`
(`07-testing-strategy.md` imports it). `Verdict` and `Classification` are imported from the same
module (`00-core-definitions.md §4`).

```python
from __future__ import annotations

from loop_agent_selection import (  # all defined in this same single module (00-core-definitions.md §4)
    AgentAvailability,  # the TypedDict probe-row shape (00 §4, mirrors the TS row in §1.1)
    Classification,
    Verdict,
)


def classify(
    resolved_agent: str,
    agents: list[AgentAvailability],
    runner_default_id: str,
) -> Classification:
    """Classify a non-default resolved agent against the probe's advertised rows.

    Disambiguates the three pre-check outcomes by MEMBERSHIP in the advertised id
    set, then (for members) by the matching row's `available` flag — never by the
    probe's exit code, because `rauf agents --json` always exits 0 (an unknown id
    is simply absent; a known-unavailable one is present with available=False).
    See "Why membership, not exit code" in §3.3.

    This function assumes `resolved_agent` is a non-default id (the default path
    never reaches the pre-check — §1, REQ-AVAIL-03); callers gate with
    `needs_precheck` (§1) before invoking it.

    Args:
        resolved_agent: The non-default agent id forge resolved (Resolution.agent,
            03-selection-resolution-observability.md §3). Non-empty, != runner_default_id.
        agents: The parsed `agents` rows from the probe
            (`{ agents: AgentAvailability[] }`, 00-core-definitions.md §1.1).
        runner_default_id: The runner's own default id (RUNNER_DEFAULT_ID, accepted
            as a parameter so an alternate runner's default needs no code edit; CON-04).
            Present for symmetry with `resolve`/`needs_precheck`; the default id never
            reaches this function in practice.

    Returns:
        A Classification:
          - Verdict.UNKNOWN     with valid_ids = sorted advertised ids, when the id
                                is not advertised (REQ-AVAIL-04).
          - Verdict.UNAVAILABLE with detail = the row's `detail`, when advertised but
                                available is False (REQ-AVAIL-02).
          - Verdict.AVAILABLE   when advertised and available is True (REQ-AVAIL-01).

    Raises:
        Never. Classification is total over the inputs; malformed probe output is a
        probe failure handled BEFORE this call (§5), not here.
    """
    advertised: dict[str, AgentAvailability] = {str(row["id"]): row for row in agents}

    match advertised.get(resolved_agent):
        case None:
            # Not advertised ⇒ unknown / typo / unsupported. REQ-AVAIL-04.
            return Classification(
                verdict=Verdict.UNKNOWN,
                valid_ids=tuple(sorted(advertised)),
            )
        case {"available": True}:
            return Classification(verdict=Verdict.AVAILABLE)
        case row:
            # Advertised but not available ⇒ known-but-unavailable. REQ-AVAIL-02.
            return Classification(
                verdict=Verdict.UNAVAILABLE,
                detail=row.get("detail"),
            )
```

> Note on the `match`: the `{"available": True}` mapping pattern matches a row whose `available`
> key is exactly `True`; every other advertised row (including `available: False`) falls to the
> final `case row` UNAVAILABLE branch. `runner_default_id` is in the signature for symmetry with
> the sibling `resolve`/`needs_precheck` functions and to keep the algorithm
> default-id-parameterized (CON-04), even though the default id never reaches `classify`.

### 3.3 Why membership, not exit code (verified against rauf source)

`rauf agents --json` **always exits 0.** Verified at source:

- `packages/cli/src/loop-commands.ts:1190` — `handleAgents(ctx)`:
  - `rows = await listAgents()` — "never rejects; unavailable agents are data, not errors"
    (source comment, line 1193). `listAgents` is imported at `loop-commands.ts:44` from the
    registry.
  - For the `--json` path (`ctx.globalFlags.json`), `outputJson({ agents: rows })` then
    `return ExitCode.SUCCESS;` (lines 1199–1202). `ExitCode.SUCCESS == 0`.
  - The function's docstring states it "Never fails on an unavailable agent: an absent CLI is
    reported as `available: false`, not an error" and returns `ExitCode.ERROR` (1) "only on an
    unexpected internal failure (listAgents never rejects, so defensive)" (lines 1182–1188).
- `AgentAvailability` row shape — `packages/loop/src/providers/registry.ts:14` (reproduced in
  `00-core-definitions.md §1.1`).

**Consequence.** Because the exit code is always 0 regardless of whether the requested id is
present, the unknown-vs-unavailable split is **not** decidable by exit code. It is decidable
**only** by set membership:

- An **unknown** id (typo / unsupported) simply never appears in `agents[]` ⇒ `agent ∉
  AdvertisedSet` ⇒ `UNKNOWN` (REQ-AVAIL-04).
- A **known-but-unavailable** id appears with `available: false` ⇒ `agent ∈ AdvertisedSet` and
  `available == False` ⇒ `UNAVAILABLE` (REQ-AVAIL-02).

This is exactly the disambiguation REQ-AVAIL-04 (vs REQ-AVAIL-02) requires, and it is why
`classify` keys on membership in `AdvertisedSet`. The same set `A` is REQ-SEC-01's allow-list
(§7).

## 4. Acting on each verdict

Forge maps each `Verdict` to a concrete action. Verdict actions live in `forge-5-loop` Step 2d
prose (`skills/forge-5-loop/SKILL.md`) and `runner-contract.md`'s `## Agent selection` section
(`01-architecture-layout.md §2`).

### 4.1 `UNKNOWN` → hard-reject before launch (REQ-AVAIL-04, REQ-SEC-01)

- **STOP before any loop side-effect.** No run command is rendered, no `{agent}` substitution
  happens, and the run never starts. This mirrors REQ-BIN-04's "fail clearly before side-effects"
  posture (PRD §3.4 notes).
- **The error lists the valid ids** — `Classification.valid_ids`, which is `sorted(AdvertisedSet)`.
- **No proceed-anyway path.** This is the explicit distinction from `UNAVAILABLE` (§4.2): an
  unknown id is NOT offered a "proceed anyway" choice (PRD REQ-AVAIL-04).
- **No interpolation.** The rejected (unknown) value is never substituted into `{agent}` and never
  reaches the shell (REQ-SEC-01, §7).

Error message shape (rendered by the skill; not a thrown Python exception — forge stages are skill
prose):

```
Selected agent 'cdoex' is not a known agent for this runner.
Valid agent ids: claude-cli, codex, copilot, cursor, gemini, generic-cli
Re-run with one of the above, set loopRunner.defaultAgent, or run on the default agent.
```

The id list is `Classification.valid_ids` joined with `", "`. The illustrative ids above are
rauf's preset registry ids (`00-core-definitions.md §1.1`); the actual list is always whatever the
probe advertised at run time.

### 4.2 `UNAVAILABLE` → warn + proceed-anyway / choose-another (REQ-AVAIL-02)

- **Warn**, surfacing `Classification.detail` (the probe row's `detail`: PATH location, "not
  found", or credential status — `00-core-definitions.md §1.1`).
- **Offer two choices via `AskUserQuestion`** — never silently abort, never silently proceed
  (PRD REQ-AVAIL-02):
  1. **Proceed anyway** — launch with the chosen agent despite the unavailability warning. (rauf is
     the authority on whether the agent ultimately runs; forge has surfaced the risk.)
  2. **Choose another** — re-present the selector populated from the **same** parsed `agents[]`
     (§6), so the user picks a different installed agent. Re-selection re-enters resolution
     (`03-selection-resolution-observability.md §3`); the pre-check re-runs for the new non-default
     id (one probe per resolved non-default id).
- A third implicit outcome is **abort** (the user declines both via `AskUserQuestion`'s
  cancel) — forge stops without launching.

Warning shape (rendered by the skill):

```
WARNING: agent 'codex' is registered but not currently available.
  detail: codex CLI not found on PATH
Proceed anyway, or choose another agent?
```

### 4.3 `AVAILABLE` → proceed (REQ-AVAIL-01)

The resolved id is advertised and available. Forge proceeds to render the launch command, appending
the validated id via `agentArgument` (`render_launch` in
`03-selection-resolution-observability.md` / the executable spec). The validated id is, by
construction, a member of `AdvertisedSet` — the allow-list (§7).

## 5. Probe failure handling

A **probe failure** is any outcome that is not "exit 0 with parseable `{ agents: [...] }` carrying a
usable advertised set":

- Non-zero exit from `agentsProbeCommand`.
- stdout that is not valid JSON, or valid JSON missing the `agents` array (wrong shape).
- valid JSON whose `agents` array is **empty** (`[]`), or whose rows **lack the required `id`
  field** — the probe yielded no usable advertised set, so a non-default selection cannot be
  validated. Treating these as a probe failure is what lets `advertised_set` (§2) assume every row
  has an `id` (no `KeyError`) and keeps `classify` from producing an UNKNOWN rejection with an empty
  `valid_ids` list ("Valid agent ids: " with nothing after it).
- The probe binary not found / not executable (a discovery problem — but see note below).

**Behavior (tech-spec §7 row).** A probe failure means forge **cannot validate** a non-default
agent. forge MUST:

1. **Surface the failure** plainly (what was run, the exit code or parse error).
2. Let the user **choose another** agent or **abort** the run (via `AskUserQuestion`).
3. **NOT launch a non-default agent unvalidated** — forge never falls back to silently running the
   selected non-default agent when it could not confirm membership/availability (REQ-AVAIL-01). It
   also does not silently fall back to the default agent (that would mask the user's explicit
   selection); the user decides.

Probe failure is distinct from `UNKNOWN`: an UNKNOWN verdict is the result of a **successful** probe
(exit 0, parseable) whose advertised set simply omits the id. A probe failure means the probe itself
did not produce a usable answer, so no verdict can be computed — `classify` is never called (it
`Raises: Never` precisely because malformed output is handled here, §3.2).

> Note (discovery vs. probe): a missing/too-old runner binary is caught earlier by the version gate
> at Step 1c (`05-runner-discovery-version-gate.md`, REQ-BIN-04), before the pre-check. By the time
> the pre-check runs, `{bin}` has already been located and version-gated; a probe failure here is
> therefore an unexpected runner error, not a missing-binary case.

Probe-failure prompt shape (rendered by the skill):

```
Could not verify agent availability — the probe failed.
  command: rauf agents --json
  exit: 1   (or: could not parse JSON output)
Cannot validate 'codex' before launch. Choose another agent or abort?
```

## 6. Confirm-time listing (REQ-AGENT-04)

When the pre-check has run (a non-default agent on an agent-surface runner), the parsed `agents[]`
is shown in the **Step 2d pre-launch confirmation** so the user picks from what is actually
installed. The listing is **informational at confirm time** (PRD REQ-AGENT-04 note) and is the same
parsed array used for classification (§3) — it is not a second probe (REQ-PERF-02: one probe).

Each listed row shows three `AgentAvailability` fields (`00-core-definitions.md §1.1`):

| Column | Source field | Notes |
|--------|--------------|-------|
| id | `id` | The value the user selects / that fills `{agent}`. |
| name | `displayName` | Human-readable, e.g. "Codex CLI". |
| available | `available` | `yes` / `no` — drives the choose-another flow (§4.2). |

Illustrative confirm-time listing (rendered by the skill; ids/names are whatever the probe
returned):

```
Available coding agents (from `rauf agents --json`):
  claude-cli   Claude Code (CLI)   yes   (default)
  codex        Codex CLI           no    codex CLI not found on PATH
  gemini       Gemini CLI          yes
  copilot      Copilot CLI         yes
  cursor       Cursor Agent        yes
```

This listing also populates the **choose-another** re-selection in the UNAVAILABLE flow (§4.2) and
the run-level selector's options described in `03-selection-resolution-observability.md` (Step 2d).
The `detail` field is shown alongside an `available: no` row to explain the unavailability (as in
the `codex` row above).

> Cross-ref: `03-selection-resolution-observability.md` owns the Step 2d selector UX and the "loop
> started" / source-layer observability (REQ-OBS-01); this document owns the availability column and
> the unknown/unavailable disambiguation feeding it.

## 7. Security — the advertised set is the allow-list (REQ-SEC-01)

`AdvertisedSet` (§2) **is** the security allow-list. The guarantees:

- **Only a validated member ever fills `{agent}`.** The `{agent}` token (`00-core-definitions.md
  §6`) is substituted **only** inside `agentArgument`, and **only** with a value that classified as
  `AVAILABLE` or that the user explicitly chose "proceed anyway" for from an `UNAVAILABLE`
  member — both of which are members of `AdvertisedSet`. An `UNKNOWN` id is hard-rejected (§4.1) and
  is **never** interpolated.
- **No arbitrary string reaches the shell** beyond the contract's tokenized argument. Because the
  only interpolated values are members of `AdvertisedSet` (a set built from rauf's own advertised
  ids), a typo'd or attacker-supplied selector value cannot pass membership and therefore cannot
  reach the rendered command (REQ-SEC-01). The selector value is constrained to the runner's known
  agent ids, consistent with how existing flags are templated (PRD §4.2).
- **The behavior for a non-member is REQ-AVAIL-04** — hard-reject before launch, listing the valid
  ids (§4.1). REQ-SEC-01's "what if the value is not a known id" is defined by REQ-AVAIL-04 (PRD
  §4.2 note).
- **The default path never substitutes `{agent}`** (`00-core-definitions.md §6`, §1 here), so the
  allow-list is only ever consulted for a non-default agent.

The allow-list is therefore enforced at exactly one point: between `classify` returning a non-UNKNOWN
verdict (for a member) and `render_launch` interpolating `{agent}`. No code path appends
`agentArgument` for a value that is not a member of `AdvertisedSet`.

## Dependencies

Implement after these documents (their types/edits are consumed here):

- **`00-core-definitions.md`** — `AgentAvailability` (§1.1), `RUNNER_DEFAULT_ID` (§1.2/§2),
  `AdvertisedSet`, `Verdict`, `Classification` (§4), the `{agent}` token (§6), and the
  membership-based disambiguation rule (§4).
- **`02-config-schema-and-gating.md`** — the capability gate (`agentArgument` presence) that gates
  whether this document runs at all, and the `agentsProbeCommand` field rendered in §2.
- **`03-selection-resolution-observability.md`** — produces `Resolution.agent` (the resolved
  non-default id this pre-check validates) and owns the Step 2d selector + `render_launch` that
  consumes an `AVAILABLE`/proceed-anyway verdict.

Consumed (external, fixed by CON-02, verified at source):

- rauf `rauf agents --json` → `packages/cli/src/loop-commands.ts:1190` `handleAgents` (always
  exits 0; §3.3).
- rauf `AgentAvailability` → `packages/loop/src/providers/registry.ts:14`.

Downstream:

- **`07-testing-strategy.md`** — the pytest imports and exercises `classify`/`needs_precheck` from
  `references/loop-agent-selection.py` against the mock-rauf fixture.

## Verification

Concrete checks an implementation must satisfy. `07-testing-strategy.md` automates the `classify`
cases against `tests/fixtures/mock-rauf/` (a canned `agents --json` mixing one available default,
one available non-default, one `available:false` known, and no row for an unknown id).

- [ ] `needs_precheck(None, "claude-cli")` and `needs_precheck("claude-cli", "claude-cli")` both
      return `False`; `needs_precheck("codex", "claude-cli")` returns `True` (REQ-AVAIL-03).
- [ ] The probe is invoked **exactly once** for a non-default agent — no retry, no second probe
      (REQ-PERF-02). (Assertable via mock-rauf argv-recording: one `agents --json` invocation.)
- [ ] `classify("codex", agents, "claude-cli")` where `codex` is present with `available:true`
      ⇒ `Verdict.AVAILABLE` (REQ-AVAIL-01).
- [ ] `classify("codex", agents, "claude-cli")` where `codex` is present with `available:false`
      ⇒ `Verdict.UNAVAILABLE` and `detail` equals the row's `detail` (REQ-AVAIL-02).
- [ ] `classify("cdoex", agents, "claude-cli")` where `cdoex` is absent from `agents`
      ⇒ `Verdict.UNKNOWN` and `valid_ids == sorted(AdvertisedSet)` (REQ-AVAIL-04).
- [ ] The UNKNOWN rejection error text contains the joined `valid_ids` and offers **no**
      proceed-anyway path (REQ-AVAIL-04); the UNAVAILABLE flow offers proceed-anyway **and**
      choose-another (REQ-AVAIL-02).
- [ ] No code path interpolates `{agent}` with a value `∉ AdvertisedSet` (REQ-SEC-01) — verified by
      the render test only emitting `--agent <id>` for a validated/proceeded member.
- [ ] A non-zero exit or unparseable JSON from the probe surfaces a failure and offers
      choose-another/abort; it never launches the non-default agent unvalidated (tech-spec §7).
- [ ] The Step 2d confirm-time listing shows `id`, `displayName`, and `available` for every parsed
      row, reusing the single parsed `agents[]` (no second probe) (REQ-AGENT-04, REQ-PERF-02).
- [ ] With the capability gate OFF (`agentArgument` absent), the pre-check, probe, and listing do
      not run at all (REQ-PLUG-01/02; see `02-config-schema-and-gating.md`).
