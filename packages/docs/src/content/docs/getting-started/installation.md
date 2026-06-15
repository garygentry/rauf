---
title: Installation
description: Install the rauf CLI, verify it, and get a project ready to run its first loop.
---

Rauf is a CLI (plus an optional web dashboard) that installs and drives autonomous coding
loops in your existing projects. This page covers prerequisites, installing the binary,
verifying it, and the common first-run snags.

:::note[Expanding in the content pass]
This is the scaffold for the Installation guide. The full step-by-step (binary one-liner,
`rauf version` check, macOS Gatekeeper note, and troubleshooting) lands in the content phase.
For now, the [project README](https://github.com/garygentry/rauf#readme) has the working
install steps.
:::

## What you'll need

- **Claude Code** — rauf spawns a Claude Code session for each loop iteration.
- **git** — every iteration's work is committed by the runner.
- **Bun** — only required if you build the CLI from source (see the README).

## Next steps

- [Your First Loop](../your-first-loop/) — run an end-to-end loop and read its output.
- [Core Concepts](../core-concepts/) — the backlog, the loop, signals, and status vocabulary.
