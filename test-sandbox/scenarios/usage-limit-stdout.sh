#!/bin/bash
# Usage-limit death where the session-limit banner arrives ONLY in the
# reconstructed stdout stream (stream-json), never in stderr, followed by a
# fast non-zero exit. This is the incident's failure mode: the runner must
# detect the banner in signalText (not just stderr), reset the item to
# pending, and pause — NOT fall through to signal 'none' and block.
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_plain; then
  # Usage-banner detection is claude-only (gated on checkUsage); a non-claude
  # agent simply prints the banner as plain text and dies non-zero.
  printf "%s\n" "You've hit your session limit · resets 5:30pm"
  exit 1
fi

echo '{"type":"message_start","message":{"usage":{"input_tokens":4000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"You'"'"'ve hit your session limit · resets 5:30pm"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":40}}'
echo '{"type":"message_stop"}'
exit 1
