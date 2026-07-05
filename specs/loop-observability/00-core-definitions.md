# 00 — Core Definitions

> **Foundation document.** Every other spec doc in this suite references the
> types, schemas, constants, and error variants defined here. When a later
> document says "the `Health` type" or "`TargetError`", it means *exactly* the
> definition in this file. Traces to
> [`tech-spec.md`](./tech-spec.md) §4 (Data Model), §7 (Error Handling) and
> [`PRD.md`](./PRD.md) §3.1, §3.4.

All new types land in **`packages/core`** (project rule #1 — `core` has zero
imports from `cli`/`web`). Nothing here introduces a new persisted state file or
a new event type (PRD §7); the additions are **one in-memory schema** (`Health`),
**two additive fields** on `DerivedStatusSchema`, **one classifier return type**
(`EventAltitude`), and the **resolver contract types** (`ResolveTargetOptions`,
`ResolvedTarget`, `TargetError`).

---

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CONTRACT-03 | Stall/health signal surfaced as nested `health` block | 1.1, 1.2 |
| REQ-CONTRACT-04 | Health is a hint (booleans + raw age), not an enum verdict | 1.1 |
| REQ-CONTRACT-05 | Additive only — no field renamed/removed | 1.3 |
| REQ-CONTRACT-06 | `BacklogSummary` disjointness preserved (unchanged) | 1.4 |
| REQ-COMPAT-02 | Versioned via `statusSchemaVersion` marker | 1.3, 3 |
| REQ-CMD-02 / REQ-CMD-03 | Altitude classification return type | 2 |
| REQ-SCOPE-01…05 | Target-resolution contract types | 4 |
| REQ-SAFE-02 | Strict machine-context resolution encoded in the type | 4.1, 4.4 |
| REQ-PERF-01 | Freshness reuses existing constant, no new I/O threshold | 1.1, 3 |
| C-04 | Health mirrors `IterationStatus` — read-only source | 1.1, 1.5 |

---

## 1. The `health` block

### 1.1 `Health` type + `HealthSchema`

The stall/health signal that today lives **only** in `.rauf/iteration-status.json`
is surfaced directly on `DerivedStatus` as a nested block (REQ-CONTRACT-03). It is
a **hint, not a verdict** (REQ-CONTRACT-04) — booleans plus a raw activity age, so
the agent applies its own "persists across N polls" threshold rather than core
baking an escalation decision in. An enum verdict (`healthy|stalling|idle`) was
**rejected** for this reason (tech-spec §3.1, Alternatives Considered).

```ts
// packages/core/src/schemas.ts

/**
 * Health/stall hint for the live iteration, surfaced on `DerivedStatus` so an
 * agent can decide done / needs-human / recoverable-stall / healthy from a
 * single `status --json` poll without reading any raw state file
 * (REQ-CONTRACT-03, REQ-SUCCESS-01).
 *
 * Every field is a *surfacing* of `IterationStatus` — a computed value, never a
 * new source of truth (C-04). The block is `null` when no iteration is live.
 *
 * It is a decision aid, not a verdict (REQ-CONTRACT-04): booleans + a raw age,
 * so the agent owns the "persists across N polls" escalation threshold.
 */
export const HealthSchema = z.object({
  /**
   * Faithful mirror of `IterationStatus.stuckWarning` — "an iteration appears
   * to have stopped making progress." A hang warning, not a failure.
   */
  stuckWarning: z.boolean(),
  /**
   * True when `IterationStatus.updatedAt` is within `ITERATION_STATUS_FRESH_MS`
   * (60s) of the derivation clock — i.e. the iteration is actively writing.
   * Reuses the existing freshness window; no new threshold (REQ-PERF-01).
   */
  iterationFresh: z.boolean(),
  /**
   * ISO-8601 timestamp copied from `IterationStatus.lastActivityAt` — the last
   * time the iteration emitted tool/token activity.
   */
  lastActivityAt: z.string(),
  /**
   * Whole seconds between `lastActivityAt` and the derivation clock, so the
   * agent never has to diff timestamps itself. Non-negative; clamped at 0 if
   * `lastActivityAt` is in the future due to clock skew.
   */
  secondsSinceActivity: z.number().nonnegative(),
});

/** Health/stall hint for the live iteration; see {@link HealthSchema}. */
export type Health = z.infer<typeof HealthSchema>;
```

**Field provenance (all read-only from `IterationStatus`, C-04):**

| `Health` field | Source | Derivation |
|----------------|--------|------------|
| `stuckWarning` | `IterationStatus.stuckWarning` | direct copy |
| `iterationFresh` | `IterationStatus.updatedAt` | `now - updatedAt < ITERATION_STATUS_FRESH_MS` |
| `lastActivityAt` | `IterationStatus.lastActivityAt` | direct copy |
| `secondsSinceActivity` | `IterationStatus.lastActivityAt` | `max(0, floor((now - lastActivityAt) / 1000))` |

### 1.2 Nullability contract

`DerivedStatus.health` is **`Health | null`**:

- **`null`** — no live iteration (no `iteration-status.json`, or it is
  absent/unparseable). "No live iteration → no health signal to report." An
  agent's branch is unambiguous: `if (status.health?.stuckWarning) { … }`.
- **`Health` object** — an iteration is live; every field is populated.

`null` (not a partial object) cleanly encodes inapplicability (tech-spec §3.1).
Health population is **best-effort and non-fatal**: a missing/unparseable
`iteration-status.json` yields `null`, never a `deriveStatus` error (see §5 and
`02-health-status-contract.md` §Error Handling).

### 1.3 `statusSchemaVersion` marker + `STATUS_SCHEMA_VERSION`

Availability of `health` is advertised by a top-level version marker on
`DerivedStatus`, mirroring the existing `EVENTS_SCHEMA_VERSION` convention on
`PersistedEvent` (REQ-COMPAT-02). It is **additive** (REQ-CONTRACT-05): existing
consumers ignore the unknown field; new consumers detect `health` via the marker.

```ts
// packages/core/src/status.ts

/**
 * Version of the `DerivedStatus` machine-surface contract. Bumped only on a
 * breaking change to the object shape; the addition of `health` +
 * `statusSchemaVersion` is itself version "1" (the first explicitly-versioned
 * DerivedStatus). Mirrors `EVENTS_SCHEMA_VERSION` on PersistedEvent
 * (REQ-COMPAT-02). Stamped into every `deriveStatus` return value.
 */
export const STATUS_SCHEMA_VERSION = "1" as const;
```

The schema pins the literal so consumers can rely on it:

```ts
// in DerivedStatusSchema (schemas.ts) — see §1.4
statusSchemaVersion: z.literal("1"),
```

### 1.4 Amended `DerivedStatusSchema`

Two additive fields; **every existing field is unchanged** (REQ-CONTRACT-05,
REQ-SUCCESS-05). Current shape confirmed at `packages/core/src/schemas.ts:279`.

```ts
// packages/core/src/schemas.ts  (amended)
export const DerivedStatusSchema = z.object({
  statusSchemaVersion: z.literal("1"), // NEW — additive; REQ-COMPAT-02
  loopState: LoopStateEnumSchema,
  stateSource: z.enum(["state.json", "log-parsing", "none"]),
  iteration: z.number().int().nullable(),
  maxIterations: z.number().int().nullable(),
  currentItem: z.string().nullable(),
  lastSignal: z.string().nullable(),
  startedAt: z.string().nullable(),
  elapsed: z.number().nullable(),
  backlogSummary: BacklogSummarySchema,
  lock: LockSummarySchema.optional(),
  sleepUntil: z.string().nullable().optional(),
  health: HealthSchema.nullable(), // NEW — additive; null when no live iteration
});

export type DerivedStatus = z.infer<typeof DerivedStatusSchema>;
```

> **Placement note for implementers:** `statusSchemaVersion` is written first for
> readability, but Zod object key order does not affect validation and JSON key
> order is not part of the contract. What matters: the two new keys are *added*,
> none removed/renamed.

### 1.5 `BacklogSummarySchema` and `IterationStatusSchema` — unchanged

Both are **read-only** to this feature; **no schema change**.

- **`BacklogSummarySchema`** (`schemas.ts:249`) — the disjointness invariant is
  preserved as-is (REQ-CONTRACT-06): `blocked` is the **total**; `needsHuman` and
  `deferred` are **disjoint, separately-actionable subsets**. The decision tree in
  `05-supervision-recipe.md` reads `needsHuman` off this untouched shape.
- **`IterationStatusSchema`** (`schemas.ts:710`) — the source of truth for
  `health` (C-04). Fields consumed: `stuckWarning`, `lastActivityAt`, `updatedAt`.
  No field added or changed.

---

## 2. Event-altitude classification — `EventAltitude`

The item-level `follow` feed is driven by a pure classifier that maps each
`LoopEvent` type to one of two altitudes (REQ-CMD-02). The return type is a
two-member string union — no new event type, no schema change (PRD §7).

```ts
// packages/core/src/events-log.ts

/**
 * Rendering altitude of a persisted loop event (REQ-CMD-02):
 *  - "item"     — item/loop lifecycle milestone; shown in the default TTY feed.
 *  - "firehose" — high-frequency token/tool telemetry; shown only under
 *                 `follow --verbose`.
 *
 * This is a *presentation* classification consumed only by the TTY renderer.
 * It NEVER touches `--json` output — the altitude filter is invisible to any
 * machine surface (REQ-CMD-03, REQ-COMPAT-01, the prime directive).
 */
export type EventAltitude = "item" | "firehose";
```

The full 24-type classification table and the exhaustiveness (`never`) guard are
specified in `04-event-altitude-follow.md` §2. The classifier signature is:

```ts
export function eventAltitude(ev: PersistedEvent): EventAltitude;
```

`PersistedEvent` / `LoopEvent` (the 24-variant union at `schemas.ts:591`) are
**existing** types — referenced, not redefined here.

---

## 3. Constants

| Constant | Value | Home | Status | Purpose |
|----------|-------|------|--------|---------|
| `STATUS_SCHEMA_VERSION` | `"1"` | `status.ts` (new export) | **new** | Advertise `health` availability (REQ-COMPAT-02) |
| `ITERATION_STATUS_FRESH_MS` | `60_000` | `status.ts:36` | **reused** | Freshness window for `iterationFresh` — no new threshold (REQ-PERF-01) |
| `EVENTS_SCHEMA_VERSION` | `"1"` | `schemas.ts` | **reference** | The convention `STATUS_SCHEMA_VERSION` mirrors |

The prescribed poll interval (default **5s**, band **5–10s**) and the
persist-then-escalate threshold (default **N=3** consecutive polls) are
**documented prescriptions in the `drive-rauf-loop` skill**, not code constants
(REQ-PRESCRIBE-03, Q4). They are specified in `05-supervision-recipe.md`, not
here — they never become `core` constants (tech-spec §3.6).

---

## 4. Target-resolution contract types

The safety-critical wrong-root guard (REQ-SCOPE-01, REQ-SAFE-02) is centralized
in one exported resolver. Its input/output/error types are defined here; the
resolver's behavior and file home are specified in `03-target-resolution.md`.

### 4.1 `ResolveTargetOptions`

```ts
// packages/core/src/backlog-root.ts  (co-located — see 03-target-resolution.md §1)

/**
 * Inputs to `resolveTarget`. The CLI computes `isMachineContext`/`isTTY` from
 * the global flags + `process.stdout.isTTY` and passes them in, so `core` stays
 * free of any `process`/TTY probing of its own (keeps it pure & unit-testable).
 */
export interface ResolveTargetOptions {
  /** Positional `<root>` argument, if the user gave one. */
  pathArg?: string;
  /** `--backlog <dir>` flag, if given. */
  backlogFlag?: string;
  /**
   * True when output is machine-bound: `--json` OR a non-TTY stdout (D5).
   * When true, a missing/ambiguous target is a HARD ERROR (REQ-SCOPE-01),
   * never an implicit scan.
   */
  isMachineContext: boolean;
  /** True when stdout is an interactive TTY (drives cwd-default + pick list). */
  isTTY: boolean;
}
```

### 4.2 `ResolvedTarget`

```ts
/**
 * Outcome of a *successful* resolution. Two shapes:
 *  - "resolved"  — a concrete (root, backlogDir) the caller acts on.
 *  - "ambiguous" — several active roots on a TTY; the CLI renders `candidates`
 *                  as an interactive pick list. NEVER returned in machine
 *                  context — there, ambiguity is a `TargetError` (§4.3).
 */
export type ResolvedTarget =
  | {
      kind: "resolved";
      /** Absolute, sandbox-validated project root. */
      root: string;
      /** Absolute, sandbox-validated backlog/state directory under `root`. */
      backlogDir: string;
    }
  | {
      kind: "ambiguous";
      /** Live loops to disambiguate between; from `listActiveLoops()`. */
      candidates: ActiveLoopEntry[];
    };
```

`ActiveLoopEntry` is the **existing** type at `schemas.ts:757`
(`ActiveLoopEntrySchema` at `:656`) — referenced, not redefined.

### 4.3 `TargetError`

```ts
/** Reason a target could not be resolved to a single concrete root. */
export type TargetErrorCode =
  | "missing_target"   // machine context, no path given (REQ-SCOPE-01)
  | "ambiguous_target" // machine context, several active roots — hard fail
  | "not_found"        // named/derived root does not exist
  | "outside_sandbox"; // containment failure (REQ-SAFE-01)

/**
 * Structured resolution failure. Follows the project convention: returned in a
 * `Result`, never thrown for an expected condition. The CLI maps every variant
 * to exit `USAGE(2)` and renders it as `outputJson({ error })` under `--json`
 * or a stderr message otherwise (03-target-resolution.md §4).
 */
export interface TargetError {
  /** Machine-stable discriminant. */
  code: TargetErrorCode;
  /** Human-readable, single-line explanation. */
  message: string;
  /** The path/flag that triggered the failure, when applicable. */
  offending?: string;
}
```

### 4.4 Resolver signature

```ts
export function resolveTarget(
  opts: ResolveTargetOptions,
): Result<ResolvedTarget, TargetError>;
```

`Result<T, E>` is the **existing** core result type (project convention: core
returns `Result`, never throws for expected errors). Behavior in
`03-target-resolution.md`.

---

## 5. Error model summary

This feature adds **no new thrown exception**. All failures are `Result` values
or benign `null`s, per project convention:

| Failure | Encoding | Fatal? |
|---------|----------|--------|
| `iteration-status.json` absent/unparseable | `health = null` | No — normal state (§1.2) |
| Unknown runtime event type in `eventAltitude` | defaults to `"firehose"` (visible under `--verbose`) | No — never silently dropped (tech-spec §7) |
| Missing target in machine context | `err({ code: "missing_target", … })` | Yes — hard fail (REQ-SCOPE-01) |
| Ambiguous target in machine context | `err({ code: "ambiguous_target", … })` | Yes — hard fail (REQ-SAFE-02) |
| Target outside sandbox | `err({ code: "outside_sandbox", … })` | Yes (REQ-SAFE-01) |
| Target root not found | `err({ code: "not_found", … })` | Yes |

---

## Dependencies

- **First document — depends on no other spec doc.**
- Consumes **existing** core types/constants (unchanged): `PersistedEvent` /
  `LoopEvent` (`schemas.ts:591`), `IterationStatusSchema` (`:710`),
  `BacklogSummarySchema` (`:249`), `LockSummarySchema`, `ActiveLoopEntry`
  (`:757`), `Result<T, E>`, `ITERATION_STATUS_FRESH_MS` (`status.ts:36`).

## Verification

- [ ] `HealthSchema` parses a fixture with `stuckWarning` both `true`/`false`.
- [ ] `DerivedStatusSchema` accepts an object with `statusSchemaVersion: "1"` +
      `health: null` **and** with a populated `health`; rejects
      `statusSchemaVersion` other than `"1"`.
- [ ] An **existing-shape** consumer parse (no `health`/`statusSchemaVersion`
      awareness) still succeeds against the enriched object (additive proof —
      REQ-CONTRACT-05).
- [ ] `EventAltitude` is a two-member union; `eventAltitude` return type assigns
      to it.
- [ ] `resolveTarget` return type is `Result<ResolvedTarget, TargetError>`; all
      four `TargetErrorCode` variants are reachable (`03` tests).
- [ ] `BacklogSummarySchema` and `IterationStatusSchema` are byte-for-byte
      unchanged in this feature's diff.
