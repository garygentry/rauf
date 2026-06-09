#!/usr/bin/env bash
# Bump the rauf version across all locations.
# Usage: bash scripts/bump-version.sh <new-version>
# Example: bash scripts/bump-version.sh 0.2.0

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <new-version>" >&2
  echo "Example: $0 0.2.0" >&2
  exit 1
fi

NEW_VERSION="$1"

# Validate semver-ish format
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '$NEW_VERSION' is not a valid semver version" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Bumping rauf version to $NEW_VERSION"
echo ""

# 1. TypeScript source of truth
VERSION_FILE="$REPO_ROOT/packages/core/src/version.ts"
sed -i "s/export const VERSION = \".*\"/export const VERSION = \"$NEW_VERSION\"/" "$VERSION_FILE"
echo "  Updated $VERSION_FILE"

# 2. All package.json files
PACKAGE_FILES=(
  "$REPO_ROOT/package.json"
  "$REPO_ROOT/packages/core/package.json"
  "$REPO_ROOT/packages/cli/package.json"
  "$REPO_ROOT/packages/loop/package.json"
  "$REPO_ROOT/packages/web/package.json"
)

for PKG in "${PACKAGE_FILES[@]}"; do
  if [[ -f "$PKG" ]]; then
    # Use node to update JSON properly (preserves formatting better than sed)
    node -e "
      const fs = require('fs');
      const content = fs.readFileSync('$PKG', 'utf8');
      const pkg = JSON.parse(content);
      pkg.version = '$NEW_VERSION';
      // Preserve original indentation
      const indent = content.match(/^(\s+)/m)?.[1] || '  ';
      fs.writeFileSync('$PKG', JSON.stringify(pkg, null, indent) + '\n');
    "
    echo "  Updated $PKG"
  fi
done

echo ""
echo "Done. Version bumped to $NEW_VERSION across all locations."
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Commit: git commit -am 'chore: bump version to $NEW_VERSION'"
