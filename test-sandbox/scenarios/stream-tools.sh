#!/bin/bash
cat > /dev/null
echo '{"type":"message_start","message":{"usage":{"input_tokens":20000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me read and modify the files.\n\n"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"Read"}}'
sleep 0.2
echo '{"type":"content_block_stop","index":1}'
echo '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","name":"Glob"}}'
sleep 0.2
echo '{"type":"content_block_stop","index":2}'
echo '{"type":"content_block_start","index":3,"content_block":{"type":"tool_use","name":"Edit"}}'
sleep 0.2
echo '{"type":"content_block_stop","index":3}'
echo '{"type":"content_block_start","index":4,"content_block":{"type":"tool_use","name":"Bash"}}'
sleep 0.2
echo '{"type":"content_block_stop","index":4}'
echo '{"type":"content_block_start","index":5,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":5,"delta":{"type":"text_delta","text":"All changes applied and verified.\n\nRALPH_DONE"}}'
echo '{"type":"content_block_stop","index":5}'
echo '{"type":"message_delta","usage":{"output_tokens":3500}}'
echo '{"type":"message_stop"}'
