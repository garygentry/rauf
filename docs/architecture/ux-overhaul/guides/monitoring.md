# Guide — Monitoring a Loop

How to watch a rauf loop after Phase 1, from the CLI and the web. The throughline: **every
surface reads files**, so they all show the same picture regardless of how the loop was
started.

## The clean-break surface

Phase 1 removed three monitor verbs/flags outright — **no aliases** (a ratified clean break).
If you have muscle memory or scripts using the old forms, update them:

| Removed                   | Use instead                                          |
| ------------------------- | ---------------------------------------------------- |
| `rauf loop follow <path>` | `rauf follow <path>` (now a top-level verb)          |
| `rauf loop watch`         | (gone) — use `rauf status --follow` or `rauf follow` |
| `rauf status --watch`     | `rauf status --follow` (or `-f`)                     |

`--follow` / `-f` is the **one** monitoring follow flag, shared by `status`, `log`, and `follow`.
It is distinct from the unrelated `--follow` _execution_ convenience flag on `loop start` (which
streams SSE inline after starting a server-run loop).

## CLI commands

### `rauf status [path]`

One-shot status for the loop at `[path]` (default `.`). Reads `state.json` +
`iteration-status.json` + `rauf.log` via `deriveStatus` — never spawns a subprocess.

```
rauf status .
rauf status . --follow          # or -f: refresh on an interval until Ctrl+C
rauf status . --interval 5 -f   # poll every 5s under --follow
rauf status . --json            # emit the DerivedStatus object
rauf status . --backlog specs/ux-overhaul   # a non-default backlog root
rauf status --all               # every live loop on the machine (see below)
```

**Empty is never silent.** If the inspected root has no usable state, `status` still names the
directory it looked at and, if a loop is live in another root, names that root too:

```
No loop activity in /home/you/proj/.rauf.

A loop is live in another backlog root:
  /home/you/other/.rauf — running (PID 4821)
Re-run with --backlog <dir> to inspect it, or rauf status --all to list all.
```

Under `--json`, the same is structured as `{ inspected, empty, liveElsewhere: [...] }`.

### `rauf follow [path]`

The canonical live-view verb. **File-backed** — it does not require the server. It replays the
current run's `events.ndjson` (`readEvents`), then tails it (`watchEvents`) for new events,
polling `state.json` for the terminal state.

```
rauf follow .
rauf follow . --json            # emit events as NDJSON, one per line
rauf follow . --interval 2      # terminal-state poll interval (seconds)
rauf follow . --backlog specs/ux-overhaul
```

It replays the **current run only** — it never stitches the rotated `archive/` logs from prior
runs. Runs until the loop reaches a terminal state or Ctrl+C.

### `rauf log [path]`

Tail the human log file `.rauf/rauf.log`.

```
rauf log .
rauf log . --tail 50
rauf log . --follow             # or -f: tail -f behavior
```

### `rauf status --all`

List every backlog root with a live loop, machine-wide — sourced from the reconciled
active-loop registry (`listActiveLoops`), so a crashed loop never appears (it is self-healed on
read). The status shown is **advisory**; for the authoritative status of one root, run
`rauf status --backlog <root>`.

```
rauf status --all
rauf status --all --json        # { loops: ActiveLoopEntry[] }
```

## Web observation

The web server is now a peer observer — it can watch a loop it never started, including an
in-process `rauf loop run`.

### `GET /api/projects/:id/loop/events`

Server-Sent Events stream of the loop's events. Resolves a `BacklogPaths` (honoring an optional
`?backlog=<dir>`), replays the current run via `readEvents`, then live-tails via `watchEvents`,
emitting each `PersistedEvent` as a `loop_event` SSE. Heartbeats keep the connection alive; a
torn trailing line is tolerated (the endpoint stays `200`, never `500`). A `?backlog` that fails
to resolve emits a `loop_error` event rather than silently tailing the default root.

The frontend `<EventTimeline>` component consumes this stream.

### `GET /api/loops`

The web equivalent of `status --all` — returns `listActiveLoops()` (reconciled, self-healed).

## Choosing a surface

| You want…                                      | Use                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A quick snapshot of one loop                   | `rauf status .`                                                                               |
| To watch one loop live in a terminal           | `rauf follow .`                                                                               |
| Just the human log                             | `rauf log . -f`                                                                               |
| Everything running on the machine              | `rauf status --all` / `GET /api/loops`                                                        |
| A live feed in the web UI / a custom dashboard | `GET /api/projects/:id/loop/events` (SSE)                                                     |
| To build a programmatic observer               | `readEvents` + `watchEvents` from `@rauf/core` (see the [API reference](../api-reference.md)) |

## Notes & gotchas

- **`events.ndjson` is the current run only.** Prior runs are rotated to `archive/{ts}-events.ndjson`
  at the start of each run. `follow` and `/loop/events` never stitch the archive.
- **The registry `status` is advisory.** `status --all` / `/api/loops` show a last-known status;
  `state.json` (via `rauf status --backlog <root>`) is authoritative.
- **`--backlog` matters.** A non-default backlog root has its own state dir and its own
  `events.ndjson`. Point `status` / `follow` / `log` at it with `--backlog <dir>`; "empty status
  mid-run" is almost always a backlog-root mismatch, which the empty-is-never-silent footer now
  makes obvious.
- **No server needed for reads.** `status`, `log`, `follow`, and `status --all` are all file-backed.
  Only `loop start` / `loop stop` require the server daemon.
