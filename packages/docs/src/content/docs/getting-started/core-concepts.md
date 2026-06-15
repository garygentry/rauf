---
title: Core Concepts
description: The backlog, items, acceptance criteria, the loop, the signal protocol, the status vocabulary, and the .rauf/ directory.
---

A handful of concepts explain everything rauf does. Learn these once and the CLI, the web
dashboard, and the machine surfaces all read the same way — because they all derive their
view from the same files on disk.

## The backlog and its items

`.rauf/backlog.json` is the **persistent task queue** — the source of truth for what work
exists. It outlives any single run and is shared across sessions: the loop reads it at the
start of every iteration to decide what to do next.

Each entry in the backlog is an **item**, one self-contained unit of work. An item carries:

- a **type** — one of `bug`, `refactor`, `feature`, or `chore`;
- a **priority**, so the loop knows what to pick first;
- a **description** of the change to make;
- **dependencies** on other items that must finish first;
- **acceptance criteria** (below).

An item also has a **status** that the runner manages as work progresses: `pending`
(waiting), `in_progress` (the loop is on it now), `done`, or `blocked`.

The quality of a run is mostly the quality of its items. Writing good ones — tightly
scoped, with verifiable criteria and honest dependencies — is its own craft; the
`author-backlog` skill exists to help you do exactly that. For the exhaustive field-by-field
shape, see the [Schemas Reference](../../schemas/).

## Acceptance criteria

Acceptance criteria are the **checks that define "done"** for an item. They are not
decoration — they are the contract the loop holds itself to. The agent works the item until
every criterion passes, runs the verification, and only then signals completion. Vague
criteria produce vague work; concrete, checkable criteria are what let the loop police its
own output.

## The loop

A run is a sequence of **iterations**. One iteration is one item, start to finish:

![One rauf iteration: select an item, build the prompt, spawn the agent, parse its signal, verify and commit, then advance.](../images/loop-lifecycle.svg)

1. **Select** the next `pending` item (respecting priority and dependencies) and mark it
   `in_progress`.
2. **Build the prompt** from the project's `RAUF.md` guidance, the item, and its acceptance
   criteria.
3. **Spawn** a fresh Claude Code session to do the work.
4. **Parse the signal** the session emits (see below).
5. **Verify and commit** — on success, the runner verifies and commits the work.
6. **Advance** to the next item, until the backlog is exhausted or the iteration budget runs
   out.

:::note[One item per iteration]
Each iteration works exactly one item. The loop does not batch unrelated changes into a
single commit — that is what keeps the history readable and recovery clean.
:::

## The signal protocol

Every iteration ends by emitting **exactly one signal**, on a line by itself. The runner
scans for it from the **end** of the session's output, so trailing summaries, log lines, or
explanations don't break detection.

| Signal                      | Meaning                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `RAUF_DONE`                 | Criteria met — the runner verifies and commits.              |
| `RAUF_BLOCKED:<reason>`     | The agent cannot proceed (e.g. a missing dependency).        |
| `RAUF_NEEDS_HUMAN:<reason>` | A human decision is required (e.g. an API key, a trade-off). |
| `RAUF_REVIEW:<json>`        | Emitted by a review pass, carrying its structured findings.  |

## The commit rule

The agent **never stages or commits** its own work. The loop runner owns the commit — after
a `RAUF_DONE` it verifies, then commits the working tree with a message of the form
`[rauf] <id>: <title>`. This single rule is what keeps the commit history clean and lets
recovery reconcile committed work against the backlog by matching that `[rauf] <id>:`
prefix.

:::caution[Don't commit from inside an iteration]
An agent that stages or commits its own work produces duplicate commits and confuses
recovery. Leave the working tree dirty and let the runner commit.
:::

## Status vocabulary

At any moment a loop has a **derived state**. The SCREAMING_SNAKE value is the machine/wire
form (what you see in `--json` output and the API); the Title-Case label is the human form.
Both come from a single source of truth: `packages/core/src/state-labels.ts`.

| Machine enum         | Label                | Meaning                                                       |
| -------------------- | -------------------- | ------------------------------------------------------------- |
| `IDLE`               | Idle                 | No loop active.                                               |
| `RUNNING`            | Running              | A loop is active.                                             |
| `REVIEWING`          | Reviewing            | A review pass is active (still "running").                    |
| `PAUSED`             | Paused               | Gracefully paused — resume to continue.                       |
| `PAUSED_HUMAN`       | Needs Human          | Halted on a needs-human item — answer with `resume --answer`. |
| `PAUSED_USAGE_LIMIT` | Usage Limit (Paused) | Halted at a usage limit (no auto-sleep).                      |
| `SLEEPING_LIMIT`     | Sleeping (Limit)     | Auto-sleeping until a usage limit resets.                     |
| `WEEKLY_LIMIT`       | Weekly Limit         | The weekly cap was reached.                                   |
| `LIMIT_REACHED`      | Limit Reached        | Iteration budget exhausted, work remains.                     |
| `COMPLETE`           | Complete             | All items done.                                               |
| `ERROR`              | Error                | A crash or circuit-breaker halt.                              |
| `NOT_INSTALLED`      | Not Installed        | Not a rauf project.                                           |

For what each state means in practice and how to recover from it, see
[Recovery & Troubleshooting](../../guides/recovery/). For the exit codes these states map to,
see the [CLI Reference](../../spec-cli/).

## The `.rauf/` directory

Everything above lives on disk under `.rauf/`. This directory is the **substrate** —
every observer (the CLI, the web dashboard, a supervising agent) reconstructs its view by
reading these files; nothing invokes a subprocess to learn what a loop is doing.

| File                    | Holds                                                  |
| ----------------------- | ------------------------------------------------------ |
| `backlog.json`          | The persistent task queue.                             |
| `state.json`            | Loop state and the current iteration.                  |
| `events.ndjson`         | The versioned event log for the current run.           |
| `iteration-status.json` | Live iteration detail — tokens, tools, stuck warnings. |
| `rauf.log`              | The human-readable log.                                |
| `progress.md`           | Learnings the loop accumulates across iterations.      |

Because these files _are_ the interface, observation is just reading them. How the live
views replay and tail them is covered in [Monitoring a Loop](../../guides/monitoring/).

## Next steps

- [Monitoring a Loop](../../guides/monitoring/) — how observers reconstruct loop activity from files.
- [Recovery & Troubleshooting](../../guides/recovery/) — what each status means and how to recover.
