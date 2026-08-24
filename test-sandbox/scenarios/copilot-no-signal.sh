#!/bin/bash
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_copilot; then
  echo '{"type":"session.start","data":{"sessionId":"sandbox"}}'
  echo '{"type":"result","usage":{"consumption":1}}'
else
  printf '%s\n' "work ended without a control signal"
fi
