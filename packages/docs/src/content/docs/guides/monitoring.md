---
title: Monitoring a Loop
description: Watch a running loop with status, follow, log, and progress — and the JSON/NDJSON machine surfaces underneath.
---

Every way to watch a rauf loop reconstructs its view from the **same files on disk** — there is
no privileged live channel. That is why foreground and detached runs look identical, and why the
CLI, the web, and an external pipeline all agree.

![The observation substrate: a loop runner appends to state.json, events.ndjson, iteration-status.json, and rauf.log; the CLI, web dashboard, and external pipelines all reconstruct their view by reading those files.](../images/observation-model.svg)

:::note[Expanding in the content pass]
This is the scaffold for the Monitoring guide. The full walkthrough (`--json` / `--ndjson`,
tailing `events.ndjson`, `status --all`, detecting a stall) lands in the content phase. The
sources below are current as of v0.6.0.
:::

## The commands

- `rauf status <path>` — one-shot snapshot (`--follow` to live-refresh, `--json` for machine output).
- `rauf follow <path>` — the canonical rich live view; replays then tails `events.ndjson`.
- `rauf log <path>` — tail the human log (`--tail N`, `--follow`).
- `rauf progress <path>` — the loop's accumulated learnings.

## Sources

- [CLI Reference](../../spec-cli/) — every monitoring command and flag.
- [Machine Surfaces & Contract](../../spec-backlog-tool-contract/) — `events.ndjson`, `--json`,
  `--ndjson`, and the compatibility promise.
- [Recovery & Troubleshooting](../recovery/) — when monitoring tells you the loop has stopped.
