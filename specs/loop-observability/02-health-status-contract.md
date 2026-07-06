# 02 — Health & Status Contract (Phase 1)

> **Domain-concern document — Phase 1, "Complete the contract."** Specifies the
> single enabling change that makes `status --json` a complete decision surface:
> populating the additive `health` block on `DerivedStatus`, stamping the
> `statusSchemaVersion` marker on **every** `deriveStatus` return path, and the
> **shared-read refactor** (promote one `readIterationStatus` call so freshness
> and health feed from a single read — ≤1 read per `deriveStatus`, no subprocess).
>
> Builds on [`00-core-definitions.md`](./00-core-definitions.md) (the `Health`
> type/`HealthSchema`, `STATUS_SCHEMA_VERSION`, amended `DerivedStatusSchema`) and
> [`01-architecture-layout.md`](./01-architecture-layout.md) (file map, integration
> map rows #1–#5, #13). Traces to [`tech-spec.md`](./tech-spec.md) §3.1, §3.2, §6
> #1/#2, §7, §10 OTQ-1 and [`PRD.md`](./PRD.md) §3.1, §4.1, §4.3.
>
> **Does NOT redefine** shared types — `Health`, `HealthSchema`,
> `STATUS_SCHEMA_VERSION`, and the amended `DerivedStatusSchema` are owned by
> `00-core-definitions.md`. This document specifies the **derivation logic** that
> populates them inside `status.ts`.

---

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CONTRACT-01 | `status --json` a complete superset — no raw-file fallback | 2, 4.1 |
| REQ-CONTRACT-02 | Single poll answers all four agent decisions | 4.1, 4.4 |
| REQ-CONTRACT-03 | Stall/health surfaced as nested `health` block | 4.1, 4.2 |
| REQ-CONTRACT-04 | Health is a hint (booleans + raw age), not a verdict | 4.2 |
| REQ-CONTRACT-05 | Additive only — no field renamed/removed | 3, 4.5 |
| REQ-COMPAT-01 | Machine surface stays backward-compatible/additive | 3, 4.5, 6 |
| REQ-COMPAT-02 | Change versioned via `statusSchemaVersion` marker | 3, 4.3 |
| REQ-PERF-01 | ≤1 `readIterationStatus` per `deriveStatus`, no subprocess | 4.4, 5, 8 |
| REQ-SUCCESS-01 | One poll = full decision, zero raw-file reads | 4.1, 4.4 |
| REQ-SUCCESS-05 | No machine-surface output changed in a breaking way | 3, 4.5, 8 |
| C-02 | Status derivation never invokes subprocesses | 4.4, 5, 7 |
| C-04 | Health mirrors `IterationStatus` — read-only, not a new source | 4.2, 4.4 |

---

## 1. Purpose & Scope

**In scope (this document, Phase 1):**

- Populating `DerivedStatus.health` (`Health | null`) from the live
  `iteration-status.json`, computed inside `deriveStatus` (via `deriveFromStateJson`).
- The **null path**: absent/unparseable `iteration-status.json` → `health = null`,
  a normal non-fatal state.
- The **freshness computation** (`iterationFresh`) reusing the existing
  `ITERATION_STATUS_FRESH_MS` (60 s, `status.ts:36`), and `secondsSinceActivity`
  clamped `≥ 0`.
- The **shared-read promotion** (tech-spec §10 OTQ-1, REQ-PERF-01): today
  `iteration-status.json` is read **only conditionally** inside private `isLoopLive`
  (sole call site `status.ts:179`, the staleness-downgrade branch). This document
  promotes a **single** `readIterationStatus(paths)` call so both the liveness check
  and the `health` block feed from **one** read — total **≤1 read per `deriveStatus`**.
- **`statusSchemaVersion` stamping** on **every** return path of `deriveStatus`
  (Tier 1 state.json, Tier 2 log-parsing, and the `"none"` fallback).

**Out of scope (owned elsewhere):**

- The `Health`/`HealthSchema`/`STATUS_SCHEMA_VERSION`/`DerivedStatusSchema` *type
  definitions* — [`00-core-definitions.md`](./00-core-definitions.md) §1.
- `resolveTarget()` — [`03-target-resolution.md`](./03-target-resolution.md).
- `eventAltitude()` + `follow` rendering — [`04-event-altitude-follow.md`](./04-event-altitude-follow.md).
- CLI rendering of `health` and the poll recipe — [`05-supervision-recipe.md`](./05-supervision-recipe.md).
- The test suite — [`06-testing-strategy.md`](./06-testing-strategy.md) (checklist here in §8 is Phase-1 acceptance).

**Files touched (per `01-architecture-layout.md` §1):** `packages/core/src/status.ts`
only. `schemas.ts` carries the additive schema change owned by
`00-core-definitions.md` §1.4; this document consumes it.

---

## 2. The completeness guarantee (REQ-CONTRACT-01, REQ-SUCCESS-01)

The keystone: after this change, `rauf status <root> --backlog <dir> --json`
returns a `DerivedStatus` that is a **complete superset** of everything an agent
would otherwise scrape from `state.json`, `iteration-status.json`, or
`events.ndjson` to decide its next action. The specific hole this closes: the
stall signal (`stuckWarning`) lived **only** in `iteration-status.json`, forcing an
agent to read a raw file. Folding it into `health` means an agent branches on
`status.health?.stuckWarning` and never falls back to a file (REQ-SUCCESS-01).

`deriveStatus`'s **signature is unchanged**:

```ts
// packages/core/src/status.ts:365 — signature UNCHANGED
export function deriveStatus(paths: BacklogPaths): Result<DerivedStatus>;
```

Only the *contents* of the returned `DerivedStatus` grow (two additive fields).
`outputJson` (`cli/src/formatter.ts:113`) passes the enriched object through
**unchanged** — the version marker and `health` ride along in the object; the CLI
adds no version logic of its own (`01-architecture-layout.md` §5 #13).

---

## 3. Additive-only & versioning (REQ-CONTRACT-05, REQ-COMPAT-01, REQ-COMPAT-02, REQ-SUCCESS-05)

Two additive fields on `DerivedStatus`, defined in
[`00-core-definitions.md`](./00-core-definitions.md) §1.3–1.4:

- `statusSchemaVersion: "1"` — top-level marker, mirrors `EVENTS_SCHEMA_VERSION`.
- `health: Health | null` — the nested block.

**No existing field is renamed or removed.** Existing consumers that ignore unknown
fields are unaffected; new consumers detect `health` availability via the marker.
This document's obligation to that contract: **stamp `STATUS_SCHEMA_VERSION` on every
`deriveStatus` return path** (§4.3, §4.5) and **never** mutate an existing field
while adding `health`.

`STATUS_SCHEMA_VERSION` is the exported constant from `status.ts` (owned by
`00-core-definitions.md` §1.3):

```ts
// packages/core/src/status.ts — NEW export (definition owned by 00 §1.3)
export const STATUS_SCHEMA_VERSION = "1" as const;
```

---

## 4. Internal implementation

### 4.1 Where `health` is built and stamped

`health` and `statusSchemaVersion` must be present on **every** `DerivedStatus`
`deriveStatus` can return. There are three return shapes today (`status.ts:374–379`):

| Return path | Origin | `health` value | `statusSchemaVersion` |
|-------------|--------|----------------|-----------------------|
| **Tier 1** | `deriveFromStateJson` non-null (`:374`) | built from the shared read (§4.4) | `"1"` |
| **Tier 2** | `deriveFromLogParsing` (`:379`) | **`null`** (no live iteration signal to report) | `"1"` |
| **`"none"`** | `deriveFromLogParsing` early return (`:222`, `:257`) | **`null`** | `"1"` |

Tier 2 and the `"none"` fallback are the **no-live-iteration** paths — there is no
authoritative state.json, so `health` is `null` regardless of any file on disk. The
health *object* is only ever populated on the Tier 1 (state.json) path, and even
there only when the shared read yields a parseable status (§4.4). This satisfies the
`00 §1.2` nullability contract: `Health` object ⇒ an iteration is live; `null` ⇒ no
live iteration.

The four agent decisions (REQ-CONTRACT-02, REQ-SUCCESS-01) are all answerable from
the enriched object: **done** (`loopState ∈ {COMPLETE, IDLE}` + `backlogSummary`),
**needs-human** (`loopState = PAUSED_HUMAN` / `lastSignal` / `backlogSummary.needsHuman`),
**recoverable-stall** (`health?.stuckWarning`), **healthy**
(`loopState ∈ {RUNNING, REVIEWING}`, no stall hint). The decision tree itself lives
in `05-supervision-recipe.md`; this document only guarantees the inputs are present.

### 4.2 The `health` builder (REQ-CONTRACT-03, REQ-CONTRACT-04, C-04)

A new private helper in `status.ts` turns an already-read `IterationStatus` into a
`Health` object. It takes the **already-read** value (not `paths`) so it performs
**no I/O of its own** — the single read happens once in `deriveFromStateJson` (§4.4).

```ts
// packages/core/src/status.ts — NEW private helper

/**
 * Build the `health` block from an already-read IterationStatus.
 *
 * Takes the value (not `paths`) so it performs NO I/O — the single shared
 * `readIterationStatus` read lives in `deriveFromStateJson` (REQ-PERF-01, C-02).
 * Every field is a surfacing of `IterationStatus` — a computed value, never a new
 * source of truth (C-04). Returns a hint, not a verdict (REQ-CONTRACT-04):
 * booleans + a raw activity age, so the agent owns its escalation threshold.
 *
 * @param iterationStatus the parsed iteration-status.json, or null if absent/unparseable
 * @param now             derivation clock (ms since epoch); injected for testability
 * @returns a populated Health, or null when there is no live iteration
 */
function buildHealth(
  iterationStatus: IterationStatus | null,
  now: number,
): Health | null {
  if (iterationStatus === null) {
    return null;
  }

  // Freshness: reuse the existing 60s window (status.ts:36) — no new threshold.
  const updatedAtMs = new Date(iterationStatus.updatedAt).getTime();
  const iterationFresh =
    !Number.isNaN(updatedAtMs) && now - updatedAtMs < ITERATION_STATUS_FRESH_MS;

  // secondsSinceActivity: whole seconds, clamped ≥ 0 so a future lastActivityAt
  // (clock skew) never yields a negative age (00 §1.1 field table).
  const lastActivityMs = new Date(iterationStatus.lastActivityAt).getTime();
  const secondsSinceActivity = Number.isNaN(lastActivityMs)
    ? 0
    : Math.max(0, Math.floor((now - lastActivityMs) / 1000));

  return {
    stuckWarning: iterationStatus.stuckWarning, // faithful mirror (C-04)
    iterationFresh,
    lastActivityAt: iterationStatus.lastActivityAt,
    secondsSinceActivity,
  };
}
```

Field provenance is exactly the `00 §1.1` table:

| `Health` field | Source (`IterationStatusSchema`, `schemas.ts:710`) | Derivation |
|----------------|-----------------------------------------------------|------------|
| `stuckWarning` | `stuckWarning` (`:721`) | direct copy |
| `iterationFresh` | `updatedAt` (`:713`) | `now - updatedAt < ITERATION_STATUS_FRESH_MS` |
| `lastActivityAt` | `lastActivityAt` (`:720`) | direct copy |
| `secondsSinceActivity` | `lastActivityAt` (`:720`) | `max(0, floor((now - lastActivityAt) / 1000))` |

`Health` and `IterationStatus` types are imported from `./schemas.js` (the type
`IterationStatus` already backs `readIterationStatus`'s return; add `Health` to the
existing `status.ts` import block at `:11`).

### 4.3 `statusSchemaVersion` stamping

Every return object literal that today produces a `DerivedStatus` gains
`statusSchemaVersion: STATUS_SCHEMA_VERSION`. Two clean placements avoid touching
each individual literal:

- **Tier 1** (`deriveFromStateJson` return, `status.ts:186`): add
  `statusSchemaVersion: STATUS_SCHEMA_VERSION` and `health` to the returned object
  literal (it is the only Tier-1 literal).
- **Tier 2 + `"none"`** (`deriveFromLogParsing`): stamp once on the `base` literal
  (`status.ts:207`). Because every Tier-2 return spreads `...base`
  (`:222`, `:238`, `:249`, `:257`, `:261`), stamping `base` covers **all** log-parsing
  paths in one place. Also set `health: null` on `base` for the same reason.

> **Implementation note:** because `deriveStatus` returns `deriveFromStateJson`'s value
> or `deriveFromLogParsing`'s value directly (with `lock` spread on top, `:375`/`:379`),
> stamping at the two producer functions guarantees the marker on **every** path
> without a post-hoc mutation in `deriveStatus`. Do **not** stamp in `deriveStatus`
> alone — `deriveFromStateJson` and `deriveFromLogParsing` are the type-checked
> sources of the `DerivedStatus` shape and the schema (`00 §1.4`) now requires both
> new keys, so both literals must carry them or `tsc` fails.

### 4.4 The shared-read promotion (REQ-PERF-01, C-02, C-04, tech-spec §10 OTQ-1)

**This is the required refactor**, not optional (tech-spec §6 WARNING, §10 OTQ-1).

**Before (`status.ts:143–182`).** `readIterationStatus` is called **only** inside
private `isLoopLive`, whose **sole** call site is the staleness-downgrade branch
(`:179`). On the healthy path `iteration-status.json` is **not** read at all:

```ts
// BEFORE — status.ts:143 (isLoopLive reads iteration-status.json internally)
function isLoopLive(paths: BacklogPaths, now: number): boolean {
  const lock = checkLock(paths);
  if (lock.ok && lock.value.locked && lock.value.stale !== true) return true;

  const iterationStatus = readIterationStatus(paths);      // ← conditional read
  if (iterationStatus) {
    const updatedAt = new Date(iterationStatus.updatedAt).getTime();
    if (!Number.isNaN(updatedAt) && now - updatedAt < ITERATION_STATUS_FRESH_MS) {
      return true;
    }
  }
  return false;
}

// BEFORE — status.ts:179 (sole call site, inside the staleness-downgrade branch)
if (now - updatedAt > STALENESS_THRESHOLD_MS && !isLoopLive(paths, now)) {
  loopState = "PAUSED";
}
```

Populating `health` on the healthy path would naïvely add a **second**
`readIterationStatus` — violating REQ-PERF-01. The fix: read **once** at the top of
`deriveFromStateJson`, pass the value into an `isLoopLive`-equivalent (renamed to make
the injected value explicit) **and** into `buildHealth`.

**After (`status.ts`).** One read; `isLoopLive` becomes a pure predicate over the
already-read value:

```ts
// AFTER — pure predicate; no I/O. Takes the already-read IterationStatus.
/**
 * Decide whether an apparently-stale running loop is still alive, using signals
 * already read by the caller (no I/O here). Either a live lock OR a fresh
 * iteration-status means RUNNING. Reads only — never spawns a subprocess (C-02).
 *
 * @param paths            backlog paths (for the lock check only)
 * @param iterationStatus  the SINGLE shared read from deriveFromStateJson
 * @param now              derivation clock (ms)
 */
function isLoopLive(
  paths: BacklogPaths,
  iterationStatus: IterationStatus | null,
  now: number,
): boolean {
  const lock = checkLock(paths);
  if (lock.ok && lock.value.locked && lock.value.stale !== true) return true;

  if (iterationStatus) {
    const updatedAt = new Date(iterationStatus.updatedAt).getTime();
    if (!Number.isNaN(updatedAt) && now - updatedAt < ITERATION_STATUS_FRESH_MS) {
      return true;
    }
  }
  return false;
}
```

```ts
// AFTER — deriveFromStateJson: ONE shared read feeds both liveness and health.
function deriveFromStateJson(paths: BacklogPaths): Result<DerivedStatus | null> {
  const stateResult = readJsonFile(paths.state, LoopStateSchema);
  if (!stateResult.ok) {
    return ok(null); // fall through to Tier 2
  }

  const state = stateResult.value;
  const now = Date.now();

  // ── The single shared read (REQ-PERF-01, ≤1 per deriveStatus) ──
  // Feeds BOTH the staleness/liveness check below AND the health block. Reading
  // it unconditionally here (rather than lazily inside isLoopLive) is what keeps
  // the total at exactly one read while still populating health on the healthy
  // path. It is a file read only — no subprocess (C-02).
  const iterationStatus = readIterationStatus(paths);

  let loopState = mapLoopStateStatus(state.status);

  // Staleness downgrade — unchanged semantics, now fed the shared read.
  if ((state.status === "running" || state.status === "starting") && state.updatedAt) {
    const updatedAt = new Date(state.updatedAt).getTime();
    if (
      now - updatedAt > STALENESS_THRESHOLD_MS &&
      !isLoopLive(paths, iterationStatus, now)
    ) {
      loopState = "PAUSED";
    }
  }

  const elapsed = computeElapsed(state.startedAt);

  return ok({
    statusSchemaVersion: STATUS_SCHEMA_VERSION, // NEW — additive (§4.3)
    loopState,
    stateSource: "state.json" as const,
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    currentItem: state.currentItem,
    lastSignal: state.lastSignal,
    startedAt: state.startedAt,
    elapsed,
    backlogSummary: computeBacklogSummary(paths),
    sleepUntil: state.sleepUntil ?? null,
    health: buildHealth(iterationStatus, now), // NEW — from the SAME read (§4.2)
  });
}
```

**Read-count invariant:** on the Tier-1 path, `readIterationStatus(paths)` is invoked
**exactly once** per `deriveStatus`. `isLoopLive` no longer reads it; `buildHealth`
takes the value, not `paths`. On the Tier-2/`"none"` paths (no state.json),
`deriveFromStateJson` returns `ok(null)` *before* the read is reached, so those paths
perform **zero** iteration-status reads and set `health: null` — still ≤1
(§4.1). No path exceeds one read; none spawns a subprocess (C-02).

> **Clock injection (testability):** `now = Date.now()` is captured once at the top of
> `deriveFromStateJson` and threaded into `isLoopLive` and `buildHealth`, so a test can
> assert `iterationFresh`/`secondsSinceActivity` against a fixed clock by controlling
> the fixture's `updatedAt`/`lastActivityAt` relative to a known `now` (no wall-clock
> flake — §8). If a stronger seam is wanted, `deriveFromStateJson` may accept an
> optional `now` parameter defaulting to `Date.now()`; `deriveStatus`'s public
> signature stays unchanged (§2) either way.

### 4.5 Every-path coverage summary

| `deriveStatus` return | `statusSchemaVersion` | `health` | Stamped at |
|-----------------------|-----------------------|----------|------------|
| Tier 1 (state.json) | `"1"` | `Health` object or `null` (from shared read) | `deriveFromStateJson` literal (§4.3) |
| Tier 2 (log-parsing) | `"1"` | `null` | `base` literal (`:207`) |
| `"none"` (no log) | `"1"` | `null` | `base` literal (spread) |

`lock` is still spread on top in `deriveStatus` (`:375`/`:379`) — unchanged. No
existing field is touched (REQ-CONTRACT-05, REQ-SUCCESS-05).

---

## 5. Performance (REQ-PERF-01, C-02)

- **≤1 `readIterationStatus` per `deriveStatus`** — guaranteed by the single read in
  `deriveFromStateJson` (§4.4). Asserted by a read-spy/counter test against the
  pre-refactor baseline (§8).
- **No subprocess** — derivation reads files only (`readJsonFile`, `checkLock`,
  `readBacklog`, `readIterationStatus`); it never spawns a process (C-02). The
  `health` block adds **no** new expensive I/O beyond the already-written
  `iteration-status.json` (REQ-PERF-01, PRD §4.1) — and even that read is not *new*,
  it is *relocated* from `isLoopLive` to the top of `deriveFromStateJson`.
- The prescribed poll interval (5–10 s) is a `drive-rauf-loop` prescription, not a
  code constant here (`00 §3`); this document only ensures each poll stays cheap.

---

## 6. Configuration

**None.** No new constant, flag, env var, or config key. `iterationFresh` reuses the
existing `ITERATION_STATUS_FRESH_MS` (60 s, `status.ts:36`) — no new threshold
(REQ-PERF-01). `STATUS_SCHEMA_VERSION = "1"` is a compile-time constant, not
runtime-configurable.

---

## 7. Error handling

Follows the project convention: core returns `Result<T, E>`, never throws for
expected errors (`deriveStatus` signature unchanged, §2).

| Failure | Handling | Fatal to `deriveStatus`? |
|---------|----------|--------------------------|
| `iteration-status.json` absent | `readIterationStatus` returns `null` → `buildHealth` returns `null` → `health = null` | **No** — normal "no live iteration" state |
| `iteration-status.json` unparseable / fails `IterationStatusSchema` | `readIterationStatus` returns `null` (it catches read + `JSON.parse` + validation internally, `iteration-status.ts:50–67`) → `health = null` | **No** |
| `updatedAt` not a valid date | `iterationFresh = false` (guarded by `Number.isNaN`) | No |
| `lastActivityAt` not a valid date | `secondsSinceActivity = 0` (guarded by `Number.isNaN`) | No |
| `lastActivityAt` in the future (clock skew) | `secondsSinceActivity` clamped to `0` via `Math.max(0, …)` | No |
| `state.json` absent/invalid | `deriveFromStateJson` returns `ok(null)` → Tier 2 with `health = null` (unchanged behavior) | No |

**Best-effort, non-fatal health (tech-spec §7):** `deriveStatus` **never fails
solely because health couldn't compute.** A missing/unparseable
`iteration-status.json` is a normal state that yields `health = null`, not an error
`Result`. `buildHealth` cannot throw — every date parse is guarded; there is no
uncaught path. `readIterationStatus` already swallows its own read/parse/validation
errors and returns `null` (`iteration-status.ts:50–67`), so the shared read never
propagates an exception into `deriveFromStateJson`.

---

## 8. Verification (Phase-1 acceptance)

Vitest, colocated `status.test.ts`. Full detail in
[`06-testing-strategy.md`](./06-testing-strategy.md); this is the Phase-1
acceptance checklist (tech-spec §8 Phase 1).

- [ ] `deriveStatus` returns `health` mirroring a fixture `iteration-status.json`:
      `stuckWarning` surfaced as `true` and as `false`.
- [ ] `health === null` when `iteration-status.json` is **absent**, and when it is
      present but **unparseable** / schema-invalid (non-fatal — result stays `ok`).
- [ ] `health === null` on the Tier-2 (log-parsing) and `"none"` paths regardless of
      any `iteration-status.json` on disk.
- [ ] `iterationFresh` is `true` when the fixture `updatedAt` is within 60 s of an
      **injected fixed clock**, `false` when older; no wall-clock dependency.
- [ ] `secondsSinceActivity` equals `floor((now - lastActivityAt)/1000)` against the
      fixed clock; **clamped to `0`** for a future `lastActivityAt`.
- [ ] `statusSchemaVersion === "1"` present on **every** return path: Tier 1, Tier 2,
      and `"none"`.
- [ ] **Read-count invariant (REQ-PERF-01):** with a read spy/counter wrapping
      `readIterationStatus`, `deriveStatus` invokes it **at most once** on the Tier-1
      path — **no increase vs. the pre-refactor baseline** (which read it 0–1×) — and
      **zero** times on the Tier-2/`"none"` paths. No subprocess is spawned (C-02).
- [ ] **Additive-compat parse (REQ-CONTRACT-05, REQ-SUCCESS-05):** an existing-shape
      consumer parse (no `health`/`statusSchemaVersion` awareness) still succeeds
      against the enriched object; `DerivedStatusSchema` accepts both `health: null`
      and a populated `health`.
- [ ] **Staleness semantics unchanged:** the >5-min-stale `running` → `PAUSED`
      downgrade still fires (and is still suppressed by a fresh iteration-status or a
      live lock) after the `isLoopLive` refactor — regression-covered by the existing
      `status.test.ts` liveness cases, which must remain green.
- [ ] `deriveStatus`'s public signature is unchanged (`(paths) => Result<DerivedStatus>`).
- [ ] `pnpm gate` green (incl. `schema:check` for the additive `DerivedStatusSchema`;
      regenerate the schema snapshot if flagged — `01-architecture-layout.md` §6).

---

## Dependencies

**Must be implemented first:**

- [`00-core-definitions.md`](./00-core-definitions.md) — `Health`/`HealthSchema`,
  `STATUS_SCHEMA_VERSION` (§1.3), and the amended `DerivedStatusSchema` (§1.4). This
  document's code will not type-check until those two additive schema fields exist.

**Consumes existing (unchanged) core surfaces:**

- `readIterationStatus(paths): IterationStatus | null` — `iteration-status.ts:50`.
- `IterationStatus` / `IterationStatusSchema` — `schemas.ts:710` (read-only, C-04).
- `ITERATION_STATUS_FRESH_MS` — `status.ts:36` (reused, not redefined).
- `checkLock`, `computeBacklogSummary`, `computeElapsed`, `mapLoopStateStatus`,
  `readJsonFile`, `LoopStateSchema`, `Result`/`ok` — all existing in `status.ts` /
  its imports (`status.ts:1–20`).

**Referenced by (later docs):**

- [`05-supervision-recipe.md`](./05-supervision-recipe.md) reads `health.stuckWarning`
  off this contract for the four-way decision tree.
- [`06-testing-strategy.md`](./06-testing-strategy.md) owns the full Phase-1 test suite.

---

## Warnings

- **`isLoopLive` is currently private** in `status.ts` and reads
  `iteration-status.json` **only** in the staleness-downgrade branch (sole call site
  `:179`), **not** on the healthy path. The shared-read promotion (§4.4) is a
  **required** refactor (tech-spec §10 OTQ-1), constrained by the **≤1-read-per-poll**
  invariant. Verified against source at `status.ts:143–182`.
- All integration signatures in this document were read from source
  (`status.ts`, `iteration-status.ts`, `schemas.ts:710`) — no missing exports.
