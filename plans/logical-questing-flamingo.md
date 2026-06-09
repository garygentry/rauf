# Plan: Make `ralph loop follow` work in direct mode

## Context

`ralph loop follow` only works when the web server is running (server mode via `ralph loop start`). It checks `~/.ralph/server.json` and hard-fails if no server process exists. But users commonly run `ralph loop run` in one terminal (direct mode, no server) and want to follow output in another terminal. The fix: fall back to tailing `.ralph/ralph.log` when no server is detected.

## Changes

**Single file modified:** `packages/cli/src/loop-commands.ts`

### 1. Add imports from `@rauf/core`

Line 14 — add `deriveStatus`, `readLogTail`, `watchLog` to the existing import:

```typescript
import { readToolConfig, LoopStartOptionsSchema, readIterationStatus, type LoopEvent, type IterationStatus, deriveStatus, readLogTail, watchLog } from "@rauf/core";
```

### 2. Add `followDirectMode()` helper function

Insert before `handleLoopFollow` (~line 318). This function:

- Calls `deriveStatus(projectPath)` to check if a loop is active (`RUNNING` or `SLEEPING_LIMIT`)
- If not active, shows error with guidance to start a loop
- Prints recent log lines via `readLogTail(projectPath, 20)` for context
- Starts `watchLog()` to stream new lines (wrapped in try/catch since `fs.watch` throws if file doesn't exist yet)
- Polls `deriveStatus()` every 2s to detect terminal states (`IDLE`, `COMPLETE`, `ERROR`, `PAUSED`, `PAUSED_HUMAN`, `LIMIT_REACHED`, `WEEKLY_LIMIT`)
- On terminal state: prints status message and exits
- Handles SIGINT/SIGTERM for clean shutdown (same pattern as existing `handleLoopWatch` at line ~832)
- Retries `watchLog()` setup on each poll tick if initial attempt failed (handles log file not yet created)

### 3. Modify `handleLoopFollow()` (lines 320-344)

Replace the hard-fail with a branch:

```typescript
export async function handleLoopFollow(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);
  const id = projectId(projectPath);

  // Server mode: existing SSE streaming behavior
  if (isServerRunning()) {
    const port = getPort();
    const url = apiUrl(port, id, "events");
    info(`Following loop events for ${c.cyan(id)}...`);
    info(c.dim("Press Ctrl+C to stop."));
    const statusLine = new StatusLine({ ... });
    return streamEventsUntilDone(url, statusLine);
  }

  // Direct mode: tail ralph.log
  return followDirectMode(projectPath);
}
```

## Key design decisions

- **No core changes needed** — `watchLog`, `readLogTail`, and `deriveStatus` are already exported from `@rauf/core`
- **Server mode unchanged** — the `isServerRunning()` check still takes priority; SSE path is untouched
- **2s poll interval** for state checking — matches the staleness model in `deriveStatus()` without being too chatty
- **`watchLog` throws if file missing** — handle with try/catch and retry on next poll tick

## Verification

1. Run `ralph loop run .` in terminal A
2. Run `ralph loop follow .` in terminal B — should see log lines streaming
3. Let loop finish — follow should detect terminal state and exit
4. Run `ralph loop follow .` with no loop running — should show "no active loop" error
5. Run with server mode (`ralph loop start` + `ralph loop follow`) — should still use SSE path
6. Test sandbox: `bash test-sandbox/run.sh` in terminal A, `ralph loop follow test-sandbox/project` in terminal B

## Files

| File | Action |
|------|--------|
| `packages/cli/src/loop-commands.ts` | Modify — add imports, `followDirectMode()`, update `handleLoopFollow()` |
| `packages/core/src/status.ts` | Read-only — provides `watchLog`, `readLogTail`, `deriveStatus` |
| `packages/core/src/schemas.ts` | Read-only — defines `LoopStateEnum` values |
