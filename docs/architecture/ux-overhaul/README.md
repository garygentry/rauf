# UX Overhaul — Phase 1: Observation Substrate

Phase 1 makes a rauf loop's activity **observable from files alone**. Every loop now
persists its event stream to `events.ndjson` inside the backlog root's state directory,
and registers itself in a machine-wide active-loop registry. Because all observers — the
CLI, the web server, and any pipeline tool — reconstruct state by reading those files,
they see the _same_ picture whether the loop runs in-process (`rauf loop run`) or under the
server daemon (`rauf loop start`). This collapses the old asymmetry where the web UI showed
a degraded view of in-process runs and the four monitor commands behaved differently by
execution mode.

This is the first of four phases. Phase 1 is **purely additive** — no command grammar
changed in a breaking way, no `minRunnerVersion` bump. (The clean-break removal of the old
`loop follow` / `loop watch` / `status --watch` verbs is the one exception, ratified for
this phase; see [the monitoring guide](./guides/monitoring.md).)

## Quick Start

Observe any loop — running or finished — straight from its files:

```bash
# One-shot status (reads state.json + iteration-status.json + rauf.log)
rauf status .

# Live-follow a loop: replay this run's events, then tail new ones
rauf follow .

# Every live loop on the machine, regardless of where it was started
rauf status --all
```

Consume the same data programmatically from `@rauf/core`:

```ts
import { resolveBacklogPaths, readEvents, listActiveLoops } from "@rauf/core";

const paths = resolveBacklogPaths(projectRoot, backlogRoot);
if (paths.ok) {
  const events = readEvents(paths.value); // PersistedEvent[] for the current run, in seq order
  if (events.ok) console.log(`${events.value.length} events this run`);
}

const live = listActiveLoops(); // every reconciled, confirmed-live loop, machine-wide
if (live.ok) for (const loop of live.value) console.log(loop.backlogRoot, loop.status);
```

## Key Concepts

**The event log (`events.ndjson`).** A newline-delimited JSON file, one
[`PersistedEvent`](./api-reference.md#persistedevent) per line, living at
`<stateDir>/events.ndjson`. Each record is a full `LoopEvent` plus two envelope fields:
a per-run dense `seq` and a `schemaVersion`. The runner is the **single writer**; everyone
else reads. The file holds the **current run only** — it is rotated to `archive/` at the
start of each new run.

**The active-loop registry.** One small JSON file per running loop under
`~/.rauf/active/<hash>.json`, where `<hash>` is `sha256(resolvedStateDir)[:16]`. It answers
"what loops are live on this machine, and where?" — across backlog roots and projects.
Entries are **reconciled on read** against each loop's `.loop.lock` (the ground truth): a
crashed loop that never deregistered is detected as dead and **self-healed** (pruned) the
next time anyone lists.

**Two authorities, never contradicting.** `state.json` is authoritative for a loop's
_current status_. `events.ndjson` is authoritative for its _stream and history_. The
registry's `status` field is **advisory only** — a convenience for cross-root listing that
must never be trusted over `state.json`.

**Empty is never silent.** A status read that finds nothing still names the directory it
inspected and surfaces any loop live elsewhere — so "I looked here, found nothing, but a
loop is running over there" is always legible, instead of a blank screen.

**Best-effort persistence.** Writing an event must never perturb the loop. Every persist is
wrapped and its failure swallowed; a torn trailing line from a writer caught mid-append is
tolerated by every reader (skipped, never half-parsed).

## Package Exports

All new surface is exported from `@rauf/core` (barrel re-exports `events-log` and
`loop-registry`). The CLI and web packages consume it; they add no new core logic.

| Module                         | What it provides                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `@rauf/core` → `events-log`    | `appendEvent`, `readEvents`, `watchEvents`, `rotateEventsLog`                                                    |
| `@rauf/core` → `loop-registry` | `registerLoop`, `deregisterLoop`, `updateLoopStatus`, `listActiveLoops`, `registryEntryPath`                     |
| `@rauf/core` → `fs-utils`      | `appendLine`, `readNdjson` (NDJSON primitives the event log builds on)                                           |
| `@rauf/core` → `status`        | `surfaceInspectedStatus`, `surfaceInspectedDir`, `InspectedStatusContext` (the empty-is-never-silent data layer) |
| `@rauf/core` → `lock`          | `checkLockFile` (lock liveness from a path; the registry's reconciliation primitive)                             |
| `@rauf/core` → `schemas`       | `PersistedEvent`, `ActiveLoopEntry`, `EVENTS_SCHEMA_VERSION`, `TOKEN_COALESCE_MS`, `EVENTS_LOG_FILENAME`         |
| `@rauf/cli`                    | `status` / `log` / `follow` monitoring verbs (file-backed)                                                       |
| `@rauf/web`                    | `GET /api/projects/:id/loop/events` (SSE), `GET /api/loops`, `<EventTimeline>`                                   |

## Configuration

Phase 1 introduces **no new user configuration**. Behavior is governed by constants in
`@rauf/core`:

| Constant                | Value             | Meaning                                                   |
| ----------------------- | ----------------- | --------------------------------------------------------- |
| `EVENTS_LOG_FILENAME`   | `"events.ndjson"` | Event-log file name within a state dir                    |
| `EVENTS_SCHEMA_VERSION` | `"1"`             | Event-log record schema version (forward-stable)          |
| `TOKEN_COALESCE_MS`     | `1000`            | Min interval between persisted `llm_token_update` records |

The runtime `events.ndjson` is gitignored (`**/.rauf/events.ndjson`) and excluded from the
runner's per-item `git add -A` commits.

## Further Reading

- [Architecture](./architecture.md) — design decisions, data flow, the writer/reader model, and the invariants that keep the two authorities consistent
- [API Reference](./api-reference.md) — every new export, with signatures, semantics, and examples
- [Monitoring Guide](./guides/monitoring.md) — the CLI monitoring surface, `follow`, `status --all`, and web observation parity
