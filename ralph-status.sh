#!/usr/bin/env bash
# =============================================================================
# ralph-status.sh — Print a quick summary of backlog and loop state
# Usage: ./ralph-status.sh
# =============================================================================

RALPH_DIR=".ralph"
BACKLOG="$RALPH_DIR/backlog.json"
STATE="$RALPH_DIR/state.json"
LOG="$RALPH_DIR/ralph.log"

if [[ ! -f "$BACKLOG" ]]; then
  echo "ERROR: .ralph/backlog.json not found. Run from project root."
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found. Install with: sudo apt install jq"
  exit 1
fi

echo ""
echo "=== Ralph Backlog Status ==="
echo ""

# ---------------------------------------------------------------------------
# Backlog counts
# ---------------------------------------------------------------------------
PENDING=$(jq  '[.items[] | select(.status == "pending")]     | length' "$BACKLOG")
IN_PROG=$(jq  '[.items[] | select(.status == "in_progress")] | length' "$BACKLOG")
BLOCKED=$(jq  '[.items[] | select(.status == "blocked")]     | length' "$BACKLOG")
DONE=$(jq     '[.items[] | select(.status == "done")]        | length' "$BACKLOG")
TOTAL=$(jq    '.items | length' "$BACKLOG")

echo "  Pending:     $PENDING"
echo "  In Progress: $IN_PROG"
echo "  Blocked:     $BLOCKED"
echo "  Done:        $DONE / $TOTAL"
echo ""

# ---------------------------------------------------------------------------
# Loop state (prefer state.json, fall back to log heuristics)
# ---------------------------------------------------------------------------
if [[ -f "$STATE" ]] && jq -e '.status' "$STATE" &>/dev/null; then
  LOOP_STATUS=$(jq -r '.status' "$STATE")
  LOOP_ITER=$(jq -r '.iteration // 0' "$STATE")
  LOOP_MAX=$(jq -r '.maxIterations // "?"' "$STATE")
  LOOP_ITEM=$(jq -r '.currentItem // "none"' "$STATE")
  LOOP_SIGNAL=$(jq -r '.lastSignal // "?"' "$STATE")
  LOOP_UPDATED=$(jq -r '.updatedAt // "?"' "$STATE")
  LOOP_ERROR=$(jq -r '.error // empty' "$STATE")

  echo "--- Loop State (via state.json) ---"
  echo "  Status:      $LOOP_STATUS"
  echo "  Iteration:   $LOOP_ITER / $LOOP_MAX"
  if [[ "$LOOP_ITEM" != "none" && "$LOOP_ITEM" != "null" ]]; then
    ITEM_TITLE=$(jq -r --arg id "$LOOP_ITEM" '.items[] | select(.id == $id) | .title // "?"' "$BACKLOG" 2>/dev/null)
    echo "  Current:     $LOOP_ITEM — $ITEM_TITLE"
  fi
  echo "  Last signal: $LOOP_SIGNAL"
  echo "  Updated:     $LOOP_UPDATED"
  if [[ -n "$LOOP_ERROR" ]]; then
    echo "  Error:       $LOOP_ERROR"
  fi

  # Staleness check
  if [[ "$LOOP_STATUS" == "running" ]]; then
    UPDATED_EPOCH=$(date -d "$LOOP_UPDATED" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    AGE=$(( NOW_EPOCH - UPDATED_EPOCH ))
    if [[ $AGE -gt 300 ]]; then
      echo "  ⚠ State is $(( AGE / 60 ))m old — loop may have stopped"
    fi
  fi
  echo ""

elif [[ -f "$LOG" ]]; then
  echo "--- Loop State (via log heuristics) ---"
  LOG_MTIME=$(stat -c %Y "$LOG" 2>/dev/null || stat -f %m "$LOG" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$(( NOW - LOG_MTIME ))

  if [[ -f "$RALPH_DIR/DONE" ]]; then
    DONE_CONTENT=$(cat "$RALPH_DIR/DONE")
    if [[ "$DONE_CONTENT" == PAUSED* ]]; then
      echo "  Status: PAUSED (human input needed)"
    elif [[ "$DONE_CONTENT" == *"iteration limit"* ]]; then
      echo "  Status: LIMIT REACHED"
    else
      echo "  Status: COMPLETE"
    fi
    echo "  Detail: $DONE_CONTENT"
  elif [[ $AGE -lt 60 ]]; then
    echo "  Status: RUNNING (log updated ${AGE}s ago)"
  elif [[ $AGE -lt 300 ]]; then
    echo "  Status: PAUSED (log updated $(( AGE / 60 ))m ago)"
  else
    echo "  Status: IDLE (log is $(( AGE / 60 ))m old)"
  fi
  echo ""
else
  echo "--- Loop State ---"
  echo "  No loop data found (no state.json or ralph.log)"
  echo ""
fi

# ---------------------------------------------------------------------------
# Pending items
# ---------------------------------------------------------------------------
if [[ "$PENDING" -gt 0 ]]; then
  echo "--- Pending ---"
  jq -r '.items[] | select(.status == "pending") | "  [\(.priority)] \(.id): [\(.type)] \(.title)"' "$BACKLOG" \
    | sort
  echo ""
fi

# ---------------------------------------------------------------------------
# In-progress items
# ---------------------------------------------------------------------------
if [[ "$IN_PROG" -gt 0 ]]; then
  echo "--- In Progress ---"
  jq -r '.items[] | select(.status == "in_progress") | "  \(.id): \(.title)"' "$BACKLOG"
  echo ""
fi

# ---------------------------------------------------------------------------
# Blocked items
# ---------------------------------------------------------------------------
if [[ "$BLOCKED" -gt 0 ]]; then
  echo "--- Blocked ---"
  jq -r '.items[] | select(.status == "blocked") | "  \(.id): \(.title)\n    Reason: \(.blockedReason // "not specified")"' "$BACKLOG"
  echo ""
fi

# ---------------------------------------------------------------------------
# Recently done (last 5)
# ---------------------------------------------------------------------------
if [[ "$DONE" -gt 0 ]]; then
  echo "--- Recently Done ---"
  jq -r '.items[] | select(.status == "done") | "  ✓ \(.id): \(.title)  [\(.completedAt // "?")]"' "$BACKLOG" | tail -5
  echo ""
fi

# ---------------------------------------------------------------------------
# Log tail
# ---------------------------------------------------------------------------
if [[ -f "$LOG" ]]; then
  echo "--- Last 5 Log Entries ---"
  tail -5 "$LOG"
  echo ""
fi
