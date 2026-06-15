# Migration Guide — pre-0.5.0 → v0.5.0

v0.5.0 is a **clean break, no aliases**. This guide covers everything that changed for someone (or some
tool) upgrading from a pre-0.5.0 rauf. There's exactly one breaking moment — after it, the surface and
contract are coherent.

## TL;DR

| You used to…                                   | Now…                                                     |
| ---------------------------------------------- | -------------------------------------------------------- |
| `rauf loop start .`                            | `rauf loop run . --detached` (`-d`)                      |
| `rauf loop start . --follow`                   | `rauf loop run . --detached --follow`                    |
| `rauf status . --watch`                        | `rauf status . --follow` (`-f`)                          |
| `rauf loop watch …` (machine telemetry)        | `rauf status . --json` (or read `iteration-status.json`) |
| `rauf loop follow …`                           | `rauf follow .` (top-level; since Phase 1)               |
| branch on `loop run` exit `6` (paused_human)   | branch on exit `3` (NEEDS_HUMAN)                         |
| branch on `status` exit `1` (running)          | branch on exit `6` (RUNNING)                             |
| `signal_parsed.signal === "done"` for a review | `signal_parsed.signal === "review"`                      |

Invoking a removed verb/flag prints a one-line "use X instead" message and exits `USAGE(2)` — it won't
silently do the wrong thing.

## Command grammar

**`loop start` is gone.** There's one loop verb now: `loop run`. The flag names the intent.

```bash
rauf loop run .                  # foreground, in-process (unchanged default)
rauf loop run . --detached       # detached / server-owned (the old `loop start`); returns immediately
rauf loop run . -d --follow      # detach, then attach the live view
rauf loop stop .                 # stop a detached/server-owned loop
```

A detached run auto-starts the server daemon and returns immediately — same behavior `loop start` had.
Observe it with `rauf follow .` or the web; stop it with `rauf loop stop .`. Ctrl-C on a `--follow` view
detaches the view only (the loop keeps running).

**Flag canon.** One name per concept, everywhere:

- `--follow` / `-f` — the monitoring follow (on `status`, `log`, `follow`). `--watch` is removed.
- `--json` — machine output / final summary.
- `--ndjson` — the `loop run` event stream (NDJSON, one event per line). _This is separate from `--json`._
- `--backlog <dir>`, `--interval <seconds>` — unchanged names.

## Exit codes (machine consumers — read this)

`status` and `loop run` now share one scheme:

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | success (idle / complete)                                                       |
| 1    | error                                                                           |
| 2    | usage (bad args / IO / failed precondition; also a removed-command remediation) |
| 3    | needs human (paused_human)                                                      |
| 4    | limit / usage-paused / sleeping                                                 |
| 5    | blocked (terminal with blocked items)                                           |
| 6    | running (query-time only — `status`)                                            |

**The two gotchas that bite existing integrations:**

1. **paused-human moved from `6` to `3`.** A supervisor that detected a `loop run` pause via exit `6` must
   switch to `3`. (`6` now means RUNNING, which `loop run` never returns.)
2. **`status` running moved from `1` to `6`.** Code branching on `status` exit `1` as "running" must switch
   to `6` (and `1` is now strictly "error").

`backlog validate` is unchanged (`0` valid / `1` findings / `2` usage).

## The `review` signal

`signal_parsed.signal` now includes `"review"`. A `RAUF_REVIEW` outcome is reported as `signal:"review"`
instead of being collapsed to `"done"`. If you were inferring reviews some other way (or treating that
`"done"` as completion), switch to the explicit value. (Loop-internal review _handling_ is unchanged.)

## `events.ndjson` consumers

No shape change — `EVENTS_SCHEMA_VERSION` stays `"1"`. v0.5.0 just formalizes the contract: it's
additive-only within a major version, and **readers must ignore unknown event types and unknown fields**.
If your reader is strict (rejects unknown), relax it now so future additive changes don't break you.

## feature-forge (and other pipeline tools) — lockstep

feature-forge drives rauf and reads its exit codes / version, so it must be in lockstep. **feature-forge
0.10.0** does this:

- `loopRunner.minRunnerVersion` `0.2.0` → **`0.5.0`** (so `forge-5-loop` requires a 0.5.0 runner).
- `followCommand`: `{bin} loop follow …` → `{bin} follow …`.
- `watchCommand`: `{bin} loop watch … --json` → `{bin} status … --json`.

If you maintain your own pipeline tool or a custom `forge.config.json` `loopRunner` block, apply the same:
bump `minRunnerVersion` to `0.5.0` and re-point any `loop follow` / `loop watch` / `status --watch` /
`loop start` command templates.

## Frozen / pinned runner binaries

If a project pins a specific runner binary (e.g. rauf's own `forge.config.json` pins a frozen `rauf-stable`
for dogfood isolation), that binary must be rebuilt at **≥ 0.5.0** — otherwise the `minRunnerVersion` gate
(now 0.5.0) will reject it. Rebuild from the v0.5.0 tag (`pnpm compile` → install the produced binary), or
re-point the config off the frozen bin to a 0.5.0 build.

## Verifying the upgrade

```bash
rauf version --json                 # → { "version": "0.5.0" }
rauf loop start . ; echo $?         # → remediation message, exit 2 (not a started loop)
rauf status . --watch ; echo $?     # → remediation message, exit 2
rauf loop run . --detached          # → starts detached, returns immediately
```

## Further Reading

- [README](../README.md) · [Architecture](../architecture.md) · [API Reference](../api-reference.md)
- `specs/ux-overhaul/CANON.md` §4.1/§4.4/§6 — the canonical grammar, exit-code table, and cutover strategy
