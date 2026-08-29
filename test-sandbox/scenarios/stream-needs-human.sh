#!/bin/bash
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_plain; then
  emit_needs_human "I need a decision." "Should the API use REST or GraphQL?"
  exit 0
fi

echo '{"type":"message_start","message":{"usage":{"input_tokens":14000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I need a decision.\n\nRAUF_NEEDS_HUMAN:Should the API use REST or GraphQL?"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":600}}'
echo '{"type":"message_stop"}'
