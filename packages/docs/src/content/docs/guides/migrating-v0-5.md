---
title: Migrating to v0.5.0+
description: The v0.5.0 grammar flip — loop start became loop run --detached, --watch became --follow, follow is now top-level, and the exit codes unified.
---

v0.5.0 was a deliberate clean break: a single breaking release that retired the old execution and
monitoring grammar with **no deprecation aliases**. There is exactly one breaking moment — after it,
the surface and contract are coherent. If you have scripts, pipeline configs, or muscle memory from
before v0.5.0, this guide is the full list of what changed and what replaced it.

![Execution modes: rauf loop run runs in-process (foreground) while rauf loop run --detached routes through the server daemon — both write the same files and are observed identically.](../images/execution-modes.svg)

:::caution[No silent failures]
Invoking a removed verb or flag prints a one-line "use X instead" remediation message and exits
`2` (USAGE). It never silently does the wrong thing, so a stale script fails loudly and tells you the
replacement rather than starting the wrong loop.
:::

## TL;DR — what moved where

| Removed                                        | Now                                                 |
| ---------------------------------------------- | --------------------------------------------------- |
| `loop start .`                                 | `loop run . --detached` (`-d`)                      |
| `loop start . --follow`                        | `loop run . --detached --follow`                    |
| `status . --watch`                             | `status . --follow` (`-f`)                          |
| `loop watch …` (machine telemetry)             | `status . --json` (or read `iteration-status.json`) |
| `loop follow …`                                | `follow .` (top-level)                              |
| branch on `loop run` exit `6` (paused human)   | branch on exit `3` (needs human)                    |
| branch on `status` exit `1` (running)          | branch on exit `6` (running)                        |
| `signal_parsed.signal === "done"` for a review | `signal_parsed.signal === "review"`                 |

## Command grammar

There is **one loop verb now: `loop run`.** The flag names the intent — bare runs foreground and
in-process, `--detached` hands the run to the server daemon and returns immediately. Both write the
same files and are observed identically (see the diagram above).

```bash
rauf loop run .                  # foreground, in-process (unchanged default)
rauf loop run . --detached       # detached / server-owned; returns immediately
rauf loop run . -d --follow      # detach, then attach the live view
rauf loop stop .                 # stop a detached / server-owned loop
```

`--detached` (`-d`) auto-starts the server daemon and returns immediately. Observe a detached run
with `rauf follow .` or the web UI; stop it with `rauf loop stop .`. Pressing Ctrl-C on a `--follow`
view detaches the view only — the loop keeps running.

:::tip[Flag canon — one name per concept]

- `--follow` / `-f` — the monitoring follow, available on `status`, `log`, and `follow`. (The old
  `--watch` is removed.)
- `--json` — machine output / final summary.
- `--ndjson` — the `loop run` event stream (NDJSON, one event per line). **This is separate from
  `--json`.**
- `--backlog <dir>`, `--interval <seconds>` — unchanged names.
  :::

## Exit codes (machine consumers — read this)

`status` and `loop run` now share one unified scheme:

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | success (idle / complete)                                                       |
| 1    | error                                                                           |
| 2    | usage (bad args / IO / failed precondition; also a removed-command remediation) |
| 3    | needs human (paused human)                                                      |
| 4    | limit / usage-paused / sleeping                                                 |
| 5    | blocked (terminal with blocked items)                                           |
| 6    | running (query-time only — `status`)                                            |

**The two changes that bite existing machine consumers:**

1. **`loop run` paused-human moved from `6` to `3`.** A supervisor that detected a `loop run` pause
   via exit `6` must switch to `3`. (`6` now means RUNNING, which `loop run` never returns.)
2. **`status` running moved from `1` to `6`.** Code branching on `status` exit `1` as "running" must
   switch to `6` — and `1` is now strictly "error".

`backlog validate` keeps its own triad, unchanged: `0` valid / `1` findings / `2` usage.

## The `review` signal

`signal_parsed.signal` now includes `"review"`. A `RAUF_REVIEW` outcome is reported as
`signal:"review"` instead of being collapsed to `"done"`. If you were inferring reviews some other
way — or treating that `"done"` as a completion — switch to the explicit value. (Loop-internal review
_handling_ is unchanged.)

## `events.ndjson` consumers

No shape change: `EVENTS_SCHEMA_VERSION` stays `"1"`. v0.5.0 formalizes the contract as
**additive-only** within a major version, and **readers must ignore unknown event types and unknown
fields**. If your reader is strict (rejects unknown), relax it now so future additive changes don't
break you. The full contract lives in the [Backlog-Tool / Loop-Runner Contract](../../spec-backlog-tool-contract/).

## Pipeline tools (feature-forge) — lockstep

Pipeline tools that drive rauf read its exit codes and version, so they must move in lockstep:

- Bump `loopRunner.minRunnerVersion` to **`>= 0.5.0`** (so the loop stage requires a 0.5.0 runner).
- Re-point any command templates that referenced the removed forms — `loop follow` → `follow`,
  `loop watch … --json` → `status … --json`, `status --watch` → `status --follow`, and
  `loop start` → `loop run --detached`.

If you maintain a custom `forge.config.json` `loopRunner` block, apply the same two steps.

:::caution[Frozen / pinned runner binaries]
If a project pins a specific runner binary (for example, a frozen build used for dogfood isolation),
that binary must be **rebuilt at `>= 0.5.0`** — otherwise the `minRunnerVersion` gate now rejects it.
Rebuild from the v0.5.0 tag and install the produced binary, or re-point the config off the frozen
binary to a `>= 0.5.0` build.
:::

## Verifying the upgrade

```bash
rauf version --json                 # → { "version": "0.5.0" } (or later)
rauf status . --watch ; echo $?     # → removed-flag remediation, exit 2 (not a watch)
rauf loop run . --detached          # → starts detached, returns immediately
```

The middle line is the key check: a removed form prints its "use X instead" message and exits `2`
rather than doing anything. Once every script and config in your toolchain passes that check, the
upgrade is complete.

## Further reading

- [CLI Reference](../../spec-cli/) — the current command grammar and flag canon.
- [Backlog-Tool / Loop-Runner Contract](../../spec-backlog-tool-contract/) — the unified exit codes
  and the additive-only `events.ndjson` contract.
