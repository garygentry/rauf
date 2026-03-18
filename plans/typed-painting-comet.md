# Interactive Loop CLI — Animated Status Line with Spinner + Timer

## Context

Ralph loop iterations can run 30-60+ minutes. During LLM execution (`llm_spawned` → `llm_exited`), the terminal is completely static — no output until Claude exits. This makes it unclear whether the loop is working, hung, or stalled. We're adding an animated status line with a braille dot spinner and elapsed timer to provide visual feedback during these long silent periods.

**Scope:** Phase 1 only — purely CLI-layer changes. No modifications to `packages/loop` or `packages/core`. Real-time Claude activity streaming via `--output-format stream-json` is deferred to a follow-up (Phase 2).

## Implementation

### New file: `packages/cli/src/status-line.ts` (~80 LOC)

A `StatusLine` class that owns the bottom terminal line during long-running phases.

**Visual output:**
```
⠸ Claude working on #fix-auth: Fix authentication timeout  [4m 23s]
⠸ Rate limited — resumes in 12m 34s
```

**API:**
```typescript
interface StatusLineOptions {
  isTTY: boolean;
  quiet: boolean;
  json: boolean;
  noColor: boolean;
}

class StatusLine {
  constructor(options: StatusLineOptions);

  // Start spinner + elapsed timer. No-op if non-TTY/quiet/json.
  start(message: string): void;

  // Start spinner + countdown timer to a target time.
  startCountdown(message: string, until: Date): void;

  // Update message text without restarting timer.
  update(message: string): void;

  // Stop animation, clear the line.
  stop(): void;

  // Temporarily hide/show the status line around normal print() calls.
  pause(): void;
  resume(): void;

  get active(): boolean;
}
```

**Implementation details:**
- Braille dot spinner frames: `["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]`
- Fallback for `--no-color`: ASCII `["|","/","-","\\"]`
- Single `setInterval` at 80ms — each tick updates spinner frame and recomputes timer text
- Renders via `process.stdout.write("\r\x1b[K" + line)` — carriage return + clear to EOL
- All methods are no-ops when `!isTTY || quiet || json`
- Timer formats: `Xs` (< 1m), `Xm Ys` (< 1h), `Xh Ym Zs` (>= 1h)
- Countdown mode: computes `until - now`, same format, stops at 0

### Modified: `packages/cli/src/loop-commands.ts`

#### In `handleLoopRun()`:

1. Create `StatusLine` instance with TTY/quiet/json/color flags
2. Wrap event handling to pause/resume status line around `formatAndPrintEvent()`:

```typescript
const statusLine = new StatusLine({
  isTTY: process.stdout.isTTY ?? false,
  quiet: ctx.globalFlags.quiet,
  json: ctx.globalFlags.json,
  noColor: ctx.globalFlags.noColor,
});

// Track current item for status line messages
let currentItemId = "";
let currentItemTitle = "";

for (const eventType of eventTypes) {
  runner.on(eventType, (event: LoopEvent) => {
    statusLine.pause();
    formatAndPrintEvent(event);

    // Drive status line from events
    switch (event.type) {
      case "item_selected":
        currentItemId = event.itemId;
        currentItemTitle = event.title;
        break;
      case "llm_spawned":
        statusLine.start(`Claude working on #${currentItemId}: ${currentItemTitle}`);
        break;
      case "llm_exited":
        statusLine.stop();
        break;
      case "sleep_start":
        statusLine.startCountdown(
          "Rate limited — resumes in",
          new Date(event.sleepUntil),
        );
        break;
      case "sleep_end":
        statusLine.stop();
        break;
      case "review_started":
        statusLine.start("Review pass running");
        break;
      case "review_completed":
      case "review_failed":
        statusLine.stop();
        break;
      default:
        statusLine.resume();
    }
  });
}
```

3. In the `onSigint` handler: call `statusLine.stop()` before printing cancel message
4. In the `finally` block: call `statusLine.stop()`

#### In `handleLoopFollow()` (SSE mode):

Same StatusLine integration, driven from parsed SSE events instead of direct LoopRunner events.

### New file: `packages/cli/src/status-line.test.ts`

Test coverage for:
- Frame rotation (braille and ASCII fallback)
- Timer formatting (seconds, minutes, hours)
- Countdown timer computation
- No-op behavior when non-TTY/quiet/json
- `pause()`/`resume()` correctly hides and restores

### Files summary

| File | Action | LOC estimate |
|------|--------|-------------|
| `packages/cli/src/status-line.ts` | Create | ~80 |
| `packages/cli/src/status-line.test.ts` | Create | ~60 |
| `packages/cli/src/loop-commands.ts` | Modify | ~40 lines added |

### Graceful degradation

| Condition | Behavior |
|-----------|----------|
| TTY + color | Braille spinner + colored timer |
| TTY + `--no-color` | ASCII spinner `\|/-\` + plain timer |
| Non-TTY (piped) | No spinner, no timer — standard line output only |
| `--quiet` | No spinner, no timer |
| `--json` | No spinner, no timer — clean JSON output |

### Performance

- One `setInterval` at 80ms = 12.5 redraws/sec
- Each redraw: one `process.stdout.write()` of ~80 characters
- Timer text recomputed inline (one `Date.now()` + arithmetic) — negligible
- Zero impact on the loop runner, Claude process, or event system

## Verification

1. `pnpm typecheck` — no type errors
2. `pnpm test` — all existing + new status-line tests pass
3. `pnpm lint` — clean
4. Manual: `ralph loop run .` — observe spinner + timer during LLM execution, countdown during sleep
5. Manual: `ralph loop run . --quiet` — no spinner output
6. Manual: `ralph loop run . --json` — clean JSON, no ANSI
7. Manual: pipe output (`ralph loop run . | cat`) — no ANSI escape corruption
8. Manual: Ctrl+C during LLM execution — spinner clears cleanly before cancel message

## Future work (Phase 2)

Real-time Claude activity streaming by switching to `--output-format stream-json`:
- Show what Claude is actively doing on the status line (e.g., "Editing src/auth.ts", "Running tests")
- Add `llm_activity` event to the event system
- Add `spawnClaudeStreaming` to `claude-process.ts`
- Wire into LoopRunner with `onProgress` callback (provider abstraction already supports this)
