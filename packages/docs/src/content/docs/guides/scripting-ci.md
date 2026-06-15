---
title: Scripting & CI
description: Drive rauf headlessly — exit codes, --json/--ndjson, and the pause-on-needs-human supervisor pattern.
---

Rauf is designed to be supervised by another program. Branch on its **exit codes** without
parsing output, and parse the **machine surfaces** (`--json`, `--ndjson`, `events.ndjson`) — never
the human renderer or `rauf.log`.

![The observation substrate: a loop runner appends to state.json, events.ndjson, iteration-status.json, and rauf.log; the CLI, web dashboard, and external pipelines all reconstruct their view by reading those files.](../images/observation-model.svg)

:::note[Expanding in the content pass]
This is the scaffold for the Scripting & CI guide. The full walkthrough (the unified exit-code
table, `--json`/`--ndjson` shapes, the `--pause-on-needs-human` → `resume --answer` supervisor
loop, headless usage) lands in the content phase. The summary below is current as of v0.6.0.
:::

## The supervisor pattern

```bash
rauf loop run . --ndjson --pause-on-needs-human
# on a needs_human / loop_paused event (or exit code 3):
rauf resume . --answer <id> "<the human's answer>"
```

## Sources

- [Machine Surfaces & Contract](../../spec-backlog-tool-contract/) — events, `DerivedStatus`,
  exit codes, and the additive-only compatibility promise.
- [CLI Reference](../../spec-cli/) — every flag and the unified exit-code scheme.
