# Verification Report: packaging-docs-ci (tech)
Date: 2026-06-17
Pipeline Stage: forge-3-specs (forge-2-tech complete)
Artifacts Reviewed: PRD.md, tech-spec.md (cross-checked against EPIC.md, epic-manifest.json, the four direct-dependency tech-specs, and the actual on-disk artifacts in both `rauf` and `feature-forge` working trees)

## Summary
- Total findings: 5
- Gaps: 2
- Inconsistencies: 0
- Improvements: 2
- Errors: 1

Verifier tally: executed 17 of 17 tech-mode checks (CHECK-T01..T17): 14 pass, 3 fail/partial, 0 n/a.
Every concrete on-disk claim in tech-spec.md (file paths, command names, flags, version
values, generator constants, config-dir maps) was verified against the actual files in both
working trees — **zero false factual claims** were found (see V-005 for the one cosmetic nit).
The capstone's consumed-contract declarations in §6 match `epic-manifest.json` and EPIC.md verbatim.

## Findings

### V-001: REQ-CONST-04 (P0 constraint) covered in substance but never cited by ID
- **Severity:** gap
- **Location:** tech-spec.md, §3.6 / §6.3 (adapters regen-diff discussion)
- **Issue:** REQ-CONST-04 ("Generated adapters are derived, never hand-edited; the regen-diff gate enforces this") is a P0 constraint. Its substance IS satisfied — §3.6/§6.3 describe the `build-adapters.py --check` drift guard and the DO-NOT-EDIT/generator-only reconciliation of `gemini-extension.json` (REQ-VER-02). But the requirement ID `REQ-CONST-04` is never written anywhere in tech-spec.md, so a strict ID-level traceability sweep (CHECK-T03) shows it as uncovered. REQ-CONST-01/02/03 are all cited explicitly; -04 is the lone omission.
- **Suggested fix:** Add the `REQ-CONST-04` citation to the section that already covers it — e.g. in §3.6 change the regen-diff sentence to "...via `build-adapters.py --check` (REQ-CI-04, REQ-CONST-04)", or add it to the §6.3 heading parenthetical. No new content needed; a citation only.
- **References:** PRD.md §5 REQ-CONST-04, tech-spec.md §3.6, §6.3, §3.5
- **Checklist:** CHECK-T03

### V-002: REQ-CONS-02 charter-deviation record not cited, unlike its siblings
- **Severity:** gap
- **Location:** tech-spec.md, §3.3 (SKILL.md schema, no-version-key)
- **Issue:** The PRD records three charter deviations: REQ-CONS-01 (rauf README keeps loop shape — cited in tech-spec §3.6), REQ-CONS-03 (MIT not Apache — cited in §3.11), and REQ-CONS-02 (versions sync across manifests only, SKILL.md stays version-free). REQ-CONS-02's substance is covered by §3.3 ("No `version` key — REQ-VER-03") but the `REQ-CONS-02` ID itself is never cited, leaving the deviation-record trace incomplete relative to its two siblings.
- **Suggested fix:** In §3.3, append `REQ-CONS-02` to the REQ-VER-03 citation, e.g. "...**No `version` key** — REQ-VER-03 / REQ-CONS-02: versions live in manifests only...". Citation only.
- **References:** PRD.md §5 Charter Deviations REQ-CONS-02, REQ-VER-03; tech-spec.md §3.3, §3.6, §3.11
- **Checklist:** CHECK-T03

### V-003: ruff scope includes sibling-feature scripts that must already pass the rule floor
- **Severity:** improvement
- **Location:** tech-spec.md, §3.4 (ruff over `feature-forge/scripts/*.py`)
- **Issue:** §3.4 points ruff at `scripts/*.py` (4 files). Two of those — `epic-manifest.py` and `validate-traceability.py` — are owned by sibling features (`forge-skill-spec-purity` / forge tooling), not authored by this capstone. Standing up a ruff gate over the glob means those pre-existing scripts must already pass the chosen rule floor (`E`,`F`,`W`, line-length 100) or the gate fails on day one for code this feature didn't write. The spec doesn't flag that the rule floor may need per-file `# noqa` / config carve-outs for pre-existing violations.
- **Suggested fix:** Add a sentence to §3.4 noting that the ruff floor must be validated against ALL four `scripts/*.py` (including the sibling-owned `epic-manifest.py` and `validate-traceability.py`); pre-existing violations are resolved by minimal fixes or scoped `# noqa`, never by weakening the floor below `E`/`F`/`W`. Mirror the existing shellcheck "per-line disable allowed" carve-out.
- **References:** tech-spec.md §3.4, §3.1 (REQ-CI-06 wiring of validate-traceability.py); feature-forge/scripts/{epic-manifest.py,validate-traceability.py}
- **Checklist:** CHECK-T08 (testing/operability), CHECK-T11 (dependency/tooling realism)

### V-004: lint gate must tolerate a not-yet-created `eval/` directory
- **Severity:** improvement
- **Location:** tech-spec.md, §3.4 (ruff over `scripts` and `eval`) vs §3.8 (eval/ is net-new)
- **Issue:** §3.4 says ruff runs over `scripts eval`, but `eval/` is created BY this feature (§3.8). During early backlog items the lint gate will run before `eval/run-eval.py` exists; a ruff invocation naming a missing `eval/` path errors out. The spec doesn't note the ordering hazard or that the gate must no-op gracefully on an absent `eval/`.
- **Suggested fix:** In §3.4, note that the ruff target list must tolerate an absent `eval/` (e.g. glob that matches zero files cleanly, or sequence backlog items so the lint gate lands after `eval/` exists). Flag this as a backlog-ordering constraint for forge-4.
- **References:** tech-spec.md §3.4, §3.8; this becomes a backlog dependency-ordering note for forge-4-backlog
- **Checklist:** CHECK-T08, CHECK-T13 (sequencing/migration realism)

### V-005: "line ~298" approximate citation (constant is exactly at line 298)
- **Severity:** error
- **Location:** tech-spec.md, §3.5 and §6.3 ("`GEMINI_EXTENSION_VERSION` in `scripts/build-adapters.py` (line ~298)")
- **Issue:** The spec hedges the line number as "~298". Verified on disk: the constant `GEMINI_EXTENSION_VERSION` is at **exactly line 298** of `/home/gary/workspace/feature-forge/scripts/build-adapters.py`. Logged primarily as the verification audit trail confirming the claim is accurate; the "~" is a cosmetic imprecision, and line numbers drift as the file changes anyway.
- **Suggested fix:** Optional. Either drop the line number entirely (cite the symbol name `GEMINI_EXTENSION_VERSION`, which is drift-proof) or state "line 298" without the tilde. Recommend citing the symbol name only.
- **References:** tech-spec.md §3.5, §6.3; feature-forge/scripts/build-adapters.py:298
- **Checklist:** CHECK-T05 (factual accuracy of integration claims)

## Fix Execution Plan

### User Decisions Required
None — all five fixes are documentation/citation edits to `tech-spec.md`. No user input needed.

### Execution Steps

Apply these steps in order. Each step is self-contained — a fresh agent can execute it
without prior context beyond this document.

#### Step 1: Add the two missing requirement-ID citations
- **Files:** `specs/agent-agnostic/packaging-docs-ci/tech-spec.md`
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-T03
- **Action:** (a) In §3.6, change the regen-diff reference to cite `REQ-CONST-04` alongside `REQ-CI-04` (or add it to the §6.3 heading parenthetical). (b) In §3.3, append `REQ-CONS-02` to the existing `REQ-VER-03` "No `version` key" citation. These are citation-only edits — no new prose or decisions; the substance is already present.
- **Depends on:** none
- **Rationale:** Both are pure traceability gaps (substance covered, ID uncited); grouping the two citation edits avoids two passes over the same file.

#### Step 2: Add lint-gate operability notes
- **Files:** `specs/agent-agnostic/packaging-docs-ci/tech-spec.md`
- **Addresses:** V-003, V-004
- **Checklist:** CHECK-T08, CHECK-T11, CHECK-T13
- **Action:** In §3.4, add: (a) the ruff floor must be validated against all four `scripts/*.py` including sibling-owned `epic-manifest.py` / `validate-traceability.py`, resolving pre-existing violations via minimal fixes or scoped `# noqa` rather than weakening the floor; (b) the ruff target list must tolerate an absent `eval/` (glob matching zero files cleanly, or sequence the lint backlog item after `eval/` is created) — flag the latter as a forge-4 backlog-ordering constraint.
- **Depends on:** none
- **Rationale:** Both touch §3.4 and concern the same lint gate's real-world operability; applying together keeps the section coherent.

#### Step 3: De-hedge the generator line citation (optional)
- **Files:** `specs/agent-agnostic/packaging-docs-ci/tech-spec.md`
- **Addresses:** V-005
- **Checklist:** CHECK-T05
- **Action:** In §3.5 and §6.3, replace "line ~298" with a reference to the symbol name `GEMINI_EXTENSION_VERSION` only (drift-proof), or state "line 298" without the tilde.
- **Depends on:** none
- **Rationale:** Cosmetic; lowest priority. Safe to apply with Steps 1–2 in one editing pass.

## Fix Progress
- Step 1: [APPLIED] 2026-06-17 — Added REQ-CONST-04 citation to §3.1 regen-diff line + §6.3 heading (V-001); added REQ-CONS-02 citation to §3.3 no-version-key line (V-002).
- Step 2: [APPLIED] 2026-06-17 — Added two §3.4 operability notes: ruff floor must pass against sibling-owned epic-manifest.py/validate-traceability.py (V-003); ruff target must tolerate absent eval/ + flagged as forge-4 ordering constraint (V-004).
- Step 3: [APPLIED] 2026-06-17 — De-hedged "line ~298" to cite the GEMINI_EXTENSION_VERSION symbol name in §3.5 and §6.3 (V-005).
