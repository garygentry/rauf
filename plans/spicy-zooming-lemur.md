# Plan: Agent-Friendly Test Sandbox & Skill

## Context

The `test-sandbox/` directory was just created (previous plan) with mock Claude scripts and NDJSON scenarios. It works, but requires manual knowledge of PATH manipulation and environment variables. We need to make it:

1. **One-command usable** by agents and humans
2. **Self-verifying** with automated assertions for CI
3. **Discoverable** via a Claude Code skill that teaches agents how/when to use it
4. **Documented** in CLAUDE.md so every session knows about it

---

## Part 1: Fix `mock-claude` → `claude` Naming

The runner spawns `claude` via PATH lookup, but the file is currently named `mock-claude`. Rename it.

| File | Action |
|------|--------|
| `test-sandbox/mock-claude` | **Rename** → `test-sandbox/claude` |

No content changes needed — the script uses `$SCRIPT_DIR` to find scenarios.

---

## Part 2: `run.sh` — Single-Command Wrapper

**New file:** `test-sandbox/run.sh`

Takes scenario name as arg, handles everything:

```bash
#!/bin/bash
set -euo pipefail
SANDBOX_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SANDBOX_DIR/.." && pwd)"
SCENARIO="${1:-stream-done}"

# Validate scenario exists
if [ ! -f "$SANDBOX_DIR/scenarios/${SCENARIO}.sh" ]; then
  echo "ERROR: Unknown scenario '${SCENARIO}'"
  echo "Available: $(ls "$SANDBOX_DIR/scenarios/" | sed 's/.sh$//' | tr '\n' ' ')"
  exit 1
fi

# Reset, set PATH, run
bash "$SANDBOX_DIR/setup.sh"
export PATH="$SANDBOX_DIR:$REPO_ROOT/scripts/bin:$PATH"
export MOCK_CLAUDE_SCENARIO="$SCENARIO"

echo "=== Running scenario: $SCENARIO ==="
ralph loop run "$SANDBOX_DIR" --iterations 1 --timeout 1
EXIT_CODE=$?

# Show resulting state (backlog statuses, state.json, DONE file)
# Warn if iteration-status.json still exists
```

Agent usage: `bash test-sandbox/run.sh stream-blocked`

---

## Part 3: `verify.sh` — Automated Assertion Suite

**New file:** `test-sandbox/verify.sh`

Runs every scenario, checks expected post-run state. Exit code = failure count.

Assertion helpers using `jq`:
- `assert_item_status "001" "done"`
- `assert_no_iteration_status`
- `assert_done_file_exists`
- `assert_state_status "complete"`

Test cases:

| Scenario | Description | Key Assertions |
|----------|-------------|----------------|
| `stream-done` | RALPH_DONE marks item done | item 001 → done, no iteration-status.json, DONE file exists |
| `stream-blocked` | RALPH_BLOCKED marks item blocked | item 001 → blocked, no iteration-status.json |
| `stream-tools` | Multi-tool RALPH_DONE works | item 001 → done, no iteration-status.json |
| `slow-stream` | Slow stream completes | item 001 → done, no iteration-status.json |
| `stream-needs-human` | RALPH_NEEDS_HUMAN leaves in_progress | item 001 → in_progress, DONE file exists |

Requires `jq` — script checks for it at startup with a clear error message.

---

## Part 4: New Scenario — `stream-needs-human.sh`

**New file:** `test-sandbox/scenarios/stream-needs-human.sh`

Covers the third signal type not yet represented:

```bash
#!/bin/bash
cat > /dev/null
echo '{"type":"message_start","message":{"usage":{"input_tokens":14000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I need a decision.\n\nRALPH_NEEDS_HUMAN:Should the API use REST or GraphQL?"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":600}}'
echo '{"type":"message_stop"}'
```

---

## Part 5: Richer Test Project

Add minimal source files so the sandbox feels like a real project:

| File | Content |
|------|---------|
| `test-sandbox/src/index.ts` | Simple `greet(name)` function |
| `test-sandbox/package.json` | `{ "name": "test-sandbox", "private": true, "type": "module" }` |

Update `test-sandbox/backlog-template.json` with more realistic items:
- Item 001: "Add farewell function" (references `src/index.ts`)
- Item 002: "Add JSDoc comments" (depends on 001, `dependsOn: ["001"]`)
- Acceptance criteria reference the verify command (`echo all-pass`)

Also update `.ralph/backlog.json` via `setup.sh` (it already copies from template).

---

## Part 6: Claude Code Skill — `test-ralph-loop`

**New file:** `skills/test-ralph-loop/SKILL.md`

### Frontmatter

```yaml
---
name: test-ralph-loop
description: >
  Interactive testing of the ralph loop runner, stream parser, signal parser,
  or CLI loop commands using the test-sandbox with mock Claude scripts.
  Use this skill when working on code in packages/loop/ or
  packages/cli/src/loop-commands.ts and need to verify changes interactively.
  Trigger phrases: "test my loop changes", "run the sandbox", "try the mock claude",
  "verify stream parsing works", "test the runner". Also use proactively when
  you've modified runner.ts, stream-parser.ts, signal-parser.ts, claude-process.ts,
  status-line.ts, or loop-commands.ts and want to confirm behavior before committing.
---
```

### Body Outline

1. **What This Sandbox Is** — Self-contained ralph project with mock Claude scripts. Exercises the full pipeline (backlog → prompt → spawn → stream parse → signal → status files) without API credits.

2. **Quick Start** — Three commands: `run.sh`, `run.sh <scenario>`, `verify.sh`

3. **Available Scenarios** — Table of all 5 scenarios with signal type, tools emitted, timing, and what each tests.

4. **What to Observe** — Guide to reading output:
   - Signal parsing: expect `signal: done/blocked/needs_human`
   - Tool activity: count `llm_tool_activity` events against scenario script
   - Token counts: values in events should match scenario JSON
   - Backlog state: item statuses after completion
   - Transient files: iteration-status.json must be absent after clean run

5. **The Reset-Run-Observe-Verify Cycle** — Standard workflow, plus when to run setup.sh separately for debugging.

6. **Creating Custom Scenarios** — Template for a new scenario script with key rules:
   - First line: `cat > /dev/null` (drain stdin)
   - NDJSON must match Claude streaming API format
   - Signal in last `text_delta` as final non-empty line
   - Tool use needs `content_block_start` with `type: "tool_use"` + `name`
   - `sleep` between events for timing tests

7. **Scenario Design Patterns** — Recipes for testing new signal types, stuck detection, token counting, error handling.

8. **Relationship to Unit Tests** — Sandbox is NOT a replacement. Use when: e2e behavior is wrong despite passing unit tests, observing full event flow, verifying CLI output, prototyping before writing tests.

---

## Part 7: CLAUDE.md Addition

Add a brief section after "Development Commands":

```markdown
## Test Sandbox

`test-sandbox/` provides a self-contained ralph project with mock Claude scripts for testing the loop runner without API access.

    bash test-sandbox/run.sh                  # Default scenario (stream-done)
    bash test-sandbox/run.sh stream-blocked   # Specific scenario
    bash test-sandbox/verify.sh               # All scenarios with assertions

When modifying `packages/loop/` or loop CLI commands, use the sandbox to verify changes. See the `test-ralph-loop` skill for detailed guidance.
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `test-sandbox/mock-claude` → `test-sandbox/claude` | **Rename** |
| `test-sandbox/run.sh` | **Create** — single-command wrapper |
| `test-sandbox/verify.sh` | **Create** — CI assertion suite |
| `test-sandbox/scenarios/stream-needs-human.sh` | **Create** — needs_human scenario |
| `test-sandbox/src/index.ts` | **Create** — minimal source file |
| `test-sandbox/package.json` | **Create** — project manifest |
| `test-sandbox/backlog-template.json` | **Modify** — realistic items with dependsOn |
| `test-sandbox/.ralph/backlog.json` | **Regenerated** by setup.sh from template |
| `skills/test-ralph-loop/SKILL.md` | **Create** — agent skill |
| `CLAUDE.md` | **Modify** — add sandbox section |

---

## Verification

1. `bash test-sandbox/run.sh` — default scenario completes, shows item 001 as done
2. `bash test-sandbox/run.sh stream-blocked` — item 001 marked blocked
3. `bash test-sandbox/run.sh stream-needs-human` — item 001 stays in_progress, DONE file mentions needs_human
4. `bash test-sandbox/verify.sh` — exits 0 (all scenarios pass assertions)
5. `pnpm test` — existing tests + stream-integration tests still pass
6. After any sandbox run, `iteration-status.json` does NOT exist
