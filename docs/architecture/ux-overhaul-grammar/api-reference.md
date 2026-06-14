# API Reference — the v0.5.0 contract

The machine-facing contract this release defines: the **CLI grammar**, the **unified exit codes**, the
**`signal_parsed` enum**, and the **`events.ndjson` versioning discipline**. Values here are normative —
feature-forge and any tool driving rauf depend on them. Verified against the landed code (`@rauf/cli`,
`@rauf/core`, `@rauf/loop`).

## CLI grammar

### `rauf loop run [path]`

The single loop-execution verb.

| Flag | Meaning |
|------|---------|
| `--detached`, `-d` | Run detached: auto-start the server daemon, hand the loop to it, return immediately. (Replaces `loop start`.) |
| `--follow`, `-f` | With `--detached`: after the POST returns, attach the top-level `follow` view. Ctrl-C detaches the view only — the loop keeps running. |
| `--ndjson` | Stream loop events to stdout as NDJSON (one JSON `PersistedEvent`-shaped object per line). The machine-readable event stream (this is what feature-forge's `eventStreamCommand` uses). |
| `--json` | Emit the final result summary as JSON (distinct from `--ndjson`). |
| `--iterations <N>` | Max iterations (default: backlog-derived). |
| `--retries <N>` | Max retries per item before deferring (default: 3). |
| `--timeout <N>` | Per-iteration session timeout, minutes (default: 60). |
| `--model <name>` | Model override. |
| `--backlog <dir>` | Target a non-default backlog root (forwarded into the detached POST body). |
| `--review` / `--review-only` | Run a review pass after / instead of the iterations. |
| `--retry-blocked` | Unblock previously-blocked items before running. |
| `--create-branch <name>` | Create & switch to the branch first (CLI-side). |
| `--force` / `--allow-dirty` | Skip git preconditions / allow a dirty tree. |

Bare `loop run` is foreground + in-process (blocks, streams to the terminal, unattended-safe across a server
bounce). `loop run --detached` is server-owned and returns immediately.

### Other verbs

- `rauf loop stop [path]` — stop a detached/server-owned loop. (Foreground `loop run` is stopped with Ctrl-C.)
- `rauf loop review [path]` — standalone review pass (unchanged).
- `rauf status` / `log` / `follow` / `progress` — monitoring (Phase 1). Flag canon: `--follow`/`-f`,
  `--json`, `--backlog <dir>`, `--interval <seconds>`.

### Removed (no aliases)

| Removed | Replacement | Behavior on use |
|---------|-------------|-----------------|
| `loop start` | `loop run --detached` (`-d`) | exits `USAGE(2)`: `` `loop start` was removed in v0.5.0 — use `loop run --detached` (`-d`). `` |
| `--watch` (any command) | `--follow` (`-f`) | exits `USAGE(2)`: `` `--watch` was removed in v0.5.0 — use `--follow` (`-f`). `` |

The remediation is an **error message, not an alias** — it executes nothing, and fires before the generic
unknown-subcommand/flag error.

## Exit codes

The unified scheme (`ExitCode` in `packages/cli/src/commands.ts`), used by **both** `status` and `loop run`:

| Code | Name | Meaning |
|------|------|---------|
| 0 | `SUCCESS` | clean terminal: idle / complete |
| 1 | `ERROR` | generic failure |
| 2 | `USAGE` | bad args / IO / failed precondition (incl. loop-already-running 409, and removed-command remediation) |
| 3 | `NEEDS_HUMAN` | `PAUSED_HUMAN` |
| 4 | `LIMIT` | limit reached / usage-paused / sleeping |
| 5 | `BLOCKED` | terminal with blocked items |
| 6 | `RUNNING` | running — **query-time only (`status`)**; never a `loop run` terminal code |

### `loop run` terminal mapping

Over `LoopResult` (in order): a thrown/failed run → `ERROR(1)` (caller's catch); else
`needsHumanCount > 0` or `pausedReason === "needs_human"` → `NEEDS_HUMAN(3)`; limit/usage-paused/sleeping
terminal → `LIMIT(4)`; `blockedCount > 0` → `BLOCKED(5)`; otherwise (completed / idle / graceful-cancel) →
`SUCCESS(0)`. (`RUNNING(6)` is never returned — a finished run is not running.)

### `status` mapping

`statusExitCode(state, derived?)` over `LoopStateEnum`: `RUNNING`→6; `PAUSED_HUMAN`→3;
`LIMIT_REACHED`/`SLEEPING_LIMIT`/`WEEKLY_LIMIT`→4; `ERROR`→1; `IDLE`/`COMPLETE`/`PAUSED`→ `BLOCKED(5)` if the
backlog summary has genuine blocked items (derived), else `SUCCESS(0)`; `NOT_INSTALLED`→0.

### `backlog validate` (unchanged)

Keeps its own coherent triad: `0` valid · `1` findings · `2` usage/IO. It does **not** adopt the unified
scheme.

## `signal_parsed` event

The on-the-wire `signal` enum (`SignalParsedSchema`, `packages/core/src/schemas.ts`):

```
signal: "done" | "blocked" | "needs_human" | "review" | "none"
```

`"review"` (new in v0.5.0) is reported for a `RAUF_REVIEW` parse — no longer collapsed to `"done"`.
`state.json.lastSignal` is a separate vocabulary (`clean | blocked | needs_human | error`) and is unchanged.

## `events.ndjson` — versioned machine surface

- One `PersistedEvent` per line: the full `LoopEvent` (24-member discriminated union) ∩ `{ seq, schemaVersion }`.
- The live `--ndjson` stream and the persisted file carry the **same `LoopEvent` shapes**.
- **`EVENTS_SCHEMA_VERSION = "1"`** (`packages/core/src/schemas.ts`) — unchanged this release (the first
  *formal* version, not a breaking change).
- **Versioning discipline** (additive-only within a major version): no `type` discriminator value renamed or
  removed; no documented field removed; new event types / new optional fields are additive (no bump);
  **readers MUST ignore unknown `type`s and unknown fields**; `EVENTS_SCHEMA_VERSION` is bumped only on a
  breaking change.

## Version

`rauf version --json` → `{ "version": "0.5.0" }` (source: `packages/core/src/version.ts`). feature-forge's
`loopRunner.minRunnerVersion` gate (≥ 0.5.0 as of feature-forge 0.10.0) keys on this.

## When to rely on this contract

- **Driving rauf from a tool** (feature-forge, CI, a supervisor): branch on the exit codes above; read the
  `--ndjson` event stream and/or `status --json`; gate on `rauf version --json`.

## When NOT to

- **Don't branch on `6` from `loop run`** — it never returns `6` (that's `RUNNING`, query-time `status` only).
  A paused-for-human `loop run` exits `3`.
- **Don't expect `--json` to enable the `loop run` event stream** — that's `--ndjson`. `--json` is the final
  summary.
- **Don't treat `signal_parsed:"review"` as completion** — it indicates a review-pass payload, not a done item.
- **Don't add a second exit-code or flag spelling** — the canon is one name per concept.

## Further Reading

- [Architecture](./architecture.md) — why the codes/grammar are shaped this way
- [Migration Guide](./guides/migration.md)
- `docs/SPEC-CLI.md`, `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` — the full project specs (updated to v0.5.0)
