# UX/DX Overhaul — Phase 1: Observation Substrate — Product Requirements Document

> **Scope note.** This PRD covers **Phase 1 (the observation substrate / keystone) only**, as
> defined in [`CANON.md`](./CANON.md) §5. Phases 2–4 (execution-grammar clean break, contract &
> exit-code unification, web recovery actions + vocabulary) are **separate forge features** and are
> explicitly out of scope here (§6). `CANON.md` is the cross-cutting source of truth; where this PRD
> and the canon disagree, the canon wins (or is amended first). Requirement IDs below are referenced
> by the downstream tech spec, implementation specs, and backlog.

---

## 1. Problem Statement

Rauf's loop runner emits a rich live event stream (24 `LoopEvent` types: iteration starts, item
selection, LLM spawn/exit, parsed signals, completions, blocks, pauses, usage limits, reviews, tool
and token activity). **That event stream is the only piece of loop state that is never persisted.**
Status, logs, and progress all derive from files on disk (per architecture rule #6), but the events
live only in memory and are fanned out to the web **solely for server-owned loops** (`loop start`).

This single gap produces a cluster of user-facing failures:

- **Asymmetric observability.** A foreground in-process run (`loop run`) produces a degraded view in
  the web and in any observer that didn't start the loop. The same loop looks different depending on
  *who is watching* — a leaky implementation detail.
- **Fragmented, mode-dependent monitoring.** Four overlapping ways to watch a loop
  (`status --watch`, `log --follow`, `loop follow`, `loop watch`) behave differently by execution
  mode and disagree on flag names (`--watch` vs `--follow`).
- **"Empty status" footguns, all silent.** `rauf status .` can truthfully report "idle" while a loop
  is running on `--backlog specs/x`, because it inspected the *default* root. Missing/early files
  return `[]` indistinguishably from "nothing happening." A different working directory inspects a
  different `.rauf`. The user cannot tell *absence* from *idleness* from *looking in the wrong place*.
- **A self-contradicting agent contract.** The agent templates *and* the installed `RAUF.md`
  template tell the agent to "Commit your changes," contradicting the runner-owns-commit behavior the
  runner actually enforces — causing double-commits. (The installed `RAUF.md` is itself one of the
  loci instructing the agent to commit; it is not a correct reference.)

**Who has this problem:** the operator running rauf loops (human), the **agent that is the loop's
primary machine consumer** (e.g. feature-forge and any tool reading status/events), and anyone
observing a loop through the web.

**Why now:** rauf has zero external users on old behavior, the foundation is solid, and the fix is
*additive* — it persists what is already produced. Doing it first (before the breaking grammar/
contract phases) proves the approach on low-stakes work.

The keystone: **persist every event to an append-only log on disk, and make every observer — CLI,
web, and external agent — reconstruct loop activity from files.** This collapses the
in-process/server asymmetry by construction.

---

## 2. User Stories

### Primary actor — Operator (human running rauf loops)

- As an operator, I want `status`, `log`, and the live `follow` view to show the **same live data
  for a foreground `loop run` as for a detached run**, so that how I started the loop never changes
  what I can see.
- As an operator, I want **one** canonical way to watch a loop live, with **one** flag name for
  "follow," so I don't have to remember which of four commands behaves how.
- As an operator, when I run `status` on a root with nothing happening, I want it to tell me
  **which directory it inspected** and **whether a loop is live in a different backlog root**, so I
  never again stare at "idle" while a loop runs elsewhere.
- As an operator, I want to attach the live view to a loop I started in another terminal (or that a
  pipeline started) and **see its history replayed plus new events**, without owning the process.

### Primary actor — Agent (the loop's machine consumer, e.g. feature-forge)

- As an agent, I want a **single always-valid read** (`state.json`) that answers "what state is the
  loop in right now," so I never have to replay a log or risk a torn read to get current status.
- As an agent, I want a **persisted, ordered, self-describing, versioned event log** I can tail to
  reconstruct exactly what happened and observe live progression — for **any** loop, regardless of
  how it was started.
- As an agent, I want the event log and the status file to **never contradict each other**, so I can
  trust a combined read.

### Secondary actor — Web observer

- As a web user, I want the status page and live stream to reflect **in-process runs too**, not just
  server-owned ones, so the web is a faithful window onto every loop in the project.

### Secondary actor — Agent author (writing the iteration prompt the loop runs)

- As an iteration agent, I want **one unambiguous rule about committing** (I never commit; the runner
  does), stated identically everywhere I might read it, so I don't cause double-commits.

---

## 3. Functional Requirements

### 3.1 Event Persistence — the keystone

- **REQ-EVT-01:** A running loop MUST persist every `LoopEvent` it emits to an append-only event log
  on disk, located in the backlog root's resolved state directory. The canonical artifact name is
  **`events.ndjson`** (one JSON object per line), alongside the existing `state.json`, `rauf.log`,
  and `iteration-status.json`.
  - Priority: P0
- **REQ-EVT-02:** All event types currently emitted MUST be representable in the log. High-frequency
  telemetry (`llm_token_update`) MUST be **coalesced to a bounded rate (≈ ≤ 1/sec)** before
  persistence; `llm_tool_activity` and all structural/state events are persisted as they occur.
  - Priority: P0
  - Notes: Coalescing bounds file size without losing liveness signal. Exact cadence is a tech-spec
    call; the requirement is "bounded, not per-tick."
- **REQ-EVT-03:** Each persisted record MUST be **self-describing**: it carries at minimum its event
  `type`, a timestamp, and a **monotonic per-run sequence number (`seq`)** that lets a reader order
  events and detect gaps.
  - Priority: P0
- **REQ-EVT-04:** The event log MUST carry a **schema/version identifier** from first release (an
  envelope or per-record `schemaVersion`), so the machine surface is forward-stable even though the
  *formal* versioning discipline lands in a later phase.
  - Priority: P0
  - Notes: Shipping the envelope now costs nothing and avoids a future breaking change to the agent
    contract. (See [`CANON.md`](./CANON.md) §4.5 — formal versioning is Phase 3.)
- **REQ-EVT-05:** The event log **resets per loop run**: it is truncated/rotated at the start of each
  run so it holds only the **current run's** events. The prior run's log MUST be preserved in the
  existing archive mechanism (alongside archived iteration state), not discarded.
  - Priority: P0
- **REQ-EVT-06:** Event records MUST be appended as **whole lines** (one write per event). There is a
  **single writer** (the loop runner) per backlog root.
  - Priority: P0
  - Notes: Single-writer applies **per-root to `events.ndjson`**. The active-loop registry
    (REQ-DISC-03/04) is a distinct, intentionally **multi-writer** surface; its concurrency-safety
    mechanism is a tech-spec decision (OQ-1) and is **not** governed by this single-writer invariant.
- **REQ-EVT-07:** The event log MUST be written **only inside the backlog root's state directory**,
  within the established path sandbox (never outside `ROOT_DIRECTORY` or `~/.rauf/`).
  - Priority: P0

### 3.2 Unified File-Based Observation

- **REQ-OBS-01:** `status`, `log`, and the live `follow` view MUST reconstruct their output **entirely
  from files** (`state.json` + `events.ndjson` + `iteration-status.json` + `rauf.log`). No
  observation path may depend on owning the runner or on the loop having been started by a server.
  - Priority: P0
- **REQ-OBS-02:** `state.json` remains the **single authoritative source for current status**. The
  event log is the authoritative **stream/history**. The two MUST satisfy the invariant: **every
  `state.json` status transition has a corresponding event line, and the event log never contradicts
  `state.json`.**
  - Priority: P0
- **REQ-OBS-03:** An in-process (`loop run`) and a detached run MUST become **observationally
  identical** across every observer (CLI and web): the same status, the same event history, the same
  live progression.
  - Priority: P0
  - Notes: This is the headline outcome of Phase 1. See Success Criteria (§8).
- **REQ-OBS-04:** Attaching the live view to an already-running loop MUST **replay the current run's
  event history then tail new events**, so a late observer sees full context, not just events emitted
  after it attached.
  - Priority: P1

### 3.3 Monitoring Command Surface — clean break, no aliases

- **REQ-MON-01:** The canonical monitoring surface MUST be: `status [--follow] [--json]`,
  `log [--tail N] [--follow] [--json]`, a **top-level `follow`** verb (the rich live view), and the
  unchanged `progress`. All read the unified file model (REQ-OBS-01).
  - Priority: P0
- **REQ-MON-02:** The superseded monitoring commands and flags MUST be **removed outright, with no
  deprecation aliases**: `loop watch` (removed), `loop follow` (removed → promoted to top-level
  `follow`), and `--watch` (removed → replaced by `--follow`/`-f`).
  - Priority: P0
  - Notes: Consistent with the ratified clean-break posture ([`CANON.md`](./CANON.md) §1, P3). The
    user has accepted the absence of the old names during transition.
- **REQ-MON-03:** `--json` MUST be honored on **every** read/monitor command, including under
  `--follow` (where it emits NDJSON snapshots/events). The `--follow` concept uses **one** flag name
  everywhere; `--interval <seconds>` retains its meaning under `--follow`.
  - Priority: P0
- **REQ-MON-04:** `--backlog <dir>` remains the **single** way to target a non-default backlog root on
  every command that touches state. No monitoring command introduces a second spelling.
  - Priority: P0

> **Boundary:** This phase changes only the **monitoring** verbs. The **execution** grammar
> (`loop run --detached` replacing `loop start`, etc.) is **Phase 2** and is out of scope here (§6).

### 3.4 Empty-Is-Never-Silent & Cross-Root Discovery

- **REQ-DISC-01:** Any read command (`status`, `log`, `follow`, `progress`) that resolves to "nothing
  here" MUST state **which directory it inspected**, so absence (no/early files) and idleness (a real
  idle loop) and wrong-location are distinguishable.
  - Priority: P0
- **REQ-DISC-02:** When a read resolves to idle/empty on the queried root, it MUST surface **any loop
  that is currently live in a different backlog root** within the user's scope, naming the root and
  its state — directly fixing the "`status .` says idle while a loop runs on `--backlog specs/x`"
  footgun.
  - Priority: P0
- **REQ-DISC-03:** Cross-root liveness MUST be answered via a **central active-loop registry**: a
  record of currently-running loops (keyed by resolved state directory) that is written when a loop
  starts and cleared when it exits, queryable in roughly **O(1) independent of current working
  directory or tree depth**.
  - Priority: P0
  - Notes: Chosen over a per-read directory walk for long-term robustness. Registry storage lives
    within the sandbox (under `~/.rauf/`). Storage shape is a tech-spec call.
- **REQ-DISC-04:** The registry MUST be **concurrency-safe** for multiple loops registering/
  deregistering and multiple readers querying simultaneously, without corruption.
  - Priority: P0
- **REQ-DISC-05:** The registry MUST **self-heal stale entries**: a loop that crashed without
  deregistering MUST NOT be reported as "live." Liveness MUST be reconciled against ground truth
  (the per-root lock / process liveness) before being surfaced.
  - Priority: P0
- **REQ-DISC-06:** There MUST be a way to **list every backlog root with a live loop across the user's
  scope** (e.g. `status --all`, or an equivalent surface reading the same registry).
  - Priority: P1
  - Notes: Whether this is a dedicated `--all` flag or a separate verb is a tech-spec decision; the
    discoverability is the requirement.

### 3.5 Web Observation Parity (read-path only)

- **REQ-WEB-01:** The web status and live-stream views MUST reconstruct from the same files as the CLI
  (REQ-OBS-01), so they correctly display **in-process `loop run`s the server did not start**.
  - Priority: P0
- **REQ-WEB-02:** The server's in-memory event buffer / live push MAY remain as a **latency
  optimization** over the file, but MUST NOT be the *sole* source of truth; it may serve events for
  any project by reading that project's event log.
  - Priority: P1
- **REQ-WEB-03:** The web MUST surface the cross-root liveness from the registry (REQ-DISC) so the
  projects view reflects every live loop, not only server-owned ones.
  - Priority: P1

> **Boundary:** Web **recovery actions** (reset/resume/review/unblock/validate buttons) and the shared
> status-vocabulary/label map + missing badges are **Phase 4**, out of scope here (§6). Phase 1 only
> makes the web *observe* correctly.

### 3.6 Agent Commit-Rule — single source

- **REQ-COMMIT-01:** The agent contract MUST state **one** commit rule, identically everywhere it
  appears: **the iteration agent never commits or stages; the loop runner owns the commit.**
  - Priority: P0
- **REQ-COMMIT-02:** The agent-side commit instructions MUST be reconciled to the canonical rule
  (REQ-COMMIT-01) in **all** loci. Two distinct actions are required:
  - (a) **Remove/replace** the "Commit your changes" instruction in the **three templates** that
    currently carry it: `artifacts/variants/backlog-json/CLAUDE_ADDON.md`,
    `…/CLAUDE_GREENFIELD.md.tmpl`, and `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl` (the
    installed `RAUF.md`, which currently instructs the agent to commit — it is **not** already
    correct).
  - (b) **Add** an explicit no-commit reminder to the runner's prompt-builder
    (`packages/loop/src/prompt-builder.ts`), which currently states **no** commit rule at all — there
    is nothing to "correct" there; the reminder must be added.
  - Priority: P0
- **REQ-COMMIT-03:** The provider-agnostic rename (`CLAUDE_ADDON.md → AGENT_ADDON.md`) and
  provider-neutral wording are **explicitly NOT in scope** for this phase (they couple to the Part-B
  provider refactor). Only the commit-rule wording is corrected now.
  - Priority: P0 (scope guard)

---

## 4. Non-Functional Requirements

### 4.1 Performance & Liveness

- **REQ-PERF-01:** Persisting events MUST NOT meaningfully slow the loop. Appends are best-effort
  (no per-event `fsync`); high-frequency telemetry is coalesced (REQ-EVT-02).
  - Priority: P0
- **REQ-PERF-02:** Live observers (`follow`, `log --follow`, web) SHOULD reflect a new on-disk event
  within roughly **1 second** under normal localhost conditions ("feels live"). This is a qualitative
  target, **not** a hard millisecond SLA.
  - Priority: P1
  - Notes: **Non-binding tech-spec hint** (not a mandate): prefer push/tail (`fs.watch`, already used
    for `rauf.log`) over fixed polling; fall back to a bounded `--interval` poll when watching is
    unavailable.

### 4.2 Reliability & Durability

- **REQ-REL-01:** Readers MUST tolerate a **torn/partial trailing line** in the event log (e.g. a read
  mid-append, or a crash mid-write): such a line is skipped/treated as not-yet-complete, never causing
  a crash or corrupting earlier records.
  - Priority: P0
- **REQ-REL-02:** Because `state.json` (atomically written) holds authoritative status, **loss of the
  event log's tail after a hard crash MUST NOT lose current status.** Recovering status never requires
  replaying the event log.
  - Priority: P0
- **REQ-REL-03:** Loss or absence of the event log MUST degrade gracefully: observers fall back to
  `state.json` + `rauf.log` and still report correct current status.
  - Priority: P0

### 4.3 Security & Sandboxing

- **REQ-SEC-01:** The event log and the active-loop registry MUST be written only within the
  established sandbox (the backlog root's state dir, or `~/.rauf/`), validated with
  `path.resolve()` + `startsWith()` per architecture rule #3. No writes outside `ROOT_DIRECTORY` or
  `~/.rauf/`.
  - Priority: P0
- **REQ-SEC-02:** Web exposure of event data MUST respect the existing posture: server bound to
  127.0.0.1 only; mutation endpoints continue to require the `X-Rauf-Request` header. (Phase 1 adds
  read-path parity, no new mutation endpoints.)
  - Priority: P0

### 4.4 Compatibility & Migration

- **REQ-COMPAT-01:** The change is **additive** to on-disk state: an existing rauf-installed project
  with no `events.ndjson` MUST work unchanged — the file is created on the next run, and observers
  handle its prior absence (REQ-REL-03).
  - Priority: P0
- **REQ-COMPAT-02:** No migration of historical state is required. Previously archived runs that have
  no event log are acceptable; only runs from this version forward produce one.
  - Priority: P0
- **REQ-COMPAT-03:** `packages/core` MUST retain zero imports from `cli` or `web`; all new
  file/registry logic lives in core (architecture rule #1).
  - Priority: P0

### 4.5 Observability of the substrate itself

- **REQ-OBSV-01:** The event log **is** the observability substrate; no parallel logging mechanism is
  introduced. Registry reconciliation outcomes (e.g. a stale entry pruned) SHOULD be discoverable to
  the user when relevant (e.g. surfaced in `status --all`), not hidden.
  - Priority: P2

---

## 5. Constraints

These are mandated by existing infrastructure / ratified canon, not preferences:

- **C-1:** Canonical artifact and vocabulary names are fixed by [`CANON.md`](./CANON.md):
  `events.ndjson` (event log), `state.json` (authoritative status), the monitoring surface in §4.1,
  and the status enum in §4.3. Phase 1 conforms; it does not re-decide them.
- **C-2:** Architecture rules (project `CLAUDE.md`) are binding: core has zero cli/web imports (rule
  #1); atomic writes with `.bak` for `backlog.json` (rule #2); path sandboxing (rule #3); server binds
  127.0.0.1 + `X-Rauf-Request` on mutations (rule #4); per-project artifacts self-contained (rule #5);
  status derivation reads files, never subprocesses (rule #6).
- **C-3:** Multi-backlog already exists: each backlog root has an isolated state directory and a lock
  file. The active-loop registry MUST build on this model (the lock is the ground truth for
  reconciliation), not replace it.
- **C-4:** Clean break, no aliases (ratified). Removed command/flag names are not shimmed.
- **C-5:** Self-hosting safety: implementing loops run with the frozen `rauf-stable` binary
  (`forge.config.json` already sets `loopRunner.bin: "rauf-stable"`) while the dev `rauf` is the
  thing being changed. Never run a loop with the binary that loop is rewriting.

---

## 6. Out of Scope (this phase)

Deferred to later forge features, per [`CANON.md`](./CANON.md) §5:

- **Execution grammar / clean break of execution verbs** — `loop run --detached` replacing
  `loop start`, `loop stop` semantics. (Phase 2.)
- **Unified exit-code table** and any change feature-forge reads as a contract. (Phase 3.)
- **Formal `events.ndjson` versioning discipline** and the `signal_parsed` `review`→`done` fix.
  (Phase 3. Note: the *version envelope* ships now per REQ-EVT-04; the *discipline/policy* is
  Phase 3.)
- **Signal-placement / "final line" doc reconciliation** — aligning the agent-contract wording
  ("output your exit signal" / "output `RAUF_DONE` as your final line") with the parser's actual
  backward-scan behavior. Grouped with the agent contract in [`CANON.md`](./CANON.md) §4.5/§4.6;
  **deferred to Phase 3.** Note: Phase 1's commit-rule fix (REQ-COMMIT-02) edits the same templates,
  but corrects **only** the commit wording — the signal-placement wording is intentionally left for
  Phase 3.
- **Web recovery actions** (reset/resume/review/unblock/validate in the web). (Phase 4.)
- **Status-vocabulary shared label map + missing badges** (`REVIEWING`, `PAUSED_USAGE_LIMIT`,
  "Needs Human" rendering). (Phase 4.)
- **Agent-addon rename** (`CLAUDE_ADDON.md → AGENT_ADDON.md`) and provider-neutral language. (Couples
  to Part-B provider refactor.)
- **Backlog schema redesign.** Out of scope for the whole overhaul.
- **Eliminating an execution mode.** Both in-process and server-owned runs stay; Phase 1 makes them
  observationally identical, it does not remove either.

---

## 7. Open Questions

Resolve in the tech spec (not blocking the PRD):

- **OQ-1:** Active-loop registry storage shape — single atomically-updated index vs. per-loop entry
  files under `~/.rauf/active/` — and the exact reconciliation trigger (on read? periodic?).
- **OQ-2:** Token-update coalescing cadence (REQ-EVT-02): fixed interval (≈1/sec) vs. value-change
  threshold vs. last-write-wins per flush.
- **OQ-3:** "User's scope" for cross-root discovery (REQ-DISC-02/06): all roots under the current
  project? all roots in the registry (machine-wide)? Default and any scoping flag.
- **OQ-4:** Archive naming/layout for the per-run rotated event log (REQ-EVT-05) — how it slots into
  the existing `archive/` mechanism.
- **OQ-5:** Exact surface for cross-root listing (REQ-DISC-06): `status --all` flag vs. a `projects`
  verb (the canon mentions both as candidates).
- **OQ-6:** Whether `follow`'s history replay (REQ-OBS-04) reads only the current run's
  `events.ndjson` or also stitches the prior archived log when attaching just after a reset.

---

## 8. Success Criteria

Phase 1 is done when:

- **SC-1 (headline):** With **no server running**, a foreground `rauf loop run` produces live data in
  `rauf status`, `rauf follow`, and the **web status page** that is **identical in kind** to what a
  detached/server-owned run produces. The in-process/server observability asymmetry is gone.
  *(Verifies REQ-OBS-03, REQ-WEB-01.)*
- **SC-2:** Running `status`/`log`/`follow` on an idle or non-existent root **never silently shows
  "idle"**: it names the inspected directory, and if a loop is live in another root, it says so with
  the root and its state. *(Verifies REQ-DISC-01/02.)*
- **SC-3:** A loop killed mid-run (crash) leaves the registry reporting it as **not live** on the next
  read, and `state.json` still reports correct status; a torn final line in `events.ndjson` does not
  crash any reader. *(Verifies REQ-DISC-05, REQ-REL-01/02.)*
- **SC-4:** Exactly **one** canonical live-view command (`follow`) and **one** follow flag
  (`--follow`) exist; `loop watch`, `loop follow`, and `--watch` are gone; `--json` works on every
  read command including `status --follow`. *(Verifies REQ-MON-01/02/03.)*
- **SC-5:** The canonical rule — **"the iteration agent never commits or stages; the loop runner owns
  the commit"** — reads identically across all four loci being fixed (the installed `RAUF.md`
  template, both artifact templates, and the prompt-builder reminder), and a dogfood loop run produces
  **exactly one** commit per item with no agent-side commit. *(Verifies REQ-COMMIT-01/02.)*
- **SC-6:** An agent can, from any working directory, read `state.json` for current status and tail
  `events.ndjson` (ordered by `seq`, schema-versioned) for history/liveness, with the two never
  contradicting each other. *(Verifies REQ-OBS-02, REQ-EVT-03/04.)*
- **SC-7:** `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass; existing projects with no
  `events.ndjson` continue to work unchanged. *(Verifies REQ-COMPAT-01/03.)*
