#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$REPO_DIR/scripts/bin/ralph"
TARGET="$HOME/.local/bin/ralph"

mkdir -p "$HOME/.local/bin"
ln -sf "$SOURCE" "$TARGET"
echo "Linked: $TARGET -> $SOURCE"

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin"; then
  echo "Warning: ~/.local/bin is not on your PATH. Add it to your shell profile."
fi

# Check for old symlink
if [ -L /usr/local/bin/ralph ]; then
  echo "Note: Old symlink exists at /usr/local/bin/ralph. Remove with: sudo rm /usr/local/bin/ralph"
fi
