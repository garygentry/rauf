# ux-overhaul-web — Product Requirements Document

> **Phase 4 (final) of the UX/DX overhaul.** North-star canon: `specs/ux-overhaul/CANON.md`
> (§4.3 status vocabulary, §4.6 agent contract, §5 row 4, §8 out-of-scope). Handoff context:
> `specs/ux-overhaul/PHASE-4-KICKOFF.md`. Where this PRD and CANON disagree, CANON wins.
> This phase is **mostly additive** — no breaking flip, no `minRunnerVersion` bump, no
> feature-forge lockstep edit (unlike Phase 2+3 / v0.5.0).

## 1. Problem Statement

Three loose ends remain after Phases 1–3, all rooted in the original diagnosis (CANON §2):

1. **No web recovery path for a stuck loop (CANON §2.6, §6).** Recovery and ops actions —
   `reset`, `resume`, `loop review`, `backlog unblock`, `backlog validate` — are **CLI-only**.
   A user watching a loop in the web UI who hits a `PAUSED_HUMAN`, blocked item, or wedged run
   must drop to a terminal to recover. The web shipped the *read* path in Phase 1 (events SSE,
   active-loop list, event timeline) and the detached-run start/stop routes; it has no *action*
   surface.

2. **Status vocabulary drifts across surfaces (CANON §2.5, §4.3).** The raw→display mapping is
   **triplicated** today (CLI `colorLoopState`, web projects dashboard, web status page) with
   subtly different labels and colors. Two raw states — `reviewing` and `paused_usage_limit` —
   have **no distinct derived value or badge**: they silently collapse to `RUNNING`/`PAUSED`, so a
   usage-limited loop *looks idle* and a review pass is indistinguishable from a normal run. There
   is no single source of truth for how a state is named.

3. **Agent-contract docs are incomplete (CANON §4.6).** The signal spec, model cascade, and a
   `progress.md` session-log stub are not documented in the agent-facing templates, so agents learn
   the contract by reading existing files rather than from a spec.

These matter now because Phases 1–3 made the substrate and contract coherent; this phase makes the
**human- and operator-facing surface** coherent to match, completing the overhaul.

## 2. User Stories

- **As an operator watching a loop in the web UI**, when it pauses for human input, gets blocked,
  or wedges, I want to reset / resume / run a review / unblock items / validate the backlog **from
  the web**, so I never have to drop to a terminal to recover.
- **As a user glancing at any rauf surface** (CLI, projects dashboard, status page), I want a loop's
  state to be named and badged **identically everywhere**, so "Reviewing" and "Usage Limit (Paused)"
  are visible and unambiguous rather than silently looking like "Running"/"Idle".
- **As a machine consumer of `rauf status`** (a supervisor / CI), I want a usage-limit pause to exit
  with the limit code, not a clean `0`, so I can branch on it correctly.
- **As an author writing an agent that drives a rauf loop**, I want the signal tokens, model-override
  precedence, and `progress.md` format documented in the agent contract, so I implement against a
  spec rather than by imitation.
- **As the rauf maintainer (Gary)**, I want the recovery web routes to reuse existing core/loop
  logic (no business logic reimplemented in web) and the label map to live in one module, so the
  parity surface stays maintainable and rule #1 holds.

## 3. Functional Requirements

### 3.1 Web Recovery Parity

- **REQ-WEB-01: Web reset action.** P0. The web must expose an action to reset a project's loop
  state (equivalent to the CLI `reset`), with the same option surface the CLI `reset` exposes
  (option parity — the tech spec enumerates the exact flags from the current `reset` command).
  Backend route + frontend control.
- **REQ-WEB-02: Web resume action.** P0. The web must expose an action to resume a paused/stopped
  loop (equivalent to the CLI `resume`), including the retry-blocked convenience.
- **REQ-WEB-03: Web review action.** P0. The web must expose an action to run a standalone review
  pass (equivalent to the CLI `loop review`).
- **REQ-WEB-04: Web unblock action.** P0. The web must expose an action to unblock backlog items —
  all blocked items or a specific item (equivalent to the CLI `backlog unblock`).
- **REQ-WEB-05: Web validate action.** P0. The web must expose an action to validate the backlog and
  surface findings (equivalent to the CLI `backlog validate`), including a machine-readable result.
- **REQ-WEB-06: Recovery results are visible.** P0. Each recovery action must report success or
  failure to the user with an actionable message (e.g. "unblocked 3 items", validation findings
  list, the error reason on failure). Absence of feedback is not acceptable (CANON P4 spirit).
- **REQ-WEB-07: Recovery controls reflect applicability.** P1. Recovery controls should reflect
  whether an action is meaningful for the current state (e.g. resume disabled when nothing is
  paused), rather than letting the user trigger no-op or error-only actions blindly.
- **REQ-WEB-08: No business logic in the web layer.** P0 (constraint-as-requirement). The recovery
  endpoints must wrap the existing core/loop implementations of these operations; the web layer adds
  no new recovery business logic. (Where the shared implementation currently lives only in the CLI
  layer — `resume` — or in `packages/loop` — the review pass — relocating/exposing it so web and CLI
  share one implementation is a tech-spec concern; the PRD requires only that web not fork the
  logic.)
- **REQ-WEB-09: Recovery mutations are safe under concurrency.** P1. A recovery action that would
  corrupt or conflict with an actively-running loop must be rejected with an actionable error (not
  silently applied), consistent with the existing loop-lock model (`.loop.lock` / the
  `~/.rauf/active` registry); recovery endpoints inherit core's atomic-write guarantees (rule #2).
  The precise locking mechanism is a tech-spec concern; the requirement is that concurrent recovery
  never silently corrupts loop state and never leaves the user without feedback.

### 3.2 Status Vocabulary — Shared Label Map

- **REQ-VOCAB-01: Single shared label-map module.** P0. One module is the single source of truth for
  mapping a derived loop state to its display label (and badge styling intent), consumed identically
  by the CLI, the projects dashboard, and the status page. The current triplicated mappings are
  replaced by this one source.
- **REQ-VOCAB-02: Total raw-status coverage.** P0. The derived status enum must cover **every** raw
  `state.json.status` value — there is no silent fallback to IDLE for an unmapped raw state (CANON
  §4.3 rule 1).
- **REQ-VOCAB-03: Add REVIEWING.** P0. Add `REVIEWING` (raw `reviewing`) as a distinct derived enum
  value with display label **"Reviewing"** and a badge, instead of collapsing to `RUNNING`.
- **REQ-VOCAB-04: Add PAUSED_USAGE_LIMIT.** P0. Add `PAUSED_USAGE_LIMIT` (raw `paused_usage_limit`)
  as a distinct derived enum value with display label **"Usage Limit (Paused)"** and a badge,
  instead of collapsing to `PAUSED`.
- **REQ-VOCAB-05: Needs-Human label.** P0. `PAUSED_HUMAN` displays as **"Needs Human"** on every
  surface (CLI, dashboard, status page).
- **REQ-VOCAB-06: Human vs machine casing.** P0. Display labels are **Title Case** on human surfaces;
  the SCREAMING_SNAKE form is the machine enum value only (`--json`, API responses). The label map
  governs human labels; it does not change the machine enum spelling.
- **REQ-VOCAB-07: Badges for the full enum.** P0. Every derived enum value has a badge definition on
  the web surfaces (no value renders unstyled / as a silent default). (P0 because CANON §4.3 rule 2
  mandates badges for the new states, and §8's success criteria require the two new states to be
  badged — so badge coverage cannot be a should-have.)

### 3.3 Exit-Code Alignment

- **REQ-EXIT-01: Status exit codes reflect the two new states.** P0. `rauf status` must exit `6`
  (Running) for a `reviewing` loop and `4` (Limit) for a `paused_usage_limit` loop, per CANON §4.4 —
  correcting today's behavior where `paused_usage_limit` silently exits `0` (looks idle). The
  `reviewing` mapping preserves today's observable behavior (raw `reviewing` already derived to
  `RUNNING`→6). The unified v0.5.0 exit table (codes 0–6) is otherwise unchanged. (Code-map note for
  the tech spec: the mapping lives in `statusExitCode`.)

### 3.4 Agent Contract — Documentation Items

- **REQ-AGENT-01: Document the signal spec.** P0. The agent-facing contract/templates must state the
  exact signal tokens (`RAUF_DONE`, `RAUF_BLOCKED:<reason>`, `RAUF_NEEDS_HUMAN:<reason>`,
  `RAUF_REVIEW:<json>`), that the signal goes on a line by itself, that the runner scans from the end
  of output (trailing summaries/commit text don't break detection), and that no signal → classified
  by exit context (never auto-blocked). (CANON §4.5/§4.6.)
- **REQ-AGENT-02: Document the model cascade.** P0. Document the model-override precedence in the
  agent-facing docs: `item.model` > `--model`/options > project default > provider default.
- **REQ-AGENT-03: Ship a progress.md stub.** P1. Provide a `progress.md` session-log format stub so
  agents know what and how to append, rather than learning by reading the file.

## 4. Non-Functional Requirements

### 4.1 Security

- **REQ-SEC-01: Mutation auth.** P0. Every new recovery mutation endpoint must require the
  `X-Rauf-Request: true` header and be served only on `127.0.0.1` — the existing app-level CSRF
  middleware (CLAUDE.md rule #4). No recovery route weakens or bypasses this.
- **REQ-SEC-02: Path sandboxing.** P0. Recovery actions must not write outside `ROOT_DIRECTORY` or
  `~/.rauf/` (rule #3); they inherit core's atomic-write + sandbox guarantees.

### 4.2 Observability

- **REQ-OBS-01: Validation findings are structured.** P1. The web validate action must expose
  findings in a machine-readable form (mirroring the CLI `--json` `{ valid, findings[] }`) in
  addition to a human rendering.

### 4.3 Maintainability / Architecture

- **REQ-ARCH-01: Core has zero imports from cli/web.** P0. The shared label-map module must be
  importable by both the CLI and the web without violating rule #1 — i.e. it must carry no cli/web
  dependencies. Recovery endpoints wrap core/loop, never the reverse. (The concrete module location
  is a tech-spec decision — see OQ-2; `packages/core` is the expected home given rule #1.)
- **REQ-ARCH-02: Status derivation stays file-based.** P0. No recovery or status path may invoke a
  subprocess to derive status (rule #6); derivation continues to read files directly.

### 4.4 Testing

- **REQ-TEST-01: Backend route tests.** P0. Each new recovery endpoint has backend route tests
  (success, failure, missing-CSRF-header rejection), consistent with the existing
  `packages/web/src/server/routes/*.test.ts` suite.
- **REQ-TEST-02: Label-map unit tests.** P0. The shared label-map module (pure, in core) has unit
  tests asserting total raw-status coverage (REQ-VOCAB-02) and the correct label for every derived
  value, including the two new states.
- **REQ-TEST-03: No new frontend test harness.** P1. This phase does not stand up a React component
  test harness; frontend coverage relies on backend route tests + the core label-map unit tests.
  (Recorded so it is a deliberate choice, not an omission.)

## 5. Constraints

- **C-1: Additive, not breaking.** No `minRunnerVersion` bump, no feature-forge lockstep edit, no
  removed/renamed command or flag. A normal minor version bump for the new web features is fine; it
  is not a contract break. (Contrast Phase 2+3 / v0.5.0.)
- **C-2: Architecture rules (CLAUDE.md).** Rule #1 (core zero imports from cli/web), #2 (atomic
  writes), #3 (path sandboxing), #4 (127.0.0.1 + `X-Rauf-Request`), #6 (file-based status, no
  subprocess) all hold.
- **C-3: Dogfood with `rauf-stable` (0.5.0).** `forge.config.json` pins `loopRunner.bin =
  rauf-stable`, re-frozen at 0.5.0 at the v0.5.0 cutover. Implementing loops run with rauf-stable,
  never the dev binary being rewritten (web is lower-risk than the CLI surface, but keep the
  discipline). See `rauf_stable_vs_dev_executable`.
- **C-4: Stack constraint.** Web is Hono on Bun + React (TanStack Router/Query) + Tailwind; core/CLI
  are TypeScript; tests are Vitest. New code matches these (organizational/existing-infra
  constraints, not preferences).
- **C-5: Affected specs must be updated.** Each "done" includes updating the affected `docs/SPEC-*`
  docs: `SPEC-WEB.md`, `SCHEMAS.md`, `SPEC-ARTIFACTS.md`, and any status-vocabulary mentions in
  `SPEC-CLI.md` / `ARCHITECTURE.md`.

## 6. Out of Scope

- **AGENT_ADDON rename + provider-neutral wording.** The `CLAUDE_ADDON.md → AGENT_ADDON.md` rename
  and replacing "Task tool" with provider-neutral language are **deferred to the separate Part-B
  provider refactor** (CANON §4.6/§8 — they couple there; doing them now risks redoing them). Only
  the cheap agent-contract *doc* items (REQ-AGENT-01..03) land here.
- **The Part-B provider architecture itself** (which LLM drives an iteration) — separate initiative
  (CANON §8).
- **Backlog schema redesign** (CANON §8).
- **Eliminating an execution mode** — both in-process and detached runs stay (CANON §8).
- **New monitoring verbs or grammar changes** — the command grammar is fixed as of v0.5.0; this
  phase adds web actions + vocabulary, not new CLI verbs.
- **A React component test harness** (REQ-TEST-03).

## 7. Open Questions

- **OQ-1 (tech spec): Where does shared `resume` / review-pass logic land?** `resume` is currently
  CLI-layer (`packages/cli/src/resume-commands.ts`) and the review pass is in `packages/loop`
  (`review-hooks.ts`). To satisfy REQ-WEB-02/03 + REQ-ARCH-01 without forking logic into web, the
  tech spec must decide: extract `resume` orchestration into core, expose review via `loop-manager`,
  or another split. (HOW — resolved in forge-2-tech.)
- **OQ-2 (tech spec): Badge styling ownership.** The shared label map lives in core (no styling
  deps). How much *visual* styling (colors) belongs in the shared map (as semantic intent) vs. the
  web surfaces (as CSS) — to be settled in the tech spec so the map stays cli/web-import-free.

## 8. Success Criteria

- The web exposes **all five** recovery actions (reset, resume, review, unblock, validate) — backend
  routes (CSRF-gated, 127.0.0.1) + frontend controls — each wrapping existing core/loop logic, each
  reporting its result.
- **One shared label-map module** (in core) drives status display on the CLI **and** both web pages;
  the derived enum covers **every** raw status (no silent IDLE); `REVIEWING` and
  `PAUSED_USAGE_LIMIT` are distinct, badged values; `PAUSED_HUMAN` shows **"Needs Human"** on every
  surface.
- `rauf status` exits `6` for a `reviewing` loop and `4` for a `paused_usage_limit` loop; a
  usage-limited loop no longer exits `0`.
- The cheap agent-contract doc items (signal spec, model cascade, `progress.md` stub) are landed; the
  AGENT_ADDON rename is explicitly deferred to Part-B.
- New recovery routes have backend tests; the shared label map has core unit tests; the full gate
  (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`) is green.
- Affected `docs/SPEC-*` docs are updated.

**Phase completion note (process, not a feature criterion):** merging this branch completes the
4-phase UX/DX overhaul.
