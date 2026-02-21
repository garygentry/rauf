#!/usr/bin/env bash
# =============================================================================
# ralph.sh — Autonomous Claude Code loop using Beads (bd) for task tracking
# Usage: ./ralph.sh [max_iterations]
# Example: ./ralph.sh 20
#
# Prerequisites:
#   - bd (beads) installed and initialized: bd init --quiet
#   - claude CLI installed and authenticated
#   - jq installed: sudo apt install jq
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RALPH_DIR=".ralph"
RALPH_MD="$RALPH_DIR/RALPH.md"
PROGRESS="$RALPH_DIR/progress.txt"
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
  if command -v notify-send &>/dev/null; then
    notify-send "Ralph Loop Complete" "$summary" --urgency=normal 2>/dev/null || true
  fi
  echo "$summary" > "$RALPH_DIR/DONE"
  log "NOTIFICATION: $summary"
  printf '\a'
}

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: '$1' not found. $2"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
require_cmd "bd"     "Install beads: curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash"
require_cmd "claude" "Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash"
require_cmd "jq"     "Install jq: sudo apt install jq"

if [[ ! -f "$RALPH_MD" ]]; then
  echo "ERROR: $RALPH_MD not found. Run from project root with .ralph/ set up."
  exit 1
fi

if [[ ! -d ".beads" ]]; then
  echo "ERROR: .beads/ not found. Run: bd init --quiet"
  exit 1
fi

# ---------------------------------------------------------------------------
# Count helpers using bd CLI
# ---------------------------------------------------------------------------
count_open() {
  # bd list --status open --json emits a JSON array; count elements
  bd list --status open --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0"
}

count_in_progress() {
  bd list --status in_progress --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0"
}

count_ready() {
  bd ready --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0"
}

# ---------------------------------------------------------------------------
# Print status using bd
# ---------------------------------------------------------------------------
print_status() {
  log "Beads status:"
  bd list --status open --json 2>/dev/null \
    | jq -r '.[] | "  [\(.priority)] \(.id): [\(.issue_type)] \(.title) [\(.status)]"' 2>/dev/null \
    | while read -r line; do log "$line"; done || true
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
log "============================================"
log "Ralph-Beads Loop starting | max=$MAX_ITERATIONS iterations"
print_status

while [ $ITER -lt $MAX_ITERATIONS ]; do
  ITER=$((ITER + 1))
  log ""
  log "--- Iteration $ITER / $MAX_ITERATIONS ---"

  # Pull latest state before each iteration
  git pull --rebase --quiet 2>/dev/null || true

  # Check work availability via bd ready (topologically sorted, unblocked only)
  READY=$(count_ready)
  IN_PROG=$(count_in_progress)

  if [ "$READY" = "0" ] && [ "$IN_PROG" = "0" ]; then
    # Double-check: are there open issues at all (may all be blocked)?
    OPEN=$(count_open)
    ELAPSED=$(( $(date +%s) - START_TIME ))
    ELAPSED_MIN=$(( ELAPSED / 60 ))

    if [ "$OPEN" = "0" ]; then
      SUMMARY="All work complete. Iterations used: $ITER | Time: ${ELAPSED_MIN}m"
    else
      SUMMARY="No ready work — $OPEN open issues are all blocked or deferred. Iterations used: $ITER | Time: ${ELAPSED_MIN}m"
    fi

    log "============================================"
    log "COMPLETE: $SUMMARY"
    bd list --json 2>/dev/null | jq -r '.[] | "\(.id): \(.status) - \(.title)"' 2>/dev/null \
      | while read -r line; do log "  $line"; done || true
    notify_done "$SUMMARY"
    exit 0
  fi

  log "Work available — ready:$READY  in_progress:$IN_PROG"

  # Build the prompt: inject RALPH.md + live bd state + progress log
  # bd prime generates the canonical context digest (~1-2k tokens)
  BD_CONTEXT=$(bd prime 2>/dev/null || echo "(bd prime unavailable — run 'bd ready --json' manually)")
  PROGRESS_SNAPSHOT=$(cat "$PROGRESS" 2>/dev/null || echo "(no progress log yet)")

  PROMPT="$(cat "$RALPH_MD")

---
## Live Beads Context (from bd prime)
\`\`\`
$BD_CONTEXT
\`\`\`

## Progress Log (accumulated learnings)
\`\`\`
$PROGRESS_SNAPSHOT
\`\`\`
"

  # Run Claude — fresh session, headless, full permissions
  OUTPUT=$(echo "$PROMPT" | claude -p \
    --dangerously-skip-permissions \
    --output-format text \
    2>&1)

  # Log condensed output
  echo "$OUTPUT" | head -60 >> "$LOG"

  # -------------------------------------------------------------------------
  # Parse exit signal
  # -------------------------------------------------------------------------
  if echo "$OUTPUT" | grep -q "RALPH_DONE"; then
    log "✓ Clean completion signal received"

  elif echo "$OUTPUT" | grep -q "RALPH_BLOCKED"; then
    BLOCKED_ID=$(echo "$OUTPUT" | grep -oP 'RALPH_BLOCKED:\K[^\s]+' || echo "unknown")
    log "⚠ Task blocked: $BLOCKED_ID — beads already updated, continuing"

  elif echo "$OUTPUT" | grep -q "RALPH_NEEDS_HUMAN"; then
    MSG=$(echo "$OUTPUT" | grep -oP 'RALPH_NEEDS_HUMAN:\K.*' | head -1 || echo "Human input required")
    log "⛔ Loop paused — human input needed: $MSG"
    notify_done "PAUSED — Human needed: $MSG"
    exit 2

  elif echo "$OUTPUT" | grep -q "RALPH_DECOMPOSED"; then
    log "↪ Task decomposed into subtasks — next iteration picks them up"

  else
    log "⚠ No exit signal detected — Claude may have stopped unexpectedly"
    log "  Continuing; review $LOG for details"
  fi

  # Brief pause between iterations
  sleep 3

done

# ---------------------------------------------------------------------------
# Max iterations reached
# ---------------------------------------------------------------------------
OPEN=$(count_open)
ELAPSED=$(( $(date +%s) - START_TIME ))
ELAPSED_MIN=$(( ELAPSED / 60 ))
SUMMARY="Max iterations ($MAX_ITERATIONS) reached. Open issues: $OPEN | Time: ${ELAPSED_MIN}m | Check bd list."
log "============================================"
log "LIMIT REACHED: $SUMMARY"
notify_done "Ralph hit iteration limit — $SUMMARY"
exit 1
