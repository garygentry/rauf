# Fix Plan: multi-backlog specs verification findings

## Context

The forge-verify specs pass found 8 findings (4 inconsistencies, 3 gaps, 1 improvement) across the multi-backlog implementation specs. All user decisions have been resolved:
1. **REQ-TMPL-01** → Add to PRD as formal P1 requirement
2. **ActiveRoot** → Define in `status.ts`
3. **--force on loop start** → Remove; only supported on `loop run`

## Steps

### Step 1: Add REQ-TMPL-01 to PRD (V-001)
- **File:** `specs/multi-backlog/PRD.md`
- Add `REQ-TMPL-01` after REQ-INST-03 in section 3.6: "Artifact templates must use path-agnostic wording. Runtime prompt injection provides actual paths. Priority: P1"
- Add REQ-TMPL-01 to the Priority Summary table under P1

### Step 2: Resolve type placement inconsistencies (V-002, V-003)
- **Files:** `specs/multi-backlog/00-core-definitions.md`, `specs/multi-backlog/01-architecture-layout.md`, `specs/multi-backlog/03-lock-file-management.md`, `specs/multi-backlog/04-core-module-refactor.md`
- In 00-core-definitions.md: add note that `LockFileContent`/`LockFileContentSchema`/`LockStatus` are defined in `lock.ts`; `ActiveRoot` is defined in `status.ts`
- In 01-architecture-layout.md: confirm `lock.ts` defines lock types locally; add `ActiveRoot` to `status.ts` exports
- In 03-lock-file-management.md: remove `from "./schemas.js"` import for lock types; note they're defined locally in `lock.ts`
- In 04-core-module-refactor.md section 3.2: change import to `import type { BacklogPaths } from "./backlog-root.js"` (remove ActiveRoot from that import); `ActiveRoot` defined locally in `status.ts`

### Step 3: Fix LoopManager to use LoopRunner.create() (V-004)
- **File:** `specs/multi-backlog/06-cli-web-integration.md`
- In section 3.2, replace `new LoopRunner(projectPath, options)` with `LoopRunner.create()` factory pattern with Result handling

### Step 4: Fix unblockItems return type (V-005)
- **Files:** `specs/multi-backlog/tech-spec.md`, `specs/multi-backlog/04-core-module-refactor.md`
- In tech-spec.md section 5.1: change return type to `Result<{ unblockedCount: number; unblockedIds: string[] }>`
- In 04-core-module-refactor.md section 2.3: ensure unblockItems is in signature table with correct return type and param change

### Step 5: Add handleReset section + remove --force from loop start (V-006)
- **File:** `specs/multi-backlog/06-cli-web-integration.md`
- Add section 2.9 `handleReset` covering --backlog flag extraction, path resolution, `resetProject(paths, options)` call
- Change --force column for `loop start` in section 2.8 from "Yes (new)" to "No"

### Step 6: Add CLI error formatting note (V-007)
- **File:** `specs/multi-backlog/06-cli-web-integration.md`
- Add note after section 2.1 about converting absolute paths to relative via `path.relative(process.cwd(), absolutePath)` for CLI output

### Step 7: Fix resolveBacklogRoot return type (V-008)
- **File:** `specs/multi-backlog/tech-spec.md`
- In section 2.2: change return type from `string` to `Result<string>`

### Step 8: Update pipeline state + commit
- Update `specs/multi-backlog/.pipeline-state.json`: set `forge-verify-specs` status to `findings-applied`, record `fixedAt`
- Commit all changes

## Verification
- Re-run traceability script to confirm REQ-TMPL-01 is no longer orphaned
- Grep for `new LoopRunner(` across specs to confirm no remaining direct constructor calls
- Grep for `from "./schemas.js"` in 03-lock-file-management.md to confirm removal
- Check that `--force` only appears for `loop run` in section 2.8 table
