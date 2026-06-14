# Verification Report: ux-overhaul-web (backlog)
Date: 2026-06-14
Pipeline Stage: forge-4-backlog complete; verifying backlog
Artifacts Reviewed: specs/ux-overhaul-web/backlog.json (10 items); PRD.md, tech-spec.md, 00–06, TRACEABILITY.md; schemas/backlog.schema.json + packages/core/src/schemas.ts
Method: 4 parallel forge-verifier instances (dimensions: item-scoping/AC, dependency/ordering, spec-coverage/traceability, schema/enum). Runner re-validation: `rauf-stable backlog validate . --backlog specs/ux-overhaul-web --specs-dir ./specs --json` → `{valid:true, findings:[]}`, exit 0.

## Summary
- Total findings: 1
- Gaps: 1
- Inconsistencies: 0
- Improvements: 0
- Errors: 0

Dimension tallies: scoping/AC 5/5 pass (0 findings); dependency/ordering 8/8 pass (0 findings); spec-coverage 5/6 pass (1 fail → V-001); schema/enum 7/7 pass (0 findings, runner valid). ~25 checks across the suite.

Verified clean (highlights): all 28 PRD REQs map to items; all 5 routes + label map + relocation + plumbing + agent docs + version/docs covered; both TRACEABILITY implementer notes (deriveFromStateJson raw-status; mapLoopStateStatus export) baked into item 001; specReferences all resolve; DAG acyclic, no phantom deps, foundation-first ordering coherent with item 001's atomic-increment claim (no item leaves typecheck red between items); schema/enum fully conformant (types, status=pending, ids 001-010, dependsOn field, opus/sonnet models).

## Findings

### V-001: Acceptance-criteria gate omits `pnpm lint` (and `format:check` in 6 of 10 items)
- **Severity:** gap
- **Location:** specs/ux-overhaul-web/backlog.json — the final "done" gate clause in every item's `acceptanceCriteria` (all 10 items)
- **Issue:** The specs define one canonical full gate as a success criterion: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (PRD §8; tech-spec §8; spec 06 §7.1/§9 — "green across all four packages"). PRD C-5 + spec 06 §9 make passing this gate part of the definition of done. But no item's AC includes `pnpm lint`: items 001/003/004/005/006/007 assert only `pnpm typecheck && pnpm test`; items 002/008/009/010 assert `pnpm typecheck && pnpm test && pnpm format:check`. `pnpm lint` is a real, load-bearing repo command (CLAUDE.md Development Commands; named in spec 06). Consequence: a loop iteration can satisfy every AC verbatim while leaving ESLint failures (and, for 6 items, Prettier failures) — the item is marked done but the spec's green-gate criterion is not actually met. The loop verifies one item's AC per iteration, so every increment should assert the full gate.
- **Suggested fix:** Normalize the final gate clause in every item's `acceptanceCriteria` to `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test passes`, preserving each item's trailing qualifier. Concretely: items 001/003/004/005/006/007 (`"pnpm typecheck && pnpm test passes"`) → full 4-command form; items 002/008 (`"... && pnpm format:check passes; no *.test.tsx ..."`) → insert `pnpm lint &&` after `pnpm typecheck &&`, keep the `; no *.test.tsx` suffix; items 009/010 (`"... && pnpm format:check passes"`) → insert `pnpm lint &&`. Item 010 (the final honest-advertisement gate) must carry the complete 4-command gate without exception. No user decision — the gate string is fixed by the specs.
- **References:** PRD.md §8, §5 C-5; tech-spec.md §8; 06-testing-strategy.md §7.1/§9; CLAUDE.md "Development Commands"
- **Checklist:** CHECK-B16, CHECK-B17

## Fix Execution Plan

### User Decisions Required
None — the canonical gate string is fixed by the specs.

### Execution Steps

#### Step 1: Normalize the AC gate clause to the full spec gate in all 10 items
- **Files:** specs/ux-overhaul-web/backlog.json
- **Addresses:** V-001
- **Checklist:** CHECK-B16, CHECK-B17
- **Action:** In each item's `acceptanceCriteria`, replace the final gate string with `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test passes`, preserving any trailing qualifier on that clause (items 002 and 008 keep their `; no *.test.tsx is added` / `; no *.test.tsx added` suffix). Items 001/003/004/005/006/007 currently end `pnpm typecheck && pnpm test passes`; items 002/008/009/010 end `… && pnpm format:check passes` — all must include `pnpm lint`. Re-validate with `rauf-stable backlog validate . --backlog specs/ux-overhaul-web --specs-dir ./specs --json` (must stay exit 0).
- **Depends on:** none
- **Rationale:** Each loop increment verifies its own AC, so every item must assert the spec's full green gate; item 010 is the designated final-green checkpoint.

## Fix Progress

- Step 1: [APPLIED] 2026-06-14 — Normalized the final AC gate clause in all 10 items to `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test passes` (two replace_all passes; items 002/008 kept their `; no *.test.tsx …` suffix). Verified: 10/10 items carry the full gate, 0 old clauses remain. Re-validated `rauf-stable backlog validate . --backlog specs/ux-overhaul-web --specs-dir ./specs --json` → `{valid:true, findings:[]}`, exit 0.
