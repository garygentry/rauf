# Verification Report: ux-overhaul-grammar (prd)
Date: 2026-06-13
Pipeline Stage: forge-2-tech (PRD verification)
Artifacts Reviewed:
- specs/ux-overhaul-grammar/PRD.md (under test)
- specs/ux-overhaul/CANON.md (requirements source of truth)
- specs/ux-overhaul/PRD.md (Phase 1 PRD, for convention/format reference)
- specs/ux-overhaul-grammar/.pipeline-state.json (ratified-decisions notes)

Method: single `forge-verifier` (read-only), full PRD-mode checklist (15 checks). Executed 15/15: 11 pass, 4 fail, 0 n/a.

## Summary
- Total findings: 5
- Gaps: 3 (V-001, V-002, V-003)
- Inconsistencies: 0
- Improvements: 2 (V-004, V-005)
- Errors: 0

Overall: the PRD is sound. Canon coverage (Phase 2 §4.1 + Phase 3 §4.4/§4.5), exit-code-table fidelity (verbatim match to CANON §4.4), scope boundaries (Phase 4 / AGENT_ADDON rename / Part-B out; feature-forge update in via REQ-CONTRACT-04/05), requirements-only discipline, and internal consistency (incl. the revised feature-forge scope) all check out clean. The 5 findings are quality refinements — none blocking.

## Findings

### V-001: Requirements lack Priority designations (project convention)
- **Severity:** gap
- **Location:** PRD.md, section 3 (all REQ-*) and section 4 (all NFR-*)
- **Issue:** No requirement carries a `Priority:` field. The sibling Phase 1 PRD (`specs/ux-overhaul/PRD.md`) tags every REQ and NFR with `Priority: P0/P1/P2`. This project's established PRD convention includes per-requirement priority, so its absence here is a real gap. Downstream backlog ordering and the tech spec lose the must-have vs nice-to-have signal (e.g. REQ-EXEC-04 `--detached --follow` convenience vs REQ-EXIT-01 contract core).
- **Suggested fix:** Add a `Priority: P0|P1|P2` line to each REQ-* and NFR-*, matching the Phase 1 PRD format. Suggested defaults: **P0** for contract/clean-break core (REQ-EXEC-01/02, all REQ-EXIT, REQ-SIG-01, REQ-EVT-01, REQ-RMV-01, all REQ-CONTRACT, REQ-DOC-01, NFR-COMPAT-01/CUTOVER-01/SAFETY-01/QUALITY-01); **P1** for REQ-EXEC-03/05, REQ-FLAG-01..04, REQ-SIG-02, REQ-EVT-02, NFR-PARITY-01/PERF-01; **P2** for REQ-EXEC-04 (`--detached --follow` convenience).
- **References:** specs/ux-overhaul/PRD.md (Priority convention)
- **Checklist:** CHECK-P07

### V-002: REQ-EXEC-04 `--detached --follow` lifecycle is under-specified
- **Severity:** gap
- **Location:** PRD.md, section 3 REQ-EXEC-04 (and §7 Success Criteria, §8 Open Questions)
- **Issue:** REQ-EXEC-04 says `loop run --detached --follow` "must, after detaching, attach the canonical live view," but does not state the load-bearing rule: interrupting the attached follow (Ctrl-C) must **detach the view only**, NOT stop the underlying detached loop (only `loop stop` does that, per REQ-EXEC-05). Without this, the requirement is ambiguous and conceptually collides with REQ-EXEC-05's "foreground `loop run` is stopped by Ctrl-C." §8 declares "None outstanding," but this behavioral resolution is implicit rather than decided.
- **Suggested fix:** Extend REQ-EXEC-04: "Detaching and following compose: the loop continues server-owned; interrupting the attached view (Ctrl-C) detaches the view only and does NOT stop the loop — stopping a detached run requires `loop stop` (REQ-EXEC-05)." Add a matching Success Criteria bullet so it is testable.
- **References:** PRD.md REQ-EXEC-05, §7; CANON.md §4.1 (`--detached --follow` row + mental-model note)
- **Checklist:** CHECK-P04, CHECK-P11

### V-003: Canon §5 Phase-2 "help" surface obligation not represented as a requirement
- **Severity:** gap
- **Location:** PRD.md, section 3 (REQ-RMV / REQ-DOC)
- **Issue:** CANON §5 defines Phase 2 scope as "command grammar & naming — `run --detached`; `--follow` normalization; promote `follow`; `--backlog` discoverability; **help + error remediation**." The PRD covers error remediation (REQ-RMV-01) but has no requirement that the CLI **help/usage text** be updated to the new grammar. REQ-DOC-01 covers only `docs/SPEC-*.md`, not the user-facing `--help` surface. A clean break with stale `--help` listing `loop start`/`--watch` would undercut REQ-RMV-01's "tell me what replaced it" intent.
- **Suggested fix:** Add REQ-DOC-02 (or extend REQ-DOC-01): "CLI help/usage output (top-level and per-command `--help`) must reflect the new grammar — single `loop run [--detached|-d]`, removed `loop start`/`--watch`, canonical `--follow`/`--json`/`--backlog`/`--interval` — with no references to removed verbs/flags except the REQ-RMV-01 remediation messages."
- **References:** CANON.md §5 (Phase 2 row), PRD.md REQ-RMV-01, REQ-DOC-01
- **Checklist:** CHECK-P03, CHECK-P09, CHECK-P14

### V-004: Inconsistent canon-traceability tags across requirements
- **Severity:** improvement
- **Location:** PRD.md, section 3 (REQ-EXEC-02..05, REQ-FLAG-01..04, REQ-EXIT-02/03, REQ-SIG-02, REQ-EVT-02)
- **Issue:** Some requirements carry explicit canon citations (REQ-EXEC-01 `*(CANON §4.1)*`, REQ-EXIT-01 `*(CANON §4.4)*`, REQ-EVT-01 `*(CANON §4.5)*`, REQ-DOC-01 `*(CANON §5)*`) but many that map directly to canon clauses do not — REQ-FLAG-01..04 (§4.1 flag-canon table), REQ-SIG-02/REQ-EVT-02 (§4.5), REQ-EXEC-02..05 (§4.1 execution table). Content matches the canon; the missing tags just weaken traceability for the downstream audit.
- **Suggested fix:** Add `*(CANON §4.1)*` to REQ-EXEC-02..05 and REQ-FLAG-01..04, `*(CANON §4.5)*` to REQ-SIG-02 and REQ-EVT-02, `*(CANON §4.4)*` to REQ-EXIT-02/03. Keep existing "clean break" parentheticals alongside.
- **References:** CANON.md §4.1 (Execution + Flag-canon tables), §4.5
- **Checklist:** CHECK-P12, CHECK-P14

### V-005: "Proposed v0.5.0" qualifier conflicts with the ratified cutover decision
- **Severity:** improvement
- **Location:** PRD.md, §intro scope note, REQ-CONTRACT-01, §8 Open Questions
- **Issue:** The version string "v0.5.0" appears as `proposed`/`[PROPOSED]` in places (§intro, REQ-CONTRACT-01) while the top ratification note item (4) treats it as decided ("cutover = one breaking flip at v0.5.0"). §8 says "None outstanding," so a reader cannot tell whether v0.5.0 is ratified or tentative.
- **Suggested fix:** Drop the "proposed/[PROPOSED]" qualifier where v0.5.0 is the ratified decision (§intro, REQ-CONTRACT-01) to match the ratification note. (Keep CANON.md's own `[PROPOSED]` wording untouched — the canon is amended separately; the PRD records the ratified-for-this-feature decision.)
- **References:** PRD.md top ratification note item (4), REQ-CONTRACT-01; CANON.md §6.3 / §7.4
- **Checklist:** CHECK-P11, CHECK-P15

## Fix Execution Plan

### User Decisions Required
None — all fixes are directly applicable. V-001 supplies suggested priority assignments; V-002/V-003 add clauses consistent with the canon; V-005 has a clear recommended resolution (treat v0.5.0 as ratified). If the priority defaults in V-001 are wrong for any item, adjust at apply time.

### Execution Steps

#### Step 1: Add Priority designations to every requirement
- **Files:** specs/ux-overhaul-grammar/PRD.md
- **Addresses:** V-001
- **Checklist:** CHECK-P07
- **Action:** Add a `- **Priority:** P0|P1|P2` line to each REQ-* (section 3) and NFR-* (section 4), using the defaults listed in V-001 (P0 = contract/clean-break core; P1 = grammar/flag/parity mechanics; P2 = `--detached --follow` convenience). Match the Phase 1 PRD's formatting.
- **Depends on:** none
- **Rationale:** Pure additive metadata; restores the project PRD convention and feeds downstream ordering.

#### Step 2: Specify the `--detached --follow` lifecycle (+ success criterion)
- **Files:** specs/ux-overhaul-grammar/PRD.md
- **Addresses:** V-002
- **Checklist:** CHECK-P04, CHECK-P11
- **Action:** Extend REQ-EXEC-04 with the compose-lifecycle clause (Ctrl-C on the attached view detaches the view only; stopping a detached run requires `loop stop`). Add a Success Criteria (§7) bullet asserting it.
- **Depends on:** none
- **Rationale:** Removes the ambiguity vs REQ-EXEC-05 and makes the behavior testable.

#### Step 3: Add the CLI help/usage update requirement
- **Files:** specs/ux-overhaul-grammar/PRD.md
- **Addresses:** V-003
- **Checklist:** CHECK-P03, CHECK-P09, CHECK-P14
- **Action:** Add REQ-DOC-02 covering top-level and per-command `--help`/usage text reflecting the new grammar, with no stale references to removed verbs/flags (except the REQ-RMV-01 remediation messages). Reference CANON §5 Phase-2 "help".
- **Depends on:** none
- **Rationale:** Closes the canon §5 "help" obligation; complements REQ-RMV-01.

#### Step 4: Normalize canon-traceability tags
- **Files:** specs/ux-overhaul-grammar/PRD.md
- **Addresses:** V-004
- **Checklist:** CHECK-P12, CHECK-P14
- **Action:** Add the missing `*(CANON §…)*` citations to REQ-EXEC-02..05, REQ-FLAG-01..04, REQ-EXIT-02/03, REQ-SIG-02, REQ-EVT-02 as listed in V-004.
- **Depends on:** none
- **Rationale:** Even traceability for the downstream audit; no semantic change.

#### Step 5: Resolve the v0.5.0 "proposed" qualifier
- **Files:** specs/ux-overhaul-grammar/PRD.md
- **Addresses:** V-005
- **Checklist:** CHECK-P11, CHECK-P15
- **Action:** In the §intro scope note and REQ-CONTRACT-01, drop "proposed/[PROPOSED]" so v0.5.0 reads as the ratified cutover version (consistent with the top ratification note). Leave CANON.md untouched.
- **Depends on:** none
- **Rationale:** Eliminates the ratified-vs-tentative ambiguity within the PRD.

## Fix Progress
- Step 1: [APPLIED] 2026-06-13 — V-001: added `*(P0|P1|P2)*` priority tags to all 26 REQ-* and 6 NFR-* (defaults per V-001; P0 contract/clean-break core, P1 mechanics, P2 the --detached --follow convenience).
- Step 2: [APPLIED] 2026-06-13 — V-002: REQ-EXEC-04 extended with the compose-lifecycle clause (Ctrl-C detaches the view only, does NOT stop the loop; loop stop required); added matching §7 success-criteria bullet.
- Step 3: [APPLIED] 2026-06-13 — V-003: added REQ-DOC-02 (CLI --help/usage must reflect new grammar, no stale removed-verb/flag refs except REQ-RMV-01 messages).
- Step 4: [APPLIED] 2026-06-13 — V-004: added `*(CANON §…)*` traceability tags to REQ-EXEC-02..05, REQ-FLAG-01..04, REQ-EXIT-02/03, REQ-SIG-02, REQ-EVT-02.
- Step 5: [APPLIED] 2026-06-13 — V-005: dropped the "proposed" qualifier on v0.5.0 in §intro + REQ-CONTRACT-01 (now ratified); CANON.md's own [PROPOSED] wording left untouched (amended separately).

All 5 findings applied; verify stage → findings-applied.
