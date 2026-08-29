#!/bin/bash
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_plain; then
  emit_blocked "I attempted to proceed but encountered a blocker." "Missing API key for external service"
  exit 0
fi

echo '{"type":"message_start","message":{"usage":{"input_tokens":12000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I attempted to proceed but encountered a blocker.\n\nRAUF_BLOCKED:Missing API key for external service"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":800}}'
echo '{"type":"message_stop"}'
