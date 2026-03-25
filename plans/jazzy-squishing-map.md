# Plan: Generate forge-4-backlog for multi-backlog feature

## Context

The multi-backlog feature has completed PRD, tech spec, and implementation specs (8 spec documents). All prerequisites are met and verified. This plan generates the backlog.json at `specs/multi-backlog/backlog.json` for the ralph loop to implement.

## Task

Generate a validated `backlog.json` with 15 items following the forge-4-backlog skill workflow:

1. Write backlog.json to `specs/multi-backlog/backlog.json`
2. Validate with the bundled validation script
3. Update `.pipeline-state.json` to mark forge-4-backlog as complete
4. Commit changes

## Backlog Items (15 total, tests merged into implementation items)

| ID  | P | Title | Depends On |
|-----|---|-------|------------|
| 001 | 1 | Scaffold new core modules with types, constants, and barrel exports | — |
| 002 | 1 | Implement backlog-root.ts resolution functions with unit tests and shared test helper | 001 |
| 003 | 1 | Implement lock.ts lock file management with unit tests | 001 |
| 004 | 1 | Refactor backlog.ts to accept BacklogPaths and update tests | 002 |
| 005 | 1 | Refactor status.ts, add scanActiveRoots, and update tests | 002 |
| 006 | 1 | Refactor iteration-status.ts, archive.ts, and reset.ts with test updates | 002, 004, 005 |
| 007 | 1 | Update artifact templates to use path-agnostic wording | — |
| 008 | 1 | Regenerate embedded-artifacts.ts | 007 |
| 009 | 1 | Update LoopRunner to use BacklogPaths and lock lifecycle | 002, 003, 004, 005, 006 |
| 010 | 1 | Update prompt-builder.ts for BacklogPaths/InstructionPaths with tests | 002, 008, 009 |
| 011 | 1 | Add --backlog flag to CLI loop commands | 009 |
| 012 | 1 | Add --backlog flag to CLI backlog/status/reset/log/progress commands | 004, 005, 006 |
| 013 | 2 | Update web API routes and LoopManager for backlog root | 009, 011 |
| 014 | 2 | Update test-sandbox for --backlog flag testing | 011 |
| 015 | 2 | End-to-end verification and integration testing | 011, 012, 013 |

## Critical Files

- `specs/multi-backlog/backlog.json` — output file
- `specs/multi-backlog/.pipeline-state.json` — pipeline state to update
- `forge.config.json` — typeCheckCommand: `pnpm typecheck`, testCommand: `pnpm test`

## Verification

1. Run validation: `python .../validate-backlog.py specs/multi-backlog/backlog.json --specs-dir specs/multi-backlog`
2. Commit with `forge(multi-backlog): generate backlog with 15 items`
