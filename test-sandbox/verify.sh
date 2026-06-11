#!/bin/bash
set -euo pipefail
SANDBOX_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/.." && pwd)"

# Point every loop run's git operations (dirty-tree guard + auto-commit) at
# the sandbox's own throwaway repo (created by setup.sh), never the parent
# rauf repo. The guard then sees a clean `sandbox` branch (no --force needed)
# and sandbox commits stay out of the parent's history.
export GIT_DIR="$SANDBOX_DIR/.sandbox-git"
export GIT_WORK_TREE="$SANDBOX_DIR"

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
  actual=$(jq -r ".items[] | select(.id == \"$item_id\") | .status" "$SANDBOX_DIR/.rauf/backlog.json")
  if [ "$actual" = "$expected" ]; then
    pass "item $item_id status = $expected"
  else
    fail "item $item_id status: expected '$expected', got '$actual'"
  fi
}

assert_no_iteration_status() {
  if [ ! -f "$SANDBOX_DIR/.rauf/iteration-status.json" ]; then
    pass "no iteration-status.json"
  else
    fail "iteration-status.json still exists"
  fi
}

assert_done_file_exists() {
  if [ -f "$SANDBOX_DIR/.rauf/DONE" ]; then
    pass "DONE file exists"
  else
    fail "DONE file missing"
  fi
}

assert_done_file_contains() {
  local pattern="$1"
  if [ -f "$SANDBOX_DIR/.rauf/DONE" ] && grep -q "$pattern" "$SANDBOX_DIR/.rauf/DONE"; then
    pass "DONE file contains '$pattern'"
  else
    fail "DONE file missing or doesn't contain '$pattern'"
  fi
}

assert_state_status() {
  local expected="$1"
  if [ ! -f "$SANDBOX_DIR/.rauf/state.json" ]; then
    fail "state.json missing"
    return
  fi
  local actual
  actual=$(jq -r '.status' "$SANDBOX_DIR/.rauf/state.json")
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
  rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 >/dev/null 2>&1 || true
}

# ─── Test cases ───────────────────────────────────────────────────────

# 1. stream-done: RAUF_DONE marks item done
run_scenario "stream-done"
assert_item_status "001" "done"
assert_no_iteration_status
assert_done_file_exists
assert_state_status "limit_reached"

# 2. stream-blocked: RAUF_BLOCKED marks item blocked
run_scenario "stream-blocked"
assert_item_status "001" "blocked"
assert_no_iteration_status
assert_done_file_exists
assert_state_status "limit_reached"

# 3. stream-tools: Multi-tool RAUF_DONE works
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

# 5. stream-needs-human: RAUF_NEEDS_HUMAN sets the item aside (blocked) and the
#    loop continues/ends naturally instead of halting in_progress.
run_scenario "stream-needs-human"
assert_item_status "001" "blocked"
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
rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 --backlog specs/feature-a >/dev/null 2>&1 || true

# Assert state dir was auto-created at specs/feature-a/.rauf/
assert_dir_exists "$SANDBOX_DIR/specs/feature-a/.rauf" "specs/feature-a/.rauf state dir"

# Assert state.json written to custom root state dir
assert_file_exists "$SANDBOX_DIR/specs/feature-a/.rauf/state.json" "specs/feature-a/.rauf/state.json"
assert_state_status_at "$SANDBOX_DIR/specs/feature-a/.rauf/state.json" "limit_reached"

# Assert rauf.log written to custom root state dir
assert_file_exists "$SANDBOX_DIR/specs/feature-a/.rauf/rauf.log" "specs/feature-a/.rauf/rauf.log"

# Assert DONE file written to custom root state dir
assert_file_exists "$SANDBOX_DIR/specs/feature-a/.rauf/DONE" "specs/feature-a/.rauf/DONE"

# Assert backlog item was picked up and marked done
assert_item_status_at "$SANDBOX_DIR/specs/feature-a/backlog.json" "001" "done"

# Assert .loop.lock was cleaned up after run
assert_file_not_exists "$SANDBOX_DIR/specs/feature-a/.rauf/.loop.lock" "specs/feature-a/.rauf/.loop.lock (cleaned up)"

# Assert default .rauf/ was NOT modified (state.json should not exist from this run)
# Note: default .rauf/state.json might exist from setup, but shouldn't have been updated
# We verify the custom root got the state, which is the key assertion

# ─── Usage-limit-in-stdout scenario ──────────────────────────────────

# 7. usage-limit-stdout: the session-limit banner arrives ONLY in the
#    reconstructed stdout stream (never in stderr), followed by a fast code=1
#    exit. The runner must detect the banner in signalText, reset the item to
#    pending, and pause/sleep — NOT fall through to signal 'none' and block.
#    This is the incident's failure mode (all 24 false blocks).
echo ""
echo "=== Scenario: usage-limit-stdout ==="

bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="usage-limit-stdout"

# The usage path sleeps (waiting for the limit to reset), so run in the
# background, wait until the loop has detected the limit and started sleeping,
# then stop it — we don't wait out the full sleep. The item is reset to
# pending BEFORE the sleep, so it stays pending regardless of how we stop.
rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 >/dev/null 2>&1 &
LOOP_PID=$!

reached_sleep=0
for _ in $(seq 1 20); do
  if [ -f "$SANDBOX_DIR/.rauf/state.json" ] &&
    [ "$(jq -r '.status' "$SANDBOX_DIR/.rauf/state.json")" = "sleeping_limit" ]; then
    reached_sleep=1
    break
  fi
  sleep 0.5
done

kill "$LOOP_PID" 2>/dev/null || true
wait "$LOOP_PID" 2>/dev/null || true

# Item must stay pending (the bug wrongly blocked it)
assert_item_status "001" "pending"

# The loop must have paused/slept rather than blocking the item
if [ "$reached_sleep" -eq 1 ]; then
  pass "loop paused (state = sleeping_limit)"
else
  fail "loop did not reach sleeping_limit (usage limit not detected in stream?)"
fi

# Detection must have come from scanning the stream/stdout, not a fallthrough
if grep -q "Usage limit detected" "$SANDBOX_DIR/.rauf/rauf.log"; then
  pass "log shows usage-limit detection"
else
  fail "log missing usage-limit detection"
fi

# ─── Circuit-breaker scenario ────────────────────────────────────────

# 8. fast-infra-death: every spawn dies fast with code=1 and no usage banner
#    (infra_error). uncountIteration keeps the budget from advancing, so without
#    a circuit breaker the loop would spin forever on the broken spawn. The
#    breaker (default 3 consecutive infra failures) must halt with an `error`
#    state + DONE summary BEFORE maxIterations, leaving the item pending (never
#    blocked on a flaky spawn).
echo ""
echo "=== Scenario: fast-infra-death ==="

bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="fast-infra-death"

# Generous iteration budget so the breaker (not maxIterations) is what halts.
# Run in the background and poll for the error halt so a regressed breaker
# (which would loop indefinitely) can't hang the suite.
rauf loop run "$SANDBOX_DIR" --iterations 25 --timeout 1 >/dev/null 2>&1 &
LOOP_PID=$!

breaker_halted=0
for _ in $(seq 1 40); do
  if [ -f "$SANDBOX_DIR/.rauf/state.json" ] &&
    [ "$(jq -r '.status' "$SANDBOX_DIR/.rauf/state.json")" = "error" ]; then
    breaker_halted=1
    break
  fi
  if ! kill -0 "$LOOP_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

kill "$LOOP_PID" 2>/dev/null || true
wait "$LOOP_PID" 2>/dev/null || true

if [ "$breaker_halted" -eq 1 ]; then
  pass "circuit breaker halted the loop (state = error)"
else
  fail "circuit breaker did not halt (state never reached error)"
fi

# Item must stay pending — a flaky spawn must never block a real work item.
assert_item_status "001" "pending"

# A DONE summary with the breaker message is written for the halt.
assert_done_file_exists
assert_done_file_contains "Circuit breaker"

# The breaker must trip BEFORE maxIterations (25), not at the budget ceiling.
iters=$(jq -r '.iteration' "$SANDBOX_DIR/.rauf/state.json")
if [ "$iters" -lt 25 ]; then
  pass "halted before maxIterations (iteration=$iters < 25)"
else
  fail "did not halt before maxIterations (iteration=$iters)"
fi

# The threshold is logged in the run header at startup.
if grep -q "Circuit breaker threshold:" "$SANDBOX_DIR/.rauf/rauf.log"; then
  pass "run header logs the circuit breaker threshold"
else
  fail "run header missing circuit breaker threshold log"
fi

# ─── Commit-reconciliation scenario ──────────────────────────────────

# 9. commit-no-signal: the agent commits a proper `[rauf] 001:` change (clean
#    tree) but dies before printing RAUF_DONE. Commit reconciliation (item 009)
#    must detect the landed commit + clean tree and record the item DONE
#    (recovered_via_commit), NOT blocked — this is the incident's item 003.
echo ""
echo "=== Scenario: commit-no-signal ==="

bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="commit-no-signal"

rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 >/dev/null 2>&1 || true

# The lost signal must be recovered from the commit: item done, not blocked.
assert_item_status "001" "done"
assert_no_iteration_status
assert_done_file_exists

# Recovery must be via commit reconciliation, logged with the recovered hash.
if grep -q "recovered_via_commit" "$SANDBOX_DIR/.rauf/rauf.log"; then
  pass "log shows recovered_via_commit"
else
  fail "log missing recovered_via_commit (item not recovered from its commit?)"
fi

# The item must NOT have been deferred or blocked by the runner.
if grep -qE "deferred by runner|Item 001 blocked" "$SANDBOX_DIR/.rauf/rauf.log"; then
  fail "item was blocked/deferred despite a landed commit"
else
  pass "item not blocked/deferred (recovered instead)"
fi

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
