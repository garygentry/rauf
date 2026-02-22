## Claude Code Usage Management for Shell Automation

### The Limit Structure (as of Aug 2025)

You're dealing with a **dual-layer** system:
- **5-hour rolling window** — resets at a specific timestamp, not on the clock
- **7-day weekly cap** — secondary ceiling; resets every 7 days

Both limits apply simultaneously. Shared across claude.ai web/desktop and Claude Code.

---

## 1. Determining Usage Status (% consumed)

There's an **undocumented but working** Anthropic API endpoint that Claude Code itself uses:

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <oauth_access_token>
anthropic-beta: oauth-2025-04-20
```

**Response:**
```json
{
  "five_hour": {
    "utilization": 37.0,
    "resets_at": "2026-02-21T04:59:59.000000+00:00"
  },
  "seven_day": {
    "utilization": 26.0,
    "resets_at": "2026-02-26T14:59:59.771647+00:00"
  },
  "seven_day_sonnet": {
    "utilization": 1.0,
    "resets_at": "2026-02-27T20:59:59.771655+00:00"
  },
  "seven_day_opus": null,
  "extra_usage": {
    "is_enabled": false,
    "monthly_limit": null,
    "used_credits": null,
    "utilization": null
  }
}
```

`utilization` is a 0–100 percentage value.

**Getting the OAuth token (macOS):**
```bash
CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
TOKEN=$(echo "$CREDS" | jq -r '.claudeAiOauth.accessToken // empty')
```

On Linux, credentials are stored in `~/.config/claude-code/credentials.json` (check your platform — the keychain approach is macOS-specific).

**Gotchas to be aware of:**
- The keychain token can go stale; Claude Code refreshes it in-memory but doesn't write back to keychain. If you get auth errors, delete the keychain entry and restart Claude Code.
- Tokens from `claude setup-token` won't work here — they lack `user:profile` scope.
- The built-in `/status` command in interactive mode also shows this, but isn't useful for scripting.

---

## 2. Querying Reset Times

Both `resets_at` fields in the response above give you the exact UTC timestamp. For your shell wrapper:

```bash
get_usage() {
  local token="$1"
  curl -s "https://api.anthropic.com/api/oauth/usage" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "Content-Type: application/json"
}

USAGE=$(get_usage "$TOKEN")
FIVE_HR_PCT=$(echo "$USAGE" | jq -r '.five_hour.utilization // 0')
FIVE_HR_RESET=$(echo "$USAGE" | jq -r '.five_hour.resets_at // ""')
SEVEN_DAY_PCT=$(echo "$USAGE" | jq -r '.seven_day.utilization // 0')
SEVEN_DAY_RESET=$(echo "$USAGE" | jq -r '.seven_day.resets_at // ""')

# Convert reset time to seconds until reset
RESET_EPOCH=$(date -d "$FIVE_HR_RESET" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%S" "${FIVE_HR_RESET%%+*}" -u +%s)
NOW_EPOCH=$(date +%s)
SECONDS_UNTIL_RESET=$((RESET_EPOCH - NOW_EPOCH))
```

---

## 3. Gracefully Handling Usage Cap Errors

When `claude -p` hits the cap, it exits with **exit code 1** and writes an error message to stderr. The message text varies but contains phrases like "usage limit", "rate limit", or "Claude AI Usage Limit Reached". There's no standardized exit code specifically for limit exhaustion vs other errors.

**Recommended pattern for your task-loop shell app:**

```bash
#!/usr/bin/env bash

MAX_RETRIES=3
RETRY_DELAY=300  # seconds to wait before probing again

# Pre-flight check before running a task
check_usage() {
  local threshold="${1:-85}"  # warn/pause at 85%
  
  local creds token usage five_pct seven_pct
  creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
  token=$(echo "$creds" | jq -r '.claudeAiOauth.accessToken // empty')
  
  [[ -z "$token" ]] && return 0  # can't check, proceed optimistically
  
  usage=$(curl -sf "https://api.anthropic.com/api/oauth/usage" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20")
  
  [[ -z "$usage" ]] && return 0  # API unavailable, proceed
  
  five_pct=$(echo "$usage" | jq -r '.five_hour.utilization // 0' | cut -d. -f1)
  seven_pct=$(echo "$usage" | jq -r '.seven_day.utilization // 0' | cut -d. -f1)
  five_reset=$(echo "$usage" | jq -r '.five_hour.resets_at // ""')
  
  if [[ "$five_pct" -ge 100 || "$seven_pct" -ge 100 ]]; then
    echo "LIMIT_EXHAUSTED: 5hr=${five_pct}% 7day=${seven_pct}% resets_at=${five_reset}"
    return 1
  elif [[ "$five_pct" -ge "$threshold" ]]; then
    echo "WARN: 5hr usage at ${five_pct}%, approaching limit (resets ${five_reset})"
  fi
  return 0
}

# Wrapper for claude -p with retry/backoff
run_claude() {
  local task="$1"
  local attempt=0
  
  while [[ $attempt -lt $MAX_RETRIES ]]; do
    # Pre-check usage
    if ! check_usage 90; then
      echo "Usage cap hit. Waiting ${RETRY_DELAY}s before retry..."
      sleep "$RETRY_DELAY"
      ((attempt++))
      continue
    fi
    
    # Run claude, capture stderr for limit detection
    local stderr_file
    stderr_file=$(mktemp)
    
    if claude -p "$task" 2>"$stderr_file"; then
      rm -f "$stderr_file"
      return 0
    fi
    
    local exit_code=$?
    local stderr_content
    stderr_content=$(cat "$stderr_file")
    rm -f "$stderr_file"
    
    # Detect limit-related failures vs real errors
    if echo "$stderr_content" | grep -qi "usage limit\|rate limit\|too many requests\|529\|overloaded"; then
      echo "Rate/usage limit detected. Waiting ${RETRY_DELAY}s..."
      sleep "$RETRY_DELAY"
      ((attempt++))
    else
      # Non-limit error — fail immediately
      echo "Claude error (exit $exit_code): $stderr_content" >&2
      return $exit_code
    fi
  done
  
  echo "Max retries ($MAX_RETRIES) exceeded for task." >&2
  return 1
}

# Task loop
for task in "${TASKS[@]}"; do
  echo "Running: $task"
  if run_claude "$task"; then
    echo "✓ Done: $task"
  else
    echo "✗ Failed: $task — logging and continuing"
    echo "$task" >> failed_tasks.log
  fi
done
```

---

## Summary of Options

| Goal | Best Approach |
|---|---|
| Check % usage | `GET /api/oauth/usage` with OAuth token from keychain |
| Get reset time | `resets_at` field in same API response |
| Pre-flight gating | Poll usage API before each task, pause if >85–90% |
| React to cap errors | Parse stderr from `claude -p` for "usage limit" keywords + retry with backoff |
| Proactive scheduling | Calculate seconds until reset from `resets_at`, sleep until then |

The biggest caveat is that the usage API is undocumented/unofficial, so it could change without notice. Worth building with a fallback that just lets requests run and catches errors reactively if the API is unavailable.