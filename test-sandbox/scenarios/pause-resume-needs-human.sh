#!/bin/bash
# Two-phase scenario for `--pause-on-needs-human` + `resume --answer` (item 010).
#
# A SINGLE scenario script serves BOTH iterations because MOCK_CLAUDE_SCENARIO
# stays constant across the pause and the resume relaunch. The mock branches on
# the prompt it receives (on stdin):
#
#   Phase 1 — no answer in the prompt yet → emit RAUF_NEEDS_HUMAN. Run with
#     --pause-on-needs-human, the loop sets the item aside then HALTS in
#     paused_human (emitting needs_human then loop_paused) and exits the
#     distinct needs-human exit code.
#   Phase 2 — `resume --answer <id> "<text>"` re-queued the item with the answer
#     attached, so buildPrompt now includes the
#     "## Human's Answer to Your Previous Question" section. The mock detects it,
#     records the injected text to a proof file (proving the answer round-tripped
#     into the prompt), and emits RAUF_DONE so the item completes (and the
#     runner auto-clears humanAnswer).
#
# The proof file defaults under the sandbox .rauf/ (kept out of git via
# setup.sh's info/exclude) and is overridable with MOCK_ANSWER_PROOF_FILE.

PROMPT="$(cat)"
PROOF_FILE="${MOCK_ANSWER_PROOF_FILE:-$GIT_WORK_TREE/.rauf/answer-proof.txt}"

echo '{"type":"message_start","message":{"usage":{"input_tokens":13000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'

if printf '%s\n' "$PROMPT" | grep -q "Human's Answer to Your Previous Question"; then
  # Capture the heading + the injected answer so the test can assert the answer
  # text round-tripped through `resume --answer` into the prompt.
  printf '%s\n' "$PROMPT" | grep -A2 "Human's Answer to Your Previous Question" >"$PROOF_FILE"
  echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Got the human answer; finishing the item.\n\nRAUF_DONE"}}'
else
  echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I need a decision before I can proceed.\n\nRAUF_NEEDS_HUMAN:Should the API use REST or GraphQL?"}}'
fi

echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":700}}'
echo '{"type":"message_stop"}'
