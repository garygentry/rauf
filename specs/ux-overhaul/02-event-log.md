# 02 — Event Log Subsystem

The event-log subsystem persists the loop runner's in-memory `LoopEvent` stream to an append-only
`events.ndjson` in each backlog root's state directory, and reads it back. This is the **keystone** of
Phase 1 (PRD §1): once every event is on disk, every observer — CLI, web, external agent —
reconstructs loop activity from files, dissolving the in-process-vs-server observability asymmetry by
construction.

This document covers three loci:

- **`packages/core/src/events-log.ts` (NEW)** — `appendEvent`, `readEvents`, `rotateEventsLog`,
  `watchEvents`.
- **`packages/core/src/fs-utils.ts` (EDIT)** — the `appendLine` and `readNdjson<T>` primitives
  (torn-line tolerant).
- **`packages/loop/src/runner.ts` (EDIT, wire-up)** — the `persistEvent` hook inside `emitEvent()`:
  the per-run `seq` counter, `llm_token_update` coalescing, `rotateEventsLog` + `seq` reset at
  `start()`, and the best-effort (silent, `Result`-discarding) persistence.

All shared types (`PersistedEvent` / `PersistedEventSchema`, `EVENTS_SCHEMA_VERSION`,
`TOKEN_COALESCE_MS`, `EVENTS_LOG_FILENAME`, `IO_ERROR`, `BacklogPaths.eventsLog`) are defined in
[`00-core-definitions.md`](./00-core-definitions.md) and are **referenced, never redefined, here**.
Decisions trace to [`tech-spec.md`](./tech-spec.md) (`D1`–`D9`, §3.1–§3.3, §7).

---

## Requirement Coverage

| REQ ID      | Requirement                                                                | Section            |
| ----------- | -------------------------------------------------------------------------- | ------------------ |
| REQ-EVT-01  | Persist every `LoopEvent` to an append-only `events.ndjson` in the state dir | 3, 5               |
| REQ-EVT-02  | Coalesce `llm_token_update` to ≈≤1/sec; persist everything else immediately | 5.1, 5.2           |
| REQ-EVT-03  | Self-describing records: `type` + timestamp + dense per-run `seq`           | 5.2 (schema in 00) |
| REQ-EVT-05  | Reset per run: rotate to archive at `start()`, begin fresh                  | 3.3, 5.3           |
| REQ-EVT-06  | Append whole lines, one write per event; single writer per root            | 4.1, 7.2           |
| REQ-EVT-07  | Write only inside the backlog root's state directory (sandbox)             | 3.1, 6             |
| REQ-PERF-01 | Persistence must not meaningfully slow the loop (best-effort, no `fsync`)   | 4.1, 5.1, 7.1      |
| REQ-PERF-02 | Live observers reflect a new event within ≈1s (watch over poll)            | 3.4, 4.2           |
| REQ-REL-01  | Tolerate a torn/partial trailing line; never crash                         | 4.2, 7.2           |
| REQ-REL-02  | Status never replays the log; tail-loss after crash loses no status        | 7.1, 8             |
| REQ-REL-03  | Missing/absent log → `ok([])`; observers degrade gracefully                | 4.2, 6, 7.3        |
| REQ-SEC-01  | Sandbox-validate every append against the state dir                        | 3.1, 6             |
| REQ-OBS-04  | `follow` history-replay primitive (at `readEvents`/`watchEvents` level)    | 3.2, 3.4           |

> Scope boundary: REQ-OBS-04 is covered here **only** at the `readEvents` / `watchEvents` primitive
> level (replay-then-tail). The CLI `follow` command that consumes these primitives is owned by
> [`04-cli-monitoring-surface.md`](./04-cli-monitoring-surface.md); the web `/loop/events` tail is
> owned by [`05-web-observation-parity.md`](./05-web-observation-parity.md).

---

## 1. Module Overview

**New file:** `packages/core/src/events-log.ts`
**Edited file:** `packages/core/src/fs-utils.ts`
**Edited file (wire-up only):** `packages/loop/src/runner.ts`

### 1.1 `events-log.ts` imports

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { appendLine, readNdjson, validatePath, ensureDir } from "./fs-utils.js";
import type { BacklogPaths } from "./backlog-root.js";
import { PersistedEventSchema, type PersistedEvent } from "./schemas.js";
```

**Exports:** `appendEvent`, `readEvents`, `rotateEventsLog`, `watchEvents` (re-exported from
`packages/core/src/index.ts` via `export * from "./events-log.js"` — see
[`01-architecture-layout.md`](./01-architecture-layout.md) §3).

`PersistedEvent` / `PersistedEventSchema` are defined in `schemas.ts` per
[`00-core-definitions.md`](./00-core-definitions.md) §1.1 — this module imports them, it does not
define them.

### 1.2 `fs-utils.ts` additions

Two new primitives sit beside the existing `atomicWrite` (`fs-utils.ts:13`), `validatePath`
(`fs-utils.ts:140`), `fileExists` (`fs-utils.ts:167`), and `ensureDir` (`fs-utils.ts:180`). They use
the same `Result<T>` / `ok` / `err` pattern from `errors.ts:9` — the `{ ok, value }` / `{ ok, error }`
shape, **not** `{ success, data }`. `readNdjson` imports `z` as a type (matching the existing
`import type { z } from "zod"` at `fs-utils.ts:4`).

`appendLine` and `readNdjson` are the **only** new code that returns the new `ErrorCodes.IO_ERROR`
member added in [`00-core-definitions.md`](./00-core-definitions.md) §3.1.

---

## 2. Architecture: who owns what (D1)

The single most important boundary in this subsystem (tech-spec D1, architecture rule #1):

| Concern                                   | Owner            | Why                                                                       |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| Per-run `seq` counter, coalescing clock   | **runner**       | Run-scoped state; core is stateless. (§5.1, §5.2)                         |
| Path sandbox validation on append         | **core**         | `appendEvent` calls `validatePath` (REQ-SEC-01). (§3.1)                   |
| `fs.appendFileSync` of one whole line     | **core**         | All filesystem logic lives in core (rule #1). (§4.1)                      |
| Rotation at start                         | **core**         | `rotateEventsLog`; runner only *calls* it. (§3.3)                         |
| Best-effort (silent) persistence          | **runner**       | The loop must never crash/block on a log write; `appendEvent`'s `Result` is discarded (REQ-PERF-01). (§5.1) |

The runner is the **single writer per root** (REQ-EVT-06); CLI, web, and external agents are read-only
against `events.ndjson`. This single-writer invariant is the load-bearing premise for torn-write
correctness (§7.2).

---

## 3. `events-log.ts` — the four functions

All four take `BacklogPaths` and read/write `paths.eventsLog`
(= `paths.stateDir/events.ndjson`, the additive field defined in
[`00-core-definitions.md`](./00-core-definitions.md) §1.3). Because `eventsLog` is derived purely from
`stateDir`, it inherits per-root isolation and the path sandbox automatically.

### 3.1 `appendEvent` (REQ-EVT-01, REQ-EVT-07, REQ-SEC-01) — D1

Append one persisted event. The path is sandbox-validated against the state dir **before** any write,
so a misconfigured `paths` can never escape the sandbox (REQ-SEC-01 / architecture rule #3).

```typescript
/**
 * Append one persisted event to events.ndjson (REQ-EVT-01).
 *
 * The path is sandbox-validated to the backlog root's state directory before
 * writing (REQ-EVT-07 / REQ-SEC-01): an out-of-sandbox path returns
 * PATH_VIOLATION and writes nothing. The record is serialized to a single line
 * via appendLine (one whole-line write per event — REQ-EVT-06).
 *
 * The RUNNER is the single writer; the runner's persistEvent (§5.1) discards
 * this call's Result (best-effort), so a returned err is silently swallowed there.
 *
 * @param paths  Backlog root paths (uses paths.eventsLog, validated to paths.stateDir).
 * @param record A LoopEvent already enriched with seq + schemaVersion (PersistedEvent).
 * @returns ok(undefined) on success; err(PATH_VIOLATION) on sandbox escape;
 *          err(IO_ERROR) on fs failure (propagated from appendLine).
 */
export function appendEvent(paths: BacklogPaths, record: PersistedEvent): Result<void> {
  const guard = validatePath(paths.eventsLog, [paths.stateDir]);
  if (!guard.ok) return guard;
  return appendLine(paths.eventsLog, JSON.stringify(record));
}
```

`validatePath(target, [root])` (`fs-utils.ts:140`) returns `err(PATH_VIOLATION)` unless `target`
resolves to `root` itself or under `root + path.sep`. Passing `[paths.stateDir]` as the only allowed
root means `events.ndjson` is provably written **inside** the state directory and nowhere else
(REQ-EVT-07).

### 3.2 `readEvents` (REQ-EVT-01, REQ-OBS-04, REQ-REL-03) — read the current run

Read the current run's events, ordered by file order (which is `seq` order, since the single writer
appends in `seq` sequence). This is the **history-replay primitive** the CLI `follow` command and the
web `/loop/events` tail call on attach (REQ-OBS-04): replay everything written so far, then tail.

```typescript
/**
 * Read the current run's persisted events, in seq order (REQ-EVT-01).
 *
 * This is the history-replay half of `follow`'s "replay then tail" attach
 * (REQ-OBS-04): a late observer calls readEvents to get full current-run
 * context, then watchEvents to receive new records. It reads the CURRENT run
 * only — the file resets per run (§3.3), so prior runs are NOT stitched in
 * (tech-spec D9 / OQ-6).
 *
 * Torn-line tolerant via readNdjson (REQ-REL-01): a partial trailing line is
 * skipped, earlier records always returned. Absent file → ok([]) (REQ-REL-03),
 * so an existing install with no events.ndjson reads as "no events," not an error.
 *
 * @param paths Backlog root paths (uses paths.eventsLog).
 * @returns ok(PersistedEvent[]) — possibly empty; err(IO_ERROR) only on a read
 *          failure that is NOT mere absence (absence is ok([])).
 */
export function readEvents(paths: BacklogPaths): Result<PersistedEvent[]> {
  return readNdjson(paths.eventsLog, PersistedEventSchema);
}
```

`readEvents` is a thin wrapper: all torn-line tolerance and missing-file → `ok([])` behavior lives in
`readNdjson` (§4.2). Records are returned in append order; because `seq` is dense and monotonic
(§5.2), append order **is** `seq` order, so callers may rely on the array being seq-ordered without
re-sorting.

### 3.3 `rotateEventsLog` (REQ-EVT-05) — reset per run — D4

At the start of each loop run, the previous run's `events.ndjson` is moved into the existing archive
mechanism, then the path is left empty for a fresh run. This satisfies REQ-EVT-05 ("the event log
resets per loop run … the prior run's log MUST be preserved in the existing archive mechanism, not
discarded").

```typescript
/**
 * Rotate events.ndjson at loop start (REQ-EVT-05 / tech-spec D4).
 *
 * Moves an existing {stateDir}/events.ndjson to
 * {stateDir}/archive/{ts}-events.ndjson, then leaves the path empty so the run
 * begins a fresh file. ts = YYYYMMDD-HHMMSS, IDENTICAL to the archive naming in
 * reset.ts:archiveTimestamp() (reset.ts:39-44) and the {ts}-rauf.log /
 * {ts}-progress.md archives it produces (reset.ts:99, reset.ts:120).
 *
 * No-op (returns ok) if the file is absent — a first-ever run has nothing to
 * rotate (REQ-COMPAT-01). The archive directory is created on demand via
 * ensureDir (mirrors reset.ts:95 / reset.ts:117).
 *
 * Path-validated to the state dir before the rename (REQ-SEC-01).
 *
 * Rotation-failure policy (D4 — truncate-on-fail): if the archive rename fails, the
 * function TRUNCATES events.ndjson to empty before returning err, so the new run
 * still begins from a clean file. This preserves the per-run invariants — dense,
 * monotonic seq from 0 and the never-contradict guarantee (§8, REQ-OBS-02) — at the
 * cost of losing the prior run's archive (acceptable: archiving is itself best-effort,
 * REQ-EVT-05; a lost archive is the lesser harm versus a self-contradicting log).
 *
 * @param paths Backlog root paths (uses paths.eventsLog, paths.archive, paths.stateDir).
 * @returns ok(undefined) on success or no-op; err(IO_ERROR) on mkdir/rename failure
 *          (file is truncated to empty in this case); err(PATH_VIOLATION) if the source
 *          path escapes the sandbox.
 */
export function rotateEventsLog(paths: BacklogPaths): Result<void> {
  // No-op if there is nothing to rotate (first-ever run / REQ-COMPAT-01).
  if (!fileExists(paths.eventsLog)) return ok(undefined);

  const guard = validatePath(paths.eventsLog, [paths.stateDir]);
  if (!guard.ok) return guard;

  const dirResult = ensureDir(paths.archive);
  if (!dirResult.ok) return dirResult;

  const ts = eventsArchiveTimestamp(); // YYYYMMDD-HHMMSS, see note below
  const archivePath = path.join(paths.archive, `${ts}-events.ndjson`);
  try {
    fs.renameSync(paths.eventsLog, archivePath);
    return ok(undefined);
  } catch (e) {
    // Archive rename failed. TRUNCATE to empty (truncate-on-fail, D4) so the new run
    // starts from a clean file instead of appending seq:0,1,… after the prior run's
    // seq:0,1,… — which a reader would interpret as corruption / a stale terminal
    // event (violating the seq-monotonicity + never-contradict invariants, §8). The
    // prior run's archive is lost; acceptable per REQ-EVT-05 (archiving is best-effort).
    try {
      fs.writeFileSync(paths.eventsLog, "");
    } catch {
      /* truncate also failed — best-effort; runner ignores the Result either way */
    }
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `Failed to rotate events.ndjson (archive); truncated for a fresh run: ${String(e)}`,
      details: { path: paths.eventsLog },
    });
  }
}
```

**Archive timestamp — confirmed pattern.** `reset.ts:39-44` defines:

```typescript
/** Compact, filesystem-safe timestamp: 20260317-143052 */
function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
```

`reset.ts` writes archives as `path.join(archiveDir, `${ts}-progress.md`)` (`reset.ts:99`) and
`path.join(archiveDir, `${ts}-rauf.log`)` (`reset.ts:120`). `rotateEventsLog` mirrors this **exactly**
— `{ts}-events.ndjson` under `paths.archive`. `reset.ts`'s `archiveTimestamp` is module-private and
not exported, so `events-log.ts` defines an identical private helper `eventsArchiveTimestamp()` with
the same body (the alternative — exporting and sharing one helper from a `time-utils` module — is a
larger refactor than Phase 1 warrants; the duplication is two functions and intentional). `ts` is
computed with `new Date()` at call time inside the runner process — acceptable here; this is
production runtime code, not a pure workflow function (tech-spec §3.3).

> Note: `rotateEventsLog` uses `fs.renameSync` directly (not `atomicWrite`) — the same idiom
> `reset.ts:122` uses to archive `rauf.log` (`fs.renameSync(logPath, archivePath)`). A rename is the
> correct primitive for "move this file aside"; `atomicWrite` is for replacing content.

### 3.4 `watchEvents` (REQ-PERF-02, REQ-OBS-04, REQ-REL-01) — tail — D9 / TQ-3

`fs.watch`-based tail for the CLI `follow` command and the web event stream. It **genuinely mirrors
`status.ts:watchLog`** (`status.ts:410`) and returns a **bare cleanup function** — `() => void` — not
a `{ close }` handle, so both tailers share one unsubscribe idiom (tech-spec §3.3, §5.1).

```typescript
/**
 * fs.watch-based tail of events.ndjson (REQ-PERF-02, REQ-OBS-04).
 *
 * Mirrors status.ts:watchLog (status.ts:410): tracks the last byte offset, and
 * on each fs.watch "change" re-reads from that offset to EOF, parses the newly
 * appended whole lines, and invokes onRecords with the new PersistedEvent[].
 *
 * Returns a BARE cleanup function (NOT a { close } handle) so `follow` and the
 * web tail share the same unsubscribe idiom as watchLog.
 *
 * Reliability (TQ-3): fs.watch can MISS fires under rapid writes and varies by
 * platform. By re-reading from the last byte offset on every fire, a single
 * dropped fire is self-correcting on the next one. The caller's --interval poll
 * (owned by 04/05) is therefore both the fallback where fs.watch is unavailable
 * AND a periodic reconciliation safety-net against missed fires — each tick
 * re-reads from the last offset, guaranteeing eventual delivery (§3.3 of tech-spec).
 *
 * Torn-line tolerant (REQ-REL-01): a partial trailing line is not yet a complete
 * record; the offset is advanced only to the last newline, so the partial line
 * is re-read (and completed) on the next fire — it is never emitted half-parsed.
 *
 * @param paths     Backlog root paths (uses paths.eventsLog).
 * @param onRecords Called with each batch of newly-appended records (never []).
 * @returns A cleanup function that stops watching.
 */
export function watchEvents(
  paths: BacklogPaths,
  onRecords: (records: PersistedEvent[]) => void,
): () => void;
```

**Behavior (described; the body parallels `watchLog` closely).** `watchLog` (`status.ts:410-455`)
already establishes the exact idiom this reuses:

1. Initialize `lastOffset` from the current file size via `fs.statSync(paths.eventsLog).size`
   (0 if the file does not exist yet — watching starts from the beginning when it appears).
2. `const watcher = fs.watch(paths.eventsLog, { persistent: false }, (eventType) => { … })` — handle
   only `eventType === "change"`.
3. On change: `stat` the file. If `stat.size <= lastOffset`, the file was truncated/rotated — reset
   `lastOffset = stat.size` and return (the rotate at the next `start()` is the only truncation; a
   live tail then re-syncs to the fresh file). Otherwise read bytes `[lastOffset, stat.size)` via
   `fs.openSync` / `fs.readSync` (exactly `watchLog`'s `Buffer.alloc(stat.size - lastSize)` read at
   `status.ts:434-437`).
4. Split the new bytes on `\n`. The **last element after a split** is either `""` (the bytes ended on
   a newline — all lines complete) or a **partial trailing line** (no newline yet). Advance
   `lastOffset` only past the last `\n` actually seen, so a partial trailing line is **not** consumed
   — it is re-read on the next fire when it completes (REQ-REL-01). Each complete line is
   `JSON.parse` + `PersistedEventSchema.safeParse`-d; lines that fail (should not happen for a
   complete interior line — see §7.2) are skipped.
5. Invoke `onRecords(newRecords)` only when `newRecords.length > 0` (matching `watchLog`'s
   `if (newLines.length > 0) callback(newLines)` at `status.ts:444`).
6. Wrap the read body in `try/catch` and ignore errors (file may be mid-write or briefly absent),
   exactly as `watchLog` does (`status.ts:447-449`).
7. Return `() => { watcher.close(); }` — the **bare cleanup function** (matching `status.ts:452-454`).

> **Shared idiom (stated explicitly).** `watchLog` returns `() => void` (a bare cleanup closure that
> calls `watcher.close()`). `watchEvents` returns the **same shape** so that `follow` (04) and the web
> tail (05) can hold one `unsubscribe: () => void` regardless of which file they tail, and call it
> uniformly on teardown. This is a hard requirement from the tech spec (§3.3, §5.1): `watchEvents`
> MUST NOT return a `{ close }` object.

---

## 4. `fs-utils.ts` primitives

### 4.1 `appendLine` (REQ-EVT-06, REQ-PERF-01)

`atomicWrite` (`fs-utils.ts:13`) is replace-only (write `.tmp` → rename); appends need a new
primitive. The single-writer invariant (REQ-EVT-06) makes a plain `fs.appendFileSync` of one whole
line per event correct and sufficient — **no per-event `fsync`** (REQ-PERF-01). The caller passes a
line with **no** trailing newline; `appendLine` adds exactly one.

```typescript
// ─── appendLine ───────────────────────────────────────────────────
//
// Append one already-serialized line (caller includes NO trailing newline).
// Single-writer only (REQ-EVT-06): one whole-line write per call. No fsync —
// best-effort durability is sufficient because state.json remains authoritative
// for status (REQ-PERF-01 / REQ-REL-02).

export function appendLine(filePath: string, line: string): Result<void> {
  try {
    fs.appendFileSync(filePath, line + "\n");
    return ok(undefined);
  } catch (e) {
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `appendLine failed: ${String(e)}`,
      details: { path: filePath },
    });
  }
}
```

`fs.appendFileSync(filePath, line + "\n")` writes the whole line atomically at the kernel level for a
single `write` of this size, and — because there is exactly one writer per root — establishes a clean
newline boundary after every successful append. This is the structural fact that makes the reader's
torn-line tolerance *sufficient* (§7.2).

### 4.2 `readNdjson<T>` (REQ-REL-01, REQ-REL-03)

Read an entire NDJSON file, validating each line against a Zod schema, **torn-line tolerant**: any
line that fails `JSON.parse` or `safeParse` is **skipped**, never thrown; earlier valid records are
always returned. A missing file returns `ok([])` (REQ-REL-03), so absence is graceful, not an error.

```typescript
// ─── readNdjson ───────────────────────────────────────────────────
//
// Read an NDJSON file, validating each line with `schema`. Torn-line tolerant
// (REQ-REL-01): a line that fails JSON.parse or schema validation is SKIPPED,
// never thrown — earlier valid records are always returned. Missing file →
// ok([]) (REQ-REL-03). Single-writer guarantees only the TRAILING line can be
// torn (§7.2), so skipping bad lines is sufficient, never lossy for interior data.

export function readNdjson<T>(filePath: string, schema: z.ZodType<T>): Result<T[]> {
  if (!fileExists(filePath)) return ok([]); // REQ-REL-03: absence is graceful
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return err({ code: ErrorCodes.IO_ERROR, message: String(e), details: { path: filePath } });
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue; // blank / final-newline tail
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // torn / partial trailing line (REQ-REL-01)
    }
    const r = schema.safeParse(parsed);
    if (r.success) out.push(r.data); // unknown future fields tolerated (additive-only)
  }
  return ok(out);
}
```

Notes:

- `if (!fileExists(filePath)) return ok([])` — absence is the *expected* state for an existing install
  that has not run since this version landed (REQ-COMPAT-01); it is **not** an `IO_ERROR`. Only a real
  read failure on a file that exists (`EACCES`, etc.) returns `IO_ERROR`.
- The `JSON.parse` `catch { continue; }` is the torn-trailing-line tolerance (REQ-REL-01). It also
  silently drops any genuinely corrupt interior line — but §7.2 proves an interior line can never be
  torn under the single-writer invariant, so in practice only the trailing line is ever skipped.
- `schema.safeParse` failures are dropped, not errored, so a forward record carrying unknown future
  fields still validates (additive-only schema evolution) and a structurally-wrong line never crashes
  a reader.
- `z.ZodType<T>` is the schema parameter type; `readNdjson` imports `z` as a type only
  (`import type { z } from "zod"`, already present at `fs-utils.ts:4`).

---

## 5. Runner wire-up (`runner.ts`) — D1

The runner owns the run-scoped state that core cannot hold (the `seq` counter and the coalescing
clock) and the best-effort, `Result`-discarding persistence posture; it delegates the write to
`appendEvent`.

### 5.1 The `persistEvent` hook inside `emitEvent()`

`emitEvent()` (`runner.ts:1135`) is the single choke point all 24 `LoopEvent` types pass through — no
other `this.emit` for LoopEvents exists. The **real current body** is:

```typescript
/** Emit a typed LoopEvent with base fields */
private emitEvent<T extends LoopEvent["type"]>(
  type: T,
  payload: Omit<Extract<LoopEvent, { type: T }>, "type" | "timestamp" | "projectPath">,
): void {
  const event = {
    type,
    timestamp: new Date().toISOString(),
    projectPath: this.projectPath,
    ...payload,
  } as Extract<LoopEvent, { type: T }>;

  this.emit(type, event);
}
```

Phase 1 inserts **one line** before the existing in-memory fan-out, so the fully-assembled `event`
object is persisted before it is emitted (the in-memory `this.emit` is unchanged):

```typescript
  } as Extract<LoopEvent, { type: T }>;

  this.persistEvent(event); // NEW — best-effort file persistence (REQ-EVT-01)
  this.emit(type, event);   // in-memory fan-out unchanged
}
```

`persistEvent` is a new private method (tech-spec §3.1, D1):

```typescript
private eventSeq = 0;           // reset to 0 in start(), AFTER rotateEventsLog
private lastTokenPersistMs = 0; // coalescing clock for llm_token_update (§5.2)

private persistEvent(event: LoopEvent): void {
  // D3 — coalesce high-frequency token telemetry to ≈1/sec (last-write-wins).
  if (event.type === "llm_token_update") {
    const now = Date.now();
    if (now - this.lastTokenPersistMs < TOKEN_COALESCE_MS) return; // drop from FILE only
    this.lastTokenPersistMs = now;
  }

  const record: PersistedEvent = {
    ...event,
    seq: this.eventSeq++,         // dense: seq is assigned ONLY when a record is written
    schemaVersion: EVENTS_SCHEMA_VERSION,
  };

  // best-effort: REQ-PERF-01, REQ-REL-02 — status NEVER depends on the event log.
  // appendEvent returns Result<void> and never throws (core convention; appendLine
  // catches fs errors, validatePath returns err), so the err is intentionally discarded.
  void appendEvent(this.paths, record); // core owns the fs write (rule #1)
}
```

`TOKEN_COALESCE_MS`, `EVENTS_SCHEMA_VERSION`, and `PersistedEvent` come from `@rauf/core` (defined in
[`00-core-definitions.md`](./00-core-definitions.md) §2.2, §2.1, §1.1). `appendEvent` is added to the
runner's existing `@rauf/core` import block (`runner.ts:5-30`).

**Why `emitEvent`, not `TypedEventEmitter.emit()`** (tech-spec §3.1): the chosen site already has the
fully-assembled event object and is the only place all 24 types pass through; the runner — not the
base emitter — is where the per-run `seq`/coalescing state naturally lives. Overriding the base
`emit()` would force that run-scoped state down into a generic event bus.

**Best-effort is fully silent (REQ-PERF-01, REQ-REL-02; tech-spec §7).** `appendEvent` returns a
`Result` (it does not throw — `appendLine` catches fs errors and `validatePath` returns `err`), so
the call's `Result` is simply discarded with `void` and the returned `err` is ignored. A failed log
write is **never surfaced** — not to the loop, not to the user. Rationale: `state.json`
(atomic) + `rauf.log` remain authoritative for status (REQ-OBS-02), so a silently non-writing event
log degrades observation gracefully without its own error channel; adding one would couple loop health
to a best-effort surface. (If a future phase wants a signal, the natural place is a single `appendLog`
line on the first consecutive failure — explicitly out of scope for Phase 1, tech-spec §7.)

### 5.2 `seq` and token coalescing (REQ-EVT-02, REQ-EVT-03)

- **`seq` is the persisted-record sequence — dense, not the emit sequence** (REQ-EVT-03; tech-spec
  §3.1). It is `this.eventSeq++` and is assigned **only when a record is actually written**. A
  coalesced `llm_token_update` returns *before* the `record` is built, so it never consumes a `seq` —
  coalescing therefore **never** creates a gap. A reader can use `seq` to order events and to detect
  gaps; how to interpret a gap depends on vantage point (defined in
  [`00-core-definitions.md`](./00-core-definitions.md) §1.1 JSDoc): over a fully-quiesced file a `seq`
  gap means corruption; while live-tailing an apparent gap means a torn trailing line (re-read from
  the last offset), which §3.4's offset re-read resolves on the next fire.
- **Token coalescing is time-based last-write-wins at `TOKEN_COALESCE_MS` (= 1000ms)** (REQ-EVT-02 /
  tech-spec D3). Only `llm_token_update` is coalesced; `llm_tool_activity` and **all** structural/
  state events persist immediately (no coalescing branch applies to them). The coalesced token update
  is still emitted in-memory (`this.emit` runs unconditionally) — only the *file* write is dropped, so
  live in-memory observers lose no liveness signal.
- This 1s rate is **deliberately independent** of the runner's existing `TOKEN_EVENT_THROTTLE_MS`
  (= 5000ms, `runner.ts:70`) that gates `iteration-status.json`. The two surfaces coalesce at
  different, intentional rates; `events.ndjson` carries ~5× more token records than
  `iteration-status.json` reflects — an accepted consequence (tech-spec D3,
  [`00-core-definitions.md`](./00-core-definitions.md) §2.2).

### 5.3 Rotation + `seq` reset at `start()` (REQ-EVT-05) — D4

`runner.start()` (`runner.ts:139`) must rotate the prior run's log and reset the counter **before**
any event is emitted. Concretely, immediately after the state directory is ensured
(`ensureStateDir`, `runner.ts:147`) and before the first `emitEvent`/`writeState`:

```typescript
// (1) Ensure state directory exists  [existing — runner.ts:147]
const ensureResult = ensureStateDir(this.paths);
if (!ensureResult.ok) { /* existing throw */ }

// NEW (REQ-EVT-05 / D4): rotate the prior run's events.ndjson into archive/,
// then start a fresh log for THIS run. Best-effort — a rotate failure must not
// abort the loop (consistent with persistEvent's posture, REQ-PERF-01).
rotateEventsLog(this.paths);
this.eventSeq = 0; // dense seq restarts at 0 for the new run (TQ-1)
```

Ordering rationale: rotation must happen **after** `ensureStateDir` (the state dir, hence
`paths.archive`'s parent, must exist) and **before** the first persisted event (so the new run's
events.ndjson starts empty and `seq` 0 is genuinely the run's first record). The first `emitEvent`
after this point is `loop_started` (`runner.ts:211`), which becomes `seq: 0`.

`rotateEventsLog` returns a `Result`; like `persistEvent`, its result is ignored here (best-effort).
On a rotation failure it follows the **truncate-on-fail** policy (§3.3, D4): it empties
`events.ndjson` before returning `err`, so the new run still begins from a clean file. This is what
keeps `this.eventSeq = 0` safe — the counter restart can never produce duplicate/non-monotonic `seq`
in the file, because the prior run's lines are gone whether the archive succeeded *or* failed. The
only loss on a failed rotation is the prior run's archive copy (acceptable per REQ-EVT-05); the
live-readable log and the seq-monotonicity / never-contradict invariants (§8, REQ-OBS-02) are
preserved unconditionally. `this.eventSeq = 0` always runs regardless of the rotation outcome.

> **Wiring boundary.** This document owns the **event-log** half of the `start()` wiring
> (`rotateEventsLog` + `eventSeq = 0`) and the `emitEvent`/`persistEvent` hook. The **registry** half
> of `start()` (`registerLoop` at start, `updateLoopStatus` alongside each `writeState`,
> `deregisterLoop` in the `finally`) is owned by
> [`03-active-loop-registry.md`](./03-active-loop-registry.md). The two land in the same `start()`
> body; this spec does not redefine the registry calls. The runner's `finally` already calls
> `releaseLock(this.paths)` (`runner.ts:338`) — that is the line `deregisterLoop` pairs with (03).

### 5.4 Excluding `events.ndjson` from per-item commits

The runner's `git-commit.ts` adds `events.ndjson` to `RUNTIME_EXCLUDE_PATHSPECS`
(`git-commit.ts:18-27`) so the runner's own `git add -A` never stages the event log into per-item
commits. This is part of the same wire-up surface but its detail (the pathspec list) is shared with
the commit-rule work; it is noted here for completeness and specified alongside the runtime-exclude
list in [`06-agent-commit-rule.md`](./06-agent-commit-rule.md) §3.11 (tech-spec).

---

## 6. Error handling (every operation)

| Operation                  | Missing file          | Sandbox escape          | fs failure              | Surfaced to user?            |
| -------------------------- | --------------------- | ----------------------- | ----------------------- | ---------------------------- |
| `appendLine`               | n/a (creates)         | n/a (no validation)     | `err(IO_ERROR)`         | No — swallowed by runner     |
| `appendEvent`              | n/a (creates)         | `err(PATH_VIOLATION)`   | `err(IO_ERROR)` (via appendLine) | No — best-effort (§5.1) |
| `readNdjson` / `readEvents`| `ok([])` (REQ-REL-03) | n/a (read of given path) | `err(IO_ERROR)`        | Reader's choice (degrade)    |
| `rotateEventsLog`          | `ok` (no-op)          | `err(PATH_VIOLATION)`   | `err(IO_ERROR)` (file truncated to empty — truncate-on-fail, §3.3) | No — best-effort at start() |
| `watchEvents`              | watches from 0 on appear | n/a                  | swallowed in watcher    | No (mirrors watchLog)        |

- **Best-effort persistence is fully silent** (REQ-PERF-01 / tech-spec §7): the runner ignores every
  `appendEvent` / `rotateEventsLog` result. Log writability is never surfaced; `state.json` +
  `rauf.log` remain authoritative (REQ-OBS-02, REQ-REL-02).
- **`IO_ERROR`** is the new `ErrorCodes` member ([`00-core-definitions.md`](./00-core-definitions.md)
  §3.1) returned by `appendLine` / `readNdjson` on a genuine fs failure. No existing code
  (`FILE_NOT_FOUND` — wrong, absence is `ok([])`; `INVALID_JSON` / `VALIDATION_ERROR` — about content
  shape) carries the right semantics.
- **`PATH_VIOLATION`** (REQ-SEC-01) is returned by `validatePath` (`fs-utils.ts:140`) when an append or
  rotate target would escape the state dir; the write is refused. Reused verbatim — no new code.
- **Missing file → `ok([])`** (REQ-REL-03): `readEvents` of an absent `events.ndjson` returns the
  empty array, so an existing install with no log reads as "no events," and observers fall back to
  `state.json` + `rauf.log`.

---

## 7. Correctness arguments

### 7.1 Best-effort durability is safe (REQ-PERF-01, REQ-REL-02)

No append is `fsync`-ed, so a hard crash can lose the trailing (unflushed) write(s). This loses **no
status**: `state.json` is written atomically and is the *single authoritative source for current
status* (REQ-OBS-02); recovering status **never** replays the event log (REQ-REL-02). The event log is
the history/stream surface only. Therefore best-effort, no-`fsync` appends are correct — the loop's
correctness never depends on the log being writable or fully flushed.

### 7.2 Torn-write correctness — only the trailing line can be torn (REQ-REL-01, REQ-EVT-06)

This is the **load-bearing invariant** of the subsystem (tech-spec §7):

> Because there is exactly **one writer per root** (REQ-EVT-06) and every append is a single whole line
> via `fs.appendFileSync(line + "\n")`, any malformed/partial line can only ever be the **trailing**
> line. A crash or fs error mid-append leaves a partial *final* line; the next successful append
> re-establishes a clean newline boundary. An **interior** line can never be torn — it was, by
> construction, written as a complete `line + "\n"` before the writer moved on.

Consequences:

1. `readNdjson`'s skip-the-bad-line tolerance is **sufficient** — it never needs to recover an interior
   line, because an interior line can never be torn. The only line `JSON.parse` ever rejects is the
   trailing one (REQ-REL-01).
2. A **concurrent reader** (CLI `follow`, web `/loop/events`) tailing `events.ndjson` *while* the
   runner appends is safe for the same reason: the only line a concurrent read can observe mid-write is
   the trailing one, which the tolerance already covers. No reader lock is needed.
3. `watchEvents` (§3.4) advances its offset only past the last `\n` seen, so it never emits a partial
   trailing line; it re-reads and completes it on the next fire.

This invariant holds **only** while there is a single writer. The CLI/web/external agents must remain
read-only against `events.ndjson` (REQ-EVT-06); the active-loop registry is the separate, intentionally
multi-writer surface and is **not** governed by this invariant (it achieves concurrency-safety
structurally via one file per loop — [`03-active-loop-registry.md`](./03-active-loop-registry.md)).

### 7.3 Growth deferral — whole-file read is acceptable at Phase-1 volumes (tech-spec §3.3)

`events.ndjson` is rotated **only at `runner.start()`** (§3.3 / D4); there is no in-run size cap or
mid-run rotation. Within a single long run it grows unbounded, and `readEvents` / `watchEvents`'
initial read / the web replay all `readFileSync` (or stat-and-read) the whole file, so replay/attach
cost grows linearly with run length. This is **accepted for Phase 1**: a run's event volume is bounded
by `maxIterations × per-iteration event count`, and with token updates coalesced to ~1/sec (§5.2) a
multi-hour run is on the order of single-digit MBs. If replay cost ever matters, `readEvents` /
`follow`-replay can read from a byte offset or tail-N rather than the whole file — noted but
**deferred** (no in-run rotation in Phase 1). The complementary watch reliability — the offset re-read
and `--interval` safety-net — is covered in §3.4.

---

## 8. `state.json` ⇄ `events.ndjson` invariant (REQ-REL-02)

`state.json` (atomic) stays the **single authoritative current status**; `events.ndjson` is the
authoritative **stream/history**. The runner already emits structural events around its `writeState`
calls (e.g. `loop_started` at `runner.ts:211` after `writeState("running")` at `runner.ts:220`;
`loop_completed` at `runner.ts:289`/`:299` paired with `writeState("limit_reached")`/`("complete")`;
`loop_error` at `runner.ts:321` paired with `writeState("error")` at `runner.ts:322`). Because
`persistEvent` runs inside `emitEvent`, every such structural event is also persisted, so **every
`state.json` transition has a corresponding event line** and the log never contradicts `state.json`
(REQ-OBS-02 — the invariant itself is owned cross-cuttingly; this subsystem's contribution is making
those events durable). Status recovery never replaying the log (REQ-REL-02) means losing the log's
tail after a hard crash loses no status; absence of the log degrades to `state.json` + `rauf.log`
(REQ-REL-03).

---

## Dependencies

- **[`00-core-definitions.md`](./00-core-definitions.md)** — defines every type/constant/error code
  this subsystem uses: `PersistedEvent` / `PersistedEventSchema` (§1.1), `BacklogPaths.eventsLog`
  (§1.3), `EVENTS_SCHEMA_VERSION` (§2.1), `TOKEN_COALESCE_MS` (§2.2), `EVENTS_LOG_FILENAME` (§2.4),
  and the new `IO_ERROR` `ErrorCodes` member (§3.1). **None are redefined here.**
- **[`01-architecture-layout.md`](./01-architecture-layout.md)** — `events-log.ts` is a NEW core
  module re-exported via `index.ts` (§3); the on-disk layout (§5) shows `events.ndjson` in the state
  dir and `archive/{ts}-events.ndjson`.
- **[`03-active-loop-registry.md`](./03-active-loop-registry.md)** — owns the registry half of the
  `start()` / `finally` wiring (`registerLoop` / `updateLoopStatus` / `deregisterLoop`); shares the
  `runner.start()` body and `lock.ts` ground truth. This spec does not define those calls.
- **Consumers — [`04-cli-monitoring-surface.md`](./04-cli-monitoring-surface.md)** and
  **[`05-web-observation-parity.md`](./05-web-observation-parity.md)** consume `readEvents`
  (history replay) and `watchEvents` (tail). The `follow` CLI command and the `/loop/events` web tail
  are owned there; this spec owns only the primitives they call (REQ-OBS-04 at the primitive level).
- **[`06-agent-commit-rule.md`](./06-agent-commit-rule.md)** — owns the `RUNTIME_EXCLUDE_PATHSPECS`
  addition of `events.ndjson` (§5.4 here references it; the pathspec list is specified there).
- Source integration points (existing, unchanged signatures): `emitEvent()` (`runner.ts:1135`),
  `start()` (`runner.ts:139`), the `finally`'s `releaseLock` (`runner.ts:338`), `watchLog`
  (`status.ts:410`), `atomicWrite` (`fs-utils.ts:13`), `validatePath` (`fs-utils.ts:140`), `fileExists`
  (`fs-utils.ts:167`), `ensureDir` (`fs-utils.ts:180`), `reset.ts:archiveTimestamp` (`reset.ts:39-44`).

---

## Verification

These map to SC-3, SC-6, SC-7 (PRD §8) and the tech-spec §8 test plan.

- [ ] **Append → read round-trip.** `appendEvent` N records, then `readEvents` returns the same N
      `PersistedEvent`s in `seq` order. (REQ-EVT-01)
- [ ] **`seq` monotonic + dense.** Across a sequence of emitted events, the persisted `seq` values are
      `0, 1, 2, …` with no gaps. (REQ-EVT-03 / SC-6)
- [ ] **Coalescing drops sub-second token updates but keeps structural events.** Emitting many
      `llm_token_update`s within `TOKEN_COALESCE_MS` writes ≤1 per window; interleaved
      `llm_tool_activity` / structural events are **all** persisted (none coalesced). (REQ-EVT-02)
- [ ] **Torn trailing line skipped.** Append valid records, then a partial JSON line with no trailing
      newline; `readEvents` returns the valid records and skips the partial line without throwing.
      (REQ-REL-01 / SC-3)
- [ ] **Rotate → `archive/{ts}-events.ndjson`.** With an existing `events.ndjson`, `rotateEventsLog`
      moves it to `archive/{YYYYMMDD-HHMMSS}-events.ndjson` (matching `reset.ts`'s pattern) and leaves
      `events.ndjson` absent so the run starts fresh. (REQ-EVT-05)
- [ ] **Rotate no-op on first run.** `rotateEventsLog` on a state dir with no `events.ndjson` returns
      `ok` and creates nothing. (REQ-EVT-05 / REQ-COMPAT-01)
- [ ] **Rotate failure truncates (truncate-on-fail).** When the archive rename fails (e.g.
      unwritable/absent `archive/`), `rotateEventsLog` returns `err(IO_ERROR)` **and** leaves
      `events.ndjson` empty (0 bytes), so the next run's `seq` restarts at 0 in a clean file with no
      stale prior-run lines. (REQ-EVT-05 / REQ-OBS-02 — preserves seq-monotonicity + never-contradict)
- [ ] **Missing file → `ok([])`.** `readEvents` on a state dir with no `events.ndjson` returns
      `ok([])`, not an error. (REQ-REL-03 / SC-7)
- [ ] **Sandbox enforced on append.** `appendEvent` with a `paths.eventsLog` outside `paths.stateDir`
      returns `err(PATH_VIOLATION)` and writes nothing. (REQ-SEC-01)
- [ ] **Best-effort never throws into the loop.** A `persistEvent` whose `appendEvent` fails
      (e.g. unwritable state dir) does not throw, does not surface an error, and the loop continues;
      `state.json` still reports correct status. (REQ-PERF-01 / REQ-REL-02 / SC-3)
- [ ] **`watchEvents` returns a bare cleanup fn.** The return value is `() => void` (callable to stop),
      not a `{ close }` handle — verifiable by type and by calling it. (mirrors `watchLog`)
- [ ] **`watchEvents` re-read self-corrects.** New records appended after a watch is established are
      delivered via `onRecords`; a partial trailing line is not delivered until it completes.
      (REQ-PERF-02 / REQ-REL-01 / TQ-3)
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` pass; the new exports surface from `@rauf/core`.
      (SC-7)
