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
  OUTPUT=$(echo "$PROMPT" | claude -p \
    --dangerously-skip-permissions \
    --output-format text \
    $MODEL_FLAG \
    2>"$CLAUDE_STDERR_FILE")
  CLAUDE_EXIT=$?
  CLAUDE_STDERR=$(cat "$CLAUDE_STDERR_FILE")
  rm -f "$CLAUDE_STDERR_FILE"

  # Log condensed output (first 80 lines)
  echo "$OUTPUT" | head -80 >> "$LOG"
  if [[ -n "$CLAUDE_STDERR" ]]; then
    echo "[claude stderr] $(echo "$CLAUDE_STDERR" | head -5)" >> "$LOG"
  fi

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
