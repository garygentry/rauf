---
name: drive-rauf-loop
description: >
  Operate the rauf CLI to drive an autonomous coding loop — the run → observe →
  recover lifecycle. Use this skill when the user asks to "run the rauf loop",
  "start the loop and watch it", "kick off rauf on this project", "supervise a
  rauf run", "check the loop status", "why is the loop paused/blocked/stuck",
  "recover an interrupted rauf loop", "resume the loop", "the loop died — fix it",
  or "what does rauf exit code N / status X mean". Also use when an agent needs to
  drive rauf programmatically (machine surfaces: `--ndjson`, `status --json`,
  `events.ndjson`). Do NOT trigger for authoring or QA-ing backlog items (use
  author-backlog / review-backlog), for fixing the installed `.rauf/RAUF.md`
  guidance (use review-rauf-guidance), or for behaving AS a loop iteration (that
  per-iteration contract lives in the project's `.rauf/RAUF.md`).
---

# Drive a Rauf Loop

This skill is for **operating** the rauf CLI as a tool: starting a loop, watching it,
and recovering it when it stops. It is the operator's view — the agent **driving** rauf —
not the agent running **inside** a loop iteration.

This skill is the **one** canonical supervision recipe — **poll, not stream** — and the
authoritative decision contract that other tools (including feature-forge's `forge-5-loop`)
reference rather than re-deciding. There is exactly one prescribed pattern: **start the loop
backgrounded, poll `rauf status … --json`, branch on a four-way decision tree, and recover
via a persist-then-escalate ladder.** Everything else in this file is reference material
that supports that loop.

**Boundaries (what this skill is NOT):**

- **Not backlog authoring/QA** → use `author-backlog` (create `backlog.json`) or
  `review-backlog` (audit one). A loop has nothing to run without a backlog.
- **Not the per-iteration contract** → how a loop agent behaves each iteration
  (read the `in_progress` item, signal `RAUF_DONE`/`RAUF_BLOCKED`/`RAUF_NEEDS_HUMAN`,
  don't commit) lives in the installed `.rauf/RAUF.md`. Don't restate it here.
- **Not fixing rauf's setup** → if commands are wrong or context is missing, use
  `review-rauf-guidance`.
- **Not an exhaustive flag reference** → `docs/SPEC-CLI.md` is the complete CLI spec and
  `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7 is the machine-surface contract. This skill is
  the decision layer; cross-link those for every flag and field rather than duplicating them.

`<root>` below is the project root that contains `.rauf.json`; `<dir>` is the backlog root
passed via `--backlog` (see §5). In a **machine context** (an agent driving rauf) both MUST
be explicit — do not rely on a `.`/cwd default.

---

## The canonical recipe

Run this loop. Every decision comes from a single `status --json` poll; nothing below reads
a raw state file to decide.

### Step 1 — Start backgrounded

Start the loop so it **survives the session and does not block the driving agent**:

```
rauf loop run <root> --backlog <dir> --detached
```

`--detached` / `-d` auto-starts the server daemon and returns immediately; the loop then
runs independently. (Where a harness offers its own background primitive that survives the
session, that is an acceptable substitute — the requirement is "the loop survives and
doesn't block," not a specific mechanism.)

A start **refused for a precondition** — a dirty working tree or a protected branch — is a
**setup error, not a stall**. Resolve it before entering the poll loop with the §0 guards
(`--create-branch`, `--seed-backlog`, `--force`), then start again.

### Step 2 — Poll the single decision surface

The **only** surface the agent reads to **decide** is:

```
rauf status <root> --backlog <dir> --json
```

- **Explicit target, always.** In a machine context (`--json` OR non-TTY), `<root>` +
  `--backlog <dir>` MUST be explicit. A `TargetError` (`missing_target` / `ambiguous_target`)
  means **"fix your addressing"** — pass both explicitly — **not** a loop state, and never a
  silent scan (see `docs/SPEC-CLI.md` and the target-resolution rules).
- **Poll interval — 5 seconds default, 5–10 second band.** Poll every **5 s** by default.
  You MAY widen toward **10 s** to reduce `deriveStatus` read cost, or narrow toward **5 s**
  for lower detection latency. This is **documented guidance, not a code constant** — there
  is no interval export in `core`.
- **KEYSTONE — never read a raw file to decide.** The agent **NEVER** reads
  `.rauf/iteration-status.json` or `events.ndjson` to make a decision. One `status --json`
  poll is a **complete superset** — including the stall hint via **`health.stuckWarning`**.
  If you ever feel you need a raw file to decide, the contract has a hole. The stream stays
  available only for narration/diagnosis (see [The stream never decides](#the-stream-never-decides)).

### Step 3 — The four-way decision tree

Each poll yields **one** decision. Evaluate the rows **top-to-bottom; first match wins**
(`needs-human` outranks the stall hint; done outranks healthy). Every input comes from the
single `DerivedStatus` object returned by the poll.

| #   | Condition (from ONE `status --json` poll)                                                             | Decision                | Action                                                             |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| 1   | `loopState ∈ {COMPLETE, IDLE}` **and** `backlogSummary` has nothing `pending`/`inProgress`            | **Done**                | Report the outcome and **stop**.                                   |
| 2   | `loopState = PAUSED_HUMAN` **or** `lastSignal = "needs_human"` **or** `backlogSummary.needsHuman > 0` | **Needs human**         | **Surface to the user** — the ONLY true stop. Do not auto-recover. |
| 3   | `health?.stuckWarning === true`                                                                       | **Recoverable stall**   | Apply the persist-then-escalate ladder (Step 4).                   |
| 4   | `loopState ∈ {RUNNING, REVIEWING}`, no stall hint                                                     | **Healthy in-progress** | **Keep polling** at the interval.                                  |

Notes:

- **Ordering matters.** Row 2 (`needs-human`) is checked **before** the stall hint (row 3): a
  loop paused for a human that also shows a stale iteration is a needs-human stop, not a
  recovery case.
- **`health` may be `null`** (no live iteration). `status.health?.stuckWarning`
  short-circuits to falsy, so row 3 does not fire — correct: no live iteration means no stall
  to recover.
- **Row 2's three signals are complementary, not redundant.** `PAUSED_HUMAN` is the halt
  state under `--pause-on-needs-human`; `lastSignal = needs_human` and
  `backlogSummary.needsHuman > 0` cover the default "set aside and continue" mode. Any one is
  sufficient. Read `needsHuman` (a disjoint subset), **not** the total `blocked`.

**After the loop completes — starting the next cycle.** When row 1 fires
(`loopState ∈ {COMPLETE, IDLE}`, nothing `pending`/`inProgress`), the backlog is finished:
every item is `done` and re-running does nothing until it's repopulated. To start a fresh
cycle, don't hand-edit `backlog.json` — reset it, then re-author:

```bash
rauf backlog reset <root> --clear --yes   # archive done items + progress/log, empty the backlog
```

Then author new items via the **author-backlog** skill (see its
[Resetting a Completed Backlog](../author-backlog/SKILL.md#resetting-a-completed-backlog)
section for the full workflow and caveats), validate, and `loop run` again.

### Step 4 — The persist-then-escalate recovery ladder

A stall hint is a **decision aid, not a verdict**: "an iteration appears to have stopped
making progress." A single transient hint must **never** trigger a disruptive recovery.

1. **Single-poll `health.stuckWarning` → surface & keep polling.** On the _first_ poll
   showing `stuckWarning`, **surface** the warning (narration) and **keep polling**. Do
   **not** act yet.
2. **Persists across N = 3 consecutive polls → act** (≈ 15–30 s at the 5–10 s interval):
   - **Paused loop → `resume`.** If `loopState` is a resumable pause (`PAUSED`,
     `LIMIT_REACHED`, `*_LIMIT`), run `rauf resume <root> --backlog <dir>`.
   - **Otherwise → re-run with `--force`.** If the loop is not paused, re-run the next
     iteration with `--force`.
3. **`reset` ONLY for a confirmed-dead lock.** Use `rauf reset` **only** when the status
   shows a stale, dead lock: **`lock.stale === true && lock.alive === false`**. `reset` is
   never the first response to a stall hint.
4. **`needs_human` is the only true stop.** No point on this ladder auto-resolves a
   needs-human state — that always surfaces to the user (Step 3, row 2).

Prescribed values (documented, overridable — **not** code constants):

| Prescription          | Value                                         |
| --------------------- | --------------------------------------------- |
| Poll interval default | **5 s**                                       |
| Poll interval band    | **5–10 s**                                    |
| Escalation threshold  | **N = 3** consecutive stall polls (≈ 15–30 s) |
| `reset` trigger       | `lock.stale && !lock.alive` only              |

The **counter is agent-side state**: count consecutive `stuckWarning === true` polls; reset
the counter on any poll where it is `false`. Core does not track persistence — it returns
booleans + `secondsSinceActivity` (a supplementary time-based signal if you prefer that to a
poll count), so the agent owns the threshold.

### The stream never decides

The event stream (`rauf loop run … --ndjson`, `events.ndjson`, and any harness push/`Monitor`
model) stays **available** as a lower-latency narration and diagnosis aid. But:

> **Agent decisions MUST NEVER depend on the stream.** The stream is for narration and
> diagnosis only. Every done / needs-human / stall / healthy decision is made from the
> `status --json` poll (Step 3). The stream may make narration richer or lower-latency; it
> is never on the decision path.

The optional live human-in-the-loop supervisor snippet is in the
[reference appendix](#machine-surfaces-reference) as a narration example — not the control
loop.

### Edge cases the recipe handles (all from the one poll)

| Situation                                                                                                  | What the agent does                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ambiguous / missing target** in machine context                                                          | The poll returns a `TargetError` (`missing_target` / `ambiguous_target`). It's an **addressing error** — pass explicit `<root>` + `--backlog <dir>`; never scan.                    |
| **Usage-limit / sleeping pause** (`PAUSED_USAGE_LIMIT`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `LIMIT_REACHED`) | Not a stall, not a needs-human stop. **Keep polling**; the loop auto-resumes when limits reset (or `resume` once reset). Use `sleepUntil` for narration. Do **not** run the ladder. |
| **`health = null`** while `loopState` is `RUNNING` transiently                                             | No stall signal this poll; the stall counter is **not** incremented. Keep polling.                                                                                                  |
| **Transient single-poll `stuckWarning`**                                                                   | Surface, **do not act**; escalate only if it persists to N = 3 (Step 4).                                                                                                            |
| **Confirmed-dead lock** (`lock.stale && !lock.alive`) with work remaining                                  | The only case for `reset`; then re-run (Step 4, item 3).                                                                                                                            |
| **`ERROR` loopState**                                                                                      | Crash / circuit-breaker halt: `reset` then re-run, or `resume` (§Recover). Not a stall-ladder case.                                                                                 |
| **Sleep between polls**                                                                                    | Sleep the prescribed interval (5 s default). In a harness that forbids a foreground `sleep`, use its wait/until primitive.                                                          |

---

## Reference appendix

The tables below are a **lookup appendix** for the recipe above — status vocabulary, exit
codes, machine surfaces, and recover commands. They support the recipe; they are no longer
_the_ skill.

### Run — pick the execution mode

| You want…                                   | Command                                           | Why                                                                                               |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| To launch it backgrounded (the recipe)      | `rauf loop run <root> --backlog <dir> --detached` | Auto-starts the server daemon, returns immediately. Observe with `follow`, stop with `loop stop`. |
| To run it now and watch it (interactive)    | `rauf loop run <root>`                            | Foreground, blocks, streams to the terminal. **Unattended-safe** — a `server stop` can't kill it. |
| To detach but immediately watch             | `rauf loop run <root> -d --follow`                | Detaches, then attaches the live view. Ctrl-C detaches the **view only** — the loop runs on.      |
| To stop a detached/server-owned loop        | `rauf loop stop <root>`                           | Graceful cancel via the server. (A foreground `loop run` stops with Ctrl-C.)                      |
| To review completed work without a full run | `rauf loop review <root>`                         | Spawns a review pass over `done` items; creates fix items.                                        |

Common flags (see SPEC-CLI for the full list): `--iterations N` (per-run budget — resets
each run; resume to continue), `--model <m>`, `--timeout N` (minutes), `--retries N`,
`--review`. `--review` on `loop run` runs a review pass automatically after this run's items
complete; `rauf loop review` reviews the already-`done` work without running a loop.

### Observe — what's the loop doing?

| Command                                 | Use it to…                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rauf status <root> --json`             | **The decision surface** (the recipe polls this). `DerivedStatus`: `loopState`, `health`, `lock`, `currentItem`, `backlogSummary`, `lastSignal`, `sleepUntil`.   |
| `rauf status <root>`                    | Human one-shot snapshot: state, iteration, current item, backlog counts, lock liveness, blocked/deferred breakdown.                                              |
| `rauf status <root> --follow`           | Live-refresh that snapshot (`--interval N`).                                                                                                                     |
| `rauf status --all`                     | Every live loop machine-wide (reads the active-loop registry).                                                                                                   |
| `rauf follow <root>`                    | Rich live view — replays the current run's `events.ndjson`, then tails it. File-backed; **needs no server**. Narration/diagnosis only — never the decision path. |
| `rauf log <root> [--tail N] [--follow]` | Tail the human log (`.rauf/rauf.log`).                                                                                                                           |
| `rauf progress <root>`                  | The loop's accumulated learnings (`.rauf/progress.md`).                                                                                                          |

**The stall hint lives on the poll.** rauf emits an `llm_stuck_warning` event and surfaces
the same signal on `status --json` as **`health.stuckWarning`**. Read the stall hint from
`health.stuckWarning` — **not** from `.rauf/iteration-status.json`, and never infer a stall
from `state.json`'s `updatedAt` alone.

### Exit codes & status vocabulary

`rauf status` and `rauf loop run` share **one unified exit-code scheme** — an agent that
shells out MAY branch on `$?` as a _secondary_ aid, but the four-way tree keyed on
`--json` fields is the **primary** contract. (`6` RUNNING is query-time only; a `loop run`
never terminates with it. `backlog validate` keeps its own triad: 0 valid / 1 findings / 2 usage.)

| Exit | Meaning                                                      | Status states                                                           |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `0`  | Success — clean terminal                                     | `IDLE`, `COMPLETE`, `PAUSED`, `NOT_INSTALLED`                           |
| `1`  | Error — generic failure                                      | `ERROR`                                                                 |
| `2`  | Usage — bad args / precondition (incl. loop-already-running) | —                                                                       |
| `3`  | Needs human                                                  | `PAUSED_HUMAN`                                                          |
| `4`  | Limit / usage-paused / sleeping                              | `LIMIT_REACHED`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `PAUSED_USAGE_LIMIT` |
| `5`  | Blocked — clean terminal with genuinely blocked items        | (derived from `backlogSummary`)                                         |
| `6`  | Running (query-time only)                                    | `RUNNING`, `REVIEWING`                                                  |

**Status vocabulary** (machine enum → human label; the SCREAMING_SNAKE value is the wire
form in `--json`/API). Authoritative source: `packages/core/src/state-labels.ts`.

| Machine enum         | Label                | What it means / what to do                                             |
| -------------------- | -------------------- | ---------------------------------------------------------------------- |
| `IDLE`               | Idle                 | No loop active. Start one with `loop run`.                             |
| `RUNNING`            | Running              | A loop is active. Observe with `follow`.                               |
| `REVIEWING`          | Reviewing            | A review pass is active (still "running" for exit-code purposes).      |
| `PAUSED`             | Paused               | Gracefully paused/interrupted. `resume` to continue.                   |
| `PAUSED_HUMAN`       | Needs Human          | Halted on a needs-human item. Answer it: `resume --answer <id> "..."`. |
| `PAUSED_USAGE_LIMIT` | Usage Limit (Paused) | Halted at a usage limit (no auto-sleep). `resume` once limits reset.   |
| `SLEEPING_LIMIT`     | Sleeping (Limit)     | Auto-sleeping until a usage limit resets (see `sleepUntil`).           |
| `WEEKLY_LIMIT`       | Weekly Limit         | Weekly cap hit. `resume` after it resets.                              |
| `LIMIT_REACHED`      | Limit Reached        | Iteration budget exhausted, work remains. `resume` (fresh budget).     |
| `COMPLETE`           | Complete             | All items done. Nothing to do.                                         |
| `ERROR`              | Error                | Crash / circuit-breaker halt. `reset` then re-run, or `resume`.        |
| `NOT_INSTALLED`      | Not Installed        | No `.rauf.json`. Not a rauf project.                                   |

### Machine surfaces (reference)

Two surfaces carry a **stable, versioned, additive-only** contract — parse these, never the
human renderer or `rauf.log`. Full contract: `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.

- **`rauf status … --json`** — a `DerivedStatus` snapshot (the decision surface): `loopState`,
  `health { stuckWarning, iterationFresh, lastActivityAt, secondsSinceActivity }` (`null` when
  no live iteration), `statusSchemaVersion`, `lock { stale, alive, … }`, `currentItem`,
  `lastSignal`, `sleepUntil`, and `backlogSummary { pending, inProgress, blocked, needsHuman?,
deferred?, done, total }`. **`blocked` is the TOTAL**; `needsHuman` and `deferred` are
  **disjoint subsets** — treat the three separately.
- **`rauf loop run … --ndjson`** — one JSON object per line for every `LoopEvent`, then a
  trailing `LoopResult` line (no `type` field — that absence distinguishes it). Suppresses the
  human renderer. **Ignore any `type` you don't recognize** (additive promise). Narration/diagnosis
  only — never the decision path.
- **`events.ndjson`** — the persisted per-run event log every observer reconstructs from;
  carries a `seq` + `schemaVersion` envelope. `follow` reads it; you may tail it for narration.

**Two gotchas a supervisor must handle:** (1) a `RAUF_REVIEW` shows up as
`signal_parsed.signal === "review"`, not `"done"`; (2) a circuit-breaker halt is a
`loop_error` whose `error` starts `Circuit breaker: …` — there is no `circuit_breaker` type.

**Optional live human-in-the-loop narration** (an optimization, **not** the control loop):

```
rauf loop run <root> --backlog <dir> --ndjson --pause-on-needs-human
# narrate the stream; DECISIONS still come from the status --json poll.
# on a needs_human / loop_paused decision:
rauf resume <root> --backlog <dir> --answer <id> "<the human's answer>"
```

`--pause-on-needs-human` makes the runner **halt** in `paused_human` (exit `3`) instead of
setting the item aside and continuing. `resume --answer` re-queues the item with the answer
threaded into its next prompt; the answer auto-clears when the item completes.

### Recover — the loop stopped; now what?

Pick by what the poll told you (`status` refuses with exit `2` if a live loop still holds the
lock — stop that first). Stale locks (dead PID) are cleared automatically; a `reset` is only
warranted for a confirmed-dead lock (`lock.stale && !lock.alive`).

| Situation                                                                               | Command                                                                     |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Crashed / `ERROR` / messy state; want a clean restart point                             | `rauf reset <root>` then `rauf loop run <root>`                             |
| Interrupted but resumable (`PAUSED`, `LIMIT_REACHED`, `*_LIMIT`, dead lock + work left) | `rauf resume <root>`                                                        |
| Killed mid-iteration (dirty tree, uncommitted `in_progress` item)                       | `rauf resume <root> --recover` (re-verifies + commits, then relaunches)     |
| `PAUSED_HUMAN` — a question is waiting                                                  | `rauf resume <root> --answer <id> "<answer>"`                               |
| Items wrongly `blocked` and you want them retried                                       | `rauf backlog unblock <root> [id]` (omit `id` for all), then `resume`/`run` |

What `reset` vs `resume` actually do:

- **`reset`** reconciles committed work (promotes items with a matching `[rauf] <id>:` commit
  to `done`), requeues runner false-blocks (`deferred`) to `pending`, resets stalled
  `in_progress` → `pending`, and clears `state.json`/markers. Genuine agent blocks stay
  blocked. It does **not** sweep `done` items, and it is distinct from `rauf backlog reset`
  (a full backlog-cycle sweep).
- **`resume`** does the same reconciliation **and relaunches** the loop with a fresh budget.
  Use `reset` when you want to inspect/restart yourself; `resume` when you just want it to
  continue.

(If a re-run is refused for a dirty tree or protected branch rather than a stuck loop, that's
a precondition, not a recovery case — see the §0 guards: `--create-branch`, `--seed-backlog`,
`--force`.)

## 0. Preconditions

Before driving a loop, confirm:

1. **rauf is installed in the project** — `.rauf.json` exists. If not, the project isn't
   rauf-managed (`rauf status` reports `NOT_INSTALLED`); installing/migrating is out of scope.
2. **A backlog exists** with runnable items — `rauf backlog list <root>` shows `pending`
   items. No pending items ⇒ nothing to run (author one with `author-backlog`).
3. **The working tree is in a runnable state** — `loop run` guards against a dirty tree and
   protected branches by default. Use `--create-branch <name>` to branch off in one step,
   `--seed-backlog` to commit a lone uncommitted `backlog.json`, or `--force` to skip the
   guards (last resort). A start refused for one of these guards is a **setup error, not a
   stall**.

## Targeting a non-default backlog root

By default everything operates on `<root>/.rauf/`. For a feature/multi-backlog project,
`--backlog <dir>` is the **one** way to target another root — it works on every command that
touches state (`loop run`, `status`, `follow`, `log`, `reset`, `resume`, `backlog …`). State
for that root lives under `<dir>/.rauf/` (or `<dir>` itself when it ends in `.rauf`). In a
**machine context** (`--json`/non-TTY), the explicit `<root>` + `--backlog <dir>` is
**required** — a missing/ambiguous target is a hard error, not a silent scan.

## Quick reference

- Full CLI spec (every command + flag): `docs/SPEC-CLI.md`
- Machine-surface contract (events, `DerivedStatus` incl. `health` + `statusSchemaVersion`,
  exit codes, compatibility promise, the single-poll decision contract):
  `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.2
- Status label/tone source of truth: `packages/core/src/state-labels.ts`
- Sibling skills: `author-backlog`, `review-backlog`, `review-rauf-guidance`
