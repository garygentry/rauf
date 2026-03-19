## The three layers of programmatic observability in Claude Code

There are three distinct mechanisms, each operating at a different level. For a ralph loop, the ideal architecture combines all three.

### Layer 1 — CLI streaming output (`-p` with `--output-format`)

This is the most direct approach: pipe `claude -p` output and parse it as it flows.

**The three output modes:**

`--output-format text` is the default. Returns raw text on stdout. Useful for simple fire-and-forget invocations where you only need the final answer.

`--output-format json` wraps the response in a structured object with session metadata, token usage, and the text result in the `.result` field. The session ID is available at `.session_id`.

`--output-format stream-json` is the most powerful option. This emits newline-delimited JSON for real-time streaming, where each line is a JSON object representing an event. Use it with `--verbose` and `--include-partial-messages` to receive tokens as they're generated.

**Streaming tokens in real time:**

```bash
claude -p "Your task" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages | \
  jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'
```

To enable real-time token streaming, the key flags are `--include-partial-messages` and `--verbose` added to the Claude CLI invocation. You then handle `content_block_delta` events with `text_delta` types in the response parser.

**What's in the stream-json event stream:**

Each line is one of these event types (following the Claude API SSE model):

- `message_start` — contains initial `usage` with `input_tokens`
- `content_block_start` — either a `text` block or a `tool_use` block starting
- `content_block_delta` — either `text_delta` (text token) or `input_json_delta` (tool input streaming)
- `content_block_stop` — block complete
- `message_delta` — cumulative token counts
- `message_stop` — final
- `system/api_retry` — emitted before retrying when an API request fails with a retryable error — useful for surfacing retry progress or implementing custom backoff logic

**Session continuity across loop turns:**

Capture the session ID from the first call and pass it with `--session-id` on subsequent calls to continue in the same session. Each session preserves the full exchange history, which increases token consumption with each turn — on average, a 5-turn session consumes about 3× more tokens than a single call.

```bash
SESSION_ID=$(claude -p "Start the task" --output-format json | jq -r '.session_id')
claude -p "Continue from where you left off" --resume "$SESSION_ID" --output-format stream-json
```

**Structured JSON output with schema validation:**

Use `--output-format json` with `--json-schema` and a JSON Schema definition to get output conforming to a specific schema. The response includes metadata about the request (session ID, usage, etc.) with the structured output in the `structured_output` field.

**Exit codes:**

The process exit code follows standard Unix conventions: `0` indicates success, any other code signals an error. Your loop wrapper can branch on this immediately.

---

### Layer 2 — Agent SDK (Python/TypeScript)

If your ralph loop calls Claude Code as a library rather than a subprocess, the Agent SDK gives you a far richer event model.

The SDK yields five message types covering the full agent loop lifecycle: `SystemMessage` (session init), `AssistantMessage` (complete responses with tool calls), `StreamEvent` (incremental tokens when `include_partial_messages` is enabled), `ResultMessage` (final result with cost, token usage, and session ID), plus `CompactBoundaryMessage` when context history is compacted.

**The ResultMessage is the most valuable for a loop:**

All result subtypes carry `total_cost_usd`, `usage`, `num_turns`, and `session_id` so you can track cost and resume even after errors. The result also includes a `stop_reason` field — common values are `end_turn` (model finished normally), `max_tokens` (hit output token limit), and `refusal` (model declined the request).

**Streaming with partial messages (Python):**

```python
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage
from claude_agent_sdk.types import StreamEvent

options = ClaudeAgentOptions(
    include_partial_messages=True,
    allowed_tools=["Read", "Bash", "Write"],
)

async for message in query(prompt="Your task", options=options):
    if isinstance(message, StreamEvent):
        event = message.event
        # Tool starting
        if event.get("type") == "content_block_start":
            if event.get("content_block", {}).get("type") == "tool_use":
                tool_name = event["content_block"]["name"]
                print(f"[→ {tool_name}]")
        # Text token
        elif event.get("type") == "content_block_delta":
            if event["delta"].get("type") == "text_delta":
                print(event["delta"]["text"], end="", flush=True)
    elif isinstance(message, ResultMessage):
        print(f"\nDone. Turns: {message.num_turns}, Cost: ${message.total_cost_usd:.4f}")
```

**The TypeScript SDK exposes additional observability events** beyond what Python currently supports. These include `SDKTaskNotificationMessage` (containing `total_tokens`, `tool_uses`, `duration_ms`, and a summary per task), `SDKHookStartedMessage`, `SDKHookProgressMessage` (with `stdout`/`stderr` from running hooks), and `SDKCompactBoundaryMessage` (with `pre_tokens` count before compaction).

---

### Layer 3 — Hooks (the most powerful real-time status channel)

This is what makes the ralph loop architecture uniquely powerful. Hooks are user-defined shell commands that execute at specific points in Claude Code's lifecycle. They provide deterministic control over Claude Code's behavior, ensuring certain actions always happen rather than relying on the LLM to choose to run them.

**The full lifecycle event set:**

Available hook events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`, `Setup`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`.

**The hook communication model:**

Each hook shell command receives a JSON payload on stdin containing the session ID, tool name, tool input, working directory, transcript path, and (for PostToolUse) the tool response. Exit code `0` means success and execution continues. Exit code `2` signals a blocking error — for `PreToolUse` this blocks the tool call, and the stderr text is fed back to Claude as an error message. Any other non-zero exit code is a non-blocking error — stderr is shown in verbose mode but execution continues.

**Hooks as a real-time status bus for ralph:**

This pattern — from the `disler/claude-code-hooks-multi-agent-observability` repo — is directly applicable to your loop:

Each hook sends a POST event to a local HTTP server, which stores events in SQLite and broadcasts via WebSocket to a monitoring client. The architecture is: Claude Agents → Hook Scripts → HTTP POST → Bun Server → SQLite → WebSocket → Vue Client.

For ralph specifically, you could simplify this to: hook scripts write structured JSON to a named pipe or a `state.json` file that your ralph shell loop tails or polls — no web server needed.

**Hook data available per event:**

For `PreToolUse` / `PostToolUse`:

```json
{
  "session_id": "abc123",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.ts", "content": "..." },
  "tool_response": { "filePath": "/path/to/file.ts", "success": true }
}
```

Use `${CLAUDE_SESSION_ID}` in hook commands to access the current session ID (as of v2.1.9+).

**Stop hook — your loop completion gate:**

A `Stop` hook with `{"decision": "block", "reason": "..."}` prevents Claude from stopping. Combined with a reason, this is highly effective for ensuring complex tasks are fully completed before the loop exits. This is directly analogous to the `EXIT_SIGNAL` detection logic ralph already does — but it's deterministic rather than text-pattern-based.

**PreCompact hook:**

The `PreCompact` hook fires before context compaction and includes the `pre_tokens` count in the backup filename for tracking. This gives you visibility into when Claude is approaching context limits — a critical signal for loop health.

---

### Recommended ralph loop architecture

Here's how to wire these together:

```
┌─────────────────────────────────────────────────┐
│                  ralph.sh loop                   │
│                                                  │
│  claude -p "$PROMPT"                             │
│    --output-format stream-json                   │
│    --verbose                                     │
│    --include-partial-messages                    │
│    --session-id "$SESSION_ID"                    │
│    --allowedTools "Bash,Read,Write,Edit"         │
│    2>&1 | tee >(parse_stream_events.sh)         │
│                                                  │
│  parse_stream_events.sh:                         │
│    - extract text deltas → live progress         │
│    - extract tool_use events → action log        │
│    - extract message_delta usage → token count   │
│    - detect api_retry events → backoff signals  │
│    - write state.json updates                    │
└────────────────────┬────────────────────────────┘
                     │
          .claude/settings.json hooks
                     │
        ┌────────────▼─────────────┐
        │   PreToolUse hook        │  → validate/log/block
        │   PostToolUse hook       │  → write to state.json
        │   PostToolUseFailure     │  → trigger error handling
        │   Stop hook              │  → enforce EXIT_SIGNAL gate
        │   PreCompact hook        │  → record context pressure
        │   TaskCompleted hook     │  → signal loop to advance
        └──────────────────────────┘
```

**Key flags reference:**

| Flag                          | Purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `--output-format stream-json` | Real-time NDJSON event stream                     |
| `--verbose`                   | Required to emit stream events                    |
| `--include-partial-messages`  | Token-level text deltas                           |
| `--session-id <id>`           | Resume a specific session                         |
| `--continue`                  | Resume most recent session                        |
| `--max-turns <n>`             | Hard cap on agentic turns                         |
| `--allowedTools <list>`       | Tools that auto-approve (skip permission prompts) |
| `--json-schema <schema>`      | Force structured output                           |
| `--output-format json`        | Final JSON with usage/session metadata            |

**What you can extract from stream-json for ralph's state.json:**

- `input_tokens` + `output_tokens` from `message_start` / `message_delta` events
- Tool names as they're invoked (from `content_block_start` with `type: "tool_use"`)
- `stop_reason` at end of each turn
- `session_id` for turn continuity
- API retry events for health monitoring

The combination of `stream-json` parsing for real-time token/tool visibility + `Stop` hooks for completion gating + `PostToolUse` hooks for state updates gives you deterministic, observable loop control without relying on text parsing of Claude's output.
