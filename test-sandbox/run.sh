#!/bin/bash
set -euo pipefail
SANDBOX_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/.." && pwd)"
SCENARIO="${1:-stream-done}"
shift || true

# Parse optional --backlog flag from remaining args
BACKLOG_FLAG=""
BACKLOG_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backlog)
      BACKLOG_DIR="$2"
      BACKLOG_FLAG="--backlog $2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Validate scenario exists
if [ ! -f "$SANDBOX_DIR/scenarios/${SCENARIO}.sh" ]; then
  echo "ERROR: Unknown scenario '${SCENARIO}'"
  echo "Available: $(ls "$SANDBOX_DIR/scenarios/" | sed 's/.sh$//' | tr '\n' ' ')"
  exit 1
fi

# Reset sandbox to clean state
bash "$SANDBOX_DIR/setup.sh"

# Put mock claude first on PATH, then the rauf dev wrapper
export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="$SCENARIO"

echo "=== Running scenario: $SCENARIO ==="
# shellcheck disable=SC2086
rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 $BACKLOG_FLAG
EXIT_CODE=$?

echo ""
echo "=== Post-run state ==="

# Determine state directory based on --backlog flag
if [ -n "$BACKLOG_DIR" ]; then
  STATE_DIR="$SANDBOX_DIR/$BACKLOG_DIR/.rauf"
  BACKLOG_FILE="$SANDBOX_DIR/$BACKLOG_DIR/backlog.json"
else
  STATE_DIR="$SANDBOX_DIR/.rauf"
  BACKLOG_FILE="$SANDBOX_DIR/.rauf/backlog.json"
fi

# Show backlog item statuses
if [ -f "$BACKLOG_FILE" ]; then
  echo "Backlog items:"
  if command -v jq &>/dev/null; then
    jq -r '.items[] | "  \(.id): \(.status)\(if .blockedReason then " (\(.blockedReason))" else "" end)"' "$BACKLOG_FILE"
  else
    cat "$BACKLOG_FILE"
  fi
fi

# Show state.json status
if [ -f "$STATE_DIR/state.json" ]; then
  echo "Loop state:"
  if command -v jq &>/dev/null; then
    jq -r '  "  status: \(.status), lastSignal: \(.lastSignal)"' "$STATE_DIR/state.json"
  else
    cat "$STATE_DIR/state.json"
  fi
fi

# Show DONE file
if [ -f "$STATE_DIR/DONE" ]; then
  echo "DONE file: $(cat "$STATE_DIR/DONE")"
fi

# Warn if iteration-status.json still exists (should be cleaned up)
if [ -f "$STATE_DIR/iteration-status.json" ]; then
  echo "WARNING: iteration-status.json still exists (should have been cleaned up)"
fi

exit $EXIT_CODE
