#!/usr/bin/env bash
# =============================================================================
# ralph.sh — Autonomous Claude Code loop for an in-progress project
# Usage: ./ralph.sh [max_iterations]
# Example: ./ralph.sh 20
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RALPH_DIR=".ralph"
BACKLOG="$RALPH_DIR/backlog.json"
PROGRESS="$RALPH_DIR/progress.txt"
RALPH_MD="$RALPH_DIR/RALPH.md"
LOG="$RALPH_DIR/ralph.log"
MAX_ITERATIONS=${1:-20}
ITER=0
START_TIME=$(date +%s)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG"
}

notify_done() {
  local summary="$1"
  # Linux: try notify-send (desktop), fall back to terminal bell + echo
  if command -v notify-send &>/dev/null; then
    notify-send "Ralph Loop Complete" "$summary" --urgency=normal 2>/dev/null || true
  fi
  # Also write a done marker file so you can poll externally if needed
  echo "$summary" > "$RALPH_DIR/DONE"
  log "NOTIFICATION: $summary"
  # Terminal bell
  printf '\a'
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "ERROR: Required file not found: $1"
    echo "Run from your project root and ensure .ralph/ is set up."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
require_file "$BACKLOG"
require_file "$RALPH_MD"

if ! command -v claude &>/dev/null; then
  echo "ERROR: 'claude' CLI not found. Install Claude Code first."
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: sudo apt install jq"
  exit 1
fi

# ---------------------------------------------------------------------------
# Count helpers (read directly from backlog.json)
# ---------------------------------------------------------------------------
count_pending() {
  jq '[.items[] | select(.status == "pending")] | length' "$BACKLOG"
}

count_in_progress() {
  jq '[.items[] | select(.status == "in_progress")] | length' "$BACKLOG"
}

count_blocked() {
  jq '[.items[] | select(.status == "blocked")] | length' "$BACKLOG"
}

count_done() {
  jq '[.items[] | select(.status == "done")] | length' "$BACKLOG"
}

count_total() {
  jq '.items | length' "$BACKLOG"
}

# ---------------------------------------------------------------------------
# Print status table
# ---------------------------------------------------------------------------
print_status() {
  local pending in_prog blocked done total
  pending=$(count_pending)
  in_prog=$(count_in_progress)
  blocked=$(count_blocked)
  done=$(count_done)
  total=$(count_total)
  log "Status → pending:$pending  in_progress:$in_prog  blocked:$blocked  done:$done  total:$total"
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
log "============================================"
log "Ralph Loop starting | max=$MAX_ITERATIONS iterations"
print_status

while [ $ITER -lt $MAX_ITERATIONS ]; do
  ITER=$((ITER + 1))
  log ""
  log "--- Iteration $ITER / $MAX_ITERATIONS ---"

  # Pull latest before each iteration (safe even with no remote)
  git pull --rebase --quiet 2>/dev/null || true

  # Check work availability
  PENDING=$(count_pending)
  IN_PROG=$(count_in_progress)

  if [ "$PENDING" = "0" ] && [ "$IN_PROG" = "0" ]; then
    DONE=$(count_done)
    BLOCKED=$(count_blocked)
    TOTAL=$(count_total)
    ELAPSED=$(( $(date +%s) - START_TIME ))
    ELAPSED_MIN=$(( ELAPSED / 60 ))

    SUMMARY="All work complete. Done: $DONE / $TOTAL | Blocked: $BLOCKED | Iterations used: $ITER | Time: ${ELAPSED_MIN}m"
    log "============================================"
    log "COMPLETE: $SUMMARY"
    print_status
    notify_done "$SUMMARY"
    exit 0
  fi

  log "Work available — pending:$PENDING  in_progress:$IN_PROG"

  # Build the prompt: RALPH.md content + current backlog state injected inline
  BACKLOG_SNAPSHOT=$(cat "$BACKLOG")
  PROGRESS_SNAPSHOT=$(cat "$PROGRESS" 2>/dev/null || echo "(no progress log yet)")

  PROMPT="$(cat "$RALPH_MD")

---
## Current Backlog State (live)
\`\`\`json
$BACKLOG_SNAPSHOT
\`\`\`

## Progress Log (accumulated learnings)
\`\`\`
$PROGRESS_SNAPSHOT
\`\`\`
"

  # Run Claude — headless, fresh session, full permissions
  OUTPUT=$(echo "$PROMPT" | claude -p \
    --dangerously-skip-permissions \
    --output-format text \
    2>&1)

  # Log a condensed version (first 80 chars of each line)
  echo "$OUTPUT" | head -60 >> "$LOG"

  # -------------------------------------------------------------------------
  # Parse exit signal from Claude's output
  # -------------------------------------------------------------------------
  if echo "$OUTPUT" | grep -q "RALPH_DONE"; then
    log "✓ Clean completion signal received"

  elif echo "$OUTPUT" | grep -q "RALPH_BLOCKED"; then
    BLOCKED_ID=$(echo "$OUTPUT" | grep -oP 'RALPH_BLOCKED:\K[^\s]+' || echo "unknown")
    log "⚠ Task blocked: $BLOCKED_ID — continuing to next item"

  elif echo "$OUTPUT" | grep -q "RALPH_NEEDS_HUMAN"; then
    MSG=$(echo "$OUTPUT" | grep -oP 'RALPH_NEEDS_HUMAN:\K.*' | head -1 || echo "Human input required")
    log "⛔ Loop paused — human input needed: $MSG"
    notify_done "PAUSED — Human needed: $MSG"
    exit 2

  else
    log "⚠ No exit signal found — Claude may have stopped unexpectedly"
    log "  Continuing anyway; check $LOG for details"
  fi

  # Brief pause between iterations
  sleep 3

done

# ---------------------------------------------------------------------------
# Max iterations reached without completing
# ---------------------------------------------------------------------------
DONE=$(count_done)
BLOCKED=$(count_blocked)
TOTAL=$(count_total)
SUMMARY="Max iterations ($MAX_ITERATIONS) reached. Done: $DONE / $TOTAL | Blocked: $BLOCKED | Check backlog."
log "============================================"
log "LIMIT REACHED: $SUMMARY"
print_status
notify_done "Ralph hit iteration limit — $SUMMARY"
exit 1
