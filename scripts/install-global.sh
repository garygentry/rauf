#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$REPO_DIR/scripts/bin/rauf"
TARGET="$HOME/.local/bin/rauf"

mkdir -p "$HOME/.local/bin"
ln -sf "$SOURCE" "$TARGET"
echo "Linked: $TARGET -> $SOURCE"

# Remove the old pre-rename `ralph` symlink (hard cut-over — a stale
# old-protocol binary on PATH would shadow the new `rauf`).
if [ -L "$HOME/.local/bin/ralph" ]; then
  rm -f "$HOME/.local/bin/ralph"
  echo "Removed old symlink: $HOME/.local/bin/ralph"
fi

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin"; then
  echo "Warning: ~/.local/bin is not on your PATH. Add it to your shell profile."
fi

# Check for old symlink
if [ -L /usr/local/bin/ralph ]; then
  echo "Note: Old symlink exists at /usr/local/bin/ralph. Remove with: sudo rm /usr/local/bin/ralph"
fi
