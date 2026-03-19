#!/bin/bash
set -euo pipefail
SANDBOX_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/.." && pwd)"
SCENARIO="${1:-stream-done}"

# Validate scenario exists
if [ ! -f "$SANDBOX_DIR/scenarios/${SCENARIO}.sh" ]; then
  echo "ERROR: Unknown scenario '${SCENARIO}'"
  echo "Available: $(ls "$SANDBOX_DIR/scenarios/" | sed 's/.sh$//' | tr '\n' ' ')"
  exit 1
fi

# Reset sandbox to clean state
bash "$SANDBOX_DIR/setup.sh"

# Put mock claude first on PATH, then the ralph dev wrapper
export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="$SCENARIO"

echo "=== Running scenario: $SCENARIO ==="
ralph loop run "$SANDBOX_DIR" --iterations 1 --timeout 1
EXIT_CODE=$?

echo ""
echo "=== Post-run state ==="

# Show backlog item statuses
if [ -f "$SANDBOX_DIR/.ralph/backlog.json" ]; then
  echo "Backlog items:"
  if command -v jq &>/dev/null; then
    jq -r '.items[] | "  \(.id): \(.status)\(if .blockedReason then " (\(.blockedReason))" else "" end)"' "$SANDBOX_DIR/.ralph/backlog.json"
  else
    cat "$SANDBOX_DIR/.ralph/backlog.json"
  fi
fi

# Show state.json status
if [ -f "$SANDBOX_DIR/.ralph/state.json" ]; then
  echo "Loop state:"
  if command -v jq &>/dev/null; then
    jq -r '  "  status: \(.status), lastSignal: \(.lastSignal)"' "$SANDBOX_DIR/.ralph/state.json"
  else
    cat "$SANDBOX_DIR/.ralph/state.json"
  fi
fi

# Show DONE file
if [ -f "$SANDBOX_DIR/.ralph/DONE" ]; then
  echo "DONE file: $(cat "$SANDBOX_DIR/.ralph/DONE")"
fi

# Warn if iteration-status.json still exists (should be cleaned up)
if [ -f "$SANDBOX_DIR/.ralph/iteration-status.json" ]; then
  echo "WARNING: iteration-status.json still exists (should have been cleaned up)"
fi

exit $EXIT_CODE
