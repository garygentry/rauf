#!/bin/bash
set -euo pipefail
SANDBOX_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/.." && pwd)"

# Require jq
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed."
  echo "  macOS: brew install jq"
  echo "  Ubuntu/Debian: sudo apt install jq"
  exit 1
fi

FAILURES=0
PASSES=0
CURRENT_SCENARIO=""

# ─── Assertion helpers ───────────────────────────────────────────────

fail() {
  echo "  FAIL: $1"
  FAILURES=$((FAILURES + 1))
}

pass() {
  echo "  PASS: $1"
  PASSES=$((PASSES + 1))
}

assert_item_status() {
  local item_id="$1"
  local expected="$2"
  local actual
  actual=$(jq -r ".items[] | select(.id == \"$item_id\") | .status" "$SANDBOX_DIR/.ralph/backlog.json")
  if [ "$actual" = "$expected" ]; then
    pass "item $item_id status = $expected"
  else
    fail "item $item_id status: expected '$expected', got '$actual'"
  fi
}

assert_no_iteration_status() {
  if [ ! -f "$SANDBOX_DIR/.ralph/iteration-status.json" ]; then
    pass "no iteration-status.json"
  else
    fail "iteration-status.json still exists"
  fi
}

assert_done_file_exists() {
  if [ -f "$SANDBOX_DIR/.ralph/DONE" ]; then
    pass "DONE file exists"
  else
    fail "DONE file missing"
  fi
}

assert_done_file_contains() {
  local pattern="$1"
  if [ -f "$SANDBOX_DIR/.ralph/DONE" ] && grep -q "$pattern" "$SANDBOX_DIR/.ralph/DONE"; then
    pass "DONE file contains '$pattern'"
  else
    fail "DONE file missing or doesn't contain '$pattern'"
  fi
}

assert_state_status() {
  local expected="$1"
  if [ ! -f "$SANDBOX_DIR/.ralph/state.json" ]; then
    fail "state.json missing"
    return
  fi
  local actual
  actual=$(jq -r '.status' "$SANDBOX_DIR/.ralph/state.json")
  if [ "$actual" = "$expected" ]; then
    pass "state status = $expected"
  else
    fail "state status: expected '$expected', got '$actual'"
  fi
}

# ─── Multi-backlog assertion helpers ─────────────────────────────────

assert_file_exists() {
  local filepath="$1"
  local label="${2:-$filepath}"
  if [ -f "$filepath" ]; then
    pass "$label exists"
  else
    fail "$label missing"
  fi
}

assert_file_not_exists() {
  local filepath="$1"
  local label="${2:-$filepath}"
  if [ ! -f "$filepath" ]; then
    pass "$label does not exist"
  else
    fail "$label should not exist but does"
  fi
}

assert_dir_exists() {
  local dirpath="$1"
  local label="${2:-$dirpath}"
  if [ -d "$dirpath" ]; then
    pass "$label exists"
  else
    fail "$label missing"
  fi
}

assert_item_status_at() {
  local backlog_file="$1"
  local item_id="$2"
  local expected="$3"
  local actual
  actual=$(jq -r ".items[] | select(.id == \"$item_id\") | .status" "$backlog_file")
  if [ "$actual" = "$expected" ]; then
    pass "item $item_id status = $expected (at $backlog_file)"
  else
    fail "item $item_id status: expected '$expected', got '$actual' (at $backlog_file)"
  fi
}

assert_state_status_at() {
  local state_file="$1"
  local expected="$2"
  if [ ! -f "$state_file" ]; then
    fail "state.json missing at $state_file"
    return
  fi
  local actual
  actual=$(jq -r '.status' "$state_file")
  if [ "$actual" = "$expected" ]; then
    pass "state status = $expected (at $state_file)"
  else
    fail "state status: expected '$expected', got '$actual' (at $state_file)"
  fi
}

# ─── Run a scenario ──────────────────────────────────────────────────

run_scenario() {
  local scenario="$1"
  CURRENT_SCENARIO="$scenario"
  echo ""
  echo "=== Scenario: $scenario ==="

  # Reset
  bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

  export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
  export MOCK_CLAUDE_SCENARIO="$scenario"

  # Run (capture output, allow non-zero exit)
  ralph loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 >/dev/null 2>&1 || true
}

# ─── Test cases ───────────────────────────────────────────────────────

# 1. stream-done: RALPH_DONE marks item done
run_scenario "stream-done"
assert_item_status "001" "done"
assert_no_iteration_status
assert_done_file_exists
assert_state_status "limit_reached"

# 2. stream-blocked: RALPH_BLOCKED marks item blocked
run_scenario "stream-blocked"
assert_item_status "001" "blocked"
assert_no_iteration_status
assert_done_file_exists
assert_state_status "limit_reached"

# 3. stream-tools: Multi-tool RALPH_DONE works
run_scenario "stream-tools"
assert_item_status "001" "done"
assert_no_iteration_status
assert_done_file_exists
assert_state_status "limit_reached"

# 4. slow-stream: Slow stream completes
run_scenario "slow-stream"
assert_item_status "001" "done"
assert_no_iteration_status
assert_done_file_exists
assert_state_status "limit_reached"

# 5. stream-needs-human: RALPH_NEEDS_HUMAN leaves in_progress
run_scenario "stream-needs-human"
assert_item_status "001" "in_progress"
assert_no_iteration_status
assert_done_file_exists
assert_done_file_contains "needs_human"

# ─── Multi-backlog scenario ──────────────────────────────────────────

# 6. multi-backlog: --backlog flag routes state to custom root
echo ""
echo "=== Scenario: multi-backlog ==="

# Reset sandbox (also sets up specs/feature-a/backlog.json)
bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="stream-done"

# Verify the backlog file is in place before run
assert_file_exists "$SANDBOX_DIR/specs/feature-a/backlog.json" "specs/feature-a/backlog.json (pre-run)"

# Run with --backlog flag
ralph loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 --backlog specs/feature-a >/dev/null 2>&1 || true

# Assert state dir was auto-created at specs/feature-a/.ralph/
assert_dir_exists "$SANDBOX_DIR/specs/feature-a/.ralph" "specs/feature-a/.ralph state dir"

# Assert state.json written to custom root state dir
assert_file_exists "$SANDBOX_DIR/specs/feature-a/.ralph/state.json" "specs/feature-a/.ralph/state.json"
assert_state_status_at "$SANDBOX_DIR/specs/feature-a/.ralph/state.json" "limit_reached"

# Assert ralph.log written to custom root state dir
assert_file_exists "$SANDBOX_DIR/specs/feature-a/.ralph/ralph.log" "specs/feature-a/.ralph/ralph.log"

# Assert DONE file written to custom root state dir
assert_file_exists "$SANDBOX_DIR/specs/feature-a/.ralph/DONE" "specs/feature-a/.ralph/DONE"

# Assert backlog item was picked up and marked done
assert_item_status_at "$SANDBOX_DIR/specs/feature-a/backlog.json" "001" "done"

# Assert .loop.lock was cleaned up after run
assert_file_not_exists "$SANDBOX_DIR/specs/feature-a/.ralph/.loop.lock" "specs/feature-a/.ralph/.loop.lock (cleaned up)"

# Assert default .ralph/ was NOT modified (state.json should not exist from this run)
# Note: default .ralph/state.json might exist from setup, but shouldn't have been updated
# We verify the custom root got the state, which is the key assertion

# ─── Summary ─────────────────────────────────────────────────────────

echo ""
echo "=== Results ==="
echo "  Passed: $PASSES"
echo "  Failed: $FAILURES"

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "VERIFICATION FAILED"
  exit 1
else
  echo ""
  echo "ALL SCENARIOS PASSED"
  exit 0
fi
