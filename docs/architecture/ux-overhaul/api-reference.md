# API Reference — Observation Substrate

Every public symbol Phase 1 adds to `@rauf/core`, with its real signature, semantics, and a
usage example. All functions return the project's `Result<T>` type (`{ ok: true, value } |
{ ok: false, error }`) and **never throw for expected errors** — check `.ok` before using
`.value`.

Import everything from the package barrel:

```ts
import {
  appendEvent, readEvents, watchEvents, rotateEventsLog,
  registerLoop, deregisterLoop, updateLoopStatus, listActiveLoops, registryEntryPath,
  appendLine, readNdjson,
  surfaceInspectedStatus, surfaceInspectedDir,
  checkLockFile,
  EVENTS_SCHEMA_VERSION, TOKEN_COALESCE_MS, EVENTS_LOG_FILENAME,
  type PersistedEvent, type ActiveLoopEntry, type InspectedStatusContext,
} from "@rauf/core";
```

---

## Event log — `events-log.ts`

### `appendEvent(paths, record): Result<void>`

```ts
function appendEvent(paths: BacklogPaths, record: PersistedEvent): Result<void>
```

Append one persisted event to `paths.eventsLog`. The path is sandbox-validated to
`paths.stateDir` before writing — an out-of-sandbox path returns `err(PATH_VIOLATION)` and
writes nothing. The record is serialized to a single line.

The **runner is the single writer**; its `persistEvent` discards this call's `Result`
(best-effort), so a returned `err` is silently swallowed there. Direct callers are rare —
prefer letting the runner emit events.

- Returns `ok(undefined)` on success; `err(PATH_VIOLATION)` on sandbox escape; `err(IO_ERROR)`
  on fs failure.

### `readEvents(paths): Result<PersistedEvent[]>`

```ts
function readEvents(paths: BacklogPaths): Result<PersistedEvent[]>
```

Read the **current run's** persisted events, in `seq` order. The replay half of `follow`'s
"replay then tail." Reads the current run only — the file resets per run, so prior runs are
not stitched in. Torn-trailing-line tolerant (a partial last line is skipped); a missing file
returns `ok([])` (graceful absence).

```ts
const events = readEvents(paths);
if (events.ok) {
  for (const e of events.value) console.log(e.seq, e.type);
}
```

### `watchEvents(paths, onRecords): () => void`

```ts
function watchEvents(
  paths: BacklogPaths,
  onRecords: (records: PersistedEvent[]) => void,
): () => void
```

Tail `paths.eventsLog` for newly-appended records. Returns a **bare cleanup function** (not a
`{ close }` handle) — the same unsubscribe idiom as `watchLog`. `onRecords` is called with each
non-empty batch of new records.

Tracks a byte offset and re-reads `[offset, EOF)` on each change, advancing the offset only past
the last newline — a partial trailing line is re-read and completed on the next fire, never
emitted half-parsed. `fs.watch` can miss fires under rapid writes, so re-reading from the offset
is self-correcting; pair it with an interval poll as a safety net where `fs.watch` is
unavailable.

```ts
const stop = watchEvents(paths, (records) => {
  for (const r of records) render(r);
});
// later…
stop();
```

### `rotateEventsLog(paths): Result<void>`

```ts
function rotateEventsLog(paths: BacklogPaths): Result<void>
```

Move the prior run's `events.ndjson` to `paths.archive` as `{ts}-events.ndjson`, so the live
file holds only the current run. Called once at `runner.start()` (before the first event is
emitted, where the runner also resets its `seq` counter to 0). A no-op if there is no existing
file. **You generally do not call this directly** — the runner owns rotation.

---

## Active-loop registry — `loop-registry.ts`

### `registerLoop(entry): Result<void>`

```ts
function registerLoop(entry: ActiveLoopEntry): Result<void>
```

Write the loop's registry entry to `~/.rauf/active/<sha256(resolve(stateDir))[:16]>.json`. The
runner calls this at start, **after** acquiring the lock. One file per loop — structurally
concurrency-safe.

### `deregisterLoop(stateDir): Result<void>`

```ts
function deregisterLoop(stateDir: string): Result<void>
```

Remove the registry entry for `stateDir`. The runner calls this in the run's `finally`. Crash
safety does not depend on it — `listActiveLoops` self-heals an entry whose loop is no longer
live — but a clean exit removes its own entry immediately.

### `updateLoopStatus(stateDir, status): Result<void>`

```ts
function updateLoopStatus(stateDir: string, status: LoopStateStatus): Result<void>
```

Refresh the **advisory** `status` field of an existing entry. The runner pairs this with its
`state.json` writes. Remember: `state.json` stays authoritative — this field is a convenience
for the cross-root listing and must not be trusted over it. A missing entry is a no-op.

### `listActiveLoops(): Result<ActiveLoopEntry[]>`

```ts
function listActiveLoops(): Result<ActiveLoopEntry[]>
```

List every confirmed-live loop, machine-wide, **reconciled on read**. For each entry it: parses
(skipping corrupt/foreign files), reads `{stateDir}/.loop.lock` via `checkLockFile` and requires
it locked + not stale + `pid`-matching, and **self-heals** (unlinks) any entry that fails. Returns
only live entries, sorted by `stateDir`. A missing `~/.rauf/active/` returns `ok([])`. Pure file
reads — no subprocess.

```ts
const live = listActiveLoops();
if (live.ok) {
  for (const loop of live.value) {
    console.log(`${loop.backlogRoot} — ${loop.status} (pid ${loop.pid})`);
  }
}
```

### `registryEntryPath(stateDir): string`

```ts
const registryEntryPath: (stateDir: string) => string
```

Compute the absolute registry-entry path for a state dir (the `sha256(...)[:16].json` under
`~/.rauf/active/`). Useful for tests and tooling.

---

## NDJSON primitives — `fs-utils.ts`

The two filesystem helpers the event log is built on. General-purpose; reusable for any
newline-delimited JSON file.

### `appendLine(filePath, line): Result<void>`

```ts
function appendLine(filePath: string, line: string): Result<void>
```

Append a single line (ensuring a trailing newline). Catches fs errors and returns
`err(IO_ERROR)` rather than throwing.

### `readNdjson<T>(filePath, schema): Result<T[]>`

```ts
function readNdjson<T>(filePath: string, schema: z.ZodType<T>): Result<T[]>
```

Read and schema-validate a newline-delimited JSON file. **Tolerates a torn trailing line**: any
line that fails `JSON.parse` or schema validation is skipped, not fatal. A missing file returns
`ok([])`. A non-strict schema also tolerates unknown future fields (additive-only), so a newer
producer can add fields without breaking an older reader.

```ts
const records = readNdjson(filePath, PersistedEventSchema);
```

---

## Status surfacing — `status.ts`

### `surfaceInspectedStatus(paths, status): InspectedStatusContext`

```ts
function surfaceInspectedStatus(paths: BacklogPaths, status: DerivedStatus): InspectedStatusContext
```

Build the "empty is never silent" context from a resolved `BacklogPaths` and its already-derived
`DerivedStatus`. Delegates to `surfaceInspectedDir`.

### `surfaceInspectedDir(inspectedDir, empty): InspectedStatusContext`

```ts
function surfaceInspectedDir(inspectedDir: string, empty: boolean): InspectedStatusContext
```

The raw-path entry point, for when no `DerivedStatus`/`BacklogPaths` could be resolved (e.g. an
uninstalled or unresolvable root) but the read must still not go silent. Both functions read the
reconciled registry and exclude the inspected root itself; the filtering lives here, in one place.

```ts
interface InspectedStatusContext {
  inspectedDir: string;          // the state dir that was inspected (always present)
  empty: boolean;                // true when the root has no usable state of its own
  liveElsewhere: ActiveLoopEntry[]; // loops live in OTHER roots (reconciled, self-excluded)
}
```

A registry read failure yields an empty `liveElsewhere` rather than hiding the inspected
directory — REQ-DISC-01 (name the directory) holds even when REQ-DISC-02 (cross-root liveness)
cannot.

---

## Lock liveness — `lock.ts`

### `checkLockFile(lockPath): Result<LockStatus>`

```ts
function checkLockFile(lockPath: string): Result<LockStatus>
```

Determine liveness of a lock at an **arbitrary path** (extracted from `checkLock` so the registry
can reconcile any loop's lock, not just the current root's). `LockStatus` reports whether the lock
is held, whether it is stale, and the holding `pid`. This is the reconciliation primitive behind
`listActiveLoops`.

---

## Types & constants — `schemas.ts`, `backlog-root.ts`

### `PersistedEvent`

```ts
type PersistedEvent = LoopEvent & { seq: number; schemaVersion: string };
```

One line of `events.ndjson`: a full `LoopEvent` plus a per-run dense `seq` (assigned only on
write — gaps mean corruption, not coalescing; reset to 0 each run) and a `schemaVersion` tag.
Flat by design, so a reader needs no join to interpret a record.

### `ActiveLoopEntry`

```ts
type ActiveLoopEntry = {
  stateDir: string;     // resolved (absolute) state dir — the registry key source + reconcile anchor
  projectPath: string;  // project root containing the .rauf.json marker
  backlogRoot: string;  // the --backlog root (projectPath/.rauf for the default root)
  pid: number;          // runner OS pid, used for liveness reconciliation
  startedAt: string;    // ISO-8601 registration timestamp
  status: LoopStateStatus; // ADVISORY last-known status — never trust over state.json
};
```

### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `EVENTS_LOG_FILENAME` | `"events.ndjson"` | Event-log file name within a state dir |
| `EVENTS_SCHEMA_VERSION` | `"1"` | Record schema version (forward-stable; bumped only under the Phase-3 versioning discipline) |
| `TOKEN_COALESCE_MS` | `1000` | Min ms between persisted `llm_token_update` records |

### `BacklogPaths` additions

`resolveBacklogPaths()` now also returns:

| Field | Value |
|-------|-------|
| `eventsLog` | `<stateDir>/events.ndjson` |
| `archive` | `<stateDir>/archive` (rotation target for prior runs) |

## When to use these directly

- **Building a custom observer** (a dashboard, an alerting hook, a pipeline gate) → `readEvents`
  + `watchEvents` for the stream, `listActiveLoops` for liveness, `deriveStatus` for status.
- **Reading another tool's NDJSON** → `readNdjson` with your own schema.

## When NOT to use these directly

- **Don't call `appendEvent` / `rotateEventsLog` / `registerLoop` / `updateLoopStatus` /
  `deregisterLoop` yourself** — the runner owns the write side. A second writer breaks the
  single-writer invariant that makes read tolerance correct.
- **Don't trust `ActiveLoopEntry.status`** as a loop's real status — read `state.json` (via
  `deriveStatus`) for that.
- **Don't infer liveness from `state.json.updatedAt`** — use `listActiveLoops` (lock-reconciled)
  or `checkLockFile`.
