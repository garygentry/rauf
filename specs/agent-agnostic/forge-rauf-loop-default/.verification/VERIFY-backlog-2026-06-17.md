# Verification Report: forge-rauf-loop-default (backlog)
Date: 2026-06-17
Pipeline Stage: forge-4-backlog complete → forge-verify-backlog
Artifacts Reviewed:
- specs/agent-agnostic/forge-rauf-loop-default/backlog.json (5 items, 001–005)
- specs/agent-agnostic/forge-rauf-loop-default/{PRD.md, tech-spec.md, 00–07 specs, TRACEABILITY.md}
- .rauf/backlog.schema.json (schema target)
- Cross-repo targets in /home/gary/workspace/feature-forge (forge-config-schema.json, ralph-loop-contract.md, skills/forge-5-loop/**, scripts/build-adapters.py, scripts/validate.sh, tests/)

## Method
Parallel dimensioned fan-out: 4 `forge-verifier` instances, each owning a disjoint slice of CHECK-IDs (schema/enum B01–B06; spec coverage B07–B10; task quality + completeness B11–B14/B20–B25; dependency ordering B15–B19). Executed 25 of 25 backlog checks. Plus two deterministic gates:
- **`rauf-stable 0.6.0 backlog validate`** → `valid: true`, 0 findings.
- **validate-traceability.py** → 29/29 PRD requirements covered by specs; 1 orphaned reference `REQ-DIST-01` (specs-scope; NOT referenced by any backlog item — see Note A).

## Summary
- Total findings: 3
- Gaps: 0
- Inconsistencies: 0
- Improvements: 3
- Errors: 0

All three findings are optional polish. The backlog is schema-clean, spec-complete (every P0 covered, every spec doc referenced), and the dependency graph is acyclic with correct ordering. **No finding blocks proceeding to forge-5-loop.**

## Note A: REQ-DIST-01 orphaned reference (informational, specs-scope)
The traceability validator flags `REQ-DIST-01` as an orphaned reference: it appears in the specs tree but is not a PRD requirement of this feature (it is almost certainly an epic-level / cross-feature distribution requirement owned by another `agent-agnostic` member such as cross-agent-installer or packaging-docs-ci). This is a **specs-stage** observation, and forge-verify-specs already passed (findings-applied). Crucially, **no backlog item references REQ-DIST-01** in specReferences, descriptions, acceptance criteria, or notes — so it does not propagate into the backlog. No backlog action required; recorded only for epic-level awareness.

## Findings

### V-001: Item 004 is the densest item — note its sub-step count as a complexity flag
- **Severity:** improvement
- **Location:** backlog.json, item 004
- **Issue:** Item 004 is the most multi-faceted item: it edits two files (skills/forge-5-loop/SKILL.md + references/runner-contract.md), Step 2d alone has six labelled sub-changes (a–f), Step 1c has wording changes, runner-contract.md gains three additions, and it must regenerate the forge-5-loop adapter. It is `estimatedIterations: 2`, which is the right call, but it is meaningfully heavier than the other 2-iteration items. This is not a gap — every sub-change is a faithful transcription from a quoted spec section (spec 03 §2.1/2.2 and spec 05 §2.2/2.3 quote the exact current text to amend), and the 8 acceptance criteria decompose cleanly into checkable assertions. Flagged so the loop agent budgets attention.
- **Suggested fix:** Optional. Add one sentence to item 004's `notes` recommending the agent apply the Step 2d {a–f} changes in order against the spec-03 §2.2 verbatim block before regenerating adapters, so a partial edit isn't committed. The current `notes` already point at the quoted spec blocks, so this is low-value polish.
- **References:** spec 03 §2.1/2.2, spec 05 §2.2/2.3; skills/forge-5-loop/SKILL.md (Step 1c, optional-flags line)
- **Checklist:** CHECK-B11, CHECK-B25

### V-002: Two acceptance criteria lean on "byte-identical" / "no drift" without naming the mechanical check
- **Severity:** improvement
- **Location:** backlog.json, item 004 AC #6; item 001 AC #4
- **Issue:** Item 004 AC #6 ("With loopRunner.agentArgument absent, Step 2d and Step 3c render byte-identically to today — no selector, no probe, no agent line") states the REQ-PLUG-02/COMPAT-01 guarantee correctly, but unlike the surrounding criteria it has no concrete verification handle — it is a behavioral claim about prose that `validate.sh` cannot mechanically confirm (the gating *test* lives in item 003 §3.4 against the .py module, not against the skill prose). Similarly item 001 AC #4 ("no loopRunner property other than minRunnerVersion + installHint is altered") is verifiable only by manual diff, not by a named tool. Both are defensible (item 003's gating test covers the algorithm-level byte-identical guarantee; the schema is JSON so a diff is trivial), but they read softer than the surrounding equality/grep assertions.
- **Suggested fix:** Optional. For 004 AC #6, append a verification handle, e.g. "(verified by the §3.4 gating assertions in item 003 and by reading the gated-off render path)". For 001 AC #4, append "(confirm via a git diff of references/forge-config-schema.json touching only the three added properties + minRunnerVersion + installHint)". Neither changes scope.
- **References:** spec 02 §2 (capability gate), spec 07 §3.4; item 003 AC #3/#4
- **Checklist:** CHECK-B13

### V-003: Mirror the "do NOT run build-adapters.py" negative instruction symmetrically on both test-only items
- **Severity:** improvement
- **Location:** backlog.json, item 002 AC #8; item 003 notes
- **Issue:** Items 002 and 003 are test-only / not adapter-wired, and they correctly assert `build-adapters.py --check passes with no regeneration required for this file` (verified: validate.sh phase 6b runs `build-adapters.py --check`, and references/loop-agent-selection.py + tests/ are not adapter source). The subtlety a fresh agent could miss: `--check` here is a *negative* assertion (the new files must NOT have been swept into adapter generation), not a regen step. Item 002's description already says "do NOT regenerate adapters for this item"; item 003 says only that the fixture is "exempt from the spec-purity guard and not adapter-wired" — slightly less explicit. A naive agent could mistakenly run `build-adapters.py` on these items.
- **Suggested fix:** Optional. In item 003 `notes`, add the explicit "do NOT run build-adapters.py for this item" to mirror item 002 symmetrically.
- **References:** scripts/validate.sh (phase 6b drift guard); item 002 description + AC #8
- **Checklist:** CHECK-B13, CHECK-B14

## Per-check results (25/25 executed)
- **Schema/enum (B01–B06):** all PASS. 7 required fields on every item; ids 001–005 unique; `type` ∈ {feature×4, test×1}; `priority` ∈ {1,2}; `status` all `pending`; `additionalProperties:false` holds at both levels (model/estimatedIterations/notes/specReferences/schemaVersion all schema-legal).
- **Spec coverage (B07–B10):** all PASS. All 8 numbered specs referenced by ≥1 item; all 22 P0 PRD requirements covered (REQ-BIN-01 satisfied by spec 05 §3 "discovery unchanged" + the 0.6.0 floor bump in items 001/004 — intentional, not a gap); every specReferences path resolves to a real file; no dangling refs.
- **Task quality + completeness (B11–B14, B20–B25):** PASS with 3 improvements (V-001–V-003). B20 (TS scaffold) correctly N/A — additive plugin edits; item 002 IS the shared-types module (B21); all 4 documented mechanisms have owning items; item 003 owns tests; no over-large items.
- **Dependency ordering (B15–B19):** all PASS. Edges 001:[], 002:[], 003:[001,002], 004:[001,002], 005:[001,004] — all valid ids, acyclic (topo order 001,002,003,004,005), foundation items dep-free, dependents reference their creators, priority consistent (no item depends on a lower-priority item). No shared-source-file collisions; `build-adapters.py` rebuilds the full adapter tree atomically and the loop runs one item per iteration, so no regeneration race and no missing ordering edge.

## Fix Execution Plan

### User Decisions Required
None — all three findings are `improvement` severity and optional. The backlog is ready for forge-5-loop as-is.

### Execution Steps

#### Step 1 (Optional): Tighten the three soft acceptance-criteria / notes phrasings
- **Files:** specs/agent-agnostic/forge-rauf-loop-default/backlog.json
- **Addresses:** V-001, V-002, V-003
- **Checklist:** CHECK-B11, CHECK-B13, CHECK-B14, CHECK-B25
- **Action:**
  (a) Item 004 `notes`: add a sentence recommending sub-step-ordered application of Step 2d {a–f} against the spec-03 §2.2 verbatim block before adapter regen.
  (b) Item 004 AC #6: append "(verified by item 003 §3.4 gating assertions)". Item 001 AC #4: append the git-diff verification handle from V-002.
  (c) Item 003 `notes`: add the explicit "do NOT run build-adapters.py for this item" to mirror item 002.
  All are pure phrasing additions — no scope, dependency, or estimatedIterations change. After editing, re-run `rauf-stable backlog validate . --backlog specs/agent-agnostic/forge-rauf-loop-default --specs-dir specs/agent-agnostic/forge-rauf-loop-default --json` to confirm still `valid: true`.
- **Depends on:** none
- **Rationale:** All three are minor wording improvements to the same file; grouping them into one edit avoids repeated validation runs.

## Fix Progress
- Step 1: [APPLIED] 2026-06-17 — V-001 (item 004 notes: sub-step-ordered application guidance), V-002 (item 004 AC #6 + item 001 AC #4 verification handles), V-003 (item 003 notes: "do NOT run build-adapters.py"). Re-validated: `rauf-stable backlog validate` → valid:true, 0 findings.
