#!/bin/bash
cat > /dev/null
echo '{"type":"message_start","message":{"usage":{"input_tokens":12000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I attempted to proceed but encountered a blocker.\n\nRALPH_BLOCKED:Missing API key for external service"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":800}}'
echo '{"type":"message_stop"}'
