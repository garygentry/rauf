# Supervision Guide

This guide shows how to supervise a running loop using a **single status poll per
tick** — the pattern the `drive-rauf-loop` skill encodes as the canonical recipe. The
design goal is that every decision comes from one `rauf status --json` call; you never
read `state.json`, `iteration-status.json`, or `.loop.lock` directly, and you never
spawn a subprocess to ask "is it alive?".

## When to use

- You are driving or babysitting a loop and want to react to milestones (item done,
  needs-human, blocked, completed) and to stalls.
- You are building an external supervisor (a bot, a dashboard poller, a CI watchdog)
  that must behave **deterministically** — always naming the root it means.
- You want a live terminal view that surfaces milestones without the per-iteration noise.

## When NOT to use

- **Consuming the event stream as data.** For a machine feed, read `events.ndjson` or
  use `rauf follow --json` (or `--ndjson`) — those emit **every** event, unfiltered.
  Altitude filtering is a terminal-rendering choice; do not rely on it to shape data.
- **Deciding whether an iteration is "stuck."** `health` gives you the _facts_
  (`stuckWarning`, `secondsSinceActivity`); the loop already owns the stall decision via
  `stuckWarning`. Apply your own time threshold to the raw age only as an escalation
  policy, not as a re-derivation of the loop's flag.
- **A one-shot "is it done?" check in a script without a root.** In machine context a
  rootless `status` is a hard `missing_target` error by design — always pass the root.

## The four decision inputs — all from one poll

A single `DerivedStatus` carries everything the decision tree reads:

| Input      | Field                                                | Question it answers                          |
| ---------- | ---------------------------------------------------- | -------------------------------------------- |
| Lifecycle  | `loopState`                                          | Is it running, paused, complete, errored?    |
| Progress   | `health.stuckWarning`, `health.secondsSinceActivity` | Is the live iteration advancing or stalling? |
| Liveness   | `lock.alive` / `lock.stale`                          | Is a process actually alive on this root?    |
| Human gate | `backlogSummary.needsHuman`                          | Is any item waiting on a person?             |

Because they are co-present on one object, a supervisor never has to correlate reads
across files or worry about a torn view between them.

## The recipe

```bash
# Always name the root explicitly — deterministic in machine context.
poll() { rauf status "$ROOT" --backlog "$BACKLOG" --json; }
```

Each tick, poll once and branch:

```jsonc
// 1. Human needed → stop and escalate.
backlogSummary.needsHuman > 0  ||  loopState == "PAUSED_HUMAN"   → escalate to a human

// 2. Terminal → finish.
loopState in { "COMPLETE", "ITERATIONS_COMPLETE" }               → done
loopState == "ERROR"                                             → surface the error

// 3. Stall → check liveness before acting.
health.stuckWarning == true                                      → warn; if it persists, investigate
lock.stale == true  (present but no live PID)                    → the loop died; restart or clean the lock

// 4. Otherwise → healthy; sleep the poll interval and tick again.
```

Suggested cadence: poll every **5 s** (a 5–10 s band is fine). Reset any stall timer only
when the lock goes stale _and_ is not alive — a long-but-live iteration is not a dead one.

> The stream never decides. Events (`rauf follow`) are a live heads-up; the **status
> poll** is the authority for every branch above. Do not drive control flow off event
> text.

## Watching interactively

For a human-friendly live view, use the item-level feed:

```bash
rauf follow "$ROOT" --backlog "$BACKLOG"
```

You get milestone events under a sticky header:

```
healthy  4/12 done · 1 blocked · on auth-007
✓ item_completed  auth-006
● item_selected   auth-007
```

The header's leading word (`healthy` / `blocked` / `needs-human` / `paused` /
`sleeping` / `complete`) is the state — color only re-emphasizes it, so the view is
readable without color. Add `--verbose` to drop to the full firehose (spawn/exit, tool
and token activity) with no header when you need to see everything.

## Scope safety in scripts

In a script (piped output or `--json`), a `status`/`follow` with **no root** fails fast
with `missing_target` (exit 2) rather than guessing. Always pass the root you mean:

```bash
rauf status /path/to/project --backlog specs/my-feature --json   # deterministic
rauf status --json                                               # ERROR: missing_target
```

On an interactive terminal the ergonomics still apply — a bare `rauf status` defaults to
the cwd, offers a pick-list when several loops are live, and broadens to the machine-wide
`--all` view when the cwd has no local loop.
