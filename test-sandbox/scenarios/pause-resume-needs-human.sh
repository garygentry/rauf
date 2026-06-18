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

# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"

PROMPT="$(cat)"
PROOF_FILE="${MOCK_ANSWER_PROOF_FILE:-$GIT_WORK_TREE/.rauf/answer-proof.txt}"

if printf '%s\n' "$PROMPT" | grep -q "Human's Answer to Your Previous Question"; then
  # Capture the heading + the injected answer so the test can assert the answer
  # text round-tripped through `resume --answer` into the prompt.
  printf '%s\n' "$PROMPT" | grep -A2 "Human's Answer to Your Previous Question" >"$PROOF_FILE"
  emit_done "Got the human answer; finishing the item."
else
  emit_needs_human "I need a decision before I can proceed." "Should the API use REST or GraphQL?"
fi
