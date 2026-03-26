# Multi-Backlog Implementation Review & Fix Plan

## Context

The multi-backlog feature (16 backlog items) has been implemented. This plan addresses gaps and issues found during a comprehensive code review comparing the implementation against the specs in `specs/multi-backlog/`.

## Review Summary

### Passing Areas (No Changes Needed)

The following are **fully compliant** with specifications:

- **backlog-root.ts** — All 5 functions, interfaces, constants correct
- **lock.ts** — All 4 functions, stale detection, error formats correct
- **backlog.ts** — All functions accept BacklogPaths, internal helpers deleted, addItem uses paths.projectPath
- **status.ts** — All functions accept BacklogPaths, scanActiveRoots implemented, ActiveRoot interface correct
- **iteration-status.ts** — Throttle key correctly uses paths.iterationStatus
- **archive.ts** — All functions accept BacklogPaths
- **reset.ts** — resetProject uses paths, deployProgress uses paths.stateDir
- **errors.ts** — LOCK_CONFLICT error code present
- **schemas.ts** — LoopStartOptionsSchema has backlogRoot
- **index.ts** — Barrel exports backlog-root.js and lock.js before backlog.js, test-helpers not exported
- **runner.ts** — Static factory pattern, lock lifecycle, all core calls use this.paths
- **prompt-builder.ts** — Active Backlog Root section always injected, instruction paths used correctly
- **CLI commands** — All handlers have 3-line --backlog preamble
- **Web routes** — backlog routes in projects.ts use resolveBacklogPathsFromParam, loop routes pass backlogRoot
- **LoopManager** — Keyed by backlog root path
- **Artifact templates** — No .ralph/ prefixed paths
- **Test helpers** — createMultiRootProject works correctly
- **Test sandbox** — Multi-backlog scenario exists

### Issues Found

#### Issue 1: Two failing tests in `packages/cli/src/loop-commands.test.ts`

**Tests:**
1. `handleLoopStop > errors with helpful message when server not running` (line 111)
2. `handleLoopFollow > errors when server not running` (line 134)

**Root Cause:** The multi-backlog refactor changed these test assertions from the original strict expectations to more permissive ones, but the tests still fail because `isServerRunning()` at line 79 reads a stale server state file and may return `true` when a ralph server process is actually running on this machine. When `isServerRunning()` returns true:

- `handleLoopStop` tries to POST to the server, which may return an unexpected error rather than "Server is not running" or "No active loop"
- `handleLoopFollow` tries to connect via SSE instead of going to direct mode, yielding "SSE connection failed: terminated" instead of "not found"

**The original tests (pre-multi-backlog) expected:**
- handleLoopStop: `"Server is not running"` exactly
- handleLoopFollow: `"No active loop"` and `"ralph loop run"`

**The multi-backlog refactor changed these to:**
- handleLoopStop: `"Server is not running"` OR `"No active loop"` (more permissive but still wrong when server IS running)
- handleLoopFollow: `"not found"` (assumes direct mode path resolution will fail, but server mode is reached instead)

**Fix:** The tests need to be robust to the environment. Either:
- Mock `isServerRunning()` to always return false for these tests, OR
- Make the assertions match ALL possible scenarios (server running, not running, stale state)

**Recommended approach:** The tests should be deterministic. Since these test "no server" scenarios, mock the server state to ensure `isServerRunning()` returns false. This restores the original test intent while being environment-independent.

**Files to modify:**
- `packages/cli/src/loop-commands.test.ts` lines 111-127 and 134-146

**Fix details:**

For `handleLoopStop` test (line 111):
```typescript
// Before the test, ensure no stale server state
// Mock or clean server state so isServerRunning() returns false
const output = await captureOutput(async () => {
  const code = await stopHandler(ctx);
  expect(code).toBe(ExitCode.ERROR);
});
expect(output.stderr).toContain("Server is not running");
```

For `handleLoopFollow` test (line 134):
```typescript
// Same approach — ensure isServerRunning() returns false
// Then the test hits direct mode → resolveBacklogPaths fails for /tmp/some-project
const output = await captureOutput(async () => {
  const code = await followHandler(ctx);
  expect(code).toBe(ExitCode.ERROR);
});
// In direct mode, resolveBacklogPaths for /tmp/some-project/.ralph will fail
expect(output.stderr).toContain("not found");
```

The key question is how to mock `isServerRunning()`. Check how `readServerState()` works — it reads from a state file. If we can clear that file or mock it before the test, we solve the issue. Look at:
- `packages/cli/src/loop-commands.ts:79-82` for `isServerRunning`
- Where `readServerState()` is defined and what file it reads
- Other tests that successfully test "no server" scenarios (e.g., server-commands.test.ts)

#### Issue 2: No additional issues found

The implementation is comprehensive and well-aligned with all 16 backlog items and the detailed specs.

## Fix Plan

### Step 1: Fix loop-commands.test.ts test failures

1. Read `readServerState()` implementation to understand what state file it reads
2. Find how other test files (e.g., `server-commands.test.ts`) handle server state mocking
3. Add setup/teardown in the failing test `describe` blocks to ensure no stale server state
4. Restore deterministic assertions:
   - handleLoopStop: expect "Server is not running"
   - handleLoopFollow: expect "not found" (direct mode path resolution failure)

### Step 2: Verify

```bash
pnpm test packages/cli/src/loop-commands.test.ts
pnpm typecheck
pnpm test  # full suite
```

## Critical Files

- `packages/cli/src/loop-commands.test.ts` — the only file that needs modification
- `packages/cli/src/loop-commands.ts:79-82` — isServerRunning implementation (read-only reference)
- `packages/cli/src/server-commands.test.ts` — reference for how to mock server state (read-only reference)

## Verification

1. `pnpm test` — all tests pass (currently 2 failures → 0)
2. `pnpm typecheck` — passes (already passing)
3. No regressions in other test files
