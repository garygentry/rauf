#!/usr/bin/env bash
# ralph-status.sh — Print a quick summary of backlog state
# Usage: ./ralph-status.sh

BACKLOG=".ralph/backlog.json"

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

# Counts
PENDING=$(jq '[.items[] | select(.status == "pending")] | length' "$BACKLOG")
IN_PROG=$(jq '[.items[] | select(.status == "in_progress")] | length' "$BACKLOG")
BLOCKED=$(jq '[.items[] | select(.status == "blocked")] | length' "$BACKLOG")
DONE=$(jq '[.items[] | select(.status == "done")] | length' "$BACKLOG")
TOTAL=$(jq '.items | length' "$BACKLOG")

echo "  Pending:     $PENDING"
echo "  In Progress: $IN_PROG"
echo "  Blocked:     $BLOCKED"
echo "  Done:        $DONE / $TOTAL"
echo ""

# Show pending items
if [ "$PENDING" -gt 0 ]; then
  echo "--- Pending ---"
  jq -r '.items[] | select(.status == "pending") | "  [\(.priority)] \(.id): [\(.type)] \(.title)"' "$BACKLOG" \
    | sort
  echo ""
fi

# Show in-progress items
if [ "$IN_PROG" -gt 0 ]; then
  echo "--- In Progress ---"
  jq -r '.items[] | select(.status == "in_progress") | "  \(.id): \(.title)"' "$BACKLOG"
  echo ""
fi

# Show blocked items
if [ "$BLOCKED" -gt 0 ]; then
  echo "--- Blocked ---"
  jq -r '.items[] | select(.status == "blocked") | "  \(.id): \(.title)\n    Reason: \(.blockedReason // "not specified")"' "$BACKLOG"
  echo ""
fi

# Show recently done (last 3)
if [ "$DONE" -gt 0 ]; then
  echo "--- Recently Done ---"
  jq -r '.items[] | select(.status == "done") | "  ✓ \(.id): \(.title)  [\(.completedAt // "?")]"' "$BACKLOG" | tail -3
  echo ""
fi

# Show log tail if it exists
if [[ -f ".ralph/ralph.log" ]]; then
  echo "--- Last 5 Log Entries ---"
  tail -5 ".ralph/ralph.log"
  echo ""
fi
