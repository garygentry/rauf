---
title: Monitoring a Loop
description: Watch a running loop with status, follow, log, and progress — and the JSON/NDJSON machine surfaces underneath.
---

Every way to watch a rauf loop reconstructs its view from the **same files on disk**. The loop
runner appends to `state.json`, `events.ndjson`, `iteration-status.json`, and `rauf.log`; the
CLI, the web dashboard, and any external pipeline read those files back. No observer owns the
runner.

Two consequences fall out of that principle:

- **Foreground and detached runs are observed identically.** `rauf loop run` (foreground) and
  `rauf loop run --detached` write the same files the same way, so `status`, `follow`, and `log`
  behave the same against either.
- **No server is needed to read.** Every monitoring command below is file-backed. The web
  dashboard reads the same files (see [Web Dashboard](../web-dashboard/)); only launching a
  detached run or stopping it needs the server.

![The observation substrate: a loop runner appends to state.json, events.ndjson, iteration-status.json, and rauf.log; the CLI, web dashboard, and external pipelines all reconstruct their view by reading those files.](../images/observation-model.svg)

## The commands

### `rauf status [path]`

A one-shot snapshot of the loop at `[path]` (default `.`): loop state, iteration, current item,
backlog counts, lock liveness, and the blocked/deferred breakdown. It derives everything from
`state.json` + `iteration-status.json` — it never spawns a subprocess.

```bash
rauf status .
rauf status . --follow          # or -f: re-render on an interval until Ctrl+C
rauf status . --interval 5 -f   # poll every 5s under --follow (default 2s)
rauf status . --json            # emit the DerivedStatus object
rauf status . --backlog specs/feature-x   # a non-default backlog root
rauf status --all               # every live loop on the machine (see below)
```

Exit codes mirror the loop state, so a script can branch on `rauf status` without parsing JSON:
`0` for a clean terminal state (`IDLE`, `COMPLETE`, `PAUSED`, `NOT_INSTALLED`), `1` for `ERROR`,
`3` for needs-human, `4` for a usage/iteration limit, `5` for genuinely blocked items, and `6`
while a loop is `RUNNING`/`REVIEWING`.

### `rauf follow [path]`

The canonical rich live view. It replays the current run's `events.ndjson`, then tails it for new
events as they land. **File-backed** — it needs no server, and works against a foreground or a
detached run.

```bash
rauf follow .
rauf follow . --json            # emit events as NDJSON, one per line
rauf follow . --interval 2      # terminal-state poll interval (seconds)
rauf follow . --backlog specs/feature-x
```

`follow` tracks the **current run only**. Prior runs are rotated to `archive/` at the start of
each run, and `follow` never stitches them back in. It runs until the loop reaches a terminal
state or you press Ctrl+C.

### `rauf log [path]`

Tail the human log file `.rauf/rauf.log`.

```bash
rauf log .
rauf log . --tail 50            # last N lines (default 20)
rauf log . --follow             # or -f: tail -f behavior
```

### `rauf progress [path]`

Show the loop's accumulated learnings (`.rauf/progress.md`) — notes the loop appends as it
discovers project-specific patterns across iterations.

```bash
rauf progress .
rauf progress . --json
```

### `rauf status --all`

List every backlog root with a live loop, machine-wide, from the active-loop registry.

```bash
rauf status --all
rauf status --all --json
```

:::caution[Registry status is advisory]
The status shown by `status --all` is a last-known, advisory value from the registry. For the
authoritative status of one root, run `rauf status --backlog <root>`, which reads that root's
`state.json` directly.
:::

## Machine surfaces

Three surfaces are meant for programmatic observers — parse these, never the human renderer or
`rauf.log`. They carry a stable, versioned, additive-only contract; see
[Backlog-Tool Contract](../../spec-backlog-tool-contract/) for the full schema and compatibility
promise.

- **`rauf status --json`** — a `DerivedStatus` snapshot, including `backlogSummary`.
- **`rauf loop run [path] --ndjson`** — one JSON object per line for every `LoopEvent`, followed
  by a trailing `LoopResult` line. Suppresses the human renderer.
- **`events.ndjson`** — the persisted per-run event log that every observer reconstructs from.
  Each line carries a `seq` and `schemaVersion`. It holds the **current run only**; you may tail
  it directly.

:::note[Reading backlogSummary correctly]
In `backlogSummary`, `blocked` is the **total** count of blocked items. `needsHuman` (awaiting a
human decision) and `deferred` (a runner false-block) are **disjoint subsets** of that total —
treat the three separately rather than adding them up.
:::

## Detecting a stall

When an iteration stops making progress, rauf emits an `llm_stuck_warning` event and sets
`stuckWarning` in `iteration-status.json`. Treat this as a **hang warning, not a failure** —
surface it and keep watching; only escalate if it persists.

:::caution[Don't infer a stall from `updatedAt`]
Do not decide a loop is stuck by reading `state.json`'s `updatedAt` and noticing it hasn't moved.
A long-but-healthy iteration looks the same. The `llm_stuck_warning` event and `stuckWarning`
field are the signal; `updatedAt` alone is not.
:::

## Empty is never silent

If the inspected root has no loop state, `status` does not just shrug. It names the directory it
looked at, and if a loop is live in a different root, it names that root too. An "empty" status
mid-run is almost always a `--backlog` mismatch — you're pointed at the wrong root. Re-run with
the right `--backlog <dir>`, or use `rauf status --all` to find where the live loop actually is.

## Choosing a surface

| You want…                            | Use                                                                |
| ------------------------------------ | ------------------------------------------------------------------ |
| A quick snapshot of one loop         | `rauf status .`                                                    |
| To watch one loop live in a terminal | `rauf follow .`                                                    |
| Just the human log                   | `rauf log . -f`                                                    |
| Everything running on the machine    | `rauf status --all`                                                |
| A programmatic observer              | `rauf status --json`, `loop run --ndjson`, or tail `events.ndjson` |

When monitoring shows the loop has stopped — paused, blocked, errored, or sleeping on a limit —
head to [Recovery](../recovery/) to interpret the state and pick the right resume path.
