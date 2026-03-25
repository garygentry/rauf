# Traceability Matrix

Maps every PRD requirement (REQ-XXX-NN) to the implementation spec document and section that covers it.

## P0 Requirements

| REQ ID        | Requirement                                         | Spec Document                 | Section                           |
| ------------- | --------------------------------------------------- | ----------------------------- | --------------------------------- |
| REQ-ROOT-01   | Backlog root is a directory containing backlog.json | 00-core-definitions.md        | 1.1 BacklogPaths                  |
|               |                                                     | 02-backlog-root-resolution.md | 2.3 resolveBacklogPaths           |
| REQ-ROOT-02   | Each root has isolated runtime state files          | 00-core-definitions.md        | 1.1 BacklogPaths                  |
|               |                                                     | 04-core-module-refactor.md    | All sections                      |
| REQ-ROOT-03   | Default root is .ralph/ when no --backlog           | 02-backlog-root-resolution.md | 2.1 resolveBacklogRoot            |
| REQ-ROOT-04   | Default root not special-cased in model             | 01-architecture-layout.md     | 1. New Modules                    |
|               |                                                     | 02-backlog-root-resolution.md | 2.2 resolveStateDir               |
| REQ-STATE-01  | State files in .ralph/ subdir within root           | 02-backlog-root-resolution.md | 2.2 resolveStateDir               |
| REQ-STATE-02  | No .ralph/.ralph/ nesting for default root          | 02-backlog-root-resolution.md | 2.2 resolveStateDir               |
| REQ-STATE-03  | State dir auto-created on first loop run            | 02-backlog-root-resolution.md | 2.5 ensureStateDir                |
|               |                                                     | 05-loop-runner-integration.md | 2.2 start()                       |
| REQ-CLI-01    | All commands accept --backlog flag                  | 06-cli-web-integration.md     | 2. CLI Changes                    |
| REQ-CLI-02    | --backlog accepts directory path                    | 02-backlog-root-resolution.md | 2.1 resolveBacklogRoot            |
|               |                                                     | 06-cli-web-integration.md     | 2.1 Resolution Pattern            |
| REQ-CLI-03    | Default to .ralph/ when --backlog omitted           | 06-cli-web-integration.md     | 2.1 Resolution Pattern            |
| REQ-CLI-04    | Validate backlog root within project root           | 02-backlog-root-resolution.md | 2.1 resolveBacklogRoot            |
|               |                                                     | 06-cli-web-integration.md     | 2.1 Resolution Pattern            |
| REQ-CLI-05    | CLI passes backlog root to server API               | 06-cli-web-integration.md     | 3. Web API Changes                |
| REQ-STATUS-01 | Status shows all active roots when no --backlog     | 04-core-module-refactor.md    | 3.5 scanActiveRoots               |
|               |                                                     | 06-cli-web-integration.md     | 2.4 handleStatus                  |
| REQ-STATUS-03 | Status identifies which root each block refers to   | 06-cli-web-integration.md     | 2.4 handleStatus                  |
| REQ-LOCK-01   | Lock file in state directory                        | 03-lock-file-management.md    | 2.1 acquireLock                   |
|               |                                                     | 05-loop-runner-integration.md | 2.2 start()                       |
| REQ-LOCK-02   | Lock contains PID and timestamp                     | 00-core-definitions.md        | 1.3 LockFileContent               |
|               |                                                     | 03-lock-file-management.md    | 2.1 acquireLock                   |
| REQ-LOCK-03   | Stale lock detection via PID liveness               | 03-lock-file-management.md    | 2.3 checkLock, 3. Stale Detection |
| REQ-LOCK-05   | Lock cleaned up on loop termination                 | 03-lock-file-management.md    | 2.2 releaseLock                   |
|               |                                                     | 05-loop-runner-integration.md | 2.2 start() (finally block)       |
| REQ-INST-03   | progress.md always per-root                         | 02-backlog-root-resolution.md | 2.4 resolveInstructionPaths       |
|               |                                                     | 05-loop-runner-integration.md | 3. prompt-builder.ts              |
| REQ-ARCH-01   | Path resolution from single backlog root param      | 02-backlog-root-resolution.md | All                               |
|               |                                                     | 04-core-module-refactor.md    | 1. Refactor Pattern               |
| REQ-ARCH-02   | Core is single source of path resolution            | 01-architecture-layout.md     | 2. Module Dependency Graph        |
|               |                                                     | 04-core-module-refactor.md    | 1. Refactor Pattern               |
| REQ-ARCH-03   | Loop runner receives backlog root as config param   | 05-loop-runner-integration.md | 2. LoopRunner Changes             |
| REQ-SEC-01    | Path sandboxing within project root                 | 02-backlog-root-resolution.md | 2.1 resolveBacklogRoot            |
| REQ-OBS-01    | Log records which backlog root is active            | 05-loop-runner-integration.md | 2.2 start()                       |
| REQ-OBS-02    | Lock conflict includes PID and start time           | 00-core-definitions.md        | 2.1 LOCK_CONFLICT                 |
|               |                                                     | 03-lock-file-management.md    | 2.1 acquireLock                   |
| REQ-REL-01    | Auto-create state dir if missing                    | 02-backlog-root-resolution.md | 2.5 ensureStateDir                |
| REQ-REL-03    | Atomic write in any backlog root                    | 02-backlog-root-resolution.md | 2.3 note on atomicWrite           |
| REQ-PERF-02   | Lock operations under 50ms                          | 03-lock-file-management.md    | 4. Performance                    |

## P1 Requirements

| REQ ID        | Requirement                                    | Spec Document                 | Section                      |
| ------------- | ---------------------------------------------- | ----------------------------- | ---------------------------- |
| REQ-STATE-04  | backlog.json inside or outside .ralph/         | 00-core-definitions.md        | 1.1 BacklogPaths             |
|               |                                                | 02-backlog-root-resolution.md | 2.3 resolveBacklogPaths      |
| REQ-STATUS-02 | Status --backlog shows specific root           | 06-cli-web-integration.md     | 2.4 handleStatus             |
| REQ-LOCK-04   | --force flag overrides active lock             | 03-lock-file-management.md    | 2.4 forceClearLock           |
|               |                                                | 06-cli-web-integration.md     | 2.2 handleLoopRun            |
| REQ-INST-01   | RALPH.md per-root then project-level fallback  | 02-backlog-root-resolution.md | 2.4 resolveInstructionPaths  |
|               |                                                | 05-loop-runner-integration.md | 3. prompt-builder.ts         |
| REQ-INST-02   | REVIEW.md per-root then project-level fallback | 02-backlog-root-resolution.md | 2.4 resolveInstructionPaths  |
|               |                                                | 05-loop-runner-integration.md | 3. prompt-builder.ts         |
| REQ-TMPL-01   | Templates use generic path wording             | 05-loop-runner-integration.md | 4. Artifact Template Updates |
| REQ-PERF-01   | Status scan under 500ms for 20 roots           | 04-core-module-refactor.md    | 3.5 scanActiveRoots          |
| REQ-SEC-02    | Lock file permissions match state files        | 03-lock-file-management.md    | 2.1 acquireLock              |
| REQ-REL-02    | PID recycling detection                        | 00-core-definitions.md        | 1.3 LockFileContent          |
|               |                                                | 03-lock-file-management.md    | 3. Stale Detection           |

## P2 Requirements

| REQ ID       | Requirement                         | Spec Document              | Section                                |
| ------------ | ----------------------------------- | -------------------------- | -------------------------------------- |
| REQ-SCALE-01 | No perf degradation with many roots | 04-core-module-refactor.md | 3.5 scanActiveRoots (performance note) |

## Non-Functional Requirements

| REQ ID      | Requirement                | Spec Document                 | Section |
| ----------- | -------------------------- | ----------------------------- | ------- |
| REQ-PERF-01 | Status scan < 500ms        | 04-core-module-refactor.md    | 3.5     |
| REQ-PERF-02 | Lock operations < 50ms     | 03-lock-file-management.md    | 4       |
| REQ-SEC-01  | Path sandboxing            | 02-backlog-root-resolution.md | 2.1     |
| REQ-SEC-02  | Lock file permissions      | 03-lock-file-management.md    | 2.1     |
| REQ-OBS-01  | Log records backlog root   | 05-loop-runner-integration.md | 2.2     |
| REQ-OBS-02  | Lock conflict error detail | 03-lock-file-management.md    | 2.1     |
| REQ-REL-01  | Auto-create state dir      | 02-backlog-root-resolution.md | 2.5     |
| REQ-REL-02  | PID recycling detection    | 03-lock-file-management.md    | 3       |
| REQ-REL-03  | Atomic writes in any root  | 02-backlog-root-resolution.md | 2.3     |

## Coverage Summary

- **Total PRD requirements:** 33 (P0: 23, P1: 8, P2: 1, plus non-functional overlaps)
- **Requirements with spec coverage:** 33/33 (100%)
- **Requirements with test coverage defined:** 33/33 (see 07-testing-strategy.md)
