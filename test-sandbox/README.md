# Test Rauf Loop — Sandbox Guide

## What This Sandbox Is

`test-sandbox/` is a self-contained rauf project with mock Claude scripts that exercise the full loop pipeline:

**backlog → prompt → spawn → stream parse → signal → status files**

No API credits are used. Mock agent dispatchers read `$MOCK_AGENT_SCENARIO` and replay sanitized
scenario output. Claude emits its stream JSON shape, Copilot emits the captured Copilot JSONL shape,
and generic preset agents emit plain text.

## Quick Start

```bash
# Run the default scenario (stream-done)
bash test-sandbox/run.sh

# Run a specific scenario
bash test-sandbox/run.sh stream-blocked

# Run all scenarios with automated assertions
bash test-sandbox/verify.sh
```

## Available Scenarios

| Scenario                    | Signal                           | Tools Emitted          | Timing       | Tests                                                                                                                                                                     |
| --------------------------- | -------------------------------- | ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream-done`               | `RAUF_DONE`                      | Read, Edit             | 300ms sleeps | Basic done flow with tool activity                                                                                                                                        |
| `stream-blocked`            | `RAUF_BLOCKED`                   | None                   | Instant      | Blocked signal parsing, reason extraction                                                                                                                                 |
| `stream-tools`              | `RAUF_DONE`                      | Read, Glob, Edit, Bash | 200ms sleeps | Multi-tool activity, done after heavy tool use                                                                                                                            |
| `slow-stream`               | `RAUF_DONE`                      | Read, Edit             | 2s sleeps    | Slow stream completion, timing resilience                                                                                                                                 |
| `stream-needs-human`        | `RAUF_NEEDS_HUMAN`               | None                   | Instant      | Needs-human signal: item set aside (blocked+needsHuman), loop continues                                                                                                   |
| `pause-resume-needs-human`  | `RAUF_NEEDS_HUMAN` → `RAUF_DONE` | None                   | Instant      | Two-phase: `--pause-on-needs-human` halt (paused_human + loop_paused + exit 6), then `resume --answer` injects the answer, the next prompt carries it, the item completes |
| `copilot-no-signal`         | None                             | None                   | Instant      | Valid Copilot JSONL without assistant completion                                                                                                                          |
| `copilot-malformed-unknown` | None                             | None                   | Instant      | Malformed and unknown Copilot records cannot complete an item                                                                                                             |
| `copilot-auth`              | None                             | None                   | Instant      | Captured authentication-class stderr and nonzero exit                                                                                                                     |
| `copilot-invalid-model`     | None                             | None                   | Instant      | Captured invalid-model stderr and nonzero exit                                                                                                                            |
| `copilot-permission`        | None                             | None                   | Instant      | Captured in-band permission denial with exit 0                                                                                                                            |

## What to Observe

After running a scenario, check:

- **Signal parsing**: The CLI output should show the parsed signal (done/blocked/needs_human)
- **Tool activity**: Count `llm_tool_activity` events against what the scenario script emits
- **Token counts**: Values in token events should match the scenario's JSON (`input_tokens`, `output_tokens`)
- **Backlog state**: Item statuses in `.rauf/backlog.json` after completion
- **Transient files**: `iteration-status.json` must be absent after a clean run — the runner clears it
- **DONE file**: `.rauf/DONE` should exist and contain the appropriate summary
- **State file**: `.rauf/state.json` should reflect the final loop state

## The Reset-Run-Observe-Verify Cycle

Standard workflow:

1. **Reset**: `bash test-sandbox/setup.sh` (run.sh does this automatically)
2. **Run**: `bash test-sandbox/run.sh <scenario>`
3. **Observe**: Read the CLI output, check file state
4. **Verify**: `bash test-sandbox/verify.sh` for automated assertions

Run `setup.sh` separately when debugging — it lets you inspect state between manual runs without auto-reset.

## Creating Custom Scenarios

Create a new file in `test-sandbox/scenarios/<name>.sh`:

```bash
#!/bin/bash
# First line: drain stdin (the prompt from the runner)
cat > /dev/null

# message_start with input token count
echo '{"type":"message_start","message":{"usage":{"input_tokens":10000}}}'

# Text block
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Working on it...\n\n"}}'
echo '{"type":"content_block_stop","index":0}'

# Tool use (optional) — needs content_block_start with type:"tool_use" and name
echo '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"Read"}}'
sleep 0.3  # simulate tool execution time
echo '{"type":"content_block_stop","index":1}'

# Final text block with signal as last non-empty line
echo '{"type":"content_block_start","index":2,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Done.\n\nRAUF_DONE"}}'
echo '{"type":"content_block_stop","index":2}'

# message_delta with output token count
echo '{"type":"message_delta","usage":{"output_tokens":1500}}'
echo '{"type":"message_stop"}'
```

Key rules:

- First line must be `cat > /dev/null` to drain stdin
- NDJSON must match Claude streaming API format
- Signal goes in the last `text_delta` as the final non-empty line
- Tool use needs `content_block_start` with `"type": "tool_use"` and `"name"`
- Use `sleep` between events for timing tests

Make the file executable: `chmod +x test-sandbox/scenarios/<name>.sh`

## Scenario Design Patterns

**Testing a new signal type**: Copy `stream-done.sh`, change the signal in the last `text_delta`.

**Testing stuck detection**: Add long `sleep` values (>5 minutes) between events.

**Testing token counting**: Set specific values in `message_start` and `message_delta` usage fields, then verify the runner's token events match.

**Testing error handling**: Have the script exit with a non-zero code, or emit malformed JSON.

**Branching on the prompt (multi-iteration flows)**: A scenario can read the prompt into a variable (`PROMPT="$(cat)"` instead of `cat > /dev/null`) and branch its emitted signal on the prompt's content. This lets ONE scenario serve multiple iterations across a pause/resume — e.g. `pause-resume-needs-human.sh` emits `RAUF_NEEDS_HUMAN` until `resume --answer` injects the "Human's Answer" section into the prompt, then emits `RAUF_DONE`. It can also record evidence to a file (kept out of git via `setup.sh`'s `info/exclude`) so `verify.sh` can assert what the prompt contained.

## Relationship to Unit Tests

The sandbox is **not a replacement** for unit tests in `packages/loop/`. Use it when:

- E2e behavior is wrong despite passing unit tests
- You need to observe the full event flow end-to-end
- You're verifying CLI output formatting
- You're prototyping a change before writing proper tests
- You want to visually confirm status file state

Unit tests (`stream-parser.test.ts`, `stream-integration.test.ts`) remain the primary correctness guarantee. The sandbox is for interactive exploration and integration confidence.
