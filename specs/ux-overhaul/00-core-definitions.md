# 00 — Core Definitions

Shared types, schemas, error codes, and constants for the **UX/DX Overhaul — Phase 1 (observation
substrate)**. Every other spec document in this suite references definitions here. All new types live
in `packages/core` (architecture rule #1) and are re-exported from `packages/core/src/index.ts`.

> Source of truth: [`PRD.md`](./PRD.md) (`REQ-*`) and [`tech-spec.md`](./tech-spec.md) (decisions
> `D1`–`D9`). Where this spec and [`CANON.md`](./CANON.md) disagree, the canon wins.

## Requirement Coverage

| REQ ID        | Requirement                                                        | Section                       |
| ------------- | ------------------------------------------------------------------ | ----------------------------- |
| REQ-EVT-01    | Persist every `LoopEvent` to `events.ndjson` in the state dir      | 1.1, 3.1 (`eventsLog`)        |
| REQ-EVT-03    | Self-describing records: `type` + timestamp + per-run `seq`        | 1.1 `PersistedEvent`          |
| REQ-EVT-04    | Schema/version identifier from first release                       | 1.1, 2.1 `EVENTS_SCHEMA_VERSION` |
| REQ-DISC-03   | Central active-loop registry keyed by resolved state dir           | 1.2 `ActiveLoopEntry`         |
| REQ-OBS-02    | `state.json` authoritative; registry `status` advisory only        | 1.2 `ActiveLoopEntry.status`  |
| REQ-EVT-02    | Token-update coalescing cadence constant                           | 2.2 `TOKEN_COALESCE_MS`       |
| REQ-SEC-01    | Registry path under `~/.rauf/active/`                              | 2.3 `ACTIVE_DIR`              |
| REQ-COMPAT-03 | All new types in core; zero `cli`/`web` imports                    | 4 (Type Locations)            |

> Note: the operational requirements these types serve (append/read/rotate/watch, registry
> reconciliation, CLI/web wiring, commit-rule) are covered in `02`–`07`. This document defines **only
> the shared vocabulary** those documents build on.

---

## 1. Types

All types are Zod-first: the schema is the source of truth and the TypeScript type is inferred with
`z.infer`. This matches the existing pattern in `packages/core/src/schemas.ts` (e.g. `LoopEventSchema`
→ `LoopEvent` at `schemas.ts:574`/`:661`).

### 1.1 `PersistedEvent` / `PersistedEventSchema` (REQ-EVT-03, REQ-EVT-04) — D2

One line of `events.ndjson`. A **flat** record: the existing `LoopEvent` discriminated union (24
members, `schemas.ts:574`) intersected with a two-field envelope. Each line is independently parseable
and self-describing.

```typescript
// packages/core/src/schemas.ts — added next to LoopEventSchema (line 574)
import { z } from "zod";

/**
 * One line of events.ndjson: a full LoopEvent plus a per-run dense sequence
 * number and a schema-version tag.
 *
 * FLAT by design (tech-spec D2): the entire LoopEvent is preserved, so a reader
 * needs no join against another surface to interpret a record.
 */
export const PersistedEventSchema = z.intersection(
  LoopEventSchema,
  z.object({
    /**
     * Monotonic, dense, per-run sequence number. Assigned ONLY when a record is
     * actually written to disk (tech-spec §3.1), so coalesced/dropped token
     * updates never consume a seq. A gap in seq over a fully-quiesced file means
     * corruption; an apparent gap while live-tailing means a torn trailing line
     * (re-read from last offset). Reset to 0 at the start of each run.
     */
    seq: z.number().int().nonnegative(),
    /**
     * Event-log schema version. "1" for Phase 1. Forward-stable machine contract
     * (CANON §4.5). The version envelope ships now (REQ-EVT-04); the formal
     * bump/publish discipline is Phase 3.
     */
    schemaVersion: z.string(),
  }),
);

/** A LoopEvent persisted to events.ndjson, carrying seq + schemaVersion. */
export type PersistedEvent = z.infer<typeof PersistedEventSchema>;
```

**Implementation note — first `z.intersection` in the codebase.** `schemas.ts` has no existing
`z.intersection`. Intersecting a `z.discriminatedUnion` with an object parses correctly in zod 3 but
**forfeits the discriminated-union fast path / focused error messages** (the intersection runs both
schemas and deep-merges). This is acceptable at Phase-1 event volumes (token updates coalesced to
≈1/sec; see `tech-spec.md` §3.3 growth note). `LoopEventSchema.and(EnvelopeSchema)` is an equivalent
terser spelling. Do **not** extend each of the 24 member schemas individually — that is 24× the
boilerplate and must stay in sync as events are added. Revisit only if profiling shows per-line parse
is hot. (tech-spec §3.4.)

**Why flat, not enveloped.** A `{ seq, schemaVersion, event: LoopEvent }` shape was rejected: it forces
every reader to unwrap `.event` and breaks the "each line is a self-describing LoopEvent + 2 fields"
property that makes `events.ndjson` trivially greppable. (tech-spec D2.)

### 1.2 `ActiveLoopEntry` / `ActiveLoopEntrySchema` (REQ-DISC-03, REQ-OBS-02) — D5

One entry in the machine-wide active-loop registry: a single file
`~/.rauf/active/<hash>.json` per running loop (see `03-active-loop-registry.md`).

```typescript
// packages/core/src/schemas.ts
import { LoopStateStatusSchema } from "./schemas.js"; // already defined at schemas.ts:167

/**
 * A registry entry describing one currently-running loop. Written at loop start
 * (registerLoop), refreshed on each status transition (updateLoopStatus), and
 * removed at loop exit (deregisterLoop). One file per loop under ~/.rauf/active/,
 * keyed by sha256(resolvedStateDir)[:16].
 */
export const ActiveLoopEntrySchema = z.object({
  /** Resolved (absolute) state directory — the registry key source AND the
   *  reconciliation anchor (its .loop.lock is ground truth, REQ-DISC-05). */
  stateDir: z.string(),
  /** Project root the loop runs against (contains .rauf.json marker). */
  projectPath: z.string(),
  /** The --backlog root (equals projectPath/.rauf for the default root). */
  backlogRoot: z.string(),
  /** OS process id of the runner, used for liveness reconciliation. */
  pid: z.number().int(),
  /** ISO-8601 timestamp the loop registered. */
  startedAt: z.string(),
  /**
   * Advisory last-known status. state.json remains the SINGLE authoritative
   * source for current status (REQ-OBS-02); this field is a convenience for the
   * cross-root listing and MUST NOT be trusted over state.json.
   */
  status: LoopStateStatusSchema,
});

/** One live-loop registry entry. */
export type ActiveLoopEntry = z.infer<typeof ActiveLoopEntrySchema>;
```

`LoopStateStatusSchema` already exists (`schemas.ts:167`) as a `z.enum`:
`idle | starting | running | paused | complete | paused_human | limit_reached | error |
sleeping_limit | weekly_limit | reviewing | paused_usage_limit`. The registry **reuses** it; Phase 1
adds no status values (the missing-badges / status-vocabulary work is Phase 4).

### 1.3 `BacklogPaths.eventsLog` (REQ-EVT-01) — additive field

The existing `BacklogPaths` interface (`backlog-root.ts:34`) gains **one** field. Every other field is
unchanged.

```typescript
// packages/core/src/backlog-root.ts — add to interface BacklogPaths
export interface BacklogPaths {
  // ... all existing fields unchanged (projectPath, root, stateDir, backlog,
  //     state, log, done, cancel, progress, iterationStatus, archive, lock) ...

  /** Path to events.ndjson — the persisted per-run event stream (= stateDir/events.ndjson). NEW. */
  eventsLog: string;
}
```

It is populated in `resolveBacklogPaths()` (`backlog-root.ts:178`) alongside the other state-dir
paths:

```typescript
// inside resolveBacklogPaths(), in the returned BacklogPaths object:
eventsLog: path.join(stateDir, "events.ndjson"),
```

Because `eventsLog` is derived purely from `stateDir`, it inherits the per-root isolation and the path
sandbox automatically (every observer/writer validates against `paths.stateDir`).

---

## 2. Constants

### 2.1 `EVENTS_SCHEMA_VERSION` (REQ-EVT-04)

```typescript
// packages/core/src/schemas.ts
/** events.ndjson record schema version. Forward-stable machine contract (CANON §4.5).
 *  Bumped only under the formal versioning discipline that lands in Phase 3. */
export const EVENTS_SCHEMA_VERSION = "1";
```

### 2.2 `TOKEN_COALESCE_MS` (REQ-EVT-02) — D3

```typescript
// packages/core/src/schemas.ts (or events-log.ts; lives in core so loop + tests share it)
/**
 * Coalescing window for llm_token_update persistence: at most one token-update
 * record is written to events.ndjson per this interval (time-based,
 * last-write-wins). Satisfies REQ-EVT-02's "≤ ~1/sec".
 *
 * DELIBERATELY independent of, and 5× finer than, the runner's existing
 * TOKEN_EVENT_THROTTLE_MS = 5_000 (runner.ts:70) that gates iteration-status.json.
 * Consequence (accepted): events.ndjson carries MORE token records than
 * iteration-status.json reflects — each surface coalesces at its own rate.
 */
export const TOKEN_COALESCE_MS = 1000;
```

### 2.3 `ACTIVE_DIR` (REQ-SEC-01) — D5

```typescript
// packages/core/src/loop-registry.ts
import * as path from "node:path";
import { TOOL_CONFIG_DIR } from "./config.js"; // = ~/.rauf, exported at config.ts:177

/** Active-loop registry directory: ~/.rauf/active/. Inside the established sandbox. */
const ACTIVE_DIR = path.join(TOOL_CONFIG_DIR, "active");
```

`TOOL_CONFIG_DIR` is the existing `~/.rauf` constant (`config.ts:13`, exported `config.ts:177`).
Confirmed present — no new home-dir resolution is introduced.

### 2.4 Canonical artifact name

```typescript
/** Per-run event log file name within a backlog root's state directory. CANON-fixed. */
export const EVENTS_LOG_FILENAME = "events.ndjson";
```

`STATE_FILENAME`, `BACKLOG_FILENAME`, `LOCK_FILENAME`, `DEFAULT_ROOT_DIR` already exist
(`backlog-root.ts:10–22`) and are reused unchanged.

---

## 3. Error Codes

### 3.1 `IO_ERROR` (REQ-EVT-06, REQ-REL-01) — new

The append/read primitives (`appendLine`, `readNdjson`; see `02-event-log.md`) need a failure code,
and **no existing `ErrorCodes` member carries the right semantics** (`FILE_NOT_FOUND` is wrong —
absence is handled by returning `ok([])`, not an error; `INVALID_JSON`/`VALIDATION_ERROR` are about
content shape, not fs failure). Add `IO_ERROR` to the existing `ErrorCodes` const (`errors.ts:21`):

```typescript
// packages/core/src/errors.ts
export const ErrorCodes = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_JSON: "INVALID_JSON",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PATH_VIOLATION: "PATH_VIOLATION",
  ALREADY_INSTALLED: "ALREADY_INSTALLED",
  NOT_INSTALLED: "NOT_INSTALLED",
  CONFLICT: "CONFLICT",
  TRANSITION_INVALID: "TRANSITION_INVALID",
  LOCK_CONFLICT: "LOCK_CONFLICT",
  IO_ERROR: "IO_ERROR", // NEW — fs append/read failure (events.ndjson, registry)
} as const;
```

**Error shape** (per the existing `RaufErrorSchema`, `schemas.ts:328` — `{ code, message, details? }`):

```typescript
{ code: "IO_ERROR", message: "appendLine failed: EACCES: permission denied, open '…/events.ndjson'" }
```

### 3.2 Reused error codes (no change)

- `PATH_VIOLATION` — returned by `validatePath` (`fs-utils.ts:140`) when an event-log or registry write
  would escape the sandbox (REQ-SEC-01). Reused verbatim.

---

## 4. Reused Types & Locations (no changes required)

These existing types are consumed by the new modules but are **not** modified by Phase 1:

| Type / symbol                | Where it lives            | Used by                                          |
| ---------------------------- | ------------------------- | ------------------------------------------------ |
| `LoopEvent` / `LoopEventSchema` | `schemas.ts:574`/`:661` | `PersistedEvent` (intersection base)             |
| `LoopStateStatus` / `LoopStateStatusSchema` | `schemas.ts:167`/`:643` | `ActiveLoopEntry.status`, `updateLoopStatus`     |
| `LoopState` / `LoopStateSchema` | `schemas.ts:185`        | `state.json` (authoritative status — unchanged)  |
| `LockStatus`                 | `lock.ts:39`              | `checkLockFile` return (registry reconciliation) |
| `LockFileContent`            | `lock.ts:15`              | lock ground-truth read during reconciliation     |
| `BacklogPaths`               | `backlog-root.ts:34`      | every event-log/registry call site               |
| `Result<T, E>` / `ok` / `err`| `errors.ts:9`/`:11`/`:15` | return type of all new public functions          |
| `RaufError` / `RaufErrorSchema` | `schemas.ts:328`/`:656` | error payloads                                    |
| `IterationStatus`            | `schemas.ts:618`/`:664`   | unchanged; still read by `status`/`follow`       |
| `TOOL_CONFIG_DIR`            | `config.ts:13`/`:177`     | `ACTIVE_DIR` base                                |

**Type locations for the NEW symbols:**

- `PersistedEvent` / `PersistedEventSchema`, `ActiveLoopEntry` / `ActiveLoopEntrySchema`,
  `EVENTS_SCHEMA_VERSION`, `TOKEN_COALESCE_MS`, `EVENTS_LOG_FILENAME` → `schemas.ts`
- `IO_ERROR` → `errors.ts` (`ErrorCodes` const)
- `BacklogPaths.eventsLog` → `backlog-root.ts`
- `ACTIVE_DIR` (module-private) → `loop-registry.ts`

All public additions are re-exported from `packages/core/src/index.ts` (see
`01-architecture-layout.md` §3 for the exact export list). `Result<T, E>` uses the `{ ok, value }` /
`{ ok, error }` shape (NOT `{ success, data }`) — every new function returns it.

---

## Dependencies

None — this is the foundation document. Every other document (`02`–`07`) depends on the types,
constants, and error codes defined here.

## Verification

- [ ] `PersistedEventSchema` is `z.intersection(LoopEventSchema, { seq, schemaVersion })`; `seq` is a
      non-negative int, `schemaVersion` a string; `z.infer` yields a usable `PersistedEvent`.
- [ ] `ActiveLoopEntrySchema` has all six fields (`stateDir`, `projectPath`, `backlogRoot`, `pid`,
      `startedAt`, `status`) with JSDoc on each; `status` reuses `LoopStateStatusSchema`.
- [ ] `BacklogPaths` gains exactly one field, `eventsLog`, populated in `resolveBacklogPaths()` as
      `stateDir/events.ndjson`; no other `BacklogPaths` field changes.
- [ ] `EVENTS_SCHEMA_VERSION === "1"`, `TOKEN_COALESCE_MS === 1000`, `ACTIVE_DIR === ~/.rauf/active`.
- [ ] `IO_ERROR` is added to `ErrorCodes` and is the only new error code.
- [ ] Every new public symbol is re-exported from `core/src/index.ts`.
- [ ] `pnpm --filter @rauf/core typecheck` passes with the new schema and field.
