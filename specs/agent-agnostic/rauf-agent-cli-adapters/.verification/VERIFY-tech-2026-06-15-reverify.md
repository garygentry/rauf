# Verification Report: rauf-agent-cli-adapters (tech — confirmation re-verify of v2)
Date: 2026-06-15
Pipeline Stage: forge-2-tech complete (v2); forge-verify-tech previously `findings-applied` (5 findings, v1→v2)
Artifacts Reviewed: PRD.md (v2), tech-spec.md (**v2 — under verification**), EPIC.md, epic-manifest.json, and rauf source (packages/loop/src/providers/{types,registry,claude-cli,index}.ts, runner.ts, claude-process.ts, signal-parser.ts, signal-redactor.ts, exit-classifier.ts, usage-checker.ts, packages/core/src/schemas.ts, packages/cli/src/loop-commands.ts)

Checks Executed: 17 of 17 (CHECK-T01..T17). Results: 16 pass, 0 fail, 1 not-applicable (CHECK-T15 migration/deployment — additive, non-breaking, no migration).

## Nature of this pass

This is a **confirmation re-verify**. A prior tech verify on v1 raised V-001..V-005, all five applied to produce v2 (see `.verification/VERIFY-tech-2026-06-15.md`). This pass re-ran the full CHECK-T01..T17 checklist against v2, confirmed each prior fix landed correctly and completely, and re-verified every v2-edited `file:line` / signature citation against source. The already-applied prior findings are **not** re-reported as open issues.

### Prior fixes — all confirmed sound in v2
- **V-001** (review-pass neutralization): §3.7 names both insertion sites — work path `neutralizeForDetection(signalText)` at `runner.ts:670`, review path `neutralizeForDetection(stdout)` at `runner.ts:986`; §6 signal-redactor row cites both. Confirmed: `runner.ts:670` is `parseSignal(signalText)`, `:986` is `parseSignal(stdout)`.
- **V-002** (spawnClaude re-export): §3.2 blockquote retains the public `index.ts:12` re-export (verbatim `export { spawnClaude } from "./claude-process.js";`) and scopes the test guard to `runner.ts` only.
- **V-003** (provider lifecycle): §7 adds try/catch→`Result` on per-iteration `createProvider` plus `finally`-dispose of all cached instances on every exit path.
- **V-004** (generic-cli disambiguation): §3.4/§3.5 split the two paths — named `ToolConfig.providers[id]` agents keep `binaryName` + default PATH probe; reserved `generic-cli` omits `binaryName` + config-resolving `detect`. The earlier "omitted binaryName" note is explicitly reconciled. No residual contradiction.
- **V-005** (ExitClass mapping + usage gating): §6 adds the PRD-vocabulary → `ExitClass` table; §3.6 gates `hasUsageLimitInText` claude-only by placing the `runner.ts:651` mid-iteration scan inside the `checkUsage`-gated block.

Traceability holds: all 24 REQ-IDs still trace, all three charter contracts (AgentAdapter, agent-cli-registry, loop-agent-selection) are delivered at the §2 export surface, and EPIC.md contracts match the manifest.

## Summary
- Total findings: 1
- Gaps: 0
- Inconsistencies: 0
- Improvements: 1
- Errors: 0

## Findings

### V-001: `hasUsageLimitInText` cited at `exit-classifier.ts:4-10`, but the function is declared at line 16
- **Severity:** improvement (borderline — imprecise line citation carried verbatim from v1's V-005 text into the v2 edits)
- **Location:** tech-spec.md §3.6 (line 287, the "substring risk" bullet) and §6 Integration table (line 371, `exit-classifier.ts` row)
- **Issue:** Both spots cited `hasUsageLimitInText` as `exit-classifier.ts:4-10`. In source, lines 4-10 are the `USAGE_LIMIT_PATTERNS` const array; the `hasUsageLimitInText` function is declared at `exit-classifier.ts:16`. A fresh agent grepping at `:4-10` lands on the pattern array, not the function. Not a logic error — the claude-only gating design is correct — purely a stale citation.
- **Suggested fix:** Reference the function at `exit-classifier.ts:16` and preserve the pattern-array reference. **[APPLIED — see Fix Progress below.]**
- **References:** packages/loop/src/exit-classifier.ts:4-10 (USAGE_LIMIT_PATTERNS), :16 (hasUsageLimitInText), :22-29 (ExitClass); tech-spec §3.6, §6
- **Checklist:** CHECK-T05, CHECK-T16

## Fix Execution Plan

### User Decisions Required
None — the single finding is a mechanical citation correction with no design impact.

### Execution Steps

#### Step 1: Correct the `hasUsageLimitInText` line citation
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/tech-spec.md (§3.6 line 287; §6 table line 371)
- **Addresses:** V-001
- **Checklist:** CHECK-T05
- **Action:** Replace both `exit-classifier.ts:4-10` references to `hasUsageLimitInText` with `exit-classifier.ts:16` (the function declaration), preserving the `:4-10` reference for the `USAGE_LIMIT_PATTERNS` array. Leave the `ExitClass` `:22-29` citation unchanged.
- **Depends on:** none
- **Rationale:** Isolated cosmetic citation fix; no dependencies, no design impact.

## Fix Progress
- Step 1: [APPLIED] 2026-06-15 — V-001: §3.6 now reads `` `exit-classifier.ts:16`, matching the `USAGE_LIMIT_PATTERNS` at `:4-10` ``; §6 table row now reads `` `hasUsageLimitInText` (`:16`, patterns at `:4-10`) ``. Tech-spec v2 is now citation-clean.
