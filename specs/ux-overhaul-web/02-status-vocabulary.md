# 02 — Status Vocabulary (shared label map, enum extension, color tables, exit codes)

> Domain document for `ux-overhaul-web` (Phase 4 of the UX/DX overhaul). Implements the status-vocabulary
> slice: the single shared label map (`state-labels.ts`), the derived-enum extension + raw→derived
> remap, the CLI `colorLoopState` refactor, the web shared badge, and the `statusExitCode` extension.
> Source of truth: `PRD.md` §3.2/§3.3, `tech-spec.md` §3.3/§3.5 (D3.3/D3.5), and **CANON §4.3 (status
> vocabulary — labels are normative) / §4.4 (exit codes)**. Builds on `00-core-definitions.md` (the
> enum and label-map *types*) and `01-architecture-layout.md` (module placement). All TypeScript here is
> the project's strict TS (`noUncheckedIndexedAccess`, named exports, `node:` prefix). This document
> **resolves OQ-T1** (the concrete tone→palette tables for terminal and web).

## Requirement Coverage

| Requirement | Section |
|---|---|
| REQ-VOCAB-01 (single shared label-map module) | §2 `state-labels.ts` |
| REQ-VOCAB-02 (total raw-status coverage) | §3 enum extension + `mapLoopStateStatus` |
| REQ-VOCAB-03 (add `REVIEWING`) | §2 table, §3 remap |
| REQ-VOCAB-04 (add `PAUSED_USAGE_LIMIT`) | §2 table, §3 remap |
| REQ-VOCAB-05 (Needs Human label) | §2 table |
| REQ-VOCAB-06 (human Title-Case vs machine SCREAMING_SNAKE) | §2 table, §4 (CLI), §5 (web) |
| REQ-VOCAB-07 (badges for the full enum, no silent default) | §4 (CLI total), §5 (web total) + §6 enforcement note |
| REQ-EXIT-01 (status exit codes for the two new states) | §7 `statusExitCode` |
| OQ-T1 (concrete tone→palette tables) | §4.1 (terminal), §5.2 (web CSS) |

## Dependencies

Must be implemented in this order:

1. **`00-core-definitions.md`** — defines the *types* this doc populates: the extended
   `LoopStateEnumSchema`/`LoopStateEnum` (§2), and `StateTone`/`StateLabel`/`STATE_LABELS`/
   `getStateLabel` (§3). This document supplies their **bodies**; it does not redefine the type
   surface.
2. **`01-architecture-layout.md`** — defines *where* the code lands: new `packages/core/src/
   state-labels.ts` exported from the core index (§4); the `schemas.ts`/`status.ts` edits (§4); the
   `status-commands.ts` refactor (§5); the web badge replacement (§6.4). This document supplies the
   contents of those edits.

No other domain doc (`03`–`06`) is a prerequisite. `04-web-recovery-routes.md` *consumes* the web
badge component this doc specifies but does not gate it.

## 1. Scope and invariants

This document owns the **vocabulary mechanics** end-to-end across all three surfaces:

- **Core:** the enum gains two values; one pure module (`state-labels.ts`) is the single source of
  truth for the human label + a semantic `tone` per derived state; `mapLoopStateStatus` is remapped to
  route the two raw states to their new derived values.
- **CLI:** `colorLoopState` stops hand-rolling a per-state color `switch` and instead maps the shared
  `tone` to a terminal color — total over the enum, no silent `default:`.
- **Web:** both duplicated `STATE_BADGE` tables collapse into one badge component that reads
  `STATE_LABELS` for the label and maps `tone` to a CSS palette — total over the enum, no `?? IDLE`
  fallback.
- **Exit codes:** `statusExitCode` maps the two new derived values per CANON §4.4.

Two **structural invariants** govern the whole document (tech-spec §3.3):

- **(I1) Compile-enforced totality at two sites only:** `mapLoopStateStatus` (a
  `Record<LoopState["status"], LoopStateEnum>`) and `statusExitCode` (a **default-less** `switch`).
  Adding the two enum values is a *compile error* at these sites until handled — the compiler is the
  enforcement.
- **(I2) Refactor-enforced totality at two sites:** `colorLoopState` (currently has a `default:`) and
  the web `STATE_BADGE` (currently `Record<string, …>` + `?? STATE_BADGE["IDLE"]`) are **not**
  compiler-enforced today and would silently mis-render new values. The refactors in §4 and §5
  **must** convert them to a total `Record<LoopStateEnum, …>` (or a default-less `switch`) so
  REQ-VOCAB-07's "no silent default" becomes *structurally* true. See §6 for the correctness rationale.

## 2. `packages/core/src/state-labels.ts` — the shared label map (REQ-VOCAB-01/03/04/05/06/07)

New pure core module. It carries **no color/CSS** (REQ-ARCH-01) — `tone` is a *semantic* category each
surface maps to its own palette. The types (`StateTone`, `StateLabel`, the `STATE_LABELS` declaration,
`getStateLabel`) are declared in `00-core-definitions.md` §3; this is the full body.

```ts
// @rauf/core — src/state-labels.ts  (NEW; exported from packages/core/src/index.ts)
import type { LoopStateEnum } from "./schemas.js";

/** Semantic severity category — surface-agnostic; each consumer maps it to its own palette. */
export type StateTone = "neutral" | "info" | "success" | "warning" | "danger";

/** One display entry per derived state. Carries NO color/CSS (REQ-ARCH-01). */
export interface StateLabel {
  /** Title-Case human label (REQ-VOCAB-06), normative per CANON §4.3. */
  label: string;
  /** Semantic tone the surface maps to a concrete color. */
  tone: StateTone;
}

/**
 * Single source of truth for the human display label + semantic tone of every derived loop state.
 *
 * Total over LoopStateEnum: TypeScript flags a missing key as a compile error
 * (Record<LoopStateEnum, StateLabel> requires every member). Consumed identically by the CLI
 * (tone → terminal color, see 02 §4) and both web pages (tone → CSS palette, see 02 §5).
 *
 * Labels are Title Case (CANON §4.3); the SCREAMING_SNAKE enum value remains the machine wire form
 * in --json / API responses (REQ-VOCAB-06) — this map governs human labels only.
 */
export const STATE_LABELS: Record<LoopStateEnum, StateLabel> = {
  IDLE: { label: "Idle", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  PAUSED: { label: "Paused", tone: "info" },
  COMPLETE: { label: "Complete", tone: "success" },
  PAUSED_HUMAN: { label: "Needs Human", tone: "warning" }, // REQ-VOCAB-05
  LIMIT_REACHED: { label: "Limit Reached", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
  NOT_INSTALLED: { label: "Not Installed", tone: "neutral" },
  SLEEPING_LIMIT: { label: "Sleeping (Limit)", tone: "warning" },
  WEEKLY_LIMIT: { label: "Weekly Limit", tone: "warning" },
  REVIEWING: { label: "Reviewing", tone: "info" }, // REQ-VOCAB-03 (new)
  PAUSED_USAGE_LIMIT: { label: "Usage Limit (Paused)", tone: "warning" }, // REQ-VOCAB-04 (new)
};

/**
 * Total accessor — never returns undefined (STATE_LABELS is total over the enum).
 * Consumers should use this rather than indexing STATE_LABELS directly, so the totality
 * invariant lives in one place.
 */
export function getStateLabel(state: LoopStateEnum): StateLabel {
  return STATE_LABELS[state];
}
```

### 2.1 Label conformance to CANON §4.3 (normative)

Every label matches CANON §4.3's "Display label (human, all surfaces)" column **exactly** — these are
normative strings, not stylistic choices:

| Derived enum | `label` | `tone` | CANON §4.3 source |
|---|---|---|---|
| `IDLE` | `Idle` | `neutral` | Idle |
| `RUNNING` | `Running` | `info` | Running |
| `PAUSED` | `Paused` | `info` | Paused |
| `COMPLETE` | `Complete` | `success` | Complete |
| `PAUSED_HUMAN` | `Needs Human` | `warning` | Needs Human (REQ-VOCAB-05) |
| `LIMIT_REACHED` | `Limit Reached` | `warning` | Limit Reached |
| `ERROR` | `Error` | `danger` | Error |
| `NOT_INSTALLED` | `Not Installed` | `neutral` | Not Installed |
| `SLEEPING_LIMIT` | `Sleeping (Limit)` | `warning` | Sleeping (Limit) |
| `WEEKLY_LIMIT` | `Weekly Limit` | `warning` | Weekly Limit |
| `REVIEWING` | `Reviewing` | `info` | Reviewing (REQ-VOCAB-03) |
| `PAUSED_USAGE_LIMIT` | `Usage Limit (Paused)` | `warning` | Usage Limit (Paused) (REQ-VOCAB-04) |

**Tone rationale (D3.5):** `RUNNING`/`PAUSED`/`REVIEWING` are `info` (active/benign lifecycle states);
`COMPLETE` is `success`; `IDLE`/`NOT_INSTALLED` are `neutral` (nothing to act on); the limit/usage/sleep
family (`LIMIT_REACHED`, `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `PAUSED_USAGE_LIMIT`) and `PAUSED_HUMAN` are
`warning` (operator attention may be needed but it is not a failure); `ERROR` is `danger`. This is the
binding tone assignment for the suite — OQ-T1's *tone→palette* tables follow in §4.1 and §5.2.

### 2.2 Error handling

`STATE_LABELS` and `getStateLabel` are pure, total, and synchronous. There is **no failure mode**:
`getStateLabel` is typed `(state: LoopStateEnum) => StateLabel` and the `Record` is total, so it can
never return `undefined` (with `noUncheckedIndexedAccess`, indexing a total `Record<K, V>` by a `K`
yields `V`, not `V | undefined`). No `Result` wrapper is needed or used. A caller that has a *raw*
status string (not a `LoopStateEnum`) must first run it through `mapLoopStateStatus` (§3); there is no
"unknown state" path because the enum is closed and totality is enforced.

## 3. Enum extension + `mapLoopStateStatus` remap (REQ-VOCAB-02/03/04)

### 3.1 `schemas.ts` — extend `LoopStateEnumSchema`

The raw `LoopStateStatusSchema` (`packages/core/src/schemas.ts:167`, 12 values incl. `reviewing` and
`paused_usage_limit`) is **unchanged**. The derived `LoopStateEnumSchema` (`schemas.ts:228`) gains the
two new members. Per `00-core-definitions.md` §2 the final declaration is:

```ts
// @rauf/core — schemas.ts:228  (TWO new members appended: REVIEWING, PAUSED_USAGE_LIMIT)
export const LoopStateEnumSchema = z.enum([
  "IDLE",
  "RUNNING",
  "PAUSED",
  "COMPLETE",
  "PAUSED_HUMAN",
  "LIMIT_REACHED",
  "ERROR",
  "NOT_INSTALLED",
  "SLEEPING_LIMIT",
  "WEEKLY_LIMIT",
  "REVIEWING", // (new) raw `reviewing` — was collapsed to RUNNING
  "PAUSED_USAGE_LIMIT", // (new) raw `paused_usage_limit` — was collapsed to PAUSED
]);
export type LoopStateEnum = z.infer<typeof LoopStateEnumSchema>;
```

### 3.2 `status.ts` — remap `mapLoopStateStatus` (compile-enforced totality)

The current implementation (`packages/core/src/status.ts:106`) routes both new raw states into existing
buckets — verbatim from source:

```ts
// CURRENT — packages/core/src/status.ts:106-123
function mapLoopStateStatus(status: LoopState["status"]): LoopStateEnum {
  const mapping: Record<LoopState["status"], LoopStateEnum> = {
    idle: "IDLE",
    starting: "RUNNING",
    running: "RUNNING",
    paused: "PAUSED",
    complete: "COMPLETE",
    paused_human: "PAUSED_HUMAN",
    limit_reached: "LIMIT_REACHED",
    error: "ERROR",
    sleeping_limit: "SLEEPING_LIMIT",
    weekly_limit: "WEEKLY_LIMIT",
    reviewing: "RUNNING", // ← collapses Reviewing into Running
    // Clean usage-limit halt — resumable, so surface as PAUSED (not a new enum value).
    paused_usage_limit: "PAUSED", // ← collapses Usage Limit into Paused
  };
  return mapping[status];
}
```

Replace the two highlighted rows so each raw state maps to its own derived value (REQ-VOCAB-03/04). All
other rows are unchanged. The mapping stays **total over the 12 raw statuses** (REQ-VOCAB-02):

```ts
// NEW — packages/core/src/status.ts:106
// EXPORTED (was module-private) so the all-12 totality test can target the mapping
// boundary directly (06 §4.2). Export it from packages/core/src/index.ts too.
export function mapLoopStateStatus(status: LoopState["status"]): LoopStateEnum {
  const mapping: Record<LoopState["status"], LoopStateEnum> = {
    idle: "IDLE",
    starting: "RUNNING",
    running: "RUNNING",
    paused: "PAUSED",
    complete: "COMPLETE",
    paused_human: "PAUSED_HUMAN",
    limit_reached: "LIMIT_REACHED",
    error: "ERROR",
    sleeping_limit: "SLEEPING_LIMIT",
    weekly_limit: "WEEKLY_LIMIT",
    reviewing: "REVIEWING", // CHANGED: distinct derived value (REQ-VOCAB-03)
    paused_usage_limit: "PAUSED_USAGE_LIMIT", // CHANGED: distinct derived value (REQ-VOCAB-04)
  };
  return mapping[status];
}
```

**Compile-time enforcement (I1):** the annotation `Record<LoopState["status"], LoopStateEnum>` makes
this an *exhaustive* table over the raw status union. If a raw status were added to
`LoopStateStatusSchema` without a row here, `tsc` errors (missing key). This is one of the two
compiler-guaranteed totality sites (the other is `statusExitCode`, §7). **No `default`/fallthrough**
exists, so REQ-VOCAB-02 ("no silent fallback to IDLE for an unmapped raw state") is structurally
guaranteed at this site.

**No change to `deriveStatus`** (`status.ts:359`) or the file-based derivation pipeline — staleness
checks, liveness probing, and the Tier 1/2 fallthrough are untouched (REQ-ARCH-02: status derivation
stays file-based, no subprocess). The two new derived values flow through `deriveStatus` unchanged
because it consumes `mapLoopStateStatus`'s output. Note `deriveFromStateJson` (`status.ts:154`) applies
a separate staleness downgrade for `running`/`starting`; `reviewing` was previously mapped to `RUNNING`
and thus subject to that downgrade, but the staleness logic keys off the *raw* `state.status`
(`running`/`starting`/`sleeping_limit`/`weekly_limit`), not the derived value, so remapping `reviewing`
→ `REVIEWING` does not alter which raw states are downgraded. Implementers MUST verify the staleness
branch still gates on raw status (not on the derived `loopState`) so `REVIEWING` is not unintentionally
swept into a downgrade path. If the staleness branch is found to switch on the derived value instead,
add `REVIEWING` to the same liveness treatment as `RUNNING`.

### 3.3 Error handling

`mapLoopStateStatus` is total and synchronous; it cannot fail. Upstream, `deriveFromStateJson`
(`status.ts:154`) already handles a missing/invalid `state.json` by returning `ok(null)` to fall
through to the log-parsing tier — that behavior is unchanged. A raw status outside the schema cannot
reach `mapLoopStateStatus` because `readJsonFile(paths.state, LoopStateSchema)` validates against
`LoopStateStatusSchema` first; an out-of-schema value fails parse and triggers the existing fall-through.

## 4. CLI `colorLoopState` refactor (REQ-VOCAB-06/07; OQ-T1 terminal)

### 4.1 Tone → terminal color table (OQ-T1, terminal)

The CLI's color helper `c` (`packages/cli/src/formatter.ts:59`) exposes
`red · green · yellow · blue · cyan · magenta · gray · dim · bold · underline` (each a `(s: string) =>
string` no-op when `--no-color`). The binding tone→terminal-color mapping (chosen to preserve today's
colors where a state maps cleanly — `RUNNING` stayed green-ish, errors red, limits yellow, neutral
dim):

| `tone` | Terminal color (`c` method) | Rationale vs. today |
|---|---|---|
| `neutral` | `c.dim` | matches today's `NOT_INSTALLED` (dim) |
| `info` | `c.cyan` | active/benign; cyan reads as informational; `COMPLETE` was cyan, `RUNNING` was green — unified to cyan for the info family |
| `success` | `c.green` | success/clean terminal |
| `warning` | `c.yellow` | matches today's `PAUSED`/`LIMIT_REACHED` (yellow) |
| `danger` | `c.red` | matches today's `ERROR` (red) |

> **OQ-T1 note (terminal, resolved):** the previous per-state palette mixed `green`/`blue`/`magenta`
> for states that are semantically the same tone (e.g. `RUNNING`=green, `SLEEPING_LIMIT`=blue,
> `PAUSED_HUMAN`=magenta). Collapsing to a tone→color table loses those incidental distinctions in
> favor of one coherent severity palette; this is the intended D3.5 outcome (one source of truth, not a
> per-state bespoke palette). The **label text** still distinguishes states (e.g. "Needs Human" vs
> "Sleeping (Limit)"), so no information is lost — only redundant per-state coloring.

### 4.2 Refactored `colorLoopState`

The current implementation (`packages/cli/src/status-commands.ts:538`) is a per-state `switch` with a
silent `default:` — verbatim from source:

```ts
// CURRENT — packages/cli/src/status-commands.ts:538-561
function colorLoopState(state: LoopStateEnum): string {
  switch (state) {
    case "RUNNING":
      return c.green(state);
    case "PAUSED_HUMAN":
      return c.magenta(state);
    case "LIMIT_REACHED":
      return c.yellow(state);
    case "ERROR":
      return c.red(state);
    case "COMPLETE":
      return c.cyan(state);
    case "PAUSED":
      return c.yellow(state);
    case "NOT_INSTALLED":
      return c.dim(state);
    case "SLEEPING_LIMIT":
      return c.blue(state);
    case "WEEKLY_LIMIT":
      return c.red(state);
    default:
      return c.dim(state); // ← I2: silent fallback — REVIEWING/PAUSED_USAGE_LIMIT would dim silently
  }
}
```

Replace it with a tone-driven implementation that reads `STATE_LABELS` and is **total over the enum
with no `default:`** (REQ-VOCAB-07, invariant I2):

```ts
// NEW — packages/cli/src/status-commands.ts:538
import { STATE_LABELS, type StateTone, type LoopStateEnum } from "@rauf/core";
import { c } from "./formatter.js"; // existing import (status-commands.ts:33)

/** Map a semantic tone to a terminal color wrapper (OQ-T1 terminal table, 02 §4.1). */
const TONE_COLOR: Record<StateTone, (s: string) => string> = {
  neutral: c.dim,
  info: c.cyan,
  success: c.green,
  warning: c.yellow,
  danger: c.red,
};

/**
 * Color a loop-state badge for the terminal. Reads the shared label map for the tone, then maps
 * tone → terminal color (02 §4.1). Total over LoopStateEnum via TONE_COLOR (Record<StateTone, …>);
 * NO `default:` branch (REQ-VOCAB-07 — no silent fallback). Prints the SCREAMING_SNAKE machine value
 * by default for backward-compatible CLI output; see §4.3 on label vs. machine value.
 */
function colorLoopState(state: LoopStateEnum): string {
  const { tone } = STATE_LABELS[state];
  return TONE_COLOR[tone](state);
}
```

### 4.3 Machine value vs. human label in CLI output (REQ-VOCAB-06)

`colorLoopState(state)` colors the **machine enum value** (`state`, SCREAMING_SNAKE) — this preserves
today's terminal output verbatim for the 10 existing states (only the *color* of `RUNNING`,
`PAUSED_HUMAN`, `SLEEPING_LIMIT` shifts to the tone palette; the *text* is unchanged) and is the
minimal, additive change (C-1). The two new states render as `REVIEWING` / `PAUSED_USAGE_LIMIT`.

REQ-VOCAB-06 governs **human-facing label rendering**: where the CLI prints a *prose* status line
(not the badge token) it should use `getStateLabel(state).label` (Title Case). The badge token in
`printStatusSummary` (`status-commands.ts:578`) stays the machine value for continuity; `--json` and
API responses are unaffected (they emit `state.loopState` directly, never the label). Implementers MUST
NOT route the SCREAMING_SNAKE value through the label map or vice-versa — the two are distinct by
design (machine enum vs. human label). If a future change wants Title-Case badges in the CLI, it is a
one-line swap to `TONE_COLOR[tone](getStateLabel(state).label)`; this phase keeps the machine token to
stay strictly additive.

### 4.4 Error handling

`colorLoopState` is total and pure. `TONE_COLOR` is `Record<StateTone, …>` (5 keys, total over the
tone union) and `STATE_LABELS[state]` is `StateLabel` (total over the enum, `noUncheckedIndexedAccess`
yields a non-optional value), so neither lookup can be `undefined`. There is no failure path and no
`Result` wrapper. The `--no-color` mode is handled inside `c` (wraps to identity) — no special-casing
here.

## 5. Web shared badge (REQ-VOCAB-01/06/07; OQ-T1 web)

### 5.1 Today: two divergent copies (the duplication this collapses)

There are two `STATE_BADGE` tables, each `Record<string, …>` with a `?? STATE_BADGE["IDLE"]` fallback
(invariant I2 — silent mislabel of any unmapped value), and with **divergent labels/colors**:

- `packages/web/src/client/routes/projects/status.tsx:18` — `StateBadgeConfig { label, bgColor,
  textColor, borderColor }`; labels are SCREAMING-with-spaces ("NEEDS HUMAN", "LIMIT REACHED",
  "NOT INSTALLED"); 8 entries (IDLE, RUNNING, PAUSED, COMPLETE, PAUSED_HUMAN, LIMIT_REACHED, ERROR,
  NOT_INSTALLED). Consumed by `LoopStateBadge` (`status.tsx:88`), which does `STATE_BADGE[loopState]
  ?? STATE_BADGE["IDLE"]!` and renders a border + larger font.
- `packages/web/src/client/routes/projects/index.tsx:48` — `StateBadgeConfig { label, bgColor,
  textColor }` (no border); Title-Case labels ("Idle", "Needs Human", …); 8 entries. Consumed by
  `StateBadge` (`index.tsx:71`), which does `STATE_BADGE[state] ?? STATE_BADGE["IDLE"]!` and renders a
  small pill.

Neither covers `SLEEPING_LIMIT`, `WEEKLY_LIMIT`, `REVIEWING`, or `PAUSED_USAGE_LIMIT` — those silently
fall back to the IDLE pill today (the exact REQ-VOCAB-07 defect). Both are replaced by one component.

### 5.2 Tone → CSS palette table (OQ-T1, web)

The shared badge maps `tone` (from `STATE_LABELS`) to a CSS color triple `{ bg, text, border }`,
preserving today's colors where a state maps cleanly (the existing `index.tsx`/`status.tsx` hexes are
reused per tone). Binding table:

| `tone` | `bg` | `text` | `border` | Preserves |
|---|---|---|---|---|
| `neutral` | `rgba(107, 114, 128, 0.12)` | `#6b7280` | `rgba(107, 114, 128, 0.25)` | today's IDLE / NOT_INSTALLED gray |
| `info` | `rgba(37, 99, 235, 0.12)` | `#2563eb` | `rgba(37, 99, 235, 0.35)` | today's COMPLETE blue (now the info family: RUNNING/PAUSED/REVIEWING) |
| `success` | `rgba(22, 163, 74, 0.12)` | `#16a34a` | `rgba(22, 163, 74, 0.35)` | today's RUNNING green, now COMPLETE=success |
| `warning` | `rgba(202, 138, 4, 0.12)` | `#ca8a04` | `rgba(202, 138, 4, 0.35)` | today's PAUSED amber (PAUSED_HUMAN/limits/usage/sleep) |
| `danger` | `rgba(220, 38, 38, 0.12)` | `#dc2626` | `rgba(220, 38, 38, 0.35)` | today's ERROR / LIMIT_REACHED red |

> **OQ-T1 note (web, resolved):** like the terminal palette this collapses the per-state coloring into
> a coherent 5-tone severity palette. The most visible shift: under the per-state tables `RUNNING` was
> green and `COMPLETE` was blue; under the tone palette `COMPLETE`→`success`→green and the active
> family `RUNNING`/`PAUSED`/`REVIEWING`→`info`→blue. This is intentional (D3.5): the *label* + the
> animated dot on `RUNNING` (preserved, §5.3) distinguish states; tone conveys severity. Alpha `0.12`
> is used uniformly (the two old tables used `0.10`/`0.12`/`0.15` inconsistently). This table lives in
> the **web client only** — core stays CSS-free (REQ-ARCH-01).

### 5.3 The shared badge component

A single component replaces **both** `LoopStateBadge` (`status.tsx`) and `StateBadge` (`index.tsx`). It
lives in the web client (e.g. `packages/web/src/client/components/StateBadge.tsx`), reads
`STATE_LABELS` from `@rauf/core` for the label, and maps `tone` → the §5.2 CSS palette. It preserves
both call sites' visual variants via a `size` prop (the status page wants a bordered, larger,
monospace badge; the dashboard wants a small pill) and the `RUNNING` animated dot.

```tsx
// @rauf/web — src/client/components/StateBadge.tsx  (NEW; replaces BOTH STATE_BADGE copies)
import { STATE_LABELS, type StateTone } from "@rauf/core";
import type { LoopStateEnum } from "@rauf/core";

/** tone → CSS palette (OQ-T1 web table, 02 §5.2). Web-client only — core stays CSS-free. */
const TONE_PALETTE: Record<StateTone, { bg: string; text: string; border: string }> = {
  neutral: { bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280", border: "rgba(107, 114, 128, 0.25)" },
  info: { bg: "rgba(37, 99, 235, 0.12)", text: "#2563eb", border: "rgba(37, 99, 235, 0.35)" },
  success: { bg: "rgba(22, 163, 74, 0.12)", text: "#16a34a", border: "rgba(22, 163, 74, 0.35)" },
  warning: { bg: "rgba(202, 138, 4, 0.12)", text: "#ca8a04", border: "rgba(202, 138, 4, 0.35)" },
  danger: { bg: "rgba(220, 38, 38, 0.12)", text: "#dc2626", border: "rgba(220, 38, 38, 0.35)" },
};

/**
 * `state` is the machine LoopStateEnum value (SCREAMING_SNAKE) from the API (REQ-VOCAB-06);
 * the human label comes exclusively from STATE_LABELS. Typed as LoopStateEnum (not string) so the
 * call site is forced to pass a real enum value — combined with TONE_PALETTE being a total
 * Record<StateTone, …>, there is NO `?? IDLE` fallback (REQ-VOCAB-07, invariant I2).
 */
export function StateBadge({
  state,
  size = "pill",
}: {
  state: LoopStateEnum;
  size?: "pill" | "block";
}) {
  const { label, tone } = STATE_LABELS[state];
  const palette = TONE_PALETTE[tone];
  const isPill = size === "pill";
  return (
    <span
      className={
        isPill
          ? "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          : "inline-flex items-center gap-2 rounded-lg border px-4 py-1.5 font-mono text-base font-bold tracking-wide"
      }
      style={{
        backgroundColor: palette.bg,
        color: palette.text,
        ...(isPill ? {} : { borderColor: palette.border }),
      }}
    >
      {state === "RUNNING" && (
        <span
          className={
            isPill
              ? "h-1.5 w-1.5 animate-pulse rounded-full bg-current"
              : "h-2.5 w-2.5 animate-pulse rounded-full bg-current"
          }
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}
```

### 5.4 Call-site migration

- `packages/web/src/client/routes/projects/status.tsx`: delete the local `STATE_BADGE` (`:18-67`),
  `StateBadgeConfig` (`:11-16`), and `LoopStateBadge` (`:88-105`); import the shared `StateBadge` and
  render `<StateBadge state={status.loopState} size="block" />`. (`status.loopState` is
  `DerivedStatus["loopState"]`, i.e. `LoopStateEnum` — already correctly typed; if the prop site
  currently passes `string`, narrow it to `LoopStateEnum`.)
- `packages/web/src/client/routes/projects/index.tsx`: delete the local `STATE_BADGE` (`:48-69`),
  `StateBadgeConfig` (`:42-46`), and `StateBadge` (`:71-84`); import the shared `StateBadge` and render
  `<StateBadge state={...} />` (defaults to `size="pill"`). The call site MUST pass a `LoopStateEnum`,
  not a raw string; if the dashboard currently holds the value as `string`, type it as `LoopStateEnum`
  (it is `DerivedStatus["loopState"]` from the projects API).
- `STARTABLE_STATES`/`STOPPABLE_STATES` (`status.tsx:71-72`) are **out of scope** for this doc (loop
  control, owned by `04-web-recovery-routes.md`); leave them unless that doc says otherwise.

### 5.5 Error handling

The component is total: `state: LoopStateEnum` (not `string`) forces a valid enum value at the call
site, `STATE_LABELS[state]` is non-optional, and `TONE_PALETTE[tone]` is total over the tone union — so
there is **no `?? IDLE` fallback and no unstyled render** (REQ-VOCAB-07). If a call site holds an
untrusted string (e.g. a raw value from somewhere other than the typed API), it must validate via
`LoopStateEnumSchema.safeParse` first and handle the parse failure explicitly (e.g. render nothing or
an error pill) — the component will not silently absorb an invalid value.

## 6. Correctness note — why the four sites differ (tech-spec §3.3, verifier)

REQ-VOCAB-07 ("every derived value has a badge; no value renders unstyled / as a silent default") is
**structurally** satisfied only if each consuming site is total. The four sites split into two classes:

- **Compiler-enforced (invariant I1) — guaranteed by `tsc`:**
  - `mapLoopStateStatus` (§3.2): `Record<LoopState["status"], LoopStateEnum>` — a missing raw key is a
    compile error; no `default`/fallthrough.
  - `statusExitCode` (§7): a **default-less** `switch` over `LoopStateEnum` with `noImplicitReturns` /
    exhaustiveness — a missing enum case is a compile error (the function would lack a return).
- **Refactor-enforced (invariant I2) — NOT guaranteed by `tsc` today, MUST be actively fixed here:**
  - `colorLoopState` (§4.2): had a `switch` with `default:` — a new enum value compiles and *silently
    dims*. The refactor removes the `default:` and drives color from `TONE_COLOR: Record<StateTone,…>`
    keyed off `STATE_LABELS[state]`, making it total over the enum (any new enum value gets a label +
    tone in `STATE_LABELS`, which is itself compiler-total).
  - web `STATE_BADGE` (§5.3): was `Record<string, …>` + `?? STATE_BADGE["IDLE"]` — a new enum value
    compiles and *silently mislabels as IDLE*. The refactor types the prop `LoopStateEnum`, reads the
    compiler-total `STATE_LABELS`, and removes the `?? IDLE` fallback.

After the refactor, all four sites are total: two by the compiler, two by construction routed through
the compiler-total `STATE_LABELS`/`Record<StateTone,…>`. Adding any future derived state therefore
forces a `STATE_LABELS` entry (compile error otherwise), which automatically supplies the CLI color and
web badge — closing the drift that motivated this phase (PRD §1.2).

## 7. `statusExitCode` extension (REQ-EXIT-01; CANON §4.4)

The current implementation (`packages/cli/src/status-commands.ts:512`) is a **default-less** `switch`
over `LoopStateEnum` — verbatim from source:

```ts
// CURRENT — packages/cli/src/status-commands.ts:512-535
export function statusExitCode(state: LoopStateEnum, derived?: DerivedStatus): number {
  switch (state) {
    case "RUNNING":
      return ExitCode.RUNNING; // 6
    case "PAUSED_HUMAN":
      return ExitCode.NEEDS_HUMAN; // 3
    case "LIMIT_REACHED":
    case "SLEEPING_LIMIT":
    case "WEEKLY_LIMIT":
      return ExitCode.LIMIT; // 4
    case "ERROR":
      return ExitCode.ERROR; // 1
    case "IDLE":
    case "COMPLETE":
    case "PAUSED":
      if (derived && genuineBlockedCount(derived.backlogSummary) > 0) {
        return ExitCode.BLOCKED; // 5
      }
      return ExitCode.SUCCESS; // 0
    case "NOT_INSTALLED":
      return ExitCode.SUCCESS; // 0
  }
}
```

Because there is **no `default:`**, adding `REVIEWING` and `PAUSED_USAGE_LIMIT` to `LoopStateEnum`
(§3.1) makes this a *compile error* (the `switch` is no longer exhaustive — the function would have a
code path returning `undefined`, which violates the `number` return type / `noImplicitReturns`). That
compile error is the enforcement (invariant I1). Add the two cases per CANON §4.4:

```ts
// NEW — packages/cli/src/status-commands.ts:512  (two cases added; no `default:`)
export function statusExitCode(state: LoopStateEnum, derived?: DerivedStatus): number {
  switch (state) {
    case "RUNNING":
    case "REVIEWING": // NEW: a review pass is a running query-time state (preserves prior behavior:
      return ExitCode.RUNNING; //      raw `reviewing` derived to RUNNING → 6 before this phase)
    case "PAUSED_HUMAN":
      return ExitCode.NEEDS_HUMAN; // 3
    case "LIMIT_REACHED":
    case "SLEEPING_LIMIT":
    case "WEEKLY_LIMIT":
    case "PAUSED_USAGE_LIMIT": // NEW: a usage-limit pause is a LIMIT state (corrects today's silent 0)
      return ExitCode.LIMIT; // 4
    case "ERROR":
      return ExitCode.ERROR; // 1
    case "IDLE":
    case "COMPLETE":
    case "PAUSED":
      if (derived && genuineBlockedCount(derived.backlogSummary) > 0) {
        return ExitCode.BLOCKED; // 5
      }
      return ExitCode.SUCCESS; // 0
    case "NOT_INSTALLED":
      return ExitCode.SUCCESS; // 0
  }
}
```

### 7.1 Mapping rationale (CANON §4.4)

| Derived value | Exit code | CANON §4.4 meaning | Note |
|---|---|---|---|
| `REVIEWING` | `ExitCode.RUNNING` (6) | Running (query-time only) | **Preserves prior observable behavior** — raw `reviewing` already derived to `RUNNING`→6 before this phase, so no contract change (C-1, REQ-EXIT-01). |
| `PAUSED_USAGE_LIMIT` | `ExitCode.LIMIT` (4) | Limit reached / usage-paused / sleeping | **Corrects today's silent `0`** — raw `paused_usage_limit` derived to `PAUSED`→`SUCCESS`(0), making a usage-limited loop "look idle" to a supervisor. Now exits 4 (REQ-EXIT-01, PRD user story 3). |

The unified v0.5.0 `ExitCode` table (codes 0–6, defined in `commands.ts`) is otherwise unchanged. The
`derived` second arg and the `BLOCKED(5)` derivation for clean-terminal states are untouched.

### 7.2 Error handling

`statusExitCode` is total and synchronous (no `Result` — exit codes are plain numbers). The compiler
guarantees a code is returned for every enum value (no `default:`, exhaustive `switch`). The optional
`derived` arg is already nil-guarded (`derived && …`); behavior when omitted is unchanged.

## 8. Example usage

```ts
// CLI — coloring a state token for the terminal (status-commands.ts)
import { STATE_LABELS } from "@rauf/core";
colorLoopState("REVIEWING"); // → c.cyan("REVIEWING")  (tone=info → cyan)
colorLoopState("PAUSED_USAGE_LIMIT"); // → c.yellow("PAUSED_USAGE_LIMIT")  (tone=warning → yellow)
STATE_LABELS["PAUSED_USAGE_LIMIT"].label; // → "Usage Limit (Paused)"  (human, CANON §4.3)

// CLI — exit code for a supervisor / CI
statusExitCode("REVIEWING"); // → 6 (RUNNING)
statusExitCode("PAUSED_USAGE_LIMIT"); // → 4 (LIMIT) — no longer a silent 0

// Web — one badge, both pages
<StateBadge state="REVIEWING" />;                  // dashboard pill: blue "Reviewing"
<StateBadge state="PAUSED_USAGE_LIMIT" size="block" />; // status page: amber "Usage Limit (Paused)"
```

## 9. Cross-references

- **`00-core-definitions.md`** §2 (extended `LoopStateEnumSchema`/`LoopStateEnum`) and §3
  (`StateTone`/`StateLabel`/`STATE_LABELS`/`getStateLabel` type surface) — this doc supplies their
  bodies; §8.2 (exit-code summary) — this doc supplies the full `statusExitCode` mapping.
- **`01-architecture-layout.md`** §4 (new `state-labels.ts` + core index export; `schemas.ts`/
  `status.ts` edits), §5 (`status-commands.ts` refactor), §6.4 (web badge replacement) — this doc
  supplies the contents.
- **`04-web-recovery-routes.md`** — *consumes* the shared `StateBadge` (§5.3) for the recovery status
  page and owns `STARTABLE_STATES`/`STOPPABLE_STATES`; not a prerequisite of this doc.
- **`06-testing-strategy.md`** — owns the test-suite layout; §10 below states this doc's required
  assertions, which that doc places.

## 10. Verification

An implementation matches this spec when:

1. **`STATE_LABELS` is total and CANON-correct.** A core unit test iterates
   `LoopStateEnumSchema.options` and asserts `STATE_LABELS` has an entry for **every** value (12), with
   the exact `label` and `tone` from §2.1 (REQ-VOCAB-01/03/04/05/07; REQ-TEST-02). `getStateLabel`
   returns a defined `StateLabel` for every enum value and is typed to never return `undefined`. A
   missing key is a `tsc` error (no test even compiles) — both the type check and the runtime iteration
   must pass.
2. **Enum + remap.** `LoopStateEnumSchema` contains `REVIEWING` and `PAUSED_USAGE_LIMIT` (§3.1).
   `mapLoopStateStatus` is **exported** (§3.2) so the boundary test can import it directly (06 §4.2). A
   unit test asserts `mapLoopStateStatus("reviewing") === "REVIEWING"`,
   `mapLoopStateStatus("paused_usage_limit") === "PAUSED_USAGE_LIMIT"`, and that all 12 raw statuses map
   (iterate `LoopStateStatusSchema.options`; no `undefined`). The `Record<LoopState["status"],
   LoopStateEnum>` annotation is present (compile-enforced totality, REQ-VOCAB-02).
3. **No silent fallback anywhere (REQ-VOCAB-07).** Grep confirms: `colorLoopState` has **no
   `default:`** branch and routes through `TONE_COLOR`/`STATE_LABELS`; the web badge has **no
   `?? STATE_BADGE["IDLE"]`** / no `Record<string, …>` (its prop is `LoopStateEnum`, palette is
   `Record<StateTone, …>`); both old `STATE_BADGE` tables and the two old badge components are deleted
   (`grep -r "STATE_BADGE" packages/web/src/client` returns nothing, and the only `StateBadge`
   definition is the shared component).
4. **`statusExitCode` cases (REQ-EXIT-01; CANON §4.4).** Unit tests assert `statusExitCode("REVIEWING")
   === 6` and `statusExitCode("PAUSED_USAGE_LIMIT") === 4`; all other cases unchanged. The `switch` has
   **no `default:`** (compile-enforced exhaustiveness — confirm by temporarily removing a case and
   observing a `tsc` error, or trust the absence of `default:`).
5. **Single source of truth.** The CLI (`colorLoopState`) and both web pages import label/tone from
   `@rauf/core`'s `STATE_LABELS`; no surface hard-codes a per-state label or color table (REQ-VOCAB-01).
6. **Machine vs. human casing (REQ-VOCAB-06).** `--json` / API responses still emit the SCREAMING_SNAKE
   `loopState` value (the label map is not applied to machine output); human surfaces render Title-Case
   labels from `STATE_LABELS`.
7. **No behavior regression in derivation (REQ-ARCH-02).** `deriveStatus`/`deriveFromStateJson` are
   unchanged except via `mapLoopStateStatus`'s output; the staleness branch still keys on *raw* status
   (§3.2); no subprocess is invoked.
8. **Gate green.** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` passes across all
   packages (the §3.1 enum addition compile-errors `mapLoopStateStatus` and `statusExitCode` until §3.2
   and §7 are applied — fixing those is part of "done").
