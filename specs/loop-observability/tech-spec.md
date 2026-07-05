# Loop Observability — Technical Specification

> **Foundation:** This spec answers *HOW* against the ratified requirements in
> [`PRD.md`](./PRD.md) (which in turn ratifies [`CANON.md`](./CANON.md)). Every
> technical decision below traces to a `REQ-*` id. Requirements are referenced,
> not restated — see the PRD for the *WHAT*.

---

## 1. Overview

Loop Observability is a **prescription + rendering** change on rauf's already-sound
event/status substrate, plus **one enabling additive contract change**. There is
**no new persisted state and no new event type** (PRD §7). The work decomposes into
four independently-shippable phases, each green under `pnpm gate` (REQ-GATE-01):

| Phase | Deliverable | Packages touched |
|-------|-------------|------------------|
| **1 — Complete the contract** | Additive `health` block + `statusSchemaVersion` on `DerivedStatus` | `core` |
| **2 — Make it consistent** | `resolveTarget()` (cwd-default / strict machine-context); rewrite `drive-rauf-loop` into the canonical poll recipe | `core`, `cli`, skill |
| **3 — Make it humane** | `eventAltitude()` classifier + item-level `follow` default + sticky header + `--all` front door | `core`, `cli` |
| **4 — Parity & docs** | Update `SPEC-CLI.md`, `SPEC-BACKLOG-TOOL-CONTRACT.md`, canon cross-ref. **Web parity deferred to a follow-up feature (Q2 ratified: docs-only).** | docs |

**Key architectural decisions (ratified in the forge-2-tech interview):**

1. The `health` block is a **nested object of booleans + raw activity age**, `null`
   when no iteration is live (D4 / Q1).
2. Availability is advertised via a top-level **`statusSchemaVersion: "1"`** marker,
   mirroring the existing `EVENTS_SCHEMA_VERSION` convention (REQ-COMPAT-02).
3. `deriveStatus` reads `iteration-status.json` **only conditionally today** (via the
   private `isLoopLive` helper, and only inside the staleness-downgrade branch), so
   populating `health` requires **promoting a single shared `readIterationStatus` call**
   into `deriveStatus` — keeping the cost at **≤1 iteration-status read per poll, no
   subprocess** (REQ-PERF-01, C-04). See §3.1 and §6 #1/#2.
4. Event-altitude classification and target resolution both live in **`core` as pure
   functions** — reusable, unit-testable, and (for `eventAltitude`) the seam a future
   web-parity feature reuses. Neither changes what a machine surface emits
   (REQ-COMPAT-01, the prime directive).
5. The recovery playbook uses a **persist-then-escalate ladder** (health is a hint,
   not a verdict — REQ-CONTRACT-04).

---

## 2. Module Structure

No new packages or modules. All changes land in existing files.

| Package | File | Change |
|---------|------|--------|
| `core` | `src/schemas.ts` | Add `HealthSchema`; add `health` + `statusSchemaVersion` to `DerivedStatusSchema` (~L279–292) |
| `core` | `src/status.ts` | Populate `health` in `deriveStatus`; export `STATUS_SCHEMA_VERSION`; reuse the `iteration-status.json` read already done by `isLoopLive` |
| `core` | `src/events-log.ts` | Add exported `eventAltitude(ev): "item" \| "firehose"` classifier |
| `core` | `src/backlog-root.ts` *(or new `src/target-resolution.ts`)* | Add exported `resolveTarget()` |
| `cli` | `src/follow-command.ts` | Item-level default via `eventAltitude`; `--verbose` firehose; sticky header from `deriveStatus` |
| `cli` | `src/status-commands.ts` | Delegate to `resolveTarget()`; bare-`status` cwd→`--all` broadening |
| `cli` | `src/event-format.ts` | Sticky-header renderer (reuses `formatEvent`) |
| skill | `skills/drive-rauf-loop/SKILL.md` **and** `.codex-plugin/skills/drive-rauf-loop/SKILL.md` | Rewrite into poll recipe (kept in lockstep) |
| skill | `agents/rauf-loop-driver.md` | Confirm it still defers to the rewritten skill (likely no change) |
| docs | `docs/SPEC-CLI.md`, `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` | Document `health`, `statusSchemaVersion`, item-feed, scope rules |

**Public API surface added (all in `core`):**

```ts
// schemas.ts
export const HealthSchema: z.ZodType<Health>;
export type Health = { ... };                     // see §4
export const STATUS_SCHEMA_VERSION = "1";         // status.ts

// events-log.ts
export function eventAltitude(ev: PersistedEvent): "item" | "firehose";

// target-resolution.ts (or backlog-root.ts)
export function resolveTarget(opts: ResolveTargetOptions): Result<ResolvedTarget, TargetError>;
```

---

## 3. Technical Decisions

### 3.1 The `health` block — nested booleans + activity age (REQ-CONTRACT-03, REQ-CONTRACT-04, Q1)

`DerivedStatus` gains an additive `health` field. Shape (ratified encoding):

```ts
type Health = {
  stuckWarning: boolean;        // faithful mirror of IterationStatus.stuckWarning
  iterationFresh: boolean;      // updatedAt within ITERATION_STATUS_FRESH_MS (60s)
  lastActivityAt: string;       // ISO, from IterationStatus.lastActivityAt
  secondsSinceActivity: number; // derived (now - lastActivityAt), so the agent
                                //   never diffs updatedAt itself
};
// DerivedStatus.health: Health | null   — null when no iteration is live
```

- **Why nested + null:** PRD D4 ratified a nested block. `null` (not a partial object)
  cleanly encodes "no live iteration → no health signal to report," so an agent's
  branch is `if (status.health?.stuckWarning)` — unambiguous when inapplicable.
- **Why booleans + raw age, not an enum verdict:** REQ-CONTRACT-04 — the signal is a
  *hint, not a verdict*. Returning `secondsSinceActivity` lets the agent apply its own
  "persists across N polls" threshold (§3.6) rather than baking the escalation
  decision into core. An enum (`healthy|stalling|idle`) was **rejected** for exactly
  this reason (Alternatives Considered).
- **Source of truth unchanged (C-04):** every field is a surfacing of
  `IterationStatus` (`stuckWarning`, `lastActivityAt`, `updatedAt`) — computed, not a
  new source.
- **Freshness reuses the existing constant:** `iterationFresh` uses
  `ITERATION_STATUS_FRESH_MS` (60s, `status.ts:36`), already used by `isLoopLive`.
  No new threshold introduced.
- **I/O cost — ≤1 read per poll (REQ-PERF-01):** `deriveStatus` does **not** read
  `iteration-status.json` on the healthy path today — the `isLoopLive` read
  (`status.ts:143`) fires **only** inside the staleness-downgrade branch
  (`status.ts:179`), and even there short-circuits when a live lock exists. Populating
  `health` therefore requires **promoting a single `readIterationStatus(paths)` call**
  into `deriveStatus`/`deriveFromStateJson`, replacing the conditional read inside
  `isLoopLive` with one shared read so the invocation count stays **at most one per
  `deriveStatus`** (still no subprocess — C-02). This is the accurate REQ-PERF-01
  guarantee; see §6 #1/#2 and the read-spy test in §8. The shared-read promotion is a
  **required** part of the implementation (OTQ-1), not optional.

### 3.2 Versioning — `statusSchemaVersion` marker (REQ-COMPAT-02, REQ-CONTRACT-05, REQ-COMPAT-01)

Add a top-level `statusSchemaVersion: "1"` to the `DerivedStatus` object.

- **Additive only:** no existing field renamed or removed (REQ-CONTRACT-05). Existing
  consumers that ignore unknown fields are unaffected; new consumers detect `health`
  availability by the version marker.
- **Convention match:** mirrors `EVENTS_SCHEMA_VERSION = "1"` on `PersistedEvent`
  (`schemas.ts:680`). Exported as `STATUS_SCHEMA_VERSION` from `status.ts` and stamped
  in `deriveStatus`'s return value (so it flows through `outputJson` unchanged — the
  CLI adds no version logic of its own).
- **Presence-based detection was rejected:** weaker signal, inconsistent with the
  event stream's explicit versioning.

### 3.3 Event-altitude classifier — pure function in `core` (REQ-CMD-02, REQ-CMD-05, REQ-CMD-03)

`eventAltitude(ev)` maps each of the 24 `LoopEvent` types to `"item"` or `"firehose"`:

| Altitude | Event types |
|----------|-------------|
| **`item`** (default feed) | `loop_started`, `item_selected`, `item_completed`, `item_blocked`, `item_retried`, `needs_human`, `signal_parsed`, `loop_paused`, `review_started`, `review_completed`, `review_failed`, `loop_completed`, `loop_error`, `loop_cancelled`, `usage_limit_hit`, `usage_limit_cleared`, `sleep_start`, `sleep_end`, `llm_stuck_warning` |
| **`firehose`** (`--verbose` only) | `iteration_start`, `llm_spawned`, `llm_exited`, `llm_tool_activity`, `llm_token_update` |

- **Why the broad "item/loop lifecycle" set:** a supervisor needs `loop_completed`,
  `needs_human`, `review_*`, `usage_limit_*`, and `sleep_*` to understand *how a run
  ends*, not just item transitions. This matches the PRD's `follow` examples and
  aligns with feature-forge's existing `jq` milestone filter (so the two converge
  rather than diverge).
- **Why core, not CLI:** it is a **pure classification function** (no I/O, no
  rendering, no `cli`/`web` import), so it does **not** violate C-01 or REQ-COMPAT-01.
  Placing it in core makes it unit-testable in isolation and gives a future web-parity
  feature (Q2 follow-up) an identical classification seam — cheap insurance for the
  deferred phase.
- **Presentation-only (REQ-CMD-03/05):** the classifier is applied **only** by the
  TTY renderer path. `follow --json` and `follow --verbose` emit **every** event
  untouched. The altitude filter never touches JSON output.

### 3.4 `follow` item-level default + sticky header (REQ-CMD-02, REQ-CMD-05, REQ-A11Y-01)

`handleFollow` (`follow-command.ts:52`) changes only its **human render path**:

- **Default (TTY, no flags):** emit only events where `eventAltitude(ev) === "item"`,
  plus a **sticky progress header** re-rendered on each item milestone.
- **`--verbose`:** current behavior — emit every event via `formatEvent`.
- **`--json`:** unchanged — raw `PersistedEvent` NDJSON, every event (REQ-CMD-03).
- **Sticky header data source (REQ-CMD-05 — no new data model):** derived from a
  `deriveStatus` poll (the same `intervalSeconds` poll `follow` already runs for
  terminal detection, `follow-command.ts:130`). Header shape:
  `4/12 done · 1 blocked · on auth-007` — sourced from
  `DerivedStatus.backlogSummary` (`done`/`total`/`blocked`) + `currentItem`. No new
  scan; reuses `readEvents`/`watchEvents` (`events-log.ts`) for the feed and
  `deriveStatus` for the header.
- **A11Y (REQ-A11Y-01):** header degrades to a plain reprinted line on non-TTY /
  no-color / narrow terminals; state (blocked / needs-human / healthy) is conveyed by
  **text label**, never color alone. Reuses `detectColorSupport()` (`formatter.ts:33`).

> **Naming note:** the PRD refers to both `follow` (the standalone command,
> `follow-command.ts`) and `status --follow` (`handleStatusFollow`,
> `status-commands.ts:439`). The item-level default is the **`follow` command's**
> default; `status --follow` remains the re-rendered `DerivedStatus` snapshot glance
> (REQ-CMD-01). No fourth verb is added (REQ-CMD-02).

### 3.5 Target resolution — `resolveTarget()` in core (REQ-SCOPE-01…05, REQ-SAFE-02, D5)

A single exported resolver centralizes the safety-critical wrong-root guard. Today
`status`/`follow` **require** a positional `<path>` (no cwd default); this replaces
that with context-aware resolution:

```ts
type ResolveTargetOptions = {
  pathArg?: string;          // positional <root>, if given
  backlogFlag?: string;      // --backlog <dir>, if given
  isMachineContext: boolean; // globalFlags.json || !process.stdout.isTTY  (D5)
  isTTY: boolean;
};
type ResolvedTarget =
  | { kind: "resolved"; root: string; backlogDir: string }
  | { kind: "ambiguous"; candidates: ActiveLoopEntry[] };   // TTY-only
```

- **Machine context (REQ-SCOPE-01, REQ-SAFE-02):** `isMachineContext = --json OR
  non-TTY stdout` (D5 — non-TTY alone, not only `--json`). A **missing or ambiguous**
  target returns a `Result` **error** — a hard fail, never an implicit scan. The CLI
  renders it as `outputJson({ error })` under `--json` and a stderr error otherwise
  (closing the current gap where missing-arg has no `--json` error path).
- **TTY (REQ-SCOPE-02, REQ-SCOPE-03):** default `root` to **cwd**; if exactly one
  active root is found, use it; if several, return `kind:"ambiguous"` with candidates
  from `listActiveLoops()` (`loop-registry.ts`) for the CLI to render as an
  interactive pick list. Bare `status` broadens to the `--all` view **only when no
  local live loop exists** (REQ-SCOPE-03).
- **Sandboxing preserved (REQ-SAFE-01, C-01):** resolution ends in the existing
  `resolveBacklogRoot()` (`backlog-root.ts:94`) `path.resolve()` + containment check.
  No reads/writes outside `ROOT_DIRECTORY` or `~/.rauf/`.
- **`--all` front door (REQ-SCOPE-04/05):** unchanged mechanism — `handleStatusAll`
  over `listActiveLoops()`. `--all --json` is explicitly human/tooling scope, **not**
  the single-loop agent contract.
- **File home — spec-author call, with a leaning (OTQ-1):** `resolveTarget()` may live in
  the existing `backlog-root.ts` or a new `target-resolution.ts`. Trade-off: co-locating
  in `backlog-root.ts` keeps the sandbox/containment seam in **one** module (it already
  owns `resolveBacklogRoot` at `:94`, which resolution must delegate to) — lower churn,
  higher cohesion of the safety-critical path; a new `target-resolution.ts` isolates the
  context-aware (TTY/machine, cwd-default, enumeration) logic and keeps `backlog-root.ts`
  focused on the pure path join. **Leaning: co-locate in `backlog-root.ts`** since the
  containment check is the load-bearing part and splitting it across two files risks
  drift; forge-3-specs may override with rationale.

### 3.6 The canonical poll supervision recipe — `drive-rauf-loop` rewrite (REQ-PRESCRIBE-01…06, REQ-SKILL-01, Q4)

`drive-rauf-loop/SKILL.md` is rewritten from a reference card into **the one**
prescribed automation recipe (poll, not stream — REQ-PRESCRIBE-01). It becomes the
authoritative, referenceable contract (C-05). The recipe prescribes:

1. **Start backgrounded** — `rauf loop run … --detached` (or harness background), so
   the loop survives and doesn't block the session (REQ-PRESCRIBE-02.1).
2. **Poll the single decision surface** — `rauf status <root> --backlog <dir> --json`
   at the prescribed **default 5s** interval (overridable, ratified 5–10s band —
   REQ-PRESCRIBE-03). **Never** read `iteration-status.json`/`events.ndjson` to
   *decide* (REQ-SUCCESS-01 keystone).
3. **Branch on the four-way decision tree** (REQ-PRESCRIBE-04, REQ-CONTRACT-02):

   | Condition (from one `status --json` poll) | Action |
   |---|---|
   | `loopState ∈ {COMPLETE, IDLE}` **and** nothing pending/in-progress | **Done** → report & stop |
   | `loopState = PAUSED_HUMAN` / `lastSignal = needs_human` / `backlogSummary.needsHuman > 0` | **Needs human** → surface to user (**only** true stop) |
   | `health.stuckWarning` true | **Recoverable stall** → persist-then-escalate ladder ↓ |
   | `loopState ∈ {RUNNING, REVIEWING}`, no stall hint | **Healthy** → keep polling |

4. **Persist-then-escalate recovery playbook** (Q4, REQ-PRESCRIBE-02.4,
   REQ-CONTRACT-04):
   - `health.stuckWarning` on a **single** poll → surface it, **keep polling** (hint,
     not verdict).
   - Only if it **persists across N consecutive polls** (default **3** ≈ 15–30s at the
     5–10s interval) does the agent act: **`resume`** if the loop is paused, else
     re-run with **`--force`** on the next iteration.
   - **`reset`** only for a confirmed-dead lock (`lock.stale && !lock.alive`).
   - `needs_human` is the **only** true stop.

5. **Stream stays optional (REQ-PRESCRIBE-05):** `--ndjson` / `events.ndjson` / the
   `Monitor` push model remain available for **narration and diagnosis**, but agent
   **decisions never depend on the stream**.

The `.codex-plugin/skills/drive-rauf-loop/SKILL.md` mirror is kept in lockstep.
`rauf-loop-driver.md` continues to defer to the skill (verify, likely no edit).

### 3.7 feature-forge deference (REQ-PRESCRIBE-06, REQ-SUCCESS-02, C-05, Q3)

The **rauf-side** deliverable is solely that `drive-rauf-loop` **is** the authoritative
contract. The corresponding edit to feature-forge's `forge-5-loop` /
`runner-contract.md` (making it reference rauf's decision semantics instead of forking
its own `jq` filter) lives in the **feature-forge repo** and is tracked as a
coordinated cross-repo follow-up (PRD Q3). It is **out of scope** for this feature's
backlog; only noted here for traceability.

---

## 4. Data Model

**No new persisted state, no new event type** (PRD §7). One additive in-memory schema
and two additive fields on an existing one.

### 4.1 New: `HealthSchema` (`core/src/schemas.ts`)

```ts
export const HealthSchema = z.object({
  stuckWarning: z.boolean(),
  iterationFresh: z.boolean(),
  lastActivityAt: z.string(),
  secondsSinceActivity: z.number().nonnegative(),
});
export type Health = z.infer<typeof HealthSchema>;
```

### 4.2 Amended: `DerivedStatusSchema` (`core/src/schemas.ts:279`)

```ts
export const DerivedStatusSchema = z.object({
  statusSchemaVersion: z.literal("1"),   // NEW — additive
  loopState: LoopStateEnumSchema,
  stateSource: z.enum(["state.json", "log-parsing", "none"]),
  // …all existing fields unchanged…
  lock: LockSummarySchema.optional(),
  sleepUntil: z.string().nullable().optional(),
  health: HealthSchema.nullable(),        // NEW — additive; null when no live iteration
});
```

- **`BacklogSummary` unchanged (REQ-CONTRACT-06):** `blocked` remains the **total**;
  `needsHuman` and `deferred` remain **disjoint actionable subsets**. No change.
- **`IterationStatus` unchanged (C-04):** read-only source for `health`.

---

## 5. API Design

CLI surface — no new verbs (C-03). Flags added:

| Command | Added / changed | Semantics |
|---------|-----------------|-----------|
| `follow [root]` | **`--verbose`** (new) | Default now item-level feed + sticky header; `--verbose` restores full firehose. `--json` unchanged (all events). `[root]` now optional on TTY (cwd default). |
| `status [root]` | `[root]` now optional on TTY | cwd default; ambiguous → pick list (TTY) or hard error (machine ctx). Bare `status` broadens to `--all` when no local live loop. |
| `status --json` | **`statusSchemaVersion` + `health`** in output | Additive superset; single poll answers all four agent decisions (REQ-CONTRACT-01/02). |

**Machine-surface contract (the agent's single surface):** `rauf status <root>
--backlog <dir> --json` → a `DerivedStatus` object that is a **complete superset** of
`state.json` + `iteration-status.json` for decision-making (REQ-CONTRACT-01,
REQ-SUCCESS-01). No agent decision requires a raw file.

---

## 6. Integration Points

Verified from source (file:line). Signatures confirmed against the researched code.

| # | Existing surface | Location | How this feature integrates |
|---|------------------|----------|------------------------------|
| 1 | `deriveStatus(paths): Result<DerivedStatus>` | `core/src/status.ts:365` | Stamp `statusSchemaVersion`; populate `health` from `IterationStatus`. Today `iteration-status.json` is read **only conditionally** inside `isLoopLive` (`status.ts:143–158`), not on the healthy path — so promote a **single shared `readIterationStatus`** call into `deriveStatus`/`deriveFromStateJson` and feed both the freshness check and `health` from it. |
| 2 | `isLoopLive` / `ITERATION_STATUS_FRESH_MS` | `status.ts:143`, `:36` (sole call site `:179`) | Reuse the same 60s constant for `iterationFresh`; replace `isLoopLive`'s conditional read with the promoted shared read so the total stays **≤1 `readIterationStatus` per `deriveStatus`** (REQ-PERF-01), no subprocess. |
| 3 | `DerivedStatusSchema` / `BacklogSummarySchema` | `schemas.ts:279`, `:249` | Add `health` + `statusSchemaVersion`; `BacklogSummary` untouched (REQ-CONTRACT-06). |
| 4 | `IterationStatusSchema` | `schemas.ts:710` | Read-only source of `stuckWarning`, `lastActivityAt`, `updatedAt`. |
| 5 | `LoopEventSchema` (24 types) | `schemas.ts:591` | `eventAltitude()` exhaustively classifies all 24 types (exhaustiveness enforced by a `never` check). |
| 6 | `readEvents` / `watchEvents` | `events-log.ts:86`, `:174` | Reused unchanged by the item-level `follow` feed (REQ-CMD-05). |
| 7 | `formatEvent(ev): string` | `cli/src/event-format.ts:43` | Reused for rendering the events that pass the item-level filter; new sticky-header renderer added alongside. |
| 8 | `listActiveLoops()` / `ActiveLoopEntry` | `loop-registry.ts:129`; `ActiveLoopEntrySchema` `schemas.ts:656`, `type ActiveLoopEntry` `schemas.ts:757` | Backs TTY enumeration in `resolveTarget()` and the `--all` front door. |
| 9 | `resolveBacklogRoot()` | `core/src/backlog-root.ts:94` | `resolveTarget()` delegates the final path join + sandbox containment to it (REQ-SAFE-01). |
| 10 | `handleStatus` / `handleStatusAll` / `handleStatusFollow` / `handleFollow` | `status-commands.ts:44` / `:225` / `:439`; `follow-command.ts:52` | Delegate target resolution to `resolveTarget()`; apply `eventAltitude` filter + header in `follow`. |
| 11 | `outputJson` | `cli/src/formatter.ts:113` | Unchanged — passes the enriched `DerivedStatus` through as-is; the version marker rides along in the object. |
| 12 | `detectColorSupport()` | `cli/src/formatter.ts:33` | Reused for A11Y-safe header degradation (REQ-A11Y-01). |

**Packages that import from this feature's new exports:**
`cli` imports `eventAltitude`, `resolveTarget`, `HealthSchema`, `STATUS_SCHEMA_VERSION`
from `core`. **`web` does not** (web parity deferred, Q2). Core → still **zero**
imports from `cli`/`web` (C-01).

**Conflict check:** No other in-progress feature under `specs/` touches `status.ts`,
`follow-command.ts`, `events-log.ts`, or the `drive-rauf-loop` skill. The
`forge/loop-observability` branch is the sole owner. The feature-forge-side
`runner-contract.md` edit (Q3) is a *different repo* — no local conflict.

> **WARNING — verify before implementing:** `resolveTarget()`'s home
> (`backlog-root.ts` vs. a new `target-resolution.ts`) is a spec-author call in
> forge-3-specs (leaning: co-locate — see §3.5); confirm the exact export path when
> writing the numbered spec. The `isLoopLive` helper is currently **private** in
> `status.ts` and reads `iteration-status.json` **only** in the staleness-downgrade
> branch (`:179`), **not** on the healthy path — so `health` population **requires**
> promoting a shared `readIterationStatus` read into `deriveStatus`/`deriveFromStateJson`
> (feeding both freshness and `health`). The refactor **must** keep **≤1
> `readIterationStatus` call per `deriveStatus` invocation** (REQ-PERF-01).

---

## 7. Error Handling

Follows the project convention: core returns `Result<T, E>`, never throws for expected
errors.

- **`resolveTarget()` returns `Result<ResolvedTarget, TargetError>`.** `TargetError`
  variants: `missing_target` (machine context, no path), `ambiguous_target` (machine
  context, several roots — hard fail per REQ-SCOPE-01/SAFE-02), `not_found`,
  `outside_sandbox` (containment failure).
- **CLI rendering of resolution errors:** under `--json` → `outputJson({ error })`
  with exit `USAGE(2)`; else stderr `error()` + `USAGE(2)`. This closes the current
  gap where a missing positional arg has **no** `--json` error path.
- **`health` population is best-effort and non-fatal:** if `iteration-status.json` is
  absent or unparseable, `health` is `null` (not an error) — a missing live-iteration
  signal is a normal state, not a failure. `deriveStatus` never fails solely because
  health couldn't be computed.
- **`eventAltitude()` never throws:** exhaustive over the union with a `never`
  compile-time guard; an unknown runtime type defaults to `"firehose"` (visible under
  `--verbose`, never silently dropped).

---

## 8. Testing Approach

Vitest, colocated `*.test.ts`. Every phase independently green under `pnpm gate`
(REQ-GATE-01). The gate is the single source of truth (`typeCheckCommand`/`gateCommand`
= `pnpm gate` per `forge.config.json`).

- **Phase 1 (`health` + version):**
  - `deriveStatus` returns `health` mirroring a fixture `iteration-status.json`
    (`stuckWarning` both true/false), `null` when the file is absent.
  - `iterationFresh` / `secondsSinceActivity` computed against a fixed clock
    (inject/patch time — no wall-clock flake).
  - `statusSchemaVersion === "1"` present on output.
  - **Additive-compat test:** an existing-shape consumer parse still succeeds
    (REQ-CONTRACT-05, REQ-SUCCESS-05).
  - No extra `readIterationStatus` call vs. baseline (REQ-PERF-01) — assert via a
    read spy/counter.
- **Phase 2 (`resolveTarget` + skill):**
  - Machine context + missing/ambiguous → `Result` error (REQ-SCOPE-01).
  - TTY: cwd default; single active root used; multiple → `ambiguous` candidates.
  - Sandbox containment rejects out-of-root targets (REQ-SAFE-01).
  - The rewritten skill is prose — no unit test, but the decision tree's inputs
    (`loopState`, `health`, `lock`) are all asserted present on `DerivedStatus` so the
    recipe is executable from one poll (REQ-SUCCESS-01).
- **Phase 3 (`eventAltitude` + follow):**
  - Exhaustive table test: every one of the 24 event types maps to the expected
    altitude; adding a future type without classifying fails typecheck.
  - `follow --json` and `follow --verbose` emit **every** event; default emits only
    `item` altitude (REQ-CMD-03).
  - Header string from a fixture `DerivedStatus` (`4/12 done · 1 blocked · on X`).
  - A11Y: non-TTY / `NO_COLOR` path emits label-based, color-free output.
- **Coverage target:** parity with existing `status.ts` / `events-log.ts` suites; new
  pure functions (`eventAltitude`, `resolveTarget`, health derivation) at full branch
  coverage since they're I/O-free and cheap to exhaust.

---

## 9. Dependencies

**No new external packages.** All work uses existing deps: `zod` (schemas), Node
built-ins (`node:fs`, `node:path`, `node:os`), Vitest.

**Internal package graph (unchanged direction):**
`cli` → `core` (+ `loop`); `core` → nothing. The new exports (`eventAltitude`,
`resolveTarget`, `HealthSchema`, `STATUS_SCHEMA_VERSION`) are consumed by `cli` only.
Version constraints: in-repo workspace deps, no version bumps required.

---

## 10. Open Technical Questions

Carried from the PRD, now with a resolution or an explicit forge-3-specs hand-off:

- **Q1 (health encoding)** — **RESOLVED**: nested block, booleans + raw age, `null`
  when inapplicable (§3.1).
- **Q2 (web parity)** — **RESOLVED**: deferred to a follow-up feature; Phase 4 is
  docs-only (§1). The `eventAltitude` core seam keeps the door open.
- **Q3 (forge-5-loop deference)** — **Cross-repo follow-up**: rauf ships the
  authoritative `drive-rauf-loop`; the feature-forge `runner-contract.md` edit lands in
  that repo, sequenced after REQ-SKILL-01 (§3.7). Out of this backlog's scope.
- **Q4 (recovery ladder + persistence threshold)** — **RESOLVED**: persist-then-
  escalate, default **N=3** consecutive polls before escalation; `resume` → `--force`
  → `reset` only on dead lock (§3.6). N is a documented, overridable prescription.
- **OTQ-1 (spec-author call)** — Exact home of `resolveTarget()` (`backlog-root.ts`
  vs. new `target-resolution.ts`; **leaning: co-locate** per §3.5) — to be pinned in
  forge-3-specs. Note the `iteration-status.json` read promotion is **not** open: it is
  a **required** refactor (promote a shared `readIterationStatus` into `deriveStatus`),
  constrained by the **≤1-read-per-poll** invariant (REQ-PERF-01, §3.1, §6 #1/#2 & WARNING).
```