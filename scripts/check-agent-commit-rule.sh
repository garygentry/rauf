#!/usr/bin/env bash
# Guard: asserts the canonical agent commit rule is consistent across all loci.
# Run as: bash scripts/check-agent-commit-rule.sh
# Expected: exits 0 if all checks pass, non-zero with message on failure.

set -euo pipefail

CANONICAL="the iteration agent never commits or stages; the loop runner owns the commit"
STALE_PATTERN="Commit your changes\|Commit with:"

LOCI=(
  "artifacts/variants/backlog-json/CLAUDE_ADDON.md"
  "artifacts/variants/backlog-json/CLAUDE_GREENFIELD.md.tmpl"
  "artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl"
  "packages/core/src/embedded-artifacts.ts"
  "packages/loop/src/prompt-builder.ts"
  "docs/SPEC-ARTIFACTS.md"
)

FAIL=0

# V1: no stale commit instruction
echo "V1: Checking for stale commit instructions..."
STALE=$(grep -rn "$STALE_PATTERN" "${LOCI[@]}" 2>/dev/null || true)
if [[ -n "$STALE" ]]; then
  echo "FAIL V1: stale commit instructions found:"
  echo "$STALE"
  FAIL=1
else
  echo "  OK"
fi

# V2: canonical clause present in all loci
echo "V2: Checking canonical clause present in all loci..."
for f in "${LOCI[@]}"; do
  if ! grep -q "$CANONICAL" "$f" 2>/dev/null; then
    echo "FAIL V2: canonical clause missing from $f"
    FAIL=1
  fi
done
if [[ $FAIL -eq 0 ]]; then
  echo "  OK"
fi

# V3: prompt-builder has the reminder in Section 6
echo "V3: Checking prompt-builder reminder..."
if ! grep -q "never commits or stages" packages/loop/src/prompt-builder.ts; then
  echo "FAIL V3: commit-rule reminder missing from prompt-builder.ts"
  FAIL=1
else
  echo "  OK"
fi

# V4: events.ndjson excluded in git-commit.ts
echo "V4: Checking events.ndjson excluded from git staging..."
if ! grep -q "events.ndjson" packages/loop/src/git-commit.ts; then
  echo "FAIL V4: events.ndjson not excluded in git-commit.ts"
  FAIL=1
else
  echo "  OK"
fi

if [[ $FAIL -ne 0 ]]; then
  echo ""
  echo "agent-commit-rule guard: FAILED"
  exit 1
fi

echo ""
echo "agent-commit-rule guard: PASSED"
