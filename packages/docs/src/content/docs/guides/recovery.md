---
title: Recovery & Troubleshooting
description: Read the status, then pick reset, resume, --recover, --answer, or backlog unblock to get a stopped loop moving again.
---

When a loop stops, the first move is always `rauf status <path>`. The derived status tells you
_why_ it stopped, and that determines how you recover.

![The rauf status state machine: Running is the hub, with transitions to Reviewing, Complete, Error, Paused, Needs Human, and the limit/sleeping states, labelled with the command that drives each transition.](../images/status-states.svg)

:::note[Expanding in the content pass]
This is the scaffold for the Recovery guide. The full decision table (reset vs resume vs
`--recover` vs `--answer` vs `backlog unblock`; blocked vs needsHuman vs deferred; reading
`state.json`) lands in the content phase. The summary below is current as of v0.6.0.
:::

## The recovery moves

- **`rauf reset`** then re-run — crashed / `Error` / messy state; reconciles committed work and clears markers.
- **`rauf resume`** — `Paused`, `Limit Reached`, or a `*_LIMIT` state with work left.
- **`rauf resume --recover`** — killed mid-iteration with a dirty tree.
- **`rauf resume --answer <id> "…"`** — `Needs Human`; threads the answer into the item's next prompt.
- **`rauf backlog unblock <path> [id]`** — items wrongly blocked; requeue then resume.

## Sources

- [CLI Reference](../../spec-cli/) — exit codes, the status vocabulary, and recovery commands.
- [Monitoring a Loop](../monitoring/) — the observation surfaces you read before recovering.
