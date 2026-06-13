# Verification Report: ux-overhaul-grammar (backlog)
Date: 2026-06-13
Pipeline Stage: forge-5-loop (backlog verification)
Artifacts Reviewed: backlog.json (14 items), PRD.md, tech-spec.md, 00-core-definitions.md … 06-testing-strategy.md, TRACEABILITY.md

Method: 4 parallel `forge-verifier` instances — (1) item scoping & AC, (2) dependency/ordering sanity,
(3) spec coverage & traceability, (4) schema/enum correctness — plus the authoritative
`rauf-stable backlog validate` (**exit 0, valid:true, 0 findings**). Cross-dimension overlaps deduped + renumbered.

## Summary
- Total findings: 8
- Errors: 0 (validator clean; schema/enum dimension 0 findings)
- Gaps: 3 (V-001, V-002, V-004)
- Inconsistencies: 1 (V-003)
- Improvements: 4 (V-005, V-006, V-007, V-008)

Overall: structurally sound — `rauf-stable backlog validate` passes (exit 0), schema/enums all correct,
the DAG is valid, every in-scope REQ maps to an item, and the REQ-CONTRACT-04/05 out-of-loop exclusion is
explicit. The findings are: two coverage gaps where an item's AC forces work its description/subtasks don't
enumerate (item 003 file list; the `loop stop` change owned by no item), one version-bump dependency that
under-gates the 0.5.0 advertisement, and AC/dependency polish. All are backlog.json metadata edits.

## Findings

### V-001: Item 003 under-enumerates files its own atomic AC forces (loop-commands.ts CONFLICT sites + migrate-commands.ts)
- **Severity:** gap
- **Location:** backlog.json item 003 (description "Affected files" + `agentDelegation.subtasks`)
- **Issue:** Item 003 redefines the `ExitCode` const (dropping the old keys) and its AC requires `grep -rE 'ExitCode\.(INVALID_ARGS|NOT_FOUND|VALIDATION|CONFLICT|PAUSED_HUMAN)' packages/*/src` to return **no matches** + a green workspace `pnpm typecheck`. But its enumerated file list / delegation subtasks **omit `packages/cli/src/loop-commands.ts`**, which per 03 §2 has 4 `ExitCode.CONFLICT → USAGE` sites (~:305/:672/:691/:711, the loop-already-running/lock-conflict 409 paths — NOT the :982 PAUSED_HUMAN terminal, which is item 004's) plus matching `loop-commands.test.ts` assertions (~:597/:733/:760). The inline list also omits `migrate-commands.ts` (LOCK_CONFLICT/INVALID_JSON→USAGE per 03 §2). Since item 003 is parallelized via `agentDelegation`, a sub-agent dispatched purely from the subtasks array would never touch loop-commands.ts — leaving a hard compile error and breaking the atomic-commit invariant. (The grep AC + workspace typecheck would ultimately catch it, but the description must assign the work for the delegation to be correct.)
- **Suggested fix:** Add `packages/cli/src/loop-commands.ts` (the 4 CONFLICT sites ~:305/:672/:691/:711 ONLY, explicitly not :982) and `packages/cli/src/migrate-commands.ts` to item 003's "Affected files" sentence, and add a subtask: "Re-point the 4 `ExitCode.CONFLICT` loop-already-running/lock-conflict sites in loop-commands.ts (~:305/:672/:691/:711) to USAGE per 03 §2 — do NOT touch :982 (item 004 owns the loop-run terminal mapping)." Add the loop-commands.test.ts CONFLICT assertions (~:597/:733/:760) to the test-re-point subtask.
- **References:** 03-exit-codes.md §2; packages/cli/src/loop-commands.ts:305/672/691/711, migrate-commands.ts; backlog item 004 (owns :982)
- **Checklist:** CHECK-B01, CHECK-B02, CHECK-B17, CHECK-B18

### V-002: The `loop stop` exit-code remap + stale hint (REQ-EXEC-05/REQ-DOC-02) is owned by no item's AC
- **Severity:** gap
- **Location:** backlog.json items 003, 010 (the candidates touching `loop stop`)
- **Issue:** 06 §1 + 02 §4 specify two concrete `loop stop` changes: (a) its no-server / no-loop-to-stop paths exit USAGE(2) (were ERROR/NOT_FOUND), and (b) its hint string at `loop-commands.ts:~431` referencing `rauf loop start` must become `rauf loop run --detached` (REQ-DOC-02 no-stale-verb rule). No item owns either: item 003's CONFLICT re-points are the loop-already-running sites (not the loop stop no-loop path), item 006 explicitly defers messaging, and item 010 scopes its locus to `commands.ts` SubcommandDef strings while the hint lives in `loop-commands.ts`. A fresh agent would leave both undone, violating item 010's own "no stale token … or the loop stop hint" AC.
- **Suggested fix:** (a) Add an AC to item 003: "`loop stop` no-server / no-loop-to-stop paths return USAGE(2) (were ERROR/NOT_FOUND)" and include the relevant loop-commands.ts site in its file list. (b) Extend item 010's file scope to `packages/cli/src/loop-commands.ts` and add to its description + an AC: "Update the `handleLoopStop` hint at loop-commands.ts:~431 — replace `rauf loop start` with `rauf loop run --detached` (02 §4 / REQ-DOC-02)." (This hint is distinct from the item-009 remediation interceptor.)
- **References:** 06-testing-strategy.md §1; 02-execution-grammar.md §4; 05 §6b; packages/cli/src/loop-commands.ts:431; backlog items 003, 010
- **Checklist:** CHECK-B01, CHECK-B03, CHECK-B17, CHECK-B18

### V-003: Version-bump item 013 under-gates the v0.5.0 advertisement
- **Severity:** inconsistency
- **Location:** backlog.json item 013 (`dependsOn: ["003","004","005","006"]`) vs 01 §3 step 7 + 00 §6
- **Issue:** Item 013 bumps the rauf version to 0.5.0 — the single token feature-forge's `minRunnerVersion` gate keys on to require "the **whole new contract** in one check" (00 §6). But its deps omit the review-signal contract (001, 002) and the removed-command remediation (009), so an autonomous loop could land 013 (advertising version 0.5.0) while those contract pieces are still unmerged — a dishonest advertisement. 01 §3 step 7 says the cutover "depends on 1–6 landing" (i.e. items 001–012). The version bump has no *technical* code dep on any of these (it compiles regardless), so the dep set is purely a correctness gate and is currently too narrow.
- **Suggested fix:** Expand item 013's `dependsOn` to honestly gate the advertised contract. Minimum: add `"001"`, `"002"`, `"009"`. To match 01 §3 step 7 literally: `["001","002","003","004","005","006","007","008","009","010","011","012"]`. Update its notes to enumerate the expanded set. (Item 014 already transitively gates on everything, so the final gate is safe regardless — but 013 itself shouldn't advertise prematurely.)
- **References:** 00-core-definitions.md §6; 01-architecture-layout.md §3 step 7; 05 §2; backlog items 001/002/009
- **Checklist:** CHECK-B07, CHECK-B08

### V-004: Docs item 012 omits the exit-code-mapping items (004/005) whose tables it documents
- **Severity:** gap
- **Location:** backlog.json item 012 (`dependsOn: ["003","006","009"]`)
- **Issue:** Item 012 updates docs/SPEC-CLI.md to "fix the status + loop run exit-code tables to the unified scheme." The *content* of those tables is the landed behavior of item 004 (loop run terminal mapping) and item 005 (statusExitCode incl. derived BLOCKED), not just the const from 003. 01 §3 step 6 gates docs on the landed surface (steps 1–5). Depending only on [003,006,009], item 012 could land before 004/005, documenting mappings not yet implemented.
- **Suggested fix:** Add `"004"` and `"005"` to item 012's `dependsOn` → `["003","004","005","006","009"]`; note the dependency.
- **References:** 01-architecture-layout.md §3 step 6; 00 §2a/§2b; backlog items 004/005
- **Checklist:** CHECK-B07, CHECK-B09

### V-005: Item 014 acceptance criterion #2 is subjective ("are all covered")
- **Severity:** improvement
- **Location:** backlog.json item 014, acceptanceCriteria #2
- **Issue:** "The spec-06 test areas are all covered (…)" isn't objectively checkable in one pass — it requires re-deriving spec-06's coverage matrix and judging completeness. The item's own note concedes most coverage exists in earlier items' ACs and 014 "closes any gaps" — so the verifiable action is "the named gaps are closed."
- **Suggested fix:** Rewrite AC #2 as an enumerated checklist of the specific spec-06 tests not already pinned by an earlier item's AC — at minimum (a) the `loop stop` USAGE(2)+hint test (per V-002) and (b) the call-site-audit regression (no removed ExitCode member names in source) — plus "every REQ row in 06 §Requirement-Coverage maps to ≥1 passing test (enumerate)". Turn the judgment into a test-presence audit.
- **References:** 06-testing-strategy.md §1 + §Requirement Coverage; backlog items 003, 010
- **Checklist:** CHECK-B03

### V-006: Item 005 acceptance criterion #2 disjunction weakens verifiability
- **Severity:** improvement
- **Location:** backlog.json item 005, acceptanceCriteria #2
- **Issue:** "…yields BLOCKED(5) (via the widened signature), OR the deferred-widening known-gap is documented per 03 §4." The spec-sanctioned disjunction lets the item be "done" two ways; a verifier can't tell which branch was taken or whether the harder widening path was silently skipped.
- **Suggested fix:** Split into AC-2a "statusExitCode is widened to (state, derived) and clean-terminal + genuine-blocked>0 returns BLOCKED(5)" and AC-2b (deferral branch) "if deferred, 03 §4 records the known gap AND a test asserts terminal-with-blocked currently maps to SUCCESS(0)" — making the escape hatch a checkable artifact (matches 06 §1's own instruction).
- **References:** 03-exit-codes.md §4; 06-testing-strategy.md §1
- **Checklist:** CHECK-B03

### V-007: Item 010 → 008 dependency is an ordering preference, not a technical need
- **Severity:** improvement
- **Location:** backlog.json item 010 (`dependsOn: ["006","008","009"]`)
- **Issue:** Item 010 updates help/usage strings. Item 008's work (forwarding `--backlog` into the detached POST body, NDJSON under `--follow`) is runtime behavior, not help-string content; the flag *doc entries* come from item 006 and the flags are Phase-1-inherited. So `010 → 008` over-constrains the DAG and needlessly serializes disjoint work. `010 → 006` and `010 → 009` are correct.
- **Suggested fix:** Drop `"008"` from item 010's `dependsOn` → `["006","009"]`. (If you prefer documenting the canon only after it's fully implemented, leave it and note it as a deliberate ordering preference.)
- **References:** 02-execution-grammar.md §8 + §6; backlog items 006/008/009
- **Checklist:** CHECK-B08

### V-008: Item 012 references exit-code spec content (00 §1 / 03) but doesn't list those specs in specReferences
- **Severity:** improvement
- **Location:** backlog.json item 012 (`specReferences`)
- **Issue:** Item 012's description says "fix the … exit-code tables to the unified scheme (00 §1 / 03)", but specReferences lists only 05-cutover-and-feature-forge.md. The authoritative table values live in 00 §1 + 03 §6; an agent acting on 012 in isolation lacks the source.
- **Suggested fix:** Add `specs/ux-overhaul-grammar/00-core-definitions.md` and `specs/ux-overhaul-grammar/03-exit-codes.md` to item 012's `specReferences`.
- **References:** 05 §6a; 00 §1; 03 §6; backlog item 012
- **Checklist:** CHECK-B19

## Fix Execution Plan

### User Decisions Required
None — all are backlog.json metadata edits with unambiguous corrections. Re-run `rauf-stable backlog validate` after (all added specReference paths exist, so it stays exit 0).

### Execution Steps

#### Step 1: Complete item 003's file list + subtasks (loop-commands.ts CONFLICT sites + migrate-commands.ts) and add the loop stop USAGE AC
- **Files:** specs/ux-overhaul-grammar/backlog.json (item 003)
- **Addresses:** V-001, V-002(a)
- **Checklist:** CHECK-B01, CHECK-B02, CHECK-B17, CHECK-B18
- **Action:** Add loop-commands.ts (CONFLICT sites ~:305/:672/:691/:711, NOT :982) + migrate-commands.ts to the description's affected-files list; add the corresponding agentDelegation subtask + the loop-commands.test.ts CONFLICT assertions to the test subtask; add an AC "`loop stop` no-server / no-loop-to-stop paths return USAGE(2)".
- **Depends on:** none

#### Step 2: Assign the loop stop stale-hint edit to item 010 + extend its scope
- **Files:** specs/ux-overhaul-grammar/backlog.json (item 010)
- **Addresses:** V-002(b)
- **Checklist:** CHECK-B17, CHECK-B18
- **Action:** Add packages/cli/src/loop-commands.ts to item 010's scope; description += "Update the handleLoopStop hint at loop-commands.ts:~431 — replace `rauf loop start` with `rauf loop run --detached` (02 §4 / REQ-DOC-02)"; add AC "The loop stop no-server hint references `rauf loop run --detached`, not `rauf loop start`."
- **Depends on:** none

#### Step 3: Fix dependency edges (013 expand, 012 add 004/005, 010 drop 008)
- **Files:** specs/ux-overhaul-grammar/backlog.json (items 013, 012, 010)
- **Addresses:** V-003, V-004, V-007
- **Checklist:** CHECK-B07, CHECK-B08, CHECK-B09
- **Action:** 013 `dependsOn` → `["001","002","003","004","005","006","007","008","009","010","011","012"]` (honest v0.5.0 gate); 012 `dependsOn` += "004","005"; 010 `dependsOn` drop "008" → `["006","009"]`. Update affected notes.
- **Depends on:** none

#### Step 4: Tighten ACs + specReferences (014, 005, 012)
- **Files:** specs/ux-overhaul-grammar/backlog.json (items 014, 005, 012)
- **Addresses:** V-005, V-006, V-008
- **Checklist:** CHECK-B03, CHECK-B19
- **Action:** 014 — rewrite AC#2 to an enumerated test-presence checklist (incl. loop stop test + call-site-audit regression). 005 — split AC#2 into widened-path + deferred-known-gap-with-test ACs. 012 — add 00-core-definitions.md + 03-exit-codes.md to specReferences.
- **Depends on:** none

#### Step 5: Re-validate
- **Files:** —
- **Addresses:** all
- **Checklist:** —
- **Action:** Run `rauf-stable backlog validate . --backlog specs/ux-overhaul-grammar --specs-dir specs/ux-overhaul-grammar --json`; confirm exit 0.
- **Depends on:** Steps 1–4

## Fix Progress
- Step 1: [APPLIED] 2026-06-13 — V-001/V-002a: item 003 — added loop-commands.ts CONFLICT sites (~:305/:672/:691/:711, NOT :982) to affected-files + a new agentDelegation subtask (concurrency 4→5) + loop-commands.test.ts CONFLICT assertions; added AC "loop stop no-server/no-loop paths return USAGE(2)".
- Step 2: [APPLIED] 2026-06-13 — V-002b: item 010 — extended scope to loop-commands.ts (handleLoopStop hint ~:431 `rauf loop start`→`rauf loop run --detached`) + matching AC.
- Step 3: [APPLIED] 2026-06-13 — V-003/V-004/V-007: deps — 013 dependsOn→[001..012] (honest v0.5.0 gate) + notes; 012 dependsOn+=[004,005]; 010 dependsOn dropped 008→[006,009].
- Step 4: [APPLIED] 2026-06-13 — V-005/V-006/V-008: 014 AC#2 rewritten to an enumerated test-presence audit (loop stop + call-site-audit regression + parity); 005 AC#2 split into widened-path + deferred-known-gap-with-test; 012 specReferences += 00-core-definitions.md, 03-exit-codes.md.
- Step 5: [APPLIED] 2026-06-13 — re-ran `rauf-stable backlog validate` → exit 0, valid:true, 0 findings.

All 8 findings applied. Verify stage → findings-applied.
