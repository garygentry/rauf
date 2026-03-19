#!/bin/bash
cat > /dev/null
echo '{"type":"message_start","message":{"usage":{"input_tokens":14000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I need a decision.\n\nRALPH_NEEDS_HUMAN:Should the API use REST or GraphQL?"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":600}}'
echo '{"type":"message_stop"}'
