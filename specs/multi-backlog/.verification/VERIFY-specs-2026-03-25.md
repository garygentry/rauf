# Verification Report: multi-backlog (specs)
Date: 2026-03-25
Pipeline Stage: forge-3-specs (complete, v1)
Artifacts Reviewed: specs/multi-backlog/PRD.md, specs/multi-backlog/tech-spec.md, specs/multi-backlog/00-core-definitions.md, specs/multi-backlog/01-architecture-layout.md, specs/multi-backlog/02-backlog-root-resolution.md, specs/multi-backlog/03-lock-file-management.md, specs/multi-backlog/04-core-module-refactor.md, specs/multi-backlog/05-loop-runner-integration.md, specs/multi-backlog/06-cli-web-integration.md, specs/multi-backlog/07-testing-strategy.md, specs/multi-backlog/TRACEABILITY.md
Checks Executed: 38 of 38 (30 pass, 6 fail, 2 not-applicable)

## Summary
- Total findings: 8
- Gaps: 3
- Inconsistencies: 4
- Improvements: 1
- Errors: 0

## Findings

### V-001: Orphaned REQ-TMPL-01 reference in traceability and specs
- **Severity:** inconsistency
- **Location:** TRACEABILITY.md, P1 Requirements table; 05-loop-runner-integration.md, Requirement Coverage table
- **Issue:** TRACEABILITY.md and 05-loop-runner-integration.md both reference `REQ-TMPL-01` ("Templates use generic path wording"), but this requirement ID does not exist in the PRD. The traceability validation script flagged `REQ-TMPL-01` as an orphaned reference. The artifact template update requirement is implicitly part of the RALPH.md/REVIEW.md fallback behavior (REQ-INST-01, REQ-INST-02), but was never formally assigned a REQ ID in the PRD.
- **Suggested fix:** Either (a) remove `REQ-TMPL-01` from TRACEABILITY.md and 05-loop-runner-integration.md and instead reference REQ-INST-01 for the template update section, or (b) add `REQ-TMPL-01` to the PRD section 3.6 as a formal P1 requirement: "REQ-TMPL-01: Artifact templates (RALPH.md.tmpl, CLAUDE_ADDON.md, CLAUDE_GREENFIELD.md.tmpl) must use path-agnostic wording, relying on runtime prompt injection to provide actual paths. Priority: P1." Option (b) is preferred since the template changes are a distinct, non-trivial work item.
- **References:** PRD.md section 3.6, TRACEABILITY.md P1 table, 05-loop-runner-integration.md section 4
- **Checklist:** CHECK-S04, CHECK-S01

### V-002: Inconsistent placement of LockFileContent, LockFileContentSchema, and LockStatus types
- **Severity:** inconsistency
- **Location:** 00-core-definitions.md sections 1.3, 1.4, 1.6; 03-lock-file-management.md section 1; 01-architecture-layout.md section 2
- **Issue:** There is a conflict about where lock-related types physically live in code. 00-core-definitions.md defines `LockFileContent`, `LockFileContentSchema`, and `LockStatus` as standalone types (the document itself is silent on which source file they belong to). 03-lock-file-management.md section 1 says the import is `from "./schemas.js"` for these types: `import { LockFileContentSchema, type LockFileContent, type LockStatus } from "./schemas.js";`. But 01-architecture-layout.md section 2 shows `lock.ts` exports `LockFileContent, LockFileContentSchema, LockStatus` directly from itself. Meanwhile 00-core-definitions.md section 1.5 shows `ActiveRoot` importing `LoopStateEnum` from `"./schemas.js"`, which is correct. The inconsistency is that if lock types live in `lock.ts` (per 01-architecture-layout.md), then the import in 03-lock-file-management.md should be from `"./backlog-root.js"` or from the same file (self-reference), not from `"./schemas.js"`.
- **Suggested fix:** Decide on a single canonical home. The cleanest approach is: `LockFileContent` interface and `LockFileContentSchema` Zod schema live in `lock.ts` (alongside the functions that use them). `LockStatus` also lives in `lock.ts`. Update 03-lock-file-management.md section 1 to remove the `from "./schemas.js"` import and instead note that these types are defined locally within `lock.ts`. Also update 01-architecture-layout.md to be explicit that `lock.ts` defines these types internally rather than importing them.
- **References:** 00-core-definitions.md sections 1.3-1.6, 01-architecture-layout.md section 2, 03-lock-file-management.md section 1
- **Checklist:** CHECK-S12, CHECK-S17

### V-003: ActiveRoot type imported from wrong module in 04-core-module-refactor.md
- **Severity:** inconsistency
- **Location:** 04-core-module-refactor.md, section 3.2
- **Issue:** Section 3.2 shows `import type { BacklogPaths, ActiveRoot } from "./backlog-root.js";` in `status.ts`. However, `ActiveRoot` is defined in `00-core-definitions.md` section 1.5 with an import of `LoopStateEnum` from `"./schemas.js"`. Based on 01-architecture-layout.md section 2, `backlog-root.ts` exports `BacklogPaths` and `InstructionPaths`, not `ActiveRoot`. `ActiveRoot` would need to live either in `backlog-root.ts` (which is possible but not stated in its exports list in 01-architecture-layout.md section 2) or in `status.ts` itself (since `scanActiveRoots` returns `ActiveRoot[]` and is defined in `status.ts`). The architecture layout's export list for `backlog-root.ts` does not include `ActiveRoot`.
- **Suggested fix:** Update 01-architecture-layout.md section 2 to add `ActiveRoot` to the exports of `backlog-root.ts`, OR move `ActiveRoot` definition to `status.ts` and update the import in 04-core-module-refactor.md section 3.2 to not import it from `backlog-root.js`. Given that `ActiveRoot` is a simple type with no dependencies on `BacklogPaths`, putting it in `status.ts` (where `scanActiveRoots` lives) is more natural. Update 00-core-definitions.md to note that `ActiveRoot` is defined in `status.ts`, and update 04-core-module-refactor.md section 3.2 import accordingly.
- **References:** 00-core-definitions.md section 1.5, 01-architecture-layout.md section 2, 04-core-module-refactor.md section 3.2
- **Checklist:** CHECK-S12, CHECK-S17

### V-004: LoopRunner constructor change from public to private factory is not reflected in LoopManager spec
- **Severity:** inconsistency
- **Location:** 06-cli-web-integration.md, section 3.2
- **Issue:** 05-loop-runner-integration.md section 2.1 changes the `LoopRunner` to use a private constructor with a `static create()` factory method returning `Result<LoopRunner>`. However, 06-cli-web-integration.md section 3.2 still shows `const runner = new LoopRunner(projectPath, options);` inside `LoopManager.startLoop()`. This would be a compile error since the constructor is now private. The LoopManager must use `LoopRunner.create(projectPath, options)` and handle the Result.
- **Suggested fix:** Update 06-cli-web-integration.md section 3.2 `LoopManager.startLoop()` to use the factory: replace `const runner = new LoopRunner(projectPath, options);` with `const runnerResult = LoopRunner.create(projectPath, options); if (!runnerResult.ok) { return { ok: false, error: runnerResult.error.message }; } const runner = runnerResult.value;`
- **References:** 05-loop-runner-integration.md section 2.1 (private constructor, static create), 06-cli-web-integration.md section 3.2 (LoopManager)
- **Checklist:** CHECK-S08, CHECK-S14

### V-005: `unblockItems` return type inconsistency between spec and source
- **Severity:** gap
- **Location:** 04-core-module-refactor.md, section 2.3; tech-spec.md, section 5.1
- **Issue:** The tech-spec (section 5.1) lists the signature as `export function unblockItems(paths: BacklogPaths, itemId?: string): Result<number>;` with a return type of `Result<number>`. However, the actual source code at `packages/core/src/backlog.ts:428` shows the return type is `Result<{ unblockedCount: number; unblockedIds: string[] }>`. The implementation spec 04-core-module-refactor.md section 2.3 does not mention `unblockItems` at all in the signature changes table, only listing it in section 2.4 as "Unchanged: ... `unblockItems`" which is incorrect since its first parameter must change from `projectPath` to `BacklogPaths`. The signature table in section 2.3 does include `unblockItems` but the return type shown is `Result<...>` (ellipsis) which is ambiguous.
- **Suggested fix:** In tech-spec.md section 5.1, correct the `unblockItems` return type to `Result<{ unblockedCount: number; unblockedIds: string[] }>` to match the actual codebase. In 04-core-module-refactor.md section 2.3, ensure `unblockItems` is in the signature changes table with: Before: `(projectPath: string, itemId?: string): Result<{ unblockedCount: number; unblockedIds: string[] }>`, After: `(paths: BacklogPaths, itemId?: string): Result<{ unblockedCount: number; unblockedIds: string[] }>`.
- **References:** tech-spec.md section 5.1, 04-core-module-refactor.md section 2.3, packages/core/src/backlog.ts line 428
- **Checklist:** CHECK-S06, CHECK-S10

### V-006: Missing `handleReset` command in spec 06 and missing `--force` on `loop start`
- **Severity:** gap
- **Location:** 06-cli-web-integration.md, sections 2.2, 2.8
- **Issue:** Two gaps: (1) The `ralph reset` command is listed in section 2.8 as accepting `--backlog`, but there is no corresponding section detailing the `handleReset` changes (analogous to section 2.6 for `handleProgress` or section 2.7 for `handleLog`). Since `resetProject` involves multiple core calls (ensureBacklog, sweepBacklog, resetStalledItems, clearDoneFile, clearCancelFile) plus the `deployProgress` adapter issue noted in 04-core-module-refactor.md, it deserves explicit coverage. (2) The `--force` flag is shown only for `loop run` in section 2.2, but section 2.8's table shows `--force` as "Yes (new)" for `loop start` as well. The `handleLoopStart` section (2.3) does not include `--force` handling. If the server mode supports `--force`, it needs to be passed to the API and handled.
- **Suggested fix:** (1) Add a section 2.9 or equivalent to 06-cli-web-integration.md covering `handleReset`: extract `--backlog` flag, resolve paths, pass `paths` to `resetProject(paths, options)`. (2) Either add `--force` handling to `handleLoopStart` (section 2.3) -- extracting the flag, including it in the POST body, and having the server call `forceClearLock` before `manager.startLoop` -- or remove `--force` from the `loop start` row in section 2.8 if it is not intended for server mode.
- **References:** 06-cli-web-integration.md sections 2.2, 2.3, 2.8; 04-core-module-refactor.md section 6 (reset.ts)
- **Checklist:** CHECK-S22, CHECK-S25

### V-007: No explicit user-facing error messages for common CLI failure modes
- **Severity:** gap
- **Location:** 06-cli-web-integration.md, section 2.1; 02-backlog-root-resolution.md, section 2.3
- **Issue:** PRD REQ-CLI-04 says "Paths that resolve outside the project root must be rejected with a clear error." The specs define internal error codes and messages (PATH_VIOLATION, FILE_NOT_FOUND), but 06-cli-web-integration.md section 2.1 shows `error(backlogRootResult.error.message)` for CLI output. The error messages defined in 02-backlog-root-resolution.md are technically detailed (e.g., "Backlog root directory not found: /absolute/path/..."), which is fine, but there is no specified user-facing message for the case where `--backlog` points to a valid directory that has no `backlog.json`. The error "No backlog.json found in {root} or {stateDir}" uses absolute paths which will be verbose in the CLI. Consider whether a shorter relative-path version should be shown to users.
- **Suggested fix:** Add a note in 06-cli-web-integration.md section 2.1 that the CLI error handler should format paths as relative to the current working directory or project root before printing, e.g.: `error(\`No backlog.json found in ${path.relative(projectPath, root)} or ${path.relative(projectPath, stateDir)}\`)`. This is an improvement to the existing error propagation pattern, not a new function.
- **References:** PRD.md REQ-CLI-04, 02-backlog-root-resolution.md section 2.3, 06-cli-web-integration.md section 2.1
- **Checklist:** CHECK-S20

### V-008: `resolveBacklogRoot` return type inconsistency between tech-spec and implementation spec
- **Severity:** improvement
- **Location:** tech-spec.md, section 2.2; 02-backlog-root-resolution.md, section 2.1
- **Issue:** The tech-spec (section 2.2) declares `resolveBacklogRoot` as returning `string` (bare return, non-Result): `export function resolveBacklogRoot(projectPath: string, backlogFlag?: string): string;`. But the implementation spec 02-backlog-root-resolution.md section 2.1 declares it as `Result<string>`, which is correct since it can fail with PATH_VIOLATION. The tech-spec should match. While the implementation spec is authoritative for the backlog stage, the tech-spec should not contradict it as it may confuse implementers who reference both.
- **Suggested fix:** Update tech-spec.md section 2.2 to change the return type of `resolveBacklogRoot` from `string` to `Result<string>`, matching 02-backlog-root-resolution.md.
- **References:** tech-spec.md section 2.2, 02-backlog-root-resolution.md section 2.1
- **Checklist:** CHECK-S08

## Checklist Results

### Requirement Coverage (CHECK-S01 through CHECK-S04)
- **CHECK-S01: PASS** -- All 37 PRD requirements (REQ-ROOT-01..04, REQ-STATE-01..04, REQ-CLI-01..05, REQ-STATUS-01..03, REQ-LOCK-01..05, REQ-INST-01..03, REQ-ARCH-01..03, REQ-SEC-01..02, REQ-OBS-01..02, REQ-REL-01..03, REQ-PERF-01..02, REQ-SCALE-01) are referenced by at least one implementation spec. Traceability script confirms 0 uncovered requirements.
- **CHECK-S02: PASS** -- All P0 requirements have detailed implementation guidance with code snippets, not just mentions.
- **CHECK-S03: PASS** -- All P1 requirements (REQ-STATE-04, REQ-STATUS-02, REQ-LOCK-04, REQ-INST-01..02, REQ-PERF-01, REQ-SEC-02, REQ-REL-02) have implementation approaches defined.
- **CHECK-S04: FAIL** -- REQ-TMPL-01 is referenced in specs but does not exist in the PRD (see V-001).

### Tech Spec / Implementation Spec Consistency (CHECK-S05 through CHECK-S08)
- **CHECK-S05: PASS** -- Technology decisions (centralized path resolution, basename detection, filesystem scan, PID+timestamp lock, minimal web changes) are all reflected in implementation specs.
- **CHECK-S06: FAIL** -- `unblockItems` return type in tech-spec does not match actual source code (see V-005).
- **CHECK-S07: PASS** -- No new external dependencies in either tech-spec or implementation specs; consistent.
- **CHECK-S08: FAIL** -- `resolveBacklogRoot` return type in tech-spec contradicts implementation spec (see V-008). LoopManager still uses `new LoopRunner()` vs `LoopRunner.create()` (see V-004).

### Type System Integrity (CHECK-S09 through CHECK-S13)
- **CHECK-S09: PASS** -- All type definitions in 00-core-definitions.md use valid TypeScript syntax, not pseudocode. Imports reference correct modules.
- **CHECK-S10: PASS** -- All types referenced across specs (BacklogPaths, InstructionPaths, LockFileContent, LockStatus, ActiveRoot, LoopStateEnum, Result) are defined in 00-core-definitions.md or reference existing types in the codebase (schemas.ts, errors.ts).
- **CHECK-S11: N/A** -- No error class hierarchy; error handling uses error codes via the existing `ErrorCodes` const + `Result` pattern. LOCK_CONFLICT is properly added.
- **CHECK-S12: FAIL** -- Conflicting home for LockFileContent/LockStatus types (see V-002). ActiveRoot import path inconsistency (see V-003).
- **CHECK-S13: PASS** -- All types in 00-core-definitions.md have JSDoc on every field. The verification checklist in 00-core-definitions.md section "Verification" explicitly checks this.

### Cross-Reference Consistency (CHECK-S14 through CHECK-S17)
- **CHECK-S14: PASS** -- File references between spec documents point to actual spec files. References to source code files (fs-utils.ts, errors.ts, etc.) verified against actual codebase.
- **CHECK-S15: PASS** -- Section references (e.g., "see 2.1 resolveBacklogRoot") map to actual sections in referenced documents.
- **CHECK-S16: PASS** -- Dependency ordering is consistent: 00 -> 01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07. No circular dependencies.
- **CHECK-S17: FAIL** -- Import path for ActiveRoot and lock types inconsistent across specs (see V-002, V-003).

### Error Handling Coverage (CHECK-S18 through CHECK-S21)
- **CHECK-S18: PASS** -- Every operation that can fail has an error type: PATH_VIOLATION, FILE_NOT_FOUND, LOCK_CONFLICT. Lock corruption is handled as auto-recovery.
- **CHECK-S19: PASS** -- Error propagation is clear: core returns Result, CLI/web callers check and format. Lock errors propagated via loop_error event.
- **CHECK-S20: FAIL** -- User-facing error messages use absolute paths which may be verbose for CLI users (see V-007).
- **CHECK-S21: PASS** -- Recovery behavior specified: stale locks auto-recovered, corrupt locks treated as stale, missing state dirs auto-created.

### Integration Point Completeness (CHECK-S22 through CHECK-S26)
- **CHECK-S22: FAIL** -- `handleReset` CLI handler not detailed despite being listed as affected (see V-006).
- **CHECK-S23: PASS** -- Shared types/contracts (BacklogPaths, InstructionPaths) explicitly named for each integration point.
- **CHECK-S24: PASS** -- Data flow direction clear in all integration specs: CLI -> core, loop -> core, web -> core.
- **CHECK-S25: PASS** -- Changes to existing packages (backlog.ts, status.ts, etc.) are specified with before/after code.
- **CHECK-S26: PASS** -- Import paths match barrel exports in 01-architecture-layout.md (with the exceptions noted in V-002/V-003).

### Edge Cases and Non-Functional (CHECK-S27 through CHECK-S32)
- **CHECK-S27: PASS** -- Concurrent access addressed via lock file mechanism. Two loops on different roots explicitly documented as safe.
- **CHECK-S28: PASS** -- Empty/null inputs handled: empty backlogFlag defaults to .ralph/, null RALPH.md handled by InstructionPaths, missing backlog.json returns FILE_NOT_FOUND.
- **CHECK-S29: PASS** -- Performance-sensitive paths identified: lock operations < 50ms, status scan < 500ms.
- **CHECK-S30: PASS** -- Security (path sandboxing REQ-SEC-01) reflected in resolveBacklogRoot validation.
- **CHECK-S31: N/A** -- PRD does not require metrics/tracing beyond log messages, which are specified.
- **CHECK-S32: PASS** -- Each spec has clear exports/public API defined. 01-architecture-layout.md lists all exports.

### Testing Strategy (CHECK-S33 through CHECK-S37)
- **CHECK-S33: PASS** -- 07-testing-strategy.md exists and is comprehensive.
- **CHECK-S34: PASS** -- Unit tests (per-module), integration tests (CLI flow), and test-sandbox (e2e-like) all specified.
- **CHECK-S35: PASS** -- Mock/fixture strategy defined: createMultiRootProject helper, real temp dirs (no fs mocking), PID 999999999 for dead process testing.
- **CHECK-S36: PASS** -- Coverage targets stated: 95%+ for backlog-root.ts, 90%+ for lock.ts, 85%+ for status/prompt-builder.
- **CHECK-S37: PASS** -- Test fixtures (createMultiRootProject) align with real types from schemas.ts (Backlog, LoopState).

### Traceability (CHECK-S38)
- **CHECK-S38: PASS** -- Full traceability matrix in TRACEABILITY.md. Script confirms 100% coverage (37/37 requirements). One orphaned reference (REQ-TMPL-01) noted in V-001.

## Fix Execution Plan

### User Decisions Required
1. **V-001 (REQ-TMPL-01):** Should this be added as a formal PRD requirement, or should existing references be remapped to REQ-INST-01? Adding to PRD is recommended.
2. **V-003 (ActiveRoot location):** Should `ActiveRoot` live in `backlog-root.ts` or `status.ts`? Recommended: `status.ts` since `scanActiveRoots` lives there.
3. **V-006 (--force on loop start):** Should `--force` be supported for server-mode `loop start`, or only for direct-mode `loop run`? If server-mode only, remove from the table.

### Execution Steps

Apply these steps in order. Each step is self-contained -- a fresh agent can execute it without prior context beyond this document.

#### Step 1: Add REQ-TMPL-01 to PRD and fix orphaned reference
- **Files:** `specs/multi-backlog/PRD.md`
- **Addresses:** V-001
- **Checklist:** CHECK-S04
- **Action:** Add to PRD section 3.6 after REQ-INST-03: `- REQ-TMPL-01: Artifact templates (RALPH.md.tmpl, CLAUDE_ADDON.md, CLAUDE_GREENFIELD.md.tmpl) must use path-agnostic wording. Runtime prompt injection provides actual paths. Priority: P1`. Add REQ-TMPL-01 to the Priority Summary table under P1.
- **Depends on:** none
- **Rationale:** Fixes the orphaned reference first since other steps may reference this requirement.

#### Step 2: Resolve type placement inconsistencies
- **Files:** `specs/multi-backlog/00-core-definitions.md`, `specs/multi-backlog/01-architecture-layout.md`, `specs/multi-backlog/03-lock-file-management.md`, `specs/multi-backlog/04-core-module-refactor.md`
- **Addresses:** V-002, V-003
- **Checklist:** CHECK-S12, CHECK-S17
- **Action:** (a) In 00-core-definitions.md, add a note after section 1.6 stating: "LockFileContent, LockFileContentSchema, and LockStatus are defined in `lock.ts`. ActiveRoot is defined in `status.ts`." (b) In 01-architecture-layout.md section 2, under `lock.ts` exports, keep `LockFileContent, LockFileContentSchema, LockStatus` as exported (defined locally, not imported from schemas.ts). (c) In 03-lock-file-management.md section 1, change the import from `import { LockFileContentSchema, type LockFileContent, type LockStatus } from "./schemas.js";` to define them locally or import from the same file (remove the import line and note types are defined within lock.ts per 00-core-definitions.md). (d) In 04-core-module-refactor.md section 3.2, change `import type { BacklogPaths, ActiveRoot } from "./backlog-root.js";` to `import type { BacklogPaths } from "./backlog-root.js";` and define `ActiveRoot` locally in `status.ts` or import it if it's re-exported. Also update 01-architecture-layout.md to show `ActiveRoot` as exported from `status.ts`.
- **Depends on:** none
- **Rationale:** Grouping all type-location fixes together avoids conflicting edits.

#### Step 3: Fix LoopManager to use LoopRunner.create() factory
- **Files:** `specs/multi-backlog/06-cli-web-integration.md`
- **Addresses:** V-004
- **Checklist:** CHECK-S08, CHECK-S14
- **Action:** In section 3.2, replace `const runner = new LoopRunner(projectPath, options);` with: `const runnerResult = LoopRunner.create(projectPath, options); if (!runnerResult.ok) { return { ok: false, error: runnerResult.error.message }; } const runner = runnerResult.value;`. Also update the `startLoop` method to handle the lock-already-held case from the factory (which resolves BacklogPaths and may return LOCK_CONFLICT).
- **Depends on:** none
- **Rationale:** Must be consistent with the private constructor defined in 05-loop-runner-integration.md.

#### Step 4: Fix unblockItems return type in tech-spec
- **Files:** `specs/multi-backlog/tech-spec.md`, `specs/multi-backlog/04-core-module-refactor.md`
- **Addresses:** V-005
- **Checklist:** CHECK-S06, CHECK-S10
- **Action:** (a) In tech-spec.md section 5.1, change `export function unblockItems(paths: BacklogPaths, itemId?: string): Result<number>;` to `export function unblockItems(paths: BacklogPaths, itemId?: string): Result<{ unblockedCount: number; unblockedIds: string[] }>;`. (b) In 04-core-module-refactor.md section 2.3, ensure the signature table includes unblockItems with the correct return type and shows the parameter change from projectPath to BacklogPaths.
- **Depends on:** none
- **Rationale:** Return type must match actual source code to avoid implementation confusion.

#### Step 5: Add handleReset section and clarify --force on loop start
- **Files:** `specs/multi-backlog/06-cli-web-integration.md`
- **Addresses:** V-006
- **Checklist:** CHECK-S22, CHECK-S25
- **Action:** (a) Add a new section (e.g., 2.9 `handleReset`) showing the --backlog flag extraction, path resolution, and `resetProject(paths, options)` call pattern. Note the `deployProgress(paths.stateDir)` adapter from 04-core-module-refactor.md. (b) Pending user decision on --force for loop start: if yes, add force handling to section 2.3 (handleLoopStart) matching the pattern in section 2.2; if no, change the --force column for `loop start` in section 2.8 from "Yes (new)" to "No".
- **Depends on:** User decision on --force for loop start (Decision #3)
- **Rationale:** Reset is a complex command touching many core modules; it needs explicit coverage.

#### Step 6: Add CLI error formatting note
- **Files:** `specs/multi-backlog/06-cli-web-integration.md`
- **Addresses:** V-007
- **Checklist:** CHECK-S20
- **Action:** Add a note after section 2.1 "Resolution Pattern": "When printing error messages to the CLI, convert absolute paths to relative paths using `path.relative(process.cwd(), absolutePath)` for readability. The internal error messages from core use absolute paths for programmatic clarity, but users should see concise relative paths."
- **Depends on:** none
- **Rationale:** Low-risk improvement that makes the CLI more user-friendly.

#### Step 7: Fix resolveBacklogRoot return type in tech-spec
- **Files:** `specs/multi-backlog/tech-spec.md`
- **Addresses:** V-008
- **Checklist:** CHECK-S08
- **Action:** In tech-spec.md section 2.2, change the signature from `export function resolveBacklogRoot(projectPath: string, backlogFlag?: string): string;` to `export function resolveBacklogRoot(projectPath: string, backlogFlag?: string): Result<string>;`
- **Depends on:** none
- **Rationale:** Trivial fix; tech-spec should not contradict the implementation spec.
