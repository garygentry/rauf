# Loop Observability — Product Requirements Document

> **Source of truth:** This PRD ratifies the requirements captured in
> [`CANON.md`](./CANON.md) (Loop Observability — Canon & North Star). Where CANON
> marked items `[REC]` (open decisions D1–D6), this PRD records the **ratified**
> outcome. If CANON and this PRD ever diverge, amend both — CANON stays the
> narrative north star, this PRD is the requirements contract downstream stages
> (forge-2-tech → forge-3-specs → forge-4-backlog → forge-5-loop) build against.

---

## 1. Problem Statement

rauf's loop-monitoring surface (`status` / `follow` / `log`) was rationalized
once, in the v0.6.0 UX/DX Overhaul, which made the **data model** sound: a
persisted event log, unified verbs, and two frozen machine surfaces. What that
work did **not** address is the **consumer experience** built on top of that
data. Two distinct consumers are underserved today:

- **The agent that drives the loop** — rauf's first-class consumer — has a solid
  but *under-prescribed* contract. The skills document *which* commands exist,
  but never prescribe *the supervision pattern* to run them in (no interval, no
  decision tree, no canonical "how you detect done"). Two different skills even
  prescribe two *different* supervision models (`drive-rauf-loop` says poll;
  feature-forge's `forge-5-loop` says push/`Monitor`), and the exact event-filter
  rules live **outside** the rauf repo that owns the contract. Worse, the one
  decision an agent must make — **done / needs-human / recoverable-stall /
  healthy** — *cannot be made from a single `status --json` poll*: the stall
  signal (`stuckWarning`) lives in a separate file (`.rauf/iteration-status.json`),
  forcing the agent to read raw files the skill otherwise tells it not to touch.

- **The human who monitors loops in parallel** — often watching a loop some
  *other* agent is driving, across sessions and across many backlogs — has no
  view pitched at the altitude they care about: "which item is it on, progress
  against the whole backlog, any warnings."

This is **not a data-model change**. It is a **prescription + rendering** change
on an already-sound substrate, plus **one enabling completeness fix** to the
machine status contract so that a single poll answers every decision an agent
must make.

**Why now:** the data model is stable and battle-tested; the cost of the current
gaps is paid on every autonomous loop run (agents inventing ad-hoc control loops,
reading files they shouldn't, and splitting the contract across two repos) and on
every human trying to supervise work in flight.

---

## 2. User Stories

**Primary actor — the driving agent (machine consumer):**

- As an agent driving a loop, I want a **single machine surface** (`status --json`)
  that tells me whether the loop is done, needs a human, is recoverably stalled,
  or is healthy, so that I can decide my next action from **one poll** without
  reading any raw state file.
- As an agent, I want a **prescribed supervision recipe** (start backgrounded →
  poll on an interval → branch on a decision tree → apply a recovery playbook),
  so that I don't have to invent my own control loop or guess an interval.
- As an agent, I want the loop target I address to be **unambiguous** in machine
  contexts, so that I never silently act on the wrong backlog.

**Primary actor — the supervising human (TTY consumer):**

- As a human monitoring a loop another agent is driving, I want an **item-level
  narration feed** ("started auth-007 → done → picked auth-008", with a sticky
  "4/12 done · 1 blocked" header), so that I can follow the work at the altitude I
  care about without drowning in token/tool events.
- As a human running many loops, I want a **machine-wide front door** ("show me
  every live loop this machine is running"), so that I can supervise across
  sessions and agents from one place.
- As a human at a terminal, I want the tool to be **convenient by default**
  (default to the loop in my cwd; if there are several, let me pick), so I rarely
  have to type an explicit path.

**Secondary actor — the skill/pipeline author (feature-forge):**

- As the author of `forge-5-loop`, I want the **decision semantics** to live in
  one place (rauf's `drive-rauf-loop`), so that feature-forge references the
  contract rather than re-deciding it in its own repo.

---

## 3. Functional Requirements

### 3.1 The single agent decision surface — `status --json`

- **REQ-CONTRACT-01** — `status --json` MUST be a **complete superset** of
  everything an agent would otherwise scrape from `state.json`,
  `iteration-status.json`, or `events.ndjson` to decide its next action. A
  prescriptive skill MUST be able to say "poll `status --json`, branch, never
  touch the raw files" and never be forced to fall back to a file.
  - Priority: **P0**
  - Notes: This is the keystone requirement. If an agent ever needs a raw file to
    decide, the contract has a hole (see REQ-SUCCESS-01).

- **REQ-CONTRACT-02** — A single `status --json` poll MUST answer all four agent
  decisions:
  - **Done** — from `loopState ∈ {COMPLETE, IDLE}` + `backlogSummary` (nothing
    pending/in-progress).
  - **Needs human** — from `loopState = PAUSED_HUMAN` / `lastSignal = needs_human`
    + `backlogSummary.needsHuman`.
  - **Recoverable stall** — from a **health/stall hint** folded into the status
    object (see REQ-CONTRACT-03).
  - **Healthy in-progress** — from `loopState ∈ {RUNNING, REVIEWING}` with no
    stall hint.
  - Priority: **P0**

- **REQ-CONTRACT-03** — The stall/health signal that today lives **only** in
  `.rauf/iteration-status.json` MUST be surfaced directly in the `DerivedStatus`
  object returned by `status --json`, as a **nested `health` block** carrying at
  least a mirror of `stuckWarning` and a derived `iterationFresh` freshness hint
  (so the agent need not diff `updatedAt` itself). *(Ratifies D4 — nested block;
  exact field names/booleans-vs-enum are finalized in forge-2-tech.)*
  - Priority: **P0** — this is the enabling change; everything else is
    prescription or rendering on top of it.

- **REQ-CONTRACT-04** — The health hint is a **decision aid, not a verdict**. It
  means "an iteration appears to have stopped making progress," matching the
  existing framing of `stuckWarning` as *a hang warning, not a failure*. The agent
  still decides whether to escalate (e.g. `--force` on the next run) only if the
  stall persists.
  - Priority: **P0**

- **REQ-CONTRACT-05** — The status contract change MUST be **additive only**: no
  existing field renamed or removed, preserving the additive promise the machine
  surfaces already make (respecting the versioned-stream contract from v0.6.0).
  - Priority: **P0**

- **REQ-CONTRACT-06** — The `backlogSummary` disjointness already true today MUST
  be preserved: `blocked` is the **total**; `needsHuman` and `deferred` (runner
  false-block) are **disjoint, separately actionable subsets**.
  - Priority: **P0**

### 3.2 The canonical agent supervision pattern (prescription)

- **REQ-PRESCRIBE-01** — There MUST be exactly **one** prescribed agent
  supervision pattern: **poll**, not stream. `drive-rauf-loop` becomes the single
  source of truth, rewritten from a reference card into an explicit automation
  recipe. *(Retires CANON Gap 2's fork.)*
  - Priority: **P0**

- **REQ-PRESCRIBE-02** — The recipe MUST prescribe: (1) **start** the loop
  backgrounded so it survives and doesn't block the session; (2) **supervise by
  polling** the single decision surface on an interval; (3) **branch** on
  `loopState` + `health` per the decision tree; (4) apply a **recovery playbook**
  (resume / reset / `--force`) autonomously for recoverable stalls.
  - Priority: **P0**

- **REQ-PRESCRIBE-03** — The prescribed **poll interval** MUST be a documented,
  overridable default in the range **5–10s** (balancing detection latency against
  the cost of repeated `deriveStatus` reads). It is a prescription, not a hard
  constant. *(Ratifies D3.)*
  - Priority: **P1**

- **REQ-PRESCRIBE-04** — The decision tree MUST branch to: **done** → report &
  stop; **needs-human** → surface to the user (the **only** true stop);
  **recoverable-stall** → apply the recovery playbook autonomously;
  **healthy** → keep polling.
  - Priority: **P0**

- **REQ-PRESCRIBE-05** — The event stream (`--ndjson` / `events.ndjson`) and the
  `Monitor`-tool push model MUST remain **available** as a lower-latency
  optimization where a harness offers it, but **agent decisions MUST NEVER depend
  on the stream** — the stream is for narration and diagnosis, not control.
  - Priority: **P0**

- **REQ-PRESCRIBE-06** — feature-forge's `forge-5-loop` MUST **defer** its
  **decision semantics** to rauf's `drive-rauf-loop` rather than carrying its own
  divergent event-filter rules. `forge-5-loop` MAY keep the push/`Monitor` model
  as a latency optimization, but the done/needs-human/stall/healthy decision rules
  reference rauf's contract, in the rauf repo. *(Ratifies D6.)*
  - Priority: **P1**
  - Notes: The rauf-side deliverable is that `drive-rauf-loop` **is** the
    authoritative, referenceable contract. The corresponding edit to
    feature-forge's `forge-5-loop`/`runner-contract.md` lives in that repo and is
    tracked as a coordinated follow-up (see Open Questions Q3).

### 3.3 Command grammar — altitude × scope

- **REQ-CMD-01** — `status` remains the **glance** altitude: point-in-time by
  default; `--follow` for a live glance (TTY: re-rendered snapshot; JSON: one
  object per change). It is the agent's canonical surface via `--json`.
  - Priority: **P0**

- **REQ-CMD-02** — `follow`'s **default** MUST become the **item-level narration
  feed** (the human middle tier): a scrolling feed of item/loop milestones
  (`item_selected`, `item_completed`, `item_blocked`, `item_retried`,
  `needs_human`, review-created-N) with a **sticky progress header**
  (e.g. `4/12 done · 1 blocked · on auth-007`). The tool/LLM/token **firehose**
  MUST move **behind `follow --verbose`**. No fourth verb is added.
  *(Ratifies D1.)*
  - Priority: **P1**
  - Notes: This item-level filtering is a **property of the human (TTY) renderer
    only** — see REQ-CMD-05.

- **REQ-CMD-03** — `follow --json` MUST emit the **complete** event stream (every
  event) for agents/diagnostics that want it; the altitude filter (item-level vs.
  firehose) MUST NEVER touch the JSON output.
  - Priority: **P0**

- **REQ-CMD-04** — `log` remains the raw human `rauf.log` tail, unchanged in role
  (`--follow` live tail supported as today).
  - Priority: **P2**

- **REQ-CMD-05** — The item-feed and the machine-wide dashboard MUST render
  **entirely from the same `events.ndjson` / `DerivedStatus` data** the agent
  uses — **no new data model**. They MUST reuse the existing renderer/scan
  machinery rather than introducing parallel sources.
  - Priority: **P1**

### 3.4 Scope & resolution ergonomics

- **REQ-SCOPE-01** — Under `--json` **OR** a non-TTY stdout, a **missing or
  ambiguous** target MUST be a **hard error** — never an implicit scan that could
  pick the wrong root. The agent passes an explicit `<root>` + `--backlog <dir>`.
  *(Ratifies D5 — non-TTY alone, not only explicit `--json`, triggers strictness.)*
  - Priority: **P0**

- **REQ-SCOPE-02** — On a **TTY**, resolution MUST be convenient: default the root
  to **cwd**; if exactly one active root is found, use it; if several, **list them
  and let the user pick** rather than silently defaulting to `.rauf` and hiding a
  running loop.
  - Priority: **P1**

- **REQ-SCOPE-03** — Bare `status` (no args) on a TTY MUST default to the **cwd**
  loop, broadening to the machine-wide `--all` view **only when there is no local
  live loop**. *(Ratifies D2.)*
  - Priority: **P1**

- **REQ-SCOPE-04** — A **machine-wide human front door** MUST exist: an ergonomic
  enumeration of every live loop on the machine (via `--all`, backed by the active
  registry). `--all --json` is **human/tooling scope**, explicitly **NOT** part of
  the single-loop agent contract.
  - Priority: **P1**

- **REQ-SCOPE-05** — Scope forms up the axis MUST be supported consistently:
  default backlog (`.rauf/`) → named backlog (`--backlog <dir>`) → all backlogs in
  a repo → all live loops on the machine (`--all`).
  - Priority: **P1**

### 3.5 Skill reconciliation (the prescription half)

- **REQ-SKILL-01** — `drive-rauf-loop` MUST be rewritten from an operator's
  reference card into an explicit automation recipe covering the poll loop, the
  interval, the four-way decision tree, and the recovery playbook. It **owns the
  contract, in the rauf repo**.
  - Priority: **P0**

- **REQ-SKILL-02** — `author-backlog` is unaffected in scope; it is used only as
  the vehicle to build this feature's own backlog.
  - Priority: **P2**

---

## 4. Non-Functional Requirements

### 4.1 Performance

- **REQ-PERF-01** — A single `status --json` poll MUST remain a **direct
  file-read derivation** (no subprocess) cheap enough to poll at the prescribed
  5–10s interval without meaningful overhead. The added `health` block MUST NOT
  introduce new expensive I/O beyond reading the already-written
  `iteration-status.json`.
  - Priority: **P0**

### 4.2 Security / Safety

- **REQ-SAFE-01** — Path sandboxing is unchanged: no reads/writes outside
  `ROOT_DIRECTORY` or `~/.rauf/`; targets validated via `path.resolve()` +
  containment check (project rule #3).
  - Priority: **P0**

- **REQ-SAFE-02** — The strict machine-context resolution (REQ-SCOPE-01) is itself
  a safety property: it prevents a script from silently acting on the wrong
  backlog.
  - Priority: **P0**

### 4.3 Observability / Compatibility

- **REQ-COMPAT-01** — The machine surfaces (`--json`, `--ndjson`) MUST remain
  **backward compatible and additive**. No human-rendering work anywhere
  downstream may alter what a machine surface emits (the **prime directive**:
  agent contract is substrate, human UX is a pure rendering layer on top).
  - Priority: **P0**

- **REQ-COMPAT-02** — The `status --json` change MUST be **versioned** consistent
  with the existing machine-surface versioning, so consumers can detect the new
  `health` field's availability.
  - Priority: **P1**

### 4.4 Accessibility

- **REQ-A11Y-01** — TTY narration (item feed, sticky header, `--all` dashboard)
  MUST degrade gracefully on a non-color / narrow / non-interactive terminal and
  MUST NOT rely on color alone to convey state (blocked / needs-human /
  healthy).
  - Priority: **P2**

### 4.5 Quality gate

- **REQ-GATE-01** — Every phase (see §6) MUST be independently shippable and green
  under `pnpm gate` (the project's single source of truth for CI-green).
  - Priority: **P0**

---

## 5. Constraints

These are existing infrastructure/organizational mandates the feature must
respect (not preferences):

- **C-01** — `packages/core` has **zero** imports from `cli` or `web`; all
  filesystem/derivation logic lives in core (project rule #1). The `health` block
  is derived in core's `deriveStatus`.
- **C-02** — Status derivation reads files directly and **never** invokes
  subprocesses (project rule #6).
- **C-03** — The v0.6.0 UX/DX Overhaul verb/vocabulary set is **fixed**; this
  feature refines observability altitude and prescription, changing only the
  `follow` default (D1) within that grammar.
- **C-04** — The stall signal source of truth remains `iteration-status.json` /
  the `llm_stuck_warning` event; the `health` block is a **surfacing** of that
  already-computed value, not a new source of truth.
- **C-05** — `drive-rauf-loop` and `rauf-loop-driver` live in the rauf repo and
  are the canonical home of the agent contract; feature-forge references, does not
  duplicate, them.
- **C-06** — The single-explicit-backlog-per-agent use case is confirmed, which
  makes explicit `<root>` + `--backlog` addressing cheap and unambiguous for
  agents.

---

## 6. Sequencing (informative — full rationale in CANON §6)

Ordering is a requirement because the contract must be **complete** before it can
be **prescribed**, and the human layer must come last so it cannot gate the agent
work:

1. **Phase 1 — Complete the contract (enabling):** fold the stall/health hint into
   `DerivedStatus` / `status --json` (REQ-CONTRACT-03). Additive, versioned,
   tested.
2. **Phase 2 — Make it consistent (prescription):** rewrite `drive-rauf-loop` into
   the canonical poll recipe; make `forge-5-loop` defer to it; resolve the
   `--json`/non-TTY strictness rule (§3.2, §3.4).
3. **Phase 3 — Make it humane (rendering):** item-level `follow` default + sticky
   header; the `follow` naming/altitude change; ergonomic backlog enumeration +
   cwd-default + `--all` front door (§3.3, §3.4). All TTY-render-only.
4. **Phase 4 — Parity & docs:** web observation parity for any new human view
   (**P2 / stretch** — see §7 Q2); update `docs/SPEC-CLI.md`,
   `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`, and the ux-overhaul canon cross-reference.

---

## 7. Out of Scope

Explicitly **NOT** part of this feature (ratified §5 non-goals):

- **No new persisted state or event types** beyond surfacing the already-computed
  `stuckWarning`. The `health` block mirrors an existing value — a surfacing, not
  a new source of truth.
- **No command-grammar / verb-set redesign.** The v0.6.0 overhaul stands; only the
  `follow` default (D1) changes.
- **No cross-loop *control* for agents.** `--all` is observation / human scope
  only; an agent still drives exactly one backlog.
- **No status via subprocess.** Derivation keeps reading files directly.
- **No change to how the loop runner commits, selects items, or manages state.**
- **Web observation parity is P2 / stretch** — the CLI is the deliverable; web
  parity is deferrable to a follow-up (see Open Questions Q2).

---

## 8. Open Questions

- **Q1** — Exact field names and booleans-vs-enum encoding of the `health` block
  (`{ stuckWarning, iterationFresh }` shape is ratified; naming finalized in
  forge-2-tech, must stay additive per REQ-CONTRACT-05).
- **Q2** — Confirm whether any web view is delivered in Phase 4 at all, or whether
  web parity is deferred entirely to a follow-up feature (currently P2 / stretch).
- **Q3** — The corresponding `forge-5-loop` / `runner-contract.md` edit lives in
  the **feature-forge repo**; coordinate its landing so it references (not
  forks) rauf's `drive-rauf-loop` once REQ-SKILL-01 lands. Track the cross-repo
  sequencing (which repo/version ships first).
- **Q4** — Precise recovery-playbook steps (resume vs. reset vs. `--force`
  escalation ladder) and the "persists across N polls" threshold before an agent
  escalates a stall — to be pinned down in forge-2-tech / the `drive-rauf-loop`
  rewrite.

---

## 9. Success Criteria

- **REQ-SUCCESS-01** *(keystone)* — **One poll = full decision, zero raw-file
  reads.** A single `rauf status <root> --backlog <dir> --json` answers
  done / needs-human / recoverable-stall / healthy, and `drive-rauf-loop` never
  falls back to `iteration-status.json` or `events.ndjson` to make a decision. If
  it must, the contract has a hole and the feature is not done.
- **REQ-SUCCESS-02** — There is exactly **one** prescribed supervision pattern,
  documented in `drive-rauf-loop`, and `forge-5-loop` references its decision
  semantics rather than defining its own.
- **REQ-SUCCESS-03** — A human can, in one command, (a) follow a running loop at
  item-level with a progress header, and (b) see every live loop on the machine.
- **REQ-SUCCESS-04** — In a machine context (`--json` / non-TTY), an ambiguous
  target is a hard error, not a silent wrong-root scan.
- **REQ-SUCCESS-05** — No machine-surface (`--json` / `--ndjson`) output changed
  in a breaking way; all additions are additive and versioned; `pnpm gate` is
  green at each phase.
- **REQ-SUCCESS-06** *(negative test / "what a user would complain about")* — A
  human running `follow` no longer has to wade through token/tool events to see
  which item the loop is on; an agent author no longer has to invent a poll
  interval or read a second file.
