#!/usr/bin/env bash
# =============================================================================
# ralph-stop.sh — Request graceful loop cancellation
# Usage: ./ralph-stop.sh
#
# Creates .ralph/CANCEL to signal the running loop to stop after the current
# Claude session completes. The loop checks for this file at each iteration
# boundary and exits cleanly with status=paused.
# =============================================================================

RALPH_DIR=".ralph"
CANCEL_FILE="$RALPH_DIR/CANCEL"

if [[ ! -d "$RALPH_DIR" ]]; then
  echo "ERROR: .ralph/ directory not found. Run from project root."
  exit 1
fi

touch "$CANCEL_FILE"
echo "Cancel requested. Loop will stop after current iteration."
