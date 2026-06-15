---
title: Customizing the Agent
description: Tune what the loop agent does — the project-specific RAUF.md section, model selection, iteration budgets, usage-limit behavior, and single-gate review.
---

The loop runner is fixed machinery: it reads the backlog, spawns a child agent session per item,
commits the result, and moves on. What the _agent_ does inside each iteration is yours to shape —
without touching the runner. This guide covers the levers: the project-specific guidance the agent
reads every iteration, which model runs an iteration, how many iterations a run gets, what happens at
provider usage limits, and where review fires.

## The project-specific `RAUF.md` section

Every installed project has a `.rauf/RAUF.md`. It holds the per-iteration contract (how to read a
task, when to emit `RAUF_DONE` / `RAUF_BLOCKED:<reason>` / `RAUF_NEEDS_HUMAN:<reason>`, the
do-not-commit rule) plus a **project-specific guidance section** the agent reads at the start of every
iteration. This is where you encode the things the agent should know about _your_ codebase:
conventions, constraints, verification commands, things to never touch.

Edit that section to steer the agent. Good additions are durable and project-shaped:

- Coding conventions the agent must follow (naming, error handling, import style).
- Hard constraints ("never edit generated files", "all writes are atomic").
- The verification command that defines "done" and how to run it.
- Pointers to the specs or modules the agent should consult before implementing.

:::tip[Keep guidance at the right altitude]
Use the `review-rauf-guidance` skill to audit this section. It checks that the guidance is correct,
non-redundant with the contract, and pitched at the right altitude — durable project rules, not
one-off task notes (those belong in the backlog item). Guidance that drifts stale or too specific
makes every iteration worse, so review it whenever the project's conventions change.
:::

The shape of `RAUF.md` (the contract half, which you generally leave alone) is documented with the
rest of the installed artifacts in [Artifact Templates](../../spec-artifacts/).

## Model selection — the cascade

Which model runs a given iteration is resolved by a four-level cascade, most specific first:

1. **`item.model`** — a model pinned on the individual backlog item.
2. **`--model` / loop options** — a model set for the whole run.
3. **Project default** — the project's configured default.
4. **Provider default** — the provider's fallback when nothing above is set.

That gives you two practical handles:

- **Per run** — set the model for an entire `loop run`:

  ```bash
  rauf loop run . --model <model>
  ```

- **Per item** — pin a model on one specific item so it always runs there, regardless of the run's
  `--model`. Set the item's `model` field with:

  ```bash
  rauf backlog edit . <id>
  ```

Because `item.model` sits at the top of the cascade, a pinned item overrides the run-level `--model`.
Use a per-item pin for the one task that needs a stronger (or cheaper) model, and `--model` for the
broad default of a run.

## Iteration budget

`--iterations N` bounds a **single** `loop run`. The counter resets to zero each time the run starts —
it is not a total across restarts. The budget is resolved in this order:

1. **`--iterations N`** on the command line.
2. **`.rauf.json`** `options.maxIterations`.
3. **Computed from the backlog** when neither is set — a `computed` value logged at startup.

When a run exhausts its budget with work still pending, the loop ends in **Limit Reached** rather than
finishing the backlog. Continue with a fresh budget:

```bash
rauf resume .
```

:::note[Budget vs. usage limit]
"Limit Reached" here means _your_ iteration budget ran out — a clean stopping point, not a provider
limit. The provider-side usage limits below are a separate thing with their own states.
:::

## Usage-limit behavior

When the provider hits a usage limit mid-run, the loop responds in one of two ways:

- **Sleeping (Limit)** — the loop auto-sleeps until the limit resets, then resumes on its own.
- **Usage Limit (Paused)** — the loop halts cleanly and waits.

In either case, once limits reset you can continue with:

```bash
rauf resume .
```

For the full set of paused/limit states and how to get a loop moving again, see
[Recovery](../recovery/).

## Single-gate review (advanced)

If a commit- or `Stop`-triggered review hook is installed globally (for example a security-review
plugin), it fires inside **every** loop child session. For autonomous dev that is the wrong altitude:
the child agent rubber-stamps its own work, multiplied across the whole backlog. The better model is
to **review once, at the gate** — over the cumulative branch diff, surfaced to a human.

Opt into that by running child sessions with those hooks suppressed:

```bash
rauf loop run . --suppress-iteration-review
```

This merges a documented set of hook-suppression environment variables (the generic env opt-out,
currently `ENABLE_CODE_SECURITY_REVIEW=0`) into every child session the loop spawns. It is a generic
mechanism, not hardcoded to one plugin, and default behavior is unchanged when the flag is absent.

Then review the accumulated work _once_, after the run:

```bash
git diff main..HEAD
```

…or open a PR (and let a review hook or CI run there), or use `rauf loop review` (below). The full
mechanism — the env map, the `childEnv` extension point — is documented in the
[CLI Reference](../../spec-cli/).

## Review passes

There are two ways to run a review pass over completed work:

- **After a run** — `rauf loop run . --review` runs a review pass once the run's items complete.
- **Standalone** — `rauf loop review .` reviews already-done items without running a full loop. It
  reads the `done` items, spawns a review session, and creates fix items for anything it finds (or
  reports no issues). Both accept `--model` to choose the review model.

  ```bash
  rauf loop review . --model <model>
  ```

This pairs naturally with single-gate review: suppress per-iteration hooks during the run, then let
`--review` or `loop review` do the one review pass at the gate.

## See also

- [Artifact Templates](../../spec-artifacts/) — the `RAUF.md` template and the rest of the installed artifacts.
- [CLI Reference](../../spec-cli/) — every flag (`--model`, `--iterations`, `--suppress-iteration-review`, `--review`) and the full single-gate mechanism.
- [Recovery](../recovery/) — paused states, usage limits, and `rauf resume`.
