#!/bin/bash
set -uo pipefail
SANDBOX_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/.." && pwd)"

# Usage: run.sh [scenario] [--agent <id>] [--backlog <dir>]
#   scenario   first positional (default stream-done)
#   --agent    which mock agent to drive (claude|codex|gemini|copilot|cursor|
#              generic-cli|...); omitted or "claude" = exactly today's path.
SCENARIO=""
AGENT="claude"
BACKLOG_FLAG=""
BACKLOG_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)
      AGENT="$2"
      shift 2
      ;;
    --backlog)
      BACKLOG_DIR="$2"
      BACKLOG_FLAG="--backlog $2"
      shift 2
      ;;
    *)
      if [ -z "$SCENARIO" ]; then
        SCENARIO="$1"
      fi
      shift
      ;;
  esac
done
SCENARIO="${SCENARIO:-stream-done}"

# Validate scenario exists
if [ ! -f "$SANDBOX_DIR/scenarios/${SCENARIO}.sh" ]; then
  echo "ERROR: Unknown scenario '${SCENARIO}'"
  echo "Available: $(ls "$SANDBOX_DIR/scenarios/" | grep -v '^_' | sed 's/.sh$//' | tr '\n' ' ')"
  exit 1
fi

# run_agent_scenario <agent> <scenario>
#
# Cross-agent sibling of verify.sh's run_scenario. Resets the sandbox, exports the
# scenario env, puts the chosen mock binary first on PATH, and runs ONE loop
# iteration through `rauf loop run ... --agent <id>`. For <agent>=claude (or
# empty/claude-cli) no --agent flag is passed, so the behavior is exactly today's
# claude path. All mock binaries (claude, codex, gemini, copilot, cursor-agent,
# mock-generic-agent.sh) live in $SANDBOX_DIR, so putting it first on PATH selects
# whichever the chosen agent invokes.
run_agent_scenario() {
  local agent="$1"
  local scenario="$2"

  # Reset sandbox to clean state
  bash "$SANDBOX_DIR/setup.sh"

  export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
  # Canonical scenario env; the claude dispatcher also honors MOCK_CLAUDE_SCENARIO.
  export MOCK_AGENT_SCENARIO="$scenario"
  export MOCK_CLAUDE_SCENARIO="$scenario"

  # Point the loop's git operations (dirty-tree guard + auto-commit) at the
  # sandbox's own throwaway repo (created by setup.sh), never the parent rauf
  # repo. This lets the loop run on a clean `sandbox` branch without --force
  # and keeps sandbox commits out of the parent's history.
  export GIT_DIR="$SANDBOX_DIR/.sandbox-git"
  export GIT_WORK_TREE="$SANDBOX_DIR"

  local agent_flag=""
  if [ -n "$agent" ] && [ "$agent" != "claude" ] && [ "$agent" != "claude-cli" ]; then
    agent_flag="--agent $agent"
  fi

  echo "=== Running scenario: $scenario (agent: $agent) ==="
  # shellcheck disable=SC2086
  rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 $agent_flag $BACKLOG_FLAG
}

if run_agent_scenario "$AGENT" "$SCENARIO"; then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

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
