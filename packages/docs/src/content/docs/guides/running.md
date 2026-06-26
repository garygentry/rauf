---
title: Running a Loop
description: The operational reference for running a rauf loop — foreground vs detached, the pre-run guards, the run-tuning flags, and stopping, resuming, and resetting.
---

This is the operational reference for **running** a loop: the two run modes, the guards that
protect your working tree, the flags that bound and tune a run, and how to stop, resume, or
reset. If you've never run a loop before, walk through [Your First
Loop](../../getting-started/your-first-loop/) first — it's the guided tutorial. This page is the
day-to-day reference you come back to.

Everything here is driven by a single command, `rauf loop run [path]`. The `[path]` argument
defaults to `.`, so from inside a project you can drop it.

## Two run modes

How you run a loop decides how you watch and stop it. Pick the mode, and the rest follows.

### Foreground — `rauf loop run [path]`

The simplest mode. The loop runs **in-process** in the terminal you're looking at, streaming
every iteration live. Because there's no background daemon, it's **unattended-safe**: a stray
`rauf loop stop` elsewhere can't terminate it, and there's no orphaned process to clean up. You
watch it; you stop it yourself with **Ctrl-C**.

```bash
rauf loop run .
```

This is the mode to start with, and the right one whenever you're actively watching.

### Detached — `rauf loop run [path] --detached`

When you don't want to babysit a terminal, run **detached** (`-d` for short). It auto-starts a
background server, kicks off the loop, and returns immediately. Because the loop is server-owned,
you observe and stop it with separate commands:

```bash
rauf loop run . --detached
rauf follow .          # watch the live view
rauf loop stop .       # halt the running loop (the detached equivalent of Ctrl-C)
```

To detach and immediately attach the live view in one step, combine the flags:

```bash
rauf loop run . --detached --follow
```

:::tip[Foreground or detached?]
Use **foreground** when you're watching the run happen — it's the safest default. Use
**detached** for long, unattended runs you'll check on later with `rauf follow` and stop with
`rauf loop stop`. Either way the loop writes the same files, so monitoring is identical (see
[Monitoring a Loop](../monitoring/)).
:::

## The pre-run guards

By default `rauf loop run` refuses to start when it would be unsafe — it guards against a **dirty
working tree** and against running on a **protected branch**, so a loop can't quietly scribble
over uncommitted work. When a guard trips, you have three escape hatches:

- **`--create-branch <name>`** — branch off in one step, then run there. Keeps your uncommitted
  work intact and gives the loop a clean place to commit into.
- **`--seed-backlog`** — commit a lone uncommitted `backlog.json` (useful right after authoring
  the backlog, when that's the only change in the tree).
- **`--force`** — skip the guards entirely. A last resort; you own the consequences.

:::caution[The guards are there for a reason]
Prefer `--create-branch` over `--force` when the tree is dirty. Branching preserves your work and
gives the loop a clean commit target. Reach for `--force` only when you understand exactly what
state the tree is in.
:::

## Tuning a run

A bare `rauf loop run` is right most of the time. These flags bound or tune a particular run:

- **`--iterations N`** — cap how many items this run processes, then stop. Without it, the loop
  runs until the backlog has no more runnable items.
- **`--model <m>`** — override the agent model for this run. (Model selection has a full
  precedence order; see [Customizing the Agent](../customizing-agent/).)
- **`--timeout N`** — per-iteration timeout in minutes.
- **`--retries N`** — how many times to retry an iteration before giving up on it.
- **`--review`** — run a review pass over completed work.

## Stop, resume, reset

A loop leaves its state on disk, so stopping is never destructive — you can always pick up later.

- **Stop.** In a foreground run, **Ctrl-C** stops the loop gracefully; it finishes cleanly and
  persists its state. For a detached run, `rauf loop stop [path]` does the same.
- **Resume.** `rauf resume [path]` reconciles state and relaunches the loop with a fresh
  iteration budget, carrying on through the remaining pending items.
- **Reset.** `rauf reset [path]` throws away the current loop state for a clean restart — use it
  when something is in a confused state and you'd rather begin again than resume.

```bash
rauf resume .    # continue from where you stopped
rauf reset .     # clear loop state and start fresh
```

:::note[The runner owns the commit]
However you run it, the rule is the same: the **agent never commits**. The runner verifies each
iteration's result and, on success, makes one commit shaped `[rauf] <id>: <title>` — one item,
one commit. That's what keeps history clean and every item independently revertable.
:::

## Next steps

- [Monitoring a Loop](../monitoring/) — every way to watch a running loop, including the
  machine-readable surfaces.
- [Recovery & Troubleshooting](../recovery/) — when a loop stops paused, blocked, or errored,
  how to read the state and pick the right resume path.
- [Customizing the Agent](../customizing-agent/) — model selection precedence, iteration budgets,
  usage limits, and review gates.
- [CLI Reference](../../spec-cli/) — every command and flag in full.
