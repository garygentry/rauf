# Verification Report: loop-observability (backlog)

- **Date:** 2026-07-05
- **Pipeline Stage:** forge-4-backlog complete (forge-verify-backlog)
- **Artifacts Reviewed:** `specs/loop-observability/backlog.json` (7 items) against `00`–`06` implementation specs, `PRD.md`, `tech-spec.md`, `TRACEABILITY.md`, and `.rauf/backlog.schema.json`.
- **Method:** 4 parallel `forge-verifier` instances over disjoint dimensions — (1) item scoping & acceptance-criteria quality, (2) dependency & ordering sanity, (3) spec coverage & traceability, (4) schema & enum correctness — plus the runner validator.
- **Runner validation:** `rauf-stable backlog validate . --backlog specs/loop-observability --specs-dir specs/loop-observability --json` → `{ "valid": true, "findings": [] }` (exit 0).

## Summary

- **Total findings: 3**
- Gaps: 0
- Errors: 0
- Inconsistencies: 0
- Improvements: 3

Three of four dimensions returned **zero** findings (dependencies, spec coverage, schema/enums). All three findings are `improvement`-severity polish from the scoping/AC dimension — none block the loop. The backlog is shippable as authored.

## Findings

### V-001: Item 004 description exceeds the ~300-word sizing guideline
- **Severity:** improvement
- **Location:** `backlog.json`, item `004` (`Rewrite drive-rauf-loop skill…`), `description`
- **Issue:** The description is ~346 words, over the ~300-word target. The overflow is real content (the 6-step recipe: start/poll/decision-tree/ladder/interval/stream-optional), not padding — the item's *scope* is fine (prose-only edit to 2 byte-identical SKILL.md copies + a verify-no-edit check on 2 agent files). But the full decision-tree/ladder semantics are inlined when they are already authored in `05-supervision-recipe.md`, which the item references.
- **Suggested fix:** Condense steps 3–4 (four-way tree + persist-then-escalate ladder) to one-line summaries and defer authoritative wording to `05-supervision-recipe.md` (already in `specReferences`), e.g. "prescribe the four-way decision tree and N=3 persist-then-escalate ladder exactly as specified in 05-supervision-recipe.md". Drops under 300 words with no loss of acceptance-testable content (the AC list already carries the requirements). No scope change.
- **References:** `specs/loop-observability/05-supervision-recipe.md`
- **Checklist:** CHECK-B02

### V-002: Item 001 description embeds spec-authoring-time line numbers
- **Severity:** improvement
- **Location:** `backlog.json`, item `001`, `description` (`~line 279`, `:249`, `:710`, `:36`, `:207`, `:179`)
- **Issue:** The description hard-codes source line numbers that the item's own `notes` admits are "from spec authoring time; confirm against source before editing." The **acceptance criteria** are correctly written against symbols/behavior (e.g. "BacklogSummarySchema and IterationStatusSchema are unchanged in this diff", "readIterationStatus invoked at most once on the Tier-1 path"), so AC verifiability is not affected. The only risk: a fresh agent trusts a stale `:279` and edits the wrong spot — already mitigated by the `notes` disclaimer.
- **Suggested fix:** Optional. If tightening, replace inline `:NNN` anchors with symbol names (`DerivedStatusSchema`, `the ITERATION_STATUS_FRESH_MS 60s constant`) and keep line numbers only in `notes`. Leave the ACs unchanged.
- **References:** none
- **Checklist:** CHECK-B03, CHECK-B04

### V-003: Item 004 AC-5 ("no divergent inline decision rules") is only semi-objective
- **Severity:** improvement
- **Location:** `backlog.json`, item `004`, `acceptanceCriteria[4]`
- **Issue:** "No divergent inline decision rules" is a judgment predicate, unlike the sibling ACs (byte-diff empty; specific table/threshold presence) which are mechanically checkable. The description names the concrete disqualifiers ("no hard-coded interval, no competing stall heuristic"), so it is testable in practice, but the AC as phrased leaves "divergent" open to interpretation.
- **Suggested fix:** Rewrite AC-5 to enumerate the grep-checkable disqualifiers, mirroring the description: "`agents/rauf-loop-driver.md` and `.codex/agents/rauf-loop-driver.toml` contain no hard-coded poll interval and no stall heuristic other than `health.stuckWarning` (grep confirms neither an interval literal nor an `iteration-status.json` read); expected outcome is no edit."
- **References:** none
- **Checklist:** CHECK-B04

## Fix Execution Plan

### User Decisions Required
None. All three findings are `improvement`-severity polish; the backlog is loop-ready as authored.

### Execution Steps

#### Step 1: Tighten item 004 description and AC-5 (addresses V-001, V-003)
- **File:** `specs/loop-observability/backlog.json`
- **Action:** In item `004`, condense `description` steps 3–4 to one-line summaries deferring to `05-supervision-recipe.md` (brings it under 300 words), and rewrite `acceptanceCriteria[4]` to enumerate the two grep-checkable disqualifiers (no interval literal; no stall heuristic other than `health.stuckWarning`).
- **Depends on:** none

#### Step 2: Symbolize line-number anchors in item 001 description (addresses V-002, optional)
- **File:** `specs/loop-observability/backlog.json`
- **Action:** In item `001`, replace inline `:NNN` source anchors in the `description` with symbol names; keep line hints only in `notes`. Leave all ACs unchanged.
- **Depends on:** none

## Dimension Results

| Dimension | Findings | Notes |
|-----------|----------|-------|
| Item scoping & AC quality | 3 (all improvement) | All 7 items end with `pnpm gate`; all ≤5–8 files; estimatedIterations proportionate (001=2, rest 1); ACs symbol/behavior-based. |
| Dependency & ordering sanity | 0 | DAG verified (`{001,002,005}→{003,006}→004→007`); no cycles/phantoms; the 003/006 shared-file (`follow-command.ts`) non-edge confirmed correct (disjoint regions, spec-endorsed at 04:461–462). |
| Spec coverage & traceability | 0 | All 4 phases' matrix files owned by exactly one item; 16 specReferences all resolve; out-of-scope runner-contract edit correctly excluded (notes-only); deferred web parity absent. |
| Schema & enum correctness | 0 | Schema-clean; `type`∈{feature,chore}; all `pending`/`completedAt:null`; `dependsOn` (never `dependencies`); runner validator `valid:true`. |
