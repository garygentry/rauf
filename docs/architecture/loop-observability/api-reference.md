# API Reference

All types and functions below are exported from `@rauf/core`. Signatures reflect the
implementation; field docs are drawn from the runtime schemas.

## `deriveStatus(paths): Result<DerivedStatus>`

Builds the enriched status object for one backlog root in a **single read pass** (see
[architecture §1](./architecture.md)). Reads `state.json`, `iteration-status.json` (at
most once), `backlog.json`, and `.loop.lock`; never spawns a subprocess.

```ts
import { deriveStatus, resolveBacklogPaths } from "@rauf/core";

const paths = resolveBacklogPaths(projectRoot, backlogRoot);
if (paths.ok) {
  const res = deriveStatus(paths.value);
  if (res.ok) {
    const status = res.value; // DerivedStatus
  }
}
```

## `DerivedStatus`

The status contract. Validated by `DerivedStatusSchema`.

| Field                         | Type                                      | Meaning                                                                                |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `statusSchemaVersion`         | `"1"`                                     | Literal contract-version marker. A strict consumer rejects any other value.            |
| `loopState`                   | `LoopStateEnum`                           | Reconciled lifecycle state (`RUNNING`, `PAUSED_HUMAN`, `COMPLETE`, …).                 |
| `stateSource`                 | `"state.json" \| "log-parsing" \| "none"` | Where the state was derived from.                                                      |
| `iteration` / `maxIterations` | `number \| null`                          | Current iteration and cap.                                                             |
| `currentItem`                 | `string \| null`                          | The item id being worked, if any.                                                      |
| `lastSignal`                  | `string \| null`                          | Last parsed loop signal.                                                               |
| `startedAt`                   | `string \| null`                          | ISO start time of the run.                                                             |
| `elapsed`                     | `number \| null`                          | Whole seconds since `startedAt`.                                                       |
| `backlogSummary`              | `BacklogSummary`                          | Counts: `pending`, `inProgress`, `blocked`, `needsHuman`, `deferred`, `done`, `total`. |
| `lock`                        | `LockSummary \| undefined`                | Lock-file liveness: `present`, `alive`, `stale`, `pid`.                                |
| `sleepUntil`                  | `string \| null \| undefined`             | Wake time when sleeping on a usage limit.                                              |
| `health`                      | `Health \| null`                          | Live-iteration health hint; `null` when no iteration is live.                          |

### `Health`

An I/O-free projection of the live iteration's `iteration-status.json`. Facts, not
verdicts (see [architecture §2](./architecture.md)).

| Field                  | Type      | Meaning                                                                          |
| ---------------------- | --------- | -------------------------------------------------------------------------------- |
| `stuckWarning`         | `boolean` | Faithful mirror of `IterationStatus.stuckWarning` — the runner's own stall flag. |
| `iterationFresh`       | `boolean` | `updatedAt` within the freshness window (~60 s) of derivation time.              |
| `lastActivityAt`       | `string`  | Mirror of `IterationStatus.lastActivityAt` (ISO).                                |
| `secondsSinceActivity` | `number`  | Whole seconds since `lastActivityAt`, clamped `≥ 0`. Raw age, not a judgement.   |

`health` is `null` when no iteration is live, or when `iteration-status.json` is absent,
unparseable, or fails schema validation.

## `resolveTarget(opts): Result<ResolvedTarget, TargetError>`

Resolves CLI arguments + output context to a single backlog target, or a structured
reason it cannot. Context-aware; performs no `process`/TTY probing itself (the caller
supplies the context flags) and delegates all containment checks to the backlog-root
seam.

### `ResolveTargetOptions`

| Field              | Type                  | Meaning                                                                |
| ------------------ | --------------------- | ---------------------------------------------------------------------- |
| `pathArg`          | `string \| undefined` | The explicit root argument, if given.                                  |
| `backlogFlag`      | `string \| undefined` | The `--backlog <dir>` value, if given.                                 |
| `isMachineContext` | `boolean`             | `true` when output is machine-bound: `--json` **or** a non-TTY stdout. |
| `isTTY`            | `boolean`             | Whether stdout is an interactive terminal.                             |

### `ResolvedTarget` (success)

```ts
type ResolvedTarget =
  | { kind: "resolved"; root: string; backlogDir: string } // a concrete target to act on
  | { kind: "ambiguous"; candidates: ActiveLoopEntry[] }; // TTY pick-list; NEVER in machine context
```

### `TargetError` (failure)

```ts
interface TargetError {
  code: TargetErrorCode;
  message: string; // human-readable, single line
  offending?: string; // the path/flag that triggered it, when applicable
}

type TargetErrorCode =
  | "missing_target" // machine context, no path given
  | "ambiguous_target" // machine context, several active roots — hard fail
  | "not_found" // named/derived root does not exist
  | "outside_sandbox"; // containment failure
```

The CLI maps every `TargetError` to exit code `2` (usage error).

### Resolution behavior

| `pathArg` | context                      | outcome                                                              |
| --------- | ---------------------------- | -------------------------------------------------------------------- |
| given     | any                          | resolve it directly (`resolved`, or `not_found` / `outside_sandbox`) |
| absent    | machine (`--json` / non-TTY) | `err(missing_target)` — never scans                                  |
| absent    | TTY, 1 live loop             | `resolved` (that loop)                                               |
| absent    | TTY, ≥ 2 live loops          | `ok(ambiguous)` — pick-list                                          |
| absent    | TTY, 0 live loops            | `resolved` (cwd)                                                     |

## `eventAltitude(event): EventAltitude`

Pure, I/O-free classification of a `PersistedEvent`. Never throws. Consumed **only** by
the TTY `follow` renderer — never by `--json`/`--ndjson`.

```ts
type EventAltitude = "item" | "firehose";
```

| Altitude                             | Event types                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `firehose` (per-iteration narration) | `iteration_start`, `llm_spawned`, `llm_exited`, `llm_tool_activity`, `llm_token_update`                                                                                                                                                                                                                                              |
| `item` (milestones)                  | `loop_started`, `item_selected`, `signal_parsed`, `item_completed`, `item_blocked`, `item_retried`, `needs_human`, `loop_paused`, `usage_limit_hit`, `usage_limit_cleared`, `sleep_start`, `sleep_end`, `loop_completed`, `loop_error`, `loop_cancelled`, `review_started`, `review_completed`, `review_failed`, `llm_stuck_warning` |

An unrecognized runtime type falls through to `"firehose"` (surfaced in verbose view,
never dropped); a new type added without a case fails `typecheck` via the exhaustiveness
guard.

## CLI surfaces

| Command                                   | Notes                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rauf status [root] [--json] [--all]`     | Emits `DerivedStatus` (incl. `health`, `statusSchemaVersion`). No root + machine context → `missing_target` (exit 2). `--all` lists every live loop machine-wide and bypasses `resolveTarget`. On a TTY with no local loop, a bare `status` broadens to the `--all` view. |
| `rauf follow [root] [--json] [--verbose]` | Item-level feed with a sticky progress header by default. `--verbose` → full firehose, no header. `--json` → every event, no header. Same scope strictness as `status`.                                                                                                   |
