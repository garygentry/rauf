---
title: "UX/DX Overhaul — Canon & North Star"
description: Single source of truth for the rauf interface overhaul — target-state command grammar, monitoring model, status vocabulary, exit codes, machine surfaces, and agent contract, plus the phased cutover/dogfood strategy. Every per-phase forge spec references this doc.
status: DRAFT — pending ratification (target-state decisions are PROPOSALS until Gary signs off)
---

# SPEC: UX/DX Overhaul — Canon & North Star

This is the **canon** for the rauf interface overhaul. It is deliberately
written *before* any per-area spec so that the cross-cutting vocabulary —
command names, flags, status labels, exit codes, event names — is decided
**once, here**, and every downstream spec references it rather than
re-deciding. If a per-phase forge spec disagrees with this doc, this doc wins
(or this doc gets amended first).

> **How to use this doc.** Sections 3–4 are the *target state* (the canon).
> Section 5 is the *plan* (phases + sequencing). Section 6 is the *safety net*
> (how to change rauf with rauf without bricking it). Section 7 lists the
> **open decisions** that need explicit ratification before forge specs are
> written. Items marked **[PROPOSED]** are recommendations, not yet ratified.

---

## 1. Why now

The interface ("API") was designed early in rauf's life. After substantial
real-world hardening, the *foundation* is solid but the *surface* still leaks
implementation detail — chiefly the in-process-vs-server execution split and the
file-vs-event observation split. With **zero external users on old behavior**,
this is the moment to make breaking corrections. The decision (ratified) is a
**clean break, no deprecation aliases**.

---

## 2. Diagnosis (condensed)

The full analysis lives in the conversation that produced this doc; the load-
bearing findings:

1. **Two execution modes leak into the command names.** `loop run` (in-process,
   unattended-safe, no live events) vs `loop start` (server-owned, interruptible,
   live SSE). "run" and "start" are synonyms to a human — nothing signals the
   difference that actually matters (survives a server restart? feeds the web?).

2. **The event stream is the only un-persisted state.** Status/log derive from
   files (good, and rule #6), but live `LoopEvent`s exist only in memory and are
   fanned to SSE solely for *server-owned* loops. So the web shows a degraded
   view of in-process runs, and `follow` behaves differently by mode.

3. **"Empty status mid-run" is real and has three causes**, all silent:
   (a) **backlog-root mismatch** — an active loop on `--backlog <dir>` writes
   `<dir>/.rauf/`, but `rauf status .` derives from the default `.rauf/` and
   truthfully reports "idle"; (b) **silent empty** — missing/early files return
   `[]` indistinguishably from "nothing happening"; (c) **cwd resolution** — a
   different working directory inspects a different `.rauf`.

4. **Monitoring verbs are fragmented and inconsistent.** Four overlapping ways to
   watch a loop (`status --watch`, `log --follow`, `loop follow`, `loop watch`),
   `--watch` vs `--follow` for the same concept, `status --watch` ignores `--json`.

5. **Vocabulary drifts across surfaces.** Title-case vs ALL-CAPS badges;
   `PAUSED_HUMAN` rendered three ways; `REVIEWING`/`PAUSED_USAGE_LIMIT` have no
   badge and silently fall back to looking IDLE.

6. **CLI↔web parity gaps.** `loop run`, `loop review`, `reset`, `resume`,
   `unblock`, `validate` are CLI-only — a stuck loop has no web recovery path.

7. **Agent contract self-contradicts on the one rule that causes double-commits:**
   `RAUF.md` says "do NOT commit," `CLAUDE_ADDON.md:21` says "Commit your changes."
   Plus Claude-specific "Task tool" language while the contract heads
   provider-agnostic, and a doc/impl mismatch on signal placement ("final line"
   vs the parser's backward scan).

---

## 3. Design principles

These five principles drive every target-state decision below.

- **P1 — Files are the single observation substrate.** *Every* observer (CLI,
  web, external pipeline) reconstructs loop activity from files on disk. No
  observation path depends on owning the runner. (Implies: persist events.)

- **P2 — The interface hides the execution mode.** Whether a loop runs
  in-process or server-owned is an implementation detail. Command names and
  output describe *intent* (foreground vs detached), not *mechanism*.

- **P3 — One way to do each thing.** One canonical command per concept; one flag
  name per concept; one display label per state. Convenience aliases are *not*
  added (clean break — they're the thing we're removing).

- **P4 — Empty is never silent.** Any command that resolves to "nothing here"
  states *which directory* it inspected and whether a different backlog root has
  a live loop. Absence and idleness are distinguishable.

- **P5 — Machine surfaces are explicit, versioned, and additive-only.** Humans
  and machines read different surfaces. Machine surfaces (`--json`, NDJSON event
  log) are stable contracts; human surfaces are free to change.

---

## 4. Target-state canon

### 4.1 Command grammar

Notation: ✂ = removed (clean break), ✦ = new, ⟳ = changed. "Current" reflects
`docs/SPEC-CLI.md` and `packages/cli/`.

#### Execution

| Current | Target | Notes |
| --- | --- | --- |
| `loop run [path]` (in-process) | `loop run [path]` | Foreground, blocks, streams to terminal. The default. Unattended-safe (survives a server bounce). |
| `loop start [path]` (server) | ⟳ `loop run [path] --detached` (`-d`) **[PROPOSED]** | Detached run routes through the server daemon (auto-starts it), returns immediately. One verb, the flag names the intent. `loop start` is ✂ removed. |
| `loop stop [path]` | `loop stop [path]` | Stops a detached/server-owned loop. (A foreground `loop run` is stopped with Ctrl-C, as today.) |
| `loop review [path]` | `loop review [path]` | Unchanged. |
| — | `loop run … --detached --follow` | After detaching, attach the live view (= `rauf follow`). |

> **Mental model after this change:** there is one loop verb, `run`. Bare = I
> wait and watch. `--detached` = it runs without me; I observe with `follow`,
> stop with `loop stop`, or open the web.

#### Monitoring (unified top-level group — see §4.2)

| Current | Target | Notes |
| --- | --- | --- |
| `status [path] [--watch] [--interval N]` | ⟳ `status [path] [--follow] [--json]` | `--watch`→`--follow`; `--follow` honors `--json` (NDJSON snapshots). `--interval` retained under `--follow`. |
| `log [path] [--tail N] [--follow]` | `log [path] [--tail N] [--follow] [--json]` | `--follow` now reads the **persisted event log** + `rauf.log`, identical in any mode. |
| `loop follow [path]` | ⟳ `follow [path]` **[PROPOSED]** | Promoted to a top-level monitoring verb beside `status`/`log`/`progress`. The canonical rich live view (status line + log + structured events). Source-agnostic (P1). `loop follow` is ✂ removed. |
| `loop watch [path]` | ✂ removed | Its tool/token detail is part of `follow` and of `status --json` (from `iteration-status.json` + events). |
| `progress [path]` | `progress [path]` | Unchanged. |
| — | ✦ `status --all` (or ⟳ `projects status`) | Lists every backlog root with a live lock across the tree (P4 discoverability). |

#### Recovery & backlog (mostly unchanged; consistency only)

- `reset` / `resume` stay **top-level** — they are recovery entry points that
  must work when the loop is broken; nesting them under `loop` would imply the
  runner is healthy. (Justified asymmetry — keep.)
- `backlog unblock` remains the primitive; `resume --retry-blocked` and
  `loop run --retry-blocked` are documented as conveniences that call it. The
  canon names the relationship so it doesn't read as duplication.
- `--backlog <dir>` is the **one** way to target a non-default backlog root, on
  every command that touches state. No command invents a second spelling.

#### Flag canon (apply everywhere)

| Concept | Canonical flag | Removed spellings |
| --- | --- | --- |
| Live/streaming follow | `--follow` / `-f` | `--watch` ✂ |
| Machine output | `--json` (NDJSON where streaming) | (must work on *every* read/monitor command, incl. `status --follow`) |
| Target backlog root | `--backlog <dir>` | any per-command variant |
| Poll cadence | `--interval <seconds>` | — |

### 4.2 Observation model (the keystone)

- A running loop appends every `LoopEvent` to **`<state>/events.ndjson`** (new),
  one JSON object per line, alongside the existing `state.json` / `rauf.log`
  writes. This is the persisted form of what is today an in-memory-only stream.
- `status`, `log`, `follow`, **and the web** all reconstruct their view from
  files (`state.json` + `events.ndjson` + `iteration-status.json` + `rauf.log`).
  No observer needs to own the runner.
- **Consequence:** in-process (`loop run`) and detached (`loop run --detached`)
  runs become **observationally identical** everywhere, including the web. The
  in-process/server visibility asymmetry dissolves, and the four monitor commands
  collapse to one model with different presentations.
- The server's in-memory ring buffer / SSE becomes a *latency optimization* over
  the file, not the sole source — it may tail `events.ndjson` for any project,
  including loops it didn't start.

### 4.3 Status vocabulary (complete, canonical)

One map, used **identically** by the CLI, the projects dashboard, and the status
page. Display labels are **Title Case** on human surfaces; the SCREAMING_SNAKE
form is the *machine enum value only* (`--json`, API).

| Raw (`state.json.status`) | Derived enum (machine) | Display label (human, all surfaces) |
| --- | --- | --- |
| `idle` | `IDLE` | Idle |
| `starting` | `RUNNING` | Running |
| `running` | `RUNNING` | Running |
| `reviewing` | ✦ `REVIEWING` | Reviewing |
| `paused` | `PAUSED` | Paused |
| `paused_human` | `PAUSED_HUMAN` | Needs Human |
| `paused_usage_limit` | ✦ `PAUSED_USAGE_LIMIT` | Usage Limit (Paused) |
| `sleeping_limit` | `SLEEPING_LIMIT` | Sleeping (Limit) |
| `weekly_limit` | `WEEKLY_LIMIT` | Weekly Limit |
| `limit_reached` | `LIMIT_REACHED` | Limit Reached |
| `complete` | `COMPLETE` | Complete |
| `error` | `ERROR` | Error |
| (not installed) | `NOT_INSTALLED` | Not Installed |

Rules: (1) the derived enum must cover **every** raw status — no silent fallback
to IDLE; (2) `REVIEWING` and `PAUSED_USAGE_LIMIT` are added to the derived enum
and given badges; (3) `PAUSED_HUMAN` displays as **"Needs Human"** everywhere;
(4) one shared label map module is the single source for CLI + both web pages.

### 4.4 Exit codes (unified) **[PROPOSED]**

Today `status` (1=running, 2=paused_human, 3=limit_reached) and `loop run`
(6=paused_human) disagree, and `status`'s `1=running` collides with the generic
`1=error`. Proposed single scheme, used by both `status` (reflecting current
state) and `loop run` (reflecting terminal state). **feature-forge reads these,
so this changes the contract — bundle with the §6 cutover.**

| Code | Meaning |
| --- | --- |
| 0 | Success — clean terminal (idle / complete) |
| 1 | Error (generic failure) |
| 2 | Usage error (bad args / IO) |
| 3 | Needs human (`PAUSED_HUMAN`) |
| 4 | Limit reached / usage-paused / sleeping |
| 5 | Blocked (terminal with blocked items) |
| 6 | Running (query-time only, `status`) |

`backlog validate` keeps its own documented codes (0 valid / 1 findings / 2
usage) — that triad is already coherent and contract-stable; leave it.

### 4.5 Machine surfaces (versioned)

- **`events.ndjson`** is promoted to a **stable, versioned machine surface**
  (joins `--ndjson` stream and `status --json`). Additive-only within a major
  version (P5). The `--ndjson` live stream and the persisted file SHOULD carry
  the same event shapes.
- **Fix `signal_parsed.signal` collapsing `review`→`done`** — add an explicit
  `review` value rather than overloading `done`. **[PROPOSED]** (clean break).
- **Reconcile signal-placement docs with the parser.** Contract §A.2 says "final
  line"; the parser scans backward from the end, skips blanks, matches exact
  tokens, and tolerates text *after* the signal. Canon wording: *"Emit the signal
  on a line by itself; the runner scans from the end of output, so trailing
  summaries/commit messages don't break detection."* Update the contract + agent
  templates to match reality.

### 4.6 Agent contract canon

- **Single commit rule:** the agent **never** commits or stages; the loop runner
  owns the commit. Fix `CLAUDE_ADDON.md:21` to match `RAUF.md`. The rule must be
  identical in `RAUF.md`, the agent addon, and the prompt-builder reminder.
- **Provider-agnostic language:** rename `CLAUDE_ADDON.md` → `AGENT_ADDON.md`;
  replace "Task tool" with a provider-neutral "your sub-agent / delegation
  mechanism." Coordinate with Part B of the contract (provider refactor) so this
  isn't done twice. *(The commit-rule fix is additive and can land in Phase 1;
  the rename couples to Part B.)*
- **Signal spec** (canonical, matches §4.5): exact tokens `RAUF_DONE`,
  `RAUF_BLOCKED:<reason>`, `RAUF_NEEDS_HUMAN:<reason>`, `RAUF_REVIEW:<json>`;
  on a line by itself; scanned from the end; no signal → classified by exit
  context (never auto-blocked).
- **Model cascade** (document in the agent-facing docs): `item.model` >
  `--model` / options > project default > provider default.
- **`progress.md` guidance:** ship a session-log format stub so agents know
  *what* and *how* to append, instead of learning by reading the file.

---

## 5. The plan — phases & sequencing

Canon → four workstreams. Each becomes a **feature-forge feature** (PRD → tech
spec → numbered specs → validated backlog) referencing this doc, then is
dogfooded on its own branch with its own `--backlog` root.

| Phase | Workstream | Breaking? | Canon refs | Depends on |
| --- | --- | --- | --- | --- |
| **1** | **Observation substrate (keystone)** — `events.ndjson`; status/log/follow/web read files; collapse monitor commands; P4 "empty is never silent"; commit-rule fix | **Additive** | §4.2, §4.1-monitoring, §4.6-commit, P1/P4 | — |
| **2** | **Command grammar & naming** — `run --detached`; `--follow` normalization; promote `follow`; `--backlog` discoverability; help + error remediation | **Breaking** | §4.1, P2/P3 | Phase 1 (monitor model) |
| **3** | **Contract & machine surfaces** — unified exit codes; `events.ndjson` versioning; `review` signal fix; signal-placement reconciliation; feature-forge `minRunnerVersion` flip | **Breaking** | §4.4, §4.5 | Phases 1–2 |
| **4** | **Web parity + vocabulary + agent contract** — add reset/resume/review/unblock/validate to web; shared label map; missing badges; provider-agnostic agent templates | Mostly additive | §4.3, §4.6, P3 | Phase 1 (substrate) |

**Why this order:** additive keystone first (Phase 1 ships without a coordinated
flip and proves the harness on low-stakes work); then the breaking renames and
contract changes land **together** as a single major-version flip (Phases 2+3);
polish (Phase 4) parallelizes once the canon vocabulary is fixed.

Each phase's "done" includes updating the affected specs: `SPEC-CLI.md`,
`SPEC-WEB.md`, `SPEC-BACKLOG-TOOL-CONTRACT.md`, `SCHEMAS.md`, `ARCHITECTURE.md`,
and `SPEC-ARTIFACTS.md`.

---

## 6. Cutover & dogfood strategy (the safety net)

rauf builds rauf — these changes touch the very commands the loop runner invokes.
Safeguards:

1. **Dogfood with `rauf-stable`, mutate `dev rauf`.** Run every implementing loop
   with the *frozen* `rauf-stable` binary while the `dev rauf` symlink is the
   thing being changed. Never run a loop with the binary whose command surface
   that same loop is rewriting.
2. **Additive-before-breaking.** Phase 1 changes nothing a caller relies on, so
   it lands and is dogfooded normally. Only Phases 2–3 need the coordinated flip.
3. **Single breaking flip.** All command renames, removed flags, and exit-code /
   contract changes land in **one release** — **[PROPOSED] v0.5.0** — so there is
   exactly one moment of breakage. In the same change:
   - bump feature-forge `minRunnerVersion` to `>= 0.5.0`;
   - update any feature-forge templates/scripts that invoke `loop start`,
     `--watch`, or the old exit codes.
4. **No aliases (ratified).** Old names are removed, not shimmed. The flip is
   clean; the cost is one update to your own habits and to feature-forge, both
   acceptable at current scale.
5. **Per-phase isolation.** Each forge feature gets its own `--backlog` root and
   branch, so a half-finished phase never contaminates the others or the
   project's own self-hosting loop.

---

## 7. Open decisions to ratify

These are the high-stakes calls baked into the canon as **[PROPOSED]**. Confirm
or redirect before forge specs are written.

1. **Execution grammar.** `loop run --detached` (one verb + flag) **[recommended]**
   vs keeping two verbs renamed for clarity (e.g. `loop run` + `loop serve`).
2. **Monitoring placement.** Promote to top-level `follow` beside
   `status`/`log`/`progress` **[recommended]** vs keep `loop follow` under `loop`.
3. **Unified exit-code table** (§4.4 values) — confirm, since feature-forge
   depends on them.
4. **Cutover version** — v0.5.0 for the single breaking flip **[recommended]**.
5. **Agent addon rename timing** — pull the commit-rule fix forward into Phase 1
   (additive) **[recommended]**, but couple the `CLAUDE_ADDON.md → AGENT_ADDON.md`
   rename + provider-neutral language to the Part-B provider refactor.

---

## 8. Out of scope

- **Eliminating an execution mode.** Both in-process and server-owned runs are
  justified (unattended-safe vs interruptible) and stay. We hide the split, not
  remove it.
- **The Part-B provider architecture** (which LLM drives an iteration) — separate
  effort; this overhaul only *coordinates* with it on the agent-template rename.
- **Backlog schema redesign.** `backlog.json` shape is stable and not part of
  this overhaul beyond the `schemaVersion` discipline already in the contract.
