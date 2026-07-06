# Verification Report — loop-observability (tech mode)

- **Feature:** loop-observability
- **Mode:** tech
- **Date:** 2026-07-05
- **Artifacts verified:** `tech-spec.md` (against `PRD.md`; `CANON.md` for context); source verified in `packages/core`, `packages/cli`
- **Checks executed:** 17 of 17 — **12 pass, 4 fail, 1 n/a**
- **Findings:** 4 (2 error, 0 gap, 1 inconsistency, 1 improvement) — **all ✅ RESOLVED 2026-07-05**

## Summary

The tech spec is a faithful, requirement-traced derivation of the PRD: every decision in
§3 carries a `REQ-*` id, all P0 requirements are treated or deferred with rationale, the
data model is additive (REQ-CONTRACT-05/06 honored — `health` + `statusSchemaVersion`
add to `DerivedStatusSchema` and rename/remove nothing), C-01 holds (`eventAltitude` /
`resolveTarget` are pure core functions with no `cli`/`web` import), the 24-type
`LoopEvent` classification is exact, and §10 closes all four PRD open questions
(Q1/Q4 resolved, Q2/Q3 deferred with rationale). Scope is internally consistent (web
docs-only, forge-5-loop cross-repo).

**One load-bearing correctness finding (V-001):** the spec's repeated "zero new I/O"
premise for the `health` block is **false on the common healthy path** —
`deriveStatus` does *not* read `iteration-status.json` when the loop is a fresh
`RUNNING` (the `isLoopLive` read only fires inside the staleness-downgrade branch, and
even then short-circuits on a live lock). The fix is a re-framing, not a redesign: the
real, defensible guarantee is **≤1 `readIterationStatus` read per poll** via a promoted
shared read. The remaining three findings are citation-accuracy fixes and one
alternatives-analysis improvement. **No finding requires a user decision** — all are
corrections to `tech-spec.md` a fresh agent can apply directly.

Verifier confirmations (no finding): additive-only claim holds; C-01 preserved;
`IterationStatusSchema:710` carries `stuckWarning`+`lastActivityAt`+`updatedAt`; §1 phase
table matches PRD §6.

---

## Findings

### V-001 — REQ-PERF-01 "zero new I/O" claim is false on the healthy-loop path

- **Status:** ✅ RESOLVED (2026-07-05) — §1 decision 3, §3.1 (new I/O bullet), §6 #1/#2 & WARNING, §10 OTQ-1 reworded to "≤1 `readIterationStatus` read per poll" via a required shared-read promotion.
- **Severity:** error
- **Location:** `tech-spec.md` §1 (Key decision 3), §3.1 (freshness/source bullet), §6 integration points #1 and #2, §10 OTQ-1
- **Checklist:** CHECK-T05, CHECK-T16
- **What's wrong:** The spec asserts `deriveStatus` "already reads `iteration-status.json`
  (via the private `isLoopLive` helper), so the `health` block adds zero new I/O."
  Verified against `packages/core/src/status.ts`: `isLoopLive` (`status.ts:143`) is
  invoked in exactly one place — `deriveFromStateJson` at `status.ts:179`, and only
  inside the staleness-downgrade branch (`state.status ∈ {running, starting}` **and**
  `updatedAt` older than `STALENESS_THRESHOLD_MS`). `isLoopLive` further short-circuits
  on `checkLock` returning locked-and-not-stale (`status.ts:145–147`), skipping
  `readIterationStatus` even in that branch when a live lock exists. On the normal
  healthy-`RUNNING` path (fresh `updatedAt`), `readIterationStatus` is **never called**.
  Populating `health` unconditionally therefore introduces a **new** read in the common
  case, contradicting the premise that underpins the REQ-PERF-01 argument. §6 WARNING and
  §10 OTQ-1 half-acknowledge a refactor is needed but retain the false "no second read"
  framing.
- **Suggested fix:** Reword §1 decision 3, §3.1, and §6 #1/#2 to state accurately:
  `deriveStatus` does **not** currently read `iteration-status.json` on the healthy path;
  populating `health` requires promoting a single `readIterationStatus(paths)` call into
  `deriveStatus`/`deriveFromStateJson`, replacing the conditional read inside `isLoopLive`
  with a shared one so the invocation count stays **at most one per `deriveStatus`**.
  Restate the REQ-PERF-01 guarantee as **"≤1 `readIterationStatus` read per poll, no
  subprocess"** rather than "zero new I/O." Update §10 OTQ-1 to mark the shared-read
  promotion as **required** (not a spec-author toss-up), constrained by that ≤1 invariant.
- **References:** PRD REQ-PERF-01, C-04; `packages/core/src/status.ts:143–158` (isLoopLive),
  `:179` (sole call site), `:186–197` (healthy return path — no iteration-status read).
  Note: `tech-spec.md` §8 already specifies the correct test ("No extra
  `readIterationStatus` call vs. baseline… assert via a read spy/counter"), which would
  FAIL against the current "zero" framing — a second reason to correct the premise.

### V-002 — Non-existent `handleFollow` in `status-commands.ts`; wrong line for `handleStatusFollow`

- **Status:** ✅ RESOLVED (2026-07-05) — §6 #10 corrected to `handleStatus:44` / `handleStatusAll:225` / `handleStatusFollow:439` / `handleFollow (follow-command.ts:52)`; §3.4 naming note → `:439`.
- **Severity:** error
- **Location:** `tech-spec.md` §6 integration point #10; §2 module table row `cli / src/status-commands.ts`; §3.4 naming note
- **Checklist:** CHECK-T05
- **What's wrong:** §6 #10 cites `handleStatus / handleFollow / handleStatusAll` at
  `status-commands.ts:44,225` and `follow-command.ts:52`. Verified: `handleStatus` is at
  `status-commands.ts:44` and `handleFollow` is at `follow-command.ts:52` (both correct),
  but there is **no `handleFollow` in `status-commands.ts`** — line 225 of that file is
  `handleStatusAll`. Separately, §3.4's naming note cites `status --follow` as
  `handleStatusFollow` at `status-commands.ts:471`; the actual definition is at
  `status-commands.ts:439`.
- **Suggested fix:** In §6 #10 correct the location list to: `handleStatus`
  (`status-commands.ts:44`), `handleStatusAll` (`status-commands.ts:225`),
  `handleStatusFollow` (`status-commands.ts:439`), `handleFollow` (`follow-command.ts:52`).
  In §3.4 change `status-commands.ts:471` → `status-commands.ts:439`.
- **References:** `packages/cli/src/status-commands.ts:44,225,439`;
  `packages/cli/src/follow-command.ts:52`

### V-003 — `ActiveLoopEntry` citation points at the schema, not the type

- **Status:** ✅ RESOLVED (2026-07-05) — §6 #8 now distinguishes `ActiveLoopEntrySchema` (`schemas.ts:656`) from `type ActiveLoopEntry` (`schemas.ts:757`).
- **Severity:** inconsistency
- **Location:** `tech-spec.md` §6 integration point #8 (also §3.5 "candidates from `listActiveLoops()`")
- **Checklist:** CHECK-T05, CHECK-T06
- **What's wrong:** §6 #8 pairs `listActiveLoops()` (`loop-registry.ts:129`, which checks
  out) with `ActiveLoopEntry` at `schemas.ts:656`. But `:656` is
  `ActiveLoopEntrySchema` (the Zod schema); the exported **type** `ActiveLoopEntry` is at
  `schemas.ts:757`. The prose names the type but cites the schema line.
- **Suggested fix:** In §6 #8 distinguish: `ActiveLoopEntrySchema` (`schemas.ts:656`) /
  `type ActiveLoopEntry` (`schemas.ts:757`). No functional change — citation precision so
  forge-3-specs imports the right symbol.
- **References:** `packages/core/src/loop-registry.ts:129`;
  `packages/core/src/schemas.ts:656` (schema), `:757` (type)

### V-004 — Thin alternatives analysis for the deferred `resolveTarget()` home

- **Status:** ✅ RESOLVED (2026-07-05) — §3.5 gained a "File home" bullet weighing `backlog-root.ts` co-location vs. a new `target-resolution.ts`, with a stated leaning (co-locate); §10 OTQ-1 updated to match.
- **Severity:** improvement
- **Location:** `tech-spec.md` §3.5 and §10 OTQ-1
- **Checklist:** CHECK-T09
- **What's wrong:** The spec weighs alternatives well for two decisions (enum-verdict
  rejected in §3.1; presence-based versioning rejected in §3.2). But the decision it
  explicitly leaves open — where `resolveTarget()` lives (`backlog-root.ts` vs. new
  `target-resolution.ts`, OTQ-1) — is handed to forge-3-specs with **no trade-off
  framing**. Deferring the *decision* is fine; deferring it with zero framing gives the
  specs author nothing to decide against.
- **Suggested fix:** Add 1–2 sentences to §3.5 (or OTQ-1) sketching the trade-off:
  co-locating in `backlog-root.ts` keeps sandbox/containment logic in one module (it
  already owns `resolveBacklogRoot` at `:94`) vs. a new `target-resolution.ts` isolates
  the context-aware resolution and keeps `backlog-root.ts` focused. State the leaning so
  forge-3-specs inherits a default, not a coin-flip.
- **References:** `tech-spec.md` §3.5, §10 OTQ-1; `packages/core/src/backlog-root.ts:94`

---

## Fix Execution Plan

All fixes are documentation corrections to `tech-spec.md`; a fresh agent can apply them
with zero prior context. **No user decision required** — V-001's rewording preserves the
design, correcting a false premise, not the approach.

### Step 1 — Correct the REQ-PERF-01 I/O premise (V-001)

- **File:** `specs/loop-observability/tech-spec.md`
- **Checklist:** CHECK-T05, CHECK-T16
- **Action:** In §1 (decision 3), §3.1 (freshness/source bullet), and §6 integration
  points #1 and #2, replace "zero new I/O" / "already reads iteration-status.json via
  isLoopLive" with the accurate framing: `deriveStatus` does **not** read
  `iteration-status.json` on the healthy path; `health` population requires promoting a
  single shared `readIterationStatus` call into `deriveStatus` so the total stays **≤1
  read per poll**. Restate REQ-PERF-01 as "≤1 iteration-status read per poll, no
  subprocess." Update §10 OTQ-1 to mark the shared-read promotion as **required** (not a
  spec-author toss-up), constrained by that ≤1 invariant.
- **Rationale:** Load-bearing correctness fix; the perf argument and the §8 read-spy test
  both depend on the accurate premise.

### Step 2 — Fix stale source line references (V-002, V-003)

- **File:** `specs/loop-observability/tech-spec.md`
- **Checklist:** CHECK-T05, CHECK-T06
- **Action:** §6 #10 → `handleStatus` (`status-commands.ts:44`), `handleStatusAll`
  (`status-commands.ts:225`), `handleStatusFollow` (`status-commands.ts:439`),
  `handleFollow` (`follow-command.ts:52`). §3.4 naming note → `status-commands.ts:439`
  (was `:471`). §6 #8 → distinguish `ActiveLoopEntrySchema` (`schemas.ts:656`) from
  `type ActiveLoopEntry` (`schemas.ts:757`).
- **Rationale:** Citation accuracy so forge-3-specs targets real symbols/lines.

### Step 3 — Add trade-off framing for the deferred `resolveTarget` home (V-004)

- **File:** `specs/loop-observability/tech-spec.md`
- **Checklist:** CHECK-T09
- **Action:** Add 1–2 sentences to §3.5 or OTQ-1 weighing `backlog-root.ts` co-location
  vs. a new `target-resolution.ts`, and state the leaning.
- **Rationale:** Gives forge-3-specs a default rather than an unframed choice.

No inter-finding ordering constraints; the three steps are independent.
