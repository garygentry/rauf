#!/bin/bash
# Fast infra death: a non-zero exit within INFRA_FAST_MS with NO usage-limit
# banner anywhere (neither stderr nor the reconstructed stdout stream). The
# classifier must tag this infra_error (not genuine_retry, not usage_limited).
# Repeated identically, these trip the circuit breaker (item 008), halting the
# loop before it grinds through the whole iteration budget. uncountIteration
# (item 007) means the iteration counter never advances on infra deaths, so the
# breaker — not maxIterations — is what terminates the run.
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_plain; then
  printf '%s\n' "starting work"
  exit 1
fi

echo '{"type":"message_start","message":{"usage":{"input_tokens":3000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"starting work"}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"message_delta","usage":{"output_tokens":8}}'
echo '{"type":"message_stop"}'
exit 1
