#!/bin/bash
# Records the agent's argv to $RECORD_ARGS_FILE (one token per line) so the
# verify suite can assert whether a `--model` flag reached the agent. Used by the
# --no-model / ignoreItemModel test (#38): with a Claude-only `item.model` alias,
# `--agent codex` forwards `--model opus`, while `--no-model` must strip it.
# shellcheck source=_emit.sh
source "$(cd "$(dirname "$0")" && pwd)/_emit.sh"
cat >/dev/null 2>&1 || true

if [ -n "${RECORD_ARGS_FILE:-}" ]; then
  printf '%s\n' "$@" >"$RECORD_ARGS_FILE"
fi

emit_done "Recorded agent args."
