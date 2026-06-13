# UX/DX Overhaul — Phase 1: Observation Substrate — Technical Specification

> **Scope.** This spec covers **Phase 1 only** (the observation substrate / keystone), as defined in
> [`CANON.md`](./CANON.md) §5 and scoped by [`PRD.md`](./PRD.md). Every decision below traces to a PRD
> requirement ID (`REQ-*`) or resolves a PRD open question (`OQ-*`). The tech spec answers **HOW**;
> it does not restate the PRD's **WHAT** — requirements are referenced by ID. Where this spec and the
> canon disagree, the canon wins (or is amended first).

---

## 1. Overview

Phase 1 makes **files the single observation substrate** (CANON P1) by persisting the loop's
in-memory `LoopEvent` stream to an append-only **`events.ndjson`** in each backlog root's state
directory, and by adding a **machine-wide active-loop registry** under `~/.rauf/active/` so any
observer can answer "is a loop live, and where" in O(1) regardless of working directory. With those
two new on-disk surfaces, the CLI monitor commands collapse to one file-based model, the web becomes
a faithful observer of in-process runs, and the in-process-vs-server visibility asymmetry dissolves
by construction.

The change is **additive to on-disk state** (REQ-COMPAT-01): an existing install with no
`events.ndjson` keeps working; the file is created on the next run. The only *breaking* changes are
the **clean-break removal of superseded monitor verbs/flags** (`loop watch`, `loop follow`,
`--watch`) — monitoring surface only, never execution grammar (that is Phase 2).

### Key architectural decisions (all resolved in the interview)

| # | Decision | PRD ref |
| --- | --- | --- |
| D1 | Persist inside `LoopRunner.emitEvent()` — the single choke point all 24 events pass through. The **runner** owns the per-run `seq` counter and token coalescing; **core** owns the `fs.appendFileSync`. Best-effort (try/catch, never crashes the loop). Single writer per root. | REQ-EVT-01/06 |
| D2 | **Flat** record: every line is the full `LoopEvent` plus `seq` and `schemaVersion`. Each line independently parseable and self-describing. | REQ-EVT-03/04 |
| D3 | **Time-based last-write-wins** coalescing of `llm_token_update` at ≈1/sec (`TOKEN_COALESCE_MS = 1000`), satisfying REQ-EVT-02's "≤ ~1/sec". This is **independent of, and finer-grained than**, the existing 5s `TOKEN_EVENT_THROTTLE_MS` (`runner.ts:70`) that gates `iteration-status.json` — the two surfaces coalesce at different, intentional rates. `llm_tool_activity` + all structural events persist immediately. | REQ-EVT-02 / OQ-2 |
| D4 | **Rotate** `events.ndjson` → `archive/{ts}-events.ndjson` at `runner.start()`, mirroring the `reset.ts` `{ts}-<filename>` pattern; then begin a fresh file. **Truncate-on-fail:** if the archive rename fails, truncate `events.ndjson` to empty before returning `err`, so the new run always starts clean (preserves seq-monotonicity + never-contradict; loses only the prior archive, acceptable per REQ-EVT-05). | REQ-EVT-05 / OQ-4 |
| D5 | Registry = **per-loop entry files** `~/.rauf/active/<hash>.json` keyed by a hash of the resolved state dir. Each loop owns exactly one file → concurrency-safety is structural (no shared-file writer contention). **Reconcile on read** against `.loop.lock` + process liveness; prune stale entries. | REQ-DISC-03/04/05 / OQ-1 |
| D6 | Cross-root discovery scope = **machine-wide** (the registry lives in `~/.rauf`, naturally global). No scoping flag in Phase 1. | REQ-DISC-02 / OQ-3 |
| D7 | Cross-root listing surface = **`status --all`** (reads the same registry, honors `--json`). The existing `projects status` verb stays project-scoped. | REQ-DISC-06 / OQ-5 |
| D8 | Web read-path parity: backend tails `events.ndjson` for `/loop/events` and reads the registry for `/api/loops`; **plus a new frontend `<EventTimeline>`** consuming the file-backed `/loop/events`. The shared status label-map + missing badges stay deferred to Phase 4 (boundary held). | REQ-WEB-01/02/03 |
| D9 | `follow` (top-level) is **file-based primary** — replay current run's `events.ndjson`, then `fs.watch`-tail (like `watchLog`). Server SSE is an optional latency optimization only. History replay reads **current run only** (the file resets per run). | REQ-MON-01, REQ-OBS-04 / OQ-6 |

---

## 2. Module Structure

No new packages. Work lands in the four existing packages plus the artifact templates and docs.
Per architecture rule #1, **all new filesystem + registry logic lives in `packages/core`**; `loop`,
`cli`, and `web` only *wire it up*.

### `packages/core/src/` — new modules + additions

| File | Change | Public exports (re-exported from `src/index.ts`) |
| --- | --- | --- |
| `events-log.ts` | **new** | `appendEvent`, `readEvents`, `rotateEventsLog`, `watchEvents` |
| `loop-registry.ts` | **new** | `registerLoop`, `deregisterLoop`, `updateLoopStatus`, `listActiveLoops`, `registryEntryPath` |
| `fs-utils.ts` | add | `appendLine(filePath, line): Result<void>`, `readNdjson<T>(filePath, schema): Result<T[]>` (torn-line tolerant) |
| `errors.ts` | add | new `IO_ERROR` member on the `ErrorCodes` enum — the append/read failure code returned by `appendLine`/`readNdjson` (no existing code has the right semantics) |
| `backlog-root.ts` | add | `eventsLog` field on `BacklogPaths` (= `stateDir/events.ndjson`) |
| `schemas.ts` | add | `EVENTS_SCHEMA_VERSION`, `TOKEN_COALESCE_MS`, `EVENTS_LOG_FILENAME`, `PersistedEventSchema` / `PersistedEvent`, `ActiveLoopEntrySchema` / `ActiveLoopEntry` |
| `lock.ts` | refactor | extract `checkLockFile(lockPath): Result<LockStatus>` — parameterize the existing `checkLock` body (which uses the private `isProcessAlive`/`isProcessRecycled` helpers) on a raw lock path; existing `checkLock(paths)` delegates to it, for registry reconciliation |
| `status.ts` | extend | `deriveStatus`/empty-path callers surface inspected dir + registry liveness (REQ-DISC-01/02) |

### `packages/loop/src/` — wire-up only

| File | Change |
| --- | --- |
| `runner.ts` | per-run `eventSeq` counter + token-coalescing state; call `appendEvent` from `emitEvent()`; `rotateEventsLog` + `registerLoop` at `start()`; `deregisterLoop` in the run's `finally`; `updateLoopStatus` alongside each `writeState` transition |
| `git-commit.ts` | add `events.ndjson` to `RUNTIME_EXCLUDE_PATHSPECS` |
| `prompt-builder.ts` | **add** the no-commit reminder (currently states no commit rule) — REQ-COMMIT-02b |

### `packages/cli/src/` — clean break + unification

| File | Change |
| --- | --- |
| `commands.ts` | remove `loop watch` (line 244) + `loop follow` (line 182) subcommands; add top-level `follow` command; update `status`/`log` usage strings |
| `status-commands.ts` | `--watch`→`--follow`/`-f`; honor `--json` under follow (NDJSON); `log --json` (+ NDJSON under follow); empty-is-never-silent surfacing; `status --all` |
| `follow-command.ts` | **new** — top-level `follow` (promoted from `handleLoopFollow` direct-mode path) |
| `loop-commands.ts` | delete `handleLoopWatch` (1387–1464) + `handleLoopFollow` (675–712) |
| `*.test.ts` | update subcommand-list assertions and removed-command tests (see §8) |

### `packages/web/src/` — read-path parity + event timeline

| File | Change |
| --- | --- |
| `server/routes/loop.ts` | `/loop/events` tails `events.ndjson` (file = source of truth; in-memory buffer = cache); `/api/loops` reads `listActiveLoops()` |
| `server/loop-manager.ts` | in-memory ring buffer demoted to latency optimization (REQ-WEB-02) |
| `client/routes/projects/status.tsx` | new `<EventTimeline>` consuming `/loop/events` via `EventSource` |
| `client/routes/projects/index.tsx` | projects-view liveness badges from registry |

### Docs to update (CANON §5 "each phase's done")

`SCHEMAS.md`, `SPEC-CORE.md`, `SPEC-CLI.md`, `SPEC-WEB.md`, `SPEC-ARTIFACTS.md`, `ARCHITECTURE.md`,
`SPEC-BACKLOG-TOOL-CONTRACT.md`.

---

## 3. Technical Decisions

### 3.1 Event persistence hook (REQ-EVT-01, REQ-EVT-06, REQ-PERF-01) — D1

Every `LoopEvent` already flows through one private method,
`LoopRunner.emitEvent()` (`packages/loop/src/runner.ts:1135`):

```typescript
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

  // NEW — best-effort persistence; never throws into the loop (mirrors runner.ts:544)
  this.persistEvent(event);

  this.emit(type, event); // in-memory fan-out unchanged
}
```

`persistEvent` is a private runner method that owns the **run-scoped** state core cannot hold (the
`seq` counter and the coalescing clock), then delegates the write to core:

```typescript
private eventSeq = 0;            // reset to 0 in start(), after rotateEventsLog
private lastTokenPersistMs = 0;  // coalescing clock for llm_token_update

private persistEvent(event: LoopEvent): void {
  // D3 — coalesce high-frequency token telemetry to ≈1/sec (last-write-wins)
  if (event.type === "llm_token_update") {
    const now = Date.now();
    if (now - this.lastTokenPersistMs < TOKEN_COALESCE_MS) return; // drop from FILE; still emitted in-memory
    this.lastTokenPersistMs = now;
  }
  const record: PersistedEvent = {
    ...event,
    seq: this.eventSeq++,        // dense: seq is assigned only when a record is written
    schemaVersion: EVENTS_SCHEMA_VERSION,
  };
  // best-effort: REQ-PERF-01, REQ-REL-02 — status never depends on the event log.
  // appendEvent returns Result<void> and never throws (core convention; appendLine
  // catches fs errors, validatePath returns err), so the err is intentionally discarded.
  void appendEvent(this.paths, record); // core owns the fs write (rule #1)
}
```

**Why `emitEvent`, not `TypedEventEmitter.emit()`:** the chosen site already has the fully-assembled
event object and is the *only* place all 24 types pass through, and the runner — not the base emitter
— is where the per-run `seq`/coalescing state naturally lives. Overriding the base `emit()` would
force that run-scoped state down into a generic event bus.

**`seq` is the persisted-record sequence (dense), not the emit sequence.** Coalesced token updates
simply never get a `seq` (REQ-EVT-03), so a gap is never caused by coalescing. How a reader should
interpret a gap depends on its vantage point: a reader over a **fully-quiesced** file (no live writer)
that sees a `seq` gap is looking at genuine *corruption*. A reader **live-tailing** an actively-written
file that observes an apparent gap should treat it as *possibly torn/incomplete — re-read from the last
offset* (per §3.3's offset re-read), not declare corruption; the gap typically resolves on the next
read as the trailing line completes. Reserve the hard "corruption" interpretation for the quiesced case.

`TOKEN_COALESCE_MS = 1000` and `EVENTS_SCHEMA_VERSION = "1"` are constants in core. This 1s rate is
**deliberately independent** of the runner's existing `TOKEN_EVENT_THROTTLE_MS = 5_000` (`runner.ts:70`)
that gates `iteration-status.json`; the event log is its own surface and coalesces 5× more finely.
Consequence (acceptable): `events.ndjson` will carry **more** `llm_token_update` records than
`iteration-status.json` reflects, so a reader correlating the two surfaces sees extra token lines in
the event stream. Each surface is independent, so this is fine.

### 3.2 Append + NDJSON read primitives (REQ-EVT-06, REQ-REL-01) — core `fs-utils.ts`

`atomicWrite` (`fs-utils.ts:13`) is replace-only; appends need a new primitive. The single-writer
invariant (REQ-EVT-06) means a plain `fs.appendFileSync` of one whole line per event is correct and
sufficient — no per-event `fsync` (REQ-PERF-01).

```typescript
/** Append one already-serialized line (caller includes no trailing newline). Single-writer only. */
export function appendLine(filePath: string, line: string): Result<void> {
  try {
    fs.appendFileSync(filePath, line + "\n");
    return ok(undefined);
  } catch (e) {
    return err({ code: ErrorCodes.IO_ERROR, message: `appendLine failed: ${String(e)}` });
  }
}

/**
 * Read an NDJSON file, validating each line with `schema`. Torn-line tolerant (REQ-REL-01):
 * a trailing line that fails JSON.parse or schema validation is SKIPPED, never thrown.
 * Earlier valid records are always returned. Missing file → ok([]) (REQ-REL-03).
 */
export function readNdjson<T>(filePath: string, schema: z.ZodType<T>): Result<T[]> {
  if (!fileExists(filePath)) return ok([]);
  let raw: string;
  try { raw = fs.readFileSync(filePath, "utf8"); }
  catch (e) { return err({ code: ErrorCodes.IO_ERROR, message: String(e) }); }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; } // torn/partial trailing line
    const r = schema.safeParse(parsed);
    if (r.success) out.push(r.data); // unknown future fields tolerated (additive-only)
  }
  return ok(out);
}
```

Both primitives return a new `ErrorCodes.IO_ERROR` code on fs failure — **`IO_ERROR` does not exist
in `errors.ts` today and must be added** to the `ErrorCodes` enum as part of this work (§2). No
existing code (`FILE_NOT_FOUND`, etc.) carries the right append/read-failure semantics.

### 3.3 Event-log lifecycle module (REQ-EVT-05, REQ-EVT-07, REQ-OBS-04) — core `events-log.ts`

```typescript
import { BacklogPaths } from "./backlog-root.js";
import { PersistedEvent, PersistedEventSchema } from "./schemas.js";
import { appendLine, readNdjson, validatePath, ensureDir } from "./fs-utils.js";

/** Append a persisted event. Path is sandbox-validated to the state dir (REQ-EVT-07/SEC-01). */
export function appendEvent(paths: BacklogPaths, record: PersistedEvent): Result<void> {
  const guard = validatePath(paths.eventsLog, [paths.stateDir]);
  if (!guard.ok) return guard;
  return appendLine(paths.eventsLog, JSON.stringify(record));
}

/** Read the current run's events (ordered by seq; torn-line tolerant). Absent file → ok([]). */
export function readEvents(paths: BacklogPaths): Result<PersistedEvent[]> {
  return readNdjson(paths.eventsLog, PersistedEventSchema);
}

/**
 * Rotate at loop start (REQ-EVT-05 / D4): move an existing events.ndjson to
 * {stateDir}/archive/{ts}-events.ndjson, then leave the path empty for a fresh run.
 * ts = YYYYMMDD-HHMMSS, matching reset.ts. No-op if the file is absent.
 */
export function rotateEventsLog(paths: BacklogPaths): Result<void> { /* mkdir archive, rename */ }

/**
 * fs.watch-based tail for `follow` and the web. Genuinely mirrors status.ts:watchLog —
 * returns a bare cleanup function (NOT a { close } handle) so both tailers share one unsubscribe idiom.
 */
export function watchEvents(
  paths: BacklogPaths,
  onRecords: (records: PersistedEvent[]) => void,
): () => void { /* ... */ }
```

`ts` is computed with `new Date()` at call time inside the runner process (not a pure function) —
acceptable here; this is production runtime code, not a workflow script.

**Scalability / per-run growth (accepted Phase-1 deferral).** `events.ndjson` is rotated **only at
`runner.start()`** (D4); there is no in-run size cap or mid-run rotation. Within a single long run it
grows unbounded, and `readEvents`/`watchEvents`/the web replay all `readFileSync` the whole file, so
replay/attach cost grows linearly with run length. This is acceptable for Phase 1: a run's event
volume is bounded in practice by `maxIterations × per-iteration event count`, and with token updates
coalesced to ~1/sec a multi-hour run is on the order of single-digit MBs. If replay cost ever matters,
`readEvents`/`follow`-replay can read from a byte offset or tail-N rather than the whole file — noted
but **deferred** (no in-run rotation in Phase 1).

**`watchEvents` reliability.** `fs.watch` can miss events under rapid writes and varies by platform, so
`watchEvents` must **re-read from the last byte offset to EOF on every fire** (TQ-3), making a single
missed fire self-correcting on the next one. The `--interval` poll is therefore not only a fallback for
when `fs.watch` is *unavailable* but also a periodic **reconciliation safety-net** against *missed*
fires when it is available — on each interval tick the tailer re-reads from its last offset, guaranteeing
eventual delivery even if a watch event was dropped.

### 3.4 events.ndjson record schema (REQ-EVT-03, REQ-EVT-04) — D2

A **flat** record: the existing `LoopEvent` discriminated union intersected with the two envelope
fields. Defined in `packages/core/src/schemas.ts` next to `LoopEventSchema` (line 574):

```typescript
export const EVENTS_SCHEMA_VERSION = "1";

/** One line of events.ndjson: a LoopEvent plus a per-run dense sequence number and a schema tag. */
export const PersistedEventSchema = z.intersection(
  LoopEventSchema,
  z.object({
    /** Monotonic, dense, per-run. Assigned only when a record is written (see §3.1). */
    seq: z.number().int().nonnegative(),
    /** Event-log schema version. "1" for Phase 1. Forward-stable machine contract (CANON §4.5). */
    schemaVersion: z.string(),
  }),
);
export type PersistedEvent = z.infer<typeof PersistedEventSchema>;
```

This ships the **version envelope now** (REQ-EVT-04); the *formal versioning discipline* (bump policy,
published JSON Schema) remains Phase 3. No new committed `*.schema.json` is generated in Phase 1 —
`scripts/generate-json-schemas.ts` keeps emitting only `backlog.schema.json`.

**Implementation note — first `z.intersection` in the codebase.** `schemas.ts` has no existing
`z.intersection` use, and `LoopEventSchema` is a `z.discriminatedUnion` (24 members). Intersecting a
discriminated union with an object in zod 3 parses correctly but **forfeits the discriminated-union
fast path / focused error messages** (the intersection runs both schemas and deep-merges), and the
inferred `z.infer<ZodIntersection<…>>` type is heavier than `.merge` on a single object would be.
`readNdjson` `safeParse`s every line against this schema on each read — acceptable at Phase-1 volumes
(see the growth note in §3.3), but worth measuring if read-path cost ever matters. Alternatives
considered: `LoopEventSchema.and(EnvelopeSchema)` (same semantics, terser) and extending each of the 24
member schemas with `.merge(EnvelopeSchema)` then re-forming the union (preserves the discriminated
fast path but is 24× the boilerplate and must stay in sync as events are added). `z.intersection` was
chosen for minimal boilerplate and a single envelope definition; revisit if profiling shows the
per-line parse is hot.

### 3.5 Active-loop registry (REQ-DISC-03/04/05, REQ-SEC-01) — D5, core `loop-registry.ts`

Storage: **one file per running loop** under `~/.rauf/active/`, named by a hash of the resolved
state directory. Because each loop writes only its own file, multiple loops registering/deregistering
concurrently never contend on a shared file — concurrency-safety (REQ-DISC-04) is structural rather
than lock-mediated.

```typescript
import { createHash } from "node:crypto";
import { TOOL_CONFIG_DIR } from "./config.js"; // = ~/.rauf
import { checkLockFile } from "./lock.js";
import { ActiveLoopEntry, ActiveLoopEntrySchema } from "./schemas.js";

const ACTIVE_DIR = path.join(TOOL_CONFIG_DIR, "active");
const key = (stateDir: string) => createHash("sha256").update(path.resolve(stateDir)).digest("hex").slice(0, 16);
export const registryEntryPath = (stateDir: string) => path.join(ACTIVE_DIR, `${key(stateDir)}.json`);

/** Written at loop start. Path sandbox-validated to ~/.rauf (REQ-SEC-01). */
export function registerLoop(entry: ActiveLoopEntry): Result<void> { /* ensureDir + atomicWrite */ }

/** Cleared at loop exit (success, error, or cancel — in the run's finally). Idempotent. */
export function deregisterLoop(stateDir: string): Result<void> { /* unlink if exists */ }

/** Advisory last-known status update (REQ-OBS-02): rewrites this loop's own entry. */
export function updateLoopStatus(stateDir: string, status: LoopStateStatus): Result<void> { /* ... */ }

/**
 * List live loops, machine-wide (D6). RECONCILES each entry against ground truth before
 * returning it (REQ-DISC-05): read {stateDir}/.loop.lock via checkLockFile + process liveness;
 * if the owning process is dead/absent, UNLINK the stale entry (self-heal) and exclude it.
 * Pure file reads — no subprocess (architecture rule #6).
 */
export function listActiveLoops(): Result<ActiveLoopEntry[]> { /* glob ACTIVE_DIR, reconcile, prune */ }
```

Registry entry schema (in `schemas.ts`):

```typescript
export const ActiveLoopEntrySchema = z.object({
  /** Resolved state directory — the registry key source and reconciliation anchor. */
  stateDir: z.string(),
  /** Project root the loop runs against. */
  projectPath: z.string(),
  /** The --backlog root (may equal projectPath/.rauf for the default root). */
  backlogRoot: z.string(),
  /** OS process id of the runner, for liveness reconciliation. */
  pid: z.number().int(),
  /** ISO timestamp the loop registered. */
  startedAt: z.string(),
  /** Advisory last-known raw status (state.json remains authoritative — REQ-OBS-02). */
  status: LoopStateStatusSchema,
});
export type ActiveLoopEntry = z.infer<typeof ActiveLoopEntrySchema>;
```

**Reconciliation reuses the existing lock liveness** rather than re-implementing PID checks. `lock.ts`
already does `process.kill(pid, 0)` plus a Linux `/proc/<pid>/stat` start-time guard against PID
recycling, in the private helpers `isProcessAlive`/`isProcessRecycled` (`lock.ts:56–116`) consumed by
`checkLock`. We extract `checkLockFile(lockPath: string): Result<LockStatus>` by parameterizing the
body of the current `checkLock(paths)` — the part that reads the lock file and runs those liveness
helpers — on a raw `lockPath` instead of a full `BacklogPaths`, so the registry can reconcile against
any state dir's lock. `checkLock` then delegates to it. (Note: the return type is `LockStatus`, the
existing `checkLock` return shape from `lock.ts:39` — **not** `LockSummary`, which is the unrelated
status-display type at `schemas.ts:258` produced by `computeLockSummary`.) The `.loop.lock` is the
**ground truth** (C-3); the registry is a fast index over it.

### 3.6 Unified, file-based monitoring surface (REQ-OBS-01, REQ-MON-01/03/04, REQ-PERF-02) — D9

All read commands reconstruct from files (`state.json` + `events.ndjson` + `iteration-status.json` +
`rauf.log`); none depends on owning the runner or on a server. `status`, `log`, and `progress` already
read files directly; the only command that routed through server SSE was `loop follow`, which is
removed and re-built as the top-level **`follow`** with the file-based `followDirectMode` path
(`loop-commands.ts:588–671`) as its primary, and server SSE kept only as an optional latency speed-up.

`follow` attach behavior (REQ-OBS-04 / OQ-6): on start, **replay the current run's `events.ndjson`**
(via `readEvents`), then `fs.watch`-tail new records (via `watchEvents`) and poll `deriveStatus` for
terminal detection. It does **not** stitch the prior archived log (the file resets per run).

`--json`/NDJSON (REQ-MON-03): `--json` is honored on **every** read/monitor command. Under `--follow`
each surface streams **NDJSON** — `status --follow --json` emits one `DerivedStatus` snapshot per
change; `log --follow --json` and `follow --json` emit one `PersistedEvent` (or log line) object per
line. `--interval <seconds>` retains its meaning as the poll fallback when `fs.watch` is unavailable
(REQ-PERF-02 is a qualitative ≈1s target, not an SLA). `--backlog <dir>` stays the single targeting
spelling on every command (REQ-MON-04) — already true in the code.

### 3.7 Clean break: removed monitor verbs/flags (REQ-MON-02, C-4) — no aliases

Removed outright, no deprecation shims:

- `loop watch` → deleted (`handleLoopWatch`, `loop-commands.ts:1387–1464`). Its tool/token detail is
  already available via `follow` and `status --json` (both read `iteration-status.json` + events).
- `loop follow` → deleted as a subcommand; promoted to top-level `follow`.
- `--watch` (+ its `handleStatusWatch`, `status-commands.ts:295–348`) → replaced by `--follow`/`-f`.

`loop start --follow` is an **execution** verb's convenience flag and is **untouched** (Phase 2 owns
execution grammar). Subcommand-list and removed-command tests are updated in the same change (§8).

### 3.8 Empty-is-never-silent + cross-root surfacing (REQ-DISC-01/02, REQ-OBS-01) — D6/D7

Every read command that resolves to "nothing here" MUST (a) name the directory it inspected, and
(b) consult `listActiveLoops()` and, if a loop is live in another root, name that root + its state.
This closes the three silent causes (backlog-root mismatch, silent-empty, cwd resolution). The
existing `stateSource: "none"` discriminator (`status.ts`) already distinguishes absence from idle;
Phase 1 *surfaces* it. `scanActiveRoots` (the per-tree walk) is superseded for liveness by the O(1)
registry but may remain for in-project enumeration.

`status --all` (D7): a new flag that lists every live loop from the registry, machine-wide, honoring
`--json`. The existing `projects status` verb stays project-scoped and is not overloaded.

### 3.9 Web read-path parity + event timeline (REQ-WEB-01/02/03, REQ-SEC-02) — D8

- **`/loop/events`** (`routes/loop.ts:233`): the file (`events.ndjson`) becomes the source of truth —
  the handler tails it (history replay via `readEvents`, then `watchEvents`) for **any** project,
  including loops the server did not start. The in-memory `LoopManager` ring buffer is demoted to an
  optional cache in front of the file (REQ-WEB-02), never the sole source.
- **`/api/loops`** (`routes/loop.ts:101`): returns `listActiveLoops()` (registry, reconciled) instead
  of `manager.listActive()` (server-owned only), so the projects view reflects all live loops
  (REQ-WEB-03).
- **Frontend `<EventTimeline>`** (D8): a new component on the status page opens an `EventSource` to the
  now-file-backed `/loop/events` and renders the 24 structured event types. **Boundary held:** it uses
  existing/minimal labels; the *shared status label-map + missing badges* (`REVIEWING`,
  `PAUSED_USAGE_LIMIT`, "Needs Human") remain **Phase 4** and are not pulled forward.
- **No new mutation endpoints** in Phase 1 (recovery buttons are Phase 4). Server stays bound to
  `127.0.0.1`; the `X-Rauf-Request` guard (`app.ts:54–69`) is unchanged — it only fires on
  POST/PUT/DELETE, so read-path additions need nothing there (REQ-SEC-02).

### 3.10 state.json ⇄ events.ndjson invariant (REQ-OBS-02, REQ-REL-02/03)

`state.json` (atomically written) stays the **single authoritative current status**; `events.ndjson`
is the authoritative **stream/history**. Invariant: **every `state.json` status transition has a
corresponding persisted event, and the event log never contradicts `state.json`.** The runner already
emits structural events around its `writeState` calls; Phase 1 makes each transition also call
`updateLoopStatus` (advisory registry refresh) and relies on the existing event for the log line.
Because status recovery never replays the log (REQ-REL-02), losing the log's tail after a hard crash
loses no status; absence of the log degrades to `state.json` + `rauf.log` (REQ-REL-03).

### 3.11 Agent commit-rule single source (REQ-COMMIT-01/02) — and the embedded-artifacts locus

Canonical rule (verbatim from the repo's already-correct `.rauf/RAUF.md`): **"the iteration agent
never commits or stages; the loop runner owns the commit."** Loci, all reconciled to that wording:

1. `artifacts/variants/backlog-json/CLAUDE_ADDON.md:21` — replace "Commit your changes…".
2. `artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl:47` — same replacement.
3. `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl:32` — replace "Commit with:…"; **and** add the
   explicit no-commit line to its "Important Rules" section (currently silent).
4. **`packages/core/src/embedded-artifacts.ts` (lines 42, 364, 423)** — the *generated, installed*
   source of truth. **Regenerate** via `bun run scripts/generate-embedded-artifacts.ts` (runs
   automatically in `pnpm --filter @rauf/core build`). Without this, new installs keep the bug even
   after the templates are fixed. The spec/backlog MUST include a check that embedded-artifacts no
   longer contains "Commit your changes"/"Commit with:".
5. `docs/SPEC-ARTIFACTS.md` — two verbatim template copies (lines 213–246, 296–338) updated to match.
6. `packages/loop/src/prompt-builder.ts` — **add** the no-commit reminder in `buildPrompt`'s final
   IMPORTANT section (REQ-COMMIT-02b): it currently states no commit rule.

Also add `events.ndjson` to `RUNTIME_EXCLUDE_PATHSPECS` (`git-commit.ts:18–27`) so the runner's own
`git add -A` never stages the event log into per-item commits.

**Out of scope (REQ-COMMIT-03 scope guard):** the `CLAUDE_ADDON.md → AGENT_ADDON.md` rename and
provider-neutral language — only the commit wording changes now. The signal-placement "final line"
reconciliation is **Phase 3**, even though it edits the same templates (PRD §6).

---

## 4. Data Model

New/changed types, all in `packages/core/src/schemas.ts` (Zod-first; `LoopEventSchema` with 24 types
already exists at line 574, `LoopStateStatusSchema` at lines 167–181).

| Type | Shape (summary) | Storage | Req |
| --- | --- | --- | --- |
| `PersistedEvent` | `LoopEvent & { seq: number; schemaVersion: string }` | one JSON line in `events.ndjson` | REQ-EVT-03/04 |
| `ActiveLoopEntry` | `{ stateDir, projectPath, backlogRoot, pid, startedAt, status }` | `~/.rauf/active/<hash>.json` | REQ-DISC-03 |
| `BacklogPaths.eventsLog` | `string` (= `stateDir/events.ndjson`) | derived path | REQ-EVT-01 |

On-disk layout after Phase 1 (default root shown; `--backlog <dir>` isolates identically):

```
<projectRoot>/.rauf/
  state.json               authoritative status (atomic write)        [unchanged]
  events.ndjson            current run's persisted event stream (NEW)
  iteration-status.json    live per-iteration tool/token status        [unchanged]
  rauf.log                 human log (fs.watch tailed)                 [unchanged]
  .loop.lock               PID + start-time, registry ground truth     [unchanged]
  archive/
    20260612-143052-events.ndjson   prior run (NEW; reset.ts {ts}- pattern)
    20260612-143052-rauf.log        existing archive naming           [unchanged]

~/.rauf/
  config.json              tool config                                 [unchanged]
  active/                  active-loop registry (NEW)
    a3f9c1e0...json        one entry per live loop, keyed by hash(stateDir)
```

`iteration-status.json` remains undocumented in SCHEMAS.md (pre-existing gap, `IterationStatusSchema`
exists at `schemas.ts:618`); Phase 1 may add its doc opportunistically but it is not required.

---

## 5. API Design

### 5.1 Core public API (additive; re-exported from `core/src/index.ts`)

```typescript
// events-log.ts
appendEvent(paths: BacklogPaths, record: PersistedEvent): Result<void>;
readEvents(paths: BacklogPaths): Result<PersistedEvent[]>;
rotateEventsLog(paths: BacklogPaths): Result<void>;
watchEvents(paths: BacklogPaths, onRecords: (r: PersistedEvent[]) => void): () => void; // bare cleanup fn, mirrors watchLog

// loop-registry.ts
registerLoop(entry: ActiveLoopEntry): Result<void>;
deregisterLoop(stateDir: string): Result<void>;
updateLoopStatus(stateDir: string, status: LoopStateStatus): Result<void>;
listActiveLoops(): Result<ActiveLoopEntry[]>;        // reconciled + self-healed
registryEntryPath(stateDir: string): string;

// fs-utils.ts
appendLine(filePath: string, line: string): Result<void>;
readNdjson<T>(filePath: string, schema: z.ZodType<T>): Result<T[]>;

// lock.ts
checkLockFile(lockPath: string): Result<LockStatus>; // extracted; checkLock delegates to it (LockStatus, not LockSummary)
```

### 5.2 CLI surface (post-Phase-1)

| Command | Flags | Source |
| --- | --- | --- |
| `status [path]` | `[--follow/-f] [--json] [--interval N] [--all] [--backlog <dir>]` | files + registry |
| `log [path]` | `[--tail N] [--follow/-f] [--json] [--backlog <dir>]` | `events.ndjson` + `rauf.log` |
| `follow [path]` | `[--json] [--interval N] [--backlog <dir>]` | `events.ndjson` replay+tail + `state.json` |
| `progress [path]` | `[--json] [--backlog <dir>]` | `progress.md` — **unchanged** |
| ~~`loop watch`~~ | — | **removed** (C-4) |
| ~~`loop follow`~~ | — | **removed → `follow`** |
| ~~`status --watch`~~ | — | **removed → `--follow`** |

### 5.3 Web API (read-path changes only; no new mutations)

| Method | Path | Change |
| --- | --- | --- |
| GET | `/api/projects/:id/loop/events` | tails `events.ndjson` (file = truth; buffer = cache); serves in-process runs |
| GET | `/api/loops` | returns reconciled `listActiveLoops()` (all live loops, not server-owned only) |
| GET | `/api/projects/:id/status`, `/log/stream`, `/log`, `/progress` | already file-based; verify in-process parity (SC-1) |

---

## 6. Integration Points

Verified function signatures and import paths (researcher-confirmed). "WARNING" marks anything to
re-verify at implementation time.

### 6.1 `packages/loop` → `packages/core`

- `LoopRunner.emitEvent()` (`runner.ts:1135`) — the persistence injection site (§3.1). All 24 events
  route through it; no other `this.emit` for LoopEvents exists.
- `LoopRunner.start()` (`runner.ts:139`) — call `rotateEventsLog(paths)` then reset `eventSeq=0`, and
  `registerLoop(entry)`; `deregisterLoop(paths.stateDir)` in the run's `finally`.
- `this.writeState()` wrapper (`runner.ts:1150–1168`) — pair each transition with `updateLoopStatus`.
- `resolveBacklogPaths(projectPath, backlogRoot)` (`backlog-root.ts:126`) and `resolveStateDir`
  (`backlog-root.ts:114`) — already produce `BacklogPaths`; add `eventsLog` field there.
- `git-commit.ts:gitCommit` (`git-commit.ts:36`) — add `events.ndjson` to `RUNTIME_EXCLUDE_PATHSPECS`
  (lines 18–27).
- `prompt-builder.ts:buildPrompt` (final IMPORTANT section, `prompt-builder.ts:247–251`) — add the
  no-commit reminder.

### 6.2 `packages/cli` → `packages/core`

- `deriveStatus(paths)` (`status.ts:357`) — unchanged signature; callers add inspected-dir +
  `listActiveLoops()` surfacing.
- `watchLog(paths, cb)` (`status.ts:410`) — pattern that `watchEvents` mirrors; `log --follow` keeps
  using it for `rauf.log` and adds `watchEvents` for `events.ndjson`.
- Flag helpers `extractBoolFlag/extractNumberFlag/extractStringFlag` (`parser.ts`) — reused;
  add `-f` short alias for `--follow`; `--interval` extraction reused verbatim from `status --watch`.
- Removed handlers: `handleLoopWatch` (`loop-commands.ts:1387–1464`), `handleLoopFollow`
  (`loop-commands.ts:675–712`). New `follow` reuses `followDirectMode` logic (`loop-commands.ts:588`).

### 6.3 `packages/web` → `packages/core`

- `routes/loop.ts` SSE handler (line 233) and `/api/loops` (line 101) — swap `manager.*` for
  `readEvents`/`watchEvents` + `listActiveLoops`. `manager.subscribe` buffer (`loop-manager.ts:136`)
  becomes a cache layer.
- `routes/status.ts` (`deriveStatus`, `readLogTail`, `watchLog`) — already file-based; no source
  change, just SC-1 verification.
- Frontend: `client/routes/projects/status.tsx` `LogPanel` (line 321) pattern (`EventSource` to
  `/log/stream`) is the template for the new `<EventTimeline>` (`EventSource` to `/loop/events`).
  Projects view `index.tsx` per-card status query (line 123) augmented with registry liveness.

### 6.4 Consumers of the loop contract (feature-forge)

Phase 1 is **additive to the contract** — `events.ndjson` is *introduced* but the unified exit codes
and formal versioning that feature-forge *reads* are Phase 3. The `loopRunner` event-stream/status
contract (`docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §A.7) gains `events.ndjson` as a documented surface but
no consumer-breaking change. `minRunnerVersion` is **not** bumped in Phase 1 (that flip is Phase 3 /
v0.5.0). **No feature-forge changes required by Phase 1.**

### 6.5 Self-hosting safety (C-5)

Implementing loops run with the frozen `rauf-stable` binary (`forge.config.json`
`loopRunner.bin: "rauf-stable"`) while the dev `rauf` is the thing being rewritten. Also note the dev
loop executes **built `dist/@rauf/loop`** (memory: `rauf_dev_runs_dist_not_src`) — any `runner.ts`/
`events.ts` change requires `pnpm --filter @rauf/loop build` before the dev loop reflects it.

### 6.6 Potential conflicts with in-progress features

- `specs/multi-backlog/` (DONE) established per-root state-dir isolation + `--backlog`; the registry
  builds on it (keyed by resolved state dir). No conflict.
- `specs/release-automation/`, `specs/claude-status/` — no overlap with the observation substrate.

---

## 7. Error Handling

Follows the core convention: `Result<T, RaufError>` for expected errors, never throw
(`errors.ts:9`). Event-specific posture:

- **Persistence is best-effort** (REQ-PERF-01/REL-02): `appendEvent` failures are swallowed in the
  runner's `persistEvent` try/catch and must never propagate into the loop. The loop's correctness
  never depends on the log being writable. **Persistent failure is intentionally fully silent** — log
  writability is never surfaced to the user. Rationale: `state.json` + `rauf.log` remain authoritative
  for status (REQ-OBS-02), so a silently non-writing event log degrades observation gracefully without
  needing its own error channel; adding one would couple loop health to a best-effort surface. (If a
  future phase wants a signal, the natural place is a single `appendLog` line to `rauf.log` on the
  first consecutive failure — explicitly out of scope for Phase 1.)
- **Torn-write correctness argument (load-bearing invariant).** Because there is exactly **one writer
  per root** (REQ-EVT-06) and every append is a single whole line via `fs.appendFileSync(line + "\n")`,
  any malformed/partial line can only ever be the **trailing** line (a crash or fs error mid-append
  leaves a partial final line; the next successful append would re-establish a clean newline boundary).
  `readNdjson`'s skip-the-bad-line tolerance is therefore *sufficient* — it never needs to recover an
  interior line, because an interior line can never be torn. This is the correctness basis for both the
  reader tolerance and the concurrent web-tail read below.
- **Readers tolerate torn trailing lines** (REQ-REL-01): `readNdjson` skips any line failing
  `JSON.parse`/`safeParse` and returns all earlier valid records. A web reader tailing `events.ndjson`
  while the runner appends is safe for the same reason — the only line a concurrent read can observe
  mid-write is the trailing one, which the tolerance already covers.
- **Graceful degradation** (REQ-REL-03): missing `events.ndjson` → `readEvents` returns `ok([])`;
  observers fall back to `state.json` + `rauf.log`.
- **Registry self-heal** (REQ-DISC-05): `listActiveLoops` reconciles each entry against lock/process
  liveness and unlinks dead entries; a corrupt entry file is skipped, not fatal.
- **Path violations** (REQ-SEC-01): `appendEvent`/registry writers call `validatePath` against the
  state dir / `~/.rauf` and return `PATH_VIOLATION` rather than writing outside the sandbox.

---

## 8. Testing Approach

Vitest, co-located `*.test.ts` (CLAUDE.md convention). Verification command: `pnpm typecheck`,
`pnpm test`, `pnpm lint` (forge.config.json) — SC-7.

### New unit tests (core)
- `events-log.test.ts`: append→read round-trip; `seq` monotonic + dense; coalescing drops sub-second
  token updates but keeps structural events; **torn-line tolerance** (append a partial JSON line →
  reader skips it, returns earlier records); `rotateEventsLog` moves to `archive/{ts}-events.ndjson`
  and starts fresh; missing file → `ok([])`. (SC-3, SC-6, REQ-EVT-02/03/05, REQ-REL-01.)
- `loop-registry.test.ts`: register→list→deregister; **stale self-heal** (entry whose pid is dead is
  pruned and excluded, SC-3/REQ-DISC-05); concurrency — many entries register/deregister without
  corruption (REQ-DISC-04); machine-wide listing across distinct state dirs (REQ-DISC-02/06);
  sandbox validation rejects out-of-`~/.rauf` paths.
- `fs-utils.test.ts`: `appendLine` + `readNdjson` torn-line cases.

### Loop integration (test-sandbox)
- A mock-Claude run produces a non-empty `events.ndjson` whose final state matches `state.json` (the
  never-contradict invariant, REQ-OBS-02 / SC-6); a killed-mid-run scenario leaves the registry
  reporting **not live** on next read and `state.json` correct (SC-3). Use `test-sandbox/` scenarios
  (`bash test-sandbox/verify.sh`).
- A dogfood loop run (with `rauf-stable`) produces **exactly one commit per item** with no agent-side
  commit (SC-5).

### CLI tests (update + add)
- `loop-commands.test.ts:100` subcommand assertion `["start","stop","follow","run","review","watch"]`
  → `["start","stop","run","review"]`; remove the `handleLoopFollow`/`handleLoopWatch` tests
  (lines ~159–198 + watch). `commands.test.ts` registry assertions updated. Any `status` usage string
  asserting `[--watch] [--interval N]` updated to `[--follow] [--json]`. (SC-4.)
- New `follow-command.test.ts`; `status --all` + empty-is-never-silent surfacing tests (names inspected
  dir; surfaces a registry-live loop in another root — SC-2); `log --json` + `--json` under `--follow`.

### Web tests
- `routes/loop.test.ts`: `/loop/events` serves a project's `events.ndjson` without a server-owned
  runner (in-process parity, SC-1); `/api/loops` returns registry-reconciled loops.
- **Frontend `<EventTimeline>` verification.** The web client has **no automated test harness today**,
  so the new `<EventTimeline>` component is not unit-tested. Its parity is verified two ways: (a) at the
  **API boundary** via `routes/loop.test.ts` above (the data it consumes is proven correct), and (b) by
  a **manual SC-1 check** — run a foreground `loop run` and confirm the web status page's timeline
  renders the live event stream. This manual check is part of the Phase-1 acceptance pass (added to the
  manual-verification checklist) so SC-1's web-parity claim is not asserted at the backend level alone.
  Standing up a frontend test harness (e.g. a thin `EventSource`→render test) is out of scope for Phase 1.

### Doc/template checks
- Grep guard: no "Commit your changes"/"Commit with:" remains in the 3 templates **or**
  `embedded-artifacts.ts` (§3.11); the no-commit line is present in `prompt-builder.ts` and the
  canonical wording matches `.rauf/RAUF.md` across all loci. (SC-5.)

### Compatibility
- A project with **no** `events.ndjson` runs unchanged; observers report correct status from
  `state.json` alone (REQ-COMPAT-01, REQ-REL-03 / SC-7).

---

## 9. Dependencies

**No new external packages.** Everything uses existing deps: `zod` (schemas), `node:crypto`
(registry hashing — Node built-in, already available under Bun), `node:fs`/`node:path` (IO).

Internal dependency direction (rule #1 preserved): `core` imports nothing from `loop`/`cli`/`web`;
`loop`/`cli`/`web` depend on `@rauf/core` (`workspace:*`). New core exports surface through
`core/src/index.ts`.

Build/verification dependencies to remember:
- `pnpm --filter @rauf/core build` regenerates `embedded-artifacts.ts` (§3.11) and runs
  `generate-json-schemas.ts` (no new schema file in Phase 1).
- `pnpm --filter @rauf/loop build` (dist, not src) before dev-loop testing (memory).

---

## 10. Open Technical Questions

All six PRD open questions are resolved above (OQ-1→D5+on-read reconcile; OQ-2→D3; OQ-3→D6;
OQ-4→D4; OQ-5→D7; OQ-6→D9 current-run-only). Remaining minor calls, with proposed defaults
(non-blocking; can settle during implementation):

- **TQ-1 — `seq` start value.** Proposed `0` for the first persisted record of a run (dense). Trivial;
  documented in §3.1.
- **TQ-2 — registry hash length.** Proposed first 16 hex chars of `sha256(resolvedStateDir)`.
  Collision risk negligible at expected scale; full hash if ever a concern.
- **TQ-3 — `watchEvents` debounce.** Proposed: on `fs.watch` change, re-read from the last byte offset
  and emit newly-appended records, debounced to coalesce burst writes (≈ the REQ-PERF-02 ≈1s feel). The
  `--interval` poll is both the fallback where `fs.watch` is unavailable **and** a periodic reconciliation
  safety-net against missed `fs.watch` fires when it is available — each tick re-reads from the last
  offset, so dropped watch events are eventually delivered (see §3.3).
- **TQ-4 — `iteration-status.json` documentation.** Pre-existing SCHEMAS.md omission; optional to fix
  in Phase 1 (its `IterationStatusSchema` already exists). Not required by any REQ.
