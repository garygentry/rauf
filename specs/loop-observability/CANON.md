---
title: "Loop Observability — Canon & North Star"
description: Single source of truth for rationalizing rauf's loop-monitoring surface (status / follow / log) around two consumers — the agent that DRIVES the loop and the human who monitors it in parallel. Establishes the "status --json = single decision surface" principle, the altitude×scope model, the completeness requirement for DerivedStatus, the canonical agent supervision pattern, and the human narration layer. Every per-area forge spec references this doc.
status: Draft — pre-ratification. Section 8 lists open decisions requiring sign-off before forge specs are written. Recommendations are marked [REC]; ratified items become [RATIFIED].
---

# SPEC: Loop Observability — Canon & North Star

This is the **canon** for rauf's loop-observability surface: the
`status` / `follow` / `log` command family, the machine contract an agent
uses to drive a loop, and the human-facing narration that rides on the same
data. It is written *before* any per-area spec so the cross-cutting decisions —
which command owns which altitude, what `status --json` must contain, how an
agent is prescribed to supervise a loop — are decided **once, here**, and every
downstream spec references it rather than re-deciding.

> **If a per-area forge spec disagrees with this doc, this doc wins** (or this
> doc is amended first).

> **How to use this doc.** §2 is the diagnosis. §3 is the load-bearing model
> (two consumers, altitude×scope). §4 is the *target state* / canon (the
> command grammar, the `status --json` contract, the agent pattern, the human
> layer). §5 is non-goals. §6 is the phased sequencing. §7 is the traceability
> to today's code. §8 lists **open decisions** requiring ratification.

---

## 1. Why now

rauf's monitoring surface was rationalized once already in the **UX/DX Overhaul**
(v0.6.0 — see `specs/ux-overhaul/CANON.md`), which persisted the event log,
unified verbs, and froze two machine surfaces. That work made the *data model*
sound. What remains unaddressed is the **consumer experience** on top of it:

- The **agent** — the first-class *driver* of the loop — has a solid but
  *under-prescribed* contract. The skills document *which commands exist* but
  not *the supervision pattern to run them in*, and the one decision an agent
  must make cannot be made from a single poll (§2, Gap 3).
- The **human** — who monitors the same loop in parallel, often a loop some
  *other* agent is driving — has no view pitched at the altitude they care
  about ("which item, progress against the whole backlog, any warnings").

This is not a data-model change. It is a **prescription + rendering** change on
an already-sound substrate, plus one enabling completeness fix to the status
contract.

---

## 2. Diagnosis (condensed)

The monitoring surface today is split by **data source**, but users think in
**altitude**. Three commands each draw from a different file at a different
level:

| Command | Source | Altitude | Time model |
| --- | --- | --- | --- |
| `status` | `state.json` + `backlog.json` (+ log fallback) | item/loop — the summary humans want | point-in-time; `--follow` polls & re-renders on change |
| `follow` | `events.ndjson` | tool/LLM — every spawn, tool call, token update | replay-then-tail, live |
| `log` | `rauf.log` | raw runner text | tail-N; `--follow` live |

From that split, three concrete gaps:

**Gap 1 — the skills are an operator's *reference card*, not an automation
*prescription*.** `drive-rauf-loop` lists the commands and documents exit codes,
the status enum, and the machine surfaces well — but never prescribes *the
supervision loop*: no interval, no decision tree, no canonical "how you detect
done." An agent has to invent its own control loop.

**Gap 2 — two skills prescribe two *different* supervision models.**
`drive-rauf-loop` prescribes **pull** (run, then poll `status`/`follow`);
feature-forge's `forge-5-loop` prescribes **push** (background the run, arm the
`Monitor` tool on `events.ndjson`, react to events as messages). Worse, the
*exact* event-filter/reaction rules live in feature-forge's
`references/runner-contract.md` — **outside the rauf repo that owns the
contract.** The decision surface is split across two repos.

**Gap 3 — the one decision an agent must make cannot be made from one poll.**
The agent's core branch is **done / needs-human / recoverable-stall / healthy**.
Three of those come cleanly from `status --json`
(`loopState` + `lastSignal` + `backlogSummary`). But the *recoverable-stall*
signal — `stuckWarning` — lives in a **separate file**
(`.rauf/iteration-status.json`), and the skill explicitly says *don't* infer a
stall from `state.json`'s `updatedAt`. So to make its full decision, an agent
must poll `status --json` **and** read a second file (or tail the event stream).
`status --json` is not yet a **complete decision surface**.

---

## 3. The model (load-bearing)

### 3.1 Two consumers, barely overlapping

The loop has two observers with almost orthogonal needs:

- **Agent = one loop, deep, control-oriented.** The *primary driver*. Single
  explicit backlog, driven by prescriptive skills, monitoring on an interval,
  making start/stop/restart/unstick decisions autonomously and pausing for a
  human **only** on a true human-decision signal. Agents are good at unsticking
  anything that doesn't need a human; the interface must let them do so from the
  fewest, most stable reads.
- **Human = many loops, wide, awareness-oriented.** Cross-session, cross-agent.
  Wants "where is everything and what is it working on," frequently watching a
  loop **another agent** is driving. Typical shape: multiple agents each own one
  backlog; a human supervises across sessions.

The agent lives on the **scope floor** (one root) at the **control altitude**;
the human lives on the **scope ceiling** (`--all`) at the **narration altitude**.
Because they barely overlap, **each end can be optimized without compromising
the other.**

> **Prime directive.** The **agent contract is the substrate; human UX is a pure
> rendering layer on top of it.** A human-readability change MUST NEVER alter
> what a machine surface (`--json`, `--ndjson`) emits. When the two pull in
> different directions, agent ergonomics win.

### 3.2 Two axes: altitude × scope

Replace "three source-named commands" with a two-axis mental model:

- **Altitude** (what you look at):
  - *glance* — where is it / is it healthy → `status`
  - *progress* — item-level narration over time (started X → done → picked Y,
    4/12 done, 1 blocked) → the human middle tier
  - *debug* — tool/LLM firehose → the event stream / `log`
- **Scope** (where you look):
  - default backlog (`.rauf/`) → named backlog (`--backlog <dir>`) →
    all backlogs in a repo → all live loops on the machine (`--all`)

The **agent** occupies { glance/control altitude } × { single explicit scope }.
The **human** ranges across all altitudes and up to machine-wide scope.

### 3.3 `--json` / non-TTY IS the mode boundary

We do **not** add an "agent mode" flag. The **existing `--json` signal (or a
non-TTY stdout)** is the single switch that gates three things at once:

1. **Rendering** — JSON → complete, stable, versioned stream; TTY → filtered,
   narrated, altitude-appropriate.
2. **Resolution strictness** — JSON/non-TTY → target must be **explicit or it is
   a hard error** (never an implicit scan that could pick the wrong root); TTY →
   default-to-cwd, scan, and offer choices as a human convenience.
3. **Liveness shape** — JSON `--follow` → one object per change (as
   `status --follow --json` already does); TTY → sticky header + scrolling feed.

This reuses a boundary that already exists rather than inventing a mode.

---

## 4. Target state (the canon)

### 4.1 `status --json` is the single agent decision surface [REC]

**`status --json` MUST be a complete superset of everything an agent would
otherwise scrape from `state.json`, `iteration-status.json`, or
`events.ndjson`** to make its next-action decision — so a prescriptive skill can
say *"poll `rauf status --json`, branch, never touch the raw files,"* and never
have to fall back to a file. **If the agent ever needs a file to decide, the
JSON contract has a hole.**

The four decisions an agent makes from a single poll, and the fields that must
answer each:

| Decision | Answered by |
| --- | --- |
| **Done** | `loopState ∈ {COMPLETE, IDLE}` + `backlogSummary` (nothing pending/in-progress) |
| **Needs human** | `loopState = PAUSED_HUMAN` / `lastSignal = needs_human` + `backlogSummary.needsHuman` |
| **Recoverable stall** *(new — closes Gap 3)* | a **health/stall hint folded into `DerivedStatus`** (see §4.2) |
| **Healthy in-progress** | `loopState ∈ {RUNNING, REVIEWING}` with no stall hint |

Also disjoint and separately actionable (already true today, preserved):
`backlogSummary.blocked` is the **total**; `needsHuman` and `deferred` (runner
false-block) are **disjoint subsets**.

### 4.2 The completeness fix — fold stall/health into `DerivedStatus` [REC]

This is the **enabling change**; everything else is prescription. Surface the
stall/health signal that currently lives only in `iteration-status.json`
directly in the `DerivedStatus` object returned by `status --json`, e.g. a
`health` block:

```jsonc
// DerivedStatus (additive; exact field names TBD in tech spec)
{
  "loopState": "RUNNING",
  "iteration": 4,
  "maxIterations": 15,
  "currentItem": "auth-007",
  "lastSignal": "clean",
  "backlogSummary": { "pending": 6, "inProgress": 1, "blocked": 2,
                      "needsHuman": 1, "deferred": 1, "done": 5, "total": 15 },
  "lock": { "present": true, "alive": true, "stale": false, "pid": 12345 },
  "health": {                       // <-- NEW, closes Gap 3
    "stuckWarning": false,          // mirror of iteration-status.json stuckWarning
    "iterationFresh": true          // derived freshness, so the agent needn't diff updatedAt itself
  }
}
```

Rules:
- **Additive only.** No existing field renamed or removed (respect the additive
  promise the machine surfaces already make).
- The hint is a **decision aid, not a verdict** — it says "an iteration appears
  to have stopped making progress," matching the skill's existing framing of
  `stuckWarning` as *a hang warning, not a failure*. The agent still decides
  whether to escalate (e.g. `--force` next run) only if it persists.
- **JSON is unchanged in shape by any human-rendering work** downstream.

### 4.3 Canonical agent supervision pattern — **poll**, not stream [REC]

Prescribe **one** pattern (retiring Gap 2's fork). The agent:

1. **Starts** the loop backgrounded so it survives the session and doesn't block
   it (`rauf loop run <path> [--backlog <dir>] [--agent …] --detached`, or a
   backgrounded foreground run per harness).
2. **Supervises by polling** the single decision surface on an interval:
   *loop { sleep N → `rauf status <path> [--backlog <dir>] --json` → branch on
   `loopState` + `health` }.*
3. **Branches** per §4.1: done → report & stop; needs-human → surface to the
   user (the only true stop); recoverable-stall → apply the recovery playbook
   (resume / reset / `--force`) autonomously; healthy → keep polling.

Rationale: polling is **stateless, harness-agnostic, and matches "one poll → one
decision."** It does not require the agent to parse an append-only stream or
track terminal state itself. The event stream (`--ndjson` / `events.ndjson`) and
the `Monitor`-tool push model remain **available** as a lower-latency
optimization where a harness offers it — but **decisions never depend on the
stream**; the stream is for *narration and diagnosis*, not control.

> Interval is a prescription, not a hard constant — see §8 open decision D3.

### 4.4 Command grammar (altitude × scope)

Target surface, expressed as altitude with `--json`/non-TTY selecting the
machine variant and scope flags selecting breadth:

- **`status`** — the *glance*. Point-in-time by default; `--follow` for a live
  glance (TTY: re-rendered snapshot; JSON: one object per change). Scope:
  default → `--backlog <dir>` → `--all` (machine-wide live registry).
  **This is the agent's canonical surface via `--json`.**
- **`follow`** — the live activity view over `events.ndjson`.
  - *Human default* → the **item-level narration** (the middle tier): scrolling
    feed of item/loop milestones (`item_selected`, `item_completed`,
    `item_blocked`, `item_retried`, `needs_human`, review-created-N) with a
    **sticky progress header** (`4/12 done · 1 blocked · on auth-007`). This
    filtering is a **property of the human renderer only.**
  - *Firehose* → `follow --verbose` (tool/LLM/token events) for debugging.
  - *Machine* → `follow --json` emits the **complete** stream (agents/diagnostics
    that want every event); the altitude filter never touches JSON.
- **`log`** — raw human `rauf.log` tail; unchanged in role.

> **Naming collision to resolve (§8, D1):** today "follow" means the event tail
> while `status --follow` means "re-poll the snapshot." The [REC] is to make the
> **item-level feed the default of `follow`** and demote the firehose behind
> `--verbose`, rather than add a fourth verb — matching the expectation that
> "follow the loop" = *watch it work*, not read token counts.

### 4.5 Resolution & scope ergonomics

- **Agent path is always explicit.** Under `--json`/non-TTY, a missing or
  **ambiguous** target is a **hard error** — never an implicit scan. The agent
  passes explicit `<root>` + `--backlog` (confirmed single-backlog-per-agent
  use case makes this cheap and unambiguous).
- **Human path is convenient.** On a TTY: default the root to **cwd**; if
  `scanBacklogRoots()` finds exactly one active root, use it; if several, **list
  them and let the user pick** rather than silently defaulting to `.rauf` and
  hiding a running forge backlog.
- **Machine-wide is a first-class human front door.** `--all` (backed by the
  `~/.rauf/active/*.json` registry via `listActiveLoops()`) is the best answer
  to "show me every live loop this machine is running." Expose an ergonomic
  enumeration surface (either a `backlogs` listing or richer no-arg `status`);
  the scan machinery (`scanBacklogRoots` / `scanActiveRoots`) already exists and
  is only wired to the web UI + `--all` today. **`--all --json` is human/tooling
  scope, NOT part of the single-loop agent contract.**

### 4.6 The human narration layer rides the same substrate

The item-feed (§4.4) and the `--all` dashboard render **entirely from the same
`events.ndjson` / `DerivedStatus` data** the agent uses. They add **no new data
model** and, per the prime directive (§3.1), **cannot regress the agent** because
they are TTY-render-only. Reuse `event-format.ts` (the exhaustive per-event
renderer), `scanBacklogRoots`, `scanActiveRoots`, and `listActiveLoops`.

### 4.7 Skill reconciliation (the prescription half)

- **`drive-rauf-loop` becomes the single source of truth** for the agent
  supervision *pattern* — rewritten from a reference card into an explicit
  automation recipe: the poll loop (§4.3), the interval (§8 D3), the
  done/needs-human/stall/healthy decision tree (§4.1), and the recovery
  playbook. It owns the contract, **in the rauf repo.**
- **feature-forge's `forge-5-loop` defers to it** rather than carrying its own
  divergent `Monitor`/event-filter rules. `forge-5` may still *use* the push
  model as a latency optimization, but the **decision semantics** it references
  live in rauf's `drive-rauf-loop`, not feature-forge's `runner-contract.md`.
- `author-backlog` is unaffected in scope; it is the vehicle we use to build
  the backlog for *this* feature.

---

## 5. Non-goals

- **No revisiting the command grammar redesign.** The v0.6.0 verb/vocabulary
  overhaul stands. This feature refines *observability altitude and
  prescription*, not the noun/verb set (beyond the `follow` default in D1).
- **No new persisted state or event types** unless strictly required to surface
  an already-computed signal (the §4.2 `health` block mirrors an existing
  `iteration-status.json` value — it is a surfacing, not a new source of truth).
- **No status via subprocess.** Status derivation continues to read files
  directly (project rule #6).
- **No change to how the loop runner commits, selects items, or manages state.**
- **No cross-loop *control* for agents.** `--all` is observation/human scope; an
  agent still drives exactly one backlog.

---

## 6. Sequencing (phased)

Ordering matters — the contract must be **complete** before it can be
**prescribed**, and the human layer must come last because it is pure gravy that
must not gate the agent work:

1. **Phase 1 — Complete the contract (enabling).** Fold the stall/health hint
   into `DerivedStatus` / `status --json` (§4.2). Additive, versioned, tested.
   *Nothing downstream is correct until one poll answers all four decisions.*
2. **Phase 2 — Make it consistent (prescription).** Rewrite `drive-rauf-loop`
   into the canonical poll-based automation recipe (§4.3, §4.7); make
   `forge-5-loop` defer to it. Resolve the `--json`/non-TTY strictness rule
   (§4.5).
3. **Phase 3 — Make it humane (rendering).** Item-level `follow` default +
   sticky progress header; the `follow` naming/altitude change (D1); ergonomic
   backlog enumeration + cwd-default + `--all` front door (§4.5). All
   TTY-render-only.
4. **Phase 4 — Parity & docs.** Web observation parity for any new human view;
   update `docs/SPEC-CLI.md`, `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`, and the
   ux-overhaul canon cross-reference.

Each phase is independently shippable and green under `pnpm gate`.

---

## 7. Traceability to today's code

Grounding references (as of this draft) so forge specs start from fact:

- `status` — `packages/cli/src/status-commands.ts` (`handleStatus`,
  `printStatusSummary`); derivation in `packages/core` `status.ts` (`deriveStatus`).
- `follow` — `packages/cli/src/follow-command.ts` (`handleFollow`,
  `followEvents`); rendering in `packages/cli/src/event-format.ts` (`formatEvent`).
- `log` — `status-commands.ts` (`handleLog`, `handleLogFollow`); tail via
  `readLogTail`.
- Backlog addressing — `backlog-root.ts` (`resolveBacklogRoot`,
  `resolveStateDir`, `resolveBacklogPaths`, `scanBacklogRoots`); active-loop
  discovery `status.ts` (`scanActiveRoots`) + `loop-registry.ts`
  (`listActiveLoops`, `~/.rauf/active/*.json`).
- Contracts — `DerivedStatus` / `BacklogSummary` / `LoopState` /
  `PersistedEvent` in `packages/core` `schemas.ts`; stall signal in
  `.rauf/iteration-status.json` (`stuckWarning`) and the `llm_stuck_warning`
  event.
- Skills/agents — `skills/drive-rauf-loop/SKILL.md`,
  `agents/rauf-loop-driver.md`, `skills/author-backlog/…`; feature-forge
  `skills/forge-5-loop/SKILL.md` + `references/runner-contract.md`.
- Prior canon — `specs/ux-overhaul/CANON.md` (the surface this builds on).

*Line numbers intentionally omitted; forge-2-tech re-verifies against live code.*

---

## 8. Open decisions (require ratification before forge specs)

| # | Decision | [REC] | Notes |
| --- | --- | --- | --- |
| **D1** | Where does the item-level middle tier live? | Re-pitch **`follow`**'s default to item-level; firehose behind `--verbose`. Do **not** add a 4th verb. | Alternative: new `watch`/`progress` verb. Resolves the `follow` vs `status --follow` naming collision. |
| **D2** | No-arg default scope for `status` on a TTY. | Default to **cwd**; broaden to `--all` only when there's no local live loop. | Alternative: bare `status` → machine-wide dashboard immediately. |
| **D3** | Prescribed poll interval for the agent recipe. | A sane default (e.g. 5–10s) documented in `drive-rauf-loop`, overridable. | Balance latency vs. cost of repeated `deriveStatus` reads. |
| **D4** | Exact `health` field shape in `DerivedStatus`. | `{ stuckWarning, iterationFresh }` as a nested block. | Names/booleans-vs-enum TBD in forge-2-tech; must stay additive. |
| **D5** | Strictness trigger. | `--json` **OR** non-TTY stdout ⇒ explicit-or-error resolution. | Confirm non-TTY alone should trigger strictness, or only explicit `--json`. |
| **D6** | Does `forge-5-loop` keep the push/`Monitor` model as an optimization, or converge fully on polling? | Keep push as optional latency optimization; **decision semantics** defer to `drive-rauf-loop`. | Avoids forcing a feature-forge rewrite while unifying the contract. |

---

*This canon is the basis for the feature-forge pipeline on this feature
(`forge-1-prd` → `forge-2-tech` → `forge-3-specs` → `forge-4-backlog` →
`forge-5-loop`). Ratify §8 before generating specs.*
