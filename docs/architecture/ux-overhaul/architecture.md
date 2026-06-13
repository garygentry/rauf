# Architecture — Observation Substrate

This document explains how Phase 1 is built: the data flow from a running loop to its
observers, the writer/reader contract that keeps that flow correct, and the design
decisions behind each piece.

## The problem it solves

Before Phase 1, a loop's live `LoopEvent`s were the only un-persisted state. Two consequences
followed:

1. **Observation asymmetry.** The web server could only show events for loops _it_ had
   started (it held them in memory). An in-process `rauf loop run` was invisible to it.
2. **Mode-dependent monitoring.** The CLI's monitor commands behaved differently depending
   on whether a loop ran in-process or under the server.

The fix is to make the event stream a **file** (`events.ndjson`), and loop liveness a
**file-backed registry**. Once both live on disk, every observer reconstructs identical
state by reading — there is no privileged in-memory observer. This is on-philosophy with the
project's standing rule that status derivation is file-based and never spawns subprocesses.

## Data flow

```
   LoopRunner (the single writer, one per backlog root)
        │
        │  emitEvent(type, payload)
        ▼
   ┌─────────────────┐     persistEvent()             ┌──────────────────────┐
   │  in-memory emit  │────────────────────────────────▶│  <stateDir>/events.ndjson │
   │ (EventEmitter)   │   append PersistedEvent line    │  (append-only, current run)│
   └─────────────────┘                                 └──────────────────────┘
        │                                                        ▲
        │ registerLoop / updateLoopStatus / deregisterLoop        │ readEvents (replay)
        ▼                                                        │ watchEvents (tail)
   ~/.rauf/active/<hash>.json  ◀── reconcile ──┐                  │
        │  (one file per live loop)            │ checkLockFile     │
        │                                      │ + pid match       │
        ▼                                <stateDir>/.loop.lock     │
   listActiveLoops() ── self-heal prune dead ──┘                  │
        │                                                         │
        ▼                                                         │
   Observers:  CLI (status / log / follow / status --all)  ·  Web (/loop/events SSE, /api/loops)
```

Two write paths leave the runner, both best-effort:

- **Event stream** → `events.ndjson`, via `persistEvent()` inside `emitEvent()`. The event
  is always emitted in-memory (for a server that started this loop); persistence is a
  side-effect whose failure is swallowed.
- **Liveness** → `~/.rauf/active/<hash>.json`, via `registerLoop` (at start, after the lock
  is acquired), `updateLoopStatus` (on status transitions, paired with `state.json` writes),
  and `deregisterLoop` (in the run's `finally`).

Readers never touch the runner. They open files: `readEvents`/`watchEvents` for the stream,
`listActiveLoops` for liveness, `deriveStatus` for current status.

## Components

### Event log (`packages/core/src/events-log.ts`)

The file format is NDJSON: one `PersistedEvent` per line. The module is four functions over
that file, built on the `appendLine` / `readNdjson` primitives in `fs-utils.ts`:

- **`appendEvent(paths, record)`** — append one record. Sandbox-validates the target path to
  `paths.stateDir` first (a path escape returns `PATH_VIOLATION` and writes nothing), then
  writes a single whole line. The runner is the only caller.
- **`readEvents(paths)`** — the _replay_ half of a `follow`: returns the current run's records
  in `seq` order. Torn-trailing-line tolerant; a missing file returns `ok([])` (graceful
  absence, not an error).
- **`watchEvents(paths, onRecords)`** — the _tail_ half: returns a bare cleanup function and
  invokes `onRecords` with each batch of newly-appended records. It tracks a byte offset and
  re-reads `[offset, EOF)` on each `fs.watch` "change", advancing the offset only past the
  last newline — so a partial trailing line is re-read and completed on the next fire, never
  emitted half-parsed. Because `fs.watch` can miss fires under rapid writes, re-reading from
  the offset is self-correcting, and the caller's `--interval` poll is both the fallback
  (where `fs.watch` is unavailable) and a periodic reconciliation safety net.
- **`rotateEventsLog(paths)`** — called once at `runner.start()`: moves the prior run's
  `events.ndjson` to `archive/{ts}-events.ndjson` so the live file always holds the current
  run only.

### Active-loop registry (`packages/core/src/loop-registry.ts`)

A directory of per-loop entry files under `~/.rauf/active/`, each named
`sha256(resolve(stateDir))[:16] + ".json"`. The per-file design is structurally
concurrency-safe: two loops never write the same file, so no lock coordinates the registry
itself.

`listActiveLoops()` is the heart of the module. For each entry it **reconciles against ground
truth** before including it:

1. glob `~/.rauf/active/*.json`;
2. parse each — a corrupt, half-written, or foreign file is **skipped**, never fatal;
3. read `{entry.stateDir}/.loop.lock` via `checkLockFile` and require it locked, not stale,
   and `pid`-matching the entry;
4. if not live → **unlink** the entry (self-heal) and exclude it;
5. else include it, sorted by `stateDir`.

So a crashed loop that never reached its `deregisterLoop` is pruned the first time anyone
lists — the registry is self-cleaning, with no background sweeper. All pure file reads; no
subprocess.

### Cross-root status surfacing (`packages/core/src/status.ts`)

`surfaceInspectedStatus(paths, status)` and `surfaceInspectedDir(inspectedDir, empty)` build
an `InspectedStatusContext`: the directory that was inspected, whether it was empty, and the
loops live in _other_ roots (from `listActiveLoops`, excluding the inspected root itself).
This is the data layer behind "empty is never silent." `surfaceInspectedStatus` delegates to
`surfaceInspectedDir` so the registry read and exclude-self filter live in exactly one place;
the CLI is a pure presenter over this context (it reimplemented none of the filtering).

### Web read path (`packages/web/src/server/routes/loop.ts`)

Two endpoints make the web a peer observer, not a privileged one:

- **`GET /api/projects/:id/loop/events`** — resolves a `BacklogPaths` (honoring an optional
  `?backlog`), replays the current run via `readEvents`, then live-tails via `watchEvents`,
  emitting each record as a `loop_event` SSE. It observes _any_ loop, including an in-process
  one the server never started. A `?backlog` that fails to resolve surfaces a `loop_error`
  rather than silently falling back to the default root.
- **`GET /api/loops`** — returns `listActiveLoops()` (reconciled, self-healed), the web
  equivalent of `status --all`.

The frontend `<EventTimeline>` consumes the file-backed `/loop/events` stream. (Status
vocabulary and badges — `REVIEWING`, `PAUSED_USAGE_LIMIT`, "Needs Human" — are deliberately
Phase 4: event _rendering_ is not status _vocabulary_, and that boundary is held here.)

## Key design decisions

These were ratified during the tech-spec stage (D1–D9). The reasoning is preserved here
because it explains why the code looks the way it does.

### D1 — The runner owns sequencing and coalescing; core owns the write

`persistEvent()` (in `emitEvent`) assigns `seq` and decides whether a token update is
coalesced; `appendEvent` just writes. This keeps per-run state (the `seq` counter, the last
token-persist timestamp) with the single writer, while the filesystem mechanics stay in core.
There is exactly **one writer per backlog root**, which is what makes the read-tolerance
guarantee (below) hold.

### D2 — Flat records: `PersistedEvent = LoopEvent ∩ {seq, schemaVersion}`

A record is the entire `LoopEvent` plus the envelope, so a reader needs **no join** against
another surface to interpret a line. (It is the codebase's first `z.intersection`; intersecting
the discriminated union with the envelope forfeits the discriminated-union fast path, which is
acceptable at Phase-1 event volumes.)

### D3 — `seq` is dense and assigned only on write

The sequence number is incremented _only_ when a record actually hits disk. Therefore a gap in
`seq` means **corruption, not coalescing** — coalesced/dropped token updates consume no `seq`.
This is what makes `seq` a reliable integrity signal.

### D3b — Token coalescing ≈ 1/sec, time-based last-write-wins

`llm_token_update` events fire far faster than is useful to persist. At most one is written per
`TOKEN_COALESCE_MS` (1000 ms); the rest are still emitted in-memory but dropped from the file.
This window is deliberately independent of — and finer than — the runner's existing
`TOKEN_EVENT_THROTTLE_MS` that gates `iteration-status.json`. Structural events (everything that
is not a token update) are **never** coalesced.

### D4 — Rotate at start, not at end

`events.ndjson` is rotated to `archive/{ts}-events.ndjson` at `runner.start()`, not on
shutdown. A loop that crashed without a clean shutdown still leaves its last run's events on
disk for inspection; the next run archives them before it begins.

### D5 — Reconcile-on-read via `checkLockFile`, no background sweeper

Registry correctness comes from reconciling each entry against its `.loop.lock` at list time,
using `checkLockFile(lockPath)` — a function extracted from the existing `checkLock` so the
registry can check an _arbitrary_ lock path. Self-heal-on-read means no daemon, no cron, no
sweep race.

### D6 / D7 — Machine-wide scope, surfaced as `status --all`

Discovery is machine-wide in Phase 1 (no scoping flag). The cross-root listing is exposed as
`status --all` on the CLI and `GET /api/loops` on the web.

### D8 — Web is backend parity + a bounded timeline; vocabulary stays Phase 4

The web gains the two read endpoints and a bounded `<EventTimeline>`. Status label-maps and the
missing badges are explicitly out of scope — see the boundary note in the web component above.

### D9 — `follow` is file-based: replay then tail, current run only

The top-level `follow` replays the current run's `events.ndjson` (`readEvents`) then tails it
(`watchEvents` / `fs.watch`). It replays the **current run only** — it does not stitch the
archived logs. A server SSE path is an optional lower-latency opt-in, not the primary mechanism.

## Invariants

These properties must hold for the substrate to be trustworthy. The tests in
`packages/*/src/**.test.ts` exist primarily to pin them.

- **Two authorities, never contradicting.** `state.json` is authoritative for _status_;
  `events.ndjson` is authoritative for _stream/history_. The registry `status` is advisory.
- **Single writer per root.** Only the runner writes `events.ndjson` for a given root. This is
  what reduces all possible corruption to "a torn trailing line," which every reader tolerates.
- **Dense `seq`.** Within a run, `seq` is `0,1,2,…` with no gaps. A gap means corruption.
- **Best-effort, never-perturbing.** A persistence or registry failure is caught and swallowed;
  it must never change the loop's behavior or exit.
- **Graceful absence.** A missing `events.ndjson` or registry dir reads as empty (`ok([])`),
  never as an error.
- **Self-healing registry.** Listing prunes any entry whose loop is no longer live; the registry
  needs no external cleanup.

## What changed, by package

| Package      | Change                                                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@rauf/core` | New `events-log.ts`, `loop-registry.ts`; `appendLine`/`readNdjson` in `fs-utils.ts`; `checkLockFile` extracted in `lock.ts`; `surfaceInspectedStatus`/`surfaceInspectedDir` in `status.ts`; `eventsLog`+`archive` on `BacklogPaths`; new schemas/constants |
| `@rauf/loop` | `LoopRunner` wires event persistence (`emitEvent`→`persistEvent` with `seq`+coalescing), rotation + `seq` reset at `start()`, and registry register/update/deregister                                                                                      |
| `@rauf/cli`  | Clean-break monitor surface: top-level `follow`, `status --follow/-f`, `status --all`, empty-is-never-silent; removed `loop follow`/`loop watch`/`status --watch`                                                                                          |
| `@rauf/web`  | `GET /loop/events` (file-backed SSE) and `GET /api/loops` (registry); `<EventTimeline>`                                                                                                                                                                    |

For exact signatures see the [API Reference](./api-reference.md); for operator-facing usage see
the [Monitoring Guide](./guides/monitoring.md).
