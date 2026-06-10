#!/usr/bin/env bash
#
# install-binary.sh — install the rauf CLI as a self-contained binary.
#
# This is the DISTRIBUTION install path, distinct from scripts/install-global.sh
# (which symlinks the dev wrapper and requires the full repo + Bun). The
# compiled binary produced by `bun build --compile` bundles the Bun runtime, so
# the installed `rauf` needs NEITHER this repo NOR Bun/Node on the target.
#
# Two modes:
#   (default)  Download the latest release binary for this OS/arch from GitHub
#              Releases and install it to ~/.local/bin/rauf.
#   --local    Install the locally-built ./rauf-bin (run `pnpm compile` first).
#              Use this to build + test the distribution path from a repo clone.
#   --name N   Install the binary as N instead of `rauf` (e.g. `rauf-stable`,
#              a compiled snapshot used as the loop runner — see docs/DOGFOODING.md).
#
# Env overrides:
#   RAUF_REPO     GitHub owner/repo to fetch releases from (default garygentry/rauf)
#   RAUF_VERSION  Release tag to install (default: latest)
#   INSTALL_DIR   Install destination (default: $HOME/.local/bin)
#
# Usage:
#   bash scripts/install-binary.sh
#   bash scripts/install-binary.sh --local
#   bash scripts/install-binary.sh --local --name rauf-stable
#   curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash
set -euo pipefail

RAUF_REPO="${RAUF_REPO:-garygentry/rauf}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
MODE="download"
NAME="rauf"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local"; shift ;;
    --name)
      if [[ -z "${2:-}" ]]; then echo "--name requires a value" >&2; exit 1; fi
      NAME="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

TARGET="$INSTALL_DIR/$NAME"

# Detect OS/arch and map to Bun --compile target naming used for release assets.
detect_asset() {
  local os arch
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac
  echo "rauf-${os}-${arch}"
}

mkdir -p "$INSTALL_DIR"

if [[ "$MODE" == "local" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  SRC="$REPO_ROOT/rauf-bin"
  if [[ ! -f "$SRC" ]]; then
    echo "No local binary at $SRC. Build it first: pnpm compile" >&2
    exit 1
  fi
  install -m 0755 "$SRC" "$TARGET"
  echo "Installed local binary: $TARGET"
else
  ASSET="$(detect_asset)"
  TAG="${RAUF_VERSION:-latest}"
  if [[ "$TAG" == "latest" ]]; then
    URL="https://github.com/$RAUF_REPO/releases/latest/download/$ASSET"
  else
    URL="https://github.com/$RAUF_REPO/releases/download/$TAG/$ASSET"
  fi
  echo "Downloading $ASSET from $RAUF_REPO ($TAG)..."
  TMP="$(mktemp)"
  if ! curl -fsSL "$URL" -o "$TMP"; then
    echo "Failed to download $URL" >&2
    echo "(No release published yet? Build + install locally instead:" >&2
    echo "   pnpm compile && bash scripts/install-binary.sh --local )" >&2
    rm -f "$TMP"
    exit 1
  fi
  install -m 0755 "$TMP" "$TARGET"
  rm -f "$TMP"
  echo "Installed: $TARGET"
fi

# PATH check
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo "Warning: $INSTALL_DIR is not on your PATH. Add it to your shell profile." >&2
fi

# Remove any stale pre-rename `ralph` binary that would shadow `rauf`.
if [[ -e "$INSTALL_DIR/ralph" ]]; then
  rm -f "$INSTALL_DIR/ralph"
  echo "Removed stale: $INSTALL_DIR/ralph"
fi

"$TARGET" version 2>/dev/null || true
