# UX Overhaul — Phase 2+3: Command Grammar & Contract Flip (v0.5.0)

This is the **breaking release** of the rauf UX/DX overhaul. It builds on Phase 1's observation
substrate (see [`../ux-overhaul/`](../ux-overhaul/)) and lands as **rauf v0.5.0** — the one coordinated
moment of breakage, after which the command surface and machine contract are coherent.

It changes the *surface and contract*, not the engine: the `LoopRunner`, the server daemon, and the
file-backed observation substrate are reused untouched. What changed:

- **One loop verb.** `loop run [--detached]` replaces the `loop run` / `loop start` split. Bare `loop run`
  is foreground/in-process; `loop run --detached` (`-d`) is the server-owned, returns-immediately mode.
  `loop start` is **removed** (with a targeted remediation error).
- **Unified exit codes.** `status` and `loop run` now share one scheme — no more `1=running` vs `1=error`
  collision, no more `status`(2/3) vs `loop run`(6) disagreement.
- **Explicit `review` signal.** `signal_parsed` reports `review` truthfully instead of collapsing it to
  `done`.
- **`events.ndjson` is a versioned, additive-only machine surface.**
- **Flag canon.** `--follow`/`-f`, `--json`, `--backlog`, `--interval` are consistent everywhere; `--watch`
  is gone.

Migrating from a pre-0.5.0 rauf? Jump to the [Migration Guide](./guides/migration.md).

## Quick Start

```bash
# Foreground, in-process (the default — blocks, streams to terminal, survives a server bounce)
rauf loop run .

# Detached: server-owned, returns immediately (replaces the old `loop start`)
rauf loop run . --detached            # or -d

# Detach AND attach the live view (Ctrl-C detaches the view; the loop keeps running)
rauf loop run . --detached --follow

# Stop a detached/server-owned loop
rauf loop stop .

# Machine-readable event stream from a run (NDJSON, one event per line)
rauf loop run . --ndjson
```

## Key Concepts

**One verb, the flag names the intent.** Whether a loop runs in-process or under the server daemon is an
implementation detail. `loop run` is the single verb; `--detached` selects the runs-without-me mode. A
detached run auto-starts the server daemon and returns immediately; you observe it with `rauf follow` (or
the web) and stop it with `rauf loop stop`. (Canon principle P2 — hide the mode, don't change it.)

**Two flag families, kept distinct.** `--follow`/`-f` is the *monitoring* follow (on `status`, `log`,
`follow`, and `loop run --detached --follow`). `--ndjson` is the *event-stream* flag on `loop run` — the
machine-readable per-event stream feature-forge consumes. `--json` is the *final-result* / status JSON. They
don't overlap.

**One exit-code contract.** Both `status` (current state) and `loop run` (terminal outcome) map to the same
table (see [API Reference](./api-reference.md#exit-codes)). It's a machine contract — feature-forge and any
tool branching on rauf's exit status depend on the exact values.

**Removed means removed — but with a signpost.** `loop start` and `--watch` are gone (no aliases). Invoking
them exits non-zero with a targeted message naming the replacement; they execute nothing.

## Command surface at a glance

| Command | What it does |
|---------|--------------|
| `loop run [path]` | Run a loop in-process (foreground, blocking) |
| `loop run [path] --detached` / `-d` | Run detached (server-owned, returns immediately) |
| `loop run … --detached --follow` | Detach, then attach the live view |
| `loop run … --ndjson` | Stream events as NDJSON (machine-readable) |
| `loop stop [path]` | Stop a detached/server-owned loop |
| `loop review [path]` | Standalone review pass (unchanged) |
| `status` / `log` / `follow` / `progress` | Monitoring (Phase 1; `--follow`/`-f`, `--json`, `--backlog`, `--interval`) |
| ~~`loop start`~~ | **removed** → `loop run --detached` |
| ~~`--watch`~~ | **removed** → `--follow` |

## Configuration

No new user configuration. The contract constants live in `@rauf/core`:

| Constant | Value | Meaning |
|----------|-------|---------|
| `EVENTS_SCHEMA_VERSION` | `"1"` | events.ndjson record schema version (unchanged this release — first *formal* version) |
| rauf version (`packages/core/src/version.ts`) | `0.5.0` | reported by `rauf version --json`; feature-forge's `minRunnerVersion` gate keys on it |

## Further Reading

- [Architecture](./architecture.md) — design decisions and how the change reuses the engine
- [API Reference](./api-reference.md) — the machine contract: grammar, exit codes, signal enum, events versioning
- [Migration Guide](./guides/migration.md) — moving from a pre-0.5.0 rauf (and keeping feature-forge in lockstep)
- [`../ux-overhaul/`](../ux-overhaul/) — Phase 1 (observation substrate) this builds on
- `specs/ux-overhaul/CANON.md` — the cross-cutting north-star for the whole overhaul
