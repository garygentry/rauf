# Verification Report: forge-agent-adapters-build (backlog)
Date: 2026-06-16
Pipeline Stage: forge-4-backlog complete (forge-verify-backlog pending; currentStage=forge-5-loop)
Epic: agent-agnostic
Artifacts Reviewed: backlog.json (11 items, 001–011), PRD.md, tech-spec.md, 00-core-definitions.md … 06-testing-strategy.md, TRACEABILITY.md, forge.config.json

Verification method: parallel `forge-verifier` fan-out across 4 disjoint dimension groups
(schema/enum B01–B06; dependency/ordering B15–B19; spec-coverage/traceability B07–B10;
scoping/AC-quality/completeness B11–B14 + B20–B25). Deterministic loop-runner check
(`rauf-stable backlog validate`) ran first and returned `valid: true, findings: []`.

Checks executed: **25 of 25** — 23 pass, 1 fail (CHECK-B19), 1 pass-with-finding. The lone
hard fail is a benign priority inversion (V-001). No schema/enum, traceability, or
spec-existence defects.

## Summary
- Total findings: 7
- Gaps: 1
- Inconsistencies: 1
- Improvements: 5
- Errors: 0

## Findings

### V-001: Priority inversion — completion-gate item 011 (P1) depends on AGENTS.md item 010 (P2)
- **Severity:** inconsistency
- **Location:** backlog.json, item `011` (`priority`/`dependsOn`) and item `010` (`priority`)
- **Issue:** Item 011 has `priority: 1` with `dependsOn: ["006","007","008","009","010"]`; item 010 has `priority: 2`. Lower number = higher precedence, so a priority-2 item blocking a priority-1 dependent is an ordering inversion: a priority-scheduling runner would attempt 011 before its lower-precedence blocker 010 is done. This is the only inversion in the graph (the other 10 edges are non-inverting). Moreover the edge appears spurious: step 6b regenerates/diffs `adapters/`, and AGENTS.md lives at the repo root *outside* `adapters/` — item 010 AC #4 explicitly states "`build-adapters.py --check` is unaffected by AGENTS.md (it lives at the repo root, not adapters/)". So 010 is not gated by step 6b.
- **Suggested fix:** Preferred — **drop `"010"` from item 011's `dependsOn`** (the gate does not depend on AGENTS.md; this removes the inversion and tightens the DAG). Alternative if the intent was "land docs before declaring the feature complete," raise item 010 to `priority: 1`. Prefer dropping the edge: it is logically unjustified, not merely mis-prioritized.
- **References:** item 010 AC #4 + `notes` ("excluded from the drift guard by construction"); item 011 description (step 6b only runs `build-adapters.py --check`); 05-purity-exemption-and-drift-guard.md §2.2.
- **Checklist:** CHECK-B19, CHECK-B18

### V-002: Item 005 depends on 004, but its true prerequisite is the item-003 shared helpers
- **Severity:** improvement
- **Location:** backlog.json, item `005` (`dependsOn` currently `["004"]`)
- **Issue:** Item 005 (provenance / self-containment / manifest serialization / generation report) consumes the Form-A `render_frontmatter_block` from item 003 and the `DropRecord`/`ManifestEntry` types from item 001 — per its own notes: "Form A headers are produced by the emitters (item 003 render_frontmatter_block); this item produces Form B (report), Form C (gemini JSON _generated)". It does not functionally depend on the item-004 TQ-1 emitters. The `005→004` edge is correct as transitive ordering (004→003→002→001) so this is not a gap, but it over-couples 005 to the riskiest item (004 is the 2-iteration, doc-confirmation TQ-1 work).
- **Suggested fix:** Optional tightening — change item 005 `dependsOn` from `["004"]` to `["003"]` to reflect the true prerequisite, decoupling provenance/report work from the riskier TQ-1 emitter item. Leave as-is only if a strictly linear single-file build-up is preferred to avoid concurrent edits to `build-adapters.py`. Does not affect item 006, which legitimately depends on all emitters via the registry.
- **References:** item 005 `notes`; item 003 description (`render_frontmatter_block`, §2.1); item 006 description (registry wires 003+004 emitters).
- **Checklist:** CHECK-B18

### V-003: REQ-SEC-01 (write-confinement) has no dedicated acceptance criterion — covered only indirectly
- **Severity:** improvement
- **Location:** backlog.json item `006` (`acceptanceCriteria`); cross-ref PRD.md REQ-SEC-01 (§4.2); 06-testing-strategy.md §4
- **Issue:** REQ-SEC-01 (P0) requires the generator write only within `adapters/` (plus repo-root `AGENTS.md`) and never outside the repo root. Item 006's *description* names the implementing mechanism (`_assert_within(path, allowed_root)` + `safe_write(...)`, spec 02 §4.2), but none of its acceptance criteria assert the security-negative — there is no criterion verifying a write whose resolved path escapes `adapters/`/the repo root is *rejected*. The requirement rides only on the generic "bash scripts/validate.sh passes" criterion, which exercises the happy path. The spec's own coverage table (06 §4) likewise maps REQ-SEC-01 only to "validate.sh passes," so this is a coverage-depth weakness inherited from specs. B08 still passes (an AC does reference SEC-01 work), but the P0 sandbox has no behavioral assertion proving it blocks an escape.
- **Suggested fix:** Add one acceptance criterion to item 006 (and optionally a matching test row to item 007): "`safe_write`/`_assert_within` reject a relpath resolving outside the staging/`adapters/` root (e.g. `../escape` or an absolute path) — the write raises and no out-of-bounds file is created (REQ-SEC-01)."
- **References:** PRD.md REQ-SEC-01 (§4.2); items 006, 007; 02-generator-engine.md §4.2; 06-testing-strategy.md §4.
- **Checklist:** CHECK-B08

### V-004: Item 005 bundles four distinct passes at estimatedIterations:1 — borderline under-budgeted
- **Severity:** improvement
- **Location:** backlog.json, item `005`
- **Issue:** Item 005 bundles four non-trivial, separately-testable passes: (1) `run_self_containment_pass` with `_copytree_verbatim` + `_assert_byte_identical`, (2) `_publish_manifest` for both gemini-extension.json and codex agents/openai.yaml with `_generated`-first serialization, and (3) `render_generation_report` (Form-B provenance). This is materially more surface than item 003 (also iter:1, two emitters sharing one skeleton), while the comparable-surface neighbours (004, 006, 007) are budgeted at 2 iterations. It is cohesive ("the agent-independent passes the engine runs around the emitters"), so a hard split is not required, but the estimate looks optimistic.
- **Suggested fix:** Bump item 005 `estimatedIterations` 1→2 to match comparable-surface items (lighter-touch, preserves the cohesive framing) OR split into 005a (self-containment + verbatim copy) and 005b (manifest serialization + generation report). The chain (006 dependsOn 005) is unaffected either way.
- **References:** 04-provenance-selfcontainment-report.md §1.3/§2/§3; items 003/004/006/007 for comparison.
- **Checklist:** CHECK-B11, CHECK-B25

### V-005: Hard-coded "14 shared references files" count in item 005 / item 009 acceptance criteria can rot
- **Severity:** improvement
- **Location:** backlog.json, item `005` acceptanceCriteria[0] and item `009` acceptanceCriteria[0]
- **Issue:** Both ACs assert an exact file count ("all 14 shared references/ files (9 root + stacks/×5)" / "14-file references/ tree"). The references/ tree is discovery-driven (REQ-SCALE-01, whole-tree verbatim copy), not a fixed list — if a maintainer adds a references file before this item is implemented, the AC becomes false even though the implementation (copy-everything) is correct. The count is accurate today (9 root + 5 stacks, confirmed against 01 §2) but encoding it as pass/fail couples a behavioral item to a transient repo fact.
- **Suggested fix:** Reword to a structural assertion: "copies the entire repo-root references/ tree verbatim (every root file AND the stacks/ subtree, preserving directory structure), each skill's own references/ where present, and forge-root.sh byte-identical at mode 0755 with no GENERATED header." Keep the count only as a parenthetical "(currently 14: 9 root + 5 stacks)". Apply to both item 005 AC[0] and item 009 AC[0].
- **References:** 01-architecture-layout.md §2; REQ-SCALE-01; 06-testing-strategy.md §2.2.1 (fixture proves whole-tree copy structurally, not by count).
- **Checklist:** CHECK-B13

### V-006: The generator pytest suite is never wired into a hard acceptance gate
- **Severity:** gap
- **Location:** backlog.json, items `007` and `011`
- **Issue:** Item 007 delivers the full pytest suite, but its notes confirm "validate.sh step 7 soft-skips pytest when absent; the hard gate (step 6b) is added in item 011." Item 011 adds only the step-6b drift guard (regenerate-and-diff), which proves the committed tree equals a fresh build — it does NOT run the generator pytest suite. So the emitter-correctness signal (`tests/test_build_adapters.py`: description fidelity, hint round-trip, per-file drop enumeration, fail-fast) is never a blocking gate: it is soft-skipped whenever pytest isn't importable, and no item asserts it must pass. 06 §1.1 states "Adding a new emitter … without its matching test is a spec/CI regression," yet the drift guard alone stays green even if every emitter test were deleted, as long as the committed tree matches.
- **Suggested fix:** Add a blocking acceptance criterion to item 007: "On a provisioned `.venv-adapters`, `python3 -m pytest tests/test_build_adapters.py -q` exits 0 and collects all §3.1–§3.11 tests (asserted, not skipped)." Optionally note in item 011 that step 6b is the drift gate and the pytest suite is the complementary required correctness gate (CI-enforced via packaging-docs-ci), so the local soft-skip is intentional but the suite is not optional. (Item 007 AC #5 already lists the pytest command but as a checklist line, not the blocking gate.)
- **References:** 06-testing-strategy.md §1 (step-7 soft-skip), §1.1, §4 item 3; item 007 notes; item 011 description (step 6b is drift-only).
- **Checklist:** CHECK-B24

### V-007: Item 004 TQ-1 outcome is not pinned, so two correct executions can yield divergent committed baselines
- **Severity:** improvement
- **Location:** backlog.json, item `004` (description step 4 + acceptanceCriteria[4])
- **Issue:** Item 004 asks the agent to "confirm the TQ-1 native field names … against each agent's OFFICIAL docs (context7 MCP or web)"; AC #5 reads "Any TQ-1 field confirmed against official docs has its flag dropped and mapping set; unconfirmed fields keep drop-with-record." Because those docs were unreachable at authoring (03 §8), the outcome is non-deterministic across runs/agents: an online agent may confirm a field and emit it; an offline agent keeps the safe default. Both satisfy AC #5 but produce DIFFERENT committed `adapters/` trees — and item 009 commits whichever baseline resulted, which the drift guard then freezes. AC #5 is checkable in isolation but does not pin a reproducible end state.
- **Suggested fix:** Make the offline path the deterministic baseline: add an AC such as "If official docs are unreachable, ALL TQ-1 fields keep the documented safe default (name+description, drop-with-record) and the GENERATION-REPORT records them as unconfirmed — the committed baseline (item 009) is the safe-default tree." Any confirmed-field upgrade then becomes a separate, explicitly-reviewed change rather than an incidental side effect of which agent ran the item.
- **References:** 03-per-agent-emitters.md §8 (TQ-1 register, docs unreachable at authoring); item 004 AC #5; item 009 (commits the baseline the drift guard freezes).
- **Checklist:** CHECK-B11, CHECK-B13

## Fix Execution Plan

### User Decisions Required
- **V-002** — [RESOLVED] **kept `005→004`** (declined optional `005→003` retarget). Items 002–006 all edit the single file `build-adapters.py`; a strictly-linear chain is safer than parallelizable edges in a sequential loop — the caveat the finding itself flagged.
- **V-004** — [RESOLVED] **bumped `005` estimatedIterations 1→2** (lighter-touch option; not split).
- **V-006** — [RESOLVED] **added blocking pytest AC to item 007 + clarifying note to item 011** (covers both local-gate and CI-enforced framing).

All other findings can be applied directly. Note: every fix below edits only `backlog.json`
and is non-conflicting; they can be applied in a single pass. Re-run
`rauf-stable backlog validate . --backlog <feature-dir> --specs-dir <feature-dir> --json`
after editing to confirm the schema still passes.

### Execution Steps

#### Step 1: Fix the priority inversion (V-001)
- **Files:** specs/agent-agnostic/forge-agent-adapters-build/backlog.json
- **Addresses:** V-001
- **Checklist:** CHECK-B19, CHECK-B18
- **Action:** Remove `"010"` from item 011's `dependsOn` array (resulting: `["006","007","008","009"]`). The step-6b gate does not depend on AGENTS.md (lives outside `adapters/`). If instead you want docs sequenced before completion, leave the edge and set item 010 `priority` to `1`.
- **Depends on:** none
- **Rationale:** Removes the only DAG priority inversion and an unjustified edge before other edits touch the same items.

#### Step 2: Adjust item 005 dependency + estimate (V-002, V-004)
- **Files:** specs/agent-agnostic/forge-agent-adapters-build/backlog.json
- **Addresses:** V-002, V-004
- **Checklist:** CHECK-B18, CHECK-B11, CHECK-B25
- **Action:** (V-002, if accepted) change item 005 `dependsOn` from `["004"]` to `["003"]`. (V-004) set item 005 `estimatedIterations` from 1 to 2 — or split into 005a/005b and renumber downstream `dependsOn` references accordingly (006 → new last 005 item).
- **Depends on:** Step 1 (avoid concurrent edits to overlapping items)
- **Rationale:** Both touch item 005; group to one edit. If splitting, do it here so renumbering is contained.

#### Step 3: Add the missing/hardening acceptance criteria (V-003, V-005, V-006, V-007)
- **Files:** specs/agent-agnostic/forge-agent-adapters-build/backlog.json
- **Addresses:** V-003, V-005, V-006, V-007
- **Checklist:** CHECK-B08, CHECK-B13, CHECK-B24, CHECK-B11
- **Action:**
  - (V-003) add to item 006 `acceptanceCriteria` the REQ-SEC-01 write-escape rejection criterion.
  - (V-005) reword item 005 AC[0] and item 009 AC[0] from the fixed "14 files" count to a structural whole-tree assertion, keeping the count as a parenthetical.
  - (V-006) add the blocking pytest criterion to item 007 (and the clarifying note to item 011).
  - (V-007) add the offline-safe-default determinism criterion to item 004.
- **Depends on:** none (independent AC text additions; can run alongside Steps 1–2)
- **Rationale:** All four are AC-text edits with no structural/dependency impact; grouped for a single editing pass.

#### Step 4: Re-validate
- **Files:** (read-only) backlog.json
- **Addresses:** all
- **Action:** Run `rauf-stable backlog validate . --backlog specs/agent-agnostic/forge-agent-adapters-build --specs-dir specs/agent-agnostic/forge-agent-adapters-build --json` and confirm `valid: true`. Confirm the dependency graph is still acyclic and item 011's `dependsOn` no longer inverts priority.
- **Depends on:** Steps 1–3

## Fix Progress
- Step 1: [APPLIED] 2026-06-16 — Removed "010" from item 011 dependsOn (V-001); priority inversion eliminated, DAG still acyclic.
- Step 2: [APPLIED] 2026-06-16 — Item 005 estimatedIterations 1→2 (V-004); kept 005→004 dependency (V-002 decision: linear single-file build).
- Step 3: [APPLIED] 2026-06-16 — Added REQ-SEC-01 write-escape AC to item 006 (V-003); reworded item 005/009 references-count ACs to structural assertions (V-005); upgraded item 007 pytest AC to blocking gate + note to item 011 (V-006); added TQ-1 offline-safe-default determinism AC to item 004 (V-007).
- Step 4: [APPLIED] 2026-06-16 — Re-validated: rauf-stable backlog validate → valid:true/0 findings; DAG acyclic (11/11); 0 priority inversions.
