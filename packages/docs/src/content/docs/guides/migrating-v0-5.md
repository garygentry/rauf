---
title: Migrating to v0.5.0+
description: The v0.5.0 grammar flip — loop start became loop run --detached, --watch became --follow, and follow is now top-level.
---

v0.5.0 was a deliberate clean break: a single breaking release that removed the old execution and
monitoring grammar with no deprecation aliases. If you have scripts or muscle memory from before
v0.5.0, this is what changed.

![Execution modes: rauf loop run runs in-process (foreground) while rauf loop run --detached routes through the server daemon — both write the same files and are observed identically.](../images/execution-modes.svg)

:::note[Expanding in the content pass]
This is the scaffold for the Migration guide. The full before/after table and rationale land in
the content phase. The mapping below is current and authoritative as of v0.6.0.
:::

## What changed

| Removed (pre-v0.5.0) | Replacement                     |
| -------------------- | ------------------------------- |
| `loop start`         | `loop run --detached` (`-d`)    |
| `status --watch`     | `status --follow`               |
| `loop follow`        | `follow` (top-level)            |
| `loop watch`         | folded into `follow` / `status` |

## Sources

- [CLI Reference](../../spec-cli/) — the current command grammar.
- [Machine Surfaces & Contract](../../spec-backlog-tool-contract/) — the unified exit codes that
  also landed in this flip.
