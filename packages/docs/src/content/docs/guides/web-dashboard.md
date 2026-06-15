---
title: The Web Dashboard
description: Start the server, discover projects, manage the backlog, read status badges, and recover loops from the browser.
---

The web dashboard is a React single-page app served by a local [Hono](https://hono.dev/) server bound to
`127.0.0.1` (port `5173` by default). It is a **view onto the same on-disk substrate the CLI reads** —
`state.json`, `events.ndjson`, `iteration-status.json`, and `rauf.log` — so it reports the same status
for **any** loop in a project, including loops it did not start. A loop you launch in a terminal with
`rauf loop run` shows up in the dashboard with no extra wiring, because both surfaces reconstruct their
view from the same files.

![The observation substrate: a loop runner appends to state.json, events.ndjson, iteration-status.json, and rauf.log; the CLI, web dashboard, and external pipelines all reconstruct their view by reading those files.](../images/observation-model.svg)

## Starting and stopping the server

Run the server with `rauf server start`. In a TTY it runs in the foreground; pass `--daemon` to
background it. Override the port with `--port N`.

```bash
rauf server start            # foreground (default in a TTY)
rauf server start --daemon   # background it
rauf server start --port 8080
```

On start it prints:

```text
Rauf server running at http://localhost:5173
```

Open that URL to reach the dashboard.

The rest of the lifecycle is managed with the `rauf server` subcommands:

```bash
rauf server status       # is it running? (--json for machine output)
rauf server logs         # tail the server log (--tail N)
rauf server restart      # restart in place
rauf server stop         # stop it
```

`rauf server stop` is **loop-aware**: it refuses to stop while loops are in flight, so you don't pull
the server out from under a running loop by accident. Pass `--force` to stop anyway.

:::caution[The server binds to localhost only]
The server listens on `127.0.0.1` and never on `0.0.0.0`. There is no remote access and no
authentication layer beyond that binding — the dashboard is a local operator tool, not a hosted
service.
:::

## Discovering projects

The first thing the dashboard shows is the **projects view**: a card for every rauf-enabled project
found under your root directory, each with its stack, loop-state badge, and backlog summary. This is
the web equivalent of `rauf projects status` — the same scan, rendered as a grid you can click into.

## Managing the backlog

Open a project and you get full backlog CRUD from the browser: **add, edit, delete, and list** items,
filtered and sorted in the UI. This is the same data as `rauf backlog …` operating on the same
`backlog.json` — change it in the browser and the next CLI read sees it, and vice versa.

## Live status and events

Loop status in the dashboard is rendered from the **one shared label map** that the CLI uses, so every
surface names a state identically. Two states that used to render as if the loop were idle now have
their own badges:

| Raw state            | Label                |
| -------------------- | -------------------- |
| `PAUSED_HUMAN`       | Needs Human          |
| `REVIEWING`          | Reviewing            |
| `PAUSED_USAGE_LIMIT` | Usage Limit (Paused) |

Alongside the badge, a **live event timeline** reconstructs the loop's activity from `events.ndjson`,
streamed over SSE so it updates as the loop runs. For the full status vocabulary and how each surface
derives state from the substrate, see the [Monitoring guide](../monitoring/).

## Recovery actions

The dashboard exposes the **same five recovery actions** as the CLI, as buttons on the project status
page:

- **Reset** — clear loop state and reset stalled items.
- **Resume** — reconcile committed work and relaunch the loop.
- **Review** — start a standalone review pass over completed items.
- **Unblock** — requeue blocked items.
- **Validate** — check the backlog for structural problems.

This is the CLI↔web parity group: anything you can recover from the terminal, you can recover from the
browser. The full action-by-action walkthrough, with request/response shapes, lives in the
[Recovery & Troubleshooting guide](../recovery/).

### The security model

The recovery endpoints split along read vs. write:

- **Mutating actions** (Reset, Resume, Review, Unblock) are `POST`s. Every one requires the header
  `X-Rauf-Request: true`; a request without it gets **`403`**. This is the dashboard's CSRF guard —
  the frontend's fetch wrapper sets the header on every mutation.
- **Validate** is a read-only `GET`. It needs no header and no lock, and is safe to call during a live
  run.

A mutating action against a project with a **live loop** is rejected with **`409 LOCK_CONFLICT`** —
stop the loop first. The full error surface:

| HTTP  | When                                                     |
| ----- | -------------------------------------------------------- |
| `400` | bad project id, sandbox-escaping path, or malformed body |
| `403` | missing `X-Rauf-Request: true` on a `POST`               |
| `404` | no state/backlog file for the resolved root              |
| `409` | a loop is live (`LOCK_CONFLICT`)                         |
| `500` | filesystem failure (`IO_ERROR`)                          |

:::note[`resume --recover` is CLI-only]
The web **Resume** reconciles and relaunches, but it will **not** auto-commit interrupted-but-uncommitted
work. That re-verify-and-commit recovery is the CLI-only `rauf resume --recover`. When it's needed, the
web Resume tells you so in its result rather than guessing — drop to a terminal for that one step.
:::

## Targeting a non-default backlog root

Projects with more than one backlog root are supported in the UI: a **backlog-root selector** points the
dashboard at a non-default root, the web counterpart of the CLI's `--backlog <dir>` flag. See the
[Multi-backlog guide](../multi-backlog/) for how multiple roots work.

## Further reading

- [Web API Reference](../../spec-web/) — the full API surface, route by route, plus the frontend
  architecture.
- [Recovery & Troubleshooting](../recovery/) — the five recovery actions in detail.
- [Monitoring](../monitoring/) — status vocabulary and reading the event timeline.
- [Multi-backlog](../multi-backlog/) — targeting more than one backlog root.
