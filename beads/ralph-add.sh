#!/usr/bin/env bash
# ralph-add.sh — Add a new issue to Beads from the command line
# Usage: ./ralph-add.sh
# Or:    ./ralph-add.sh --type bug --priority 1 --title "Short title" \
#                        --description "Details" --acceptance "Criteria line 1|Criteria line 2"
#
# NOTE: Beads uses hash-based IDs (like bd-a1b2) generated automatically.
# You cannot set IDs manually — this is by design.

if ! command -v bd &>/dev/null; then
  echo "ERROR: 'bd' not found. Install beads first."
  exit 1
fi

if [[ ! -d ".beads" ]]; then
  echo "ERROR: .beads/ not found. Run: bd init --quiet"
  exit 1
fi

# Parse flags
TYPE=""
PRIORITY=""
TITLE=""
DESCRIPTION=""
ACCEPTANCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)        TYPE="$2";        shift 2 ;;
    --priority)    PRIORITY="$2";    shift 2 ;;
    --title)       TITLE="$2";       shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    --acceptance)  ACCEPTANCE="$2";  shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# Interactive prompts for missing values
if [[ -z "$TYPE" ]]; then
  echo "Type (bug / feature / task / chore):"
  read -r TYPE
fi

if [[ -z "$PRIORITY" ]]; then
  echo "Priority (0=critical, 1=high, 2=medium, 3=low, 4=lowest):"
  read -r PRIORITY
fi

if [[ -z "$TITLE" ]]; then
  echo "Title (short, one line):"
  read -r TITLE
fi

if [[ -z "$DESCRIPTION" ]]; then
  echo "Description (what, symptoms, context — end with blank line):"
  DESCRIPTION=""
  while IFS= read -r line; do
    [[ -z "$line" ]] && break
    DESCRIPTION="$DESCRIPTION$line "
  done
  DESCRIPTION="${DESCRIPTION% }"
fi

if [[ -z "$ACCEPTANCE" ]]; then
  echo "Acceptance criteria (pipe-separated, e.g. 'Tests pass|No errors in logs|npm test passes'):"
  read -r ACCEPTANCE
fi

# Build acceptance criteria as newline-separated for bd
ACCEPTANCE_TEXT=$(echo "$ACCEPTANCE" | tr '|' '\n' | sed 's/^ */- /' | sed 's/^- - /- /')

# Full description with acceptance criteria appended
FULL_DESCRIPTION="${DESCRIPTION}

Acceptance Criteria:
${ACCEPTANCE_TEXT}"

# Create the issue via bd
echo ""
echo "Creating issue in Beads..."
RESULT=$(bd create "$TITLE" \
  --description="$FULL_DESCRIPTION" \
  -t "$TYPE" \
  -p "$PRIORITY" \
  --json 2>&1)

echo "$RESULT"

# Extract the ID from JSON output
ISSUE_ID=$(echo "$RESULT" | jq -r '.id // empty' 2>/dev/null || echo "")

if [[ -n "$ISSUE_ID" ]]; then
  echo ""
  echo "✓ Created issue $ISSUE_ID: [$TYPE] $TITLE"
  echo ""
  echo "Syncing to git..."
  bd sync 2>/dev/null || true
  echo ""
  echo "View with: bd show $ISSUE_ID --json"
  echo ""
  echo "Current ready work:"
  bd ready 2>/dev/null | head -10
else
  echo ""
  echo "Issue may have been created — check: bd list --status open"
fi
