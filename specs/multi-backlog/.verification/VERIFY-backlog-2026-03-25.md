# Verification Report: multi-backlog (backlog)
Date: 2026-03-25
Pipeline Stage: forge-4-backlog
Artifacts Reviewed: specs/multi-backlog/PRD.md, specs/multi-backlog/tech-spec.md, specs/multi-backlog/00-core-definitions.md, specs/multi-backlog/01-architecture-layout.md, specs/multi-backlog/02-backlog-root-resolution.md, specs/multi-backlog/03-lock-file-management.md, specs/multi-backlog/04-core-module-refactor.md, specs/multi-backlog/05-loop-runner-integration.md, specs/multi-backlog/06-cli-web-integration.md, specs/multi-backlog/07-testing-strategy.md, specs/multi-backlog/TRACEABILITY.md, specs/multi-backlog/backlog.json
Checks Executed: 25 of 25 (20 pass, 5 fail, 0 not-applicable)

## Summary
- Total findings: 7
- Gaps: 3
- Inconsistencies: 2
- Improvements: 2
- Errors: 0

## Findings

### V-001: Missing backlog item for MIGRATION.md deliverable
- **Severity:** gap
- **Location:** specs/multi-backlog/backlog.json
- **Issue:** PRD section 7 ("Migration") requires a `specs/multi-backlog/MIGRATION.md` deliverable containing step-by-step migration instructions and a self-contained agent prompt for automating migration. No backlog item covers creating this document. The migration guide is a PRD deliverable, not an open question.
- **Suggested fix:** Add a new backlog item (e.g., id "016") of type "chore", priority 2, with title "Create MIGRATION.md migration guide" that produces `specs/multi-backlog/MIGRATION.md`. Acceptance criteria should include: (1) document exists at the specified path, (2) contains step-by-step instructions for updating a legacy single-backlog project, (3) includes a self-contained agent prompt that can be pasted into a Claude Code session, (4) covers the scenario where the default root layout is unchanged (no migration needed for most projects). It should have `dependsOn: ["006"]` (after core refactors are done so the migration instructions are accurate). Add `specReferences: ["specs/multi-backlog/PRD.md"]`.
- **References:** PRD.md section 7
- **Checklist:** CHECK-B08, CHECK-B22

### V-002: Tech spec has incorrect return type for restoreFromBackup
- **Severity:** inconsistency
- **Location:** specs/multi-backlog/tech-spec.md, section 5.1 "Core Functions -- Signature Changes"
- **Issue:** The tech spec declares `restoreFromBackup(paths: BacklogPaths): Result<Backlog>` but the actual function in `packages/core/src/backlog.ts:317` returns `Result<void>`. The implementation spec 04-core-module-refactor.md section 2.3 correctly uses `Result<void>`. Since the tech spec is a reference document that implementers may consult, this creates a risk of confusion.
- **Suggested fix:** Change line in tech-spec.md section 5.1 from `export function restoreFromBackup(paths: BacklogPaths): Result<Backlog>;` to `export function restoreFromBackup(paths: BacklogPaths): Result<void>;`.
- **References:** packages/core/src/backlog.ts:317, specs/multi-backlog/04-core-module-refactor.md section 2.3
- **Checklist:** CHECK-B09

### V-003: Tech spec has incorrect return type for readLogTail
- **Severity:** inconsistency
- **Location:** specs/multi-backlog/tech-spec.md, section 5.1 "Core Functions -- Signature Changes"
- **Issue:** The tech spec declares `readLogTail(paths: BacklogPaths, lines?: number): Result<string>` but the actual function in `packages/core/src/status.ts:327` returns `Result<string[]>` (an array). The implementation spec 04-core-module-refactor.md section 3.3 correctly uses `Result<string[]>`. An implementer following the tech spec could introduce a type mismatch.
- **Suggested fix:** Change line in tech-spec.md section 5.1 from `export function readLogTail(paths: BacklogPaths, lines?: number): Result<string>;` to `export function readLogTail(paths: BacklogPaths, lines?: number): Result<string[]>;`.
- **References:** packages/core/src/status.ts:327, specs/multi-backlog/04-core-module-refactor.md section 3.3
- **Checklist:** CHECK-B09

### V-004: Item 009 may be too large for a single loop iteration
- **Severity:** improvement
- **Location:** specs/multi-backlog/backlog.json, item 009
- **Issue:** Item 009 ("Update LoopRunner to use BacklogPaths and lock lifecycle") has 10 acceptance criteria and requires touching every core function call in the LoopRunner class, converting the constructor to a static factory pattern, adding lock lifecycle, and updating two prompt-builder calls. It has 5 dependencies. The `estimatedIterations` is 1, but the scope is substantial: the LoopRunner `start()` method is complex (acquisition, state dir creation, instruction resolution, lock lifecycle in finally block), and every core function call must be updated. This is the riskiest single item in the backlog.
- **Suggested fix:** Consider splitting item 009 into two items: (a) "Convert LoopRunner to static factory pattern and add BacklogPaths field" (constructor changes, create() method, paths field) and (b) "Add lock lifecycle and update all core function calls in LoopRunner" (acquireLock/releaseLock in start/finally, replace all projectPath calls with this.paths). This reduces risk of a partial completion requiring rollback. If you prefer to keep it as one item, at minimum increase `estimatedIterations` to 2.
- **References:** specs/multi-backlog/05-loop-runner-integration.md sections 2.1-2.6
- **Checklist:** CHECK-B11, CHECK-B25

### V-005: No backlog item covers writeLoopState signature change verification in LoopRunner callers
- **Severity:** gap
- **Location:** specs/multi-backlog/backlog.json, item 009
- **Issue:** Item 009 covers updating LoopRunner's core function calls from `this.projectPath` to `this.paths`. However, the `writeLoopState` function in `status.ts` has a more complex signature -- `writeLoopState(projectPath: string, state: LoopState)` -- and the current LoopRunner calls it via a private `writeState` helper method. Item 009's description mentions the `writeState` helper in section 2.6 of spec 05, but neither item 009's acceptance criteria nor description explicitly mention updating `writeState`. If the agent misses this private helper, it will cause a type error. The spec does cover it, but the backlog item's description should be explicit.
- **Suggested fix:** Add to item 009's description, in the list of core function calls to update (step 4), an explicit mention: "Update the private `writeState()` helper method to pass `this.paths` to `writeLoopState` (see spec 05 section 2.6)." This is already in the spec reference, but making it explicit in the item prevents oversights.
- **References:** specs/multi-backlog/05-loop-runner-integration.md section 2.6
- **Checklist:** CHECK-B12, CHECK-B14

### V-006: Backlog items lack explicit REQ-ID traceability in acceptance criteria
- **Severity:** improvement
- **Location:** specs/multi-backlog/backlog.json (all items)
- **Issue:** None of the 15 backlog items reference PRD requirement IDs (REQ-XXX-NN) in their acceptance criteria or descriptions. While every item has `specReferences` pointing to implementation spec documents (which in turn trace to requirements), the lack of direct REQ-ID references means there is no quick way to verify that all P0 requirements are covered by at least one backlog item's acceptance criteria without traversing through the spec documents. The spec references provide indirect traceability, but direct references would make coverage auditing faster.
- **Suggested fix:** This is a style improvement, not a blocking issue. If desired, add a comment in key items mapping to the P0 requirements they satisfy. For example, item 002's notes could add: "Covers REQ-ROOT-01 through REQ-ROOT-04, REQ-STATE-01 through REQ-STATE-04, REQ-CLI-02, REQ-CLI-04, REQ-SEC-01, REQ-ARCH-01, REQ-ARCH-02." This is optional -- the existing spec references provide equivalent traceability.
- **References:** specs/multi-backlog/TRACEABILITY.md, specs/multi-backlog/PRD.md section 10
- **Checklist:** CHECK-B08

### V-007: Item 013 has lower priority than items that depend on its capability
- **Severity:** gap
- **Location:** specs/multi-backlog/backlog.json, item 013
- **Issue:** Item 013 ("Update web API routes and LoopManager for backlog root") has priority 2, while item 015 ("End-to-end verification") also has priority 2 and depends on item 013. This is consistent. However, PRD REQ-CLI-05 ("When the web server is running and `--backlog` is specified, the CLI must pass the backlog root path to the server API") is P0. Item 013 is the item that implements the server-side of REQ-CLI-05 (the routes that receive the backlog root parameter). Item 011 implements the CLI side (passing the parameter). Without item 013, the `--backlog` flag will fail when the web server is running because the server won't know how to handle the `backlogRoot` parameter. A P0 requirement should not be gated behind a priority 2 item.
- **Suggested fix:** Change item 013's priority from 2 to 1. REQ-CLI-05 is P0 and cannot be fully satisfied without the server-side changes in item 013.
- **References:** specs/multi-backlog/PRD.md section 3.3 REQ-CLI-05, specs/multi-backlog/06-cli-web-integration.md section 3
- **Checklist:** CHECK-B08, CHECK-B19

## Fix Execution Plan

### User Decisions Required
1. **V-001 (Migration guide):** ~~Confirm whether the MIGRATION.md deliverable should be added as a backlog item now or deferred.~~ **RESOLVED:** User approved adding item 016.
2. **V-004 (Item 009 scope):** ~~Decide whether to split item 009 into two items or keep as one with increased iteration estimate.~~ **RESOLVED:** User chose to keep as one item with estimatedIterations bumped to 2.

### Execution Steps

#### Step 1: Fix tech-spec return type inconsistencies
- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-002, V-003
- **Checklist:** CHECK-B09
- **Action:** In section 5.1 "Core Functions -- Signature Changes":
  - Change `restoreFromBackup(paths: BacklogPaths): Result<Backlog>` to `restoreFromBackup(paths: BacklogPaths): Result<void>`
  - Change `readLogTail(paths: BacklogPaths, lines?: number): Result<string>` to `readLogTail(paths: BacklogPaths, lines?: number): Result<string[]>`
- **Depends on:** none
- **Rationale:** These are factual errors in the tech spec that could mislead implementers. Fix first since other steps reference the tech spec.

#### Step 2: Change item 013 priority from 2 to 1
- **Files:** `specs/multi-backlog/backlog.json`
- **Addresses:** V-007
- **Checklist:** CHECK-B08, CHECK-B19
- **Action:** In item 013, change `"priority": 2` to `"priority": 1`. This aligns the item priority with the P0 requirement (REQ-CLI-05) it implements.
- **Depends on:** none
- **Rationale:** P0 requirements should not be gated behind priority 2 items.

#### Step 3: Add explicit writeState mention to item 009
- **Files:** `specs/multi-backlog/backlog.json`
- **Addresses:** V-005
- **Checklist:** CHECK-B12, CHECK-B14
- **Action:** In item 009's description, in step 4 ("Replace ALL core function calls..."), add the line: `- Update the private writeState() helper method to pass this.paths to writeLoopState (see spec 05 section 2.6)` after the existing `writeLoopState` line.
- **Depends on:** none
- **Rationale:** Makes the implicit explicit so the implementing agent does not miss this private helper.

#### Step 4: Add migration guide backlog item (if user approves)
- **Files:** `specs/multi-backlog/backlog.json`
- **Addresses:** V-001
- **Checklist:** CHECK-B08, CHECK-B22
- **Action:** Add a new item after item 015:
  ```json
  {
    "id": "016",
    "type": "chore",
    "priority": 2,
    "title": "Create MIGRATION.md migration guide with agent prompt",
    "description": "Create specs/multi-backlog/MIGRATION.md per PRD section 7. Include: (1) step-by-step instructions for updating a legacy single-backlog project, (2) a self-contained agent prompt that can be pasted into a Claude Code session, (3) note that projects using only .ralph/ default root need no migration.",
    "acceptanceCriteria": [
      "specs/multi-backlog/MIGRATION.md exists",
      "Contains step-by-step instructions for updating legacy single-backlog projects",
      "Contains a self-contained agent prompt for automated migration",
      "Notes that projects using only .ralph/ default root need no migration"
    ],
    "status": "pending",
    "dependsOn": ["006"],
    "notes": "PRD section 7 requires this deliverable.",
    "estimatedIterations": 1,
    "specReferences": ["specs/multi-backlog/PRD.md"]
  }
  ```
- **Depends on:** User decision on V-001
- **Rationale:** Fulfills a PRD deliverable requirement. Low priority since the default root layout is unchanged.

#### Step 5: Optionally split item 009 or increase iteration estimate
- **Files:** `specs/multi-backlog/backlog.json`
- **Addresses:** V-004
- **Checklist:** CHECK-B11, CHECK-B25
- **Action:** Either split item 009 into two items (009a: factory pattern + BacklogPaths field; 009b: lock lifecycle + all core call updates) OR change `"estimatedIterations": 1` to `"estimatedIterations": 2` in the existing item.
- **Depends on:** User decision on V-004
- **Rationale:** Reduces risk of partial completion in a single iteration.

## Fix Progress

- Step 1: [APPLIED] 2026-03-25 — Fixed restoreFromBackup return type to Result<void> and readLogTail return type to Result<string[]> in tech-spec.md
- Step 2: [APPLIED] 2026-03-25 — Changed item 013 priority from 2 to 1 (P0 requirement REQ-CLI-05)
- Step 3: [APPLIED] 2026-03-25 — Added explicit writeState() helper mention to item 009 step 4
- Step 4: [APPLIED] 2026-03-25 — Added item 016 "Create MIGRATION.md migration guide with agent prompt" (user approved)
- Step 5: [APPLIED] 2026-03-25 — Changed item 009 estimatedIterations from 1 to 2 (user chose to keep as one item)
