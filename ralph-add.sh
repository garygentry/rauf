#!/usr/bin/env bash
# =============================================================================
# ralph-add.sh — Add a new item to the backlog
# Usage: ./ralph-add.sh
# Or:    ./ralph-add.sh --type bug --priority 1 --title "Short title" --description "Details"
# =============================================================================

RALPH_DIR=".ralph"
BACKLOG="$RALPH_DIR/backlog.json"

if [[ ! -f "$BACKLOG" ]]; then
  echo "ERROR: .ralph/backlog.json not found. Run from project root."
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found. Install with: sudo apt install jq"
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
TYPE=""
PRIORITY=""
TITLE=""
DESCRIPTION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)        TYPE="$2";        shift 2 ;;
    --priority)    PRIORITY="$2";    shift 2 ;;
    --title)       TITLE="$2";       shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./ralph-add.sh [--type TYPE] [--priority N] [--title TEXT] [--description TEXT]"
      echo ""
      echo "  --type        bug | refactor | feature | chore"
      echo "  --priority    1 (highest) to 4 (lowest)"
      echo "  --title       Short title for the item"
      echo "  --description Detailed description"
      echo ""
      echo "Omit flags for interactive prompts."
      exit 0
      ;;
    *) echo "Unknown flag: $1. Use --help for usage."; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Interactive prompts for missing values
# ---------------------------------------------------------------------------
if [[ -z "$TYPE" ]]; then
  echo "Type (bug / refactor / feature / chore):"
  read -r TYPE
fi

# Validate type
case "$TYPE" in
  bug|refactor|feature|chore) ;;
  *) echo "ERROR: Invalid type '$TYPE'. Must be: bug, refactor, feature, chore"; exit 1 ;;
esac

if [[ -z "$PRIORITY" ]]; then
  echo "Priority (1=highest, 2, 3, 4=lowest):"
  read -r PRIORITY
fi

# Validate priority
if ! [[ "$PRIORITY" =~ ^[1-4]$ ]]; then
  echo "ERROR: Priority must be 1, 2, 3, or 4. Got: $PRIORITY"
  exit 1
fi

if [[ -z "$TITLE" ]]; then
  echo "Title (short, one line):"
  read -r TITLE
fi

if [[ -z "$TITLE" ]]; then
  echo "ERROR: Title cannot be empty."
  exit 1
fi

if [[ -z "$DESCRIPTION" ]]; then
  echo "Description (what needs doing — end with a blank line):"
  DESCRIPTION=""
  while IFS= read -r line; do
    [[ -z "$line" ]] && break
    DESCRIPTION="$DESCRIPTION$line "
  done
  DESCRIPTION="${DESCRIPTION% }"
fi

# ---------------------------------------------------------------------------
# Generate next ID — use MAX of all existing IDs (not last item, handles gaps)
# ---------------------------------------------------------------------------
MAX_ID=$(jq -r '[.items[].id | tonumber] | max // 0' "$BACKLOG")
NEXT_NUM=$(( MAX_ID + 1 ))
NEXT_ID=$(printf "%03d" "$NEXT_NUM")

# ---------------------------------------------------------------------------
# Build new item JSON
# ---------------------------------------------------------------------------
NEW_ITEM=$(jq -n \
  --arg id "$NEXT_ID" \
  --arg type "$TYPE" \
  --argjson priority "$PRIORITY" \
  --arg title "$TITLE" \
  --arg description "$DESCRIPTION" \
  '{
    id: $id,
    type: $type,
    priority: $priority,
    title: $title,
    description: $description,
    acceptanceCriteria: [],
    status: "pending",
    completedAt: null
  }')

# ---------------------------------------------------------------------------
# Atomic write: append to backlog via jq, write to .tmp, then rename
# ---------------------------------------------------------------------------
jq --argjson item "$NEW_ITEM" '.items += [$item]' "$BACKLOG" > "$BACKLOG.tmp"
mv "$BACKLOG.tmp" "$BACKLOG"

echo ""
echo "✓ Added item $NEXT_ID: [$TYPE] $TITLE"
echo ""
echo "⚠ IMPORTANT: Add acceptance criteria for item $NEXT_ID."
echo "  The loop uses criteria to verify when a task is done."
echo "  Edit .ralph/backlog.json or use the ralph manager tool."
echo ""

# Show current status
if [[ -x "./ralph-status.sh" ]]; then
  ./ralph-status.sh 2>/dev/null || true
fi
