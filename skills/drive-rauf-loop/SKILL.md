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

All paths default to `.` (the current project). `<path>` below is the project root that
contains `.rauf.json`.

**Start here (triage):**

- **Starting a loop fresh** → §0 preconditions, then §1.
- **A loop is running, want to watch it** → §2.
- **Supervising programmatically** (another agent/pipeline) → §4.
- **A loop stopped, paused, or blocked** → run `rauf status <path>` first, interpret with
  §3, then recover with §5.

## 0. Preconditions

Before driving a loop, confirm:

1. **rauf is installed in the project** — `.rauf.json` exists. If not, the project isn't
   rauf-managed (`rauf status` reports `NOT_INSTALLED`); installing/migrating is out of
   scope here.
2. **A backlog exists** with runnable items — `rauf backlog list <path>` shows `pending`
   items. No pending items ⇒ nothing to run (author one with `author-backlog`).
3. **The working tree is in a runnable state** — `loop run` guards against a dirty tree and
   protected branches by default. Use `--create-branch <name>` to branch off in one step,
   `--seed-backlog` to commit a lone uncommitted `backlog.json`, or `--force` to skip the
   guards (last resort).

## 1. Run — pick the execution mode

| You want…                                   | Command                            | Why                                                                                               |
| ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| To run it now and watch it (interactive)    | `rauf loop run <path>`             | Foreground, blocks, streams to the terminal. **Unattended-safe** — a `server stop` can't kill it. |
| To launch it and walk away                  | `rauf loop run <path> --detached`  | Auto-starts the server daemon, returns immediately. Observe with `follow`, stop with `loop stop`. |
| To detach but immediately watch             | `rauf loop run <path> -d --follow` | Detaches, then attaches the live view. Ctrl-C detaches the **view only** — the loop runs on.      |
| To stop a detached/server-owned loop        | `rauf loop stop <path>`            | Graceful cancel via the server. (A foreground `loop run` stops with Ctrl-C.)                      |
| To review completed work without a full run | `rauf loop review <path>`          | Spawns a review pass over `done` items; creates fix items.                                        |

**Mental model:** there is one loop verb, `run`. Bare = _I wait and watch_. `--detached` =
_it runs without me; I observe with `follow`, stop with `loop stop`_.

Common flags (see SPEC-CLI for the full list): `--iterations N` (per-run budget — resets
each run; resume to continue), `--model <m>`, `--timeout N` (minutes), `--retries N`,
`--review`. For machine supervision, see §4.

> `--review` (a flag on `loop run`) runs a review pass **automatically after this run's
> items complete**; `rauf loop review` (the standalone command above) reviews the
> already-`done` work **without** running a loop. Different triggers, same review pass.

## 2. Observe — what's the loop doing?

| Command                                 | Use it to…                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rauf status <path>`                    | One-shot snapshot: state, iteration, current item, backlog counts, lock liveness, blocked/deferred breakdown.                                                              |
| `rauf status <path> --follow`           | Live-refresh that snapshot (`--interval N`, default 2s).                                                                                                                   |
| `rauf status --all`                     | Every live loop machine-wide (reads the active-loop registry).                                                                                                             |
| `rauf follow <path>`                    | The canonical **rich live view** — replays the current run's `events.ndjson`, then tails it. File-backed; **needs no server**. Works for any run (foreground or detached). |
| `rauf log <path> [--tail N] [--follow]` | Tail the human log (`.rauf/rauf.log`).                                                                                                                                     |
| `rauf progress <path>`                  | The loop's accumulated learnings (`.rauf/progress.md`).                                                                                                                    |

**Detecting a stall:** rauf emits an `llm_stuck_warning` event (and sets `stuckWarning`
in `.rauf/iteration-status.json`) when an iteration stops making progress. Treat it as a
_hang warning, not a failure_ — surface it; only escalate (e.g. `--force` on the next run)
if it persists. Do **not** infer a stall from `state.json`'s `updatedAt` alone.

## 3. Branch on the outcome — exit codes & status vocabulary

`rauf status` and `rauf loop run` share **one unified exit-code scheme** — branch on the
code without parsing JSON. (`6` RUNNING is query-time only; a `loop run` never terminates
with it. `backlog validate` keeps its own triad: 0 valid / 1 findings / 2 usage.)

| Exit | Meaning                                                      | Status states                                                           |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `0`  | Success — clean terminal                                     | `IDLE`, `COMPLETE`, `PAUSED`, `NOT_INSTALLED`                           |
| `1`  | Error — generic failure                                      | `ERROR`                                                                 |
| `2`  | Usage — bad args / precondition (incl. loop-already-running) | —                                                                       |
| `3`  | Needs human                                                  | `PAUSED_HUMAN`                                                          |
| `4`  | Limit / usage-paused / sleeping                              | `LIMIT_REACHED`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `PAUSED_USAGE_LIMIT` |
| `5`  | Blocked — clean terminal with genuinely blocked items        | (derived from `backlogSummary`)                                         |
| `6`  | Running (query-time only)                                    | `RUNNING`, `REVIEWING`                                                  |

**Status vocabulary** (the machine enum → human label; the SCREAMING_SNAKE value is the
wire form in `--json`/API). Authoritative source: `packages/core/src/state-labels.ts`.

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

## 4. Machine surfaces (for programmatic / supervising agents)

Two surfaces carry a **stable, versioned, additive-only** contract — parse these, never
the human renderer or `rauf.log`. Full contract: `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7.

- **`rauf loop run … --ndjson`** — one JSON object per line for every `LoopEvent`, then a
  trailing `LoopResult` line (no `type` field — that absence distinguishes it). Suppresses
  the human renderer (implies `--no-color`). Key event types: `item_completed`,
  `item_blocked`, `needs_human`, `loop_paused`, `loop_completed`, `loop_error`,
  `llm_stuck_warning`. **Ignore any `type` you don't recognize** (additive promise).
- **`rauf status … --json`** — a `DerivedStatus` snapshot: `loopState`, `iteration`,
  `currentItem`, `lock`, and `backlogSummary { pending, inProgress, blocked, needsHuman?,
deferred?, done, total }`. **`blocked` is the TOTAL**; `needsHuman` (human decision) and
  `deferred` (a runner false-block) are **disjoint subsets** — treat the three separately.
- **`events.ndjson`** — the persisted per-run event log every observer reconstructs from;
  carries a `seq` + `schemaVersion` envelope. `follow` reads it; you may tail it directly.

**Two gotchas a supervisor must handle:** (1) a `RAUF_REVIEW` shows up as
`signal_parsed.signal === "review"`, not `"done"`; (2) a circuit-breaker halt is a
`loop_error` whose `error` starts `Circuit breaker: …` — there is no `circuit_breaker` type.

**Live human-in-the-loop supervisor pattern:**

```
rauf loop run . --ndjson --pause-on-needs-human
# watch the stream; on a `needs_human` / `loop_paused` event (or exit code 3):
rauf resume . --answer <id> "<the human's answer>"
```

`--pause-on-needs-human` makes the runner **halt** in `paused_human` (exit `3`) instead of
setting the item aside and continuing. `resume --answer` re-queues the item with the answer
threaded into its next prompt; the answer auto-clears when the item completes.

## 5. Recover — the loop stopped; now what?

Pick by what the `status` told you (it refuses with exit `2` if a live loop still holds the
lock — stop that first). Stale locks (dead PID) are cleared automatically.

| Situation                                                                               | Command                                                                     |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Crashed / `ERROR` / messy state; want a clean restart point                             | `rauf reset <path>` then `rauf loop run <path>`                             |
| Interrupted but resumable (`PAUSED`, `LIMIT_REACHED`, `*_LIMIT`, dead lock + work left) | `rauf resume <path>`                                                        |
| Killed mid-iteration (dirty tree, uncommitted `in_progress` item)                       | `rauf resume <path> --recover` (re-verifies + commits, then relaunches)     |
| `PAUSED_HUMAN` — a question is waiting                                                  | `rauf resume <path> --answer <id> "<answer>"`                               |
| Items wrongly `blocked` and you want them retried                                       | `rauf backlog unblock <path> [id]` (omit `id` for all), then `resume`/`run` |

What `reset` vs `resume` actually do:

- **`reset`** reconciles committed work (promotes items with a matching `[rauf] <id>:`
  commit to `done`), requeues runner false-blocks (`deferred`) to `pending`, resets stalled
  `in_progress` → `pending`, and clears `state.json`/markers. Genuine agent blocks stay
  blocked. It does **not** sweep `done` items, and it is distinct from `rauf backlog reset`
  (a full backlog-cycle sweep).
- **`resume`** does the same reconciliation **and relaunches** the loop with a fresh budget.
  Use `reset` when you want to inspect/restart yourself; `resume` when you just want it to
  continue.

(If a re-run is refused for a dirty tree or protected branch rather than a stuck loop,
that's a precondition, not a recovery case — see the §0 guards: `--create-branch`,
`--seed-backlog`, `--force`.)

## 6. Targeting a non-default backlog root

By default everything operates on `<project>/.rauf/`. For a feature/multi-backlog project,
`--backlog <dir>` is the **one** way to target another root — it works on every command that
touches state (`loop run`, `status`, `follow`, `log`, `reset`, `resume`, `backlog …`). State
for that root lives under `<dir>/.rauf/` (or `<dir>` itself when it ends in `.rauf`).

## Quick reference

- Full CLI spec (every command + flag): `docs/SPEC-CLI.md`
- Machine-surface contract (events, `DerivedStatus`, exit codes, compatibility promise):
  `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7
- Status label/tone source of truth: `packages/core/src/state-labels.ts`
- Sibling skills: `author-backlog`, `review-backlog`, `review-rauf-guidance`
