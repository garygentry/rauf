#!/usr/bin/env bash
# =============================================================================
# seed-beads.sh — Populate Beads with the example Ralph backlog
#
# This is equivalent to the backlog.json in the plain-file version.
# Run this ONCE after bd init to load the example issues into Beads.
# After seeding, use: bd ready   to see what's available.
#
# IMPORTANT: Only run this on a fresh bd init. Running it twice will
# create duplicate issues. Check first: bd list --status open --json
# =============================================================================
set -euo pipefail

if ! command -v bd &>/dev/null; then
  echo "ERROR: 'bd' not found."
  exit 1
fi

if [[ ! -d ".beads" ]]; then
  echo "ERROR: .beads/ not found. Run: bd init --quiet first."
  exit 1
fi

EXISTING=$(bd list --status open --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
if [[ "$EXISTING" -gt 0 ]]; then
  echo "WARNING: Beads already has $EXISTING open issues."
  echo "Run this script only on a fresh project to avoid duplicates."
  echo "Continue anyway? (y/N)"
  read -r CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

echo "Seeding Beads with example Ralph backlog..."
echo ""

# ---------------------------------------------------------------------------
# BUGS — Priority 1 (high), created first so they're worked on first
# ---------------------------------------------------------------------------

echo "Creating bugs..."

BUG1=$(bd create "API returns 500 on missing optional query parameter" \
  --description="When the /api/search endpoint is called without the optional 'filter' query parameter, it throws an unhandled TypeError instead of returning results with no filter applied.

Reproducible with: GET /api/search?q=test (omitting &filter=)
Expected: 200 with unfiltered results
Actual: 500 Internal Server Error — TypeError in server logs

Acceptance Criteria:
- GET /api/search?q=test returns 200 when 'filter' param is absent
- No unhandled TypeError in server logs on this request
- Regression test added covering the missing-parameter case
- npm test passes" \
  -t bug -p 1 --json)

BUG1_ID=$(echo "$BUG1" | jq -r '.id')
echo "  ✓ Bug 1: $BUG1_ID — API 500 on missing optional param"

BUG2=$(bd create "Python data processor crashes on empty input file" \
  --description="data_processor.py raises IndexError when given an input CSV with no data rows (header only). Error occurs at ~line 47 in the row iteration.

Empty files are a valid input — they should produce empty output, not a crash.

Acceptance Criteria:
- data_processor.py handles empty CSV (header-only) without raising an exception
- Output for empty input is an empty result set (not an error)
- pytest test added: test_empty_input_returns_empty_result
- pytest passes" \
  -t bug -p 1 --json)

BUG2_ID=$(echo "$BUG2" | jq -r '.id')
echo "  ✓ Bug 2: $BUG2_ID — Data processor crash on empty CSV"

# ---------------------------------------------------------------------------
# FEATURES — Priority 2
# ---------------------------------------------------------------------------

echo "Creating features..."

FEAT1=$(bd create "Add pagination to the /api/items list endpoint" \
  --description="The /api/items endpoint currently returns all records with no limit. Add cursor-based pagination using 'limit' and 'cursor' query params.

Default limit: 50. Max limit: 200.
Response should include a 'nextCursor' field (null if no more pages).

Acceptance Criteria:
- GET /api/items?limit=10 returns exactly 10 items and a nextCursor value
- GET /api/items?limit=10&cursor=<nextCursor> returns the next page
- GET /api/items returns default 50 items when no limit specified
- limit > 200 is rejected with 400 Bad Request
- nextCursor is null when on the last page
- Response schema: { items: [...], nextCursor: string | null, total: number }
- Tests cover: default page, explicit limit, cursor navigation, limit exceeded, last page
- TypeScript types updated for new response shape
- npm test and npm run typecheck pass" \
  -t feature -p 2 --json)

FEAT1_ID=$(echo "$FEAT1" | jq -r '.id')
echo "  ✓ Feature 1: $FEAT1_ID — API pagination"

FEAT2=$(bd create "Add Python CLI flag for dry-run mode" \
  --description="The main.py script currently writes output files on every run. Add a --dry-run flag that runs all processing but writes nothing to disk, printing a summary of what would have been written.

Acceptance Criteria:
- python main.py --dry-run processes input without writing any output files
- Dry-run prints: 'Would write: <filename> (<N> records)' for each file
- Normal mode (no flag) behavior unchanged
- --help output documents the --dry-run flag
- pytest tests cover: dry-run produces no files, prints expected summary
- pytest passes" \
  -t feature -p 2 --json)

FEAT2_ID=$(echo "$FEAT2" | jq -r '.id')
echo "  ✓ Feature 2: $FEAT2_ID — Python dry-run flag"

# ---------------------------------------------------------------------------
# REFACTORS — Priority 2-3
# ---------------------------------------------------------------------------

echo "Creating refactors..."

REF1=$(bd create "Extract inline validation logic into dedicated validator module" \
  --description="Input validation is duplicated across 4-5 route handlers (email format, required fields, length limits). Extract into a shared validators.ts (or validators.py) module.

Do not change validation behavior — purely structural.

Acceptance Criteria:
- Shared validator module created with all extracted functions
- All route handlers import from the new module — no inline duplicates remain
- Existing behavior unchanged (no rules loosened or tightened)
- Unit tests added for each validator function
- All existing tests still pass
- TypeScript: npm run typecheck passes with no new errors" \
  -t task -p 2 --json)

REF1_ID=$(echo "$REF1" | jq -r '.id')
echo "  ✓ Refactor 1: $REF1_ID — Extract validator module"

REF2=$(bd create "Replace console.log debug statements with structured logger" \
  --description="The codebase has ~20 ad-hoc console.log() calls. Replace with the existing logger utility (src/lib/logger.ts) using appropriate log levels.

Remove obvious temporary debug prints. Keep logs that represent meaningful application events.

Acceptance Criteria:
- No bare console.log() calls remain in src/ (console.error in catch blocks is acceptable)
- Replaced logs use logger.debug() or logger.info() with meaningful messages
- Application behavior unchanged
- npm test passes" \
  -t task -p 3 --json)

REF2_ID=$(echo "$REF2" | jq -r '.id')
echo "  ✓ Refactor 2: $REF2_ID — Replace console.log with logger"

# ---------------------------------------------------------------------------
# CHORES — Priority 3-4
# ---------------------------------------------------------------------------

echo "Creating chores..."

CHORE1=$(bd create "Update npm dependencies to latest minor/patch versions" \
  --description="Several npm packages are behind on minor and patch versions. Run npm outdated, update packages with non-breaking minor/patch updates only. Skip major version bumps — those need separate review.

Acceptance Criteria:
- npm outdated shows no available minor/patch updates after update
- No major version bumps applied
- npm test passes after updates
- npm run typecheck passes after updates
- package-lock.json committed alongside package.json changes
- Any deprecation warnings noted in progress.md" \
  -t task -p 3 --json)

CHORE1_ID=$(echo "$CHORE1" | jq -r '.id')
echo "  ✓ Chore 1: $CHORE1_ID — Update npm deps"

CHORE2=$(bd create "Add missing docstrings to public Python functions" \
  --description="Python modules are missing docstrings on most public functions. Add Google-style docstrings to all public functions (not private/underscore-prefixed) in the src/ directory.

Do not change function signatures or behavior.

Acceptance Criteria:
- All public functions in src/ have a Google-style docstring with Args and Returns sections
- No function signatures changed
- pytest passes (behavior unchanged)
- If a function's purpose is unclear, add a TODO comment and move on" \
  -t task -p 4 --json)

CHORE2_ID=$(echo "$CHORE2" | jq -r '.id')
echo "  ✓ Chore 2: $CHORE2_ID — Add Python docstrings"

# ---------------------------------------------------------------------------
# Summary and sync
# ---------------------------------------------------------------------------

echo ""
echo "Syncing to git..."
bd sync

echo ""
echo "============================================"
echo "Seeding complete! Summary:"
echo ""
echo "  Bugs (priority 1):     $BUG1_ID, $BUG2_ID"
echo "  Features (priority 2): $FEAT1_ID, $FEAT2_ID"
echo "  Refactors (p2-3):      $REF1_ID, $REF2_ID"
echo "  Chores (p3-4):         $CHORE1_ID, $CHORE2_ID"
echo ""
echo "What's ready to work on:"
bd ready
echo ""
echo "Next step: ./ralph.sh [max_iterations]"
echo "============================================"
