# Documentation Update Plan

## Context

Recent feature work (post-loop review pass, archive improvements, provider system foundation) has diverged from the specification documents in `docs/`. This plan audits each doc file against the current codebase and lists the specific changes needed to bring them up to date.

**Scope:** `docs/SCHEMAS.md`, `docs/SPEC-CLI.md`, `docs/SPEC-ARTIFACTS.md`, `docs/ARCHITECTURE.md`, `docs/SPEC-CORE.md`, `docs/SPEC-WEB.md`. Files `CLAUDE-CODE-TASKS.md`, `WEB-TECH-STACK.md`, and `SPEC-LLM-AGNOSTIC.md` need no changes.

---

## 1. SCHEMAS.md — Heaviest changes

### 1a. BacklogItem (lines 32–47)
Add missing fields after `model?`:
```typescript
  agentDelegation?: AgentDelegation;
  specReferences?: string[];   // Paths to spec docs
  provider?: string;           // Per-item LLM provider override
  source?: "human" | "review"; // Origin: manually created or review-generated
  reviewBatch?: string;        // ISO timestamp grouping review-created items
```

### 1b. New section: AgentDelegation (after BacklogItem)
```typescript
interface AgentDelegation {
  recommendedConcurrency?: number;
  strategy?: string;
  subtasks?: string[];
}
```

### 1c. MarkerOptions (lines 113–122)
Add after `runtime?`:
```typescript
  provider?: string;
  providerConfig?: Record<string, unknown>;
```

### 1d. LoopState status enum (lines 128–149)
Add `"idle"` and `"reviewing"` to the union. Add rows to the table (lines 152–162):
| `idle`       | No loop active (initial state)        |
| `reviewing`  | Running post-loop review pass         |

### 1e. ToolConfig (lines 168–174)
Add:
```typescript
  defaultProvider?: string;
  providers?: Record<string, Record<string, unknown>>;
```

### 1f. LoopStartOptions (lines 293–299)
Add:
```typescript
  provider?: string;
  review?: boolean;
  reviewOnly?: boolean;
```

### 1g. LoopEvent table (lines 315–336) — rename + add
- Change heading from "17 Event Types" to "20 Event Types"
- Rename `claude_spawned` → `llm_spawned`, add `provider` field
- Rename `claude_exited` → `llm_exited`, add `provider` field
- Add 3 rows:

| `review_started`   | `completedItemIds: string[]`         | Post-loop review pass begins        |
| `review_completed` | `itemsCreated: number, summary: string` | Review pass finished             |
| `review_failed`    | `reason: string`                     | Review pass failed (non-fatal)      |

### 1h. Full LoopEvent union type (lines 337–428)
- Rename the two `claude_*` variants to `llm_*`, add `provider: string` field to each
- Add 3 new union members for review events

### 1i. New section: ReviewPayload / ReviewItem (after LoopEvent)
```typescript
interface ReviewItem {
  type: "bug" | "refactor" | "feature" | "chore";
  priority: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  acceptanceCriteria: string[]; // min 1
}
interface ReviewPayload {
  items: ReviewItem[]; // min 1
  summary: string;
}
```

### 1j. New section: LoopResult (after ReviewPayload)
```typescript
interface LoopResult {
  completedCount: number;
  blockedCount: number;
  cancelled: boolean;
  reviewItemsCreated?: number;
  reviewSummary?: string;
}
```

---

## 2. SPEC-CLI.md

### 2a. Command tree (lines 14–62)
Update `ralph loop` block:
```
ralph loop start [path] [--iterations N] [--retries N] [--model <m>] [--timeout N] [--follow]
ralph loop stop [path]
ralph loop follow [path]
ralph loop run [path] [--iterations N] [--retries N] [--model <m>] [--timeout N] [--review] [--review-only]
ralph loop review [path] [--model <m>] [--timeout N]
```
Update `ralph status` line:
```
ralph status <path> [--watch] [--interval N]
```

### 2b. New section: `ralph loop review [path]` (after `ralph loop run`)
- Standalone review of completed backlog items
- `--model <m>`: model override
- `--timeout N`: session timeout in minutes (default: 60)
- Runs `startReviewOnly()`: reads all `done` items, spawns review Claude session, creates fix items with `source: "review"`
- Outputs review summary or "no issues found"

### 2c. `ralph loop run` flags (after existing flags)
Add:
- `--review`: enable post-loop review pass after all items complete
- `--review-only`: review only, create fix items but don't process them (implies `--review`)

### 2d. `ralph loop start` flags
Add:
- `--follow`: stream SSE events inline after starting

### 2e. `ralph status` flags
Add:
- `--watch`: continuously refresh status display
- `--interval N`: refresh interval in seconds (default: 2, requires `--watch`)

### 2f. `ralph backlog reset` archive naming (lines 201–202)
Change `YYYY-MM-progress.md` → `YYYYMMDD-HHmmss-progress.md`
Change `YYYY-MM-ralph.log` → `YYYYMMDD-HHmmss-ralph.log`
Change "(same month overwrites previous)" → "(timestamp-based, never overwrites)"

---

## 3. SPEC-ARTIFACTS.md

### 3a. File inventory (lines 12–21)
Add `REVIEW.md.tmpl` to the tree:
```
└── .ralph/
    ├── RALPH.md.tmpl
    ├── REVIEW.md.tmpl          # Post-loop review prompt (template)
    ├── backlog.json
    ├── backlog.schema.json
    └── progress.md
```

### 3b. Exit signal detection (lines 44–49)
Add after `RALPH_NEEDS_HUMAN`:
- `RALPH_REVIEW:{"items":[...],"summary":"..."}` → review found issues, runner creates fix items

### 3c. New section: REVIEW.md.tmpl (after RALPH.md.tmpl section)
Document:
- Template variables: `verifyCommand`, `completedItemsDetail`, `gitDiff`, `progressContent`
- User-customizable: if `.ralph/REVIEW.md` exists locally, it's used instead of the embedded template
- Expected outputs: `RALPH_DONE` (clean) or `RALPH_REVIEW:{json}` (issues found)
- Installed during `install()` and re-rendered during `update()`, removed during `uninstall()`

### 3d. New section: Review Pass (after Usage Limit Handling)
Document the review lifecycle:
- Triggered by `--review` flag or `ralph loop review` standalone command
- Git baseline captured at loop start; diff computed for review context
- Review items created with `source: "review"` and `reviewBatch` ISO timestamp
- If not `--review-only`, loop re-enters to process fix items (no recursive review)
- Runner methods: `runReviewPass()`, `startReviewOnly()`, `buildReviewPrompt()`

---

## 4. ARCHITECTURE.md

### 4a. Event count
Update "17 LoopEvent types" → "20 LoopEvent types" wherever referenced.

### 4b. Loop module table
- Add `providers/` row: "Provider registry and LLM adapter abstraction"
- Update `prompt-builder.ts` description to mention review prompts

### 4c. LoopRunner lifecycle
Add after existing step list:
- Capture git baseline commit hash at startup
- After main loop: if `--review` enabled, run review pass
- If review creates items and not `--review-only`, re-enter main loop for fix iterations

### 4d. CLI module
Add `ralph loop review` to the command list.

### 4e. New data flow: Review Pass
```
Loop completes → runReviewPass()
  → Read completed items from backlog
  → git diff baseCommit..HEAD
  → buildReviewPrompt() (REVIEW.md template)
  → Spawn Claude with review prompt
  → Parse RALPH_REVIEW or RALPH_DONE
  → If issues: addItem() with source="review"
  → If !reviewOnly: re-enter main loop
```

---

## 5. SPEC-CORE.md

### 5a. schemas.ts module (line ~45)
Add to key schemas list: `BacklogItemSourceSchema`, `AgentDelegationSchema`, `ReviewPayloadSchema`, `ReviewItemSchema`. Note new fields on `LoopStartOptionsSchema` (`review`, `reviewOnly`, `provider`).

### 5b. backlog.ts — addItem (line ~190)
Note that `CreateItemInput` now accepts `source` and `reviewBatch` optional fields.

### 5c. installer.ts — install (lines 278–311)
Add REVIEW.md deployment step: "Render REVIEW.md.tmpl → `.ralph/REVIEW.md`"

### 5d. installer.ts — update (lines 312–321)
Note that update re-renders REVIEW.md (preserves user-customized versions).

### 5e. installer.ts — uninstall (lines 324–327)
Note that REVIEW.md is removed during uninstall.

### 5f. New section: reset.ts module (after archive.ts)
- `resetProject(projectPath, options) → Result<ResetProjectResult>`
- Options: `clearBacklog`, `keepProgress`, `keepLog`
- Archive naming: `YYYYMMDD-HHmmss-progress.md`, `YYYYMMDD-HHmmss-ralph.log`
- Clears state.json, DONE, CANCEL markers; sweeps done items; resets in_progress → pending

---

## 6. SPEC-WEB.md

### 6a. LoopManager event count
Update "17 event types" → "20 event types". Add note about ring buffer for SSE late-subscriber replay.

### 6b. Loop start API body
Add `review`, `reviewOnly`, `provider` fields to `POST /api/projects/:id/loop/start` request body documentation.

---

## Key Files

| Doc file | Lines changed (est.) |
|----------|---------------------|
| `docs/SCHEMAS.md` | ~80 lines added/modified |
| `docs/SPEC-CLI.md` | ~30 lines added/modified |
| `docs/SPEC-ARTIFACTS.md` | ~50 lines added |
| `docs/ARCHITECTURE.md` | ~25 lines added/modified |
| `docs/SPEC-CORE.md` | ~30 lines added/modified |
| `docs/SPEC-WEB.md` | ~10 lines modified |

## Source of Truth
Cross-reference all changes against:
- `packages/core/src/schemas.ts` — canonical type definitions
- `packages/loop/src/runner.ts` — review pass implementation
- `packages/loop/src/signal-parser.ts` — signal types
- `packages/cli/src/commands.ts` — command registry
- `packages/cli/src/loop-commands.ts` — flag handling
- `packages/core/src/installer.ts` — REVIEW.md deployment
- `packages/core/src/reset.ts` — reset logic and archive naming

## Verification

1. Read each updated doc and confirm every type/interface matches `schemas.ts`
2. Confirm every CLI command/flag matches `commands.ts` and handler files
3. Confirm artifact inventory matches `artifacts/variants/backlog-json/`
4. `pnpm typecheck` — ensure no regressions from doc-adjacent schema changes
