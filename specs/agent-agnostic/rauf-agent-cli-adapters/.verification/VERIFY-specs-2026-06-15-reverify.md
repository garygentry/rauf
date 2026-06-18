# Verification Report: rauf-agent-cli-adapters (specs — confirmation re-verify)
Date: 2026-06-15
Pipeline Stage: forge-3-specs complete; forge-verify-specs previously `findings-applied` (17 findings)
Artifacts Reviewed: PRD.md (v2), tech-spec.md (v2 + §11), 00–07 implementation specs, TRACEABILITY.md; verified against source in `packages/loop/src/**`, `packages/core/src/**`, `packages/cli/src/**`, `test-sandbox/`.

Checks Executed: **38 of 38** (CHECK-S01..S38) via 5 parallel dimensioned verifiers (confirmation framing). Deterministic supplement: `validate-traceability.py` → **29 requirements, 0 uncovered, 0 orphaned**.

## Nature of this pass

Confirmation re-verify after `forge-fix` applied the prior 17 specs findings (see
`.verification/VERIFY-specs-2026-06-15.md`). Each of the 5 verifiers re-ran its CHECK slice fresh,
confirmed the prior fixes in its dimension landed, and hunted for regressions the large fix batch
(esp. the `02` heading renumber, the barrel reconciliation, and the new `05 §4.1.1` helpers) might
have introduced.

**Prior 17 fixes: confirmed correctly applied.** The verifiers independently re-confirmed V-001
(self-import removed via `constants.ts`), V-003/V-004 (REQ-SEC-01 `cwd` + coverage row), V-005
(type-location move), V-006 (barrel chain for the four `cli-agent` symbols), V-007 (tech-spec §11),
V-008 (`02` renumber — sequence now internally consistent), V-009/V-010, and V-011/V-014/V-015/V-016
(citation/anchor sweep). Deterministic traceability remained clean.

**7 new findings** — notably **3 regressions introduced by the prior fix batch** (V-fix-1, V-fix-2,
V-fix-5) and **1 incomplete prior fix** (V-fix-4). All 7 are deterministic doc edits with no user
decisions; **all were applied directly in this pass** (see Fix Progress).

## Summary
- Total findings: 7
- Gaps: 2
- Inconsistencies: 3
- Improvements: 2

## Findings

### V-fix-1: `failRunSetup` returns fields absent from `LoopResult` (regression from V-002 fix)
- **Severity:** inconsistency
- **Location:** `05-runner-wiring.md` §4.1.1 (`failRunSetup` body)
- **Issue:** `failRunSetup(error: RaufError): LoopResult` returned `{ iterations: 0, stopReason: "error", error: error.message }`, but the committed `LoopResult` (`runner.ts:62-79`) has **none** of those fields — it is `{ completedCount; blockedCount; needsHumanCount?; cancelled; gracefulStop?; reviewItemsCreated?; reviewSummary?; pausedReason?; limitReached? }`. The §4.5 early-return already uses the correct `{ completedCount: 0, blockedCount: 0, cancelled: false }`. The fabricated shape would not type-check.
- **Suggested fix:** Return `{ completedCount: 0, blockedCount: 0, cancelled: false }`; surface the error via the already-emitted `loop_error` event. **[APPLIED]**
- **References:** `runner.ts:62-79`; `05 §4.1.1`/§4.5
- **Checklist:** CHECK-S09, CHECK-S12, CHECK-S18

### V-fix-2: `RaufError` referenced in `05 §4.1.1` but not imported (regression from V-002 fix)
- **Severity:** gap
- **Location:** `05-runner-wiring.md` §4.1 import block vs §4.1.1 `failRunSetup(error: RaufError)`
- **Issue:** The new `failRunSetup` signature names `RaufError` (a `@rauf/core` type, `schemas.ts:733`) and `LoopResult` (local to `runner.ts:62`), but the §4.1 import block imported neither.
- **Suggested fix:** Add `RaufError` to the existing `import type { Result } from "@rauf/core"` line; note `LoopResult` is in-file (no import). **[APPLIED]**
- **References:** `@rauf/core` `RaufError`; `runner.ts:62`; `05 §4.1`
- **Checklist:** CHECK-S10

### V-fix-3: tech-spec §2 export block still shows the rejected `getAgentDescriptors` shape (new tech-spec staleness)
- **Severity:** inconsistency
- **Location:** `tech-spec.md` §2 "Public API surface" (the `getAgentDescriptors // [{ id, displayName, available, binaryName }]` comment + omission of `listAgents`/`AgentAvailability`/`CliAgent`)
- **Issue:** The specs settled `getAgentDescriptors(): AgentDescriptor[]` static/synchronous (no `available`) + a separate async `listAgents(): Promise<AgentAvailability[]>` (`01 §4`, `02 §4`), but the tech-spec §2 block still documents the superseded `available`-on-descriptor shape and omits the new symbols. V-007's §11 note covered three other divergences but not this one.
- **Suggested fix:** Add a 4th bullet to `tech-spec.md §11` recording the registry export-surface refinement (static `getAgentDescriptors` + async `listAgents`/`AgentAvailability` + `CliAgent`/config exports; `01 §4` authoritative). **[APPLIED]**
- **References:** `tech-spec.md` §2/§11; `01 §4`; `02 §4`; `00 §3.3`
- **Checklist:** CHECK-S05, CHECK-S08

### V-fix-4: `AgentAdapter` not re-exported by `02 §6` `providers/index.ts` (incomplete V-006 fix)
- **Severity:** gap
- **Location:** `02-agent-registry-and-detection.md` §6 (`providers/index.ts` listing) vs `01-architecture-layout.md` §4 (`export type { AgentAdapter } from "./providers/index.js"`) and `00 §2`
- **Issue:** V-006 added `CliAgent`/`CliAgentConfig`/`PromptDelivery`/`BuildArgsContext` re-exports to `02 §6` but not `AgentAdapter`. `01 §4` re-exports `AgentAdapter from "./providers/index.js"`, and `00 §2` defines it in `providers/types.ts` — so `providers/index.ts` must re-export it from `./types.js`, else the top-level barrel can't resolve the charter type (compile error).
- **Suggested fix:** Add `AgentAdapter` to `02 §6`'s `export type { … } from "./types.js"` line. **[APPLIED]**
- **References:** `02 §6`; `01 §4`; `00 §2`; `providers/types.ts:12-33`; `providers/index.ts`
- **Checklist:** CHECK-S26, CHECK-S22

### V-fix-5: Three stale `02 §7` citations in `06` (regression from V-008 renumber sweep)
- **Severity:** inconsistency
- **Location:** `06-cli-surface.md` (three "`listAgents` never rejects per `02 §7`" citations)
- **Issue:** The V-008 renumber shifted `02` Error-handling from §7 to §8 (Configuration is now §7). The fix-pass updated `06`'s `§5.x`/`§4.4` citations but missed the three `§7` references; the never-rejects/never-throws guarantee they cite lives in `02 §8`.
- **Suggested fix:** Change all three `02 §7` → `02 §8`. **[APPLIED]**
- **References:** `06-cli-surface.md`; `02 §7` (Configuration) vs `02 §8` (Error handling)
- **Checklist:** CHECK-S15

### V-fix-6: Temp-file write-failure code left as `<IO/FILE code>` placeholder (pre-existing)
- **Severity:** improvement
- **Location:** `03-cli-agent-engine-and-presets.md` §8 error table (file-delivery write-fail row) + §4.5 comment
- **Issue:** Every other `03 §8` row names a concrete `ErrorCodes` member, but the write-fail row read `<IO/FILE code>`. `IO_ERROR` exists (`errors.ts:21-32`) and is the natural fit.
- **Suggested fix:** Use `ErrorCodes.IO_ERROR`; name it in the §4.5 comment too. **[APPLIED]**
- **References:** `errors.ts:21-32`; `03 §8`/§4.5
- **Checklist:** CHECK-S11, CHECK-S18

### V-fix-7: `verify.sh:380` citation off by 3 (the grep is at `:377`) — pre-existing
- **Severity:** improvement
- **Location:** `07-testing-strategy.md` §4.3 item 3
- **Issue:** V-013 concretized the marker string/path correctly but cited `verify.sh:380`; the real `grep -q "Usage limit detected"` is at `verify.sh:377`.
- **Suggested fix:** Change `verify.sh:380` → `verify.sh:377`. **[APPLIED]**
- **References:** `test-sandbox/verify.sh:377`
- **Checklist:** CHECK-S35

## Fix Execution Plan

### User Decisions Required
None — all 7 are deterministic doc edits, applied directly in this pass.

### Execution Steps (all applied)
1. `05 §4.1.1`/§4.1 — `failRunSetup` returns real `LoopResult` shape; `RaufError` imported (V-fix-1, V-fix-2).
2. `06` — three `02 §7` → `02 §8` (V-fix-5).
3. `02 §6` — add `AgentAdapter` to the `./types.js` re-export (V-fix-4).
4. `tech-spec.md §11` — 4th bullet on the registry export-surface refinement (V-fix-3).
5. `03 §8`/§4.5 — `IO_ERROR` named (V-fix-6).
6. `07 §4.3` — `verify.sh:377` (V-fix-7).

## Fix Progress
- [APPLIED] 2026-06-15 — V-fix-1: `05 §4.1.1` `failRunSetup` now returns `{ completedCount: 0, blockedCount: 0, cancelled: false }` (real `LoopResult`, runner.ts:62-79).
- [APPLIED] 2026-06-15 — V-fix-2: `05 §4.1` imports `RaufError` from `@rauf/core`; note that `LoopResult` is in-file.
- [APPLIED] 2026-06-15 — V-fix-3: `tech-spec.md §11` bullet 4 records the static-`getAgentDescriptors` + async-`listAgents` refinement and `CliAgent`/config exports (01 §4 authoritative).
- [APPLIED] 2026-06-15 — V-fix-4: `02 §6` re-exports `AgentAdapter` from `./types.js` (charter type resolves via the barrel chain).
- [APPLIED] 2026-06-15 — V-fix-5: `06` three `02 §7` → `02 §8` (Error handling).
- [APPLIED] 2026-06-15 — V-fix-6: `03 §8`/§4.5 name `ErrorCodes.IO_ERROR` for temp-file write failure.
- [APPLIED] 2026-06-15 — V-fix-7: `07 §4.3` cite corrected to `verify.sh:377`.

Post-fix re-validation: traceability 29 REQs / 0 uncovered / 0 orphaned; all `02 §...`/`05 §...`
section anchors resolve; no stray `02 §7` / `<IO/FILE code>` / fabricated `LoopResult` fields remain.

## Verdict

The spec suite is implementation-ready. This confirmation pass found only fix-batch fallout (3
regressions + 1 incomplete fix) and 2 pre-existing nits — all applied. A further re-verify is not
warranted; the substantive correctness issues (type shape, missing import, broken charter-export
chain, wrong citations) are resolved.
