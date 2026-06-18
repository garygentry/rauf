# Verification Report: packaging-docs-ci (backlog) — CONFIRMATION re-verify
Date: 2026-06-17 (re-verify after forge-fix of VERIFY-backlog-2026-06-17.md)
Pipeline Stage: forge-5-loop
Artifacts Reviewed: backlog.json (16 items), PRD.md, tech-spec.md, 00–07 numbered specs, TRACEABILITY.md

Verification method: 4 parallel `forge-verifier` instances (schema/enum, spec-coverage,
dependency/ordering, scoping/completeness) re-run after the fix pass, plus two deterministic
validators:
- `rauf-stable backlog validate` → `{"valid": true, "findings": []}` (PASS, unchanged)
- `validate-traceability.py` → 39 requirements, **0 uncovered**, 2 orphaned references
  (`REQ-FM-01`, `REQ-VND-01`) — the known-benign forge-skill-spec-purity IDs carried in
  item 001 `notes`. **Not a finding.**

Check tally: 25 of 25 backlog checks executed — 24 pass, 1 pass-with-improvement, 0 fail.

## Prior findings (VERIFY-backlog-2026-06-17.md) — all CONFIRMED RESOLVED
- **V-001 (gap, pytest CI gate): RESOLVED.** spec 02 §3.2 composite now runs `python3 -m pip
  install pytest` (with rationale comment); item 005 description says "ruff AND pytest" and a
  6th AC asserts the composite installs pytest so `validate.sh` step 7's anti-drift test is a
  HARD CI gate. spec 02 §3.2 ↔ item 005 ("copy §3.2 EXACTLY") now internally consistent.
- **V-002 (improvement, REQ-CI-04 transitive): RESOLVED.** item 005 notes now make the step-6b
  regen-diff coverage explicit and accurate against spec 02 §4.4.
- **V-003 (improvement, item 002 ruff coupling): RESOLVED.** item 002 `dependsOn: ["003"]`;
  re-checked — no cycle (003 is dep-free), no priority inversion (both P1).
- **V-004 (improvement, item 015 CHANGELOG ordering): RESOLVED (with a residual, V-001 below).**
  item 015 `dependsOn` now lists 8 deliverable-producing items; full topological sort over the
  edited 16-node graph is acyclic, no inversion (015 is P2; deps are P1 or equal-P2).

## Summary
- Total findings: 1
- Gaps: 0
- Inconsistencies: 0
- Improvements: 1
- Errors: 0

## Findings

### V-001: Item 015 CHANGELOG enumerates deliverables of items 007/008/011 that its `dependsOn` neither declares nor transitively reaches
- **Severity:** improvement
- **Location:** backlog.json item 015 (`dependsOn`); cross-ref spec 06 §4.1 (feature-forge CHANGELOG Added/Changed) + §4.2 (rauf CHANGELOG)
- **Issue:** The V-004 fix set item 015 `dependsOn: ["005","006","009","010","012","013","014","016"]`. The CHANGELOG content item 015 authors enumerates deliverables of additional items: 001 (schema), 003 (lint gates), 007 (eval harness `run-eval.py`), 008 (`eval.yml` advisory trigger-accuracy), and 011 (rauf README cross-agent Changed bullet). Of these, **001 and 003 are already transitively ordered before 015** (015→005→{001,003}), so they need no explicit edge — but **007, 008, and 011 are NOT reachable** from 015's dependency closure (008→007 is unrelated to 015; 011 has no dependents). Per item 015's own stated goal ("authored after its deliverables land"), those three deliverables can still be unlanded when 015 runs. This is **not** a cycle, inversion, or hard ordering defect: both spec 06 §4.1 and item 015's notes explicitly bless partial authoring ("include only the already-landed subsections and append the rest as those items complete"). The escape hatch makes it safe, but leaves the `dependsOn` set internally inconsistent with the item's "authored after the work lands" framing.
- **Suggested fix:** Option (a) — add `007`, `008`, `011` to item 015's `dependsOn` (final: `["005","006","007","008","009","010","011","012","013","014","016"]`); re-checked: none of the three is reachable from 015 so no cycle, and 007/008 are P2 (equal) / 011 is P1 (higher) so no inversion. Makes the dependsOn set fully match the enumerated deliverables. Option (b) — leave `dependsOn` as-is and append a sentence to item 015 `notes` stating 007/008/011 are intentionally relied on via the spec 06 §4.1 partial-authoring contract rather than via `dependsOn`. Option (a) is the smaller, more honest change.
- **References:** backlog.json items 007, 008, 011, 015; spec 06-packaging-versioning-hygiene.md §4.1, §4.2.
- **Checklist:** CHECK-B18

## Clean / N/A checks (no findings)
- **CHECK-B01–B06 (schema/enum): all PASS.** Post-fix backlog parses; 16 items, ids unique/dense; `type` ∈ {feature, chore}; `priority` ∈ {1,2} numeric; `status` uniformly `pending`; both edited `dependsOn` arrays are string arrays referencing real ids. No regression from the edits.
- **CHECK-B07–B10 (spec coverage): all PASS.** All 8 specs referenced; all P0 reqs covered by ≥1 item AC (V-001 pytest gap now closed → REQ-CI-02/REQ-CONST-03 covered by item 005 AC#6); all specReferences resolve; all relative.
- **CHECK-B11–B14, B20–B25 (scoping/completeness): PASS** (B20/B21 N/A — CI-wiring capstone, no greenfield scaffold / no shared error hierarchy). The schema-driven CI gate subsystem is now effective in CI; item 005 stays single-iteration-sized after the AC addition.
- **CHECK-B15–B19 (dependency): PASS** except the B18 improvement above. Whole edited graph is acyclic (Kahn sort consumes all 16 nodes) and free of priority inversions.

## Fix Execution Plan

### User Decisions Required
- **V-001** offers two valid resolutions (broaden `dependsOn` vs. document the partial-authoring reliance in notes). The backlog is already correct and shippable as-is — this is a consistency nicety, not a blocker. Maintainer picks one; default recommendation is option (a). **[RESOLVED 2026-06-17: applied option (a) — added 007/008/011 to item 015 `dependsOn`.]**

### Execution Steps

#### Step 1: Reconcile item 015 `dependsOn` with its enumerated CHANGELOG deliverables (optional)
- **Files:** specs/agent-agnostic/packaging-docs-ci/backlog.json (item 015)
- **Addresses:** V-001
- **Checklist:** CHECK-B18
- **Action:** Option (a) — change item 015 `dependsOn` to `["005","006","007","008","009","010","011","012","013","014","016"]` (adds 007, 008, 011). Verify no cycle (none reachable from 015) and no inversion (007/008 P2 = equal; 011 P1 = higher). OR Option (b) — leave `dependsOn` unchanged and append a `notes` sentence clarifying 007/008/011 are covered by the spec 06 §4.1 partial-authoring contract, not by `dependsOn`.
- **Depends on:** none
- **Rationale:** Aligns the declared dependency set with the item's own "authored after deliverables land" intent without changing graph soundness.

## Fix Progress
- Step 1: [APPLIED] 2026-06-17 — V-001. Option (a): item 015 `dependsOn` broadened to `["005","006","007","008","009","010","011","012","013","014","016"]` (added 007, 008, 011). Re-validated: `rauf-stable backlog validate` → `{"valid": true, "findings": []}`; no cycle (007/008/011 unreachable from 015), no priority inversion (007/008 P2 equal, 011 P1 higher).

All steps applied.
