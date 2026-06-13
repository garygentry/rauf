# 00 — Core Definitions (ux-overhaul-grammar)

Shared types, enums, and machine-contract definitions every other document in this suite builds on.
This is the single source for the **unified exit-code contract**, the **`signal_parsed` enum change**, the
**terminal-outcome → exit-code mapping**, the **events.ndjson versioning discipline**, and the
**removed-command remediation table**. Later docs reference these by name; they do not redefine them.

All locations were verified against source during forge-2-tech research (see `tech-spec.md` §6). Re-confirm
line numbers at implementation time (they drift).

## Requirement Coverage

| REQ | Covered by (section) |
|-----|----------------------|
| REQ-EXIT-01 | §1 ExitCode contract, §2 mappings |
| REQ-EXIT-02 | §1 (collision removed), §2 |
| REQ-EXIT-03 | §1 (`backlog validate` carve-out) |
| REQ-EXIT-04 | §1 (documented machine contract) |
| REQ-SIG-01 | §3 SignalParsedSchema enum |
| REQ-EVT-01 | §4 events versioning discipline |
| REQ-EVT-02 | §4 (shared LoopEventSchema) |
| REQ-RMV-01 | §5 remediation table |
| REQ-CONTRACT-02 | §6 version constant |

## 1. Unified `ExitCode` contract (REQ-EXIT-01/02/03/04)

The single exit-code enum, used by **both** `status` (current state) and `loop run` (terminal state).
Redefined in place at `packages/cli/src/commands.ts` (currently lines ~90-101). This is a **machine
contract** consumed by feature-forge; values are normative.

```ts
/**
 * Unified process exit codes (v0.5.0). Used by `status` (current loop state) and
 * `loop run` (terminal outcome). A MACHINE CONTRACT — downstream tools (feature-forge)
 * depend on these values. `backlog validate` keeps its own 0/1/2 triad (see below).
 */
export const ExitCode = {
  SUCCESS: 0,      // clean terminal: idle / complete
  ERROR: 1,        // generic failure
  USAGE: 2,        // bad args / IO / failed precondition (incl. loop-already-running 409)
  NEEDS_HUMAN: 3,  // PAUSED_HUMAN
  LIMIT: 4,        // limit reached / usage-paused / sleeping
  BLOCKED: 5,      // terminal with blocked items
  RUNNING: 6,      // running — QUERY-TIME ONLY (`status`); never a `loop run` terminal code
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
```

### Old → new remap (call-site audit, REQ-EXIT-02)

The current enum is `SUCCESS:0, ERROR:1, INVALID_ARGS:2, NOT_FOUND:3, VALIDATION:4, CONFLICT:5,
PAUSED_HUMAN:6`. The redefinition changes the **meaning** of values 3/4/5/6, so every call site of the
removed/renamed members must be re-pointed:

| Old member (value) | Old use sites map to → |
|--------------------|------------------------|
| `INVALID_ARGS` (2) | `USAGE` (2) — same value, rename only |
| `NOT_FOUND` (3) | `USAGE` (2) — "no loop to stop", missing project = failed precondition |
| `VALIDATION` (4) | `USAGE` (2) — bad input |
| `CONFLICT` (5) | `USAGE` (2) — loop-already-running 409 (**resolved decision 2026-06-13**) |
| `PAUSED_HUMAN` (6) | `NEEDS_HUMAN` (3) |

> **Audit method:** grep `packages/*/src` for `ExitCode.INVALID_ARGS`, `.NOT_FOUND`, `.VALIDATION`,
> `.CONFLICT`, `.PAUSED_HUMAN` and re-point each. After the change, no code references the old member
> names (they cease to exist). Tests assert the new values.

### `backlog validate` carve-out (REQ-EXIT-03)

`backlog validate` keeps its existing, coherent codes **unchanged**: `0` valid / `1` findings / `2` usage.
It does NOT adopt the unified scheme.

## 2. Terminal-outcome / state → exit-code mappings (REQ-EXIT-01)

### 2a. `loop run` terminal outcome → exit code

Replaces the single ternary at `packages/cli/src/loop-commands.ts:~979-983`. Maps over `LoopResult`
(`packages/loop/src/runner.ts:~62-72`):

```ts
interface LoopResult {        // existing shape — do NOT change
  completedCount: number;
  blockedCount: number;
  needsHumanCount?: number;
  cancelled: boolean;
  gracefulStop?: boolean;
  reviewItemsCreated?: number;
  reviewSummary?: string;
  pausedReason?: "needs_human";
}
```

| Terminal condition (checked in this order) | Exit code |
|--------------------------------------------|-----------|
| run failed / errored (non-Result error path) | `ERROR` (1) |
| `pausedReason === "needs_human"` OR `needsHumanCount > 0` | `NEEDS_HUMAN` (3) |
| limit-reached / usage-paused / sleeping terminal | `LIMIT` (4) |
| `blockedCount > 0` (terminal with blocked items) | `BLOCKED` (5) |
| otherwise (clean: completed / idle / cancelled-graceful) | `SUCCESS` (0) |

`RUNNING` (6) is **never** a `loop run` terminal code (a finished run is not running).

### 2b. `status` current state → exit code

Rewrites `statusExitCode(state)` at `packages/cli/src/status-commands.ts:~492-504`, over `LoopStateEnum`
(`packages/core/src/schemas.ts:~228-239`: `IDLE, RUNNING, PAUSED, COMPLETE, PAUSED_HUMAN, LIMIT_REACHED,
ERROR, NOT_INSTALLED, SLEEPING_LIMIT, WEEKLY_LIMIT`):

| `LoopStateEnum` | Exit code |
|-----------------|-----------|
| `RUNNING` | `RUNNING` (6) |
| `PAUSED_HUMAN` | `NEEDS_HUMAN` (3) |
| `LIMIT_REACHED` / `SLEEPING_LIMIT` / `WEEKLY_LIMIT` | `LIMIT` (4) |
| terminal-with-blocked-items (derived) | `BLOCKED` (5) |
| `ERROR` | `ERROR` (1) |
| `IDLE` / `COMPLETE` / `PAUSED` / `NOT_INSTALLED` | `SUCCESS` (0) |

## 3. `signal_parsed` event enum (REQ-SIG-01)

Add `"review"` to the `signal` enum of `SignalParsedSchema` at `packages/core/src/schemas.ts:~466`:

```ts
// BEFORE: signal: z.enum(["done", "blocked", "needs_human", "none"])
const SignalParsedSchema = LoopEventBaseSchema.extend({
  type: z.literal("signal_parsed"),
  itemId: z.string(),
  signal: z.enum(["done", "blocked", "needs_human", "review", "none"]), // +"review"
  reason: z.string().optional(),
});
```

This aligns the on-wire event enum with the already-existing internal `SignalType`
(`packages/loop/src/signal-parser.ts:~4` = `"done" | "blocked" | "needs_human" | "review" | "none"`). The
runner's `review→done` downcast at `packages/loop/src/runner.ts:~655-656` is **removed** so `signal_parsed`
reports `"review"` truthfully (see `04-signals-and-events.md`). `state.json.lastSignal`
(`LoopStateSignalSchema`, `schemas.ts:~183` = `clean|blocked|needs_human|error`) is a **separate
vocabulary** and is NOT changed.

## 4. events.ndjson versioning discipline (REQ-EVT-01/02)

`events.ndjson` is a **stable, versioned, additive-only-within-a-major** machine surface. No code change to
the version this release — `EVENTS_SCHEMA_VERSION = "1"` (`packages/core/src/schemas.ts:~663`, stamped at
`runner.ts:~1213`) stays `"1"`; this is the *first formal* version, not a breaking change. The discipline
(documented in `docs/SCHEMAS.md` + `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`):

1. Within a major version: no `type` discriminator value renamed or removed; no documented field removed.
2. Adding a new event `type` or a new optional field is **additive** (no version bump).
3. Readers MUST ignore unknown `type`s and unknown fields.
4. `EVENTS_SCHEMA_VERSION` is bumped ONLY on a breaking change (a removed/renamed type or field).
5. The persisted log and the live `--ndjson` stream carry the **same `LoopEvent` shapes** (REQ-EVT-02):
   `PersistedEventSchema` (`schemas.ts:~614-629`) = `LoopEventSchema` (`schemas.ts:~574-599`, 24-member
   discriminated union) ∩ `{ seq, schemaVersion }`. The stream emits raw `LoopEvent`; the file adds the
   `seq`+`schemaVersion` envelope. Adding `"review"` to `signal_parsed` (§3) is an additive change — no bump.

## 5. Removed-command remediation table (REQ-RMV-01)

Invoking a removed verb/flag exits non-zero (`USAGE` = 2) with a targeted message naming the replacement,
**executing nothing** (not an alias). A lookup table maps removed token → guidance:

| Removed token | Remediation message |
|---------------|---------------------|
| `loop start` | `` `loop start` was removed in v0.5.0 — use `loop run --detached` (`-d`). `` |
| `--watch` (on any command) | `` `--watch` was removed in v0.5.0 — use `--follow` (`-f`). `` |

The interceptor runs **before** the generic unknown-subcommand / unknown-flag error so the targeted message
wins. Implementation locus: `packages/cli/src/commands.ts` dispatch + the flag-parsing path
(`packages/cli/src/parser.ts`). See `02-execution-grammar.md`.

## 6. Version constant (REQ-CONTRACT-02)

At the v0.5.0 flip, the rauf version is bumped to **`0.5.0`** so `rauf version --json` reports
`{ "version": "0.5.0" }` (or higher), letting feature-forge's `minRunnerVersion` gate require the whole new
contract in one check. The authoritative version source that `rauf version --json` reads is
`packages/core/src/version.ts:~4` (currently `0.4.0`) — bump that (and keep the package.json versions in
sync). See `05-cutover-and-feature-forge.md`.

## Dependencies

None — this is the foundation document. All other docs in this suite depend on it.

## Verification

- `ExitCode` const matches §1 exactly; no references to `INVALID_ARGS`/`NOT_FOUND`/`VALIDATION`/`CONFLICT`/
  `PAUSED_HUMAN` remain in `packages/*/src`.
- `SignalParsedSchema.signal` includes `"review"`; `backlog validate` codes unchanged.
- `EVENTS_SCHEMA_VERSION === "1"` (unchanged); the versioning discipline is documented in the two spec docs.
