# Architecture

Loop observability is a thin, additive layer over the existing status-derivation and
event-persistence machinery. It introduces no new files, no daemon, and no new
configuration — it enriches the objects a supervisor already reads. Four design
decisions carry the feature.

## 1. One poll = the whole decision (the single-read invariant)

The load-bearing goal (REQ-SUCCESS-01) is that a supervisor makes its **entire** next
move from a **single** `status` poll, without reading any raw state file itself and
without spawning a subprocess. `deriveStatus` therefore returns an object that already
contains every decision input:

- `loopState` — the reconciled lifecycle state.
- `health` — is the live iteration progressing or stalling.
- `lock` — is a process actually alive on this backlog root.
- `backlogSummary.needsHuman` — is any item waiting on a person.

To make health free, `deriveStatus` **promotes the iteration-status read** to a single
site. Before this feature, `iteration-status.json` was read inside the liveness check
(`isLoopLive`) on one branch only. That read is now performed **once** in
`deriveFromStateJson` and the parsed value is threaded into both the (now pure)
`isLoopLive(paths, iterationStatus, now)` **and** `buildHealth(iterationStatus, now)`.
`buildHealth` does zero I/O — it only projects the already-parsed value. The result is
the **≤ 1 read per `deriveStatus`** invariant (REQ-PERF-01), enforced by tests on the
healthy path, the staleness-downgrade path (the old sole read site), and the
Tier-2/`none` path (where the count is 0 — the file is never touched when there is no
live iteration).

`health` is `null` whenever no iteration is live, or when `iteration-status.json` is
absent, unparseable, or fails schema validation — a missing/garbled file degrades to
"no hint," never to an error.

## 2. Health is a hint, not a verdict

`buildHealth` deliberately reports **facts**, not conclusions:

- `stuckWarning` is a faithful mirror of the runner's own `IterationStatus.stuckWarning`
  — the loop owns the stall decision; the status layer does not re-derive it.
- `secondsSinceActivity` is the raw whole-second age of `lastActivityAt`, clamped to
  `≥ 0` so a future-skewed clock reads `0` rather than a negative number. It is a
  measurement; the _interpretation_ ("is 90 s too long?") belongs to the supervisor's
  policy, documented in the [supervision guide](./guides/supervision.md).
- `iterationFresh` answers only "was the iteration file touched within the freshness
  window," reusing the same ~60 s constant that governs loop-liveness derivation, so
  freshness means the same thing everywhere.

Keeping health free of judgement is what lets the supervision recipe live in one place
(the `drive-rauf-loop` skill) instead of being smeared across the runner, the status
layer, and every consumer.

## 3. The status contract is versioned and additive

`statusSchemaVersion: "1"` is a literal on every `DerivedStatus`. Two rules protect
consumers:

- **Additive-only enrichment.** The `health` block and the version marker were _added_;
  no existing field was renamed, retyped, or removed. A consumer written before this
  feature ignores the new keys and keeps working — proven by an "existing-shape
  consumer still parses" test.
- **A literal, not a range.** Because the version is `z.literal("1")`, the schema
  **rejects** any other value (`"2"`, a number, a missing field). That rejection is the
  guard that protects a machine consumer from a _silently_ bumped contract: if the shape
  ever changes incompatibly, the version must change too, and a strict consumer sees it
  immediately rather than mis-parsing new data as old.

## 4. Scope strictness is context-gated, not global

`resolveTarget` splits behavior by **output context**, which the CLI computes as
`isMachineContext = json || !isTTY` and passes in (core never probes `process` or the
TTY itself — REQ-SAFE-01):

- **Explicit root** → resolve it directly, context-independent.
- **No root, machine context** (`--json` or piped) → **hard** `missing_target` error.
  A script never gets a loop it didn't name; it never triggers a filesystem scan.
- **No root, TTY** → the friendly path: default to cwd; if exactly one loop is live,
  use it; if several are live, return `kind: "ambiguous"` so the CLI can render an
  interactive pick-list; if none, resolve cwd.

Note that `ambiguous` is a **success** shape (a TTY pick-list), never a machine result —
in machine context, ambiguity would instead be a hard error. All concrete
`(root, backlogDir)` pairs flow back through `resolveBacklogRoot`/`resolveBacklogPaths`,
so the sandbox-containment check is never reimplemented inside `resolveTarget`; a
containment failure surfaces as `outside_sandbox`.

The CLI adds one TTY-only ergonomic on top: **bare-status cwd → `--all` broadening**
(REQ-SCOPE-03). When `rauf status` is run with no root on a TTY and the cwd has no live
loop of its own, the view broadens to the machine-wide `--all` listing rather than
showing an empty local result. `--all` short-circuits **before** `resolveTarget` — it
needs no single-root target — so the two code paths stay cleanly separated.

## 5. Event altitude — presentation only, one consumer

`eventAltitude` maps each of the 24 `LoopEvent` types to `"item"` or `"firehose"`. Two
properties matter:

- **Exhaustiveness is compile-checked.** The `switch` ends in a
  `const _exhaustive: never = ev` assignment, so adding a 25th event type without
  classifying it fails `typecheck`. A trailing `return "firehose"` remains as a runtime
  safety net, so an unrecognized runtime value is surfaced in verbose view, never
  silently dropped.
- **The prime directive: presentation never leaks into machine surfaces.**
  `eventAltitude` is consumed **only** by the TTY `follow` renderer. The `--json` and
  `--ndjson` streams emit every event unchanged — altitude filtering is a rendering
  choice, not a data change.

### The follow feed and its sticky header

`rauf follow` gates each event through altitude: without `--verbose`, only `item` events
print. Above them sits a **sticky progress header** re-rendered from a `DerivedStatus`
poll (no extra scan — REQ-CMD-05): `healthy  4/12 done · 1 blocked · on auth-007`. The
header is disabled under `--json` (machine surface) and under `--verbose` (the firehose
restores the legacy line-per-event behavior with no header).

**Accessibility (REQ-A11Y-01):** the header's state is carried by a leading **text**
label (`healthy` / `blocked` / `needs-human` / `paused` / `sleeping` / `complete`).
Color only re-emphasizes that label — it is never the sole carrier of meaning, and with
color disabled the string contains no ANSI escapes.

## Data flow

```
iteration-status.json ─┐
state.json ────────────┤
backlog.json ──────────┼─► deriveStatus (ONE read pass)
.loop.lock ────────────┘        │
                                ├─► loopState (isLoopLive, pure)
                                ├─► health    (buildHealth, I/O-free)   ── null if no live iter
                                ├─► lock      (liveness summary)
                                └─► backlogSummary (incl. needsHuman)
                                        │
             CLI flags ─► resolveTarget ┘ (which root? — strict in machine context)
                                        │
   events.ndjson ─► eventAltitude ─► follow feed (item-level) + sticky header (from a poll)
                    (--json/--ndjson emit every event, unfiltered)
```
