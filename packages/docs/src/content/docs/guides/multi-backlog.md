---
title: Multi-Backlog & Multi-Project
description: Target non-default backlog roots with --backlog, work across nested project roots, and find every live loop with the active-loop registry.
---

By default every command operates on `<project>/.rauf/`. Feature pipelines and multi-root setups
need to target a different backlog root and to discover loops running elsewhere on the machine.

:::note[Expanding in the content pass]
This is the scaffold for the Multi-Backlog guide. The full walkthrough (`--backlog <dir>`, nested
roots, the `~/.rauf/` active-loop registry, and `status --all`) lands in the content phase. The
summary below is current as of v0.6.0.
:::

## The essentials

- **`--backlog <dir>`** is the _one_ way to target a non-default backlog root. It works on every
  command that touches state (`loop run`, `status`, `follow`, `log`, `reset`, `resume`, `backlog …`).
  State lives under `<dir>/.rauf/` (or `<dir>` itself when it ends in `.rauf`).
- **`rauf status --all`** lists every backlog root with a live loop, machine-wide, by reading the
  active-loop registry.

## Sources

- [CLI Reference](../../spec-cli/) — `--backlog` and `status --all`.
- [Core Concepts](../../getting-started/core-concepts/) — what lives in a `.rauf/` directory.
