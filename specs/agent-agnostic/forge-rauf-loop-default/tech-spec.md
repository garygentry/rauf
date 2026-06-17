# forge-rauf-loop-default — Technical Specification

> Epic member of **agent-agnostic**. Target repo: **feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Based on PRD v1 (commit `92130de`). Resolves PRD **OQ-01** (version floor) and **OQ-02**
> (config shape) below.

## 1. Overview

This feature formalizes the forge↔rauf loop-runner contract and threads a **coding-agent
dimension** through it, entirely via feature-forge's existing tokenized `loopRunner` seam — no
new hardcoded `rauf` commands (REQ-DEF-02, CON-04). Four mechanisms carry the whole feature:

1. **Three new flat `loopRunner` fields** — `agentArgument` (the tokenized `--agent {agent}`
   template whose *presence* advertises the agent surface), `agentsProbeCommand` (the
   availability probe, default `{bin} agents --json`), and `defaultAgent` (the project-default
   agent id). (§3.1, resolves OQ-02.)
2. **A run-level agent selector** added to `forge-5-loop` Step 2d, mirroring the existing
   `--model` flag, plus a forge-side resolution that collapses run-selection-over-project-default
   into the single `{agent}` value rauf's run layer accepts (§3.2).
3. **An availability pre-check** that runs the probe once for a non-default agent and
   disambiguates *unknown id* (hard-reject, REQ-AVAIL-04) from *known-but-unavailable*
   (warn/proceed, REQ-AVAIL-02) by **membership in the advertised `agents[].id` set** (§3.3) —
   which doubles as REQ-SEC-01's allow-list.
4. **Version-floor bump to 0.6.0** and **provisioning-hint coherence** with the cross-agent
   installer (§3.5), plus the **authoritative contract doc** the capstone consumes (§3.6).

Key architectural decision: **agent selection is presence-gated on `loopRunner.agentArgument`.**
A runner whose config omits that field exposes no agent surface, so the selector and probe
vanish and the loop behaves exactly as today (REQ-PLUG-01/02). This keeps alternate (non-rauf)
runners first-class with zero special-casing.

## 2. Module Structure

All edits land in **feature-forge** (`/home/gary/workspace/feature-forge`). There is no
compiled module — feature-forge is a Claude-plugin repo of skill prose, JSON references, and
Python/Node helpers. The canonical surfaces this feature touches:

| Path | Change | Why |
|------|--------|-----|
| `references/forge-config-schema.json` | edit | Add `agentArgument`, `agentsProbeCommand`, `defaultAgent` to the `loopRunner` block; bump `minRunnerVersion` default `0.5.0`→`0.6.0` (§3.1, §3.5) |
| `skills/forge-5-loop/SKILL.md` | edit | Step 2d: add `--agent` to the inline flag mention + run-level selector; Step 1c: version-floor wording; Step 3c: show resolved agent + source layer (§3.2, §3.4) |
| `skills/forge-5-loop/references/runner-contract.md` | edit | New `## Agent selection` operational section (precedence, probe, disambiguation, gating) parallel to the model-precedence section; add `--agent` to the optional-flags catalog (§3.2–3.4) |
| `references/ralph-loop-contract.md` | edit | The **authoritative** contract doc: add agent-selection terms + the per-stage applicability table (§3.6) — this is the `forge-loop-runner-contract` **expose** |
| `tests/fixtures/mock-rauf/` | new | Fake `rauf` emitting canned `version --json` / `agents --json`, recording argv (§3.7) |
| `tests/test_loop_agent_selection.py` | new | pytest exercising the reference resolver + schema defaults (§3.7) |
| `references/loop-agent-selection.py` | new | Small **executable spec** of the resolution + probe-disambiguation + command-render algorithm the skill prose prescribes; imported by the test (§3.7) |
| `adapters/**` | regenerate | `python3 scripts/build-adapters.py` after editing canonical `skills/`; **never hand-edit** — the `validate.sh` drift guard enforces this |

**Public API surface (the `forge-loop-runner-contract` expose):** the augmented `loopRunner`
schema block + the agent-selection section of `references/ralph-loop-contract.md`. That doc +
schema is what `packaging-docs-ci` consumes (REQ-DEF-03).

## 3. Technical Decisions

### 3.1 Config shape — flat tokenized fields, presence-gated (REQ-AGENT-02, REQ-PLUG-01/02, CON-04 · resolves OQ-02)

Three new flat properties on the `loopRunner` object, matching the existing flat `*Command`
convention (rather than a nested sub-object — alternatives in §3.8):

```jsonc
"agentArgument": {
  "type": "string",
  "default": "--agent {agent}",
  "description": "Tokenized argument appended to the launch command (eventStreamCommand/runCommand) when an agent is resolved. {agent} is substituted with a validated, advertised agent id. PRESENCE of this field advertises the runner's agent surface; OMIT it for a runner with no agent dimension and forge skips agent selection entirely (REQ-PLUG-01)."
},
"agentsProbeCommand": {
  "type": "string",
  "default": "{bin} agents --json",
  "description": "Availability probe. MUST emit { agents: [{ id, available, ... }] } and exit 0. forge runs it once (no retries) before launching a non-default agent to (a) validate the id against the advertised set and (b) report availability. Omitted/absent ⇒ no pre-check."
},
"defaultAgent": {
  "type": "string",
  "default": "",
  "description": "Project-default agent id. Empty string ⇒ no project default (runner's own default — claude-cli for rauf — applies). Overridden by the per-run selector. Ignored when agentArgument is absent."
}
```

**Decision:** the project default is a **dedicated field** (`defaultAgent`), not folded into the
token. Rationale: explicit, human-readable, and trivially overridable per run; it parallels how
`--model` precedence is documented without re-implementing rauf's resolver (REQ-PREC-01).

**Capability gating (REQ-PLUG-01/02):** forge treats `agentArgument` *present and non-empty* as
"this runner has an agent surface." When absent: no selector in Step 2d, no probe, no `{agent}`
substitution, no agent argument sent — byte-identical to today's command (REQ-COMPAT-01). The
gate is a pure config-presence check, requiring no runner round-trip.

### 3.2 Run-level selection + forge-side resolution (REQ-AGENT-01/03/05, REQ-PREC-01/02)

**The selector.** `forge-5-loop` Step 2d's `AskUserQuestion` (which today offers `--review`,
`--model`, `--timeout`, `--retry-blocked`) gains an **agent** choice, surfaced only when the
gate (§3.1) is on. Its options are populated from the probe's advertised ids (§3.3) plus an
explicit "default (claude-cli)" choice. The operational detail lands in
`skills/forge-5-loop/references/runner-contract.md` as an `## Agent selection` section parallel
to the existing `## Model selection precedence` block.

**forge-side resolution (the run/project layers forge owns).** forge resolves a single value:

```
resolvedAgent = runSelection            # from Step 2d, if chosen
             or defaultAgent (non-empty) # from forge.config loopRunner
             or <none>                   # ⇒ append nothing; rauf applies its own default
```

forge passes `resolvedAgent` to rauf's **run layer** via `agentArgument` (`--agent {agent}`).
Item-level agent (`BacklogItem.provider`) is **never** read or sent by forge — rauf applies it
*above* the run layer, so a per-item agent always wins (REQ-AGENT-05, REQ-PREC-02). This is the
precise meaning of "forge owns run/project/default; it never re-implements rauf's resolution":
forge collapses *its own* run+project into one `--agent`; rauf alone resolves item-vs-run.

**Observable precedence (REQ-PREC-01)** — `item > run > project > default` — is realized as:
item (rauf, from backlog) ▸ runSelection (forge `--agent`) ▸ defaultAgent (forge `--agent`) ▸
rauf's `claude-cli`. Run-over-project is decided *inside* forge before the single `--agent` is
emitted (REQ-PREC-02).

**Default path is untouched (REQ-AGENT-03, REQ-COMPAT-01, REQ-PERF-01).** When `resolvedAgent`
is *none* **or** equals the runner default id (`claude-cli` for rauf), forge appends **no**
`agentArgument` and runs **no** probe — the launch command and runtime cost are exactly today's.

### 3.3 Availability pre-check + unknown/unavailable disambiguation (REQ-AVAIL-01/02/03/04, REQ-SEC-01, REQ-PERF-02)

When `resolvedAgent` is a **non-default** id, forge runs `agentsProbeCommand` **once** (no
retries — REQ-PERF-02) before any loop side-effect, parses `{ agents: AgentAvailability[] }`,
and builds the advertised id set `A = { a.id for a in agents }`. Then:

| Condition | Classification | Action |
|-----------|----------------|--------|
| `resolvedAgent ∉ A` | **Unknown id** (typo / unsupported) — REQ-AVAIL-04 | **Hard-reject before launch.** Error lists the valid ids (`sorted(A)`). No proceed-anyway. No `{agent}` substitution (REQ-SEC-01). |
| `resolvedAgent ∈ A` and `available == false` | **Known-but-unavailable** — REQ-AVAIL-02 | Warn (show `detail`); offer **proceed-anyway** or **choose another** via `AskUserQuestion`. Never silently abort or proceed. |
| `resolvedAgent ∈ A` and `available == true` | Available | Proceed. |

**Why membership, not exit code (verified against rauf source):** `rauf agents --json` **always
exits 0** — an unknown id simply never appears in `agents[]`, while a known-unavailable one
appears with `available:false`. So the unknown-vs-unavailable split is decidable *only* by set
membership, which is exactly what REQ-AVAIL-04 (vs REQ-AVAIL-02) requires. The same set `A` is
REQ-SEC-01's allow-list: the only value ever interpolated into `{agent}` is a member of `A`,
already validated, so no arbitrary string reaches the shell beyond the tokenized argument.

**No pre-check on the default path (REQ-AVAIL-03):** by §3.2, the default/claude-cli path never
reaches this step.

**Listing at confirm time (REQ-AGENT-04):** the parsed `agents[]` (id + displayName +
available) is shown in the Step 2d pre-launch confirmation so the user chooses from what is
actually installed.

### 3.4 Observability — show the resolved agent and its source (REQ-OBS-01, REQ-OBS-02)

The resolved agent id **and its source layer** (`run` selection / `project` default / runner
`default`) are shown in (a) the Step 2d pre-launch confirmation and (b) the Step 3c
"Loop started…" inform-user template in `runner-contract.md`. No new event types are introduced;
the NDJSON event stream and status JSON are unchanged (REQ-OBS-02) — the agent id already
appears in rauf's own events.

### 3.5 Runner discovery & version coherence (REQ-BIN-01/02/03/04, CON-03 · resolves OQ-01)

**OQ-01 resolved:** rauf is at **0.6.0**, and the `--agent` flag, `rauf agents` probe, and full
preset registry are present at 0.6.0 (not called out as added in any earlier CHANGELOG entry).
The version floor is therefore **0.6.0** — a successful gate guarantees the agent surface exists
(REQ-BIN-02). Edit: `loopRunner.minRunnerVersion` default `0.5.0`→`0.6.0`, and update its
description to state that 0.6.0 is the agent-surface floor.

**Discovery (REQ-BIN-01):** unchanged — forge locates rauf via `loopRunner.bin` (default `rauf`
on PATH); the cross-agent installer provisions `rauf@0.6.0` onto PATH. No new discovery logic.

**Gate behavior (REQ-BIN-04):** unchanged hard-gate (Step 1c) — semver-compare reported version
vs floor *before* any loop side-effect; on missing/too-old, STOP and show the hint.

**Hint coherence (REQ-BIN-03):** `installHint` (binary install/upgrade) is extended to name
**two distinct paths** while keeping them separate: (1) the **cross-agent installer** as the
multi-agent provisioning path, and (2) the direct rauf-CLI install/upgrade one-liner. `setupHint`
(per-project artifacts) stays distinct and unchanged — a version-gate failure is always the
former, never the latter.

### 3.6 The authoritative contract doc + per-stage applicability (REQ-DEF-01/02/03, REQ-SEAM-01/02)

`references/ralph-loop-contract.md` (the consumer-side authority that `packaging-docs-ci`
documents) gains:

- A **default-to-rauf-but-pluggable** restatement (REQ-DEF-01/02) — already largely present;
  extended to note the agent dimension is additive and presence-gated.
- An **agent-selection** subsection: the precedence (REQ-PREC-01), the run-layer mapping
  (REQ-PREC-02), the probe + disambiguation (REQ-AVAIL-*), and the capability gate (REQ-PLUG-*).
- A **per-stage applicability table** (REQ-SEAM-01) classifying every runner-touching stage:

  | Stage | Runner verbs | Agent dimension |
  |-------|-------------|-----------------|
  | `forge-5-loop` | run / eventStream / status / version | **Full** — selector, probe, `--agent` |
  | `forge-4-backlog` | `validate` | **None** — agent-agnostic |
  | `forge-verify` | `validate` | **None** — agent-agnostic |

- An **explicit `validate`-is-agent-agnostic note** (REQ-SEAM-02): no agent argument may ever be
  passed to backlog validation in any stage — a guard against a future contributor bolting
  `--agent` onto `validate`.

This doc + the schema block constitute the `forge-loop-runner-contract` expose.

### 3.7 Testing mechanism (SC-07, CON-05)

feature-forge skills are markdown prose, not callable code, so the documented algorithm is
captured once as an **executable spec** and tested against a mock runner (see §8).

## 4. Data Model

**Consumed from rauf (fixed by CON-02 — verified shapes):**

```ts
// packages/loop/src/providers/registry.ts
interface AgentAvailability {
  id: string;            // registry key: claude-cli | codex | gemini | copilot | cursor | generic-cli
  displayName: string;   // e.g. "Claude Code (CLI)", "Codex CLI"
  binaryName?: string;   // probed on PATH; cursor's is "cursor-agent"; generic-cli has none
  available: boolean;    // from detect()
  detail?: string;       // PATH location / "not found" / credential status
}
// `rauf agents --json` → { agents: AgentAvailability[] }, always exit 0
// DEFAULT_AGENT_ID = "claude-cli"  (packages/loop/src/constants.ts)
// BacklogItem.provider: z.string().optional()  (packages/core/src/schemas.ts) — pass-through only
```

**Owned by this feature (new `loopRunner` fields):** `agentArgument: string`,
`agentsProbeCommand: string`, `defaultAgent: string` (§3.1). No new persisted state, no new
event types (REQ-OBS-02).

**Token vocabulary:** the existing `{bin}` / `{backlogDir}` / `{specsDir}` / `{iterations}` set
gains **`{agent}`**, substituted only inside `agentArgument` and only with a member of the
advertised id set.

## 5. API Design

No HTTP/programmatic API. The "interfaces" are the rendered CLI invocations and the resolution
algorithm:

**Launch (non-default agent):**
```
{bin} loop run . --backlog {backlogDir} --iterations {iterations} --ndjson --agent {agent}
```
(the `--agent {agent}` is the rendered `agentArgument`, appended only when `resolvedAgent` is a
validated non-default id.)

**Probe (non-default agent only, once):** `{bin} agents --json` → parse `{ agents[] }`.

**Resolution + disambiguation (the executable spec, `references/loop-agent-selection.py`):**
```
resolve(runSelection, defaultAgent, runnerDefaultId) -> resolvedAgent | None
classify(resolvedAgent, agents[]) -> AVAILABLE | UNAVAILABLE(detail) | UNKNOWN(validIds)
render_launch(baseCmd, agentArgument, resolvedAgent) -> cmd  # appends nothing when None/default
```

## 6. Integration Points

**A. feature-forge → rauf (consumed; verified signatures).**
- `rauf loop run … --agent <id>` — `packages/cli/src/commands.ts:197` (flag) → folds to
  `LoopStartOptions.provider`; ids from `SUPPORTED_AGENT_IDS`.
- `rauf agents [--json]` — `packages/cli/src/loop-commands.ts:1190` `handleAgents`; JSON shape
  `{ agents: AgentAvailability[] }`; **always exit 0**.
- `rauf version --json` — already consumed by the gate; floor bumps to the reported `0.6.0`
  (`packages/core/src/version.ts`).
- `BacklogItem.provider` — `packages/core/src/schemas.ts:72`; pass-through, never written by forge.
- Precedence resolver — `packages/loop/src/agent-selection.ts` `resolveAgentId` (item > run >
  project > global > `claude-cli`); forge feeds only the run layer.

> **WARNING / alignment note:** rauf's `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` **Part B is DRAFT**
> and documents a *4-layer* `--provider` resolution omitting the run-level `--agent`; the live
> source is 5-layer with `--agent` at the run slot. **Source is authoritative** for this feature;
> forge's contract doc (§3.6) documents the live `--agent` surface, not the draft `--provider`
> spec text. (rauf owns reconciling its own spec — out of scope here, CON-01.)

**B. feature-forge internal.**
- `references/forge-config-schema.json` ⟶ read by `forge-5-loop` / `forge-4-backlog` /
  `forge-verify` to render every command. The three new fields + floor bump live here.
- `skills/forge-5-loop/SKILL.md` + `references/runner-contract.md` — the selector, probe, gate
  wording, and inform-user output.
- `references/ralph-loop-contract.md` — the expose doc consumed by `packaging-docs-ci`.
- **`adapters/` (generated):** after editing canonical `skills/`, run
  `python3 scripts/build-adapters.py`; the `validate.sh` drift guard fails on stale adapters.
  Never hand-edit `adapters/**`.

**C. Conflict check.** No in-progress sibling touches `forge-5-loop` or the schema:
`packaging-docs-ci` (the only downstream dep) is still at forge-1-prd and consumes this feature's
output, not its files. No conflict.

## 7. Error Handling

| Situation | Handling | Req |
|-----------|----------|-----|
| rauf missing / too old (< 0.6.0) | Hard-stop at Step 1c before side-effects; show extended `installHint` (installer path + CLI one-liner) | REQ-BIN-02/03/04 |
| Selected agent id ∉ advertised set | Hard-reject before launch; error lists `sorted(validIds)`; no proceed-anyway; no `{agent}` interpolation | REQ-AVAIL-04, REQ-SEC-01 |
| Selected agent known but `available:false` | Warn with `detail`; `AskUserQuestion` → proceed-anyway / choose-another; never silent | REQ-AVAIL-02 |
| Probe command fails (non-zero / unparseable) | Treat as inability to validate a non-default agent → surface the failure and let the user choose-another or abort; do **not** launch a non-default agent unvalidated | REQ-AVAIL-01 |
| `agentArgument` absent (alt runner) | Skip selector/probe entirely; behave exactly as today | REQ-PLUG-01/02 |
| Default / claude-cli path | No probe, no extra work; unchanged | REQ-AVAIL-03, REQ-PERF-01 |

## 8. Testing Approach

Gate is **`bash scripts/validate.sh`** (spec-purity + adapters drift guard + pytest + installer
build; CON-05) — *not* rauf's `pnpm gate`. New coverage (SC-07):

- **`references/loop-agent-selection.py`** — the executable spec of `resolve` / `classify` /
  `render_launch` (§5). Importing it keeps the test from drifting from prose, and it is itself a
  documentation artifact the skill references.
- **`tests/fixtures/mock-rauf/rauf`** — a fake runner emitting canned `version --json` (0.6.0)
  and `agents --json` (a mix: `claude-cli` available, one available non-default, one
  `available:false` known, and *no* row for an unknown id), recording its argv to a temp file.
- **`tests/test_loop_agent_selection.py`** (pytest, matching the existing `tests/` suite):
  - **Precedence (REQ-PREC-01/02):** run-selection beats `defaultAgent`; with neither, resolves
    to none (default path); item-level is *not* forge's concern (assert forge never emits an
    `--agent` derived from a backlog item).
  - **Probe split (REQ-AVAIL-02/04):** member+available ⇒ proceed; member+unavailable ⇒
    warn/choose; non-member ⇒ hard-reject listing valid ids.
  - **Command render (REQ-AGENT-01, REQ-SEC-01):** `render_launch` appends `--agent <id>` only
    for a validated non-default id; nothing for none/`claude-cli`; only allow-list ids reach
    `{agent}`.
  - **Capability-gating (REQ-PLUG-01/02):** `agentArgument` absent ⇒ no probe, no `--agent`,
    no selector — identical launch to baseline.
  - **Schema (REQ-BIN-02):** assert `forge-config-schema.json` `loopRunner.minRunnerVersion`
    default == `0.6.0` and the three new fields exist with the documented defaults.
- **Adapters drift:** `build-adapters.py --check` (inside `validate.sh`) must pass after
  regeneration — confirms the canonical-skill edits propagated and nothing was hand-edited.

**Not CI-automatable (per SC-07):** a true multi-agent install driving a live non-claude agent
end-to-end is maintainer-run; the mock-runner test stands in for it in CI.

## 9. Dependencies

- **External (consumed, fixed):** rauf **≥ 0.6.0** — `--agent`, `rauf agents --json`,
  `BacklogItem.provider`, 5-layer precedence (CON-02). Provisioned by the cross-agent installer
  as `rauf@0.6.0` (CON-03).
- **Intra-epic (complete):** `rauf-agent-cli-adapters` (exposes `loop-agent-selection`),
  `cross-agent-installer` (exposes `cross-agent-installer-cli`).
- **Tooling (existing in feature-forge):** Python 3 + pytest (`tests/`), `scripts/validate.sh`,
  `scripts/build-adapters.py`, `scripts/check-spec-purity.py`. No new third-party deps.
- **Downstream consumer:** `packaging-docs-ci` consumes the `forge-loop-runner-contract` expose
  (§3.6) — documentation input, no code coupling.

## 10. Open Technical Questions

- **OQ-01 — RESOLVED:** version floor = **0.6.0** (§3.5).
- **OQ-02 — RESOLVED:** flat `agentArgument` / `agentsProbeCommand` / `defaultAgent` fields with
  presence-gating on `agentArgument` (§3.1).
- **OQ-T1 (minor):** whether `references/loop-agent-selection.py` should also be wired as an
  import inside any generated adapter, or stay a test-only reference + doc artifact. Leaning
  **test-only + doc** (the skills remain prose; the Python is the executable spec, not a runtime
  the skill calls). Confirm during forge-3-specs.
- **OQ-T2 (minor):** exact extended `installHint` wording naming the cross-agent installer
  invocation (`npx …`) — pin the precise command string in forge-3-specs against the installer's
  published entrypoint.
