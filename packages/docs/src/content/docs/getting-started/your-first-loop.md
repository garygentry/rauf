---
title: Your First Loop
description: Install rauf into a project, add a backlog item, run a loop, watch it, and interpret the result.
---

The fastest way to understand rauf is to run one loop end to end. You add a work item, start
the loop in your terminal, watch a single iteration happen, read the signal it emits, and then
stop or resume it. Every iteration follows the same shape, so once you have seen one you have
seen them all.

![One rauf iteration: select an item, build the prompt, spawn the agent, parse its signal, verify and commit, then advance.](../images/loop-lifecycle.svg)

This page is a guided walkthrough. We use `~/workspace/my-project` as the example project root
throughout — substitute your own path. (The path argument defaults to `.`, so if you run these
commands from inside the project you can drop it.)

## Before you start

A loop needs three things in place:

1. **rauf is installed in the project.** A `.rauf.json` file at the project root marks it as
   rauf-managed. If it is missing, the project isn't set up yet — see
   [Installation](../installation/).
2. **The backlog has at least one pending item.** The loop reads the backlog to decide what to
   work on; with nothing pending there is nothing to run. We add one in Step 1.
3. **The working tree is in a runnable state.** By default `rauf loop run` guards against a
   dirty tree and against running on a protected branch, so a loop can't quietly scribble over
   uncommitted work. You have three escape hatches:
   - `--create-branch <name>` — branch off in one step, then run there.
   - `--seed-backlog` — commit a lone uncommitted `backlog.json` (useful right after authoring).
   - `--force` — skip the guards entirely. A last resort; you own the consequences.

:::caution[The guards are there for a reason]
Prefer `--create-branch` over `--force` when the tree is dirty. Branching keeps your
uncommitted work intact and gives the loop a clean place to commit into. Reach for `--force`
only when you understand exactly what state the tree is in.
:::

## Step 1 — Add a work item

A backlog item is a single, self-contained unit of work. The most important field is its
**acceptance criteria**: each `--ac` flag adds one criterion, and together they define what
"done" means for that item. The agent reads them, works until they all pass, and the loop uses
them to judge the result.

```bash
rauf backlog add ~/workspace/my-project \
  --title "Add a --version flag to the CLI" \
  --type feature \
  --ac "Running 'mycli --version' prints the version from package.json" \
  --ac "The version string matches the installed package exactly" \
  --ac "Existing tests still pass"
```

`--title` and `--type` (`bug`, `refactor`, `feature`, or `chore`) are required. `--ac` is
repeatable — add one per criterion. There are more fields available (`--priority`,
`--description`, `--notes`, `--depends-on`, `--estimated-iterations`), but a title, a type, and
a few sharp acceptance criteria are enough for your first item.

:::tip[Write items the loop can actually finish]
The single biggest factor in a successful loop is item quality: well-scoped work with
verifiable, unambiguous acceptance criteria. The **author-backlog** skill exists specifically
to help you write items that an autonomous agent can complete and a loop can verify. Lean on it
when you move past this first toy item.
:::

## Step 2 — Run it in the foreground

The simplest way to run a loop is in the foreground — it blocks your terminal and streams
everything to you live:

```bash
rauf loop run ~/workspace/my-project
```

This is the mode to start with. It runs in-process: the loop is the terminal you are looking
at. That makes it **unattended-safe** — there is no background daemon to accidentally kill, so a
stray `rauf loop stop` elsewhere can't terminate it. You watch it, and you stop it yourself with
Ctrl-C when you want to.

If you want to bound the run, `--iterations N` caps how many items it processes this run.
Other flags you'll meet later include `--model <m>`, `--timeout N` (minutes), `--retries N`, and
`--review`. For now, bare `rauf loop run` is exactly right.

## Step 3 — What one iteration does

While it runs, here's the loop walking through a single iteration — the cycle in the diagram
above:

1. **Select the next pending item** from the backlog (respecting priority and dependencies).
2. **Build the prompt** from three sources: the project's `RAUF.md` instructions, the item
   itself, and its acceptance criteria.
3. **Spawn a Claude Code session** with that prompt. This is the agent that does the work —
   reading code, editing files, running tests.
4. **The agent works and emits a signal** on its final line saying how it went (see Step 4).
5. **The runner verifies and commits.** This is the key rule: the **agent never commits**. The
   runner inspects the result and, on success, stages everything and makes one commit shaped
   `[rauf] <id>: <title>`. One item, one commit.
6. **Advance** to the next pending item and repeat.

That separation — agent does the work, runner owns the commit — is what makes the history clean
and each item independently revertable.

## Step 4 — The three signals

Every iteration ends with the agent emitting exactly one signal, alone on its final line. It
tells the runner what to do next:

- **`RAUF_DONE`** — the acceptance criteria pass. The runner commits the work and moves on.
- **`RAUF_BLOCKED:<reason>`** — the agent cannot proceed (a missing dependency, a broken
  precondition). The item is set aside; the loop continues with others.
- **`RAUF_NEEDS_HUMAN:<reason>`** — the work needs a human decision (an API key, a design call,
  an ambiguous requirement). This is a deliberate stop for you, not a failure.

(There is a fourth, `RAUF_REVIEW`, used only during review passes — you won't see it on a normal
run.) When you read the stream or the status, these signals are how you know what happened and
whether the loop needs you.

## Step 5 — Watch it

You don't have to read the raw stream to follow along. Two commands give you a clear view:

```bash
rauf follow ~/workspace/my-project
```

`rauf follow` is the canonical **live view**. It replays the current run's events and then tails
them, showing iterations, signals, and commits as they happen. It is file-backed — it reads the
run's event log directly — so it **needs no server** and works whether the loop is running in
your foreground terminal or detached.

For a one-shot picture instead of a live feed, ask for a snapshot:

```bash
rauf status ~/workspace/my-project
```

`rauf status` prints the current state, iteration, the item being worked on, and backlog counts,
then exits. Add `--follow` (or `-f`) to keep it refreshing.

:::tip[Pick the right lens]
Use `rauf follow` while a loop is actively running — it's the rich, scrolling view. Use
`rauf status` to answer "where does this stand right now?" at a glance.
:::

For the full set of observation surfaces — `status`, `follow`, the human log, and the
machine-readable outputs — see [Monitoring a Loop](../../guides/monitoring/).

## Step 6 — Stop and resume

In a foreground run, **Ctrl-C** stops the loop gracefully. It finishes cleanly and leaves its
state on disk so you can pick up later.

To continue from where you stopped:

```bash
rauf resume ~/workspace/my-project
```

`resume` reconciles state and relaunches the loop with a fresh iteration budget, carrying on
through the remaining pending items.

To throw away the current loop state and start fresh instead:

```bash
rauf reset ~/workspace/my-project
```

`reset` clears the loop's state for a clean restart — use it when something is in a confused
state and you'd rather begin again than resume.

## Running it without you (detached)

When you don't want to babysit a terminal, run the loop **detached**. It auto-starts a
background server, kicks off the loop, and returns immediately:

```bash
rauf loop run ~/workspace/my-project --detached
```

(`-d` is the short form.) Because it's detached, you observe and stop it with separate commands:

```bash
rauf follow ~/workspace/my-project   # watch the live view
rauf loop stop ~/workspace/my-project   # stop the running loop
```

`rauf loop stop` is how you halt a detached, server-owned loop — the detached equivalent of
Ctrl-C. (You can also pass `--follow` together with `--detached` to detach and immediately
attach the live view in one go.)

## Next steps

- [Core Concepts](../core-concepts/) — what a backlog item, a signal, and a status mean, and how
  they fit together.
- [Monitoring a Loop](../../guides/monitoring/) — every way to watch a loop, including the
  machine-readable surfaces.
- [CLI Reference](../../spec-cli/) — every command and flag in full.
