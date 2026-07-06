# Loop Observability

This feature makes an autonomous rauf loop **safe and cheap to supervise from its
files alone**. It builds on the observation substrate (the persisted `events.ndjson`
stream and the machine-wide active-loop registry) and adds four capabilities a
supervisor — human or agent — needs to drive a loop without ever reading a raw state
file or spawning a subprocess:

- A **health hint** on the status object, so one poll tells you whether the live
  iteration is making progress or stalling.
- A **versioned status contract**, so a machine consumer can trust the shape it parses.
- **Target-scope safety**, so a scripted `status`/`follow` never silently guesses which
  loop it means.
- **Event altitude + an item-level follow feed**, so a live view shows milestones by
  default and drops to the full firehose only on request.

The keystone is REQ-SUCCESS-01: **one `status --json` poll carries every input the
supervision decision tree needs** — loop state, health, lock liveness, and the
needs-human count — read once, with zero raw-file reads.

## Quick Start

Poll a loop's status — the object now carries a `statusSchemaVersion` and a `health`
block:

```bash
rauf status . --json
```

```jsonc
{
  "statusSchemaVersion": "1",
  "loopState": "RUNNING",
  "currentItem": "auth-007",
  "backlogSummary": { "pending": 5, "inProgress": 1, "blocked": 0, "needsHuman": 0, "done": 2, "total": 8 },
  "lock": { "present": true, "alive": true, "stale": false, "pid": 12345 },
  "health": {
    "stuckWarning": false,
    "iterationFresh": true,
    "lastActivityAt": "2026-07-06T03:10:30.637Z",
    "secondsSinceActivity": 4
  }
}
```

Follow a loop with the **item-level feed** (milestones + a sticky progress header),
or pass `--verbose` for the full per-iteration firehose:

```bash
rauf follow .            # item-level: milestones only, with a sticky header
rauf follow . --verbose  # firehose: every event, no header (unchanged legacy behavior)
```

Consume the same contract programmatically from `@rauf/core`:

```ts
import { deriveStatus, resolveBacklogPaths, eventAltitude, resolveTarget } from "@rauf/core";

const paths = resolveBacklogPaths(projectRoot, backlogRoot);
if (paths.ok) {
  const status = deriveStatus(paths.value); // one call → loopState + health + lock + backlogSummary
  if (status.ok) {
    const s = status.value;
    const stalling = s.health?.stuckWarning === true;
    const needsHuman = s.backlogSummary.needsHuman > 0;
  }
}
```

## Key Concepts

**The health hint (`health`).** An I/O-free projection of the live iteration's
`iteration-status.json`, attached to the status object. It carries `stuckWarning`
(a faithful mirror of the runner's own stall flag), `iterationFresh` (was the iteration
file updated within the ~60s freshness window), `lastActivityAt`, and
`secondsSinceActivity` (raw age in whole seconds, clamped ≥ 0 — a fact, not a verdict).
`health` is `null` when no iteration is live. See the
[supervision guide](./guides/supervision.md) for how a supervisor uses it.

**The status schema version (`statusSchemaVersion`).** A literal `"1"` on every status
object. It is the machine contract's compatibility guard: a consumer that requires the
enriched shape can reject anything whose version it does not understand. The health
block was added **additively** — existing fields kept their names and types — so a
pre-existing consumer that ignores the new keys still works.

**Target-scope safety (`resolveTarget`).** In **machine context** (`--json` or a
non-TTY stdout) a `status`/`follow` with no explicit root does **not** guess: it returns
a structured `missing_target` error rather than scanning and picking a loop. On an
interactive **TTY** the old ergonomics stand — cwd default, or a pick-list when several
loops are live. This keeps scripts deterministic while keeping the terminal friendly.

**Event altitude + the item-level feed.** Every persisted event is classified as
`"item"` (a milestone: item completed/blocked, needs-human, loop lifecycle, review,
stuck-warning) or `"firehose"` (per-iteration narration: spawn/exit, tool and token
activity). The `follow` feed shows **item** events by default under a sticky progress
header; `--verbose` restores the full firehose. The classification is a pure, I/O-free
function consumed **only** by the TTY renderer — it never touches the `--json`/`--ndjson`
machine surfaces.

## Package Exports

All of this ships in `@rauf/core` (data + logic) and is wired into the CLI commands.

| Export (`@rauf/core`) | Description |
|---|---|
| `deriveStatus(paths)` | Builds the enriched `DerivedStatus` (incl. `health`, `statusSchemaVersion`, `lock`) from a single read pass. |
| `Health`, `DerivedStatus` (types) | The status contract; `HealthSchema`/`DerivedStatusSchema` validate it. |
| `resolveTarget(opts)` | Context-aware target resolution → `ResolvedTarget` or a structured `TargetError`. |
| `TargetErrorCode`, `TargetError`, `ResolvedTarget`, `ResolveTargetOptions` | The resolution contract types. |
| `eventAltitude(event)` | Classifies a `PersistedEvent` as `"item"` or `"firehose"`. |
| `EventAltitude` (type) | The altitude union. |

| CLI surface | Description |
|---|---|
| `rauf status [root] [--json] [--all]` | Status poll; enforces machine-context scope strictness; `--all` lists every live loop machine-wide. |
| `rauf follow [root] [--json] [--verbose]` | Live feed; item-level with sticky header by default, firehose under `--verbose`. |

## Configuration

This feature adds **no new configuration surface**. The iteration-freshness window
(~60 s) reuses the existing shared constant that governs loop-liveness derivation.

## Further Reading

- [Architecture](./architecture.md) — the single-read invariant, the contract-version
  rationale, and why scope strictness is context-gated.
- [API Reference](./api-reference.md) — exact signatures and field semantics.
- [Supervision Guide](./guides/supervision.md) — the poll-driven recipe: one status
  poll → the full supervision decision.
