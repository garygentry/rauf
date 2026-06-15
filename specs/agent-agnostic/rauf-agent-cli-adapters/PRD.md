# rauf-agent-cli-adapters — Product Requirements Document

> Epic: `agent-agnostic` (member feature). Target repo: **rauf** (this repo).
> Charter obligations (from `epic-manifest.json`): expose `AgentAdapter`, `agent-cli-registry`,
> and `loop-agent-selection`. Every obligation below traces to a REQ.

## 1. Problem Statement

The rauf loop runner can only drive its autonomous iterations through one coding-agent CLI:
`claude`. The binary name is hardcoded in the spawn path, the runner ignores the `provider`
option that already exists in its schema, lifecycle events hardcode `provider: "claude-cli"`, and
the pre-iteration usage preflight is specific to Anthropic. As a result, teams that prefer (or are
required to use) other coding agents — OpenAI Codex, Gemini CLI, GitHub Copilot, Cursor, or any
other command-line agent — cannot run a rauf loop at all.

This matters now because the `agent-agnostic` epic makes both rauf and feature-forge operate under
any coding agent, and the loop is the integral execution engine of the feature-forge lifecycle.
Until the loop runner can drive an arbitrary coding-agent CLI, "feature-forge defaults to rauf and
ships it for multiple agents" (sibling features) has nothing to stand on. This feature is the
foundation: a coding-agent CLI adapter layer that lets a single loop iteration be executed by any
supported agent CLI, with `claude` remaining the default and first-class.

This feature concerns the **coding-agent CLI** axis — which agent *harness/CLI* runs an iteration
(claude vs codex vs gemini vs copilot vs cursor) — not the LLM-model-API axis (which vendor's model
answers). It delivers CLI adapters only.

## 2. User Stories

- As a **loop operator**, I want to choose which coding agent drives my loop (per run, per project,
  or globally), so that I can run rauf with the agent my team is standardized on.
- As a **loop operator**, I want a clear, immediate error when I select an agent whose CLI isn't
  installed, so that I'm not left debugging a murky mid-iteration failure.
- As a **loop operator**, I want to list which agents rauf supports and which are actually available
  on my machine, so that I can pick a working one without trial and error.
- As an **existing claude user**, I want the loop to behave exactly as it does today when I don't
  select an agent, so that this change is invisible to me.
- As a **backlog author**, I want to set the agent on an individual backlog item, so that a single
  backlog can route different items to different agents.
- As a **downstream consumer (feature-forge)**, I want a stable agent-selection surface and adapter
  registry to drive, so that the forge loop stage can invoke rauf across agents without knowing each
  agent's invocation details.
- As an **operator running unattended**, I want each agent invoked non-interactively (no permission
  prompts), so that the loop runs to completion without human babysitting.

## 3. Functional Requirements

### 3.1 Agent Selection (`loop-agent-selection`)

- REQ-SEL-01: The loop runner MUST accept a coding-agent selection identifying which agent CLI
  drives iterations. The user-facing surface is named **`--agent`** (CLI flag) and `agent`
  (config keys). Priority: P0.
  - Notes: The internal provider abstraction retains the committed name `provider`/`LLMProvider`;
    `--agent`/`agent` is the user-facing alias mapping onto it. Reconciling this naming with the
    committed schema is a tech-spec concern (see Constraints).
- REQ-SEL-02: Agent selection MUST resolve across layers with this precedence (highest wins):
  per-backlog-item agent → run-level `--agent` flag → project config (`.rauf.json`) → global
  default (`~/.rauf/config.json`) → built-in default `claude`. Priority: P0.
  - Notes: Deliberately parallels the documented model-selection precedence
    (item > flag/options > project default > provider default).
- REQ-SEL-03: When no agent is selected at any layer, the runner MUST use `claude`, producing
  behavior identical to today. Priority: P0.
- REQ-SEL-04: A backlog item MUST be able to specify its own agent, allowing a single backlog to
  mix agents across items. Priority: P0.

### 3.2 Adapter Contract & Named Adapters (`AgentAdapter`)

- REQ-ADP-01: There MUST be a single agent-adapter abstraction (`AgentAdapter`) defining how the
  runner drives one iteration through an agent: launch the agent process, deliver the prompt,
  consume its output, and report a resolved outcome. The runner MUST drive every agent — including
  claude — exclusively through this abstraction. Priority: P0.
- REQ-ADP-02: Each first-class adapter MUST encapsulate its own invocation contract (which binary,
  arguments, prompt-delivery mechanism, output format, model flag, and non-interactive/auto-approve
  flags). The runner MUST NOT hardcode any single agent's invocation specifics. Priority: P0.
- REQ-ADP-03: The feature MUST ship working first-class adapters for: `claude` (preserving today's
  behavior), `codex`, `gemini`, `copilot`, and `cursor`. Priority: P0.
  - Notes: copilot and cursor are first-class in this feature (confirmed in interview), alongside
    codex and gemini.
- REQ-ADP-04: The feature MUST ship a configurable **generic-cli** adapter whose invocation
  (binary, args, prompt-delivery, output format, environment) is fully driven by configuration, so
  any other command-line agent is reachable without writing new code. Priority: P0.
- REQ-ADP-05: Adapters MUST be discoverable/selectable through a registry keyed by a stable agent
  id (`agent-cli-registry`). Selecting an agent resolves to its adapter via this registry.
  Priority: P0.
- REQ-ADP-06: The provider seam MUST be wired through **both** runner execution paths — the main
  work iteration and the review pass — so agent selection applies uniformly. Neither path may bypass
  the adapter abstraction. Priority: P0.

### 3.3 Execution & Unattended Operation

- REQ-EXEC-01: Each adapter MUST invoke its agent **non-interactively** (no permission/confirmation
  prompts), equivalent to claude's current non-interactive auto-approve invocation, so that the loop
  runs unattended to completion. Priority: P0.
- REQ-EXEC-02: Process lifecycle MUST behave uniformly across agents: a per-iteration timeout, and a
  cancel/stop that terminates the agent process (and its child process group) cleanly. Priority: P0.
- REQ-EXEC-03: The agent's exit MUST be classified into the existing loop outcome vocabulary (done /
  blocked / needs-human / error / limit) regardless of which agent produced it. Priority: P0.

### 3.4 Signal Contract (`RAUF_*`)

- REQ-SIG-01: The `RAUF_DONE` / `RAUF_BLOCKED:<reason>` / `RAUF_NEEDS_HUMAN:<reason>` /
  `RAUF_REVIEW:<json>` signal vocabulary MUST be the uniform completion contract for every agent.
  An iteration's outcome is determined by parsing these signals from the agent's textual output,
  independent of the agent. Priority: P0.
- REQ-SIG-02: Signal detection MUST work for agents that emit only plain text (no structured stream
  format), via the plain-text output path. Priority: P0.

### 3.5 Detection & Availability

- REQ-DET-01: Before the loop starts, the runner MUST detect whether the selected agent's CLI is
  available on the system. Priority: P0.
- REQ-DET-02: If the selected agent's CLI is not available, the runner MUST fail fast **before any
  iteration runs or any state is written**, with a clear message naming the agent and how to make it
  available (e.g. install/PATH guidance). It MUST NOT silently fall back to claude. Priority: P0.

### 3.6 Discoverability

- REQ-DISC-01: The supported agent ids MUST be enumerable from CLI help (and surfaced in
  selection-error messages). Priority: P0.
- REQ-DISC-02: There MUST be a discovery surface that lists supported agents together with whether
  each is actually detected/installed on the current machine and its status. Priority: P1.

### 3.7 Model Interplay

- REQ-MODEL-01: Model resolution MUST remain independent of agent selection, keeping the existing
  precedence (item.model > `--model` > project default > agent default). The selected adapter is
  responsible for translating the resolved model string into its own invocation, or ignoring it if
  unsupported. Priority: P0.
- REQ-MODEL-02: When no model is resolved, each adapter MUST let its agent use that agent's own
  default model. Priority: P0.

### 3.8 Usage / Limit Preflight

- REQ-USAGE-01: The Anthropic-specific usage/limit preflight (OAuth-token read + usage-banner
  detection, and the rate-limit pause/resume behavior) MUST run only for the claude adapter and MUST
  be preserved unchanged for it. Priority: P0.
- REQ-USAGE-02: For non-claude agents, the claude usage preflight MUST be skipped cleanly — no
  crash, no spurious limit detection. An adapter MAY optionally provide its own usage check, but none
  is required for codex/gemini/copilot/cursor in this feature. Priority: P0.

## 4. Non-Functional Requirements

### 4.1 Performance
- REQ-PERF-01: Routing through the adapter abstraction MUST NOT measurably degrade the claude path
  versus today (no added per-iteration latency beyond negligible dispatch). Priority: P1.

### 4.2 Security
- REQ-SEC-01: Non-interactive/auto-approve invocation (REQ-EXEC-01) carries the same trust posture
  per agent as the current claude invocation; this elevated-permission execution MUST be confined to
  the loop's intended sandbox/working directory and MUST NOT broaden rauf's existing path-sandboxing
  guarantees. Priority: P0.
- REQ-SEC-02: The existing `RAUF_*` signal-token neutralization (which rewrites literal signal
  tokens that appear *inside* an agent's output so a merely-quoted token cannot be mis-parsed as a
  real completion signal) MUST be applied to every agent's output before signal detection, uniformly
  across all adapters. Priority: P1.
  - Notes: This is signal-contract robustness (see §3.4 REQ-SIG), not credential redaction. rauf
    performs no credential/secret redaction of agent output today; net-new credential redaction is
    out of scope for this feature (see §6).

### 4.3 Observability
- REQ-OBS-01: Lifecycle events (agent spawned / agent exited) MUST carry the **real** selected agent
  id, never a hardcoded `claude-cli`. Priority: P0.
- REQ-OBS-02: Every agent MUST emit the core lifecycle (spawn + exit) and a resolved signal outcome.
  Token-count and tool-start/tool-end telemetry are **best-effort**: present for agents that emit a
  rich structured stream (claude today), and gracefully absent for plain-text agents — their absence
  MUST NOT be treated as an error. Priority: P0.

### 4.4 Accessibility
- Not applicable: rauf is a headless loop runner with no interactive UI surface in scope.

### 4.5 Scalability
- REQ-SCALE-01: Adding a new agent MUST be possible either by configuring the generic-cli adapter
  (no code) or by registering a new adapter against the abstraction, without changing the runner's
  orchestration logic. Priority: P1.

## 5. Constraints

- The claude path is the default and MUST stay first-class; this feature is additive and must not
  degrade existing loop behavior (organizational mandate from the epic's hard constraints).
- The committed schema and events already use the internal name `provider` (`provider`,
  `providerConfig`, `defaultProvider`, `LLMProvider`, `llm_spawned`/`llm_exited`). The user-facing
  surface is `--agent`/`agent`; reconciling the two naming layers (alias vs rename) is a tech-spec
  decision, but no requirement here may assume a breaking rename of the committed fields without that
  reconciliation.
- Must respect the rauf architecture rules in CLAUDE.md: `packages/core` has zero imports from
  cli/web; atomic writes; path sandboxing to ROOT_DIRECTORY / `~/.rauf/`; status derivation reads
  files (no subprocess). The adapter layer lives in `packages/loop`.
- The `RAUF_*` signal vocabulary is the fixed cross-agent completion contract and is not redefined
  here.
- This feature MUST NOT modify files outside the rauf repo; cross-repo wiring is delivered by
  sibling epic features (`forge-rauf-loop-default`, `cross-agent-installer`).

## 6. Out of Scope

- **SDK/API (non-CLI) agents** — driving an agent via an SDK or direct model API rather than
  spawning a CLI. This feature is CLI adapters only.
- **Rich per-agent stream parsing** — building bespoke parsers that give codex/gemini/copilot/cursor
  token & tool telemetry comparable to claude's stream-json. Non-claude agents use plain-text
  signal detection; parity telemetry is deferred.
- **feature-forge default-to-rauf wiring and installer bundling of rauf** — delivered by the sibling
  features `forge-rauf-loop-default` and `cross-agent-installer`.
- **Credential/secret redaction of agent output** — rauf performs no output credential redaction
  today; adding it is deferred. (The existing `RAUF_*` signal-token neutralization is retained and
  generalized to all agents per REQ-SEC-02 — that is signal robustness, not credential redaction.)
- Any change to the backlog schema/contract beyond what agent selection requires.

## 7. Open Questions

- OQ-1: Exact reconciliation of the user-facing `--agent`/`agent` surface with the committed
  internal `provider` schema fields (alias-only vs rename-with-back-compat) — to be settled in
  forge-2-tech, informed by the existing `SPEC-BACKLOG-TOOL-CONTRACT.md` Part B.
- OQ-2: The precise non-interactive/auto-approve invocation for each named agent (codex, gemini,
  copilot, cursor) depends on each CLI's actual flags; the requirement (REQ-EXEC-01) is fixed, the
  per-agent flag mapping is a tech-spec/implementation detail.
- OQ-3: Whether the `generic-cli` adapter and the named adapters share a common config-driven core
  or the named ones are thin presets over generic-cli — an implementation-shape question for the
  tech spec.

## 8. Success Criteria

- SC-1: A rauf loop completes end-to-end driven by a **mock codex**, a **mock gemini**, a **mock
  copilot**, and a **mock cursor** agent in the test sandbox, AND by an arbitrary mock CLI through
  the **generic-cli** adapter — each reaching `RAUF_DONE` and committing as today. The plain-text
  mock agents complete with token/tool telemetry **gracefully absent and no error raised**.
  (Verifies REQ-ADP-01/02/03/04, REQ-EXEC-01/02/03, REQ-SIG-01/02, REQ-OBS-02.)
- SC-2: The existing **claude** path is behaviorally unchanged: all current test-sandbox scenarios
  (stream-done, stream-blocked, usage-limit, review, etc.) pass exactly as before, including the
  Anthropic usage preflight and pause/resume. (Verifies REQ-SEL-03, REQ-USAGE-01, REQ-PERF-01.)
- SC-3: Selecting an agent whose CLI is absent produces a **fail-fast error before any iteration**,
  naming the agent and how to make it available; no state is written and no fallback occurs.
  (Verifies REQ-DET-01, REQ-DET-02.)
- SC-4: Lifecycle events carry the real selected agent id (verifiable: a codex run emits codex, not
  `claude-cli`); non-claude runs skip the Anthropic usage preflight without error. (Verifies
  REQ-OBS-01, REQ-USAGE-02.)
- SC-5: `--agent` selection and its config-layer precedence behave per REQ-SEL-02; supported agents
  are listed from help and a discovery surface reports per-agent availability. (Verifies
  REQ-SEL-01/02/04, REQ-DISC-01, REQ-DISC-02.)
- SC-6: A quoted `RAUF_*` token appearing inside any agent's output is neutralized and does not
  trigger a false signal. (Verifies REQ-SEC-02.)
- SC-7: `pnpm gate` (build + schema:check + version:check + typecheck + lint + format:check + test)
  is green.
