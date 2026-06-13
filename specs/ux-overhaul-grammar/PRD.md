# UX/DX Overhaul — Phase 2+3: Command Grammar & Contract Flip — Product Requirements Document

> **Scope note.** This PRD covers **Phase 2 (execution-command grammar & naming) and Phase 3
> (contract & machine surfaces) together**, as defined in [`../ux-overhaul/CANON.md`](../ux-overhaul/CANON.md)
> §5–§6. They are ratified to ship as a **single breaking release at v0.5.0** (the version is ratified
> for this feature; CANON.md's own `[PROPOSED]` wording is amended separately) — exactly
> one moment of breakage. Phase 1 (the observation substrate) is already shipped and merged; this
> feature builds on it. Phase 4 (web recovery actions + status vocabulary/badges + provider-agnostic
> agent templates) is a **separate feature** (`ux-overhaul-web`) and is out of scope here. `CANON.md`
> is the cross-cutting source of truth; where this PRD and the canon disagree, the canon wins (or is
> amended first). Requirement IDs below are referenced by the downstream tech spec, implementation
> specs, and backlog.

> **Ratified in this PRD session (CANON §7 open decisions):** (1) execution grammar = `loop run
> --detached`/`-d`, `loop start` removed; (3) adopt the proposed unified exit-code table; (4) cutover
> = one breaking flip at **v0.5.0**, bump feature-forge `minRunnerVersion`; (5) the
> `CLAUDE_ADDON.md → AGENT_ADDON.md` rename stays deferred to the Part-B provider refactor. Plus:
> removed verbs/flags emit a **targeted remediation error** (not an alias); and **the
> feature-forge update is IN SCOPE** (revised 2026-06-13 from the initial declare-contract-only framing) — this feature both ships the rauf-side changes
> *and* updates feature-forge to the new contract in lockstep, so the v0.5.0 flip leaves the whole
> toolchain coherent.

---

## 1. Problem Statement

Rauf's command surface still leaks two implementation details that Phase 1 made it possible to hide:

- **Execution mode leaks into the verb names.** `loop run` (in-process, foreground, unattended-safe)
  and `loop start` (server-owned, detached) are synonyms to a human — nothing in the names signals the
  distinction that actually matters (does it survive a server restart? does it run without my
  terminal?). Now that every observer reconstructs state from files (Phase 1), the two modes are
  observationally identical, so the surface can describe **intent** (foreground vs detached) instead of
  **mechanism** (in-process vs server).
- **The machine contract is internally inconsistent.** `status` exit codes (1=running, 2=paused_human,
  3=limit_reached) and `loop run` (6=paused_human) disagree, and `status`'s `1=running` collides with
  the conventional `1=error`. The parsed-signal surface collapses `review` into `done`, losing
  information. Signal-placement documentation contradicts the parser's actual behavior. And
  `events.ndjson` — promoted to a real observation surface in Phase 1 — has no formal versioning
  discipline as a machine contract.

These are **breaking** to correct, and that is acceptable exactly once: rauf has zero external users on
old behavior, and the only meaningful downstream consumer (feature-forge) is owned in-house and can be
updated in lockstep. The ratified strategy is a **clean break, no aliases**, landed as a **single
release (v0.5.0)** so there is one coordinated moment of breakage rather than a drip of incompatibilities.

**Who has this problem:** the operator running rauf loops (the verb/flag confusion and removed-command
friction), and the **agent/tool that is the loop's machine consumer** (feature-forge and anything reading
exit codes, signals, or `events.ndjson` — the contract inconsistencies).

**Why now / why together:** Phase 1 removed the technical blocker (mode-dependent observation), so the
grammar can finally hide the mode. The contract fixes (Phase 3) are breaking in the same way and to the
same consumer, so bundling them into one release minimizes total breakage and coordination cost.

---

## 2. User Stories

### Primary actor — Operator (human running rauf loops)

- As an operator, I want **one loop verb** whose flag tells me what I'm choosing (foreground vs
  detached), so I never have to remember whether "run" or "start" is the one that survives a server
  bounce or feeds the web.
- As an operator, I want to start a loop **in the background with one command** and immediately attach a
  live view if I choose, without separately managing a server.
- As an operator, when I type a command that was removed, I want the CLI to **tell me what replaced it**,
  not just reject it — so the clean break costs me one read, not a web search.
- As an operator, I want **one flag name per concept** (`--follow`, `--json`, `--backlog`, `--interval`)
  on every command, so muscle memory transfers.

### Primary actor — Machine consumer (feature-forge and other tools)

- As a tool driving rauf, I want **one coherent exit-code scheme** across `status` and `loop run`, so I
  can branch on outcome without special-casing which command produced the code.
- As a tool, I want a parsed-signal surface that **distinguishes `review` from `done`**, so a review
  outcome is not silently indistinguishable from completion.
- As a tool, I want `events.ndjson` to be a **versioned, additive-only contract**, so I can depend on its
  shape and detect when a major change requires me to adapt.
- As a tool, I want a **single runner version** that signals the whole new contract is in effect, so my
  version gate can require it in one check.

---

## 3. Functional Requirements

### Execution grammar (REQ-EXEC)

- **REQ-EXEC-01** *(P0)* — A single loop-execution verb (`loop run [path]`) must support two modes: **attended**
  (foreground, blocking, streams to the terminal, unattended-safe across a server bounce) and
  **detached** (returns immediately, continues running without the invoking terminal). Detached mode is
  selected by the flag `--detached` (short `-d`). *(CANON §4.1)*
- **REQ-EXEC-02** *(P0)* — The `loop start` verb must be **removed entirely** — no alias, no shim. *(clean break; CANON §4.1)*
- **REQ-EXEC-03** *(P1)* — A detached run must transparently provision whatever it needs to keep running after
  the command returns (the server daemon, auto-started). The operator must not have to separately start a
  server. *(CANON §4.1)*
- **REQ-EXEC-04** *(P2)* — `loop run --detached --follow` must, after detaching, attach the canonical live view
  (equivalent to the top-level `follow` command). **Detaching and following compose:** the loop continues
  server-owned; interrupting the attached view (Ctrl-C) **detaches the view only and does NOT stop the
  loop** — stopping a detached run requires `loop stop` (REQ-EXEC-05). *(CANON §4.1)*
- **REQ-EXEC-05** *(P1)* — `loop stop [path]` must stop a detached/server-owned loop. A foreground `loop run` is
  stopped by interrupting it (Ctrl-C), as today. *(CANON §4.1)*
- **REQ-EXEC-06** *(P1)* — An attended run and a detached run of the same backlog must remain **observationally
  identical** across all observers (CLI, web, external tools) — naming the mode must not change what can
  be observed. *(inherited from the Phase 1 substrate; must not regress)*

### Flag canon (REQ-FLAG)

- **REQ-FLAG-01** *(P1)* — `--follow` / `-f` must be the **one** streaming-follow flag, on every command that
  streams (`status`, `log`, `follow`, and `loop run --detached`). `--watch` must be removed everywhere. *(CANON §4.1)*
- **REQ-FLAG-02** *(P1)* — `--json` must be honored on **every** read/monitor command, including streaming ones
  (emitting NDJSON where streaming) — e.g. `status --follow --json`. *(CANON §4.1)*
- **REQ-FLAG-03** *(P1)* — `--backlog <dir>` must be the **single** way to target a non-default backlog root, on
  every command that touches state. No command may introduce a second spelling. *(CANON §4.1)*
- **REQ-FLAG-04** *(P1)* — `--interval <seconds>` must be the **single** poll-cadence flag, applicable under
  `--follow`. *(CANON §4.1)*

### Unified exit codes (REQ-EXIT)

- **REQ-EXIT-01** *(P0)* — A single exit-code scheme must be used by **both** `status` (reflecting current state)
  and `loop run` (reflecting terminal state): **0** success (clean terminal: idle/complete) · **1** error
  (generic failure) · **2** usage (bad args / IO) · **3** needs human (`PAUSED_HUMAN`) · **4** limit
  reached / usage-paused / sleeping · **5** blocked (terminal with blocked items) · **6** running
  (query-time only, `status`). *(CANON §4.4)*
- **REQ-EXIT-02** *(P0)* — The current inconsistencies must be eliminated: the `status`(1/2/3) vs `loop run`(6)
  disagreement, and the `1=running` / `1=error` collision. *(CANON §4.4)*
- **REQ-EXIT-03** *(P0)* — `backlog validate` must keep its existing, coherent codes (0 valid / 1 findings / 2
  usage) unchanged. *(CANON §4.4)*
- **REQ-EXIT-04** *(P0)* — The exit-code scheme is a **documented machine contract**; its values must be
  specified precisely enough for a downstream consumer (feature-forge) to depend on them.

### Signals (REQ-SIG)

- **REQ-SIG-01** *(P0)* — The parsed-signal surface (`signal_parsed.signal`) must expose an explicit **`review`**
  value rather than collapsing `review` into `done`. *(clean break; CANON §4.5)*
- **REQ-SIG-02** *(P1)* — Signal-placement documentation (the backlog-tool contract and the agent templates)
  must be reconciled with the **actual** parser behavior: the signal is emitted on a line by itself, the
  runner scans from the **end** of output, and trailing summaries / commit messages do not break
  detection. *(CANON §4.5)*

### Machine surfaces (REQ-EVT)

- **REQ-EVT-01** *(P0)* — `events.ndjson` must be a **stable, versioned, additive-only-within-a-major** machine
  surface, on equal footing with `--json` output and the `--ndjson` live stream. The versioning discipline
  (when and how `EVENTS_SCHEMA_VERSION` may change) must be documented. *(CANON §4.5; the version field
  already exists from Phase 1 — this formalizes the contract.)*
- **REQ-EVT-02** *(P1)* — The persisted event log and the live `--ndjson` stream must carry the **same event
  shapes**. *(CANON §4.5)*

### Removed-command remediation (REQ-RMV)

- **REQ-RMV-01** *(P0)* — Invoking a removed verb or flag (`loop start`, `--watch`) must produce a **targeted,
  non-zero error that names the replacement** (e.g. "`loop start` was removed in v0.5.0 — use `loop run
  --detached`"). This is an **error message, not an alias** — it must execute nothing and must not run the
  replacement. *(CANON §4.1 "error remediation polish", consistent with the no-aliases clean break.)*

### Cutover & contract (REQ-CONTRACT)

- **REQ-CONTRACT-01** *(P0)* — All breaking changes in this feature (removed verbs/flags, the exit-code scheme,
  the `review` signal value, the events versioning discipline) must land in a **single release** —
  **v0.5.0** — so there is exactly one moment of breakage.
- **REQ-CONTRACT-02** *(P0)* — The runner must report a version (via `rauf version --json`) of **≥ 0.5.0**
  reflecting the flip, so a downstream version gate can require the whole new contract in one check.
- **REQ-CONTRACT-03** *(P0)* — This feature must **document the new contract** (exit codes, signal vocabulary,
  `events.ndjson` version and shapes, removed/renamed commands) precisely enough that feature-forge can be
  updated against it.
- **REQ-CONTRACT-04** *(P0)* — **feature-forge must be updated to the new contract as part of this feature's
  definition of done** (in scope, ratified 2026-06-13). The concrete updates: bump
  `loopRunner.minRunnerVersion` from `0.2.0` to **`0.5.0`** in `references/forge-config-schema.json`
  (schema default) and `skills/forge-5-loop/SKILL.md`, and align the contract/compatibility docs
  (`COMPATIBILITY.md`, `CHANGELOG.md`, `references/ralph-loop-contract.md`); and re-validate that
  feature-forge's `status --json` / exit-code reads still hold under the new exit-code scheme
  (REQ-EXIT-01). The feature-forge baseline to edit against is current `main` with **epic support merged**
  (PR #2). *(Note: feature-forge invokes the configurable `loopRunner` `runCommand`, which already defaults
  to `loop run … --ndjson` — NOT `loop start` — so no `loop start` / `--watch` references exist in
  feature-forge to remove; the breaking surface for it is the version gate and the exit-code/status reads.)*
- **REQ-CONTRACT-05** *(P0)* — Because feature-forge is a **separate git repository** outside the rauf loop's
  write sandbox, the feature-forge edits (REQ-CONTRACT-04) are performed as an explicit **out-of-loop step
  at cutover** (not by the rauf autonomous loop), but are **gated as part of this feature's completion** —
  the flip is not "done" until both the rauf-side changes and the feature-forge update have landed together.

### Documentation (REQ-DOC)

- **REQ-DOC-01** *(P0)* — The affected project specs must be updated to the new surface as part of "done":
  `docs/SPEC-CLI.md`, `docs/SPEC-WEB.md`, `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`, `docs/SCHEMAS.md`,
  `docs/ARCHITECTURE.md`, `docs/SPEC-ARTIFACTS.md`. *(CANON §5)*
- **REQ-DOC-02** *(P1)* — The CLI **help / usage output** (top-level and per-command `--help`) must reflect
  the new grammar — the single `loop run [--detached|-d]` verb, the removed `loop start` / `--watch`, and
  the canonical `--follow`/`-f`, `--json`, `--backlog`, `--interval` flag set — with **no references to
  removed verbs/flags** except the REQ-RMV-01 remediation messages. *(CANON §5 "help + error remediation")*

---

## 4. Non-Functional Requirements

- **NFR-COMPAT-01** *(P0)* — **Clean break, no deprecation aliases** (ratified). The only backward-compatibility
  affordance is the REQ-RMV-01 remediation *message*. Justified by zero external users on old behavior.
- **NFR-CUTOVER-01** *(P0)* — The flip must be coordinated so the project's own self-hosting loop continues to
  function across the version boundary, and the documented contract is sufficient for feature-forge to be
  brought to compatibility in the same change window.
- **NFR-PARITY-01** *(P1)* — The observation parity established in Phase 1 must be **preserved**: the grammar
  change must not reintroduce any mode-dependent difference in what observers can see.
- **NFR-SAFETY-01** *(P0)* — Every implementing loop must be run with the **frozen `rauf-stable`** binary, never
  the dev binary whose command surface is being rewritten. (`forge.config.json` already pins
  `loopRunner.bin = "rauf-stable"`.)
- **NFR-PERF-01** *(P1)* — No regression in command startup latency or file-based status derivation.
- **NFR-QUALITY-01** *(P0)* — The full quality gate (typecheck, lint, format, tests) must pass; new behavior
  (new flag parsing, exit-code mapping, signal value, remediation errors) must be covered by tests.

---

## 5. Out of Scope

- **Phase 4 — web parity, status vocabulary, badges** (`ux-overhaul-web`): web recovery actions
  (reset/resume/review/unblock/validate), the shared status label map, and the missing badges
  (`REVIEWING`, `PAUSED_USAGE_LIMIT`, "Needs Human"). Separate feature.
- **The `CLAUDE_ADDON.md → AGENT_ADDON.md` rename and provider-neutral wording** — deferred to the Part-B
  provider refactor so it is not done twice. (The commit-rule fix itself already landed in Phase 1.)
- **The Part-B provider architecture** (which LLM drives an iteration) — separate effort.
- **Backlog schema redesign** — `backlog.json` shape is stable; only the `schemaVersion` discipline
  already in the contract applies.
- **Eliminating an execution mode** — both in-process and server-owned runs stay (unattended-safe vs
  interruptible). We hide the split, not remove it.

  *(Note: the feature-forge update is now **in scope** — see REQ-CONTRACT-04/05. It was moved out of
  "out of scope" on 2026-06-13.)*

---

## 6. Constraints

- **CANON.md is the source of truth.** Where this PRD and `../ux-overhaul/CANON.md` disagree, the canon
  wins (or is amended first).
- **Existing infrastructure:** Bun/TypeScript monorepo (`packages/core`, `loop`, `cli`, `web`); the
  detached-run mechanism reuses the existing Hono server daemon (bound to 127.0.0.1).
- **Downstream consumer:** feature-forge gates on `rauf version --json` against `minRunnerVersion` and
  reads `status --json` / exit codes — the contract changes here are breaking *for it*, hence the
  coordinated cutover. feature-forge lives in a **separate git repo** (`/home/gary/workspace/feature-forge`,
  current `main`, epic support merged via PR #2) — outside the rauf loop's write sandbox, so its updates
  (REQ-CONTRACT-04) are made out-of-loop at cutover (REQ-CONTRACT-05).
- **Self-hosting hazard:** this feature rewrites the very `loop run` / `loop start` commands the runner
  invokes; dogfooding must use `rauf-stable` (NFR-SAFETY-01).

---

## 7. Success Criteria

- `loop start` is gone; `loop run --detached` (`-d`) starts a detached run that auto-provisions the
  server and returns immediately; `loop run --detached --follow` attaches the live view; `loop stop`
  stops it.
- `loop run --detached --follow` composes correctly: Ctrl-C on the attached view detaches the view only
  and leaves the loop running (verified by a subsequent `status`/`loop stop`).
- `--follow`/`-f`, `--json`, `--backlog`, `--interval` are consistent across every command they apply to;
  `--watch` is gone; `--json` works even under `--follow`.
- One exit-code scheme is implemented in both `status` and `loop run`; `backlog validate` is untouched.
- `signal_parsed.signal` distinguishes `review`; signal-placement docs match the parser.
- `events.ndjson` is documented as a versioned, additive-only machine surface carrying the same shapes as
  the `--ndjson` stream.
- A removed verb/flag yields a targeted "removed → use X" error (non-zero, executes nothing).
- The runner reports version ≥ 0.5.0; the new contract is documented; **and feature-forge is updated in
  lockstep** (`minRunnerVersion` 0.2.0 → 0.5.0 in the config schema + forge-5-loop skill + compat/contract
  docs, exit-code/status reads re-validated) so the toolchain is coherent at the flip.
- All affected `docs/SPEC-*.md` updated; full quality gate green; the whole change lands as one v0.5.0
  release.

---

## 8. Open Questions

None outstanding. All CANON §7 `[PROPOSED]` decisions in scope for this feature were ratified in the PRD
session (see the ratification note at the top). The `AGENT_ADDON` rename and the Part-B provider work are
explicitly deferred (§5).
