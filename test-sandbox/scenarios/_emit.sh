#!/bin/bash
# Shared signal-emission helpers for test-sandbox scenarios.
#
# A scenario carries ONE source of truth for its RAUF_* signal across BOTH output
# formats, selected by MOCK_AGENT_FORMAT:
#
#   plain  → human-readable plain text, with the RAUF_* signal on the final
#            non-empty line and NO stream-json telemetry whatsoever (no
#            message_start / content_block_* / message_delta). This exercises the
#            non-claude CLI-agent path where token/tool telemetry is absent.
#   stream → (default) Claude stream-json NDJSON, with the SAME signal carried in
#            the final text_delta — byte-compatible with the legacy claude path.
#
# Scenarios source this file and call emit_done / emit_blocked / emit_needs_human
# (or is_plain) so the two formats stay in lockstep. Scenarios that need bespoke
# stream-json (tool telemetry, sleeps, mid-stream banners) keep their stream body
# inline and branch on is_plain for the plain form.

# Resolve format once. Non-claude dispatchers export MOCK_AGENT_FORMAT=plain.
MOCK_AGENT_FORMAT="${MOCK_AGENT_FORMAT:-stream}"

# is_plain — true when emitting plain text (non-claude agents).
is_plain() {
  [ "$MOCK_AGENT_FORMAT" = "plain" ]
}

# _emit_signal <message> <signal>
# plain : "<message>" line then "<signal>" on its own final non-empty line.
# stream: a single text content block whose text is "<message>\n\n<signal>",
#         wrapped in the usual message_start/.../message_stop envelope.
_emit_signal() {
  local message="$1"
  local signal="$2"
  if is_plain; then
    printf '%s\n' "$message"
    printf '%s\n' "$signal"
  else
    echo '{"type":"message_start","message":{"usage":{"input_tokens":12000}}}'
    echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
    printf '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"%s\\n\\n%s"}}\n' "$message" "$signal"
    echo '{"type":"content_block_stop","index":0}'
    echo '{"type":"message_delta","usage":{"output_tokens":800}}'
    echo '{"type":"message_stop"}'
  fi
}

emit_done() {
  _emit_signal "${1:-All changes complete.}" "RAUF_DONE"
}

emit_blocked() {
  _emit_signal "${1:-I attempted to proceed but encountered a blocker.}" "RAUF_BLOCKED:${2:-Missing API key for external service}"
}

emit_needs_human() {
  _emit_signal "${1:-I need a decision.}" "RAUF_NEEDS_HUMAN:${2:-Should the API use REST or GraphQL?}"
}
