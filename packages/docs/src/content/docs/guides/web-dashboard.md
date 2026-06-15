---
title: The Web Dashboard
description: Start the server, discover projects, manage the backlog, read status badges, and recover loops from the browser.
---

The web dashboard is a React SPA served by a local Hono server (bound to `127.0.0.1`). It reads
the same on-disk substrate as the CLI, so it shows the same status for any loop — including ones
it didn't start.

![The observation substrate: a loop runner appends to state.json, events.ndjson, iteration-status.json, and rauf.log; the CLI, web dashboard, and external pipelines all reconstruct their view by reading those files.](../images/observation-model.svg)

:::note[Expanding in the content pass]
This is the scaffold for the Web Dashboard guide. The full walkthrough (server start, project
discovery, backlog CRUD, the status badges, recovery action buttons, the backlog-root selector)
lands in the content phase. The summary below is current as of v0.6.0.
:::

## Starting it

```bash
rauf server start   # serves the dashboard on http://127.0.0.1:5173
```

## Sources

- [Web API](../../spec-web/) — the API surface and the frontend.
- [Recovery & Troubleshooting](../recovery/) — the recovery actions the dashboard exposes.
