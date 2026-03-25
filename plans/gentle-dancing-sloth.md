# Plan: Write Multi-Backlog Tech Spec

## Context

This is a forge-2-tech pipeline stage execution for the `multi-backlog` feature. The task is to write `specs/multi-backlog/tech-spec.md` based on the completed PRD and codebase research, then update pipeline state and commit.

## What to Write

Write the tech spec at `specs/multi-backlog/tech-spec.md` covering all decisions from the interview:

### Key Decisions Made

1. **Architecture**: New `packages/core/src/backlog-root.ts` module — single source of truth for all path resolution
2. **State dir detection**: `path.basename(backlogRoot) === ".ralph"` for the no-nesting special case
3. **Lock file**: `.loop.lock` in state dir, with PID + timestamp + process start time check
4. **Discovery**: Filesystem scan for `**/state.json` (skip node_modules, .git)
5. **Web scope**: Minimal — add backlogRoot to loop start/stop, rekey LoopManager
6. **Testing**: Shared `createMultiRootProject()` test helper
7. **PID recycling**: Implement timestamp comparison from the start
8. **Migration**: Not needed — default root layout unchanged
9. **Backup location**: `.bak` alongside original `backlog.json`
10. **Stack**: TypeScript, update forge.config.json

### Tech Spec Structure

Follow the forge-2-tech template sections:
1. Overview
2. Module Structure (new backlog-root.ts, modified modules)
3. Technical Decisions (each traced to REQ-xxx)
4. Data Model (BacklogPaths interface, lock file schema)
5. API Design (function signatures, CLI flag, web endpoints)
6. Integration Points (every module that changes)
7. Error Handling (new error codes)
8. Testing Approach (shared helper, test scenarios)
9. Dependencies (none new — all node: built-ins)
10. Open Technical Questions

### Post-Write Steps

1. Update `forge.config.json` with stack/typeCheckCommand/testCommand
2. Update `specs/multi-backlog/.pipeline-state.json`
3. Git commit with `forge(multi-backlog): complete tech-spec v1`

## Files to Modify

- `specs/multi-backlog/tech-spec.md` (CREATE)
- `specs/multi-backlog/.pipeline-state.json` (UPDATE)
- `forge.config.json` (UPDATE — add stack fields)

## Verification

- Read the tech spec and confirm all PRD requirements are traced
- Confirm pipeline state is valid per schema
- Run `pnpm typecheck` and `pnpm test` to ensure no regressions (we're only writing docs)
