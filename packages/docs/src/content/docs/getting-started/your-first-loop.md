---
title: Your First Loop
description: Install rauf into a project, add a backlog item, run a loop, watch it, and interpret the result.
---

The fastest way to understand rauf is to run one loop end to end: add a work item, start the
loop, watch an iteration happen, and read what it tells you. Each iteration follows the same
shape.

![One rauf iteration: select an item, build the prompt, spawn the agent, parse its signal, verify and commit, then advance to the next item.](../images/loop-lifecycle.svg)

:::note[Expanding in the content pass]
This is the scaffold for the guided tutorial. The full narrative — add an item, `rauf loop run`,
watch with `rauf follow`, interpret the three signals, stop and resume — lands in the content
phase. The mechanics below are all current as of v0.6.0.
:::

## The shortest path

```bash
rauf install ~/workspace/my-project --yes   # add rauf to a project
rauf backlog add ~/workspace/my-project      # add a work item
rauf loop run ~/workspace/my-project         # run it in the foreground and watch
```

## Next steps

- [Core Concepts](../core-concepts/) — what a backlog item, a signal, and a status mean.
- [Monitoring a Loop](../../guides/monitoring/) — `status`, `follow`, `log`, and the machine surfaces.
- [CLI Reference](../../spec-cli/) — every command and flag.
