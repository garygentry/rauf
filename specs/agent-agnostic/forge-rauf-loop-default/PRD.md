# forge-rauf-loop-default — Product Requirements Document

> Epic member of **agent-agnostic**. Target repo: **feature-forge** (the forge↔rauf
> integration seam). Depends on `rauf-agent-cli-adapters` and `cross-agent-installer`
> (both complete). This PRD is requirements-only; mechanism choices belong to the tech spec.

## 1. Problem Statement

feature-forge's pipeline ends by handing a verified `backlog.json` to an autonomous
**loop runner** that implements each item. That seam is already mature: `forge-5-loop`
defaults to rauf, is fully pluggable through the tokenized `loopRunner` block in
`forge.config.json`, gates the runner version, and supervises runs over a structured
event stream.

What the seam does **not** yet carry is the **coding-agent dimension**. rauf now ships a
full agent-selection surface — a per-run `--agent <id>` selector, a `rauf agents`
availability probe, per-item `BacklogItem.provider`, and a 5-layer precedence (item → run
→ project → global → default `claude-cli`) deliberately parallel to its model precedence.
feature-forge exposes none of it: `forge-5-loop`'s optional-flags catalog stops at
`--model/--review/--timeout/--retry-blocked`, and the `loopRunner` config block has no
agent field. Separately, the `cross-agent-installer` now provisions rauf at a pinned
version (`rauf@0.6.0`), but forge still assumes a bare `rauf` on PATH and floors the
version gate at `0.5.0` — which predates the agent surface, so the gate cannot guarantee
the agent capability even exists.

This feature closes those gaps and **formally owns the forge↔rauf contract**: forge defaults
to rauf, drives loop iterations across any coding agent rauf supports, stays pluggable for
alternate runners, and reliably locates the rauf the installer provisioned. It matters now
because it is the last substantive epic member before the `packaging-docs-ci` capstone, which
documents this very contract.

## 2. User Stories

- **As a forge user**, I want to run `forge-5-loop` and have it drive rauf with claude by
  default — exactly as today — so existing projects are unaffected.
- **As a forge user on a non-claude agent** (codex/gemini/copilot/cursor), I want to select
  the coding agent for a loop run so my backlog is implemented by the agent I actually use.
- **As a forge user**, I want a project-level default agent so I don't retype the selector
  every run, while still being able to override it per run.
- **As a forge user**, I want forge to tell me *before* a long run starts if the agent I
  selected isn't actually installed, so I don't discover it mid-run hours later.
- **As an operator swapping in an alternate (non-rauf) loop runner**, I want agent selection
  to disappear cleanly when the runner has no agent surface, so pluggability is preserved.
- **As a backlog author**, I want any per-item agent I set in `backlog.json` to be honored at
  its correct (highest) precedence and never silently overridden by the run-level selection.
- **As the maintainer of the capstone**, I want a single documented forge↔rauf loop-runner
  contract — covering default-to-rauf, agent selection, and which stages carry the agent
  dimension — so packaging-docs-ci can document and CI-gate it.

## 3. Functional Requirements

### 3.1 Default-to-rauf, pluggable seam (the exposed contract)

- **REQ-DEF-01**: `forge-5-loop` MUST default to rauf as its loop runner when
  `forge.config.json` has no `loopRunner` block, announcing the default plainly, exactly as
  today.
  - Priority: P0
  - Notes: Preserves the current behavior; this feature formalizes it as the exposed
    `forge-loop-runner-contract`.
- **REQ-DEF-02**: The seam MUST remain pluggable — an alternate runner conforming to the
  backlog-tool/loop-runner contract can be configured via `loopRunner` without editing any
  pipeline skill. No hardcoded `rauf …` commands may be introduced.
  - Priority: P0
- **REQ-DEF-03**: This feature MUST produce a single authoritative description of the
  forge↔rauf loop-runner contract (default-to-rauf, pluggability, agent selection, and
  per-stage agent applicability) that `packaging-docs-ci` consumes as documentation input.
  - Priority: P0
  - Notes: Satisfies the `forge-loop-runner-contract` **expose** obligation.

### 3.2 Agent selection surface (consumes `loop-agent-selection`)

- **REQ-AGENT-01**: `forge-5-loop` MUST offer a **per-run agent selector** that chooses which
  coding agent rauf drives for the run, surfaced in the same place as the existing optional
  flags (`--model`, etc.).
  - Priority: P0
  - Notes: Consumes rauf's `loop-agent-selection` surface (`--agent <id>`).
- **REQ-AGENT-02**: `forge.config.json`'s `loopRunner` block MUST support a **project-default
  agent** so a project can fix its agent once without specifying it every run.
  - Priority: P0
- **REQ-AGENT-03**: When no agent is selected at any layer, behavior MUST be identical to
  today — rauf's default agent (claude) drives the run.
  - Priority: P0
- **REQ-AGENT-04**: The pre-launch confirmation step MUST list the **available coding agents**
  (sourced from rauf's `agents` availability probe) so the user can choose from what is
  actually installed.
  - Priority: P1
  - Notes: Full-mirror of rauf's surface; the listing is informational at confirm time.
- **REQ-AGENT-05**: Per-item agent (`BacklogItem.provider`) MUST be **pass-through**:
  `forge-5-loop` preserves any item-level agent rauf reads and MUST NOT override it with the
  run-level selection. Authoring per-item agent into `backlog.json` is out of scope.
  - Priority: P0

### 3.3 Agent precedence

- **REQ-PREC-01**: The agent-selection precedence MUST be documented and behave **parallel to
  the existing model-selection precedence**: item-level agent > run-level selection >
  project default > runner/provider default.
  - Priority: P0
  - Notes: Mirrors rauf's documented 5-layer precedence; forge owns the run/project/default
    layers it passes through, never re-implementing rauf's resolution.
- **REQ-PREC-02**: The run-level selection MUST occupy the **run layer only** — strictly below
  item-level and strictly above the project default — so it cannot clobber a deliberate
  per-item agent.
  - Priority: P0

### 3.4 Availability pre-check (consumes the `agents` probe)

- **REQ-AVAIL-01**: When a **non-default** agent is selected, `forge-5-loop` MUST verify it is
  available (via rauf's `agents` availability probe) **before launching** the run.
  - Priority: P0
  - Notes: Avoids a long run failing mid-flight on a missing agent CLI.
- **REQ-AVAIL-02**: If the selected agent is unavailable, forge MUST warn the user and let
  them either proceed anyway or choose a different agent — it MUST NOT silently abort or
  silently proceed.
  - Priority: P0
- **REQ-AVAIL-03**: The pre-check MUST NOT run for the default (claude) path, so the common
  case incurs no extra probe and behaves exactly as today.
  - Priority: P1

### 3.5 Capability-gated pluggability

- **REQ-PLUG-01**: Agent selection MUST be **gated on the runner advertising an agent
  surface** in its `loopRunner` configuration. A runner that advertises no agent surface
  MUST cause forge to omit agent selection entirely and behave exactly as today.
  - Priority: P0
  - Notes: Keeps alternate (non-rauf) runner support first-class; degradation is silent, not
    an error.
- **REQ-PLUG-02**: When agent selection is gated off, the per-run selector and the
  availability pre-check MUST NOT appear or run, and no agent argument may be sent to the
  runner.
  - Priority: P0

### 3.6 Runner discovery & version coherence (consumes `cross-agent-installer-cli`)

- **REQ-BIN-01**: forge MUST reliably locate the rauf binary the `cross-agent-installer`
  provisions so the default loop path works after a multi-agent install.
  - Priority: P0
  - Notes: Consumes `cross-agent-installer-cli`; the installer ensures rauf is reachable on
    PATH.
- **REQ-BIN-02**: The runner **version gate** MUST floor at the rauf version that ships the
  agent-selection surface (the installer's pinned `rauf@0.6.0` line), so a successful gate
  guarantees `--agent` / `agents` exist before the run.
  - Priority: P0
- **REQ-BIN-03**: The runner setup/install hints MUST point at the **cross-agent installer**
  as the provisioning path for a multi-agent install, while keeping the rauf-CLI
  install/upgrade hint distinct (version-gate failure vs. per-project-setup failure).
  - Priority: P1
- **REQ-BIN-04**: A missing or too-old rauf MUST fail the gate with a clear, actionable
  message (which install path to run), **before** any loop side-effects — preserving the
  current hard-gate behavior.
  - Priority: P0

### 3.7 Per-stage agent applicability (forge-verify coverage)

- **REQ-SEAM-01**: The forge↔rauf contract MUST classify **every** forge stage that invokes
  the runner: `forge-5-loop` (execution) carries the full agent surface; `forge-4-backlog`
  and `forge-verify` invoke only the agent-agnostic `validate` verb.
  - Priority: P0
- **REQ-SEAM-02**: The `validate` verb MUST remain **agent-agnostic** — no agent argument may
  be passed to backlog validation in any stage — and the contract MUST state this explicitly
  to prevent a future contributor wrongly bolting an agent flag onto validate.
  - Priority: P0
  - Notes: This is the agreed reading of "agent flows through forge-verify too" — contract
    coverage of forge-verify, with an explicit agnostic note, not a new agent-driven run.

## 4. Non-Functional Requirements

### 4.1 Performance
- **REQ-PERF-01**: The default (claude) path MUST add no new runtime cost — no extra agent
  probe, no extra gate work beyond the version-floor bump.
  - Priority: P0
- **REQ-PERF-02**: The availability pre-check (non-default agent only) MUST be a single,
  bounded one-shot probe that does not materially delay launch.
  - Priority: P1

### 4.2 Security
- **REQ-SEC-01**: The agent selector value MUST be constrained to the runner's known agent
  ids (no arbitrary string interpolated into a shell command beyond the contract's tokenized
  argument), consistent with how existing flags are templated.
  - Priority: P0

### 4.3 Observability
- **REQ-OBS-01**: The selected agent (and its source layer: run vs. project vs. default) MUST
  be visible to the user at launch — in the pre-launch confirmation and the "loop started"
  inform-user output — so it is auditable which agent drove a run.
  - Priority: P1
- **REQ-OBS-02**: Existing structured supervision (NDJSON event stream, status JSON) MUST be
  unchanged; this feature adds no new event types.
  - Priority: P1

### 4.4 Accessibility
- Not applicable — this feature has no end-user UI surface beyond the existing CLI/skill text.

### 4.5 Compatibility / Scalability
- **REQ-COMPAT-01**: Standalone (non-epic) feature runs and existing claude-default projects
  MUST behave exactly as before — agent selection is purely additive.
  - Priority: P0
- **REQ-COMPAT-02**: Concurrent loop runs for different features (isolated per `--backlog`
  state dir) MUST be unaffected; agent selection is per-run and carries no shared state.
  - Priority: P1

## 5. Constraints

- **CON-01** (target repo): All implementation lands in **feature-forge** — pipeline skills
  (`forge-5-loop`), the `loopRunner` config schema, and the loop-runner contract reference
  docs. rauf is consumed, not modified.
- **CON-02** (consumed surfaces are fixed): The agent surface consumed from
  `rauf-agent-cli-adapters` is rauf's existing `--agent <id>` flag, `rauf agents [--json]`
  probe (`{ agents: AgentAvailability[] }`), `BacklogItem.provider`, and the 5-layer
  precedence. This feature MUST conform to those, not redesign them.
- **CON-03** (installer coordinate): rauf is provisioned by the `cross-agent-installer` as an
  external pin (`rauf@0.6.0`). The version floor and provisioning hints must align to this
  coordinate.
- **CON-04** (contract authority): rauf owns the backlog-tool/loop-runner contract spec; the
  pluggability mechanism is the tokenized `loopRunner` block — agent selection must be
  expressed as additional tokenized config, not hardcoded commands.
- **CON-05** (verification stack): feature-forge's gate is `bash scripts/validate.sh`
  (spec-purity, lint, pytest). rauf's `pnpm gate` does not apply to this feature's artifacts.

## 6. Out of Scope

- **rauf adapter internals** — the `agent-cli-registry` / `AgentAdapter` / `CliAgent` engine
  inside rauf (owned by `rauf-agent-cli-adapters`, complete). This feature only consumes the
  selection surface.
- **User-facing READMEs and per-agent setup docs** — owned by the `packaging-docs-ci`
  capstone. This feature produces the *contract* doc that capstone documents, not the READMEs.
- **The cross-agent-installer implementation** — complete; this feature consumes it (locates
  rauf), it does not modify it.
- **Authoring per-item agent into `backlog.json`** — per-item agent is pass-through only;
  setting `BacklogItem.provider` during authoring is a backlog-authoring concern.
- **Pause/resume-with-human-answer** for a set-aside item mid-run — a runner enhancement, not
  this seam.
- **A new agent-driven execution mode in `forge-verify`** — forge-verify's runner call stays
  the agent-agnostic `validate` only.

## 7. Open Questions

- **OQ-01**: Confirm the exact rauf version that first shipped the `--agent` surface matches
  the installer's `rauf@0.6.0` pin (used to set the version floor in REQ-BIN-02). To be
  resolved against rauf's `version.ts` / CHANGELOG during the tech spec.
- **OQ-02**: Whether the project-default agent (REQ-AGENT-02) lives as a dedicated
  `loopRunner` field or is folded into the tokenized agent-argument config — a tech-spec
  mechanism decision, not a requirement.

## 8. Success Criteria

- **SC-01**: With no `loopRunner` block and no agent selection, `forge-5-loop` drives rauf
  with claude exactly as today (REQ-DEF-01, REQ-AGENT-03, REQ-COMPAT-01).
- **SC-02**: A user can select a non-default agent per run and via a project default, with the
  documented precedence (item > run > project > default) observably honored (REQ-AGENT-01/02,
  REQ-PREC-01/02).
- **SC-03**: Selecting an unavailable non-default agent produces a pre-launch warning with a
  proceed/choose-another path — the run does not start blind (REQ-AVAIL-01/02).
- **SC-04**: Configuring an alternate runner with no agent surface makes agent selection
  vanish and the loop behaves exactly as today (REQ-PLUG-01/02).
- **SC-05**: The version gate floors at the agent-capable rauf and fails clearly when rauf is
  missing/too-old, pointing at the correct install path (REQ-BIN-02/03/04).
- **SC-06**: The forge↔rauf loop-runner contract document classifies every runner-touching
  stage and explicitly marks `validate` agent-agnostic (REQ-SEAM-01/02, REQ-DEF-03).
- **SC-07** (verification): feature-forge's `bash scripts/validate.sh` gate passes, **and** a
  mock-runner test proves the agent plumbing, precedence, availability pre-check, and
  capability-gated degradation without a live agent. The real-agent end-to-end run (a true
  multi-agent install driving a loop) is maintainer-run and not CI-automatable.
