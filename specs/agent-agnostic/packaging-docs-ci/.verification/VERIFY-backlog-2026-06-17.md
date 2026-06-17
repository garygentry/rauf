# Verification Report: packaging-docs-ci (backlog)
Date: 2026-06-17
Pipeline Stage: forge-4-backlog complete → forge-verify-backlog
Artifacts Reviewed: backlog.json (16 items), PRD.md, tech-spec.md, 00–07 numbered specs, TRACEABILITY.md

Verification method: 4 parallel `forge-verifier` instances across dimension groups
(schema/enum, spec-coverage/traceability, dependency/ordering, scoping/completeness),
plus two deterministic validators:
- `rauf-stable backlog validate` → `{"valid": true, "findings": []}` (PASS)
- `validate-traceability.py` → 39 requirements, **0 uncovered**, 2 orphaned references
  (`REQ-FM-01`, `REQ-VND-01`) — confirmed to be forge-skill-spec-purity's own REQ IDs
  carried as string literals in `check-spec-purity.py` source (item 001 `notes`), not this
  feature's requirements and not present in any acceptance criteria. **Not a finding.**

Check tally across all dimensions: 25 of 25 backlog checks executed —
22 pass, 1 fail (CHECK-B22), 2 n/a (CHECK-B20 scaffold, justified).

## Summary
- Total findings: 4
- Gaps: 1
- Inconsistencies: 0
- Improvements: 3
- Errors: 0

## Findings

### V-001: No backlog item ensures the CI composite `pip install pytest` — the anti-drift gate silently no-ops in CI
- **Severity:** gap
- **Location:** backlog.json item 005 (description + acceptanceCriteria) and item 001; 07-testing-strategy.md §2.2; 02-ci-blocking-gates.md §3.2 (composite YAML, lines ~189–198)
- **Issue:** Spec 07 §2.2 is emphatic that the anti-drift test (item 001's `test_loaded_keysets_match_schema`) is the capstone's "sole schema↔checker drift guard," that `validate.sh` step 7 **soft-skips non-fatally when pytest is absent**, and therefore "the feature-forge CI composite **MUST `pip install pytest`**" — otherwise the guard silently no-ops on a CI runner. Spec 07's verification checklist repeats this. However, the composite-action YAML in spec 02 §3.2 — which item 005 instructs the agent to reproduce "EXACTLY as in spec 02 §3.2" — installs only `ruff` and the claude CLI; it does **not** install pytest. Consequently item 005's description and acceptance criteria contain no pytest step, and item 001's pytest AC is local-only (`Run from ../feature-forge: python3 -m pytest tests -q passes`). Net effect: no backlog item makes the anti-drift assertion a hard gate in CI, contradicting a load-bearing REQ-CI-02 / REQ-CONST-03 requirement. The "schema-driven CI gate" subsystem ships, but its drift guard is non-effective in CI as written.
- **Suggested fix:** Amend item 005: (a) add `python3 -m pip install pytest` to the composite's tooling-install step (alongside `pip install ruff`); (b) add an acceptance criterion: "The quality-gate composite installs pytest (`pip install pytest`) so validate.sh step 7's anti-drift assertion is a HARD gate in CI (cannot soft-skip), per spec 07 §2.2." Companion spec fix: add the `pip install pytest` line to spec 02 §3.2's composite YAML so the verbatim-copy instruction in item 005 produces a pytest-installing composite.
- **References:** 07-testing-strategy.md §2.2 + Verification checklist; 02-ci-blocking-gates.md §3.2 (composite YAML), step 7 row; backlog items 001, 005.
- **Checklist:** CHECK-B22, CHECK-B24

### V-002: REQ-CI-04 (adapters regen-diff, P0) is covered only transitively — no item's own acceptance criteria names the regen-diff gate
- **Severity:** improvement
- **Location:** backlog.json item 005 (CI composite) acceptanceCriteria; item 012 acceptanceCriteria
- **Issue:** REQ-CI-04 is a P0 gate ("CI MUST regenerate the per-agent adapters from canon and fail if committed `adapters/` differs"). No backlog item's description, notes, or acceptance criteria names REQ-CI-04 by ID, and no item's ACs directly assert "the CI composite runs the regen-diff gate." Coverage is real but indirect, resting on two transitive links: (1) item 005's AC asserts the composite runs `bash scripts/validate.sh`, and per spec 02 §4.4 the regen-diff is `validate.sh` step 6b (a pre-existing gate); (2) item 012's AC asserts `build-adapters.py --check` produces no diff (SC-04). A reader of the backlog alone cannot see that the P0 regen-diff gate is wired into per-PR CI, since item 005's step list does not surface step 6b. Does not fail CHECK-B08 (the requirement IS covered by ACs) but is the weakest coverage link among the P0 reqs.
- **Suggested fix:** Add a clause to item 005's notes (or an AC) making the transitive coverage explicit, e.g.: "The composite's first step `bash scripts/validate.sh` includes the pre-existing step 6b adapters regen-diff gate (`build-adapters.py --check`, spec 02 §4.4) — that is how REQ-CI-04 / REQ-CONST-04 are enforced per-PR; this capstone wires the runner, not the diff mechanism." Documentation only — no behavior change.
- **References:** PRD.md REQ-CI-04 (P0), REQ-CONST-04; 02-ci-blocking-gates.md §4.4 (step 6b) and §3.2 composite; backlog items 005, 012; TRACEABILITY.md.
- **Checklist:** CHECK-B08

### V-003: Item 002's ruff acceptance criterion is not self-verifiable without item 003 (undeclared soft tooling dependency)
- **Severity:** improvement
- **Location:** backlog.json item 002, acceptanceCriteria[3]
- **Issue:** Item 002's 4th acceptance criterion is `ruff check scripts/check-version-sync.py` "reports no E/F/W violations (once ruff.toml from item 003 exists; otherwise the harness is written to that floor)." `ruff.toml` (line-length 100, E/F/W) is created by item 003, and item 002 declares `dependsOn: []`. If 002 runs before 003, that one acceptance criterion cannot be executed as written (no ruff.toml present), so the item self-verifies only against an implicit floor rather than the real gate. This is a deliberate soft coupling (the description scopes it as conditional, and the same floor-coupling exists for item 007), so it is not a hard ordering bug — but it leaves one acceptance criterion partially unverifiable depending on execution order. The dependency graph is otherwise sound: all declared edges valid, acyclic, no priority inversions, foundation items dependency-free.
- **Suggested fix:** Either (a) add `"003"` to item 002's `dependsOn` (003 is P1 with no deps → no cycle, no inversion; matches how item 005 declares its 003 edge for the same `ruff check scripts/` reason) — recommended; or (b) reword acceptanceCriteria[3] to make the conditional explicit and order-independent ("if ruff.toml (item 003) is present, `ruff check …` reports no E/F/W at line-length 100; otherwise confirm by inspection that the script holds the 100-col / E/F/W floor").
- **References:** backlog.json items 002, 003, 005, 007; 02-ci-blocking-gates.md §3.2.
- **Checklist:** CHECK-B18

### V-004: Item 015 (CHANGELOG) depends on the truth of nearly every other item but declares no dependencies
- **Severity:** improvement
- **Location:** backlog.json item 015 (`dependsOn: []`, description + notes)
- **Issue:** Item 015 authors CHANGELOG entries enumerating this capstone's deliverables (CI gates, schema, lint gates, eval harness, per-agent docs, MIT LICENSE, .gitattributes, README rewrite, version reconciliation). Its own notes acknowledge the hazard: "If some referenced subsections land after this item, include only the already-true ones." With `dependsOn: []`, the scheduler may run 015 early, producing a CHANGELOG that claims work not yet done. Not an AC defect, but the empty dependency set undercuts the item's own caveat.
- **Suggested fix:** Either (a) add `dependsOn` covering the deliverable-producing items (005, 006, 009, 010, 012, 013, 014, 016) or add a note that item 015 SHOULD be scheduled last; or (b) keep `dependsOn: []` but strengthen the AC to "entries reflect only deliverables already merged at authoring time; the item is re-runnable to append later-landed entries." Option (a) is cleaner given all 16 items are in-scope for this feature.
- **References:** 06-packaging-versioning-hygiene.md §4; backlog item 015.
- **Checklist:** CHECK-B25

## Clean / N/A checks (no findings)

- **CHECK-B01–B06 (schema/enum): all PASS.** 16 items, ids 001–016 unique and dense; `type` ∈ {feature, chore} (canonical, no casing drift); `priority` numeric ∈ {1,2}; `status` uniformly `pending` with `completedAt: null`; every `dependsOn` target resolves; `schemaVersion: "1"`. The deterministic validator's `{"valid": true}` holds under deeper manual inspection.
- **CHECK-B07 (spec doc coverage): PASS.** All 8 numbered specs (00–07) are each referenced by ≥1 item's specReferences.
- **CHECK-B09 / B10 (specReferences exist & relative): PASS.** All 24 references resolve to real files; all repo-root-relative; zero absolute paths.
- **CHECK-B15 / B16 / B17 / B19 (dep graph): PASS.** Clean DAG, no cycles, foundation items (001/002/003) dependency-free, no priority inversions.
- **CHECK-B11–B14 (scope, detail, verifiable AC, files named): PASS.** Every item is a single focused session; ACs are command-driven (exit codes, file existence, `pnpm gate`); version-field claims in items 002/012 confirmed against the live `../feature-forge` tree.
- **CHECK-B20 (scaffold item): N/A.** CI-wiring + authoring capstone — no new runtime package/workspace; `eval/` is created within item 007, `.github/` within items 005/006. No separate scaffold step is warranted.
- **CHECK-B21 (shared types & error hierarchy): PASS.** Declarative contracts each have an owning item (SKILL.md schema → 001; version-sync 3-field contract → 002; EvalFixture/EvalReport → 007). No error-class hierarchy exists (gates use exit codes); appropriate for a CI feature.
- **CHECK-B23 (integration wiring): PASS.** Items 004 (validate.sh), 005 (ci.yml + composite), 006 (os-matrix.yml), 008 (eval.yml) are dedicated wiring items.
- **CHECK-B24 (tests): PASS** (with V-001 caveat) — testing is folded into acceptance criteria per spec 07 §1 ("no new test framework"); the one gap is the pytest-install wiring (V-001).

## Fix Execution Plan

### User Decisions Required
- **V-001** recommends a companion edit to spec 02 §3.2 (add `pip install pytest` to the composite YAML), not just a backlog edit — confirm the spec edit is wanted so "EXACTLY as in §3.2" stays honest. Recommended. **[RESOLVED 2026-06-17: applied the spec edit + backlog edit.]**
- **V-003** offers two valid resolutions (add a `003` dependency edge vs. reword the criterion). Graph is sound either way; default recommendation is option (a). Maintainer picks one. **[RESOLVED 2026-06-17: applied option (a) — added `dependsOn: ["003"]`.]**

All other fixes can be applied directly.

### Execution Steps

#### Step 1: Close the pytest CI-gate gap (load-bearing)
- **Files:** specs/agent-agnostic/packaging-docs-ci/backlog.json (item 005); specs/agent-agnostic/packaging-docs-ci/02-ci-blocking-gates.md (§3.2 composite YAML)
- **Addresses:** V-001
- **Checklist:** CHECK-B22, CHECK-B24
- **Action:** In backlog item 005, add `python3 -m pip install pytest` to the composite's tooling-install description and add an acceptance criterion that the composite installs pytest so validate.sh step 7 is a hard gate in CI (per spec 07 §2.2). In spec 02 §3.2, add a `python3 -m pip install pytest` line beside `python3 -m pip install ruff` so the verbatim-copy instruction in item 005 produces a pytest-installing composite.
- **Depends on:** none
- **Rationale:** Highest-severity finding; the schema↔checker anti-drift guard (the point of items 001+005 for REQ-CI-02/REQ-CONST-03) is non-effective in CI without it. Fixing the spec and the item together keeps the "copy §3.2 verbatim" instruction correct.

#### Step 2: Make REQ-CI-04's CI wiring explicit in the backlog
- **Files:** specs/agent-agnostic/packaging-docs-ci/backlog.json (item 005)
- **Addresses:** V-002
- **Checklist:** CHECK-B08
- **Action:** Append to item 005's `notes` (or add an AC) a sentence stating the composite's first step `bash scripts/validate.sh` includes the pre-existing step 6b adapters regen-diff gate (`build-adapters.py --check`, spec 02 §4.4), which is how REQ-CI-04 / REQ-CONST-04 are enforced per-PR.
- **Depends on:** none
- **Rationale:** Grouped with Step 1 (same item 005); pure documentation clarification.

#### Step 3: Resolve item 002's soft ruff coupling
- **Files:** specs/agent-agnostic/packaging-docs-ci/backlog.json (item 002)
- **Addresses:** V-003
- **Checklist:** CHECK-B18
- **Action:** Option (a) — set item 002's `"dependsOn": []` to `"dependsOn": ["003"]`; OR option (b) — reword acceptanceCriteria[3] as conditional-on-003-present with an inspection fallback. Apply exactly one.
- **Depends on:** none
- **Rationale:** Makes one acceptance criterion order-independent; option (a) mirrors item 005's existing 003 edge.

#### Step 4: Constrain CHANGELOG authoring order
- **Files:** specs/agent-agnostic/packaging-docs-ci/backlog.json (item 015)
- **Addresses:** V-004
- **Checklist:** CHECK-B25
- **Action:** Add `dependsOn` for the deliverable-producing items (005, 006, 009, 010, 012, 013, 014, 016) or add a "schedule last" note, and tighten the AC to "entries reflect only deliverables merged at authoring time."
- **Depends on:** none
- **Rationale:** Prevents item 015 from authoring a CHANGELOG that claims not-yet-landed work.

## Fix Progress
- Step 1: [APPLIED] 2026-06-17 — V-001 pytest gate. spec 02 §3.2 composite now runs `python3 -m pip install pytest` (with rationale comment); item 005 description notes ruff+pytest install and a 6th acceptance criterion asserts the composite installs pytest so validate.sh step 7 is a hard gate.
- Step 2: [APPLIED] 2026-06-17 — V-002 REQ-CI-04. item 005 notes now state the composite's `validate.sh` step includes the pre-existing step 6b adapters regen-diff gate (spec 02 §4.4) as the per-PR enforcement of REQ-CI-04/REQ-CONST-04.
- Step 3: [APPLIED] 2026-06-17 — V-003 item 002 ruff coupling. Option (a): item 002 `dependsOn` set to `["003"]` so ruff.toml exists when acceptanceCriteria[3] runs. Re-validated: no cycle, no priority inversion.
- Step 4: [APPLIED] 2026-06-17 — V-004 CHANGELOG ordering. item 015 `dependsOn` set to the deliverable-producing items `["005","006","009","010","012","013","014","016"]`.

All steps applied. `rauf-stable backlog validate` re-run after edits: `{"valid": true, "findings": []}`.
