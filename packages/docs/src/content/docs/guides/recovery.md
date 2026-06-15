---
title: Recovery & Troubleshooting
description: Read the status, then pick reset, resume, --recover, --answer, or backlog unblock to get a stopped loop moving again.
---

When a loop stops, the first move is always `rauf status <path>`. The derived status tells you
_why_ it stopped, and that determines how you recover. This page is a runbook: read the status,
match it to a row in the decision table, run the one command for that row.

![The rauf status state machine: Running is the hub, with transitions to Reviewing, Complete, Error, Paused, Needs Human, and the limit/sleeping states, labelled with the command that drives each transition.](../images/status-states.svg)

## Triage — read the status first

Always start with a status snapshot for the project root:

```bash
rauf status <path>
```

It reports the derived state, the iteration, the current item, the backlog counts, and whether
a lock is held. The state is what you branch on.

:::caution[A live loop blocks recovery]
`reset` and `resume` refuse with **exit `2`** if a live loop still holds the lock — stop that loop
first (`rauf loop stop <path>`, or Ctrl-C a foreground `rauf loop run`). A **stale** lock whose PID
is dead is cleared automatically, so you don't need to clean those up by hand.
:::

For a non-default backlog root (feature/multi-backlog projects), add `--backlog <dir>` — it works
on every command that touches state. For the full observation surface (the rich live view, the log,
accumulated progress), see [Monitoring a Loop](../monitoring/).

## Status → exit code

`rauf status` exits with a code you can branch on without parsing JSON. The same scheme is shared
with `rauf loop run` (exit `6` is query-time only — a `loop run` never terminates with it).

| Exit | Meaning                                                        | Status states                                                           |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `0`  | Success — clean terminal                                       | `IDLE`, `COMPLETE`, `PAUSED`, `NOT_INSTALLED`                           |
| `1`  | Error — generic failure                                        | `ERROR`                                                                 |
| `2`  | Usage — bad args / precondition (incl. a loop already running) | —                                                                       |
| `3`  | Needs human                                                    | `PAUSED_HUMAN`                                                          |
| `4`  | Limit / usage-paused / sleeping                                | `LIMIT_REACHED`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `PAUSED_USAGE_LIMIT` |
| `5`  | Blocked — clean terminal, genuinely blocked items              | (derived from `backlogSummary`)                                         |
| `6`  | Running (query-time only)                                      | `RUNNING`, `REVIEWING`                                                  |

The status labels you'll see: `IDLE` Idle · `RUNNING` Running · `REVIEWING` Reviewing ·
`PAUSED` Paused · `PAUSED_HUMAN` Needs Human · `PAUSED_USAGE_LIMIT` Usage Limit (Paused) ·
`SLEEPING_LIMIT` Sleeping (Limit) · `WEEKLY_LIMIT` Weekly Limit · `LIMIT_REACHED` Limit Reached ·
`COMPLETE` Complete · `ERROR` Error · `NOT_INSTALLED` Not Installed.

## The recovery decision table

Pick the row that matches what `status` told you, and run the one command.

| Situation                                                                                       | Command                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Crashed / `Error` / messy state; want a clean restart                                           | `rauf reset <path>` then `rauf loop run <path>`                             |
| Interrupted but resumable (`Paused`, `Limit Reached`, a `*_LIMIT` state, dead lock + work left) | `rauf resume <path>`                                                        |
| Killed mid-iteration (dirty tree, uncommitted `in_progress` item)                               | `rauf resume <path> --recover` (re-verifies + commits, then relaunches)     |
| `Needs Human` — a question is waiting                                                           | `rauf resume <path> --answer <id> "<answer>"`                               |
| Items wrongly `blocked` and you want them retried                                               | `rauf backlog unblock <path> [id]` (omit `id` for all), then `resume`/`run` |

`--answer` is repeatable (one per pending question), and the threaded answer auto-clears once the
item completes. `--iterations N` overrides the per-run budget on `resume`. See
[CLI Reference](../../spec-cli/) for every flag.

## reset vs resume

Both **reconcile** the same way; only `resume` also relaunches.

- **`rauf reset <path>`** reconciles committed work — it promotes any item with a matching
  `[rauf] <id>:` commit to `done`, requeues runner false-blocks (`deferred`) to `pending`, and
  resets stalled `in_progress` items → `pending` — then clears `state.json` and the loop markers.
  Genuine agent blocks **stay** blocked, and it does **not** sweep `done` items. Use it when you
  want to inspect or restart the loop yourself.
- **`rauf resume <path>`** does the **same reconciliation and then relaunches** the loop with a
  fresh iteration budget. Use it when you just want the loop to continue.

:::note[Two different "reset" commands]
`rauf reset` (above) clears loop state and reconciles. `rauf backlog reset` is a **different**
command — a full backlog-cycle sweep. Don't reach for `backlog reset` when you mean to clear a
wedged loop.
:::

## blocked vs needsHuman vs deferred

In `rauf status --json`, the `backlogSummary` carries three block-related counts, and they don't
mean the same thing — treat them separately:

- **`blocked`** is the **TOTAL** of all blocked items.
- **`needsHuman`** is a **disjoint subset**: items waiting on a genuine human decision (answer with
  `resume --answer <id> "..."`).
- **`deferred`** is a **disjoint subset**: a runner false-block (for example, an item set aside after
  a usage limit). `reset` and `resume` **auto-requeue** `deferred` items as part of reconciliation —
  you don't unblock these by hand.

The remainder (`blocked` minus `needsHuman` minus `deferred`) are genuine agent blocks. Those are the
ones you requeue with `rauf backlog unblock <path> [id]` when you want them retried.

## What `state.json` holds

When you need to inspect why a loop is where it is, `state.json` is the raw record: the current
status, the iteration count, the current item, the `lastSignal`, and timestamps. The derived status
you read from `rauf status` is computed from this plus the backlog — prefer reading `rauf status`
(or `--json`) over the raw file, but it's there when you need the underlying values.

## Recovering from the web

The dashboard exposes the same recovery actions as the CLI, so you can recover without dropping to a
terminal. The server binds `127.0.0.1:5173`, and every **mutating** `POST` needs the header
`X-Rauf-Request: true`. As on the CLI, a live loop yields **`409 LOCK_CONFLICT`** — stop it first.

| Action                              | CLI                       | Web                                                              |
| ----------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| Reset state                         | `rauf reset .`            | `POST /api/projects/:id/reset`                                   |
| Resume (reconcile + relaunch)       | `rauf resume .`           | `POST /api/projects/:id/resume`                                  |
| Re-verify + commit interrupted work | `rauf resume . --recover` | **CLI-only** (the web `resume` tells you when it's needed)       |
| Review pass                         | `rauf loop review .`      | `POST /api/projects/:id/loop/review`                             |
| Unblock items                       | `rauf backlog unblock .`  | `POST /api/projects/:id/backlog/unblock`                         |
| Validate backlog                    | `rauf backlog validate .` | `GET /api/projects/:id/backlog/validate` (read-only — no header) |

The web `resume` reconciles and relaunches exactly like the CLI, but it will **not** auto-commit
interrupted, uncommitted work; when it detects that, it returns a reason telling you to run
`rauf resume --recover` from the CLI. See [Web Dashboard](../web-dashboard/) for the full surface.

## Sources

- [Monitoring a Loop](../monitoring/) — read the status before you recover.
- [CLI Reference](../../spec-cli/) — exit codes, the status vocabulary, and every recovery flag.
- [Backlog Tool Contract](../../spec-backlog-tool-contract/) — the `DerivedStatus` and `backlogSummary` machine surface.
