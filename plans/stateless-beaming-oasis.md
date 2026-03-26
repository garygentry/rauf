# Move global ralph command to ~/.local/bin

## Context

The global `ralph` command is currently a symlink at `/usr/local/bin/ralph` (created with sudo, owned by root) pointing to `scripts/bin/ralph` in the repo. This works but requires root and is undocumented. We'll move to `~/.local/bin` (already on PATH) and add a reproducible install script.

## Steps

### 1. Create `scripts/install-global.sh`

A script that:
- Creates `~/.local/bin` if it doesn't exist
- Symlinks `scripts/bin/ralph` → `~/.local/bin/ralph`
- Warns if `~/.local/bin` is not on PATH
- Warns if an existing `/usr/local/bin/ralph` symlink exists and suggests removing it

```bash
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
```

### 2. Remove old symlink

```bash
sudo rm /usr/local/bin/ralph
```

### 3. Create new symlink

```bash
bash scripts/install-global.sh
```

### 4. Update CLAUDE.md

Add a brief note in the "Dev Environment Setup" section about `bash scripts/install-global.sh` for global availability.

## Files to create/modify

- **Create:** `scripts/install-global.sh`
- **Modify:** `CLAUDE.md` (dev setup section)
- **Remove:** `/usr/local/bin/ralph` symlink

## Verification

```bash
which ralph              # Should show ~/.local/bin/ralph
ralph --help             # Should work
ls -la ~/.local/bin/ralph  # Should point to repo scripts/bin/ralph
```
