#!/usr/bin/env bash
# ralph-status.sh — Quick status using Beads (bd) CLI
# Usage: ./ralph-status.sh

if ! command -v bd &>/dev/null; then
  echo "ERROR: 'bd' not found. Install beads first."
  exit 1
fi

if [[ ! -d ".beads" ]]; then
  echo "ERROR: .beads/ not found. Run: bd init --quiet"
  exit 1
fi

echo ""
echo "=== Ralph-Beads Status ==="
echo ""

# Stats via bd
echo "--- Overview ---"
bd list --status open --json 2>/dev/null \
  | jq -r 'group_by(.status) | .[] | "\(.[0].status): \(length)"' 2>/dev/null \
  || echo "(unable to fetch beads status)"

READY=$(bd ready --json 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
echo "ready (unblocked): $READY"
echo ""

# Ready work
echo "--- Ready to Work On (bd ready) ---"
bd ready --json 2>/dev/null \
  | jq -r '.[] | "  [\(.priority)] \(.id): [\(.issue_type)] \(.title)"' 2>/dev/null \
  || echo "  (none)"
echo ""

# In progress
IN_PROG=$(bd list --status in_progress --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
if [ "$IN_PROG" != "0" ] && [ "$IN_PROG" != "null" ]; then
  echo "--- In Progress ---"
  bd list --status in_progress --json 2>/dev/null \
    | jq -r '.[] | "  \(.id): \(.title)"' 2>/dev/null
  echo ""
fi

# Blocked (open but has blocking deps)
echo "--- Blocked ---"
bd blocked 2>/dev/null || echo "  (none or bd blocked not available)"
echo ""

# Recently closed
echo "--- Recently Closed (last 5) ---"
bd list --status closed --json 2>/dev/null \
  | jq -r '.[-5:] | .[] | "  ✓ \(.id): \(.title)"' 2>/dev/null \
  || echo "  (none yet)"
echo ""

# Log tail
if [[ -f ".ralph/ralph.log" ]]; then
  echo "--- Last 5 Log Entries ---"
  tail -5 ".ralph/ralph.log"
  echo ""
fi

# DONE marker
if [[ -f ".ralph/DONE" ]]; then
  echo "--- Completion Notice ---"
  cat ".ralph/DONE"
  echo ""
fi
