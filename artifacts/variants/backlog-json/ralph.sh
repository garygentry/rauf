#!/usr/bin/env bash
# =============================================================================
# ralph.sh — Autonomous Claude Code loop runner
# Usage: ./ralph.sh [max_iterations] [max_retries] [model]
# Example: ./ralph.sh 50 3 claude-opus-4-6
#
# max_iterations: CLI arg > .ralph.json options.maxIterations > 20 (default)
# max_retries: per-item retry limit before auto-blocking (default: 3)
# model: CLI arg $3 > .ralph.json options.model > item.model > no --model flag
#
# The loop runner manages all backlog status transitions. Claude does NOT
# modify backlog.json — it focuses on implementation and emits exit signals.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RALPH_DIR=".ralph"
BACKLOG="$RALPH_DIR/backlog.json"
PROGRESS="$RALPH_DIR/progress.md"
RALPH_MD="$RALPH_DIR/RALPH.md"
LOG="$RALPH_DIR/ralph.log"
STATE="$RALPH_DIR/state.json"
# Max iterations: CLI arg > .ralph.json options > default (20)
if [[ -n "${1:-}" ]]; then
  MAX_ITERATIONS="$1"
elif [[ -f ".ralph.json" ]]; then
  MAX_ITERATIONS=$(jq -r '.options.maxIterations // 20' ".ralph.json" 2>/dev/null || echo 20)
else
  MAX_ITERATIONS=20
fi
MAX_RETRIES=${2:-3}
# Model: CLI arg $3 (highest priority among static sources; per-item overrides at runtime)
CLI_MODEL="${3:-}"
# Project-level default model from .ralph.json options.model
PROJECT_MODEL=""
if [[ -f ".ralph.json" ]]; then
  PROJECT_MODEL=$(jq -r '.options.model // empty' ".ralph.json" 2>/dev/null || true)
fi
ITER=0
START_TIME=$(date +%s)
START_ISO=$(date -Iseconds)
COMPLETED_IDS="[]"
BLOCKED_IDS="[]"
CURRENT_ITEM_ID=""
declare -A RETRY_COUNTS  # Track per-item retry count (in-memory only)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG"
}

notify_done() {
  local summary="$1"
  if command -v notify-send &>/dev/null; then
    notify-send "Ralph Loop Complete" "$summary" --urgency=normal 2>/dev/null || true
  fi
  echo "$summary" > "$RALPH_DIR/DONE"
  log "NOTIFICATION: $summary"
  printf '\a'
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "ERROR: Required file not found: $1"
    echo "Run from your project root and ensure .ralph/ is set up."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# state.json writer — structured loop state for the manager tool
# ---------------------------------------------------------------------------
write_state() {
  local status="$1"
  local current_item="${2:-null}"
  local last_signal="${3:-clean}"
  local error_msg="${4:-null}"

  # Quote strings, leave null unquoted
  if [[ "$current_item" != "null" ]]; then
    current_item="\"$current_item\""
  fi
  if [[ "$error_msg" != "null" ]]; then
    error_msg="\"$error_msg\""
  fi

  cat > "$STATE.tmp" <<EOF
{
  "status": "$status",
  "iteration": $ITER,
  "maxIterations": $MAX_ITERATIONS,
  "currentItem": $current_item,
  "lastSignal": "$last_signal",
  "startedAt": "$START_ISO",
  "updatedAt": "$(date -Iseconds)",
  "completedItems": $COMPLETED_IDS,
  "blockedItems": $BLOCKED_IDS,
  "error": $error_msg
}
EOF
  mv "$STATE.tmp" "$STATE"
}

# ---------------------------------------------------------------------------
# write_state_limit — write sleeping_limit or weekly_limit state
# ---------------------------------------------------------------------------
write_state_limit() {
  local loop_status="$1"   # "sleeping_limit" | "weekly_limit"
  local sleep_until="$2"   # ISO timestamp or ""
  local error_msg="$3"

  local sleep_field="null"
  [[ -n "$sleep_until" ]] && sleep_field="\"$sleep_until\""

  cat > "$STATE.tmp" <<EOF
{
  "status": "$loop_status",
  "iteration": $ITER,
  "maxIterations": $MAX_ITERATIONS,
  "currentItem": null,
  "lastSignal": "error",
  "startedAt": "$START_ISO",
  "updatedAt": "$(date -Iseconds)",
  "sleepUntil": $sleep_field,
  "completedItems": $COMPLETED_IDS,
  "blockedItems": $BLOCKED_IDS,
  "error": "$error_msg"
}
EOF
  mv "$STATE.tmp" "$STATE"
}

# ---------------------------------------------------------------------------
# Targeted backlog writes — modify single items by ID, not full file
# ---------------------------------------------------------------------------
mark_in_progress() {
  local item_id="$1"
  jq --arg id "$item_id" \
    '(.items[] | select(.id == $id)) |= (.status = "in_progress")' \
    "$BACKLOG" > "$BACKLOG.tmp" && mv "$BACKLOG.tmp" "$BACKLOG"
}

mark_done() {
  local item_id="$1"
  local ts
  ts=$(date -Iseconds)
  jq --arg id "$item_id" --arg ts "$ts" \
    '(.items[] | select(.id == $id)) |= (.status = "done" | .completedAt = $ts)' \
    "$BACKLOG" > "$BACKLOG.tmp" && mv "$BACKLOG.tmp" "$BACKLOG"
}

mark_blocked() {
  local item_id="$1"
  local reason="${2:-No reason provided}"
  jq --arg id "$item_id" --arg reason "$reason" \
    '(.items[] | select(.id == $id)) |= (.status = "blocked" | .blockedReason = $reason)' \
    "$BACKLOG" > "$BACKLOG.tmp" && mv "$BACKLOG.tmp" "$BACKLOG"
}

reset_to_pending() {
  local item_id="$1"
  jq --arg id "$item_id" \
    '(.items[] | select(.id == $id)) |= (.status = "pending")' \
    "$BACKLOG" > "$BACKLOG.tmp" && mv "$BACKLOG.tmp" "$BACKLOG"
}

# ---------------------------------------------------------------------------
# Item selection — first pending item sorted by priority (1=highest)
# ---------------------------------------------------------------------------
select_next_item() {
  # Returns the ID of the highest-priority pending item whose dependencies are all done
  jq -r '
    [.items[] | select(.status == "done") | .id] as $done_ids |
    [.items[] | select(.status == "pending") | select(
      (.dependsOn == null) or (.dependsOn | length == 0) or
      (.dependsOn | all(IN($done_ids[])))
    )] | sort_by(.priority) | .[0].id // empty
  ' "$BACKLOG"
}

get_item_json() {
  local item_id="$1"
  jq --arg id "$item_id" '.items[] | select(.id == $id)' "$BACKLOG"
}

get_item_title() {
  local item_id="$1"
  jq -r --arg id "$item_id" '.items[] | select(.id == $id) | .title' "$BACKLOG"
}

get_item_model() {
  local item_id="$1"
  jq -r --arg id "$item_id" '.items[] | select(.id == $id) | .model // empty' "$BACKLOG" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Count helpers
# ---------------------------------------------------------------------------
count_pending()     { jq '[.items[] | select(.status == "pending")]     | length' "$BACKLOG"; }
count_in_progress() { jq '[.items[] | select(.status == "in_progress")] | length' "$BACKLOG"; }
count_blocked()     { jq '[.items[] | select(.status == "blocked")]     | length' "$BACKLOG"; }
count_done()        { jq '[.items[] | select(.status == "done")]        | length' "$BACKLOG"; }
count_total()       { jq '.items | length' "$BACKLOG"; }

print_status() {
  local pending in_prog blocked done total
  pending=$(count_pending)
  in_prog=$(count_in_progress)
  blocked=$(count_blocked)
  done=$(count_done)
  total=$(count_total)
  log "Status → pending:$pending  in_progress:$in_prog  blocked:$blocked  done:$done  total:$total"
}

# ---------------------------------------------------------------------------
# Usage limit helpers
# ---------------------------------------------------------------------------

# Read OAuth access token from Claude Code credentials file
get_oauth_token() {
  local creds_file="$HOME/.config/claude-code/credentials.json"
  if [[ -f "$creds_file" ]]; then
    jq -r '.claudeAiOauth.accessToken // empty' "$creds_file" 2>/dev/null
  fi
}

# Query Anthropic usage API; outputs JSON or nothing on failure
check_usage_api() {
  local token="$1"
  [[ -z "$token" ]] && return
  curl -sf "https://api.anthropic.com/api/oauth/usage" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    --max-time 10 2>/dev/null
}

# Format an ISO timestamp as "8:00 PM (in 4h 32m)" or "Feb 27 at 5:00 AM (in 3d)"
format_reset_time() {
  local iso="$1"
  [[ -z "$iso" ]] && echo "unknown" && return

  local epoch
  epoch=$(date -d "$iso" +%s 2>/dev/null || true)
  [[ -z "$epoch" ]] && echo "$iso" && return

  local diff=$(( epoch - $(date +%s) ))
  local time_str
  time_str=$(date -d "$iso" '+%I:%M %p' 2>/dev/null || echo "$iso")

  if [[ $diff -le 0 ]]; then
    echo "$time_str (now)"
  elif [[ $diff -lt 3600 ]]; then
    echo "$time_str (in $(( diff / 60 ))m)"
  elif [[ $diff -lt 86400 ]]; then
    local hrs=$(( diff / 3600 ))
    local mins=$(( (diff % 3600) / 60 ))
    echo "$time_str (in ${hrs}h ${mins}m)"
  else
    local days=$(( diff / 86400 ))
    local date_str
    date_str=$(date -d "$iso" '+%b %-d at %I:%M %p' 2>/dev/null || echo "$iso")
    echo "$date_str (in ${days}d)"
  fi
}

# Sleep in CHECK_INTERVAL chunks, polling for CANCEL signal each tick.
# Touches state.json updatedAt on each tick to prevent staleness detection.
# Usage: sleep_with_cancel TOTAL_SECONDS
sleep_with_cancel() {
  local total="$1"
  local check_interval=300  # 5 minutes
  local elapsed=0

  while [[ $elapsed -lt $total ]]; do
    if [[ -f "$RALPH_DIR/CANCEL" ]]; then
      log "CANCEL signal received during usage limit sleep — stopping"
      rm -f "$RALPH_DIR/CANCEL"
      write_state "paused" "null" "clean"
      echo "cancel" > "$RALPH_DIR/DONE"
      trap - EXIT
      exit 0
    fi

    local remaining=$((total - elapsed))
    local this_sleep=$((remaining < check_interval ? remaining : check_interval))
    sleep "$this_sleep"
    elapsed=$((elapsed + this_sleep))

    # Touch updatedAt so the web/CLI staleness heuristic does not downgrade state
    local current
    current=$(cat "$STATE" 2>/dev/null || echo "{}")
    echo "$current" | jq --arg ts "$(date -Iseconds)" '.updatedAt = $ts' \
      > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
  done
}

# ---------------------------------------------------------------------------
# Cleanup — reset any in_progress items on unexpected exit
# ---------------------------------------------------------------------------
cleanup() {
  if [[ -n "$CURRENT_ITEM_ID" ]]; then
    log "⚠ Unexpected exit — resetting item $CURRENT_ITEM_ID to pending"
    reset_to_pending "$CURRENT_ITEM_ID"
    write_state "error" "$CURRENT_ITEM_ID" "error" "Unexpected loop termination"
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
require_file "$BACKLOG"
require_file "$RALPH_MD"

if ! command -v claude &>/dev/null; then
  echo "ERROR: 'claude' CLI not found. Install Claude Code first."
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: sudo apt install jq"
  exit 1
fi

# ── Auto-sweep ────────────────────────────────────────────────────
if [[ -f ".ralph.json" ]]; then
  AUTO_SWEEP=$(jq -r '.options.autoSweep // false' ".ralph.json" 2>/dev/null || echo "false")
  if [[ "$AUTO_SWEEP" == "true" ]]; then
    SWEEP_MIN_AGE=$(jq -r '.options.sweepMinAgeDays // 0' ".ralph.json" 2>/dev/null || echo "0")
    log "Auto-sweep: archiving done items (minAgeDays=$SWEEP_MIN_AGE)..."
    if command -v ralph &>/dev/null; then
      SWEEP_FLAGS="--yes"
      [[ "$SWEEP_MIN_AGE" -gt 0 ]] && SWEEP_FLAGS="$SWEEP_FLAGS --min-age-days $SWEEP_MIN_AGE"
      # shellcheck disable=SC2086
      if ralph backlog sweep . $SWEEP_FLAGS >> "$LOG" 2>&1; then
        log "Auto-sweep complete."
      else
        log "⚠ Auto-sweep failed (exit $?) — continuing."
      fi
    else
      log "⚠ Auto-sweep: 'ralph' not in PATH — skipping."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Pre-flight usage limit check — detect active limits before first iteration
# ---------------------------------------------------------------------------
log "Checking Claude usage limits..."
PREFLIGHT_TOKEN=$(get_oauth_token)
PREFLIGHT_USAGE=$(check_usage_api "$PREFLIGHT_TOKEN")

if [[ -n "$PREFLIGHT_USAGE" ]]; then
  PF_SEVEN_PCT=$(echo "$PREFLIGHT_USAGE" | jq -r '.seven_day.utilization // 0' | cut -d. -f1)
  PF_FIVE_PCT=$(echo "$PREFLIGHT_USAGE"  | jq -r '.five_hour.utilization // 0'  | cut -d. -f1)
  PF_FIVE_RESET=$(echo "$PREFLIGHT_USAGE"  | jq -r '.five_hour.resets_at // ""')
  PF_SEVEN_RESET=$(echo "$PREFLIGHT_USAGE" | jq -r '.seven_day.resets_at // ""')

  # Always display usage stats as informational output
  log "  Usage: 5-hr ${PF_FIVE_PCT}% | 7-day ${PF_SEVEN_PCT}%"

  if [[ "$PF_SEVEN_PCT" -ge 100 ]]; then
    log "⛔ Weekly usage limit exhausted (${PF_SEVEN_PCT}%) — cannot start"
    log "   Weekly window resets at: $(format_reset_time "$PF_SEVEN_RESET")"
    log "   Restart ralph.sh after that time."
    write_state_limit "weekly_limit" "$PF_SEVEN_RESET" \
      "Weekly Claude usage limit exhausted. Resets at: $PF_SEVEN_RESET"
    echo "weekly_limit:$PF_SEVEN_RESET" > "$RALPH_DIR/DONE"
    trap - EXIT
    exit 3

  elif [[ "$PF_FIVE_PCT" -ge 100 ]]; then
    SLEEP_SECS=1800  # 30-min fallback
    if [[ -n "$PF_FIVE_RESET" ]]; then
      RESET_EPOCH=$(date -d "$PF_FIVE_RESET" +%s 2>/dev/null || true)
      if [[ -n "$RESET_EPOCH" ]]; then
        COMPUTED=$((RESET_EPOCH - $(date +%s) + 60))
        [[ $COMPUTED -gt 0 ]] && SLEEP_SECS=$COMPUTED
      fi
    fi
    log "⏸ Claude 5-hour usage window is active (${PF_FIVE_PCT}%)"
    log "  The loop will begin at $(format_reset_time "$PF_FIVE_RESET")"
    log "  Sleeping ${SLEEP_SECS}s. Run ralph-stop.sh to cancel."
    write_state_limit "sleeping_limit" "$PF_FIVE_RESET" \
      "5-hour usage limit active at startup. Loop will begin at ${PF_FIVE_RESET:-unknown}"
    sleep_with_cancel "$SLEEP_SECS"
    log "  Woke up — starting loop"
  fi
else
  log "  Usage API unreachable — proceeding (reactive detection active)"
fi

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
log "============================================"
log "Ralph Loop starting | max=$MAX_ITERATIONS iterations | max_retries=$MAX_RETRIES per item"
print_status
write_state "starting"

while [ $ITER -lt $MAX_ITERATIONS ]; do
  ITER=$((ITER + 1))
  log ""
  log "--- Iteration $ITER / $MAX_ITERATIONS ---"

  # Pull latest before each iteration (safe even with no remote)
  git pull --rebase --quiet 2>/dev/null || true

  # -----------------------------------------------------------------------
  # CANCEL signal check — fires before item selection (iteration boundary)
  # -----------------------------------------------------------------------
  if [[ -f "$RALPH_DIR/CANCEL" ]]; then
    log "CANCEL signal detected — stopping loop gracefully"
    rm -f "$RALPH_DIR/CANCEL"
    write_state "paused" "null" "clean"
    echo "cancel" > "$RALPH_DIR/DONE"
    log "Loop cancelled. State: paused. Run ./ralph.sh to resume."
    trap - EXIT
    exit 0
  fi

  # -----------------------------------------------------------------------
  # Select next item
  # -----------------------------------------------------------------------
  # First check for any in_progress items (resume from interrupted loop)
  CURRENT_ITEM_ID=$(jq -r '[.items[] | select(.status == "in_progress")] | .[0].id // empty' "$BACKLOG")

  if [[ -z "$CURRENT_ITEM_ID" ]]; then
    # No in_progress — select next pending item
    CURRENT_ITEM_ID=$(select_next_item)
  fi

  if [[ -z "$CURRENT_ITEM_ID" ]]; then
    # No pending or in_progress items — check if we're done
    DONE_COUNT=$(count_done)
    BLOCKED_COUNT=$(count_blocked)
    TOTAL=$(count_total)
    ELAPSED=$(( $(date +%s) - START_TIME ))
    ELAPSED_MIN=$(( ELAPSED / 60 ))

    SUMMARY="All work complete. Done: $DONE_COUNT / $TOTAL | Blocked: $BLOCKED_COUNT | Iterations: $ITER | Time: ${ELAPSED_MIN}m"
    log "============================================"
    log "COMPLETE: $SUMMARY"
    print_status
    CURRENT_ITEM_ID=""  # Clear so cleanup trap doesn't reset
    write_state "complete" "null" "clean"
    notify_done "$SUMMARY"
    trap - EXIT  # Disarm cleanup trap
    exit 0
  fi

  ITEM_TITLE=$(get_item_title "$CURRENT_ITEM_ID")
  log "Selected item $CURRENT_ITEM_ID: $ITEM_TITLE"

  # -----------------------------------------------------------------------
  # Mark item in_progress (targeted jq write)
  # -----------------------------------------------------------------------
  mark_in_progress "$CURRENT_ITEM_ID"
  write_state "running" "$CURRENT_ITEM_ID" "clean"
  log "Marked $CURRENT_ITEM_ID as in_progress"

  # -----------------------------------------------------------------------
  # Build prompt with focused item context
  # -----------------------------------------------------------------------
  ITEM_JSON=$(get_item_json "$CURRENT_ITEM_ID")
  PROGRESS_SNAPSHOT=$(cat "$PROGRESS" 2>/dev/null || echo "(no progress log yet)")

  PROMPT="$(cat "$RALPH_MD")

---
## Your Current Task

You are working on item **$CURRENT_ITEM_ID**: $ITEM_TITLE

\`\`\`json
$ITEM_JSON
\`\`\`

### Acceptance Criteria
$(echo "$ITEM_JSON" | jq -r '.acceptanceCriteria[]' 2>/dev/null | sed 's/^/- /')

### Dependencies
$(echo "$ITEM_JSON" | jq -r 'if .dependsOn then "This item depends on: " + (.dependsOn | join(", ")) else "No dependencies" end' 2>/dev/null)

### Notes
$(echo "$ITEM_JSON" | jq -r '.notes // "No additional notes"' 2>/dev/null)

---
## Full Backlog Context (read-only — do NOT modify this file)
\`\`\`json
$(cat "$BACKLOG")
\`\`\`

## Progress Log (accumulated learnings from previous iterations)
\`\`\`
$PROGRESS_SNAPSHOT
\`\`\`

---
**IMPORTANT:** You are working on item $CURRENT_ITEM_ID ONLY. Do NOT modify .ralph/backlog.json or .ralph/state.json — the loop runner manages status. When done, output your exit signal as the LAST line of your response.
"

  # -----------------------------------------------------------------------
  # Resolve model: item.model > CLI arg > project default > no flag
  # -----------------------------------------------------------------------
  ITEM_MODEL=$(get_item_model "$CURRENT_ITEM_ID")
  RESOLVED_MODEL="${ITEM_MODEL:-${CLI_MODEL:-${PROJECT_MODEL:-}}}"
  MODEL_FLAG=""
  if [[ -n "$RESOLVED_MODEL" ]]; then
    MODEL_FLAG="--model $RESOLVED_MODEL"
    log "Using model: $RESOLVED_MODEL (source: ${ITEM_MODEL:+item}${ITEM_MODEL:-${CLI_MODEL:+cli-arg}${CLI_MODEL:-${PROJECT_MODEL:+project-default}}})"
  fi

  # -----------------------------------------------------------------------
  # Run Claude — headless, fresh session, full permissions
  # -----------------------------------------------------------------------
  log "Spawning Claude session for item $CURRENT_ITEM_ID..."
  # shellcheck disable=SC2086
  CLAUDE_STDERR_FILE=$(mktemp)
  set +e  # Allow claude to exit non-zero without aborting the script
  OUTPUT=$(echo "$PROMPT" | claude -p \
    --dangerously-skip-permissions \
    --output-format text \
    $MODEL_FLAG \
    2>"$CLAUDE_STDERR_FILE")
  CLAUDE_EXIT=$?
  set -e
  CLAUDE_STDERR=$(cat "$CLAUDE_STDERR_FILE")
  rm -f "$CLAUDE_STDERR_FILE"

  # Log condensed output (first 80 lines)
  echo "$OUTPUT" | head -80 >> "$LOG"
  if [[ -n "$CLAUDE_STDERR" ]]; then
    echo "[claude stderr] $(echo "$CLAUDE_STDERR" | head -5)" >> "$LOG"
  fi

  # -----------------------------------------------------------------------
  # Usage limit detection — check before normal signal parsing
  # -----------------------------------------------------------------------
  if [[ $CLAUDE_EXIT -ne 0 ]] && echo "$CLAUDE_STDERR" | grep -qi "usage limit\|rate limit\|Claude AI Usage Limit\|too many requests"; then
    log "⚠ Claude exited $CLAUDE_EXIT — usage limit detected"

    OAUTH_TOKEN=$(get_oauth_token)
    USAGE_JSON=$(check_usage_api "$OAUTH_TOKEN")

    SEVEN_PCT=0
    FIVE_PCT=100   # default: assume 5hr limit if API unreachable
    FIVE_RESET=""
    SEVEN_RESET=""

    if [[ -n "$USAGE_JSON" ]]; then
      SEVEN_PCT=$(echo "$USAGE_JSON" | jq -r '.seven_day.utilization // 0' | cut -d. -f1)
      FIVE_PCT=$(echo "$USAGE_JSON" | jq -r '.five_hour.utilization // 0' | cut -d. -f1)
      FIVE_RESET=$(echo "$USAGE_JSON" | jq -r '.five_hour.resets_at // ""')
      SEVEN_RESET=$(echo "$USAGE_JSON" | jq -r '.seven_day.resets_at // ""')
      log "  Usage — 5hr: ${FIVE_PCT}% (resets ${FIVE_RESET}), 7day: ${SEVEN_PCT}% (resets ${SEVEN_RESET})"
    else
      log "  Could not reach usage API — will use conservative 30-min sleep"
    fi

    # Reset item to pending so it is picked up after sleep/restart
    if [[ -n "$CURRENT_ITEM_ID" ]]; then
      reset_to_pending "$CURRENT_ITEM_ID"
      CURRENT_ITEM_ID=""
    fi

    if [[ "$SEVEN_PCT" -ge 100 ]]; then
      # Weekly cap exhausted — cannot self-recover, must stop
      log "⛔ Weekly Claude usage limit exhausted (${SEVEN_PCT}%)"
      log "  The loop cannot resume until $(format_reset_time "$SEVEN_RESET")"
      log "  Restart ralph.sh after that time."
      write_state_limit "weekly_limit" "$SEVEN_RESET" "Weekly Claude usage limit exhausted. Resets at: $SEVEN_RESET"
      echo "weekly_limit:$SEVEN_RESET" > "$RALPH_DIR/DONE"
      trap - EXIT
      exit 3
    else
      # 5-hour window exhausted — sleep until reset, then resume
      SLEEP_SECS=1800  # 30-min fallback if reset time is unavailable
      if [[ -n "$FIVE_RESET" ]]; then
        RESET_EPOCH=$(date -d "$FIVE_RESET" +%s 2>/dev/null || true)
        NOW_EPOCH=$(date +%s)
        if [[ -n "$RESET_EPOCH" ]]; then
          COMPUTED=$((RESET_EPOCH - NOW_EPOCH + 60))  # +60s buffer
          [[ $COMPUTED -gt 0 ]] && SLEEP_SECS=$COMPUTED
        fi
      fi

      log "⏸ Claude 5-hour usage limit hit (${FIVE_PCT}%)"
      log "  The loop will resume at $(format_reset_time "$FIVE_RESET")"
      log "  Sleeping ${SLEEP_SECS}s. Run ralph-stop.sh to cancel."
      write_state_limit "sleeping_limit" "$FIVE_RESET" "5-hour usage limit hit. Sleeping until ${FIVE_RESET:-unknown}"
      sleep_with_cancel "$SLEEP_SECS"
      log "  Woke up — resuming loop"
      write_state "running" "null" "clean"
      continue
    fi
  fi
  # -----------------------------------------------------------------------
  # End usage limit detection
  # -----------------------------------------------------------------------

  # -----------------------------------------------------------------------
  # Parse exit signal
  # -----------------------------------------------------------------------
  if echo "$OUTPUT" | grep -q "RALPH_DONE"; then
    log "✓ Clean completion signal received for item $CURRENT_ITEM_ID"
    mark_done "$CURRENT_ITEM_ID"
    COMPLETED_IDS=$(echo "$COMPLETED_IDS" | jq --arg id "$CURRENT_ITEM_ID" '. + [$id]')
    write_state "running" "null" "clean"
    log "Marked $CURRENT_ITEM_ID as done"

    # Commit any staged changes
    git add -A 2>/dev/null || true
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -m "[ralph] $CURRENT_ITEM_ID: $ITEM_TITLE" 2>/dev/null || true
      log "Committed changes for $CURRENT_ITEM_ID"
    fi

  elif echo "$OUTPUT" | grep -q "RALPH_BLOCKED"; then
    REASON=$(echo "$OUTPUT" | grep -oP 'RALPH_BLOCKED:\K.*' | head -1 || echo "No reason provided")
    REASON=$(echo "$REASON" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')  # trim
    log "⚠ Item $CURRENT_ITEM_ID blocked: $REASON"
    mark_blocked "$CURRENT_ITEM_ID" "$REASON"
    BLOCKED_IDS=$(echo "$BLOCKED_IDS" | jq --arg id "$CURRENT_ITEM_ID" '. + [$id]')
    write_state "running" "null" "blocked"
    log "Marked $CURRENT_ITEM_ID as blocked — continuing to next item"

  elif echo "$OUTPUT" | grep -q "RALPH_NEEDS_HUMAN"; then
    MSG=$(echo "$OUTPUT" | grep -oP 'RALPH_NEEDS_HUMAN:\K.*' | head -1 || echo "Human input required")
    MSG=$(echo "$MSG" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')  # trim
    log "⛔ Loop paused — human input needed: $MSG"
    # Leave item as in_progress so it's resumed on next run
    CURRENT_ITEM_ID=""  # Clear so cleanup doesn't reset it
    write_state "paused_human" "null" "needs_human"
    notify_done "PAUSED — Human needed: $MSG"
    trap - EXIT
    exit 2

  else
    RETRY_COUNTS["$CURRENT_ITEM_ID"]=$(( ${RETRY_COUNTS["$CURRENT_ITEM_ID"]:-0} + 1 ))
    RETRIES=${RETRY_COUNTS["$CURRENT_ITEM_ID"]}
    log "⚠ No exit signal from Claude for item $CURRENT_ITEM_ID (attempt $RETRIES/$MAX_RETRIES)"

    if [[ $RETRIES -ge $MAX_RETRIES ]]; then
      log "✗ Item $CURRENT_ITEM_ID exceeded retry limit — marking as blocked"
      mark_blocked "$CURRENT_ITEM_ID" "Failed after $RETRIES attempts (no exit signal)"
      BLOCKED_IDS=$(echo "$BLOCKED_IDS" | jq --arg id "$CURRENT_ITEM_ID" '. + [$id]')
      write_state "running" "null" "error" "Item $CURRENT_ITEM_ID auto-blocked after $RETRIES retries"
    else
      log "  Resetting to pending — will retry (attempt $RETRIES/$MAX_RETRIES)"
      reset_to_pending "$CURRENT_ITEM_ID"
      write_state "running" "null" "error" "No exit signal received (attempt $RETRIES/$MAX_RETRIES)"
    fi
  fi

  # Clear current item (cleanup trap should not reset a completed/blocked item)
  CURRENT_ITEM_ID=""

  print_status
  sleep 3
done

# ---------------------------------------------------------------------------
# Max iterations reached
# ---------------------------------------------------------------------------
DONE_COUNT=$(count_done)
BLOCKED_COUNT=$(count_blocked)
TOTAL=$(count_total)
ELAPSED=$(( $(date +%s) - START_TIME ))
ELAPSED_MIN=$(( ELAPSED / 60 ))

SUMMARY="Max iterations ($MAX_ITERATIONS) reached. Done: $DONE_COUNT / $TOTAL | Blocked: $BLOCKED_COUNT | Time: ${ELAPSED_MIN}m"
log "============================================"
log "LIMIT REACHED: $SUMMARY"
print_status
write_state "limit_reached" "null" "clean"
notify_done "Ralph hit iteration limit — $SUMMARY"
trap - EXIT
exit 1
