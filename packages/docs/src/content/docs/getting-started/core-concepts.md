---
title: Core Concepts
description: The backlog, items, acceptance criteria, the loop, the signal protocol, the status vocabulary, and the .rauf/ directory.
---

A handful of concepts explain everything rauf does. Learn these once and the CLI, the web
dashboard, and the machine surfaces all read the same way.

![One rauf iteration: select an item, build the prompt, spawn the agent, parse its signal, verify and commit, then advance to the next item.](../images/loop-lifecycle.svg)

:::note[Expanding in the content pass]
This is the scaffold for Core Concepts. Full explanations land in the content phase; the
canonical sources are linked below and are current as of v0.6.0.
:::

## The pieces

- **Backlog** — `.rauf/backlog.json`, the persistent task queue. Author items with the
  `author-backlog` skill; the schema lives in [Schemas Reference](../../schemas/).
- **Item & acceptance criteria** — one unit of work plus the checks that define "done."
- **The loop** — pick the next item, build the prompt, spawn the agent, parse its signal,
  verify and commit, advance.
- **Signals** — an iteration ends by emitting exactly one of `RAUF_DONE`,
  `RAUF_BLOCKED:<reason>`, or `RAUF_NEEDS_HUMAN:<reason>` (plus `RAUF_REVIEW` for review passes).
- **Status vocabulary** — the derived loop state (`Running`, `Needs Human`, `Complete`, …).
  See the [status state machine](../../guides/recovery/) and the canonical table in
  [SPEC-CLI](../../spec-cli/).
- **The `.rauf/` directory** — `state.json`, `events.ndjson`, `iteration-status.json`,
  `rauf.log`, and `progress.md`: the substrate every observer reads.

## Next steps

- [Monitoring a Loop](../../guides/monitoring/) — how observers reconstruct loop activity from files.
- [Recovery & Troubleshooting](../../guides/recovery/) — what each status means and how to recover.
