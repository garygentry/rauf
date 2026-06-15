---
title: Scripting & CI
description: Drive rauf headlessly — exit codes, --json/--ndjson, and the pause-on-needs-human supervisor pattern.
---

Rauf is built to be supervised by another program — a CI step, a wrapper script, or a
supervising agent. The contract is simple: **branch on exit codes** without parsing any
output, and when you do need detail, **parse the machine surfaces** (`--json`, `--ndjson`,
`events.ndjson`). Never scrape the human renderer, and never parse `rauf.log` — those are
for people, not pipelines.

![The observation substrate: a loop runner appends to state.json, events.ndjson, iteration-status.json, and rauf.log; the CLI, web dashboard, and external pipelines all reconstruct their view by reading those files.](../images/observation-model.svg)

The diagram above is the whole reason this works: the loop runner only ever **appends** to a
handful of files. The CLI, the web dashboard, and your pipeline are all just readers of those
same files. You are a first-class observer — you reconstruct your view the same way every
built-in surface does.

## Branch on exit codes

`rauf status` and `rauf loop run` share **one unified exit-code scheme**. Branch on `$?`
without touching stdout — the code alone tells you what happened.

| Exit | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| `0`  | Success — clean terminal                                     |
| `1`  | Error — generic failure                                      |
| `2`  | Usage — bad args / precondition (incl. loop-already-running) |
| `3`  | Needs human                                                  |
| `4`  | Limit / usage-paused / sleeping                              |
| `5`  | Blocked — clean terminal with genuinely blocked items        |
| `6`  | Running (query-time only — `status`)                         |

:::note[Exit 6 is query-time only]
`6` is reported by `rauf status` when a loop is currently running. A `rauf loop run` invocation
**never** terminates with `6` — by the time it returns, the run is over, so its outcome is one of
`0`–`5`.
:::

A supervising script branches like this:

```bash
rauf loop run . --ndjson
case "$?" in
  0) echo "done — clean terminal" ;;
  1) echo "error — inspect and retry"; exit 1 ;;
  2) echo "usage error — bad args or loop already running"; exit 2 ;;
  3) echo "needs human — answer the open question" ;;
  4) echo "limit / usage-paused / sleeping — resume after reset" ;;
  5) echo "blocked — items are genuinely stuck" ;;
  *) echo "unexpected exit $?"; exit 1 ;;
esac
```

:::caution[`backlog validate` keeps its own triad]
`rauf backlog validate` does **not** use the unified scheme. It has its own three codes:
`0` valid · `1` findings · `2` usage. Branch on it separately — don't fold it into the table
above.

```bash
rauf backlog validate . --json
case "$?" in
  0) echo "backlog valid" ;;
  1) echo "validation findings — see --json output" ;;
  2) echo "usage error" ;;
esac
```

:::

## Machine surfaces

Two surfaces carry a **stable, versioned, additive-only** contract. Parse these — never the
human renderer or `rauf.log`. The versioned definitions live in the
[Backlog-Tool Contract](../../spec-backlog-tool-contract/) (§A.7).

### `loop run … --ndjson`

Adds `--ndjson` to a run to emit **one JSON object per line** for every `LoopEvent`, followed by
a single trailing `LoopResult` line. The result line has **no `type` field** — that absence is
how you distinguish it from events. Passing `--ndjson` suppresses the human renderer (it implies
`--no-color`), so the stream is clean for parsing.

Key event types to handle:

- `item_completed`
- `item_blocked`
- `needs_human`
- `loop_paused`
- `loop_completed`
- `loop_error`
- `llm_stuck_warning`

:::tip[Ignore unrecognized types]
The contract is additive-only: new event types may appear in future versions. **Ignore any
`type` you don't recognize** rather than erroring — that's the whole point of the additive
promise, and it keeps your supervisor forward-compatible.
:::

### `status … --json`

`rauf status --json` emits a `DerivedStatus` snapshot — a point-in-time view reconstructed from
the substrate. It carries:

- `loopState`
- `iteration`
- `currentItem`
- `lock`
- `backlogSummary { pending, inProgress, blocked, needsHuman?, deferred?, done, total }`

One subtlety in `backlogSummary`: **`blocked` is the TOTAL**. `needsHuman` and `deferred` are
**disjoint subsets** of that total — they count items already included in `blocked`, not items in
addition to it. Treat the three separately and don't sum them.

### `events.ndjson`

`events.ndjson` is the **persisted per-run event log** that every observer reconstructs from. It
carries a `seq` + `schemaVersion` envelope on each line. The `follow` command reads it, the web
dashboard reads it, and **you may tail it directly** — it's the canonical record, not a
side-effect.

### Two gotchas a supervisor must handle

1. A `RAUF_REVIEW` signal surfaces as `signal_parsed.signal === "review"` — **not** `"done"`.
   If you're matching on the signal, account for `"review"` as a distinct, valid terminal.
2. A circuit-breaker halt is a `loop_error` whose `error` string **starts with**
   `Circuit breaker: …`. There is **no** dedicated `circuit_breaker` event type — match on the
   `loop_error` + the error prefix.

## The human-in-the-loop supervisor pattern

When an item needs a human decision (an API key, a design call, a missing requirement), the
default behavior is to set the item aside and keep going. For a supervised run you usually want
the opposite — **halt and ask**. That's what `--pause-on-needs-human` is for:

```bash
rauf loop run . --ndjson --pause-on-needs-human
# on a needs_human / loop_paused event (or exit code 3):
rauf resume . --answer <id> "<the human's answer>"
```

How it fits together:

- `--pause-on-needs-human` makes the runner **halt** in `paused_human` (exit code `3`) instead of
  setting the item aside and continuing. Your supervisor sees the `needs_human` / `loop_paused`
  event on the stream (or simply the exit code `3`) and stops to collect an answer.
- `resume --answer <id> "<text>"` re-queues that item with the answer **threaded into its next
  prompt**, so the loop picks up exactly where it stalled. The flag is repeatable — answer several
  open items in one `resume`.
- The threaded answer **auto-clears** when the item completes, so a stale answer never leaks into
  a later iteration.

## Headless notes

Almost everything is **file-backed** and works with no server running — `follow`, `status`, and
`log` all read the substrate directly. Only two operations require the server:

- `loop run --detached` (`-d`) — runs the loop as a background daemon. `--detached` **auto-starts
  the server daemon** for you.
- `loop stop` — signals that running daemon to stop.

So in CI, a plain `rauf loop run . --ndjson` needs nothing extra: it runs in the foreground,
streams NDJSON, and returns a unified exit code. Reach for `--detached` only when you want the run
to outlive the invoking process.

## Sources

- [Backlog-Tool Contract](../../spec-backlog-tool-contract/) — the versioned `LoopEvent` /
  `LoopResult` / `DerivedStatus` definitions, exit codes, and the additive-only compatibility
  promise (§A.7).
- [CLI Reference](../../spec-cli/) — every flag and the unified exit-code scheme.
- [Recovery](../recovery/) — what to do when a run stops in `error`, `blocked`, or a limit state.
- [Monitoring](../monitoring/) — observing a live run with `follow`, `status`, and the dashboard.
