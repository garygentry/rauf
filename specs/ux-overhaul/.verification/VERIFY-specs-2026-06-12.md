# Verification Report: ux-overhaul (specs)
Date: 2026-06-12
Pipeline Stage: forge-verify-specs (forge-3-specs complete, v1, commit d7e2502)
Artifacts Reviewed:
- specs/ux-overhaul/PRD.md
- specs/ux-overhaul/tech-spec.md
- specs/ux-overhaul/00-core-definitions.md
- specs/ux-overhaul/01-architecture-layout.md
- specs/ux-overhaul/02-event-log.md
- specs/ux-overhaul/03-active-loop-registry.md
- specs/ux-overhaul/04-cli-monitoring-surface.md
- specs/ux-overhaul/05-web-observation-parity.md
- specs/ux-overhaul/06-agent-commit-rule.md
- specs/ux-overhaul/07-testing-strategy.md
- specs/ux-overhaul/TRACEABILITY.md
- (cross-checked against repo source: packages/core/src/{schemas,errors,lock,fs-utils,config,backlog-root,status}.ts, packages/loop/src/{runner,git-commit,prompt-builder}.ts, packages/web/src/server/routes/loop.ts, packages/cli/src/parser.ts)

## Method
Verified via 5 parallel `forge-verifier` instances (disjoint dimension slices) covering all 38 specs-mode checks (CHECK-S01–S38), plus the deterministic traceability validator (`validate-traceability.py`).

**Deterministic traceability result:** 38 requirements, 8 spec files, **0 uncovered requirements, 0 orphaned references.** Every REQ-XXX-NN appears in ≥1 spec.

Per-dimension check tallies:
- Type system & contracts (S09–S13, S32): 6/6 executed — 4 pass, 2 pass-with-findings
- Architecture/layout & tech-spec consistency (S05–S08): 4/4 executed — 2 pass, 2 fail
- Cross-reference & traceability (S01–S04, S14–S17, S38): 9/9 executed — 9 pass (2 polish findings)
- Testing strategy (S33–S37): 5/5 executed — 5 pass, 0 findings
- Integration / errors / edge / non-functional (S18–S31): 14/14 executed — 11 pass, 3 fail

**Total: 38/38 checks executed.**

## Summary
- Total findings: 14
- Gaps: 4 (V-005, V-006, V-011, V-012)
- Inconsistencies: 2 (V-002, V-013)
- Improvements: 6 (V-003, V-004, V-008, V-009, V-010, V-014)
- Errors: 2 (V-001, V-007)

The spec suite is high quality — clean traceability, precise file:line anchors, honest handling of the frontend-no-tests constraint. The two `error`-severity findings are copy-paste/line-citation hazards, not design defects. The most consequential findings are the three integration gaps/inconsistencies (V-011, V-012, V-013), which concern failure-mode behavior on the new concurrency-heavy paths and one of which (V-013) needs a user policy decision.

## Findings

### V-001: `ActiveLoopEntrySchema` code block contains a self-import of `LoopStateStatusSchema`
- **Severity:** error
- **Location:** 00-core-definitions.md §1.2 (lines ~94–96)
- **Issue:** The code block is headed `// packages/core/src/schemas.ts` and adds `ActiveLoopEntrySchema` to that file, but includes `import { LoopStateStatusSchema } from "./schemas.js";`. `LoopStateStatusSchema` is defined in that same file (schemas.ts:167), so this is a self-import — invalid/meaningless in context. A fresh agent copying the block verbatim would write a circular self-import. Contrast §1.1 (`PersistedEventSchema`), which correctly references the in-file `LoopEventSchema` with no import.
- **Suggested fix:** Delete the `import { LoopStateStatusSchema } from "./schemas.js";` line from the §1.2 block; replace with a comment, e.g. `// LoopStateStatusSchema is defined above in this file (schemas.ts:167) — no import needed.` Keep the `status: LoopStateStatusSchema` field reference.
- **References:** schemas.ts:167; 00 §1.1 (correct in-file pattern); 03 §3 (loop-registry.ts correctly imports it cross-module)
- **Checklist:** CHECK-S09, CHECK-S10

### V-002: §4 reused-types table swaps schema/type line numbers relative to the names listed
- **Severity:** inconsistency
- **Location:** 00-core-definitions.md §4 "Reused Types & Locations" table (lines ~260–268)
- **Issue:** Each row names symbols "`Type` / `TypeSchema`" (type first) but lists line numbers schema-first. Verified: `LoopEvent`/`LoopEventSchema → schemas.ts:574/:661` but :574 is the *Schema* and :661 the *type*; `LoopStateStatus`/`LoopStateStatusSchema → :167/:643` but :167 is the schema; `IterationStatus → :618/:664` but :618 is the schema. Line ordering contradicts name ordering in every multi-symbol row, so a reader cross-referencing a symbol lands on the wrong declaration.
- **Suggested fix:** Reorder line numbers to match name order: `LoopEvent`/`LoopEventSchema → schemas.ts:661`/`:574`; `LoopStateStatus`/`LoopStateStatusSchema → :643`/`:167`; `IterationStatus → :664`/`:618`. Leave `LoopState`/`LoopStateSchema → :185` (single-symbol) unchanged.
- **References:** schemas.ts:574/:661/:167/:643/:618/:664
- **Checklist:** CHECK-S10

### V-003: `LOCK_FILENAME` redefined module-private in loop-registry.ts instead of reusing the exported backlog-root.ts constant
- **Severity:** improvement
- **Location:** 03-active-loop-registry.md §3 (line ~147), cross-ref 00 §2.4
- **Issue:** 03 declares `const LOCK_FILENAME = ".loop.lock";` module-private with a comment "matches … backlog-root.ts paths.lock." But `LOCK_FILENAME` is already exported from backlog-root.ts:10. 00 §2.4 even states it is "reused unchanged," directly contradicting 03 re-declaring it. Duplicate constant + drift hazard if the lock filename changes.
- **Suggested fix:** In 03 §3, remove the local `const LOCK_FILENAME` and add `import { LOCK_FILENAME } from "./backlog-root.js";`. Update the comment to drop "matches…" since it now *is* the shared constant. Align 00 §2.4's "reused unchanged" claim.
- **References:** backlog-root.ts:10; 00 §2.4; 03 §3.5
- **Checklist:** CHECK-S12, CHECK-S10

### V-004: Type-import of `ActiveLoopEntry` without the `type` modifier; inconsistent with core convention
- **Severity:** improvement
- **Location:** 03-active-loop-registry.md §3 import block (lines ~134–138)
- **Issue:** The block imports `{ ActiveLoopEntry, ActiveLoopEntrySchema, type LoopStateStatus }`. `ActiveLoopEntry` is a type (`z.infer`, 00 §1.2) but is imported without the `type` modifier, while `LoopStateStatus` (also a type) correctly uses it. Codebase convention is inline `type` for type-only symbols (e.g. status.ts:4/:7). It compiles today (no `verbatimModuleSyntax`/`isolatedModules` in tsconfig), so not an error — but it diverges from convention and would break under stricter transpile. (`ActiveLoopEntrySchema` is used as a value — correctly bare.)
- **Suggested fix:** Change to `import { type ActiveLoopEntry, ActiveLoopEntrySchema, type LoopStateStatus } from "./schemas.js";`. 02 §1.1's `import { PersistedEventSchema, type PersistedEvent }` is already correct — no change there.
- **References:** status.ts:4, status.ts:7; tsconfig.json (no verbatimModuleSyntax); 00 §1.2
- **Checklist:** CHECK-S09, CHECK-S10

### V-005: New core public types/constants are not propagated to `docs/SCHEMAS.md` (the project's canonical types contract)
- **Severity:** gap
- **Location:** 00-core-definitions.md (whole doc); 01-architecture-layout.md §2; no spec step touches docs/SCHEMAS.md
- **Issue:** CLAUDE.md designates `docs/SCHEMAS.md` as "All TypeScript types & JSON schemas" — the canonical contract doc. Phase 1 adds public types (`PersistedEvent`/`PersistedEventSchema`, `ActiveLoopEntry`/`ActiveLoopEntrySchema`), constants (`EVENTS_SCHEMA_VERSION`, `TOKEN_COALESCE_MS`, `EVENTS_LOG_FILENAME`), a new `ErrorCodes` member (`IO_ERROR`), and a new `BacklogPaths` field (`eventsLog`). No spec instructs updating `docs/SCHEMAS.md`, so the canonical contract drifts out of date the moment Phase 1 lands. (01 §3's export-surface list satisfies S32 for the code API; the user-facing schema doc is a separate, unaddressed contract surface.)
- **Suggested fix:** Add an explicit doc-sync step (new subsection in 00 or a row in 01 §2's "Edited files" table) instructing: update `docs/SCHEMAS.md` to add the new types, the three constants, the `IO_ERROR` code, and `BacklogPaths.eventsLog`, with the same JSDoc as 00. Make it an acceptance-criterion line in the events-log/registry backlog items.
- **References:** CLAUDE.md ("docs/SCHEMAS.md"); docs/SCHEMAS.md; 00 §1–§3; 01 §2
- **Checklist:** CHECK-S32, CHECK-S10

### V-006: `TOKEN_COALESCE_MS` and `EVENTS_LOG_FILENAME` are absent from the tech-spec's `schemas.ts` additions list
- **Severity:** gap
- **Location:** tech-spec.md §2 (line ~57, `schemas.ts` row) vs 00-core-definitions.md §2.2/§2.4 and 01-architecture-layout.md §2 (line ~67)
- **Issue:** The impl specs add `TOKEN_COALESCE_MS` (00 §2.2) and `EVENTS_LOG_FILENAME` (00 §2.4) to `schemas.ts`, and 01 §2 lists both. But the tech-spec's authoritative module table lists only `EVENTS_SCHEMA_VERSION`, `PersistedEventSchema`/`PersistedEvent`, `ActiveLoopEntrySchema`/`ActiveLoopEntry`. `TOKEN_COALESCE_MS = 1000` appears only narratively (§3.1) without a module; `EVENTS_LOG_FILENAME` is never mentioned. Additionally, 00 §2.2 hedges placement as "schemas.ts (or events-log.ts)" while 01 §2 firmly says schemas.ts — a second internal wobble.
- **Suggested fix:** Update tech-spec.md §2 `schemas.ts` row to include `TOKEN_COALESCE_MS` and `EVENTS_LOG_FILENAME`. Resolve 00 §2.2's placement hedge to firmly `schemas.ts`, matching 01 §2.
- **References:** tech-spec.md §2/§3.1; 00 §2.2/§2.4/§4; 01 §2/§3
- **Checklist:** CHECK-S05, CHECK-S08

### V-007: 00-core-definitions cites the wrong line for `resolveBacklogPaths()`
- **Severity:** error
- **Location:** 00-core-definitions.md §1.3 (line ~149)
- **Issue:** 00 §1.3 says `eventsLog` is "populated in `resolveBacklogPaths()` (`backlog-root.ts:178`)". The function is defined at `backlog-root.ts:126`; line 178 falls inside the returned object literal (the `root:` field; object spans ~175–188, `archive`/`lock` at 186–187). Tech-spec §6.1 correctly cites `:126`. So the impl spec disagrees with both source and tech spec. (The interface citation `:34` in the same section is correct.)
- **Suggested fix:** Change `backlog-root.ts:178` to `backlog-root.ts:126`, noting the field is inserted in the returned `BacklogPaths` object literal (lines ~175–188, alongside `archive`/`lock` at 186–187).
- **References:** backlog-root.ts:126 (fn), :175–188 (return); tech-spec.md §6.1; 00 §1.1 (correct `:34`)
- **Checklist:** CHECK-S06, CHECK-S08

### V-008: Runner `persistEvent` wraps `appendEvent` in a `try/catch`, but `appendEvent` returns `Result<void>` and never throws
- **Severity:** improvement
- **Location:** tech-spec.md §3.1 (lines ~140–144) and 02-event-log.md §5.2 (the `persistEvent` block) — identical in both
- **Issue:** Both show `try { appendEvent(this.paths, record); } catch { /* best-effort */ }`. Per CLAUDE.md convention and 02 §1 / tech-spec §3.3, `appendEvent` returns `Result<void>` (its internal `appendLine` catches fs errors; `validatePath` returns err). The `try/catch` guards an exception path that doesn't exist; the actual error channel (a returned `err`) is silently discarded. Behavior (best-effort, silent) is correct and consistent across both docs — so NOT a contradiction — but the illustrative code models error handling that doesn't match the function's contract and may be copied verbatim.
- **Suggested fix:** In both docs change the snippet to discard the Result explicitly, e.g. `void appendEvent(this.paths, record); // Result<void>; err intentionally ignored (best-effort, REQ-PERF-01/REL-02)`. Keep the two snippets byte-identical.
- **References:** tech-spec.md §3.1/§3.3; 02 §5.2; CLAUDE.md (Result types, never throw)
- **Checklist:** CHECK-S08

### V-009: TRACEABILITY.md SC-1 verification row omits the CLI half of the headline criterion
- **Severity:** improvement
- **Location:** TRACEABILITY.md, "Success-Criteria → verification map" table, SC-1 row (line ~110)
- **Issue:** SC-1 spans CLI **and** web per PRD §8 (`rauf status`, `rauf follow`, and the web status page), but the SC-1 verification row points only at `07 §5 (API boundary) + §6 (manual web check); 05 §8`. The CLI-side automated coverage (07 §3.2/§4 and 04's own Verification section) is not cited even though it exists, so the matrix under-counts SC-1. (The requirement-level REQ-OBS-03 rows correctly cite `04 §2,§5 / 05 §1,§3` — only the SC roll-up is thin.)
- **Suggested fix:** Expand the SC-1 "Verified in" cell to include CLI references, e.g. `07 §3.2/§4/§5 (API boundary) + §6 (manual CLI+web); 04 §Verification (REQ-OBS-03); 05 §8`. Matrix-only edit; no spec-body change.
- **References:** PRD.md §8 SC-1; TRACEABILITY.md line ~110; 04 §Verification; 07 §3.2/§4/§5/§6
- **Checklist:** CHECK-S38, CHECK-S15

### V-010: 04 §6.4 insertion-point line hint ("before return (parser.ts:123)") is off by ~1 from the actual return site
- **Severity:** improvement
- **Location:** 04-cli-monitoring-surface.md §6.4 (the `-f`→`--follow` normalization snippet comment)
- **Issue:** The actual `return {` in parser.ts is at line ~124, and the flags map is fully built by ~110 (arg loop ends ~109); lines 111–123 are positional/command splitting. The "before return (parser.ts:123)" anchor is slightly imprecise — a fresh agent could place the snippet after the positional-split block rather than right after flag parsing. All other parser.ts citations in §6.4 are exact (`--json` :54, short-flag store :99-104, extractNumberFlag :158).
- **Suggested fix:** Reword to a structural anchor, e.g. `// packages/cli/src/parser.ts — immediately before the final return { command, … } (the flags map is complete once the arg loop exits)`. Note the normalization only touches `flags`. Leave the code unchanged.
- **References:** 04 §6.4; parser.ts (arg loop ends ~109, `return {` ~124)
- **Checklist:** CHECK-S14, CHECK-S17

### V-011: New file-backed `/loop/events` handler does not specify `?backlog=` resolution-failure behavior or how `BacklogPaths` is obtained
- **Severity:** gap
- **Location:** 05-web-observation-parity.md §4.1 (and tech-spec §6.3)
- **Issue:** The spec's replacement SSE code comments "paths: BacklogPaths resolved from projectPath (+ optional ?backlog), as the existing handler already does." But the actual handler (routes/loop.ts:257–262) resolves only a `resolvedBacklogRoot` **string** via `resolveBacklogRoot(...)`, and on failure (`!rootResult.ok`) silently leaves it undefined and proceeds against the default root. It never builds a `BacklogPaths`. The new handler must call `readEvents(paths)`/`watchEvents(paths)`, which need a full `BacklogPaths` — so impl must add a `resolveBacklogPaths(...)` step that doesn't exist today and decide behavior when (a) `?backlog=` resolution fails and (b) `resolveBacklogPaths` errors (no backlog.json). Neither is specified. As written, an implementer could replicate the silent-default-root fallthrough, making a `?backlog=specs/x` request silently tail the **wrong** root's `events.ndjson` — re-introducing the cross-root "wrong place" footgun (PRD §3.4 REQ-DISC-01/02) on the web read path.
- **Suggested fix:** In 05 §4.1 add an explicit "resolve paths" step: `resolveBacklogRoot(projectPath, backlogParam)`; on err, return an SSE error event or fall back to default with the inspected root surfaced (mirror REQ-DISC-01 empty-is-never-silent); then `resolveBacklogPaths(projectPath, resolvedRoot ?? projectPath)` and, on its err, send an empty/heartbeat-only stream rather than crashing. Clarify that `readEvents` of a resolved-but-fileless root returns `ok([])` (graceful absence), but a *resolution* failure is distinct and must not silently retarget the default root. Correct the misleading "already produces BacklogPaths" comment.
- **References:** routes/loop.ts:257–262; backlog-root.ts:126 (`resolveBacklogPaths`); 02 §3.2 (absence→ok([])); PRD §3.4 REQ-DISC-01/02
- **Checklist:** CHECK-S28, CHECK-S25, CHECK-S24

### V-012: `listActiveLoops` self-heal can prune a *live* loop's entry (reader-vs-live-loop race) — invisibility window unanalyzed
- **Severity:** gap
- **Location:** 03-active-loop-registry.md §3.4, §3.5, §8
- **Issue:** §8 argues concurrency-safety rests on "disjoint write targets" (each loop owns its `<hash>.json`). But `listActiveLoops` (a reader, run by any `status --all` caller) **unlinks** other loops' entry files during reconciliation (§3.5 step 4) — i.e. a reader is a writer to other loops' files. The `lockStatus.value.pid === entry.pid` guard handles pid-mismatch, but there is no analysis of the window where a loop is *legitimately alive* yet a reader unlinks its entry because `.loop.lock` was momentarily absent/being-rewritten (e.g. between a reset and re-acquire). §8's "the per-root `.loop.lock` already serializes loops" covers two *runners*, not runner-vs-reader. If a reader prunes a live loop's entry, the loop keeps running but is invisible to cross-root discovery until its next status transition re-writes the entry — silently violating REQ-DISC-02 / SC-2 for a live loop.
- **Suggested fix:** Add a §8 subsection analyzing the reader-prune-vs-live-loop window and state the chosen guarantee. Options: (a) only prune when `checkLockFile` returns `locked:false` OR (`stale:true` AND entry `startedAt` older than a small grace threshold); or (b) have the runner's `updateLoopStatus` (already paired with every `writeState`, §5.3) self-re-register, bounding invisibility to "until next status transition," and state that the runner registers only *after* `acquireLock` succeeds so the lock is always present whenever the entry exists. Specify which.
- **References:** 03 §3.5/§5.3/§8; lock.ts:131 (`acquireLock`); PRD REQ-DISC-02/04, SC-2
- **Checklist:** CHECK-S27, CHECK-S21

### V-013: Rotation failure leaves stale prior-run lines that break the seq-monotonicity / never-contradict invariant
- **Severity:** inconsistency
- **Location:** 02-event-log.md §5.3 vs §3.2/§8 (and tech-spec §3.10, decision D4); 00 §1.1 (seq JSDoc)
- **Issue:** §5.3 calls a `rotateEventsLog` failure best-effort/ignored: "leaves the prior run's lines in `events.ndjson` and lets the new run append after them … degraded but non-fatal." But §5.3 also says `this.eventSeq = 0` "always runs regardless of rotation outcome." So after a failed rotation the new run appends `seq:0,1,2…` after the prior run's `seq:0,1,2…`, producing a file with **duplicate, non-monotonic seq** and two `loop_started` records. Per the seq-gap interpretation rule (00 §1.1, tech-spec §3.1), a reader seeing seq go `…,N,0,1,…` interprets the reset as **corruption**; `follow`/web replay (which assumes "append order IS seq order," 02 §3.2) renders the prior run's terminal `loop_completed`/`loop_error` as part of the current run — contradicting REQ-OBS-02 ("the event log never contradicts state.json": state shows `running`, replayed log shows stale `loop_completed`). §5.3 labels this "non-fatal" without acknowledging it breaks the load-bearing invariants asserted elsewhere.
- **Suggested fix (needs user decision — see plan):** Reconcile §5.3 with §3.2/§8/00 §1.1 by choosing a policy: (a) abort the run on rotation failure (conflicts with REQ-PERF-01 "must not block the loop" — likely rejected); (b) **truncate `events.ndjson` to empty on rotation failure** before resetting seq — a fresh-but-unarchived file preserves seq monotonicity and the never-contradict invariant; you lose only the prior run's archive (already best-effort per REQ-EVT-05) — *recommended, smallest change*; or (c) keep appending but document that readers MUST treat a mid-file seq-reset-to-0 as a run boundary (not corruption) and amend 00 §1.1's gap JSDoc and 02 §3.2's "append order IS seq order" claim.
- **References:** 02 §5.3/§3.2/§7.2/§8; 00 §1.1; tech-spec §3.1/§3.10/D4; PRD REQ-OBS-02, REQ-EVT-03/05, REQ-PERF-01
- **Checklist:** CHECK-S21, CHECK-S18, CHECK-S19

### V-014: REQ-OBSV-01 is cited inside 07 but absent from 07's own requirement-coverage table
- **Severity:** improvement
- **Location:** 07-testing-strategy.md — §2.2 ("Corrupt entry skipped") cites `REQ-OBSV-01`, but the requirement-coverage table at the top of 07 does not list REQ-OBSV-01 (also referenced by 00 §3.1)
- **Issue:** REQ-OBSV-01 is substantively covered elsewhere (deterministic validator confirms 38/38; cross-ref verifier confirmed it traces to 03 §3.5/§7), so this is not a coverage gap — but 07's own top-of-document coverage table omits a requirement that 07's body explicitly tests, making the table internally incomplete.
- **Suggested fix:** Add a REQ-OBSV-01 row to 07's requirement-coverage table pointing at §2.2 (corrupt-entry-skipped test) and any other tests that exercise observability/log-integrity behavior, so the table matches the body.
- **References:** 07 §2.2; 00 §3.1; TRACEABILITY.md (REQ-OBSV-01 coverage)
- **Checklist:** CHECK-S38

## Fix Execution Plan

### User Decisions Required
- **V-013 (rotation-failure policy): RESOLVED by user 2026-06-12 → TRUNCATE-ON-FAIL (option b).** On rotation failure, truncate `events.ndjson` to empty before resetting seq, so seq monotonicity and the never-contradict invariant are preserved; the prior run's archive is lost (acceptable — already best-effort per REQ-EVT-05). Step 11 must implement this option; do NOT implement abort or document-run-boundary.

All other fixes can be applied directly.

### Execution Steps

Apply in order. Each step is self-contained.

#### Step 1: Fix the self-import and §4 line-number ordering in 00-core-definitions.md
- **Files:** specs/ux-overhaul/00-core-definitions.md
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-S09, CHECK-S10
- **Action:** (a) §1.2 — delete `import { LoopStateStatusSchema } from "./schemas.js";` and replace with a comment noting it is defined in-file at schemas.ts:167 (no import), mirroring §1.1. (b) §4 table — reorder line numbers to match name order: `LoopEvent`/`LoopEventSchema → schemas.ts:661`/`:574`; `LoopStateStatus`/`LoopStateStatusSchema → :643`/`:167`; `IterationStatus → :664`/`:618`. Leave `LoopState`/`LoopStateSchema → :185` unchanged.
- **Depends on:** none
- **Rationale:** Two localized edits in the foundation doc; one pass.

#### Step 2: Reuse exported `LOCK_FILENAME` and fix the type-import modifier in 03
- **Files:** specs/ux-overhaul/03-active-loop-registry.md
- **Addresses:** V-003, V-004
- **Checklist:** CHECK-S12, CHECK-S10, CHECK-S09
- **Action:** (a) §3 — remove `const LOCK_FILENAME = ".loop.lock";`, add `import { LOCK_FILENAME } from "./backlog-root.js";`, update the comment. (b) Same import block — change `import { ActiveLoopEntry, ActiveLoopEntrySchema, type LoopStateStatus }` to `import { type ActiveLoopEntry, ActiveLoopEntrySchema, type LoopStateStatus }`. Align 00 §2.4's "reused unchanged" claim if needed.
- **Depends on:** none
- **Rationale:** Both edits touch the same import region; grouping avoids conflicting edits.

#### Step 3: Reconcile constants list and placement (tech-spec ↔ 00)
- **Files:** specs/ux-overhaul/tech-spec.md, specs/ux-overhaul/00-core-definitions.md
- **Addresses:** V-006
- **Checklist:** CHECK-S05, CHECK-S08
- **Action:** tech-spec §2 `schemas.ts` row — add `TOKEN_COALESCE_MS` and `EVENTS_LOG_FILENAME`. 00 §2.2 — drop the "(or events-log.ts)" placement hedge so it firmly reads `schemas.ts`, matching 01 §2.
- **Depends on:** none

#### Step 4: Fix the resolveBacklogPaths line citation
- **Files:** specs/ux-overhaul/00-core-definitions.md
- **Addresses:** V-007
- **Checklist:** CHECK-S06, CHECK-S08
- **Action:** §1.3 — replace `backlog-root.ts:178` with `backlog-root.ts:126`, noting the field is inserted in the returned object literal (lines ~175–188, near `archive`/`lock` at 186–187).
- **Depends on:** none

#### Step 5: Add a `docs/SCHEMAS.md` sync instruction to the spec suite
- **Files:** specs/ux-overhaul/01-architecture-layout.md (extend §2 "Edited files" table); optionally specs/ux-overhaul/00-core-definitions.md
- **Addresses:** V-005
- **Checklist:** CHECK-S32, CHECK-S10
- **Action:** Add a row to 01 §2's "Edited files" table: `docs/SCHEMAS.md | document new public types (PersistedEvent[Schema], ActiveLoopEntry[Schema]), constants (EVENTS_SCHEMA_VERSION, TOKEN_COALESCE_MS, EVENTS_LOG_FILENAME), the IO_ERROR error code, and the BacklogPaths.eventsLog field | 00`. Note it should become an acceptance-criterion line in the corresponding backlog items.
- **Depends on:** none

#### Step 6: Correct the best-effort persist snippet in both docs
- **Files:** specs/ux-overhaul/tech-spec.md, specs/ux-overhaul/02-event-log.md
- **Addresses:** V-008
- **Checklist:** CHECK-S08
- **Action:** In both `persistEvent` snippets replace `try { appendEvent(...); } catch {}` with `void appendEvent(...);` plus a comment that the returned `err` is intentionally ignored (best-effort, REQ-PERF-01/REL-02). Keep the two snippets byte-identical.
- **Depends on:** none

#### Step 7: Broaden the SC-1 traceability row and add the REQ-OBSV-01 coverage row
- **Files:** specs/ux-overhaul/TRACEABILITY.md, specs/ux-overhaul/07-testing-strategy.md
- **Addresses:** V-009, V-014
- **Checklist:** CHECK-S38, CHECK-S15
- **Action:** (a) TRACEABILITY.md SC-1 "Verified in" cell — expand to `07 §3.2/§4/§5 + §6 (manual CLI+web); 04 §Verification (REQ-OBS-03); 05 §8`. (b) 07 requirement-coverage table — add a REQ-OBSV-01 row pointing at §2.2 (corrupt-entry-skipped) and any other observability/log-integrity tests.
- **Depends on:** none

#### Step 8: De-anchor the parser.ts normalization insertion hint
- **Files:** specs/ux-overhaul/04-cli-monitoring-surface.md
- **Addresses:** V-010
- **Checklist:** CHECK-S14, CHECK-S17
- **Action:** §6.4 — replace `// … before return (parser.ts:123)` with a structural anchor: "immediately before the final `return { command, … }`; the flags map is complete once the arg loop exits." Leave the normalization code unchanged.
- **Depends on:** none

#### Step 9: Specify `/loop/events` path-resolution + failure behavior
- **Files:** specs/ux-overhaul/05-web-observation-parity.md (§4.1)
- **Addresses:** V-011
- **Checklist:** CHECK-S28, CHECK-S25, CHECK-S24
- **Action:** Insert an explicit "resolve BacklogPaths" step before `readEvents`/`watchEvents`: `resolveBacklogRoot(projectPath, backlogParam)` → on err surface inspected root / SSE error (do NOT silently fall back to default root) → `resolveBacklogPaths(projectPath, resolvedRoot ?? projectPath)` → on err send empty/heartbeat-only stream. Distinguish resolution failure from graceful absence (`readEvents`→`ok([])`). Correct the misleading "already produces BacklogPaths" comment (the current handler resolves only a root string).
- **Depends on:** none

#### Step 10: Add reader-prune-vs-live-loop race analysis to the registry spec
- **Files:** specs/ux-overhaul/03-active-loop-registry.md (§8, cross-ref §3.5/§5.3)
- **Addresses:** V-012
- **Checklist:** CHECK-S27, CHECK-S21
- **Action:** Add a §8 subsection stating the chosen guarantee that a live loop's entry cannot be permanently pruned by a concurrent reader (e.g. `updateLoopStatus` self-heals on next transition, bounding invisibility; entry only exists while lock is held since the runner registers only after `acquireLock`; or prune only on `locked:false`/grace-thresholded stale). Specify which.
- **Depends on:** none

#### Step 11: Resolve the rotation-failure / seq-monotonicity contradiction
- **Files:** specs/ux-overhaul/02-event-log.md (§3.3 `rotateEventsLog` JSDoc, §5.3, §8); possibly 00-core-definitions.md §1.1 if option (c) chosen
- **Addresses:** V-013
- **Checklist:** CHECK-S21, CHECK-S18, CHECK-S19
- **Action:** After the user decision, update §5.3 to either truncate `events.ndjson` on rotation failure (recommended — preserves seq monotonicity + never-contradict invariant) or document the run-boundary reader contract and amend the seq-gap JSDoc (00 §1.1) + the "append order IS seq order" claim (02 §3.2). Keep §8's never-contradict invariant and §7.2's torn-write argument consistent with the chosen policy.
- **Depends on:** User decision in "User Decisions Required"

## Fix Progress

- Step 1: [APPLIED] 2026-06-12 — 00 §1.2 self-import removed (V-001); §4 table line numbers reordered to match name order (V-002).
- Step 2: [APPLIED] 2026-06-12 — 03 §3 now imports LOCK_FILENAME from backlog-root.js, local const removed (V-003); ActiveLoopEntry import given `type` modifier (V-004).
- Step 3: [APPLIED] 2026-06-12 — tech-spec §2 schemas.ts row adds TOKEN_COALESCE_MS + EVENTS_LOG_FILENAME; 00 §2.2 placement hedge dropped to firmly schemas.ts (V-006).
- Step 4: [APPLIED] 2026-06-12 — 00 §1.3 resolveBacklogPaths citation fixed :178 → :126 with object-literal note (V-007).
- Step 5: [APPLIED] 2026-06-12 — 01 §2 Edited-files table gains a docs/SCHEMAS.md sync row (V-005).
- Step 6: [APPLIED] 2026-06-12 — persistEvent snippet in tech-spec §3.1 + 02 §5.2 changed to `void appendEvent(...)`; all "best-effort try/catch" prose updated to "Result-discarding" (V-008).
- Step 7: [APPLIED] 2026-06-12 — TRACEABILITY SC-1 row broadened with CLI coverage (V-009); 07 coverage table gains a REQ-OBSV-01 row (V-014).
- Step 8: [APPLIED] 2026-06-12 — 04 §6.4 parser insertion hint de-anchored from parser.ts:123 to structural anchor (V-010).
- Step 9: [APPLIED] 2026-06-12 — 05 §4.1 adds explicit BacklogPaths resolution step (resolveBacklogRoot → resolveBacklogPaths), hardened against silent default-root fall-through; replay/tail guarded on resolved paths; "retained verbatim" note corrected (V-011).
- Step 10: [APPLIED] 2026-06-12 — 03 §8.1 added: reader-vs-live-loop prune race analysis with lock-gated entry lifetime + self-re-registration guarantee (V-012).
- Step 11: [APPLIED] 2026-06-12 — TRUNCATE-ON-FAIL policy (user decision): rotateEventsLog truncates events.ndjson on rename failure (02 §3.3 impl + JSDoc, §5.3 prose, §8 error table, verification checkbox); tech-spec D4 annotated (V-013).
