# 02 — Config Schema & Capability Gating

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Source of truth: `tech-spec.md` (v1, §3.1, §3.8, §4) + `PRD.md` (v1, §3.1/3.5, §4.2). Shared
> types, constants, the `{agent}` token, and result shapes live in `00-core-definitions.md` —
> this document does **not** redefine them, it specifies their JSON-Schema realization and the
> capability gate. Cross-references use exact filenames.

This is the **canonical specification of the schema half** of the feature: the three new flat
`loopRunner` properties (`agentArgument`, `agentsProbeCommand`, `defaultAgent`), the
`minRunnerVersion` default-bump edit, the `{agent}` token-vocabulary addition, and the
**capability-gating semantics** that key off `agentArgument` presence. The single file edited is
`references/forge-config-schema.json` (the artifact's "language" is JSON Schema draft-07). This
document **resolves PRD OQ-02** (config shape: flat fields, presence-gated; project default is a
dedicated field). The VERSION-gate *behavior*, runner discovery, and install/setup hints are owned
by `05-runner-discovery-version-gate.md` — this document specifies only the *schema edit* to the
`minRunnerVersion` default and cross-references `05` for behavior.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-AGENT-02 | Project-default `defaultAgent` field | §1.3, §4 (`defaultAgent`) |
| REQ-PLUG-01 | Agent selection gated on runner advertising an agent surface | §2 |
| REQ-PLUG-02 | When gated off: no selector, no probe, no agent arg sent | §2 |
| REQ-DEF-02 | Pluggability via tokenized config — no hardcoded commands (schema half) | §1, §4 |
| REQ-SEC-01 | `{agent}` only ever substituted with a validated advertised id (constraint) | §3 (token), §4 (`agentArgument`) |
| REQ-COMPAT-01 | Absent `agentArgument` ⇒ byte-identical to today | §2 |
| REQ-BIN-02 | `minRunnerVersion` default bump `0.5.0`→`0.6.0` (schema-field half) | §5 |

## 1. The three new `loopRunner` properties

Three flat `string` properties are added to the existing `loopRunner` object in
`references/forge-config-schema.json` (the `loopRunner.properties` map). They match the established
**flat field convention** every other `loopRunner` property uses (`runCommand`,
`eventStreamCommand`, `validateCommand`, `statusJsonCommand`, …) — `type` / `default` /
`description`. No nesting is introduced (rationale: §6). The complete JSON-Schema fragment to add
is in **§4**; the defaults are taken verbatim from `00-core-definitions.md §3` and tech-spec §3.1.

### 1.1 `agentArgument` — the tokenized agent flag *and* the capability advertiser

`type: "string"`, `default: "--agent {agent}"`. The tokenized argument appended to the launch
command (`eventStreamCommand` / `runCommand`) when, and only when, forge resolves a non-default
agent (`03-selection-resolution-observability.md §3`). It contains the new `{agent}` token (§3),
which is substituted **only** with a member of the runner's advertised id set — the allow-list
parsed from the probe (`00-core-definitions.md §4`, REQ-SEC-01). The **presence** of this field is
the capability gate (§2): present-and-non-empty ⇒ the runner has an agent surface; absent ⇒ no
agent dimension at all.

### 1.2 `agentsProbeCommand` — the availability probe

`type: "string"`, `default: "{bin} agents --json"`. The command forge runs **once, no retries**
(REQ-PERF-02) before launching a non-default agent, to (a) validate the resolved id against the
advertised set and (b) report availability at confirm time (REQ-AGENT-04). It MUST emit
`{ agents: AgentAvailability[] }` (the consumed shape — `00-core-definitions.md §1.1`) and exit 0.
Its output is parsed and classified by the algorithm in `04-availability-precheck.md`. The default
uses the existing `{bin}` token. When absent (or when the capability gate is off), no pre-check
runs.

### 1.3 `defaultAgent` — the project-default agent id (REQ-AGENT-02)

`type: "string"`, `default: ""`. The project's default agent id, fixed once per project instead of
retyped every run (the user story behind REQ-AGENT-02). An **empty string** means *no project
default* — the runner's own default (`RUNNER_DEFAULT_ID` = `claude-cli` for rauf,
`00-core-definitions.md §1.2`) applies. It is **overridden by the per-run selector** (forge resolves
run-over-project *inside itself* before emitting the single `--agent`;
`03-selection-resolution-observability.md §3`, REQ-PREC-02). It is **ignored entirely when
`agentArgument` is absent** (§2). This is a dedicated field rather than folding the default into the
token (rationale: §6) — the decision that resolves OQ-02.

## 2. Capability gating (REQ-PLUG-01, REQ-PLUG-02, REQ-COMPAT-01)

The capability gate is a **pure config-presence check** on a single field — `loopRunner.agentArgument`.
It requires **no runner round-trip** (no probe, no version call) to decide.

**Gate rule:**

```
agentSurfaceEnabled  ⇔  loopRunner.agentArgument is present AND non-empty (after trim)
```

| `agentArgument` state | `agentSurfaceEnabled` | Consequence |
|-----------------------|-----------------------|-------------|
| present, non-empty (e.g. default `"--agent {agent}"`) | **true** | Step 2d run-level selector is offered; `agentsProbeCommand` may run; `defaultAgent` is honored; `{agent}` may be substituted; an agent argument may be appended. |
| absent (key omitted) | **false** | No selector in Step 2d; no probe; `defaultAgent` ignored; no `{agent}` substitution; **no agent argument ever sent**. |
| present but empty / whitespace-only | **false** | Same as absent — treated as "no agent surface." |

**Behavioral guarantees:**

- **REQ-PLUG-01** — Agent selection is gated on the runner *advertising* an agent surface, expressed
  purely as the presence of `agentArgument` in its `loopRunner` config. A runner whose config omits
  the field advertises no surface and forge omits agent selection entirely.
- **REQ-PLUG-02** — When the gate is off, the per-run selector and the availability pre-check MUST NOT
  appear or run, and no agent argument may be sent to the runner. (The *consuming* skill behavior is
  specified in `03-selection-resolution-observability.md` and `04-availability-precheck.md`; this
  document defines the gate condition those consumers read.)
- **REQ-COMPAT-01** — Because the default `loopRunner` (and the absent-`loopRunner` case, which falls
  back to the schema defaults) ships `agentArgument` with a non-empty default, the *default rauf path*
  keeps the surface enabled but still renders a **byte-identical command to today** whenever the
  resolved agent is `none` or `RUNNER_DEFAULT_ID` (no `{agent}` substitution occurs on the default
  path — `00-core-definitions.md §6`, `03 §4`). An **alternate runner that omits `agentArgument`**
  gets the surface fully removed, so its command is likewise byte-identical to a pre-feature
  template. Degradation is **silent, not an error** (tech-spec §3.1).

**This gate is distinct from the VERSION gate.** The capability gate (this section) decides *whether
an agent surface exists at all* from config presence — no runner call. The version gate
(`05-runner-discovery-version-gate.md`, REQ-BIN-02/04) decides *whether the located runner is recent
enough to actually carry that surface* by invoking `versionCommand` and semver-comparing against
`minRunnerVersion` (§5). They are independent: a runner may advertise `agentArgument` (capability
gate on) yet fail the version gate (too old), and vice-versa is impossible only because the default
config enables both.

## 3. Token vocabulary — `{agent}` (REQ-SEC-01, REQ-DEF-02)

The existing `loopRunner` token vocabulary is `{bin}`, `{backlogDir}`, `{specsDir}`, `{iterations}`
(documented in the `loopRunner.description` of the current schema). This feature adds **one** token:

| Token | Substituted with | Where it may appear | Constraint |
|-------|------------------|---------------------|------------|
| `{agent}` | a **validated, advertised** agent id (a member of the probe's `agents[].id` allow-list — `00-core-definitions.md §4`) | **only** inside `agentArgument` | Never substituted on the default path, never when the capability gate (§2) is off, never with an unvalidated string (REQ-SEC-01) |

**REQ-SEC-01 constraint (stated here; validation algorithm lives in `04-availability-precheck.md`):**
the only value ever interpolated into `{agent}` is an id that has already been confirmed to be a
member of the advertised id set `A = { row.id for row in agents }`. No arbitrary user string reaches
the shell beyond this tokenized argument — consistent with how the existing flags are templated. An
id that is *not* a member of `A` is hard-rejected **before** any substitution or launch (REQ-AVAIL-04;
the unknown-vs-unavailable disambiguation and the rejection error are specified in
`04-availability-precheck.md`). This document fixes the *constraint* on `{agent}`; it does not
re-specify the membership check.

The other four tokens are unchanged; `{agent}` is purely additive (REQ-DEF-02 — the schema half:
pluggability is expressed entirely as tokenized config, with no hardcoded `rauf …` command
introduced anywhere — `01-architecture-layout.md §2`).

## 4. Complete JSON-Schema fragment to add

Insert the following three properties into `references/forge-config-schema.json` at
`properties.loopRunner.properties`. Per `01-architecture-layout.md §2`, place them immediately after
the existing `defaultAgent`-adjacent command fields — a natural insertion point is **after
`versionCommand` and before `preconditionFile`** (grouping the agent surface with the other
runner-invocation templates). Exact JSON, draft-07, matching the surrounding field style and
description fidelity:

```json
"agentArgument": {
  "type": "string",
  "default": "--agent {agent}",
  "description": "Tokenized argument appended to the launch command (eventStreamCommand/runCommand) when forge resolves a non-default coding agent for the run. {agent} is substituted ONLY with a validated, advertised agent id (a member of the set agentsProbeCommand reports). PRESENCE of this field advertises the runner's agent surface: when present and non-empty, forge-5 offers the per-run agent selector, honors defaultAgent, and may run agentsProbeCommand; OMIT it for a runner with no agent dimension and forge skips agent selection entirely — no selector, no probe, no {agent} substitution, no agent argument sent (byte-identical to today). Distinct from the version gate (minRunnerVersion)."
},
"agentsProbeCommand": {
  "type": "string",
  "default": "{bin} agents --json",
  "description": "Coding-agent availability probe. MUST emit { agents: [{ id, displayName, available, ... }] } and exit 0 (it always exits 0: an unknown id simply never appears; a known-unavailable one appears with available:false). forge-5 runs it ONCE (no retries) before launching a non-default agent to (a) validate the resolved id against the advertised id set and (b) report availability in the pre-launch confirmation. Ignored on the default path and when agentArgument is absent."
},
"defaultAgent": {
  "type": "string",
  "default": "",
  "description": "Project-default coding agent id, so a project can fix its agent once without specifying it every run. Empty string ⇒ no project default (the runner's own default — claude-cli for rauf — applies, behaving exactly as today). Overridden by the per-run agent selector (run > project precedence, resolved inside forge before the single --agent is emitted). Ignored when agentArgument is absent."
}
```

Every value here traces to `00-core-definitions.md §3` and tech-spec §3.1:
- `agentArgument` default `"--agent {agent}"` (REQ-PLUG-01 advertiser, REQ-SEC-01 token constraint).
- `agentsProbeCommand` default `"{bin} agents --json"` (REQ-AGENT-04 / REQ-AVAIL-* probe; REQ-PERF-02
  once-no-retries).
- `defaultAgent` default `""` (REQ-AGENT-02; empty ⇒ runner default ⇒ REQ-AGENT-03 / REQ-COMPAT-01).

## 5. `minRunnerVersion` default-bump edit (REQ-BIN-02 — schema-field half)

The existing `loopRunner.minRunnerVersion` property's `default` is bumped from `0.5.0` to `0.6.0`,
the rauf version verified to ship the agent-selection surface (`00-core-definitions.md §2`,
`MIN_RUNNER_VERSION`; tech-spec §3.5 resolves OQ-01 to **source-presence at 0.6.0**). Its
`description` is updated to name 0.6.0 as the **agent-surface floor**. This is a single-property edit
to the existing field — **not** a new field.

**Before** (current schema, lines 143–146):

```json
"minRunnerVersion": {
  "type": "string",
  "default": "0.5.0",
  "description": "Minimum runner version (semver). 0.5.0 is rauf's grammar + contract flip (unified exit codes across status/loop run, `loop run --detached` replacing `loop start`, explicit `review` signal, versioned events.ndjson) that feature-forge's exit-code/status reads depend on. forge-5 enforces this via versionCommand before running."
}
```

**After:**

```json
"minRunnerVersion": {
  "type": "string",
  "default": "0.6.0",
  "description": "Minimum runner version (semver). 0.6.0 is the AGENT-SURFACE FLOOR: the rauf version that ships the coding-agent selection surface (the --agent flag, the `agents` availability probe, and the preset agent registry) that this config's agentArgument/agentsProbeCommand consume. Flooring here guarantees a successful gate implies those surfaces exist. (0.5.0 was the prior grammar/contract-flip floor — unified exit codes, `loop run --detached`, explicit `review` signal, versioned events.ndjson — which predates the agent surface and so could not guarantee it.) forge-5 enforces this via versionCommand before any loop side-effects."
}
```

**The GATE BEHAVIOR is NOT specified here.** How forge invokes `versionCommand`, semver-compares
against this floor, hard-stops before side-effects, and which install/setup hints it surfaces on
failure — all of that is owned by **`05-runner-discovery-version-gate.md`** (REQ-BIN-01/02/03/04).
This document changes only the schema default and its description; do **not** duplicate the gate
logic.

## 6. Rationale — flat fields, dedicated `defaultAgent` (resolves OQ-02)

Two design decisions are fixed here, both from tech-spec §3.8, both resolving **PRD OQ-02**:

- **Flat fields, not a nested `agent` sub-object.** A nested `loopRunner.agent = { argument,
  probeCommand, default }` would group the three cleanly and its presence could advertise the
  surface, but it **diverges from the flat convention** every existing `loopRunner` field uses
  (`runCommand`, `validateCommand`, `statusJsonCommand`, …). The flat
  `agentArgument` / `agentsProbeCommand` / `defaultAgent` trio matches that established style, gates
  on a **single field's presence** (§2), and introduces no new nesting for skills/tests to
  special-case. Rejected: the nested object (tech-spec §3.8).

- **A dedicated `defaultAgent` field, not the default folded into the token.** Folding the project
  default into the `agentArgument` token text (a single tokenized field only) would yield the
  smallest schema, but it makes the project default **implicit and hard to read/override** and pushes
  run-vs-project resolution into opaque token text instead of an explicit field. The dedicated
  `defaultAgent` keeps the project default human-readable and trivially per-run-overridable, and
  parallels how `--model` precedence is documented without re-implementing rauf's resolver
  (REQ-PREC-01). Rejected: the single-token fold (tech-spec §3.8). This is the answer to **OQ-02**.

## Dependencies

- **`00-core-definitions.md`** — the canonical field table (§3), the `{agent}` token (§6),
  `RUNNER_DEFAULT_ID` / `MIN_RUNNER_VERSION` (§2), and the consumed `AgentAvailability` shape (§1.1)
  that `agentsProbeCommand` must emit. This document is the JSON-Schema realization of those
  definitions; it does not redefine them.
- **Shares the edited file** (`references/forge-config-schema.json`) with
  **`05-runner-discovery-version-gate.md`** — `05` owns the `minRunnerVersion` *gate behavior* and the
  install/setup hints; this document owns the three new fields and the `minRunnerVersion` *default-value
  edit* (§5). The two must be applied to the same file without conflict (different properties /
  property-value edits).

Consumers of this document's gate condition and fields:
- `03-selection-resolution-observability.md` (reads the gate to decide whether to offer the Step 2d
  selector; reads `defaultAgent`).
- `04-availability-precheck.md` (runs `agentsProbeCommand`; enforces the `{agent}` allow-list
  constraint from §3).
- `06-loop-runner-contract-doc.md` (restates this schema block as the `forge-loop-runner-contract`
  expose).
- `07-testing-strategy.md` (asserts the defaults and the gate behavior — see Verification).

## Verification

These checks confirm an implementation of `references/forge-config-schema.json` matches this spec.
Items marked *(asserted by `07`)* are mechanically checked by `tests/test_loop_agent_selection.py`
per `07-testing-strategy.md`.

- [ ] `loopRunner.properties.agentArgument` exists with `type: "string"` and `default: "--agent {agent}"`. *(asserted by `07`)*
- [ ] `loopRunner.properties.agentsProbeCommand` exists with `type: "string"` and `default: "{bin} agents --json"`. *(asserted by `07`)*
- [ ] `loopRunner.properties.defaultAgent` exists with `type: "string"` and `default: ""`. *(asserted by `07`)*
- [ ] `loopRunner.properties.minRunnerVersion.default == "0.6.0"` (bumped from `"0.5.0"`), and its description names 0.6.0 as the agent-surface floor. *(asserted by `07`)*
- [ ] Each new property's `description` documents the agent-surface gate / probe contract / project-default semantics at the fidelity of the surrounding `loopRunner` descriptions.
- [ ] The file remains valid JSON Schema draft-07 (parses; `$schema` unchanged); no other `loopRunner` property is altered except `minRunnerVersion`'s `default` + `description`.
- [ ] **Capability gate (REQ-PLUG-01/02):** with `agentArgument` **absent** from a `loopRunner` config, no agent selector, no probe, and no agent argument are produced — the rendered launch command is identical to the baseline (pre-feature) command. *(asserted by the gating test in `07`)*
- [ ] **Default path (REQ-COMPAT-01):** with the default `agentArgument` present but the resolved agent `none` or `RUNNER_DEFAULT_ID`, no `{agent}` substitution occurs and the command is byte-identical to today. *(cross-checked in `03 §4` / asserted by `07`)*
- [ ] No hardcoded `rauf …` command is introduced by these schema edits (REQ-DEF-02) — every value is a token template or a documentation string.
```