# Plan: First-Class Usage Limit Startup Support

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Context

The usage limit handling implemented in the previous session is **reactive** — it only detects a limit after `claude -p` fails mid-iteration. This means starting `ralph.sh` when already at the limit causes:
1. Item selected and marked `in_progress`
2. Claude invoked → immediately fails with limit error
3. Item reset to `pending`
4. Detection block: sleep, resume

This wastes an iteration count and creates unnecessary backlog churn. The user's primary use case is **starting the loop overnight to wait for the reset window** — this should work like:
```
$ ./ralph.sh
[ralph] Claude usage limit active — 5-hour window resets at 2:00 AM (in 4h 32m)
[ralph] Sleeping until reset. Run ralph-stop.sh to cancel.
[ralph] Woke up — resuming loop
[ralph] --- Iteration 1 / 50 ---   ← clean start, no wasted iteration
```

Three improvements are needed:
1. **Pre-flight usage check** at loop startup — detect limit before entering the while loop
2. **Always display usage stats** as informational output at startup (not just on limit detection)
3. **Human-readable time messaging** in both bash logs and CLI status display

---

## Task 1: Pre-flight Usage Check in ralph.sh

**File:** `artifacts/variants/backlog-json/ralph.sh`

Insert a usage check block **after** the existing preflight tool checks but **before** `write_state "starting"` and the while loop. The exact insertion point is after the auto-sweep block and before the `log "====..."` banner line.

```bash
# ---------------------------------------------------------------------------
# Pre-flight usage limit check — detect active limits before first iteration
# ---------------------------------------------------------------------------
log "Checking Claude usage limits..."
PREFLIGHT_TOKEN=$(get_oauth_token)
PREFLIGHT_USAGE=$(check_usage_api "$PREFLIGHT_TOKEN")

if [[ -n "$PREFLIGHT_USAGE" ]]; then
  PF_SEVEN_PCT=$(echo "$PREFLIGHT_USAGE" | jq -r '.seven_day.utilization // 0' | cut -d. -f1)
  PF_FIVE_PCT=$(echo "$PREFLIGHT_USAGE"  | jq -r '.five_hour.utilization // 0'  | cut -d. -f1)
  PF_FIVE_RESET=$(echo "$PREFLIGHT_USAGE"  | jq -r '.five_hour.resets_at // ""')
  PF_SEVEN_RESET=$(echo "$PREFLIGHT_USAGE" | jq -r '.seven_day.resets_at // ""')

  # Always display usage stats as informational output
  log "  Usage: 5-hr ${PF_FIVE_PCT}% | 7-day ${PF_SEVEN_PCT}%"

  if [[ "$PF_SEVEN_PCT" -ge 100 ]]; then
    log "⛔ Weekly usage limit exhausted (${PF_SEVEN_PCT}%) — cannot start"
    log "   Weekly window resets at: $(format_reset_time "$PF_SEVEN_RESET")"
    log "   Restart ralph.sh after that time."
    write_state_limit "weekly_limit" "$PF_SEVEN_RESET" \
      "Weekly Claude usage limit exhausted. Resets at: $PF_SEVEN_RESET"
    echo "weekly_limit:$PF_SEVEN_RESET" > "$RALPH_DIR/DONE"
    trap - EXIT
    exit 3

  elif [[ "$PF_FIVE_PCT" -ge 100 ]]; then
    SLEEP_SECS=1800  # 30-min fallback
    if [[ -n "$PF_FIVE_RESET" ]]; then
      RESET_EPOCH=$(date -d "$PF_FIVE_RESET" +%s 2>/dev/null || true)
      if [[ -n "$RESET_EPOCH" ]]; then
        COMPUTED=$((RESET_EPOCH - $(date +%s) + 60))
        [[ $COMPUTED -gt 0 ]] && SLEEP_SECS=$COMPUTED
      fi
    fi
    log "⏸ Claude 5-hour usage window is active (${PF_FIVE_PCT}%)"
    log "  The loop will begin at $(format_reset_time "$PF_FIVE_RESET")"
    log "  Sleeping ${SLEEP_SECS}s. Run ralph-stop.sh to cancel."
    write_state_limit "sleeping_limit" "$PF_FIVE_RESET" \
      "5-hour usage limit active at startup. Loop will begin at ${PF_FIVE_RESET:-unknown}"
    sleep_with_cancel "$SLEEP_SECS"
    log "  Woke up — starting loop"
  fi
else
  log "  Usage API unreachable — proceeding (reactive detection active)"
fi
```

**Key design decisions:**
- If API is unreachable at startup: proceed normally — don't block the loop on a network call
- After sleeping: fall through to `write_state "starting"` and the while loop (clean first iteration)
- `format_reset_time` used here (defined in Task 2)
- Uses existing `write_state_limit`, `sleep_with_cancel`, `get_oauth_token`, `check_usage_api` helpers

---

## Task 2: Human-Readable Time Formatting in ralph.sh

**File:** `artifacts/variants/backlog-json/ralph.sh`

Add a `format_reset_time` helper function alongside the other usage limit helpers (after `check_usage_api`):

```bash
# Format an ISO timestamp as "8:00 PM (in 4h 32m)" or "Feb 27 at 5:00 AM (in 3d)"
format_reset_time() {
  local iso="$1"
  [[ -z "$iso" ]] && echo "unknown" && return

  local epoch
  epoch=$(date -d "$iso" +%s 2>/dev/null || true)
  [[ -z "$epoch" ]] && echo "$iso" && return

  local diff=$(( epoch - $(date +%s) ))
  local time_str
  time_str=$(date -d "$iso" '+%I:%M %p' 2>/dev/null || echo "$iso")

  if [[ $diff -le 0 ]]; then
    echo "$time_str (now)"
  elif [[ $diff -lt 3600 ]]; then
    echo "$time_str (in $(( diff / 60 ))m)"
  elif [[ $diff -lt 86400 ]]; then
    local hrs=$(( diff / 3600 ))
    local mins=$(( (diff % 3600) / 60 ))
    echo "$time_str (in ${hrs}h ${mins}m)"
  else
    local days=$(( diff / 86400 ))
    local date_str
    date_str=$(date -d "$iso" '+%b %-d at %I:%M %p' 2>/dev/null || echo "$iso")
    echo "$date_str (in ${days}d)"
  fi
}
```

Also update the **reactive detection block** log messages (already in ralph.sh) to use `format_reset_time`:

```bash
# In the 5-hour sleep branch — replace:
log "⏸ 5-hour usage limit hit (${FIVE_PCT}%) — sleeping ${SLEEP_SECS}s until reset"
# With:
log "⏸ Claude 5-hour usage limit hit (${FIVE_PCT}%)"
log "  The loop will resume at $(format_reset_time "$FIVE_RESET")"
log "  Sleeping ${SLEEP_SECS}s. Run ralph-stop.sh to cancel."

# In the weekly branch — replace:
log "⛔ Weekly usage limit exhausted (${SEVEN_PCT}%) — stopping loop"
log "   Resets at: $SEVEN_RESET"
# With:
log "⛔ Weekly Claude usage limit exhausted (${SEVEN_PCT}%)"
log "  The loop cannot resume until $(format_reset_time "$SEVEN_RESET")"
log "  Restart ralph.sh after that time."
```

---

## Task 3: Improved CLI Status Display

**Files:**
- `packages/cli/src/status-commands.ts`
- `packages/cli/src/status-commands.test.ts`

Replace the current SLEEPING_LIMIT / WEEKLY_LIMIT blocks in `printStatusSummary` with more descriptive output that includes a live countdown:

```typescript
// Helper — add near formatElapsed
function formatCountdown(isoTimestamp: string): string {
  const resetMs = new Date(isoTimestamp).getTime();
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return "any moment now";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hrs < 24) return `in ${hrs}h ${mins}m`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d ${hrs % 24}h`;
}

// In printStatusSummary — replace SLEEPING_LIMIT block:
if (status.loopState === "SLEEPING_LIMIT") {
  if (status.sleepUntil) {
    const resetDate = new Date(status.sleepUntil);
    const timeStr = resetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const countdown = formatCountdown(status.sleepUntil);
    print(`${c.bold("Usage Limit:")} Claude's 5-hour window is active.`);
    print(`             The loop will resume at ${c.cyan(timeStr)} (${countdown}).`);
    print(`             Run ${c.dim("ralph-stop.sh")} to cancel the wait.`);
  } else {
    print(`${c.bold("Usage Limit:")} Claude's 5-hour window is active. Waiting for reset.`);
  }
}

// Replace WEEKLY_LIMIT block:
if (status.loopState === "WEEKLY_LIMIT") {
  if (status.sleepUntil) {
    const resetDate = new Date(status.sleepUntil);
    const dateStr = resetDate.toLocaleDateString([], {
      weekday: "long", month: "long", day: "numeric",
    });
    const timeStr = resetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    print(`${c.bold("Usage Limit:")} Weekly Claude cap reached.`);
    print(`             Restart ralph.sh after ${c.cyan(`${dateStr} at ${timeStr}`)}.`);
  } else {
    print(`${c.bold("Usage Limit:")} Weekly Claude cap reached. Check https://claude.ai for reset time.`);
  }
}
```

**Update tests** in `status-commands.test.ts` — the 4 new limit display tests need to match the new text patterns:
- `SLEEPING_LIMIT` text test: match `/will resume at/i` instead of `/resets/i`
- `WEEKLY_LIMIT` text test: match `/restart ralph\.sh/i` and `/2026-02-27/`

---

## Critical Files

- `artifacts/variants/backlog-json/ralph.sh` — Tasks 1 & 2
  - After `check_usage_api()` definition: add `format_reset_time()`
  - After auto-sweep block, before loop banner: add preflight check
  - In reactive detection block: update log messages
- `packages/cli/src/status-commands.ts` — Task 3
  - After `formatElapsed`: add `formatCountdown()`
  - In `printStatusSummary`: replace SLEEPING_LIMIT and WEEKLY_LIMIT blocks
- `packages/cli/src/status-commands.test.ts` — Task 3
  - Update regex patterns in the 4 limit-state text tests

---

## Verification

```bash
# 1. TypeScript tests (after pnpm build for cross-package)
pnpm --filter @ralph/core build && pnpm --filter @ralph/core test && pnpm --filter @ralph/cli test
pnpm typecheck

# 2. Bash: test preflight check with mock claude and mock API
mkdir -p /tmp/mock-bin
cat > /tmp/mock-bin/claude <<'EOF'
#!/usr/bin/env bash
echo "Claude AI Usage Limit Reached" >&2; exit 1
EOF
chmod +x /tmp/mock-bin/claude
PATH="/tmp/mock-bin:$PATH" ./ralph.sh 2 3
# Expected: logs "Claude 5-hour usage window is active", shows human time, sleeps

# 3. CLI display spot-check
cat > .ralph/state.json <<EOF
{"status":"sleeping_limit","iteration":5,"maxIterations":50,"currentItem":null,
 "lastSignal":"error","startedAt":"$(date -Iseconds)","updatedAt":"$(date -Iseconds)",
 "sleepUntil":"$(date -d '+2 hours' -Iseconds)","completedItems":[],"blockedItems":[],
 "error":"5-hour usage limit hit"}
EOF
pnpm --filter @ralph/cli exec bun run src/index.ts status .
# Expected: "The loop will resume at 3:24 AM (in 2h 0m)"
rm .ralph/state.json
```
