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

# ─── Event-log integration helpers (item 014) ────────────────────────

# Assert events.ndjson and state.json never contradict across a run:
# state.json is authoritative for status; events.ndjson is the stream/history.
# Checks: non-empty log, dense+monotonic seq from 0, terminal loop_completed
# event (consistent with the terminal state.json status), and every done item
# carries a corresponding item_completed event.
assert_events_never_contradict() {
  local events="$SANDBOX_DIR/.rauf/events.ndjson"
  local backlog="$SANDBOX_DIR/.rauf/backlog.json"

  if [ -s "$events" ]; then
    pass "events.ndjson is non-empty"
  else
    fail "events.ndjson missing or empty"
    return
  fi

  # seq must be dense+monotonic from 0 (line index == .seq for every line).
  if jq -s -e 'to_entries | all(.[]; .key == .value.seq)' "$events" >/dev/null; then
    pass "events.ndjson seq is dense+monotonic from 0"
  else
    fail "events.ndjson seq is not dense/monotonic from 0"
  fi

  # The terminal event must be loop_completed (does not contradict a terminal
  # state.json status such as limit_reached).
  if [ "$(tail -n1 "$events" | jq -r '.type')" = "loop_completed" ]; then
    pass "events terminal event = loop_completed (consistent with terminal state)"
  else
    fail "events terminal event is not loop_completed"
  fi

  # Never-contradict: every item state.json/backlog marks done has a matching
  # item_completed event in the stream.
  local ok_all=1
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    if ! jq -s -e --arg id "$id" \
      'any(.[]; .type=="item_completed" and .itemId==$id)' "$events" >/dev/null; then
      ok_all=0
      fail "done item $id has no item_completed event (events/state contradict)"
    fi
  done < <(jq -r '.items[] | select(.status=="done") | .id' "$backlog")
  [ "$ok_all" -eq 1 ] && pass "every done item has a corresponding item_completed event"
}

# Assert the dogfood commit rule end to end: exactly one commit per item since
# the last sandbox baseline, the message is `[rauf] <id>:`, and the live
# events.ndjson is NOT part of that commit (RUNTIME_EXCLUDE_PATHSPECS).
assert_dogfood_commit() {
  local baseline new
  baseline=$(git rev-list -n1 --grep="sandbox baseline" HEAD 2>/dev/null)
  if [ -z "$baseline" ]; then
    fail "could not locate sandbox baseline commit"
    return
  fi
  new=$(git rev-list "${baseline}..HEAD" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$new" = "1" ]; then
    pass "exactly one commit per item since baseline (runner-owns-commit)"
  else
    fail "expected exactly 1 commit since baseline, got $new"
  fi

  if git log -1 --format=%s HEAD | grep -q '^\[rauf\] 001:'; then
    pass "per-item commit message is '[rauf] 001:'"
  else
    fail "per-item commit message is not '[rauf] 001:' (got '$(git log -1 --format=%s HEAD)')"
  fi

  # The live events.ndjson must never be in the commit (exact path, so a
  # committed archive/<ts>-events.ndjson does not false-match).
  if git show --name-only --format= HEAD | grep -qx '.rauf/events.ndjson'; then
    fail "per-item commit includes live .rauf/events.ndjson (must be excluded)"
  else
    pass "per-item commit excludes live .rauf/events.ndjson (RUNTIME_EXCLUDE_PATHSPECS)"
  fi
}

# ─── Cross-agent assertion helpers (item 013) ────────────────────────

# assert_event_provider <id>
# Assert some llm_spawned/llm_exited event in events.ndjson carries provider==<id>
# (REQ-OBS-01, SC-4) AND that no llm_spawned/llm_exited event carries 'claude-cli'
# — proving a non-claude run reports the REAL resolved agent id, never the legacy
# hardcoded default.
assert_event_provider() {
  local id="$1"
  local events="$SANDBOX_DIR/.rauf/events.ndjson"
  if [ ! -s "$events" ]; then
    fail "events.ndjson missing/empty (provider==$id check)"
    return
  fi
  if jq -s -e --arg id "$id" \
    'any(.[]; (.type=="llm_spawned" or .type=="llm_exited") and .provider==$id)' \
    "$events" >/dev/null; then
    pass "llm_spawned/llm_exited carry provider==$id"
  else
    fail "no llm_spawned/llm_exited event with provider==$id"
  fi
  if jq -s -e \
    'any(.[]; (.type=="llm_spawned" or .type=="llm_exited") and .provider=="claude-cli")' \
    "$events" >/dev/null; then
    fail "a non-claude run emitted provider==claude-cli (must not for $id)"
  else
    pass "no llm_spawned/llm_exited event carries claude-cli ($id run)"
  fi
}

# assert_no_usage_preflight
# Reuse the exact marker the usage-limit-stdout case greps for. For a non-claude
# agent (no checkUsage) the Anthropic usage preflight/banner scan is gated off
# (REQ-USAGE-02), so this line must be ABSENT.
assert_no_usage_preflight() {
  if ! grep -q "Usage limit detected" "$SANDBOX_DIR/.rauf/rauf.log"; then
    pass "no 'Usage limit detected' (Anthropic preflight skipped)"
  else
    fail "'Usage limit detected' present (usage preflight ran for a non-claude agent)"
  fi
}

# assert_no_agent_telemetry
# A plain-text CLI agent emits no stream-json, so there must be NO token-count
# (llm_token_update) or tool-activity (llm_tool_activity) events — telemetry is
# gracefully absent (REQ-OBS-02) without failing the run.
assert_no_agent_telemetry() {
  local events="$SANDBOX_DIR/.rauf/events.ndjson"
  if [ ! -s "$events" ]; then
    fail "events.ndjson missing/empty (telemetry-absence check)"
    return
  fi
  if jq -s -e 'any(.[]; .type=="llm_tool_activity" or .type=="llm_token_update")' \
    "$events" >/dev/null; then
    fail "plain-text agent emitted token/tool telemetry (should be absent)"
  else
    pass "no token/llm_tool_activity telemetry (gracefully absent)"
  fi
}

# assert_agent_stream_done <id>
# The full SC-1/SC-4 per-agent stream-done assertion bundle: item done + DONE
# file + limit_reached + exactly one [rauf] 001 commit + real provider id + no
# usage preflight + no telemetry + no events/state contradiction (clean run).
assert_agent_stream_done() {
  local id="$1"
  assert_item_status "001" "done"
  assert_done_file_exists
  assert_state_status "limit_reached"
  assert_dogfood_commit
  assert_event_provider "$id"
  assert_no_usage_preflight
  assert_no_agent_telemetry
  assert_events_never_contradict
}

# ─── Run a scenario through a specific mock agent (item 013) ──────────

# run_agent_scenario <agent> <scenario>
# Cross-agent sibling of run_scenario: resets the sandbox, puts the sandbox mock
# binaries first on PATH, exports the canonical scenario env, and runs ONE loop
# iteration through `rauf loop run ... --agent <id>`. For <agent>=claude (or
# empty/claude-cli) no --agent flag is passed (exactly today's claude path).
run_agent_scenario() {
  local agent="$1"
  local scenario="$2"
  CURRENT_SCENARIO="$scenario ($agent)"
  echo ""
  echo "=== Scenario: $scenario (agent: $agent) ==="

  bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

  export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
  export MOCK_AGENT_SCENARIO="$scenario"
  export MOCK_CLAUDE_SCENARIO="$scenario"

  local agent_flag=""
  if [ -n "$agent" ] && [ "$agent" != "claude" ] && [ "$agent" != "claude-cli" ]; then
    agent_flag="--agent $agent"
  fi

  # shellcheck disable=SC2086
  rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 $agent_flag >/dev/null 2>&1 || true
}

# run_generic_cli_scenario <scenario>
# Drives the reserved generic-cli adapter via a marker `providerConfig` pointing
# at mock-generic-agent.sh (REQ-ADP-04, REQ-SCALE-01 — the config-driven, no-code
# path). Injects the providerConfig into a COPY of the committed .rauf.json for
# the run, then restores it so the repo/later rows are untouched.
run_generic_cli_scenario() {
  local scenario="$1"
  CURRENT_SCENARIO="$scenario (generic-cli)"
  echo ""
  echo "=== Scenario: $scenario (agent: generic-cli) ==="

  # Inject the providerConfig BEFORE setup.sh commits the sandbox baseline, so the
  # modified .rauf.json lands in the baseline and the dirty-tree guard sees a clean
  # tree. Restored after the run so the parent repo's committed marker is untouched.
  local marker="$SANDBOX_DIR/.rauf.json"
  cp "$marker" "$marker.verifybak"
  jq --arg bin "$SANDBOX_DIR/mock-generic-agent.sh" \
    '.options.providerConfig = { binary: $bin, promptDelivery: "stdin", nonInteractive: ["--auto-approve"] }' \
    "$marker.verifybak" >"$marker"

  bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

  export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
  export MOCK_AGENT_SCENARIO="$scenario"
  export MOCK_CLAUDE_SCENARIO="$scenario"

  rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 --agent generic-cli >/dev/null 2>&1 || true

  # Restore the committed marker (no providerConfig) for the rest of the suite.
  mv "$marker.verifybak" "$marker"
}

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
# Event-log integration (item 014): events.ndjson and state.json never contradict,
# and the per-item commit obeys the runner-owns-commit rule without committing
# the live event log.
assert_events_never_contradict
assert_dogfood_commit

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

# ─── Pause-on-needs-human + resume --answer scenario ─────────────────

# 10. pause-resume-needs-human: a two-phase end-to-end proof of the live
#     supervision feature (items 008/009).
#       Phase 1 — `loop run --pause-on-needs-human --ndjson`: the mock emits
#         RAUF_NEEDS_HUMAN; the loop sets the item aside then HALTS in
#         paused_human, emitting needs_human + loop_paused on the NDJSON stream
#         and exiting the distinct needs-human exit code (ExitCode.PAUSED_HUMAN
#         = 6).
#       Phase 2 — `resume --answer 001 "<text>"`: the item is re-queued with the
#         answer attached, so the relaunched iteration's prompt carries the
#         "Human's Answer" section (the mock records it as proof it round-tripped
#         into the prompt). The item then completes and humanAnswer is
#         auto-cleared on completion.
echo ""
echo "=== Scenario: pause-resume-needs-human ==="

bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="pause-resume-needs-human"

# ── Phase 1: pause on the needs-human item ──
NDJSON_OUT="$(mktemp)"
PAUSE_EXIT=0
rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 \
  --pause-on-needs-human --ndjson >"$NDJSON_OUT" 2>/dev/null || PAUSE_EXIT=$?

# Distinct needs-human exit code. The former PAUSED_HUMAN(6) was folded into
# ExitCode.NEEDS_HUMAN = 3 (commands.ts:95); 6 is now RUNNING (query-time only).
if [ "$PAUSE_EXIT" -eq 3 ]; then
  pass "loop run --pause-on-needs-human exited NEEDS_HUMAN (3)"
else
  fail "expected exit 3 (NEEDS_HUMAN), got $PAUSE_EXIT"
fi

# The NDJSON stream must carry needs_human THEN loop_paused (reason needs_human).
if grep -q '"type":"needs_human"' "$NDJSON_OUT"; then
  pass "NDJSON stream emitted needs_human"
else
  fail "NDJSON stream missing needs_human event"
fi
if grep -q '"type":"loop_paused"' "$NDJSON_OUT" &&
  grep -q '"reason":"needs_human"' "$NDJSON_OUT"; then
  pass "NDJSON stream emitted loop_paused (reason needs_human)"
else
  fail "NDJSON stream missing loop_paused event"
fi

# The loop halted in the resumable paused_human state with a matching DONE marker.
assert_state_status "paused_human"
assert_done_file_contains "paused_human"
# The item was set aside (blocked) awaiting a human answer.
assert_item_status "001" "blocked"

rm -f "$NDJSON_OUT"

# ── Phase 2: resume with an injected answer ──
ANSWER_TEXT="Use REST for the public API"
rauf resume "$SANDBOX_DIR" --answer 001 "$ANSWER_TEXT" >/dev/null 2>&1 || true

# The answered item is re-queued, runs with the answer in its prompt, and completes.
assert_item_status "001" "done"

# The relaunched iteration's prompt carried the Human's Answer section — the mock
# recorded the injected text as proof it round-tripped into the prompt.
if [ -f "$SANDBOX_DIR/.rauf/answer-proof.txt" ] &&
  grep -q "$ANSWER_TEXT" "$SANDBOX_DIR/.rauf/answer-proof.txt"; then
  pass "resume answer reached the next iteration's prompt (Human's Answer section)"
else
  fail "answer did not reach the prompt (no proof of Human's Answer section)"
fi

# humanAnswer is auto-cleared once the item completes (no stale re-injection).
human_answer=$(jq -r '.items[] | select(.id == "001") | .humanAnswer // "null"' \
  "$SANDBOX_DIR/.rauf/backlog.json")
if [ "$human_answer" = "null" ]; then
  pass "humanAnswer cleared after completion"
else
  fail "humanAnswer not cleared (got '$human_answer')"
fi

# ─── Best-effort persistence is invisible (item 014) ─────────────────

# 11. unwritable-events: events.ndjson persistence is best-effort (REQ-PERF-01 /
#     REQ-REL-02). Make the event log unwritable and confirm the loop still
#     completes and reports correct status from state.json + rauf.log — the
#     persistence failure must be fully silent.
#
#     Sabotage: events.ndjson is a DIRECTORY (appendFileSync → EISDIR every
#     write) and archive/ is a FILE (so rotateEventsLog's ensureDir(archive)
#     fails and cannot move the directory out of the way — the unwritable path
#     persists for the whole run). state.json/rauf.log live beside it in a
#     writable .rauf/, so loop correctness is unaffected.
echo ""
echo "=== Scenario: unwritable-events (best-effort persistence) ==="

bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="stream-done"

mkdir -p "$SANDBOX_DIR/.rauf/events.ndjson"
: >"$SANDBOX_DIR/.rauf/archive"

rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 >/dev/null 2>&1 || true

# The loop completed the item despite the unwritable event log.
assert_item_status "001" "done"
assert_state_status "limit_reached"
assert_done_file_exists

# Persistence failure was silent: no events were written (path stayed a dir).
if [ -d "$SANDBOX_DIR/.rauf/events.ndjson" ]; then
  pass "events.ndjson persistence failed silently (path remained unwritable)"
else
  fail "events.ndjson sabotage was not preserved (rotation/append worked unexpectedly)"
fi

# Status is reported from state.json + rauf.log, not the event log.
if grep -q "Item 001 completed" "$SANDBOX_DIR/.rauf/rauf.log"; then
  pass "status recoverable from rauf.log (Item 001 completed) without the event log"
else
  fail "rauf.log missing completion record"
fi

# Clean up the sabotage so it never leaks into a commit or a later scenario.
rm -rf "$SANDBOX_DIR/.rauf/events.ndjson" "$SANDBOX_DIR/.rauf/archive"

# ─── Compatibility: no events.ndjson, no ~/.rauf/active (item 014) ───

# 12. An install predating this version (no events.ndjson, no ~/.rauf/active)
#     must keep working: status degrades gracefully (readEvents → ok([]),
#     listActiveLoops over a missing ACTIVE_DIR → ok([])) and never crashes.
echo ""
echo "=== Scenario: compatibility (no events.ndjson / no ~/.rauf/active) ==="

bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1
export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"

# Fresh setup has no state.json and no events.ndjson; a throwaway HOME has no
# ~/.rauf/active. A status read must still succeed.
assert_file_not_exists "$SANDBOX_DIR/.rauf/events.ndjson" ".rauf/events.ndjson (absent pre-run)"

COMPAT_HOME="$(mktemp -d)"
COMPAT_RC=0
HOME="$COMPAT_HOME" rauf status "$SANDBOX_DIR" >/dev/null 2>&1 || COMPAT_RC=$?
if [ "$COMPAT_RC" -eq 0 ]; then
  pass "rauf status degrades gracefully with no events.ndjson / no ~/.rauf/active (exit 0)"
else
  fail "rauf status crashed with no events.ndjson / no ~/.rauf/active (exit $COMPAT_RC)"
fi

# status --all over a missing ACTIVE_DIR must also not crash.
COMPAT_ALL_RC=0
HOME="$COMPAT_HOME" rauf status "$SANDBOX_DIR" --all >/dev/null 2>&1 || COMPAT_ALL_RC=$?
if [ "$COMPAT_ALL_RC" -eq 0 ]; then
  pass "rauf status --all tolerates a missing ~/.rauf/active (exit 0)"
else
  fail "rauf status --all crashed with a missing ~/.rauf/active (exit $COMPAT_ALL_RC)"
fi

rm -rf "$COMPAT_HOME"

# ─── Cross-agent: per-agent stream-done (SC-1, SC-4) ─────────────────

# 13. Each shipped non-claude preset drives the stream-done scenario (plain-text)
#     end-to-end: reaches RAUF_DONE, commits, reports its REAL provider id in the
#     events, skips the Anthropic usage preflight, and emits no token/tool
#     telemetry — the "telemetry gracefully absent" path (REQ-OBS-02). cursor is
#     driven via its `cursor-agent` binary but its provider id is "cursor".
for agent in codex gemini copilot cursor; do
  run_agent_scenario "$agent" "stream-done"
  assert_agent_stream_done "$agent"
done

# 14. The reserved generic-cli adapter, driven by a marker providerConfig pointing
#     at mock-generic-agent.sh (REQ-ADP-04, REQ-SCALE-01) — the config-driven,
#     no-code path. Same end-to-end guarantees, provider id == "generic-cli".
run_generic_cli_scenario "stream-done"
assert_agent_stream_done "generic-cli"

# 15. A non-claude stream-blocked run proves plain-text RAUF_BLOCKED parsing on
#     the non-claude path (parseSignal over raw stdout, REQ-SIG-02).
run_agent_scenario "codex" "stream-blocked"
assert_item_status "001" "blocked"
assert_event_provider "codex"

# ─── Fail-fast: absent agent CLI (SC-3, REQ-DET-02) ──────────────────

# 16. Selecting an agent whose CLI is absent must fail BEFORE any iteration runs
#     or any state is written, naming the agent + remediation, with NO fallback
#     to claude. Run --agent codex on a PATH that resolves rauf (and its bun
#     runtime) but NOT the codex mock — and NOT a real system codex — so the
#     binary genuinely does not resolve. "No state written" = (a) no state.json,
#     (b) no backlog status change, (c) no per-item commit.
echo ""
echo "=== Scenario: fail-fast (--agent codex, codex absent from PATH) ==="

bash "$SANDBOX_DIR/setup.sh" >/dev/null 2>&1

# A minimal PATH: rauf wrapper + bun runtime + base system, deliberately EXCLUDING
# both the sandbox mocks and ~/.local/bin (where a real codex/claude may live).
FAILFAST_BUN_DIR="$(dirname "$(command -v bun)")"
FAILFAST_PATH="$REPO_ROOT/scripts/bin:$FAILFAST_BUN_DIR:/usr/bin:/bin"

# Record the baseline commit so we can prove no new commit was made.
FAILFAST_BASELINE="$(git rev-parse HEAD 2>/dev/null)"

FAILFAST_OUT="$(mktemp)"
FAILFAST_EXIT=0
PATH="$FAILFAST_PATH" rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 \
  --agent codex >"$FAILFAST_OUT" 2>&1 || FAILFAST_EXIT=$?

# Non-zero exit.
if [ "$FAILFAST_EXIT" -ne 0 ]; then
  pass "fail-fast exits non-zero (got $FAILFAST_EXIT)"
else
  fail "fail-fast exited 0 (expected non-zero for an absent agent)"
fi

# Message names the agent and how to install / put it on PATH.
if grep -qi "codex" "$FAILFAST_OUT" &&
  grep -qiE "install|on PATH" "$FAILFAST_OUT"; then
  pass "fail-fast message names codex + install/PATH remediation"
else
  fail "fail-fast message missing codex or install/PATH remediation"
fi

# No silent fallback to claude (the supported-agents list may contain 'claude-cli',
# but the run must not announce it is USING/falling back to claude).
if grep -qiE "fall.?back|using claude|defaulting to claude|switching to claude" "$FAILFAST_OUT"; then
  fail "fail-fast output mentions falling back to claude"
else
  pass "fail-fast output never mentions a claude fallback"
fi

# (a) No state.json written.
assert_file_not_exists "$SANDBOX_DIR/.rauf/state.json" ".rauf/state.json (fail-fast wrote no state)"

# (b) No backlog status mutation — item 001 stays at its setup.sh value (pending).
assert_item_status "001" "pending"

# (c) No per-item commit since the baseline.
FAILFAST_NEW="$(git rev-list "${FAILFAST_BASELINE}..HEAD" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$FAILFAST_NEW" = "0" ]; then
  pass "fail-fast made no commit since baseline"
else
  fail "fail-fast made $FAILFAST_NEW commit(s) since baseline (expected 0)"
fi

rm -f "$FAILFAST_OUT"

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
