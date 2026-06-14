# Verification Report: ux-overhaul-web (specs)
Date: 2026-06-14
Pipeline Stage: forge-3-specs complete (verifying spec suite)
Artifacts Reviewed: PRD.md, tech-spec.md, 00–06, TRACEABILITY.md — verified against live source in packages/{core,cli,loop,web}, artifacts/, docs/
Method: 5 parallel forge-verifier instances (dimensions: types/contracts, architecture/layout, cross-reference/traceability, testing-strategy, integration). Deterministic `validate-traceability.py` re-run: valid, 28/28 covered, 0 uncovered, 0 orphaned.

## Summary
- Total findings: 8
- Errors: 2 (doc pointer/label — not code)
- Gaps: 1
- Inconsistencies: 2
- Improvements: 3
- **Integration dimension: 0 findings** — every cited signature/file:line/behavior re-confirmed against source.

Check tallies by dimension: types 8/8 (8 pass), architecture 7/7 (6 pass, 1 fail), cross-ref 9/9 (5 pass, 4 fail), testing 8/8 (7 pass, 1 fail), integration 9/9 (9 pass). ~41 checks executed across the suite.

## Findings

### V-001: `04`'s internal Requirement-Coverage table has frontend `§8.x` pointers off-by-one
- **Severity:** error
- **Location:** 04-web-recovery-routes.md, Requirement Coverage table (lines ~18–28) vs actual §8 subsections (§8.1 result surfacing, §8.2 Reset, §8.3 Resume, §8.4 Review, §8.5 Unblock, §8.6 Validate, §8.7 Applicability)
- **Issue:** The table's frontend pointers are each one subsection too low: REQ-WEB-02→§8.2 (is Reset; resume is §8.3), REQ-WEB-03→§8.3 (is Resume; review §8.4), REQ-WEB-04→§8.4 (is Review; unblock §8.5), REQ-WEB-05→§8.5 (is Unblock; validate §8.6), REQ-OBS-01→§8.5 (findings render is §8.6), REQ-WEB-07→§8.6 (validate; applicability is §8.7). TRACEABILITY.md is correct, so the two tables contradict each other.
- **Suggested fix:** Re-point 04's table to match TRACEABILITY + real numbering: REQ-WEB-01→`§3, §8.1, §8.2`; REQ-WEB-02→`§4, §8.3`; REQ-WEB-03→`§5, §6, §8.4`; REQ-WEB-04→`§7.1, §8.5`; REQ-WEB-05→`§7.2, §8.6`; REQ-OBS-01→`§7.2, §8.6`; REQ-WEB-07→`§8.2, §8.7`.
- **References:** 04 §8.1–§8.7; TRACEABILITY.md rows REQ-WEB-01..05/OBS-01/WEB-07
- **Checklist:** CHECK-S22, CHECK-S21

### V-002: TRACEABILITY decision table mislabels the acquire-and-hold lock model as "D3.1" (it is D3.4)
- **Severity:** error
- **Location:** TRACEABILITY.md, decisions table, last row: "D3.1 acquire-and-hold lock model"
- **Issue:** tech-spec §3 defines D3.1 = resume relocation, D3.4 = concurrency guard (acquire-and-hold). The cited sections (03 §4, 04 §2.3/§3/§4) are correct for acquire-and-hold; only the decision ID is wrong (03/04 themselves tag it D3.4).
- **Suggested fix:** Rename the row to "D3.4 acquire-and-hold lock model" (sections unchanged). Optionally add a distinct D3.1 (relocation) row → 03 §2/§3, 01 §3.
- **References:** tech-spec §3.1 vs §3.4; 03 Requirement-Coverage + §4; 04 §2.3
- **Checklist:** CHECK-S24

### V-003: tech-spec references undefined decisions "(D5)" and "(D7)"
- **Severity:** inconsistency
- **Location:** tech-spec.md §3.1 (line ~67, "(D5)") and §5 (line ~186, "(D7)")
- **Issue:** This tech-spec defines only D3.1–D3.6. D5/D7 appear nowhere — stale labels from a prior numbering scheme. Substance is fine (resume orchestration in §3.1; Result→HTTP in 00 §8.1 / 04 §2.2); only the dangling labels are unresolvable.
- **Suggested fix:** §3.1 "(D5)" → "(D3.1)"; §5 "(D7)" → "(see 00 §8.1 / 04 §2.2)" or drop. Grep the suite for any remaining `D<n>` not of the form `D3.[1-6]`.
- **References:** tech-spec §3 (D3.1–D3.6); 00 §8.1; 04 §2.2
- **Checklist:** CHECK-S24, CHECK-S23

### V-004: `01`'s "file-by-file change map" omits two NEW files the domain docs introduce
- **Severity:** gap
- **Location:** 01-architecture-layout.md §4–§7 (the change map)
- **Issue:** Two new source files specified by domain docs are missing from 01's change map: (1) **`packages/web/src/client/components/StateBadge.tsx`** — the new shared badge component (02 §5.3); 01 §6.4 describes the *replacement* but never names the new file. (2) **`packages/web/src/server/loop-defaults.ts`** — a (conditional) module to hoist loop default constants (`DEFAULT_MAX_RETRIES`, `DEFAULT_SESSION_TIMEOUT_MINUTES`, `resolveRequestMaxIterations`, today `loop.ts:54-87`) so the resume handler in `projects.ts` reuses them without duplication (04). (`recovery-guard.ts` is already named in 01 §6.3 — not a gap; `formatter.ts` is a code-map citation — not a gap.)
- **Suggested fix:** In 01 §6.4 name the new `StateBadge.tsx` (reads `STATE_LABELS` + web-only tone→CSS palette, preserves both call sites via a `size` prop + `RUNNING` animated dot). In 01 §6.1/§6.2 add the conditional `loop-defaults.ts` note. Both stay in `@rauf/web` (no new dep edge).
- **References:** 01 §6.1/§6.2/§6.4; 02 §5.3; 04 relaunch-path note; loop.ts:54-87
- **Checklist:** CHECK-S14, CHECK-S09

### V-005: `mapLoopStateStatus` export — `06` requires it exported, `02` keeps it module-private
- **Severity:** inconsistency  **(USER DECISION — see Fix Plan)**
- **Location:** 06-testing-strategy.md §4.2 vs 02-status-vocabulary.md §3.2/§3.3/§10
- **Issue:** 06 §4.2 mandates `export`ing `mapLoopStateStatus` and imports it directly for the all-12 totality test. 02 §3.2 keeps it `function mapLoopStateStatus(...)` with no `export` (matching source `status.ts:106`). As written, an implementer following 02 produces a private function 06's test can't compile against. This is implementer-note #2 in TRACEABILITY, still unresolved at spec level.
- **Suggested fix (RESOLVED → export it):** Add `export` to `mapLoopStateStatus` in 02 §3.2's NEW block; note in 02 §10 it's exported for the boundary test (matches 06 §4.2 + tech-spec §8). Update TRACEABILITY implementer-note #2 to "RESOLVED: exported." (Alternative was test-via-`deriveStatus`; export is the verifier-recommended default — direct boundary assertion.)
- **References:** 02 §3.2/§10, 06 §4.2, TRACEABILITY implementer-notes #2, status.ts:106
- **Checklist:** CHECK-S35, CHECK-S33

### V-006: `00` §7 says the route body schemas "mirror" `StartLoopBodySchema`, but adds `.strict()` which that precedent lacks
- **Severity:** improvement
- **Location:** 00-core-definitions.md §7 (the four route body Zod schemas)
- **Issue:** The real `StartLoopBodySchema`/`StopLoopBodySchema` (`loop.ts:35-50`) are plain `z.object().optional()` with **no** `.strict()`. The new schemas add `.strict()` (a fine tightening), but the "mirrors the existing pattern" justification is inaccurate.
- **Suggested fix:** Keep `.strict()` but fix the wording: "these schemas add `.strict()` (reject unknown keys) — a deliberate tightening over the non-strict existing `StartLoopBodySchema`."
- **References:** loop.ts:35-50; 00 §7; 06 §3 (400-bad-body cases pass either way)
- **Checklist:** CHECK-S26, CHECK-S37

### V-007: tech-spec route table + OQ-T2 still show the pre-resolution `{itemId, answer}` shape (upstream stage drift)
- **Severity:** improvement
- **Location:** tech-spec.md §3 route table (line ~192) and §10 OQ-T2
- **Issue:** The impl-spec suite uniformly resolves OQ-T2 to `answers: { itemId, text }` (00 §7, 04 §4, 06, TRACEABILITY) matching CLI `AnswerInjection { itemId, text }`. The frozen tech-spec still shows `{itemId, answer}` and frames OQ-T2 as open. Not an intra-suite contradiction (tech-spec legitimately left it open and recommended `text`), but a reader diffing the two sees drift.
- **Suggested fix (optional back-annotation):** tech-spec line 192 → `answers?: { itemId, text }[]`; append to OQ-T2 "Resolved in the impl specs to `{ itemId, text }` (00 §7, 04 §4)." No impl-spec change.
- **References:** tech-spec §3/§10; 00 §7; 04 §4; resume-commands.ts:55
- **Checklist:** CHECK-S12, CHECK-S26

### V-008: `06` §5.1 — "122 lines" is off by one; relocated `recoverInterruptedLoop` cases are described conditionally
- **Severity:** improvement
- **Location:** 06-testing-strategy.md §5.1
- **Issue:** (1) The CLI `recovery.test.ts` is 123 lines, not 122. (2) §5.1 hedges the relocation of `recoverInterruptedLoop`/`reconcileAndRequeue` unit cases as conditional ("if 03 additionally relocates…"), but 03 §2 definitively moves them and 04's resume path depends on `recoverInterruptedLoop` — so the two async cases (clean-tree no-op summary; stalled-in-progress reset to pending) should be required, guaranteeing REQ-WEB-08 (relocation behavior-neutral) has an asserting test in `@rauf/loop`.
- **Suggested fix:** §5.1 "122 lines" → "123 lines"; promote the two `recoverInterruptedLoop` cases from conditional to a required sub-list (mirror `loop-manager.test.ts:282-308` for the reset assertion), keeping the "cross-check 03" caveat.
- **References:** 06 §5.1; 03 §2; 04 resume step 4; recovery.test.ts (123 lines, lock-only today); loop-manager.test.ts:282-308
- **Checklist:** CHECK-S30, CHECK-S33

## Fix Execution Plan

### User Decisions Required
- **V-005 (mapLoopStateStatus export):** RESOLVED → **export it** (verifier-recommended; matches 06 §4.2 + tech-spec §8; direct boundary totality test). Applied in Step 2.

### Execution Steps

#### Step 1: Fix cross-reference pointers & decision labels
- **Files:** specs/ux-overhaul-web/04-web-recovery-routes.md, TRACEABILITY.md, tech-spec.md
- **Addresses:** V-001, V-002, V-003
- **Checklist:** CHECK-S22, CHECK-S24, CHECK-S23
- **Action:** (a) Re-point 04's Requirement-Coverage table §8.x cells per V-001. (b) TRACEABILITY decision row "D3.1 acquire-and-hold" → "D3.4 acquire-and-hold". (c) tech-spec §3.1 "(D5)"→"(D3.1)", §5 "(D7)"→"(see 00 §8.1 / 04 §2.2)"; grep-confirm no other non-`D3.x` decision token remains.
- **Depends on:** none

#### Step 2: Resolve the mapLoopStateStatus export inconsistency
- **Files:** specs/ux-overhaul-web/02-status-vocabulary.md, TRACEABILITY.md
- **Addresses:** V-005
- **Checklist:** CHECK-S35
- **Action:** Add `export` to `mapLoopStateStatus` in 02 §3.2's NEW block; note in 02 §10 it is exported for the 06 §4.2 boundary test. Change TRACEABILITY implementer-note #2 from "must reflect whichever choice" to "RESOLVED: exported (06 §4.2)."
- **Depends on:** none

#### Step 3: Complete 01's change map
- **Files:** specs/ux-overhaul-web/01-architecture-layout.md
- **Addresses:** V-004
- **Checklist:** CHECK-S14, CHECK-S09
- **Action:** In §6.4 name NEW `packages/web/src/client/components/StateBadge.tsx` (reads `STATE_LABELS` + web-only tone→CSS palette per 02 §5.3; preserves both call sites via `size` prop + `RUNNING` animated dot). In §6.1/§6.2 add the conditional `packages/web/src/server/loop-defaults.ts` hoist note (per 04). Both in `@rauf/web`; no new dep edge.
- **Depends on:** none

#### Step 4: Wording/accuracy improvements
- **Files:** specs/ux-overhaul-web/00-core-definitions.md, tech-spec.md, 06-testing-strategy.md
- **Addresses:** V-006, V-007, V-008
- **Checklist:** CHECK-S26, CHECK-S12, CHECK-S30
- **Action:** (a) 00 §7: fix the `.strict()` justification wording (keep `.strict()`). (b) tech-spec line 192 → `{ itemId, text }`; OQ-T2 append the resolution note. (c) 06 §5.1: "122"→"123 lines"; promote the two relocated `recoverInterruptedLoop` cases to required.
- **Depends on:** none
- **Rationale:** Low-severity polish; grouped last, independent of Steps 1–3.

## Fix Progress

- Step 1: [APPLIED] 2026-06-14 — V-001 04 coverage-table §8.x re-pointed (WEB-01→§8.2, 02→§8.3, 03→§8.4, 04→§8.5, 05→§8.6, 06→§8.1, 07→§8.2+§8.7, OBS-01→§8.6); V-002 TRACEABILITY row relabeled D3.4 + added distinct D3.1 (relocation) row; V-003 tech-spec "(D5)"→"(D3.1)", "(D7)"→"(see 00 §8.1 / 04 §2.2)".
- Step 2: [APPLIED] 2026-06-14 — V-005 mapLoopStateStatus marked `export` in 02 §3.2 NEW block (+ export from core index) and §10 item 2 notes the export; TRACEABILITY implementer-note #2 → "RESOLVED → exported".
- Step 3: [APPLIED] 2026-06-14 — V-004 01 §6.4 names NEW packages/web/src/client/components/StateBadge.tsx (reads STATE_LABELS + web tone→CSS palette, size prop + RUNNING dot, old tables deleted); 01 §6.2 adds conditional NEW packages/web/src/server/loop-defaults.ts hoist note.
- Step 4: [APPLIED] 2026-06-14 — V-006 00 §7 .strict() wording fixed (deliberate tightening over non-strict StartLoopBodySchema); V-007 tech-spec route table answers→{itemId,text} + OQ-T2 resolution note appended; V-008 06 §5.1 "122"→"123 lines" + the two recoverInterruptedLoop cases promoted from conditional to required.
