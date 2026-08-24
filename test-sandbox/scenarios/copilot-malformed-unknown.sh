#!/bin/bash
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat > /dev/null

if is_copilot; then
  echo 'not-json'
  echo '{"type":"future.unknown","data":{"content":"RAUF_DONE"}}'
  echo '{broken'
else
  printf '%s\n' "malformed output"
fi
exit 1
