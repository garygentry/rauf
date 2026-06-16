#!/bin/bash
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_plain; then
  sleep 1
  emit_done "Implementation complete."
  exit 0
fi

echo '{"type":"message_start","message":{"usage":{"input_tokens":18000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Starting work on the task...\n\n"}}'
echo '{"type":"content_block_stop","index":0}'
sleep 2
echo '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"Read"}}'
sleep 2
echo '{"type":"content_block_stop","index":1}'
sleep 2
echo '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","name":"Edit"}}'
sleep 2
echo '{"type":"content_block_stop","index":2}'
sleep 2
echo '{"type":"content_block_start","index":3,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"Implementation complete.\n\nRAUF_DONE"}}'
echo '{"type":"content_block_stop","index":3}'
echo '{"type":"message_delta","usage":{"output_tokens":2000}}'
echo '{"type":"message_stop"}'
