# 04 — Event Altitude & Item-Level `follow`

> **Phase 3 — "Make it humane."** This document specifies the pure
> `eventAltitude()` classifier in `core` and the human-render changes to the
> `follow` command in `cli`: an item-level default feed, a sticky progress
> header, and A11Y-safe degradation. It builds on
> [`00-core-definitions.md`](./00-core-definitions.md) (the `EventAltitude` type,
> the `eventAltitude` signature) and
> [`01-architecture-layout.md`](./01-architecture-layout.md) (integration rows
> 6, 7, 8, 12, 14). It changes **only** the TTY render path — no machine surface
> (`--json`, `--ndjson`) is altered (REQ-COMPAT-01, the prime directive). Traces
> to [`tech-spec.md`](./tech-spec.md) §3.3, §3.4, §7, §8 (Phase 3) and
> [`PRD.md`](./PRD.md) §3.3 (REQ-CMD-01…05), §4.4 (REQ-A11Y-01).

---

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CMD-01 | `status --follow` stays the re-rendered snapshot glance (naming) | 5 |
| REQ-CMD-02 | `follow` default → item-level feed + sticky header; firehose → `--verbose` | 2, 3, 4 |
| REQ-SUCCESS-06 | A human running `follow` no longer wades through token/tool events to see the current item (render half) | 3, 4 |
| REQ-CMD-03 | `follow --json` emits every event; altitude filter never touches JSON | 2.4, 3.1, 3.3 |
| REQ-CMD-05 | Item feed reuses existing renderer/scan (`readEvents`/`watchEvents`/`deriveStatus`/`formatEvent`) — no new data model | 3, 4 |
| REQ-A11Y-01 | Header degrades on non-TTY/no-color/narrow; state by text label, never color alone | 4.3 |
| REQ-COMPAT-01 | Human-render work never alters a machine surface | 2.4, 3.3 |
| REQ-COMPAT-01 / C-01 | Classifier is pure, lives in `core`, zero `cli`/`web` import; a web-parity seam | 2.2 |
| C-03 | No new verb; only the `follow` default changes within the fixed grammar | 5 |

---

## 1. Purpose & Scope

**In scope (Phase 3):**

1. `eventAltitude(ev: PersistedEvent): EventAltitude` — a pure, I/O-free function
   in `packages/core/src/events-log.ts` that classifies all **24** `LoopEvent`
   types into `"item"` or `"firehose"`, with a compile-time exhaustiveness
   (`never`) guard and a runtime `"firehose"` default (never silently dropped).
2. The three `follow` render paths (`handleFollow`, `follow-command.ts:52`):
   **default** (TTY, no flags) → item-level feed + sticky header; **`--verbose`**
   → full firehose (current behavior); **`--json`** → unchanged, every
   `PersistedEvent`.
3. The sticky progress-header renderer, added alongside `formatEvent` in
   `packages/cli/src/event-format.ts`.
4. A11Y-safe header degradation via the existing `detectColorSupport()`.

**Out of scope (owned elsewhere):**

- The `EventAltitude` type and the `eventAltitude` signature — **defined in**
  `00-core-definitions.md` §2; this doc supplies the classification body only.
- `resolveTarget()` and the `[root]`-optional / `--all` resolution ergonomics —
  owned by `03-target-resolution.md`. This doc assumes `handleFollow` obtains
  `BacklogPaths` as it does today (`resolveBacklogRoot` → `resolveBacklogPaths`,
  `follow-command.ts:66–71`) or via `resolveTarget()` once `03` lands; the
  altitude/header logic is independent of how paths are resolved.
- The `health` block and `DerivedStatus` versioning — owned by
  `02-health-status-contract.md`.
- All unit/integration test detail — enumerated in `06-testing-strategy.md`; §6
  here lists only the acceptance checklist.

---

## 2. Public API

Two exports are consumed by `cli`: `eventAltitude` (from `core`) and the new
sticky-header renderer (in `cli`). The `EventAltitude` type is **already defined**
in `00-core-definitions.md` §2 — referenced here, not redefined.

### 2.1 `eventAltitude` — signature (defined in `00`, body here)

```ts
// packages/core/src/events-log.ts
import type { PersistedEvent } from "./schemas.js";
// EventAltitude is declared in this same module — see 00-core-definitions.md §2:
//   export type EventAltitude = "item" | "firehose";

/**
 * Classify a persisted loop event by *rendering altitude* (REQ-CMD-02):
 *
 *  - "item"     — an item/loop lifecycle milestone a human supervisor wants in
 *                 the default `follow` feed (start/select/complete/block/retry,
 *                 needs-human, review-*, usage-limit-*, sleep-*, stuck-warning,
 *                 and the terminal loop events).
 *  - "firehose" — high-frequency per-iteration telemetry (spawn/exit, tool and
 *                 token activity) shown only under `follow --verbose`.
 *
 * PURE and I/O-FREE: no filesystem, no rendering, no `cli`/`web` import — which
 * is why it lives in `core` (C-01) and gives the deferred web-parity feature
 * (PRD Q2) the same classification seam. It is a *presentation* classification
 * applied ONLY on the TTY render path; it NEVER touches `--json`/`--ndjson`
 * output (REQ-CMD-03, REQ-COMPAT-01 — the prime directive).
 *
 * Never throws. Exhaustive over the 24-variant LoopEvent union with a
 * compile-time `never` guard (§2.3); any unrecognized runtime `type` defaults
 * to "firehose" so it stays visible under `--verbose`, never silently dropped
 * (tech-spec §7).
 *
 * @param ev - A full PersistedEvent (LoopEvent payload + seq + schemaVersion).
 * @returns "item" or "firehose".
 */
export function eventAltitude(ev: PersistedEvent): EventAltitude;
```

`PersistedEvent` / `LoopEvent` (the 24-variant discriminated union at
`packages/core/src/schemas.ts:591`, wrapped by `PersistedEventSchema` at `:631`)
are **existing** types — imported, not redefined.

### 2.2 Why `core`, not `cli`

Per `01-architecture-layout.md` §3 and tech-spec §3.3: the classifier is a pure
function with no I/O and no `cli`/`web` import, so placing it in `core` does not
violate C-01 or REQ-COMPAT-01. It is unit-testable in isolation (full branch
coverage, no fixtures), and a future web observation-parity feature (PRD Q2)
reuses the **identical** classification seam rather than re-deriving it — cheap
insurance for the deferred phase.

### 2.3 Exhaustiveness guard (compile-time) + runtime default

The classifier must fail **typecheck** if a 25th `LoopEvent` type is ever added
without being classified, yet never throw at runtime. Both are achieved with a
`switch` over `ev.type` whose `default` branch narrows to `never`:

```ts
export function eventAltitude(ev: PersistedEvent): EventAltitude {
  switch (ev.type) {
    // ── firehose (high-frequency telemetry) ──
    case "iteration_start":
    case "llm_spawned":
    case "llm_exited":
    case "llm_tool_activity":
    case "llm_token_update":
      return "firehose";

    // ── item (item/loop lifecycle milestones) ──
    case "loop_started":
    case "item_selected":
    case "signal_parsed":
    case "item_completed":
    case "item_blocked":
    case "item_retried":
    case "needs_human":
    case "loop_paused":
    case "usage_limit_hit":
    case "usage_limit_cleared":
    case "sleep_start":
    case "sleep_end":
    case "loop_completed":
    case "loop_error":
    case "loop_cancelled":
    case "review_started":
    case "review_completed":
    case "review_failed":
    case "llm_stuck_warning":
      return "item";

    default: {
      // Compile-time exhaustiveness: if a new LoopEvent type is added without a
      // case above, `ev` is NOT narrowed to `never` here and this assignment
      // fails typecheck (REQ-CMD-02; mirrors formatEvent's guard, event-format.ts:141).
      const _exhaustive: never = ev;
      void _exhaustive;
      // Runtime safety: an unrecognized type is still visible under --verbose,
      // never silently dropped (tech-spec §7, 00-core-definitions.md §5).
      return "firehose";
    }
  }
}
```

> **Note on the `never` assignment + runtime fallthrough:** the `const
> _exhaustive: never = ev;` line is the compile-time check; the `return
> "firehose";` after it is the runtime safety net for a record whose `type` is
> outside the compiled union (e.g. a newer producer writing an unknown type into
> `events.ndjson`). Both are required — do not remove the trailing `return`
> merely because the union is currently exhaustive.

### 2.4 `--json` is never classified

`eventAltitude` is called **only** on the human (TTY) render branch of
`follow` (§3.2). The `--json` branch writes the raw `PersistedEvent` and never
calls the classifier (REQ-CMD-03, REQ-COMPAT-01). This is a structural
guarantee, not a runtime check — the call site simply does not exist on the JSON
path (§3.1).

---

## 3. The 24-type classification table

**Source of truth: `packages/core/src/schemas.ts`** — the discriminated union
`LoopEventSchema` at `:591` lists exactly 24 member schemas. Each `type` literal
below was read from its schema (line cited). This table **matches** tech-spec
§3.3 exactly (19 `item` + 5 `firehose` = 24) — no discrepancy found.

| # | Event `type` | Schema line | Altitude | Rationale |
|---|--------------|-------------|----------|-----------|
| 1 | `loop_started` | schemas.ts:444 | **item** | Run boundary — supervisor wants the start marker |
| 2 | `iteration_start` | schemas.ts:450 | **firehose** | Per-iteration bookkeeping; noise at item altitude |
| 3 | `item_selected` | schemas.ts:456 | **item** | Core narration: "picked auth-007" |
| 4 | `llm_spawned` | schemas.ts:463 | **firehose** | Subprocess telemetry |
| 5 | `llm_exited` | schemas.ts:471 | **firehose** | Subprocess telemetry |
| 6 | `signal_parsed` | schemas.ts:480 | **item** | The done/blocked/needs_human/review decision |
| 7 | `item_completed` | schemas.ts:487 | **item** | Core narration: "done" |
| 8 | `item_blocked` | schemas.ts:493 | **item** | Core narration: "blocked" |
| 9 | `item_retried` | schemas.ts:499 | **item** | Core narration: retry |
| 10 | `needs_human` | schemas.ts:506 | **item** | The one true stop — must surface |
| 11 | `loop_paused` | schemas.ts:512 | **item** | Run paused for human — how the run ends |
| 12 | `usage_limit_hit` | schemas.ts:518 | **item** | Why the run stalled — supervisor-relevant |
| 13 | `usage_limit_cleared` | schemas.ts:524 | **item** | Run resumed after limit |
| 14 | `sleep_start` | schemas.ts:529 | **item** | Why the run is idle (backoff/sleep) |
| 15 | `sleep_end` | schemas.ts:535 | **item** | Run woke from sleep |
| 16 | `loop_completed` | schemas.ts:539 | **item** | Terminal — how the run ends |
| 17 | `loop_error` | schemas.ts:546 | **item** | Terminal — how the run ends |
| 18 | `loop_cancelled` | schemas.ts:551 | **item** | Terminal — how the run ends |
| 19 | `review_started` | schemas.ts:555 | **item** | Review milestone |
| 20 | `review_completed` | schemas.ts:560 | **item** | Review milestone (review-created-N) |
| 21 | `review_failed` | schemas.ts:566 | **item** | Review milestone |
| 22 | `llm_tool_activity` | schemas.ts:571 | **firehose** | Per-tool telemetry — the firehose |
| 23 | `llm_token_update` | schemas.ts:578 | **firehose** | Per-token telemetry — the firehose |
| 24 | `llm_stuck_warning` | schemas.ts:585 | **item** | Stall hint — supervisor wants it in the feed |

**Firehose set (5):** `iteration_start`, `llm_spawned`, `llm_exited`,
`llm_tool_activity`, `llm_token_update`. **Item set (19):** all others.

> **Rationale for the broad "item" set (tech-spec §3.3):** a supervisor needs
> `loop_completed`, `needs_human`, `review_*`, `usage_limit_*`, `sleep_*`, and
> `llm_stuck_warning` to understand *how a run ends or stalls*, not just item
> transitions. This aligns with the PRD `follow` examples (§3.3 REQ-CMD-02) and
> feature-forge's existing milestone filter, so the two converge rather than
> diverge.

> **Verification against source:** the 24 `type` literals above were read from
> `schemas.ts`. If a future edit adds a 25th member to `LoopEventSchema`
> (`:591`), `eventAltitude`'s `never` guard (§2.3) fails typecheck until the new
> type is classified here. **No discrepancy** between this table, tech-spec §3.3,
> and `schemas.ts` was found at authoring time.

---

## 4. Internal implementation — `follow` render paths

`handleFollow` (`follow-command.ts:52`) → `followEvents` (`:81`) change only the
**human render path**. The replay-then-tail engine (`readEvents` at
`events-log.ts:86`, `watchEvents` at `:174`) and the terminal-detection poll
(`deriveStatus`, `follow-command.ts:130`) are **reused unchanged** (REQ-CMD-05).

### 4.1 Flag surface

`follow` gains one flag; JSON is unchanged.

| Mode | Trigger | Events emitted | Header |
|------|---------|----------------|--------|
| **Default** | TTY, no `--verbose`, no `--json` | only `eventAltitude(ev) === "item"` | sticky progress header |
| **Verbose** | `--verbose` | **every** event via `formatEvent` (today's behavior) | none (or optional; default no header) |
| **JSON** | `--json` | **every** `PersistedEvent` as NDJSON (unchanged) | none |

`--verbose` is parsed with the existing boolean-flag helper (as `--json` and
`--interval` are parsed today, `follow-command.ts:61–63`). Suggested parse:

```ts
const verbose = ctx.flags["verbose"] === true; // boolean global/subcommand flag
```

Precedence: `--json` wins (machine surface is inviolate — if both `--json` and
`--verbose` are given, output stays raw NDJSON of **every** event; `--verbose`
is a human-render flag and has no effect under `--json`).

### 4.2 Render decision in `emitEvent`

The single change to event emission is to gate the human branch by altitude when
not verbose. `emitEvent` (`follow-command.ts:43`) becomes altitude-aware:

```ts
import { eventAltitude } from "@rauf/core";
import { formatEvent } from "./event-format.js";

/**
 * Render one PersistedEvent according to the active mode.
 *  - json:    raw NDJSON line — EVERY event, never classified (REQ-CMD-03).
 *  - verbose: formatted line   — EVERY event (today's behavior).
 *  - default: formatted line   — ONLY item-altitude events (REQ-CMD-02).
 */
function emitEvent(ev: PersistedEvent, opts: { json: boolean; verbose: boolean }): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(ev) + "\n"); // untouched machine surface
    return;
  }
  if (!opts.verbose && eventAltitude(ev) !== "item") return; // altitude filter
  print(formatEvent(ev));
}
```

- The `--json` branch is **first** and returns before any classification call —
  structurally guaranteeing the altitude filter never touches JSON (§2.4).
- `opts` threads `verbose` alongside the existing `json`/`intervalSeconds` into
  `followEvents` (`:81`) so both the replay loop (`:89`) and the tail callback
  (`:118`) apply the same gate.

### 4.3 Sticky progress header

The header re-renders on each **item** milestone and on each terminal-detection
poll tick, sourced entirely from a `deriveStatus` poll — the **same** poll
`follow` already runs at `intervalSeconds` (`follow-command.ts:130`). **No new
scan, no new data model** (REQ-CMD-05).

**Header shape (default TTY, color-capable):**

```
4/12 done · 1 blocked · on auth-007
```

**Data flow:**

| Header token | Source field on `DerivedStatus` |
|--------------|--------------------------------|
| `4/12 done` | `backlogSummary.done` / `backlogSummary.total` |
| `1 blocked` | `backlogSummary.blocked` (omitted when `0`) |
| `on auth-007` | `currentItem` (omitted when `null`) |

> `backlogSummary` is the **existing** `BacklogSummarySchema` shape
> (`00-core-definitions.md` §1.5) — read-only, unchanged. Field names
> (`done`/`total`/`blocked`) must be confirmed against `BacklogSummarySchema`
> (`schemas.ts:249`) at implementation time; if a name differs, use the actual
> field and note it — do **not** invent a field.

The header renderer is a **new pure function** added alongside `formatEvent` in
`packages/cli/src/event-format.ts` (per `01-architecture-layout.md` §4, row for
`event-format.ts`):

```ts
// packages/cli/src/event-format.ts
import type { DerivedStatus } from "@rauf/core";
import { c } from "./formatter.js";

/**
 * Render the sticky progress header for the item-level `follow` feed
 * (REQ-CMD-02). Sourced from a DerivedStatus poll — no new scan (REQ-CMD-05).
 *
 * Shape (color-capable TTY): `4/12 done · 1 blocked · on auth-007`.
 * The `blocked` segment is omitted when 0; the `on <item>` segment is omitted
 * when `currentItem` is null. State is conveyed by a leading TEXT LABEL, never
 * by color alone (REQ-A11Y-01) — see §4.4 for the degradation contract.
 *
 * @param status - The current DerivedStatus from the follow poll.
 * @param opts.color - Whether ANSI color is enabled (from detectColorSupport()).
 * @returns A single-line header string (no trailing newline).
 */
export function formatFollowHeader(
  status: DerivedStatus,
  opts: { color: boolean },
): string;
```

**Composition:**

```ts
export function formatFollowHeader(
  status: DerivedStatus,
  opts: { color: boolean },
): string {
  const s = status.backlogSummary;
  const parts: string[] = [`${s.done}/${s.total} done`];
  if (s.blocked > 0) parts.push(`${s.blocked} blocked`);
  if (status.currentItem) parts.push(`on ${status.currentItem}`);

  // State LABEL — text, never color alone (REQ-A11Y-01). Derived from
  // loopState / lastSignal / backlogSummary, mirroring the same decision inputs
  // the agent uses (00-core-definitions.md §1.5).
  const label = deriveStateLabel(status); // "blocked" | "needs-human" | "healthy" | …
  const body = `${label}  ${parts.join(" · ")}`;

  // Color is decorative only: it re-emphasizes the label, never replaces it.
  if (!opts.color) return body;
  return colorizeLabel(label, body); // e.g. c.yellow for needs-human — label text still present
}
```

- `deriveStateLabel(status)` maps `status.loopState` / `status.lastSignal` /
  `status.backlogSummary.needsHuman` to a **text** label (`healthy`,
  `blocked`, `needs-human`, `paused`, `sleeping`, `complete`). The exact mapping
  reuses `getStateLabel()` where it already provides a friendly label
  (`follow-command.ts:139` already imports `getStateLabel` from `@rauf/core`);
  `deriveStateLabel` is a thin wrapper that folds in the `needsHuman`/`blocked`
  distinction the raw `loopState` lacks.
- `colorizeLabel` applies `c.yellow`/`c.green`/`c.red` from `formatter.ts`
  (`c` at `formatter.ts:59`) **only** to re-emphasize the already-present text
  label — color is never the sole carrier of state.

**Where the header is printed:** on the human (non-JSON) path, `followEvents`
prints the header (a) once after replay, and (b) on each item-milestone emit and
each poll tick where `deriveStatus` succeeds. Because a terminal writes
line-by-line (no cursor addressing is introduced), "sticky" is implemented as a
**re-printed line** — the header is reprinted so it remains visually near the
tail of the scroll. This deliberately avoids ANSI cursor manipulation, which
keeps the non-TTY/no-color path identical in structure (§4.4).

### 4.4 A11Y — degradation contract (REQ-A11Y-01)

The header MUST degrade gracefully and MUST NOT rely on color alone:

| Condition | Detection | Behavior |
|-----------|-----------|----------|
| **No color** (`NO_COLOR`, or `--no-color`) | `detectColorSupport() === false` (`formatter.ts:33`) | `formatFollowHeader(status, { color: false })` — plain text, state carried by the leading **label** (`blocked`, `needs-human`, `healthy`). No ANSI. |
| **Non-TTY stdout** (piped/redirected) | `!process.stdout.isTTY` (also flips `detectColorSupport()` to `false`, `formatter.ts:37`) | Header degrades to a **plain reprinted line**; no cursor tricks, no color. (Note: under `--json`/non-TTY the machine-context resolution in `03` may already have short-circuited — see `03-target-resolution.md`.) |
| **Narrow terminal** | `process.stdout.columns` small/undefined | Header still prints as a single line; the `on <item>` and `blocked` segments are already elided when empty. No column-dependent box-drawing is used, so a narrow width cannot corrupt layout. |

The single load-bearing rule: **state (blocked / needs-human / healthy) is
always in the text label**; color only re-emphasizes it. `detectColorSupport()`
is the sole color gate — no new detection logic is introduced (reuses row 14 of
`01-architecture-layout.md` §5).

---

## 5. Naming clarification — `follow` vs `status --follow` (REQ-CMD-01, C-03)

Two distinct surfaces exist and must not be conflated (tech-spec §3.4 naming
note):

- **`follow` command** (`handleFollow`, `follow-command.ts:52`) — the standalone
  live-view verb. **This document changes its default** to the item-level feed +
  sticky header (REQ-CMD-02).
- **`status --follow`** (`handleStatusFollow`, `status-commands.ts:439`) —
  **unchanged.** It remains the re-rendered `DerivedStatus` snapshot glance
  (REQ-CMD-01) and is owned by `03-target-resolution.md` / the status commands,
  not this doc.

**No fourth verb is added** (C-03, REQ-CMD-02). The v0.6.0 verb set is fixed;
only the `follow` default altitude changes within that grammar.

---

## Dependencies

**Depends on (must be implemented first / referenced):**

- **`00-core-definitions.md`** — for the `EventAltitude` type (§2) and the
  `eventAltitude` signature. This doc supplies only the classification body.
- **`00-core-definitions.md` §1.4/§1.5** — `DerivedStatus` shape (including
  `backlogSummary`, `currentItem`, `loopState`, `lastSignal`) that the header
  reads. The `health` field it also carries is populated by
  `02-health-status-contract.md`, but the header does not require `health`.
- **`01-architecture-layout.md`** — placement (`events-log.ts`,
  `follow-command.ts`, `event-format.ts`) and the integration map (rows 6, 7, 8,
  12, 14).

**Existing code reused unchanged (verified file:line):**

- `readEvents` (`packages/core/src/events-log.ts:86`), `watchEvents` (`:174`) —
  the replay-then-tail feed (REQ-CMD-05).
- `formatEvent(ev: PersistedEvent): string` (`packages/cli/src/event-format.ts:43`)
  — renders every event that passes the item filter.
- `deriveStatus(paths)` (`packages/core/src/status.ts:365`) — the header data
  source, already polled at `follow-command.ts:130`.
- `detectColorSupport(): boolean` (`packages/cli/src/formatter.ts:33`) and the
  `c` color helpers (`:59`) — A11Y-safe header color gating (REQ-A11Y-01).
- `getStateLabel` (imported from `@rauf/core` at `follow-command.ts:14`) — the
  friendly state label the header wrapper reuses.
- `PersistedEvent` / `LoopEventSchema` (24 types, `schemas.ts:591`).

**Not a dependency:** `resolveTarget()` (`03-target-resolution.md`) — the
altitude/header logic is independent of path resolution.

## Verification

- [ ] `eventAltitude` returns the altitude in the §3 table for **each** of the
      24 `LoopEvent` types (exhaustive table test — every type covered).
- [ ] Adding a synthetic 25th `LoopEvent` variant without a `case` in
      `eventAltitude` **fails `pnpm typecheck`** (the `never` guard, §2.3).
- [ ] An unrecognized runtime `type` (crafted record) returns `"firehose"` and
      does **not** throw (§2.3 runtime default).
- [ ] `follow --json` emits **every** `PersistedEvent` as NDJSON, byte-identical
      to today — the altitude filter is never applied (REQ-CMD-03, REQ-COMPAT-01).
- [ ] `follow --verbose` emits **every** event via `formatEvent` (today's
      behavior).
- [ ] Default `follow` (TTY, no flags) emits **only** events where
      `eventAltitude(ev) === "item"` (a `llm_token_update`/`llm_tool_activity`
      fixture is suppressed; an `item_completed` fixture appears).
- [ ] `formatFollowHeader` produces `"4/12 done · 1 blocked · on auth-007"` from
      a fixture `DerivedStatus` (`backlogSummary {done:4,total:12,blocked:1}`,
      `currentItem:"auth-007"`); the `blocked` and `on` segments are elided when
      `blocked === 0` / `currentItem === null`.
- [ ] A11Y: with `NO_COLOR` set (or `detectColorSupport() === false`), the header
      contains the state **text label** (`blocked`/`needs-human`/`healthy`) and
      **no ANSI escape sequences** (REQ-A11Y-01).
- [ ] `core` still has zero imports from `cli`/`web` after adding `eventAltitude`
      (`grep -rE "from \"\.\./(cli|web)" packages/core/src` returns nothing) —
      C-01.
- [ ] `status --follow` (`handleStatusFollow`) is unchanged in this feature's
      diff (REQ-CMD-01, C-03). No fourth verb added.
- [ ] `pnpm gate` is green at the tip of the Phase 3 branch (REQ-GATE-01).

> Full test bodies (fixtures, clock injection, spy assertions) are specified in
> `06-testing-strategy.md`; the list above is the acceptance checklist.
