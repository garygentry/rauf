# Multi-Backlog Support — Product Requirements Document

## 1. Problem Statement

Ralph currently operates on a single `backlog.json` per project, located at `.ralph/backlog.json`. While this simplifies management, it creates significant friction for projects with multiple features under concurrent development:

- **Manual copy/reset cycle:** When using feature-forge (or any workflow that produces per-feature backlogs), users must manually copy `backlog.json` to `.ralph/`, reset state files, run the loop, then repeat for the next feature. This is error-prone and tedious.
- **State pollution:** A single `state.json`, `progress.md`, and `ralph.log` conflate context from unrelated features. Progress learnings from feature A leak into feature B's loop iterations. Completed item counts span features.
- **No concurrent development:** Only one feature's backlog can be active at a time. Switching between features requires manual state management, making it impractical to interleave work.
- **Feature-forge friction:** The feature-forge plugin generates backlogs at `specs/{feature}/backlog.json` — a natural per-feature location — but ralph cannot consume them in place.

This feature introduces the concept of a **backlog root** — a self-contained directory that holds a backlog and its isolated runtime state — enabling ralph to operate on any backlog location without manual file shuffling.

## 2. User Stories

### Primary Actor: Project Operator (human managing ralph loops)

- As an operator, I want to run ralph against a specific feature's backlog (`ralph loop run . --backlog specs/auth`) so that I can develop features independently without manual file management.
- As an operator, I want each backlog root to have its own isolated state (state.json, ralph.log, progress.md) so that one feature's loop history doesn't contaminate another's.
- As an operator, I want `ralph status` to show all active backlog roots so that I can see which features have running or paused loops at a glance.
- As an operator, I want to use `ralph backlog list/add/update/delete` with a `--backlog` flag so that I can manage any feature's backlog without switching context.
- As an operator, I want the default behavior (no `--backlog` flag) to work exactly as it does today, targeting `.ralph/backlog.json`, so that existing workflows are preserved.

### Secondary Actor: Feature-Forge Pipeline

- As the feature-forge pipeline, I want ralph to consume backlogs directly from `specs/{feature}/backlog.json` so that generated backlogs don't need to be manually relocated.
- As the feature-forge pipeline, I want ralph state files to be namespaced under `specs/{feature}/.ralph/` so that forge artifacts (PRD.md, tech-spec.md) and ralph state coexist without collision.

### Secondary Actor: CI/Automation

- As a CI script, I want a lock file mechanism to prevent accidentally starting two loops against the same backlog root so that concurrent execution doesn't corrupt state.

## 3. Functional Requirements

### 3.1 Backlog Root Concept

- REQ-ROOT-01: A **backlog root** is a directory containing a `backlog.json` file. It is the unit of isolation for ralph loop execution.
  - Priority: P0
- REQ-ROOT-02: Each backlog root has its own isolated set of runtime state files: `state.json`, `ralph.log`, `progress.md`, `iteration-status.json`, `DONE`, `CANCEL`, and `archive/` directory.
  - Priority: P0
- REQ-ROOT-03: The **default backlog root** is the project-level `.ralph/` directory (containing `.ralph/backlog.json`). When no `--backlog` flag is provided, all commands operate on this default root.
  - Priority: P0
- REQ-ROOT-04: The default root is not special-cased in the model. It is one instance of the general backlog root concept, identified by the `.ralph/` directory path.
  - Priority: P0

### 3.2 State Directory Resolution

- REQ-STATE-01: State files for a backlog root are stored in a `.ralph/` subdirectory within the backlog root directory.
  - Priority: P0
  - Notes: For a backlog root at `specs/auth/`, state lives at `specs/auth/.ralph/`.
- REQ-STATE-02: When the backlog root directory is itself named `.ralph/` (the default root case), state files coexist alongside `backlog.json` in the same directory — no nested `.ralph/.ralph/`.
  - Priority: P0
  - Notes: Implementation guidance — detection mechanism (e.g., checking if the backlog root directory name is `.ralph/`) is determined at tech-spec time.
- REQ-STATE-03: The state directory must be created automatically when a loop first runs against a backlog root, if it does not already exist.
  - Priority: P0
- REQ-STATE-04: `backlog.json` may live either inside the `.ralph/` state directory or directly in the backlog root directory (outside `.ralph/`). Both locations must be supported.
  - Priority: P1
  - Notes: Feature-forge places backlog.json at `specs/auth/backlog.json` (outside `.ralph/`). If supporting both locations adds excessive complexity, backlog.json may be required to live within `.ralph/` — but the preferred model supports it outside.

### 3.3 CLI `--backlog` Flag

- REQ-CLI-01: All CLI commands that operate on a project's backlog or loop must accept an optional `--backlog <dir>` argument specifying the backlog root directory path (relative to the project root).
  - Priority: P0
  - Affected commands: `loop run`, `loop start`, `loop stop`, `loop follow`, `loop review`, `backlog list`, `backlog add`, `backlog update`, `backlog delete`, `backlog unblock`, `status`, `reset`.
- REQ-CLI-02: The `--backlog` argument accepts a **directory path**, not a file path. Ralph resolves `backlog.json` within that directory.
  - Priority: P0
  - Example: `ralph loop run . --backlog specs/auth` resolves to `specs/auth/backlog.json`.
- REQ-CLI-03: When `--backlog` is omitted, all commands default to the project-level `.ralph/` directory as the backlog root (current behavior).
  - Priority: P0
- REQ-CLI-04: The resolved backlog root path must be validated as existing within the project root directory (the directory containing `.ralph.json`). Paths that resolve outside the project root must be rejected with a clear error.
  - Priority: P0
  - Notes: Implementation guidance — validation approach (e.g., `path.resolve()` + `startsWith()`) is consistent with existing path sandboxing conventions in CLAUDE.md.
- REQ-CLI-05: When the web server is running and `--backlog` is specified, the CLI must pass the backlog root path to the server API. The server must route loop management operations (start, stop, follow) and backlog CRUD operations to the specified root.
  - Priority: P0

### 3.4 Status Display

- REQ-STATUS-01: `ralph status` (without `--backlog`) must show the status of the default root AND list any other backlog roots that have a non-idle `state.json`.
  - Priority: P0
  - Notes: Active roots may be discovered via filesystem scan or a lightweight index (see OQ-02). The mechanism is determined at tech-spec time.
- REQ-STATUS-02: `ralph status --backlog <dir>` must show detailed status for that specific backlog root only.
  - Priority: P1
- REQ-STATUS-03: The status output must clearly identify which backlog root each status block refers to, using the relative path from the project root.
  - Priority: P0

### 3.5 Lock File Mechanism

- REQ-LOCK-01: Before starting a loop, ralph must create a lock file in the backlog root's state directory to signal that a loop is active.
  - Priority: P0
- REQ-LOCK-02: The lock file must contain the PID of the loop process and a timestamp.
  - Priority: P0
- REQ-LOCK-03: If a lock file exists when starting a loop, ralph must check if the PID is still running. If the process is dead, the lock is stale and ralph must remove it and proceed. If the process is alive, ralph must refuse to start with a clear error message.
  - Priority: P0
- REQ-LOCK-04: A `--force` flag must allow overriding an active lock (removing it and proceeding), with a warning.
  - Priority: P1
- REQ-LOCK-05: The lock file must be cleaned up when the loop terminates (normally or via cancellation). Crash cleanup relies on stale PID detection (REQ-LOCK-03).
  - Priority: P0

### 3.6 Instruction File Resolution (RALPH.md, REVIEW.md)

- REQ-INST-01: When running a loop, ralph must look for `RALPH.md` in the backlog root's state directory first. If not found, fall back to the project-level `.ralph/RALPH.md`.
  - Priority: P1
  - Notes: Practically, RALPH.md will be project-wide for most projects. Per-root override is for edge cases. When falling back to the project-level RALPH.md, the loop runner must provide the active backlog root path as context to the agent (e.g., via system prompt). The RALPH.md content is not path-rewritten. This ensures the agent knows which state directory to operate on, even when using project-wide instructions. See REQ-ARCH-03.
- REQ-INST-02: The same fallback logic applies to `REVIEW.md`.
  - Priority: P1
- REQ-INST-03: `progress.md` is always per-backlog-root (no fallback). Each root accumulates its own learnings.
  - Priority: P0

### 3.7 Core Architecture

- REQ-ARCH-01: Path resolution for all state files (state.json, ralph.log, progress.md, lock file, DONE, CANCEL, iteration-status.json, archive/) must be derived from a single "backlog root" parameter, not hardcoded to `.ralph/`.
  - Priority: P0
  - Notes: Implementation guidance — existing path-resolution helpers in core (e.g., `getBacklogPath()`, `getStatePath()`) are candidates for refactoring to accept a backlog root parameter. Specific function signatures are determined at tech-spec time.
- REQ-ARCH-02: The `packages/core` package must remain the single source of path resolution logic. CLI, web, and loop packages must not independently construct state file paths.
  - Priority: P0
- REQ-ARCH-03: The loop runner must receive the backlog root path as a configuration parameter and pass it through to all core function calls.
  - Priority: P0

## 4. Non-Functional Requirements

### 4.1 Performance

- REQ-PERF-01: Status scanning for active backlog roots must complete in under 500ms for projects with up to 20 backlog roots.
  - Priority: P1
- REQ-PERF-02: Lock file creation and PID checking must be effectively instant (< 50ms).
  - Priority: P0

### 4.2 Security

- REQ-SEC-01: Backlog root paths must be sandboxed within the project root. No path traversal (e.g., `--backlog ../../other-project`) is allowed.
  - Priority: P0
- REQ-SEC-02: Lock files must not be world-writable. Use the same file permissions as existing state files.
  - Priority: P1

### 4.3 Observability

- REQ-OBS-01: When a loop starts, the log must record which backlog root it is operating on (relative path from project root).
  - Priority: P0
- REQ-OBS-02: Error messages related to lock conflicts must include the PID and start time of the conflicting process.
  - Priority: P0

### 4.4 Reliability

- REQ-REL-01: If the state directory does not exist when a loop starts, it must be created automatically (including parent directories).
  - Priority: P0
- REQ-REL-02: Stale lock detection must handle the case where a PID has been recycled (different process now holds the same PID). Using creation timestamp comparison is acceptable.
  - Priority: P1
- REQ-REL-03: Atomic write guarantees (write .tmp then rename, .bak backups) must apply to all state files in any backlog root, not just the default.
  - Priority: P0

### 4.5 Scalability

- REQ-SCALE-01: The multi-backlog model must not degrade core loop execution performance regardless of the number of backlog roots in the project. Status scanning performance targets are defined in REQ-PERF-01.
  - Priority: P2

Note: Accessibility requirements are not applicable (CLI tool with no graphical interface).

## 5. Constraints

- **Existing `.ralph/` convention:** The project-level `.ralph/` directory and `.ralph.json` marker file are established conventions. The multi-backlog model must coexist with these — `.ralph.json` remains the project marker, and `.ralph/` remains the default backlog root.
- **Feature-forge compatibility:** The model should support feature-forge's convention of placing backlogs at `specs/{feature}/backlog.json` without requiring feature-forge changes. Ralph adapts to where the backlog is, not the other way around.
- **No tight coupling to feature-forge:** Ralph must not import from, depend on, or reference feature-forge. The integration is convention-based (directory structure), not code-based.
- **Core package independence:** `packages/core` must not import from `cli`, `web`, or `loop` (existing rule, maintained).
- **Single loop per backlog root:** Only one loop process may be active per backlog root at any time, enforced by the lock file.

## 6. Out of Scope

The following are explicitly **not** part of this feature:

- **Cross-project backlogs:** Sharing a backlog between multiple ralph projects (different `.ralph.json` markers).
- **Backlog merging/splitting:** Tools to combine items from multiple backlogs or split a single backlog across roots.
- **Automatic backlog routing:** Ralph deciding which backlog root to pull work from based on priority across roots.
- **Web app multi-root support:** The web dashboard showing multiple backlog roots, multi-root status, or root-scoped views. This is a follow-up feature (P1).
- **Git worktree auto-creation:** Automatically creating git worktrees for parallel feature development. This is a follow-up (P1).
- **Parallel loop execution:** Running multiple loops simultaneously against different backlog roots in the same project. This is a follow-up (P1), gated on worktree support.
- **Auto-discovery of backlog roots for loop execution:** Ralph will not automatically select which backlog root to operate on. Users must specify roots explicitly via `--backlog`. (Status display performs a limited scan for active roots per REQ-STATUS-01; this is not general-purpose discovery.)
- **Migration CLI command:** No `ralph migrate` command. Migration is handled via a guide document and agent prompt (see below).

## 7. Migration

Existing projects using `.ralph/backlog.json` with the current single-backlog model will continue to work if the default root path resolution is preserved. However, if the optimal model requires changes to the default root's internal file layout, a **migration guide** (not a CLI command) must be produced as a spec artifact:

- `specs/multi-backlog/MIGRATION.md` — step-by-step instructions for updating a legacy ralph project
- The guide must include a self-contained **agent prompt** that can be pasted into a Claude Code session to perform the migration automatically
- The number of affected projects is small (< 10), so a code-level migration command is not justified

## 8. Open Questions

- **OQ-01:** Should the lock file live at `{state_dir}/loop.lock` or use a different naming convention? Need to ensure it doesn't collide with any existing files.
- **OQ-02:** For status scanning of active roots — should this be a simple filesystem scan (`**/backlog.json`), or should active roots be registered in a lightweight index file (e.g., `.ralph/roots.json`)? The scan is simpler but may be slow in large monorepos.
- **OQ-03:** When `backlog.json` lives outside the `.ralph/` state directory (e.g., `specs/auth/backlog.json` with state at `specs/auth/.ralph/`), should backup files (`backlog.json.bak`) be written alongside the original backlog.json or inside the `.ralph/` state directory?

## 9. Success Criteria

- A user can run `ralph loop run . --backlog specs/auth` and the loop executes against `specs/auth/backlog.json` with fully isolated state in `specs/auth/.ralph/`.
- Running `ralph loop run .` (no flag) works exactly as the current behavior, targeting `.ralph/backlog.json`.
- `ralph status .` shows the default root's status AND lists any other roots with active (non-idle) loops.
- Attempting to start a second loop on the same backlog root produces a clear lock conflict error with PID information.
- All `ralph backlog` subcommands accept `--backlog` and operate on the specified root.
- Feature-forge generated backlogs at `specs/{feature}/backlog.json` can be consumed directly without file copying.
- The core path resolution logic is parameterized by backlog root, with no hardcoded `.ralph/` assumptions outside the "default root" resolution.

## 10. Priority Summary

| Priority | Requirements |
|----------|-------------|
| P0 | REQ-ROOT-01–04, REQ-STATE-01–03, REQ-CLI-01–05, REQ-STATUS-01, REQ-STATUS-03, REQ-LOCK-01–03, REQ-LOCK-05, REQ-INST-03, REQ-ARCH-01–03, REQ-SEC-01, REQ-OBS-01–02, REQ-REL-01, REQ-REL-03, REQ-PERF-02 |
| P1 | REQ-STATE-04, REQ-STATUS-02, REQ-LOCK-04, REQ-INST-01–02, REQ-PERF-01, REQ-SEC-02, REQ-REL-02 |
| P2 | REQ-SCALE-01 |
