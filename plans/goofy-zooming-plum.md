# Plan: forge-3-specs for multi-backlog

## Context

The multi-backlog feature introduces a **backlog root** abstraction so ralph can operate on any backlog location (not just `.ralph/backlog.json`). This touches every package: core path resolution, lock file management, loop runner, prompt builder, CLI commands, and web API. The PRD (v1) and tech spec (v1) are both complete and verified.

## Proposed Spec Document Suite

```
specs/multi-backlog/
  00-core-definitions.md       — Types, error codes, constants shared across all specs
  01-architecture-layout.md    — Directory structure, exports map, build changes
  02-backlog-root-resolution.md — backlog-root.ts: path resolution, state dir detection, backlog.json location
  03-lock-file-management.md   — lock.ts: acquire/release, stale PID detection, PID recycling
  04-core-module-refactor.md   — Signature changes to backlog.ts, status.ts, iteration-status.ts, archive.ts, reset.ts + scanActiveRoots
  05-loop-runner-integration.md — LoopRunner constructor/run changes, prompt-builder BacklogPaths threading
  06-cli-web-integration.md    — CLI --backlog flag on all commands, web API route/body changes
  07-testing-strategy.md       — Test helpers, unit/integration scenarios, test-sandbox updates
  TRACEABILITY.md              — REQ-XXX-NN → spec document + section mapping
```

## Writing Approach

- **Batch 1** (foundations): 00, 01, 02 — types, layout, core new module
- **Batch 2** (core changes): 03, 04 — lock module, existing module refactoring
- **Batch 3** (consumers + tests): 05, 06, 07 — loop/cli/web integration, testing
- **Final**: TRACEABILITY.md cross-reference validation

Each spec will include:
- Requirement Coverage table at top
- Complete TypeScript with JSDoc (not pseudocode)
- Error handling for every operation
- Dependencies and Verification sections
- Cross-references to other spec docs by filename

## Key Files to Reference During Writing

### Core (signatures being changed)
- `packages/core/src/backlog.ts` — current `readBacklog(projectPath)` etc.
- `packages/core/src/status.ts` — current `deriveStatus(projectPath)` etc.
- `packages/core/src/iteration-status.ts` — current `writeIterationStatus(projectPath)` etc.
- `packages/core/src/archive.ts` — current `sweepBacklog(projectPath)` etc.
- `packages/core/src/reset.ts` — current `resetProject(projectPath)` etc.
- `packages/core/src/errors.ts` — ErrorCodes, Result type, ok/err helpers
- `packages/core/src/schemas.ts` — LoopStartOptionsSchema, all Zod schemas
- `packages/core/src/fs-utils.ts` — atomicWrite, readJsonFile, validatePath, fileExists, ensureDir
- `packages/core/src/index.ts` — barrel exports

### Loop (consumer changes)
- `packages/loop/src/runner.ts` — LoopRunner class, projectPath threading
- `packages/loop/src/prompt-builder.ts` — buildPrompt(), hardcoded .ralph/ paths

### CLI (consumer changes)
- `packages/cli/src/loop-commands.ts` — resolveProjectPath, flag extraction
- `packages/cli/src/backlog-commands.ts` — backlog CRUD handlers
- `packages/cli/src/status-commands.ts` — status/progress handlers
- `packages/cli/src/parser.ts` — extractStringFlag, extractBoolFlag

### Web (consumer changes)
- `packages/web/src/server/routes/loop.ts` — loop route handlers
- `packages/web/src/server/loop-manager.ts` — LoopManager keyed by projectPath

## Post-Review Decisions (from user interview)

Four decisions to apply to the written specs:

1. **ensureBacklog for non-default roots** (spec 04, section 2.4): Create empty backlog.json if missing for any root where the directory exists. Already matches what was written — confirm wording is clear.

2. **Active Backlog Root prompt section** (spec 05, section 3.4): Always include, even for default root. Update spec 05 to state explicitly — no conditional skip.

3. **LoopRunner static factory** (spec 05, section 2.1): Replace constructor-throws with `LoopRunner.create(projectPath, options): Result<LoopRunner>`. Constructor becomes private.

4. **Artifact template path references** (GAP — needs new content):
   - RALPH.md.tmpl has hardcoded `.ralph/backlog.json` etc. references → change to generic wording
   - CLAUDE_ADDON.md has same issue → change to generic wording
   - CLAUDE_GREENFIELD.md.tmpl has same issue → change to generic wording
   - Generic wording: "Read the backlog", "Do NOT modify backlog.json", etc.
   - The prompt-builder's "Active Backlog Root" section provides exact paths at runtime
   - Add a new section to spec 05 or create a dedicated section covering these template changes

## Spec Changes Needed

### spec 04 — no changes needed (already correct)

### spec 05 — three updates:
1. Section 2.1: Replace constructor-throws with `LoopRunner.create()` static factory
2. Section 3.4: State "always include" for Active Backlog Root section (no default-root skip)
3. New section 4: Artifact template updates (RALPH.md.tmpl, CLAUDE_ADDON.md, CLAUDE_GREENFIELD.md.tmpl)

### Files to update for artifact templates:
- `artifacts/variants/backlog-json/.ralph/RALPH.md.tmpl` — remove hardcoded `.ralph/` paths
- `artifacts/variants/backlog-json/CLAUDE_ADDON.md` — remove hardcoded `.ralph/` paths
- `artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl` — remove hardcoded `.ralph/` paths

## Remaining Steps

1. Apply the 4 decisions to specs 04 and 05
2. Git commit all spec files
3. Update .pipeline-state.json: set forge-3-specs status to "complete" with commit hash
4. Tell user next steps: /feature-forge:forge-verify or /feature-forge:forge-4-backlog
