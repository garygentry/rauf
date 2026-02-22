#!/usr/bin/env bash
# Creates symlinks from packages/docs/src/content/docs/ to source documentation files.
# Idempotent — safe to run multiple times. Uses relative paths for portability.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_CONTENT="$REPO_ROOT/packages/docs/src/content/docs"

echo "Setting up documentation symlinks..."
echo "  Repo root: $REPO_ROOT"
echo "  Target dir: $DOCS_CONTENT"

# Ensure target directory exists
mkdir -p "$DOCS_CONTENT"

# Relative path from packages/docs/src/content/docs/ to repo root is ../../../../../
REL="../../../../.."

# Symlink spec and architecture docs (relative paths for portability)
ln -sf "$REL/docs/ARCHITECTURE.md"   "$DOCS_CONTENT/architecture.md"
ln -sf "$REL/docs/SCHEMAS.md"        "$DOCS_CONTENT/schemas.md"
ln -sf "$REL/docs/SPEC-CORE.md"      "$DOCS_CONTENT/spec-core.md"
ln -sf "$REL/docs/SPEC-CLI.md"       "$DOCS_CONTENT/spec-cli.md"
ln -sf "$REL/docs/SPEC-WEB.md"       "$DOCS_CONTENT/spec-web.md"
ln -sf "$REL/docs/SPEC-ARTIFACTS.md" "$DOCS_CONTENT/spec-artifacts.md"

# Symlink contributing guide from repo root
ln -sf "$REL/CONTRIBUTING.md"        "$DOCS_CONTENT/contributing.md"

# Clear Astro's content cache to ensure clean builds after symlink changes
rm -rf "$REPO_ROOT/packages/docs/.astro" "$REPO_ROOT/packages/docs/node_modules/.astro"

echo "Done. Symlinks created:"
ls -la "$DOCS_CONTENT"/*.md 2>/dev/null
