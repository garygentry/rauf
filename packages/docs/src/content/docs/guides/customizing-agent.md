---
title: Customizing the Agent
description: Tune what the loop agent does — the project-specific RAUF.md section, model selection, and iteration budgets.
---

Each project's installed `.rauf/RAUF.md` holds the per-iteration contract for the agent. You can
shape its behavior without touching the runner: add project-specific guidance, pick a model, and
set iteration budgets.

:::note[Expanding in the content pass]
This is the scaffold for the Customizing the Agent guide. The full walkthrough (the RAUF.md
project-specific section, the per-item / per-project / `--model` cascade, iteration budgets, and
usage-limit behavior) lands in the content phase. The summary below is current as of v0.6.0.
:::

## The levers

- **`RAUF.md` project-specific section** — guidance the agent reads every iteration. Use the
  `review-rauf-guidance` skill to keep it correct.
- **Model cascade** — `item.model` > `--model` / options > project default > provider default.
- **Iteration budget** — `--iterations N` caps a run; resume continues with a fresh budget.

## Sources

- [Artifact Templates](../../spec-artifacts/) — `RAUF.md` and the installed artifacts.
- [CLI Reference](../../spec-cli/) — `--model`, `--iterations`, and related flags.
