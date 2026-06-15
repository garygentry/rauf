---
title: Multi-Backlog & Multi-Project
description: Target non-default backlog roots with --backlog, work across nested project roots, and find every live loop with the active-loop registry.
---

By default, every rauf command operates on a single backlog root: `<project>/.rauf/`. That's
the right model for a project with one queue of work. But feature pipelines and multi-feature
efforts keep separate backlogs per feature, and a busy machine can have several loops running
at once. This guide covers how to target a different backlog root, how independent roots coexist
in one repo, and how to find every loop running machine-wide.

## The default: `<project>/.rauf/`

Run `rauf status`, `rauf loop run`, or any `backlog …` command with no extra flags and they all
resolve to `<project>/.rauf/` — the state directory at the project root. That directory holds
everything a loop needs (backlog, state, events, logs); see
[Core Concepts](../../getting-started/core-concepts/) for what lives inside it.

## `--backlog <dir>` — target a non-default root

`--backlog <dir>` is the **one** way to point a command at a different backlog root. It's valid
on every command that touches state:

- `loop run`
- `status`
- `follow`
- `log`
- `reset`
- `resume`
- the `backlog …` commands

State for that root lives under `<dir>/.rauf/` — or under `<dir>` itself when the path already
ends in `.rauf`.

The flow is identical to the default; you just pass `--backlog` to keep the run and every
observation pinned to the same root:

```bash
# Run a loop against a feature backlog under specs/my-feature/.rauf/
rauf loop run . --backlog specs/my-feature --detached

# Observe that same root — note the matching --backlog
rauf status . --backlog specs/my-feature
rauf follow . --backlog specs/my-feature

# Tail its human log, or stop the loop
rauf log . --backlog specs/my-feature --follow
rauf loop stop .
```

:::tip[Why this exists]
Feature pipelines (such as feature-forge) and multi-feature work keep a **separate backlog per
feature** rather than one shared queue. The `author-backlog` and `review-backlog` skills also
take a target backlog directory (defaulting to `<project>/.rauf/`), so authoring, QA, running,
and observing all use the same `--backlog <dir>` convention end to end.
:::

## Nested roots in one repo

A single repository can hold its own top-level `<project>/.rauf/` **and** one or more feature
backlogs under subdirectories (for example `specs/feature-a/.rauf/` and
`specs/feature-b/.rauf/`). Each is **independent state** — its own backlog, its own loop, its
own events. Nothing is shared between them; a loop on one root never touches another.

:::caution[Empty status mid-run is almost always a root mismatch]
If `rauf status` shows an empty or idle backlog while you know a loop is running, you're almost
certainly inspecting the **wrong root**. Re-run the query against the root the loop is actually
using — `rauf status . --backlog specs/my-feature` — rather than the default `<project>/.rauf/`.
:::

## Finding every live loop: `rauf status --all`

To see every backlog root with a live loop **machine-wide** — across all projects and all nested
roots — use `rauf status --all`:

```bash
rauf status --all
```

This reads the active-loop **registry** under `~/.rauf/`. The registry is self-healed on read,
so a loop that crashed without cleaning up never lingers in the listing — a stale entry is
dropped the next time you query.

For programmatic supervision, add `--json`:

```bash
rauf status --all --json
# → { "loops": [ … ] }
```

:::note[Registry status is advisory]
`--all` is a fast, machine-wide index — treat its status as **advisory**. When you need the
authoritative state of a specific root, query it directly: `rauf status --backlog <root>` (or
`rauf status <path>` for the default root) reads that root's own state files and is the source
of truth.
:::

## Multi-project: discover every rauf-enabled project

Where `--all` enumerates live loops, the `projects` commands enumerate **projects**. They
discover and summarize every rauf-enabled project found under the configured root directory:

```bash
rauf projects list      # every rauf-enabled project under the root directory
rauf projects status    # the same set, summarized with loop/backlog state
```

To point a single invocation at a different root directory, use the global `--root <path>` flag:

```bash
rauf projects status --root ~/work
```

## See also

- [Monitoring](../monitoring/) — observing a running loop with `status`, `follow`, and `log`.
- [Core Concepts](../../getting-started/core-concepts/) — what a `.rauf/` directory holds.
- [CLI Reference](../../spec-cli/) — every command and flag, including `--backlog` and `status --all`.
