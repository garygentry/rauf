# 05 — Runner Discovery & Version Gate

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Source of truth: `PRD.md` (v1, §3.6, §4.1) + `tech-spec.md` (v1, §3.5, §7, §10 OQ-T2).
> Shared types/constants are in `00-core-definitions.md`; layout in `01-architecture-layout.md`.
> Cross-references use exact filenames.

This document owns the **behavior** of the runner version gate (the Step 1c hard-gate in
`skills/forge-5-loop/SKILL.md`), the **discovery** of the installer-provisioned rauf binary,
and the **coherence of the install/setup hints**. It resolves PRD **OQ-01** (the version
floor) against rauf source and pins **OQ-T2** (the exact cross-agent-installer command named
in `installHint`).

**Ownership boundary with `02-config-schema-and-gating.md`:** that document owns the *schema
field* `minRunnerVersion` (its JSON Schema entry and `default` value); **this** document owns
the *gate behavior that reads it*, the *discovery* path, and the *hint wording*. The single
shared file is `references/forge-config-schema.json` — `02` defines `minRunnerVersion`'s
default there; this doc defines the amended `installHint`/`minRunnerVersion` *descriptions* and
the floor *rationale* there. Both edit the same file; neither redefines the other's field.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-BIN-01 | Reliably locate the installer-provisioned rauf (discovery unchanged) | §3 |
| REQ-BIN-02 | Version floor = the agent-capable rauf (0.6.0); resolves OQ-01 | §1, §2 |
| REQ-BIN-03 | Install/setup hints point at the cross-agent installer, distinct from the rauf-CLI hint | §4 |
| REQ-BIN-04 | Missing/too-old rauf fails the gate BEFORE any loop side-effects with an actionable message | §2 |
| REQ-PERF-01 | Default path adds no extra gate work beyond the version-floor bump | §5 |
| CON-03 | Version floor + hints align to the installer's `rauf@0.6.0` pin | §1, §3, §4 |

## 1. OQ-01 resolution — the floor is 0.6.0, pinned to source-presence

PRD **OQ-01** asks: confirm the exact rauf version that first shipped the `--agent` surface
matches the installer's `rauf@0.6.0` pin, used to set the version floor (REQ-BIN-02).

**Resolution: the version floor is `0.6.0`.** The agent-selection surface is verified present
in rauf source at `VERSION = "0.6.0"`. Citations (file:line, read at spec time):

| Surface element consumed | Source location (rauf) | Verified |
|--------------------------|------------------------|----------|
| `VERSION = "0.6.0"` (reported by `version --json`) | `packages/core/src/version.ts:4` | yes |
| `--agent <id>` run flag (folds to `LoopStartOptions.provider`) | `packages/cli/src/commands.ts:198` (`name: "--agent <id>"`) | yes |
| `SUPPORTED_AGENT_IDS` (advertised set for `--agent` help) | `packages/cli/src/commands.ts:122` | yes |
| `rauf agents [--json]` probe → `{ agents: AgentAvailability[] }` (always exit 0) | `packages/cli/src/loop-commands.ts:1190` (`handleAgents`) | yes |
| `AgentAvailability` row shape | `packages/loop/src/providers/registry.ts:14` (interface) | yes |
| `listAgents()` (probe data source; never rejects) | `packages/loop/src/providers/registry.ts:154` | yes |
| `resolveAgentId` 5-layer precedence | `packages/loop/src/agent-selection.ts:24` | yes |
| `DEFAULT_AGENT_ID = "claude-cli"` (runner default) | `packages/loop/src/constants.ts:2` | yes |

**Pinned to source-presence, not changelog text.** rauf's `CHANGELOG.md` 0.6.0 entry reads
*"Phase 4 of the rauf UX/DX overhaul … a ratified agent contract. Additive minor bump (no
`minRunnerVersion` change, no feature-forge lockstep)"* and, under **Changed**,
*"Agent-contract documentation finalized."* So the 0.6.0 entry documents the contract
*documentation* finalization, while the **executable surface** (`--agent`, `rauf agents`,
the preset registry) is already present in the 0.6.0 source tree per the table above. The
floor is therefore pinned to **source-presence at `VERSION = "0.6.0"`**, not to a changelog
line. Flooring at 0.6.0 is **safe-and-sufficient**: even if the surface technically landed
earlier on the development branch, a successful gate at `≥ 0.6.0` *guarantees* the agent
surface exists, which is exactly what REQ-BIN-02 requires.

**Alignment with the installer pin (CON-03).** The `cross-agent-installer` records
`RAUF_PIN = "rauf@0.6.0"` (`/home/gary/workspace/feature-forge/installer/src/rauf.ts:30`;
mirrored in `cross-agent-installer/06-rauf-provisioning.md` §3) and provisions rauf via the
lazy-`npx` contract `npx rauf@<pin> loop run …`. Flooring forge's gate at the same `0.6.0`
coordinate makes the gate and the provisioning pin coherent: the installer never hands forge a
rauf below the floor.

`MIN_RUNNER_VERSION = "0.6.0"` is defined once in `00-core-definitions.md §2`; this document
specifies how the gate *uses* it.

## 2. Version gate behavior (REQ-BIN-02, REQ-BIN-04)

The gate is the existing **Step 1c Runner Version Gate** in
`skills/forge-5-loop/SKILL.md`. This feature **changes only the floor wording** (0.5.0 → 0.6.0
and its rationale); the hard-gate mechanism is unchanged (REQ-BIN-04 preserves current
behavior). The schema field default lives in `02-config-schema-and-gating.md`
(`loopRunner.minRunnerVersion`); this section specifies the *behavior that reads it*.

### 2.1 Algorithm (unchanged mechanism, bumped floor)

The gate runs **after** the Epic Dependency Gate (Step 1b-epic) and **before** the Runner Setup
Check (Step 1d), the backlog check (Step 1e), and any Step 3 launch — i.e. **before any loop
side-effect** (no pipeline-state write, no `mkdir`, no process launch). Steps:

1. Run the **version command** (`loopRunner.versionCommand`, default `{bin} version --json`)
   via Bash. Always the `--json` form — never plain `rauf version` (its human output is
   `rauf v0.6.0` with a `v` prefix and is not parseable as JSON).
2. Parse `{ "version": "<semver>" }` from stdout.
3. **Semver-compare** (NOT string-compare) the reported `version` against
   `loopRunner.minRunnerVersion`, numerically by major, then minor, then patch.

**Any of the following is a HARD GATE FAILURE — STOP, do not proceed to run the loop, show
`loopRunner.installHint` (the extended dual-path hint, §4), and include the raw command output
for diagnosis:**

- The version command is not found or exits non-zero (the binary isn't installed) — REQ-BIN-04
  (missing).
- Its stdout is not valid JSON, has no `version` field, or `version` is not a valid semver
  string — REQ-BIN-04 (unparseable).
- The reported version is **< `minRunnerVersion`** (now `0.6.0`) — REQ-BIN-02/REQ-BIN-04
  (too-old).

A successful gate (`reported ≥ 0.6.0`, parseable) is the **guarantee** that the `--agent`
flag and the `rauf agents` probe exist (§1), so the downstream agent-selection steps
(`03-selection-resolution-observability.md`, `04-availability-precheck.md`) may assume the
surface is present whenever the capability gate (`00 §3` / `02 §2`) is also on.

### 2.2 Current Step 1c wording being amended

The clause this feature edits (quoted verbatim from `skills/forge-5-loop/SKILL.md`, Step 1c):

> 3. **Semver-compare** (NOT string-compare) the reported version against
> `loopRunner.minRunnerVersion` (default `0.5.0`), numerically by major, then minor, then patch.

and the too-old message exemplar:

> For the version-too-old case, phrase it concretely, e.g.: "Your rauf is {reported}, but
> feature-forge needs ≥ {minRunnerVersion} (it relies on `backlog validate` + backlog
> schemaVersion). {installHint}".

### 2.3 Amended Step 1c wording (this feature)

Replace the parenthetical floor reference and the rationale in the too-old message so they name
**0.6.0** and the *agent surface* (not the 0.5.0 grammar flip):

- Step 1c item 3: `… against `loopRunner.minRunnerVersion` (default `0.6.0`) …`
- Too-old message exemplar:

  > "Your rauf is {reported}, but feature-forge needs ≥ {minRunnerVersion} — 0.6.0 is the
  > floor that ships the agent-selection surface (`--agent` / `rauf agents`) the loop relies
  > on. {installHint}"

The "before doing anything else with the runner" framing, the `--json`-only instruction, the
unparseable-output branch, and the `installHint`-vs-`setupHint` callout are all **unchanged**.
No new step, no new control flow — only the floor value and its stated reason move from the
0.5.0 grammar/contract flip to the 0.6.0 agent surface.

> The `minRunnerVersion` **schema default** (`0.5.0` → `0.6.0`) and its **schema description**
> live in `references/forge-config-schema.json` and are specified in
> `02-config-schema-and-gating.md`. This document specifies only the skill *prose* that reads
> that default. The two must stay coherent (both name 0.6.0 / the agent surface) — see §6.

## 3. Discovery (REQ-BIN-01)

**Discovery is unchanged.** forge locates the runner binary via `loopRunner.bin` (default
`rauf`), assumed on PATH (or an absolute path). Every command in the skill is rendered by
substituting `{bin}` → `loopRunner.bin` (`skills/forge-5-loop/SKILL.md`, "Resolve the loop
runner"). The `bin` field's current schema description is authoritative and **not amended**:

> "The runner executable. Assumed on PATH; may be an absolute path. Substituted as {bin} in
> every command." (`references/forge-config-schema.json`, `loopRunner.bin`)

**How the installer satisfies REQ-BIN-01 / CON-03.** The `cross-agent-installer` provisions
rauf by the lazy-`npx` contract — it records `RAUF_PIN = "rauf@0.6.0"` and the forge loop
invokes `npx rauf@<pin> …` (`cross-agent-installer/06-rauf-provisioning.md` §2;
`installer/src/rauf.ts:30`). The default `loopRunner.bin = "rauf"` resolves the provisioned
rauf on PATH after a multi-agent install; a project that drives rauf via `npx` may set
`loopRunner.bin` to the appropriate launcher without any skill edit (CON-04 — the seam is
tokenized). **No new discovery logic is introduced by this feature.** The only discovery-side
change is the version *floor* (§1/§2), which is what makes a discovered-but-too-old rauf fail
the gate (REQ-BIN-02/04).

## 4. Hint coherence (REQ-BIN-03 · resolves OQ-T2)

This feature extends `loopRunner.installHint` to name **two distinct provisioning paths** while
keeping the binary-install concern strictly separate from the per-project-setup concern.

### 4.1 The three-way distinction

| Hint | Field | Fires when | Concern |
|------|-------|------------|---------|
| Cross-agent installer | `installHint` (path 1) | version gate fails (§2) in a **multi-agent** context | Provision rauf (+ agent adapters) across coding agents |
| Direct rauf-CLI install/upgrade | `installHint` (path 2) | version gate fails (§2) in a **rauf-only** context | Obtain/upgrade just the rauf binary |
| Per-project setup | `setupHint` (Step 1d) | `preconditionFile` (`.rauf.json`) is missing | Install rauf's per-project artifacts (`.rauf/`, `RAUF.md`) |

**Invariant (REQ-BIN-03):** a **version-gate failure is ALWAYS a binary problem** → it shows
`installHint` (path 1 and/or path 2), **never** `setupHint`. A **missing precondition file is
ALWAYS a per-project-setup problem** → it shows `setupHint`, never `installHint`. The two paths
inside `installHint` differ only in scope (multi-agent vs. rauf-only); both obtain/upgrade the
**binary**, which is what the version gate is about. `setupHint` is **unchanged** by this
feature.

### 4.2 OQ-T2 — the exact cross-agent installer command

OQ-T2 asks for the precise command string naming the cross-agent installer's published
entrypoint. **Pinned (no WARNING):**

- The installer's `bin` is **`feature-forge`** (`installer/package.json:5` →
  `"bin": { "feature-forge": "dist/cli.js" }`), and it is **npx-runnable with no prior
  checkout or build** (`cross-agent-installer/07-cli-and-reporting.md` §1.1, REQ-DIST-01).
- The canonical invocation is `npx feature-forge <subcommand> [flags]`
  (`cross-agent-installer/07-cli-and-reporting.md` §1.1); the provisioning subcommand is **`install`**
  (`cross-agent-installer/07-cli-and-reporting.md` §1.2 — `install` mutates and runs the rauf preflight unless
  `--skip-rauf`).

⇒ The cross-agent installer command to name in `installHint` is **`npx feature-forge install`**.

### 4.3 The amended `installHint` default + description

Current value (`references/forge-config-schema.json`, `loopRunner.installHint`):

> default: `"Install or upgrade the rauf CLI: curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash"`
>
> description: `"Shown when the runner BINARY is missing or too old (version gate fails) — how to obtain/upgrade the CLI itself. Distinct from setupHint (which installs per-project artifacts)."`

Proposed amended JSON Schema fragment (the canonical edit lands in
`references/forge-config-schema.json`; `02-config-schema-and-gating.md` carries the field, this
doc specifies the wording):

```json
"installHint": {
  "type": "string",
  "default": "Provision rauf for a multi-agent setup with the cross-agent installer: `npx feature-forge install` (records the pinned rauf@0.6.0 default). Or install/upgrade just the rauf CLI: `curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash`.",
  "description": "Shown when the runner BINARY is missing or too old (version gate fails, minRunnerVersion floor) — how to obtain/upgrade the CLI itself. Names two distinct binary-provisioning paths: (1) the cross-agent installer (`npx feature-forge install`, the multi-agent provisioning path that pins rauf@0.6.0), and (2) the direct rauf-CLI install/upgrade one-liner. Distinct from setupHint (which installs per-project artifacts); a version-gate failure is ALWAYS this hint, never setupHint."
}
```

The direct rauf-CLI one-liner (path 2) is preserved verbatim from the current default so
rauf-only users are unaffected. Path 1 is additive and names the exact installer entrypoint
pinned in §4.2.

> The `minRunnerVersion = 0.6.0` floor (§1) and the `installHint` cross-agent path (§4.2/§4.3)
> both reference `rauf@0.6.0` — they are coherent with the installer pin (CON-03). If the
> installer advances `RAUF_PIN`, both the floor and the hint must advance together (§6
> verification).

### 4.4 The Step 1c `installHint`-vs-`setupHint` callout (kept)

The existing Step 1c callout in `skills/forge-5-loop/SKILL.md` is **unchanged** and remains
correct under the dual-path hint:

> `installHint` points at the runner **CLI** install/upgrade — distinct from `setupHint` (1d),
> which installs the runner's per-project artifacts.

Both paths inside the extended `installHint` are CLI/binary provisioning, so the callout's
"CLI install/upgrade vs. per-project artifacts" framing still holds verbatim.

## 5. Perf (REQ-PERF-01)

The default (claude) path **adds no new gate cost**:

- The version gate (Step 1c) already runs on **every** loop launch today (default path
  included) — it is the same single `versionCommand` invocation. Bumping the *compared floor*
  from `0.5.0` to `0.6.0` changes only the constant in a numeric comparison; it adds **no new
  command, no new probe, no extra round-trip** (REQ-PERF-01).
- Discovery (§3) is unchanged — no new lookup.
- The extended `installHint` (§4) is a **static string** consulted **only on gate failure**;
  it adds zero cost on the success path.
- The agent **availability** probe (`04-availability-precheck.md`) does **not** run on the
  default path (REQ-AVAIL-03) and is out of scope here — this document's gate is the same gate
  that ran before the feature.

Net: on the common (claude, in-range rauf) path, the runtime is byte-for-byte the same number
of subprocess calls as today (REQ-PERF-01, REQ-COMPAT-01).

## Dependencies

- **`00-core-definitions.md`** — `MIN_RUNNER_VERSION = "0.6.0"` (§2), `RUNNER_DEFAULT_ID`
  (§1.2); the gate's floor constant.
- **`02-config-schema-and-gating.md`** — *shares the file* `references/forge-config-schema.json`:
  `02` owns the `minRunnerVersion` schema field and its `default` (0.5.0 → 0.6.0); this doc owns
  the gate behavior, discovery, and the amended `installHint` wording in that same file. Both
  must be applied coherently (§6). No ordering dependency between them beyond the shared file.
- **External (consumed, fixed by CON-02/CON-03):** rauf `≥ 0.6.0` — `{bin} version --json`
  reporting `VERSION = "0.6.0"` (`packages/core/src/version.ts:4`); the agent surface verified
  present at that version (§1 table). Provisioned by the cross-agent installer as
  `RAUF_PIN = "rauf@0.6.0"` (`installer/src/rauf.ts:30`).

This document is independent of `03-selection-resolution-observability.md` and
`04-availability-precheck.md` (the gate runs before any agent step). It is **restated** (not
extended) by `06-loop-runner-contract-doc.md`, which owns the `references/ralph-loop-contract.md`
`## Version gating` edit; this doc specifies the *gate behavior + the schema/skill wording*, not
the contract-doc prose.

## Verification

Concrete checks an implementer can run to confirm an implementation matches this spec:

- [ ] **Floor source-presence (§1):** `packages/core/src/version.ts` in rauf reports
      `VERSION = "0.6.0"`, and the agent surface exists at that version
      (`--agent` at `packages/cli/src/commands.ts:198`; `handleAgents` at
      `packages/cli/src/loop-commands.ts:1190`; `AgentAvailability` at
      `packages/loop/src/providers/registry.ts:14`).
- [ ] **Schema default (§2, REQ-BIN-02):** `references/forge-config-schema.json`
      `loopRunner.minRunnerVersion.default == "0.6.0"` (asserted by the pytest in
      `07-testing-strategy.md`). The mock-rauf
      (`tests/fixtures/mock-rauf/rauf`) emits `version --json` → `{ "version": "0.6.0" }`.
- [ ] **Hard-gate before side-effects (§2, REQ-BIN-04):** with the mock-rauf reporting a
      version `< 0.6.0` (or non-zero exit / non-JSON), `forge-5-loop` STOPS at Step 1c — no
      pipeline-state write, no `mkdir`, no launch — and shows `installHint` plus the raw output.
- [ ] **Skill floor wording (§2.3):** `skills/forge-5-loop/SKILL.md` Step 1c names `0.6.0` and
      the agent-surface rationale (not the 0.5.0 grammar flip), and the
      `installHint`-vs-`setupHint` callout (§4.4) is intact.
- [ ] **Discovery unchanged (§3, REQ-BIN-01):** `loopRunner.bin` default is `"rauf"`; `{bin}`
      substitution is the only discovery mechanism; no new lookup code/prose introduced.
- [ ] **Hint dual-path (§4, REQ-BIN-03):** `references/forge-config-schema.json`
      `loopRunner.installHint.default` contains **both** `npx feature-forge install` **and** the
      `install-binary.sh` one-liner; `setupHint` is unchanged. Grep: `installHint` mentions the
      installer entrypoint; `setupHint` does not mention the version gate.
- [ ] **Installer-pin coherence (§4.3, CON-03):** the `0.6.0` in `minRunnerVersion` and in the
      `installHint` cross-agent path equal the installer's `RAUF_PIN` (`installer/src/rauf.ts:30`
      = `"rauf@0.6.0"`).
- [ ] **No extra default-path cost (§5, REQ-PERF-01):** the mock-runner default-path test
      (`07-testing-strategy.md`) shows the same subprocess call count as baseline (one version
      gate, no probe).
- [ ] **Adapters drift:** after editing canonical `skills/`/`references/`, `python3
      scripts/build-adapters.py --check` passes (per `01-architecture-layout.md §4`).
