#!/bin/bash
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_plain; then
  emit_done "All changes complete."
  exit 0
fi

echo '{"type":"message_start","message":{"usage":{"input_tokens":15000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Analyzing the task...\n\n"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"Read"}}'
sleep 0.3
echo '{"type":"content_block_stop","index":1}'
echo '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","name":"Edit"}}'
sleep 0.3
echo '{"type":"content_block_stop","index":2}'
echo '{"type":"content_block_start","index":3,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"All changes complete.\n\nRAUF_DONE"}}'
echo '{"type":"content_block_stop","index":3}'
echo '{"type":"message_delta","usage":{"output_tokens":2500}}'
echo '{"type":"message_stop"}'
