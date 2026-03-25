# Verification Report: multi-backlog (tech)

Date: 2026-03-24
Pipeline Stage: forge-2-tech (complete, v1)
Artifacts Reviewed: specs/multi-backlog/PRD.md, specs/multi-backlog/tech-spec.md
Checks Executed: 32 of 32 (25 pass, 7 fail, 0 not-applicable)

## Summary

- Total findings: 7
- Gaps: 3
- Inconsistencies: 2
- Improvements: 2
- Errors: 0

## Findings

### V-001: Tech spec function signatures diverge from actual source for several functions

- **Severity:** inconsistency
- **Location:** tech-spec.md, section 5.1 "Core Functions — Signature Changes"
- **Issue:** The tech spec declares new signatures for several functions, but some proposed signatures do not match the actual current return types, which will cause confusion during implementation:
  1. `readIterationStatus(paths: BacklogPaths): Result<IterationStatus | null>` — the actual function returns `IterationStatus | null` directly (not wrapped in `Result`).
  2. `clearIterationStatus(paths: BacklogPaths): Result<void>` — the actual function returns `void` (not `Result<void>`).
  3. `writeIterationStatus(paths: BacklogPaths, status: IterationStatus, force?: boolean): Result<void>` — the actual function returns `Result<boolean>` (where `false` means throttled).
  4. `resetStalledItems(paths: BacklogPaths): Result<number>` — the actual function returns `Result<{ resetCount: number }>`.
  5. `deleteItem(paths: BacklogPaths, id: string): Result<BacklogItem>` — the actual function returns `Result<void>`.
     These mismatches mean the implementation spec author must decide whether to change the return types (a breaking change to existing callers) or preserve them. The tech spec should be explicit about which approach to take.
- **Suggested fix:** Update section 5.1 to match actual return types. For each function, use the current return type but replace the `projectPath: string` parameter with `paths: BacklogPaths`. Specifically: `readIterationStatus(paths: BacklogPaths): IterationStatus | null`, `clearIterationStatus(paths: BacklogPaths): void`, `writeIterationStatus(paths: BacklogPaths, status: IterationStatus, force?: boolean): Result<boolean>`, `resetStalledItems(paths: BacklogPaths): Result<{ resetCount: number }>`, `deleteItem(paths: BacklogPaths, id: string): Result<void>`. Add a note: "Signature changes are limited to replacing the `projectPath: string` parameter with `paths: BacklogPaths`. Return types are preserved to avoid breaking existing callers."
- **References:** `packages/core/src/iteration-status.ts` (lines 31, 55, 78), `packages/core/src/backlog.ts` (lines 269, 374)
- **Checklist:** CHECK-T05

### V-002: `selectNextItem` missing from signature change table

- **Severity:** gap
- **Location:** tech-spec.md, section 5.1 "Core Functions — Signature Changes"
- **Issue:** `selectNextItem` is currently exported from `packages/core/src/backlog.ts` with signature `selectNextItem(backlog: Backlog): BacklogItem | null`. It does not take `projectPath` so it does not need a signature change — this is fine. However, it is called by `LoopRunner` (imported as `selectNextItem` at line 7 of `packages/loop/src/runner.ts`). The tech spec's section 6.1 says "All exported functions replace `projectPath: string` with `paths: BacklogPaths`. Internal path helpers are deleted." This blanket statement is misleading because `selectNextItem` takes neither `projectPath` nor `BacklogPaths` — it operates purely on in-memory data. The implementation specs need to know which functions are unchanged.
- **Suggested fix:** Add a clarifying note to section 5.1 or 6.1: "Functions that do not take `projectPath` today (e.g., `selectNextItem(backlog: Backlog)`) are unchanged — they already operate on in-memory data and need no path parameter." This prevents an implementer from incorrectly adding a `BacklogPaths` parameter to every function.
- **References:** `packages/core/src/backlog.ts` line 347, `packages/loop/src/runner.ts` line 7
- **Checklist:** CHECK-T05, CHECK-T08

### V-003: `scanActiveRoots` declared as async but placement is ambiguous

- **Severity:** inconsistency
- **Location:** tech-spec.md, section 3.5 vs section 6.2
- **Issue:** Section 3.5 declares `scanActiveRoots(projectPath: string): Promise<ActiveRoot[]>` as an async function. Section 6.2 says it could live in either `backlog-root.ts` or `status.ts` ("either works"). However, all existing functions in both `status.ts` and `backlog.ts` are synchronous (using `fs.readFileSync`, `fs.existsSync`, etc.). Introducing an async function into a codebase that is entirely synchronous at the core layer is an architectural decision that deserves explicit justification. The scan algorithm described (walk + read small JSON files) can be done synchronously with `fs.readdirSync`/`fs.readFileSync` and stay under the 500ms target for 20 roots. Making it async would force all callers (CLI status command, web status route) to handle promises where they currently don't.
- **Suggested fix:** Either (a) make `scanActiveRoots` synchronous to match the existing core convention: `scanActiveRoots(projectPath: string): ActiveRoot[]`, or (b) explicitly justify the async choice in section 3.5 with a rationale (e.g., "async to avoid blocking the event loop in the web server context") and note the caller impact. Also, commit to a single home for the function — recommend `status.ts` since section 6.2 already says "status.ts is the natural home."
- **References:** `packages/core/src/status.ts` (all sync), `packages/core/src/backlog.ts` (all sync)
- **Checklist:** CHECK-T09, CHECK-T04

### V-004: `resolveInstructionPaths` declared as sync but calls `fileExists` which requires filesystem access — return type for missing RALPH.md is underspecified

- **Severity:** gap
- **Location:** tech-spec.md, section 2.2 and section 3.9
- **Issue:** Section 3.9 states `resolveInstructionPaths()` returns `null` for RALPH.md "if neither exists." However, section 3.9 also says "RALPH.md is required" in parentheses. The PRD's REQ-INST-01 says RALPH.md lookup falls back to the project-level file — but it does not say what happens if the project-level file is also missing. The tech spec should define the error behavior: does the loop fail to start, does it proceed without RALPH.md, or does it use a default? Currently in `packages/loop/src/prompt-builder.ts`, RALPH.md is read from a hardcoded path and its absence is handled by returning an error Result. The tech spec should clarify this contract.
- **Suggested fix:** Add to section 3.9: "If neither per-root nor project-level RALPH.md exists, `resolveInstructionPaths()` returns `ralphMd: null`. The loop runner treats a null `ralphMd` as a startup error and returns a `FILE_NOT_FOUND` Result, consistent with current behavior where missing RALPH.md prevents loop execution." This preserves backward compatibility.
- **References:** `packages/loop/src/prompt-builder.ts` (RALPH.md reading logic), PRD.md REQ-INST-01
- **Checklist:** CHECK-T10, CHECK-T03

### V-005: Missing `watchLog` from signature change inventory

- **Severity:** gap
- **Location:** tech-spec.md, section 5.1 and section 2.3
- **Issue:** `packages/core/src/status.ts` exports a `watchLog` function (imported by both `packages/cli/src/loop-commands.ts` and `packages/cli/src/status-commands.ts`). This function takes `projectPath` and constructs the log path internally using the `RALPH_DIR` constant. It is not listed in the tech spec's section 5.1 signature changes or section 2.3 modified modules table. If `watchLog` is not updated to accept `BacklogPaths`, the `--backlog` flag will not work for `ralph loop follow` and `ralph status --watch` commands.
- **Suggested fix:** Add `watchLog(paths: BacklogPaths, ...): ...` to section 5.1 under the `// status.ts` block. Also verify that all exported functions from `status.ts` are accounted for by grepping the source — any function that constructs paths from `projectPath` + `RALPH_DIR` needs updating.
- **References:** `packages/core/src/status.ts` (`watchLog` export), `packages/cli/src/loop-commands.ts` (imports `watchLog`), `packages/cli/src/status-commands.ts` (imports `watchLog`)
- **Checklist:** CHECK-T05, CHECK-T08

### V-006: No migration story for existing callers or incremental adoption strategy

- **Severity:** improvement
- **Location:** tech-spec.md, section 5.1
- **Issue:** The tech spec proposes changing every core function signature from `projectPath: string` to `paths: BacklogPaths` in a single sweep. This is a large breaking change affecting every callsite in `packages/loop`, `packages/cli`, and `packages/web`. The tech spec does not describe whether this should be done atomically (one massive PR) or incrementally (e.g., add overloads first, migrate callers, then remove old signatures). For a change of this scope, an incremental strategy reduces risk and makes code review tractable. At minimum, the implementation specs and backlog should account for the migration ordering.
- **Suggested fix:** Add a subsection "5.5 Migration Strategy" or a note at the top of section 5.1: "All signature changes are source-breaking. The recommended implementation order is: (1) Create `backlog-root.ts` with `BacklogPaths` and resolution functions, (2) Update core modules one at a time to accept `BacklogPaths`, adding a thin adapter at each callsite that constructs `BacklogPaths` from `projectPath`, (3) Update `LoopRunner` and CLI/web callers to construct `BacklogPaths` at the entry point and thread it through. Each step should be a separate backlog item to keep changes reviewable."
- **References:** PRD.md section 7 (Migration)
- **Checklist:** CHECK-T15

### V-007: Web backlog route not listed in section 5.4 endpoint inventory

- **Severity:** improvement
- **Location:** tech-spec.md, section 5.4 "Web API Endpoints"
- **Issue:** Section 5.4 lists `POST /:id/backlog` for creating items but omits `PUT /:id/backlog/:itemId` (update), `DELETE /:id/backlog/:itemId` (delete), and `GET /:id/backlog/:itemId` (get single item) which exist in `packages/web/src/server/routes/backlog.test.ts`. These endpoints also need to accept the `backlog` query parameter to route to the correct backlog root. The section should be a complete inventory of affected endpoints.
- **Suggested fix:** Expand section 5.4 to list all backlog CRUD endpoints and the status endpoint. For each, note whether the `backlog` parameter is a query parameter or body field. A complete list: `GET /:id/status ?backlog=`, `GET /:id/backlog ?backlog=`, `GET /:id/backlog/:itemId ?backlog=`, `POST /:id/backlog body: { ...item, backlogRoot? }`, `PUT /:id/backlog/:itemId body: { ...updates, backlogRoot? }`, `DELETE /:id/backlog/:itemId ?backlog=`, `POST /:id/loop/start body: { ...options, backlogRoot? }`, `POST /:id/loop/stop body: { backlogRoot? }`.
- **References:** `packages/web/src/server/routes/backlog.test.ts`, PRD.md REQ-CLI-05
- **Checklist:** CHECK-T04, CHECK-T08

## Fix Execution Plan

### User Decisions Required

None — all fixes can be applied directly.

### Execution Steps

#### Step 1: Fix function signature mismatches in section 5.1

- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-001
- **Checklist:** CHECK-T05
- **Action:** In section 5.1, update the following signatures to match actual source return types:
  - `readIterationStatus(paths: BacklogPaths): IterationStatus | null` (not `Result<IterationStatus | null>`)
  - `clearIterationStatus(paths: BacklogPaths): void` (not `Result<void>`)
  - `writeIterationStatus(paths: BacklogPaths, status: IterationStatus, force?: boolean): Result<boolean>` (not `Result<void>`)
  - `resetStalledItems(paths: BacklogPaths): Result<{ resetCount: number }>` (not `Result<number>`)
  - `deleteItem(paths: BacklogPaths, id: string): Result<void>` (not `Result<BacklogItem>`)
    Add a note after the signature list: "Signature changes are limited to replacing the `projectPath: string` parameter with `paths: BacklogPaths`. Return types are preserved to avoid breaking existing callers."
- **Depends on:** none
- **Rationale:** Accuracy of signatures is critical — implementation specs will be derived from these.

#### Step 2: Add `selectNextItem` clarification and `watchLog` to inventory

- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-002, V-005
- **Checklist:** CHECK-T05, CHECK-T08
- **Action:** In section 5.1, add `watchLog(paths: BacklogPaths, ...): ...` to the `// status.ts` block (check actual signature in source first). Add a note either in section 5.1 or 6.1: "Functions that do not currently accept `projectPath` (e.g., `selectNextItem(backlog: Backlog)`) are unchanged — they operate on in-memory data and need no path parameter."
- **Depends on:** none
- **Rationale:** Completeness of the function inventory prevents missed changes during implementation.

#### Step 3: Resolve `scanActiveRoots` sync/async and placement

- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-003
- **Checklist:** CHECK-T09, CHECK-T04
- **Action:** In section 3.5, either change the signature to `scanActiveRoots(projectPath: string): ActiveRoot[]` (synchronous, matching the core convention) or add an explicit rationale for async. Commit to `status.ts` as the home module. If making it synchronous, update the description to use `fs.readdirSync`/`fs.readFileSync` in the scan algorithm.
- **Depends on:** none
- **Rationale:** Consistency with existing core patterns avoids unnecessary async propagation.

#### Step 4: Clarify RALPH.md-missing error behavior

- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-004
- **Checklist:** CHECK-T10, CHECK-T03
- **Action:** In section 3.9, after the sentence about returning `null`, add: "If neither per-root nor project-level RALPH.md exists, `resolveInstructionPaths()` returns `ralphMd: null`. The loop runner treats a null `ralphMd` as a startup error and returns a `FILE_NOT_FOUND` Result, consistent with current behavior where missing RALPH.md prevents loop execution."
- **Depends on:** none
- **Rationale:** Error contract must be explicit for downstream implementation specs.

#### Step 5: Add migration strategy note

- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-006
- **Checklist:** CHECK-T15
- **Action:** Add a subsection "5.5 Migration Strategy" after section 5.4: "All signature changes in section 5.1 are source-breaking. The recommended implementation order is: (1) Create `backlog-root.ts` and `lock.ts` with all new types and functions, (2) Update core modules one at a time to accept `BacklogPaths`, adding thin adapter functions at each callsite that construct `BacklogPaths` from `projectPath`, (3) Update `LoopRunner` and CLI/web callers to construct `BacklogPaths` at the entry point and thread it through. Each step should map to a separate backlog item."
- **Depends on:** none
- **Rationale:** Guides backlog generation toward reviewable, incremental changes.

#### Step 6: Complete web API endpoint inventory

- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-007
- **Checklist:** CHECK-T04, CHECK-T08
- **Action:** Expand section 5.4 to list all affected web API endpoints including backlog CRUD routes (`GET/POST/PUT/DELETE /:id/backlog[/:itemId]`) and the status route. For each, specify whether the backlog root parameter is a query parameter or request body field.
- **Depends on:** none
- **Rationale:** Ensures the web package implementation spec has a complete contract.

## Fix Progress

- Step 1: [APPLIED] 2026-03-24 — Fixed 5 function signatures in section 5.1 to match actual source return types (V-001)
- Step 2: [APPLIED] 2026-03-24 — Added `watchLog` to status.ts signature block; added note clarifying unchanged functions like `selectNextItem` (V-002, V-005)
- Step 3: [APPLIED] 2026-03-24 — Made `scanActiveRoots` synchronous; committed to `status.ts` as home module (V-003)
- Step 4: [APPLIED] 2026-03-24 — Clarified RALPH.md-missing error behavior in section 3.9 (V-004)
- Step 5: [APPLIED] 2026-03-24 — Added section 5.5 Migration Strategy with incremental implementation order (V-006)
- Step 6: [APPLIED] 2026-03-24 — Expanded section 5.4 with complete web API endpoint inventory including all CRUD routes (V-007)
