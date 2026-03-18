# Plan: Graceful Quit for `ralph loop run`

## Context

When running `ralph loop run`, pressing Ctrl+C immediately kills the active claude subprocess via `AbortController.abort()`. This can leave an iteration half-finished (uncommitted changes, partial work). Users need a way to signal "stop after this iteration completes" — letting the current claude session finish its work, commit, and exit cleanly before the loop stops.

## UX Design: Two-stage Ctrl+C

**First Ctrl+C**: Print `"Finishing current iteration... Press Ctrl+C again to force quit."` and set a soft-cancel flag. The running claude subprocess continues uninterrupted. The loop exits at the next iteration boundary.

**Second Ctrl+C**: Hard cancel — kills the subprocess immediately (today's behavior).

**SIGTERM**: Always hard cancel (non-interactive, used by system scripts).

This pattern is familiar from docker-compose, webpack-dev-server, etc. No raw mode or keypresses needed — just counting SIGINT signals.

## Changes

### 1. `packages/loop/src/runner.ts` — Add soft cancel support

Add a `softCancelled` boolean field and `requestGracefulStop()` method:

```typescript
private softCancelled = false;

/** Request graceful stop: finish current iteration, then exit. Does NOT kill the subprocess. */
requestGracefulStop(): void {
  this.softCancelled = true;
}
```

Update `isCancelled()` (line ~666) to check the new flag:

```typescript
private isCancelled(): boolean {
  if (this.softCancelled) return true;
  if (this.abortController.signal.aborted) return true;
  return checkCancelRequested(this.projectPath);
}
```

**Why this works**: `isCancelled()` is checked at iteration boundaries (top of while loop, line 129; between iterations, line 858) but NOT during `spawnClaude()`. So the claude process runs to completion, then the loop sees the flag and exits cleanly.

Update `LoopResult` to distinguish graceful vs forced cancel:

```typescript
export interface LoopResult {
  completedCount: number;
  blockedCount: number;
  cancelled: boolean;
  gracefulStop?: boolean;  // true when stopped via soft cancel (iteration completed)
  reviewItemsCreated?: number;
  reviewSummary?: string;
}
```

Update the cancellation return (line ~134) to set `gracefulStop`:

```typescript
return {
  completedCount: this.completedCount,
  blockedCount: this.blockedCount,
  cancelled: true,
  gracefulStop: this.softCancelled && !this.abortController.signal.aborted,
};
```

### 2. `packages/cli/src/loop-commands.ts` — Two-stage SIGINT handler

Replace the simple signal handler in `handleLoopRun` (lines 402-405):

```typescript
// Current:
const onSignal = () => runner.cancel();
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
```

With:

```typescript
let sigintCount = 0;

const onSigint = () => {
  sigintCount++;
  if (sigintCount === 1) {
    runner.requestGracefulStop();
    print("");
    info(
      c.yellow("Finishing current iteration... ") +
      c.dim("Press Ctrl+C again to force quit.")
    );
  } else {
    print("");
    info(c.red("Force quitting..."));
    runner.cancel();
  }
};

const onSigterm = () => runner.cancel();

process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);
```

Update the result display (lines ~414-425):

```typescript
if (result.cancelled && !result.gracefulStop) {
  info("Loop force-cancelled.");
} else if (result.gracefulStop) {
  info("Loop stopped gracefully after completing iteration.");
} else {
  // existing success message
}
```

Update the `finally` block to reference the new handler names.

Apply the same two-stage pattern to `handleLoopReview` (lines 471-474) for consistency.

### 3. No new exports needed

`requestGracefulStop()` is a method on `LoopRunner` which is already exported. `LoopResult` is already re-exported from `packages/loop/src/index.ts`.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Iteration finishes between 1st and 2nd Ctrl+C | Loop exits cleanly at next boundary check — 2nd Ctrl+C is harmless |
| No iteration running (between iterations) | `isCancelled()` returns true immediately, loop exits |
| Sleeping for usage limit | Soft cancel alone won't break sleep; 2nd Ctrl+C does hard cancel |
| Non-TTY stdin (piped) | Works fine — SIGINT still delivered, output may be piped but behavior is correct |
| JSON mode (`--json`) | `info()` suppressed; result JSON includes `gracefulStop: true` |
| Review pass running | Soft cancel lets review finish; checked at next boundary |

## Files to Modify

- `packages/loop/src/runner.ts` — `softCancelled` field, `requestGracefulStop()`, update `isCancelled()`, update `LoopResult`
- `packages/cli/src/loop-commands.ts` — two-stage SIGINT in `handleLoopRun` and `handleLoopReview`, update result display

## Verification

1. `pnpm typecheck` — no type errors
2. `pnpm test` — all existing tests pass
3. Manual test: run `ralph loop run .`, press Ctrl+C once during an iteration — should see "Finishing current iteration..." message and loop should exit cleanly after iteration completes
4. Manual test: press Ctrl+C twice quickly — should force quit immediately
5. Manual test: press Ctrl+C when no iteration is running (e.g., between iterations) — should exit immediately
