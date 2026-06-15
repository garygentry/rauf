# Guide — Recovering a loop from the web (+ status vocabulary)

A task-oriented guide for operators and integrators. Phase 4 closes the CLI↔web parity gap: every
recovery action you could run from the terminal now has a web endpoint and a status-page control, and
every surface names a loop state the same way.

## When to use this

- A loop in the web UI is **paused for human input**, **blocked**, hit a **usage limit**, or wedged,
  and you want to recover without dropping to a terminal.
- You're building a tool/UI on top of rauf and need the recovery contract.
- You're rendering loop status and want the canonical label/tone.

## When NOT to use this

- For the **re-verify-and-commit** recovery of interrupted-but-uncommitted work — that's the CLI-only
  `rauf resume --recover` (the web `resume` reconciles + relaunches and _tells you_ when CLI
  `--recover` is needed).
- To change _which_ model drives an iteration or the provider — out of scope (Part-B).

## The five recovery actions

Run them from the **Recovery** control group on the project status page, or via HTTP. Server binds
`127.0.0.1:5173`; every POST needs `-H 'X-Rauf-Request: true'`.

### Reset — clear loop state

Equivalent to CLI `reset`. Clears `state.json`, the DONE/CANCEL markers, resets stalled items; with
`clearBacklog` it also archives `progress.md`/`rauf.log` and empties the backlog.

```bash
curl -X POST http://127.0.0.1:5173/api/projects/<id>/reset \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' \
  -d '{ "clearBacklog": false }'
# → 200 { "data": { "stalledResetCount": 2, "stateCleared": true, ... } }
```

Reset **acquires and holds** the loop lock for the whole operation — if a loop is live you get
`409 LOCK_CONFLICT` ("a loop is running — stop it first"). The status-page button confirms before
firing.

### Resume — reconcile + relaunch

Equivalent to CLI `resume` (minus `--recover`). Reconciles committed work, requeues runner-deferred
false blocks, resets stalled items, then relaunches a detached loop if an eligible item exists.

```bash
# plain resume
curl -X POST http://127.0.0.1:5173/api/projects/<id>/resume \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' -d '{}'

# answer a needs-human item, retry blocked items, then resume
curl -X POST http://127.0.0.1:5173/api/projects/<id>/resume \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' \
  -d '{ "answers": [{ "itemId": "007", "text": "use Postgres" }], "retryBlocked": true }'
# → 200 { "data": { "reconciled": {...}, "relaunched": true } }
```

Reading the result:

- `relaunched: true` — a loop is running again.
- `relaunched: false` with `reason: "no eligible items"` — nothing to run (all done/blocked).
- `relaunched: false` with `reason: "...run \`rauf resume --recover\` from the CLI..."` — there is
  interrupted-but-uncommitted work the web won't auto-commit; finish it from the CLI.

Also acquire-and-hold guarded (`409` if a loop is live).

### Review — run a standalone review pass

Equivalent to CLI `loop review`. Starts a review-only pass over completed items; returns immediately.
Watch progress on the Event Timeline (the Phase-1 SSE stream).

```bash
curl -X POST http://127.0.0.1:5173/api/projects/<id>/loop/review \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' -d '{}'
# → 200 { "data": { "started": true } }   (409 CONFLICT if a loop is already running)
```

### Unblock — requeue blocked items

Equivalent to CLI `backlog unblock`. Unblocks all blocked items, or one by `itemId`.

```bash
curl -X POST http://127.0.0.1:5173/api/projects/<id>/backlog/unblock \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' \
  -d '{ "itemId": "004" }'        # omit itemId to unblock all
# → 200 { "data": { "unblockedCount": 1, "unblockedIds": ["004"] } }
```

Guarded by a lightweight live-loop check (`409` if a loop is live). An empty/no-blocked backlog is
**success** with `unblockedCount: 0`, not an error.

### Validate — check the backlog

Equivalent to CLI `backlog validate --json`. **Read-only `GET`** — no `X-Rauf-Request` header, no lock
guard, safe during a live run.

```bash
curl 'http://127.0.0.1:5173/api/projects/<id>/backlog/validate'
# → 200 { "data": { "valid": false, "findings": [ { "severity": "error", "code": "DUPLICATE_ID", ... } ] } }
```

A backlog with findings is still `200` — the findings are the payload.

## Error responses

All actions return `{ "error": { "code", "message", "details?" } }` on failure:

| HTTP | When                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| 400  | bad project id, sandbox-escaping path, or malformed body                                     |
| 403  | missing `X-Rauf-Request: true` on a POST (not the GET validate)                              |
| 404  | no backlog/state file for the resolved root                                                  |
| 409  | a loop is live on the backlog root (`LOCK_CONFLICT`; or review's already-running `CONFLICT`) |
| 500  | filesystem failure (`IO_ERROR`)                                                              |

## CLI ↔ web parity

| Action                              | CLI                       | Web                                          |
| ----------------------------------- | ------------------------- | -------------------------------------------- |
| Reset state                         | `rauf reset .`            | `POST /:id/reset`                            |
| Resume (reconcile + relaunch)       | `rauf resume .`           | `POST /:id/resume`                           |
| Re-verify + commit interrupted work | `rauf resume . --recover` | **CLI-only** (surfaced in `resume` `reason`) |
| Review pass                         | `rauf loop review .`      | `POST /:id/loop/review`                      |
| Unblock items                       | `rauf backlog unblock .`  | `POST /:id/backlog/unblock`                  |
| Validate backlog                    | `rauf backlog validate .` | `GET /:id/backlog/validate`                  |

## Status vocabulary

Every surface (CLI, projects dashboard, status page) now names a loop state identically, from the one
`STATE_LABELS` map. Notable: `PAUSED_HUMAN` shows **"Needs Human"** everywhere, and two states that
used to render silently are now distinct:

| Raw `state.json.status` | Derived              | Label                | `rauf status` exit code        |
| ----------------------- | -------------------- | -------------------- | ------------------------------ |
| `reviewing`             | `REVIEWING`          | Reviewing            | `6` (running)                  |
| `paused_usage_limit`    | `PAUSED_USAGE_LIMIT` | Usage Limit (Paused) | `4` (limit) — was a silent `0` |

If you script against `rauf status`, a usage-limited loop now exits `4`, not `0` — branch on it.

```ts
import { getStateLabel } from "@rauf/core";
getStateLabel(status.loopState).label; // human label for any derived state
```

## Further reading

- [README](../README.md) · [Architecture](../architecture.md) · [API Reference](../api-reference.md)
- `specs/ux-overhaul/CANON.md` §4.3 (status vocabulary) / §6 (CLI↔web parity)
