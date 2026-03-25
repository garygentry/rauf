# 05 — Loop Runner Integration

Changes to `packages/loop/` — the `LoopRunner` class and `prompt-builder.ts` — to thread `BacklogPaths` through the loop execution pipeline.

## Requirement Coverage

| REQ ID       | Requirement                                       | Section                      |
| ------------ | ------------------------------------------------- | ---------------------------- |
| REQ-ARCH-03  | Loop runner receives backlog root as config param | 2. LoopRunner Changes        |
| REQ-LOCK-01  | Lock file created before loop starts              | 2.2 start()                  |
| REQ-LOCK-05  | Lock cleaned up on termination                    | 2.2 start()                  |
| REQ-INST-01  | RALPH.md per-root then project-level fallback     | 3. prompt-builder.ts         |
| REQ-INST-02  | REVIEW.md per-root then project-level fallback    | 3. prompt-builder.ts         |
| REQ-INST-03  | progress.md always per-root                       | 3. prompt-builder.ts         |
| REQ-OBS-01   | Log records which backlog root is active          | 2.2 start()                  |
| REQ-STATE-03 | State dir auto-created on first run               | 2.2 start()                  |
| REQ-TMPL-01  | Templates use generic path wording                | 4. Artifact Template Updates |

## 1. Module Overview

**Files modified:**

- `packages/loop/src/runner.ts` — LoopRunner class
- `packages/loop/src/prompt-builder.ts` — buildPrompt and buildReviewPrompt functions

**New imports added to runner.ts:**

```typescript
import {
  // existing imports unchanged...
  resolveBacklogPaths,
  resolveInstructionPaths,
  ensureStateDir,
  acquireLock,
  releaseLock,
  type BacklogPaths,
  type InstructionPaths,
} from "@ralph/core";
```

## 2. LoopRunner Changes

### 2.1 Static Factory and Constructor

The constructor is private. Callers use the static `create()` factory which returns `Result<LoopRunner>`, consistent with the codebase's Result-everywhere pattern.

```typescript
export class LoopRunner extends TypedEventEmitter {
  private readonly projectPath: string;
  private readonly paths: BacklogPaths;          // NEW
  private instructionPaths!: InstructionPaths;   // NEW (resolved in start())
  private readonly options: LoopStartOptions;
  // ... remaining properties unchanged ...

  /**
   * Create a new LoopRunner for the given project and options.
   *
   * Resolves BacklogPaths from options.backlogRoot (or default .ralph/).
   * Returns LOCK_CONFLICT, PATH_VIOLATION, or FILE_NOT_FOUND errors
   * without throwing.
   *
   * @param projectPath - Absolute path to the project root
   * @param options - Loop start options (including optional backlogRoot)
   * @returns Result containing the LoopRunner or an error
   */
  static create(
    projectPath: string,
    options: LoopStartOptions,
  ): Result<LoopRunner> {
    const backlogRoot = options.backlogRoot ?? path.join(projectPath, ".ralph");
    const pathsResult = resolveBacklogPaths(projectPath, backlogRoot);
    if (!pathsResult.ok) {
      return pathsResult; // Forward the error (PATH_VIOLATION or FILE_NOT_FOUND)
    }
    return ok(new LoopRunner(projectPath, pathsResult.value, options));
  }

  private constructor(
    projectPath: string,
    paths: BacklogPaths,
    options: LoopStartOptions,
  ) {
    super();
    this.projectPath = projectPath;
    this.paths = paths;
    this.options = options;
    this.abortController = new AbortController();
  }
```

**Design note:** The factory pattern means callers handle errors via the standard `Result` check instead of try/catch, and the constructor never touches the filesystem.

### 2.2 `start()` Method Changes

Three additions to the loop lifecycle:

**Before the iteration loop (after clearing DONE/CANCEL):**

```typescript
async start(): Promise<LoopResult> {
  this.startedAt = new Date().toISOString();
  this.baseCommitHash = await this.getHeadCommit();

  try {
    // (1) Ensure state directory exists (REQ-STATE-03)
    const ensureResult = ensureStateDir(this.paths);
    if (!ensureResult.ok) {
      throw new Error(`Failed to create state directory: ${ensureResult.error.message}`);
    }

    // (2) Acquire lock (REQ-LOCK-01)
    const lockResult = acquireLock(this.paths);
    if (!lockResult.ok) {
      // LOCK_CONFLICT — another loop is running
      this.emitEvent("loop_error", { error: lockResult.error.message });
      return { completedCount: 0, blockedCount: 0, cancelled: false };
    }

    // (3) Resolve instruction paths (REQ-INST-01, REQ-INST-02)
    this.instructionPaths = resolveInstructionPaths(this.paths);

    // (4) Clear DONE and CANCEL files
    clearDoneFile(this.paths);
    clearCancelFile(this.paths);

    // (5) Log which backlog root is active (REQ-OBS-01)
    const relativeRoot = path.relative(this.projectPath, this.paths.root);
    appendLog(this.paths, `Loop started (backlog root: ${relativeRoot || ".ralph"})`);

    // ... rest of existing start() logic, with projectPath → this.paths ...
```

**After loop completion (in finally block):**

```typescript
  } finally {
    // Release lock (REQ-LOCK-05)
    releaseLock(this.paths);
  }
```

### 2.3 Core Function Call Changes

Every call to a core function that previously took `projectPath` now takes `this.paths`:

```typescript
// Before → After:
clearDoneFile(this.projectPath)         → clearDoneFile(this.paths)
clearCancelFile(this.projectPath)       → clearCancelFile(this.paths)
readBacklog(this.projectPath)           → readBacklog(this.paths)
updateItem(this.projectPath, ...)       → updateItem(this.paths, ...)
addItem(this.projectPath, ...)          → addItem(this.paths, ...)
writeLoopState(this.projectPath, ...)   → writeLoopState(this.paths, ...)
appendLog(this.projectPath, ...)        → appendLog(this.paths, ...)
writeDoneFile(this.projectPath, ...)    → writeDoneFile(this.paths, ...)
checkCancelRequested(this.projectPath)  → checkCancelRequested(this.paths)
sweepBacklog(this.projectPath, ...)     → sweepBacklog(this.paths, ...)
writeIterationStatus(this.projectPath, ...) → writeIterationStatus(this.paths, ...)
clearIterationStatus(this.projectPath)  → clearIterationStatus(this.paths)
```

**Unchanged calls** — these use `projectPath` (project root, not backlog root):

```typescript
readMarkerFile(this.projectPath); // .ralph.json is always at project root
readClaudeOAuthToken(); // global credential, no path
```

### 2.4 `buildPrompt` Call Change

```typescript
// Before:
const promptResult = buildPrompt(this.projectPath, item, backlog);

// After:
const promptResult = buildPrompt(this.paths, this.instructionPaths, item, backlog);
```

### 2.5 `buildReviewPrompt` Call Change

```typescript
// Before:
const reviewPromptResult = buildReviewPrompt(this.projectPath, completedItems, diff);

// After:
const reviewPromptResult = buildReviewPrompt(
  this.paths,
  this.instructionPaths,
  completedItems,
  diff,
);
```

### 2.6 `writeState` Helper

```typescript
// Before:
private writeState(status: ..., currentItem: ..., lastSignal?: ..., error?: ...): void {
  writeLoopState(this.projectPath, { ... });

// After:
private writeState(status: ..., currentItem: ..., lastSignal?: ..., error?: ...): void {
  writeLoopState(this.paths, { ... });
```

### 2.7 Event Emission

The `emitEvent` method currently includes `projectPath` in events. This remains `this.projectPath` (project root), not the backlog root, since the event schema uses `projectPath` for project identification. No change needed.

## 3. `prompt-builder.ts` Changes

### 3.1 Removals

```typescript
// DELETE:
const RALPH_DIR = ".ralph";
const RALPH_MD = "RALPH.md";
const REVIEW_MD = "REVIEW.md";
const PROGRESS_MD = "progress.md";
```

### 3.2 New Imports

```typescript
import type { BacklogPaths, InstructionPaths } from "@ralph/core";
```

### 3.3 `buildPrompt` Signature Change

```typescript
// Before:
export function buildPrompt(
  projectPath: string,
  item: BacklogItem,
  backlog: Backlog,
): Result<string>;

// After:
export function buildPrompt(
  paths: BacklogPaths,
  instructionPaths: InstructionPaths,
  item: BacklogItem,
  backlog: Backlog,
): Result<string>;
```

### 3.4 `buildPrompt` Internal Changes

**RALPH.md reading:**

```typescript
// Before:
const ralphMdPath = path.join(projectPath, RALPH_DIR, RALPH_MD);
if (!fileExists(ralphMdPath)) { return err(...) }
const ralphMdContent = fs.readFileSync(ralphMdPath, "utf-8");

// After:
if (!instructionPaths.ralphMd) {
  return err({
    code: ErrorCodes.FILE_NOT_FOUND,
    message: "RALPH.md not found in backlog root state directory or project .ralph/",
  });
}
const ralphMdContent = fs.readFileSync(instructionPaths.ralphMd, "utf-8");
```

**progress.md reading (REQ-INST-03 — always per-root):**

```typescript
// Before:
const progressPath = path.join(projectPath, RALPH_DIR, PROGRESS_MD);
const progressContent = fileExists(progressPath) ? fs.readFileSync(progressPath, "utf-8") : null;

// After:
const progressContent = fileExists(paths.progress)
  ? fs.readFileSync(paths.progress, "utf-8")
  : null;
```

**New section: Active Backlog Root context (REQ-ARCH-03):**

After the RALPH.md section, inject a context block telling the agent which backlog root is active. **This section is ALWAYS included** — even for the default root (`.ralph/`). This keeps behavior uniform and ensures the agent always has explicit path awareness, which is important because the RALPH.md template uses generic wording (see section 4) rather than hardcoded paths.

```typescript
// After Section 1 (RALPH.md), before Section 2 (Current Task):
// ALWAYS injected, including for the default root.
const relativeRoot = path.relative(paths.projectPath, paths.root);
const relativeStateDir = path.relative(paths.projectPath, paths.stateDir);
const relativeBacklog = path.relative(paths.projectPath, paths.backlog);
const relativeProgress = path.relative(paths.projectPath, paths.progress);

sections.push(`## Active Backlog Root
You are working against the backlog at: ${relativeBacklog}
State directory: ${relativeStateDir}/
Progress log: ${relativeProgress}
Do NOT modify files outside this state directory.`);
```

**"Do NOT modify" reminder update:**

```typescript
// Before:
`Do NOT modify .ralph/backlog.json or .ralph/state.json`;

// After:
const relBacklog = path.relative(paths.projectPath, paths.backlog);
const relState = path.relative(paths.projectPath, paths.state);
`Do NOT modify ${relBacklog} or ${relState} — the loop runner manages status.`;
```

### 3.5 `buildReviewPrompt` Signature Change

```typescript
// Before:
export function buildReviewPrompt(
  projectPath: string,
  completedItems: BacklogItem[],
  gitDiff: string,
): Result<string>;

// After:
export function buildReviewPrompt(
  paths: BacklogPaths,
  instructionPaths: InstructionPaths,
  completedItems: BacklogItem[],
  gitDiff: string,
): Result<string>;
```

### 3.6 `buildReviewPrompt` Internal Changes

**Verify command — still from project-level marker file:**

```typescript
// Before:
const markerResult = readMarkerFile(projectPath);

// After:
const markerResult = readMarkerFile(paths.projectPath);
```

**progress.md:**

```typescript
// Before:
const progressPath = path.join(projectPath, RALPH_DIR, PROGRESS_MD);

// After:
const progressContent = fileExists(paths.progress)
  ? fs.readFileSync(paths.progress, "utf-8")
  : "No progress log available.";
```

**REVIEW.md fallback (REQ-INST-02):**

```typescript
// Before:
const reviewMdPath = path.join(projectPath, RALPH_DIR, REVIEW_MD);
if (fileExists(reviewMdPath)) { ... } else { ... embedded template ... }

// After:
if (instructionPaths.reviewMd) {
  templateContent = fs.readFileSync(instructionPaths.reviewMd, "utf-8");
} else {
  // Fall back to embedded template (unchanged)
  templateContent = getEmbeddedArtifact(".ralph/REVIEW.md.tmpl");
}
```

## 4. Artifact Template Updates (REQ-INST-01, REQ-ARCH-03)

The installed RALPH.md and CLAUDE.md files contain hardcoded `.ralph/backlog.json` references that would be wrong for non-default roots. These templates must be updated to use generic, path-agnostic wording. The prompt-builder's "Active Backlog Root" section (section 3.4 above) provides the actual paths at runtime.

### 4.1 Files to Modify

| File                        | Location                                                    | Purpose                                       |
| --------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `RALPH.md.tmpl`             | `artifacts/variants/backlog-json/.ralph/RALPH.md.tmpl`      | Per-iteration instructions for the loop agent |
| `CLAUDE_ADDON.md`           | `artifacts/variants/backlog-json/CLAUDE_ADDON.md`           | Ralph section merged into project CLAUDE.md   |
| `CLAUDE_GREENFIELD.md.tmpl` | `artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl` | Full CLAUDE.md for new projects               |

### 4.2 RALPH.md.tmpl Changes

Replace all hardcoded `.ralph/` path references with generic wording:

```markdown
## Reading Your Task (BEFORE)

1. Read `.ralph/RALPH.md` for detailed per-iteration instructions
2. Read `.ralph/backlog.json` — your current task is the `in_progress` item
3. Read `.ralph/progress.md` for context from previous iterations

## Rules (BEFORE)

- Do NOT modify `.ralph/backlog.json` status — the loop runner manages it
- Do NOT modify `.ralph/state.json` — the loop runner manages it
- DO read `.ralph/progress.md` for accumulated learnings
- DO append new learnings to `.ralph/progress.md` if you discover important patterns
```

Replace with:

```markdown
## Reading Your Task (AFTER)

1. Read `RALPH.md` for per-iteration instructions
2. Read the backlog — find the current `in_progress` item
   (The Active Backlog Root section in the prompt tells you the exact path)
3. Read `progress.md` for context from previous iterations

## Rules (AFTER)

- Do NOT modify `backlog.json` — the loop runner manages status
- Do NOT modify `state.json` — the loop runner manages state
- DO read `progress.md` for accumulated learnings
- DO append new learnings to `progress.md` if you discover important patterns
```

**Key change:** Paths use bare filenames (e.g., `backlog.json`) instead of full relative paths (e.g., `.ralph/backlog.json`). The "Active Backlog Root" section injected by the prompt builder provides the exact resolved paths, so the agent always knows where to find these files regardless of which root is active.

### 4.3 CLAUDE_ADDON.md Changes

Same pattern — replace hardcoded `.ralph/` paths:

```markdown
## Autonomous Loop (Ralph) (BEFORE)

1. Read `.ralph/RALPH.md` for detailed per-iteration instructions
2. Read `.ralph/backlog.json` — find the current `in_progress` item
   ...

- Do not modify `.ralph/backlog.json` — the loop runner manages status
- Do not modify `.ralph/state.json` — the loop runner manages state
- Read `.ralph/progress.md` for accumulated project learnings
- Append new learnings to `.ralph/progress.md` if you discover important patterns
```

Replace with:

```markdown
## Autonomous Loop (Ralph) (AFTER)

1. Read `RALPH.md` for detailed per-iteration instructions
2. Read the backlog — find the current `in_progress` item
   ...

- Do not modify `backlog.json` — the loop runner manages status
- Do not modify `state.json` — the loop runner manages state
- Read `progress.md` for accumulated project learnings
- Append new learnings to `progress.md` if you discover important patterns
```

### 4.4 CLAUDE_GREENFIELD.md.tmpl Changes

Same transformation as CLAUDE_ADDON.md — the ralph section in this template contains identical hardcoded paths. Apply the same generic wording changes.

### 4.5 Embedded Artifacts Regeneration

After modifying the template files, the embedded artifacts must be regenerated:

```bash
# This script reads artifacts/ and writes packages/core/src/embedded-artifacts.ts
node scripts/generate-embedded-artifacts.ts
```

The generated `embedded-artifacts.ts` file embeds the template content as string literals. It must be regenerated whenever artifact templates change. This is an existing build step — no new infrastructure needed.

### 4.6 Impact on Existing Installations

Projects already installed with ralph will have the old RALPH.md with hardcoded `.ralph/` paths. This is fine because:

1. Existing installations only use the default root (`.ralph/`), so the paths are correct
2. The prompt-builder's "Active Backlog Root" section provides the canonical paths at runtime
3. If users want multi-backlog on existing projects, they can re-run the installer to update templates, or rely on the runtime path injection

## Dependencies

- `00-core-definitions.md` — `BacklogPaths`, `InstructionPaths` types
- `02-backlog-root-resolution.md` — `resolveBacklogPaths`, `resolveInstructionPaths`, `ensureStateDir`
- `03-lock-file-management.md` — `acquireLock`, `releaseLock`
- `04-core-module-refactor.md` — refactored core function signatures (all accept `BacklogPaths`)

## Verification

- [ ] `LoopRunner.create()` returns `Result<LoopRunner>` (not a bare constructor)
- [ ] `LoopRunner.create()` resolves `BacklogPaths` from `options.backlogRoot`
- [ ] `LoopRunner` constructor is private
- [ ] `LoopRunner.start()` calls `ensureStateDir` before any state file access
- [ ] `LoopRunner.start()` calls `acquireLock` and returns early on `LOCK_CONFLICT`
- [ ] `LoopRunner` finally block calls `releaseLock`
- [ ] All core function calls in runner.ts use `this.paths` instead of `this.projectPath`
- [ ] `readMarkerFile` still uses `this.projectPath` (project root)
- [ ] `buildPrompt` receives `BacklogPaths` + `InstructionPaths`
- [ ] `buildPrompt` uses `instructionPaths.ralphMd` (with fallback already resolved)
- [ ] `buildPrompt` uses `paths.progress` for progress.md (per-root, no fallback)
- [ ] `buildPrompt` ALWAYS injects "Active Backlog Root" section (including default root)
- [ ] `buildReviewPrompt` uses `instructionPaths.reviewMd` with embedded template fallback
- [ ] No hardcoded `.ralph/` path constants remain in prompt-builder.ts
- [ ] RALPH.md.tmpl uses generic filenames, not `.ralph/` prefixed paths
- [ ] CLAUDE_ADDON.md uses generic filenames, not `.ralph/` prefixed paths
- [ ] CLAUDE_GREENFIELD.md.tmpl uses generic filenames, not `.ralph/` prefixed paths
- [ ] `embedded-artifacts.ts` regenerated after template changes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (after updating prompt-builder test mocks)
