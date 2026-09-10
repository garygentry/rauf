#!/usr/bin/env bash
#
# install-binary.sh — install the rauf CLI as a self-contained binary.
#
# This is the DISTRIBUTION install path, distinct from scripts/install-global.sh
# (which symlinks the dev wrapper and requires the full repo + Bun). The
# compiled binary produced by `bun build --compile` bundles the Bun runtime, so
# the installed `rauf` needs NEITHER this repo NOR Bun/Node on the target.
#
# This installs a RELEASE binary directly. It is a different channel from the
# npm launcher `npm i -g @garygentry/rauf` (which fetches release binaries into
# ~/.cache/rauf/ on demand). Both can land at the SAME path: npm's global prefix
# is often ~/.local (the fleet `nodejs` module pins it there), so `npm i -g`
# writes ~/.local/bin/rauf — exactly this script's default TARGET. To avoid one
# channel silently clobbering the other (or a dev symlink), this script refuses
# to overwrite a target it did not install unless --force is given. `rauf` is the
# name reserved for the published npm channel; use --name rauf-stable for the
# compiled loop-runner snapshot. See docs/DOGFOODING.md § "The three binaries".
#
# Two modes:
#   (default)  Download the latest release binary for this OS/arch from GitHub
#              Releases and install it to ~/.local/bin/rauf.
#   --local    Install the locally-built ./rauf-bin (run `pnpm compile` first).
#              Use this to build + test the distribution path from a repo clone.
#   --name N   Install the binary as N instead of `rauf` (e.g. `rauf-stable`,
#              a compiled snapshot used as the loop runner — see docs/DOGFOODING.md).
#   --force    Overwrite the target even if this script did not install it
#              (e.g. an npm-launcher `rauf`, or a dev symlink).
#
# Env overrides:
#   RAUF_REPO     GitHub owner/repo to fetch releases from (default garygentry/rauf)
#   RAUF_VERSION  Release tag to install (default: latest)
#   INSTALL_DIR   Install destination (default: $HOME/.local/bin). Note: if this
#                 equals npm's global prefix bin, `rauf` collides with the npm
#                 launcher — install under --name rauf-stable or a different dir.
#
# Usage:
#   bash scripts/install-binary.sh
#   bash scripts/install-binary.sh --local
#   bash scripts/install-binary.sh --local --name rauf-stable
#   bash scripts/install-binary.sh --force            # replace a foreign `rauf`
#   curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash
set -euo pipefail

RAUF_REPO="${RAUF_REPO:-garygentry/rauf}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
MODE="download"
NAME="rauf"
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local"; shift ;;
    --force) FORCE=true; shift ;;
    --name)
      if [[ -z "${2:-}" ]]; then echo "--name requires a value" >&2; exit 1; fi
      NAME="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

TARGET="$INSTALL_DIR/$NAME"

# Ownership marker: records `<sha256>  <target>` for the binary this script last
# installed as NAME, so an upgrade/re-install is silent but any target we did not
# create — or one we created that has since been REPLACED (npm launcher, a dev
# symlink, another binary) — is refused without --force. Comparing the recorded
# checksum against the file on disk (not just the path) is what catches a target
# that was swapped out from under us.
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/rauf"
MARKER="$STATE_DIR/installed-$NAME"

# Print the sha256 of "$1", or nothing if no tool is available / the file is
# unreadable (a broken symlink hashes to nothing). Never executes the file.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  fi
}

# True when the marker confirms the CURRENT file at TARGET is one this script
# installed (path matches and, when a sha tool exists, the checksum still matches).
rauf_owns_target() {
  [[ -f "$MARKER" ]] || return 1
  local rec_sha rec_path cur_sha
  read -r rec_sha rec_path <"$MARKER" 2>/dev/null || return 1
  [[ "$rec_path" == "$TARGET" ]] || return 1
  cur_sha="$(sha256_of "$TARGET")"
  # No sha tool anywhere → fall back to path-only ownership (best effort).
  [[ -z "$rec_sha" || -z "$cur_sha" ]] && return 0
  [[ "$cur_sha" == "$rec_sha" ]]
}

# Refuse to clobber a target we did not install (or that was replaced), unless --force.
if { [[ -e "$TARGET" ]] || [[ -L "$TARGET" ]]; } && ! rauf_owns_target && [[ "$FORCE" != true ]]; then
  echo "Refusing to overwrite $TARGET — this script did not install it." >&2
  if [[ -L "$TARGET" ]]; then
    echo "  It is a symlink -> $(readlink "$TARGET" 2>/dev/null) (a dev wrapper, or an npm global link)." >&2
  else
    echo "  It may be an npm-launcher install (npm i -g @garygentry/rauf) or another binary." >&2
  fi
  echo "  Re-run with --force to replace it, or install elsewhere:" >&2
  echo "     bash scripts/install-binary.sh --force" >&2
  echo "     bash scripts/install-binary.sh --name rauf-stable" >&2
  exit 1
fi

# Record `<sha256>  <target>` so a later run recognizes an unchanged install.
mark_owned() {
  mkdir -p "$STATE_DIR"
  printf '%s  %s\n' "$(sha256_of "$TARGET")" "$TARGET" >"$MARKER"
}

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
  mark_owned
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

  # Verify the download against the release's published SHA256SUMS.
  # Mismatch = hard-fail; missing tool / unreachable sums / unlisted asset =
  # warn + continue (don't brick curl|bash installs). --local skips this block.
  if [[ "$TAG" == "latest" ]]; then
    SUMS_URL="https://github.com/$RAUF_REPO/releases/latest/download/SHA256SUMS"
  else
    SUMS_URL="https://github.com/$RAUF_REPO/releases/download/$TAG/SHA256SUMS"
  fi

  SUM_TOOL=""
  if command -v sha256sum >/dev/null 2>&1; then
    SUM_TOOL="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    SUM_TOOL="shasum -a 256"
  fi

  if [[ -z "$SUM_TOOL" ]]; then
    echo "Warning: no sha256 tool found; skipping checksum verification." >&2
  else
    SUMS_TMP="$(mktemp)"
    if ! curl -fsSL "$SUMS_URL" -o "$SUMS_TMP"; then
      echo "Warning: could not fetch SHA256SUMS; skipping verification." >&2
      rm -f "$SUMS_TMP"
    else
      # `|| true`: under set -euo pipefail a no-match grep would kill the
      # script; an unlisted asset must warn + continue instead.
      EXPECTED="$(grep " ${ASSET}\$" "$SUMS_TMP" | awk '{print $1}' || true)"
      rm -f "$SUMS_TMP"
      if [[ -z "$EXPECTED" ]]; then
        echo "Warning: $ASSET not listed in SHA256SUMS; skipping verification." >&2
      else
        ACTUAL="$($SUM_TOOL "$TMP" | awk '{print $1}')"
        if [[ "$ACTUAL" != "$EXPECTED" ]]; then
          echo "Checksum MISMATCH for $ASSET:" >&2
          echo "  expected $EXPECTED" >&2
          echo "  actual   $ACTUAL" >&2
          rm -f "$TMP" # hard-fail: delete the unverified download
          exit 1
        fi
        echo "Checksum OK ($ASSET)."
      fi
    fi
  fi

  install -m 0755 "$TMP" "$TARGET"
  rm -f "$TMP"
  mark_owned
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
