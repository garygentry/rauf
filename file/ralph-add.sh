#!/usr/bin/env bash
# ralph-add.sh — Add a new item to the backlog interactively
# Usage: ./ralph-add.sh
# Or:    ./ralph-add.sh --type bug --priority 1 --title "Short title" --description "Details"

BACKLOG=".ralph/backlog.json"

if [[ ! -f "$BACKLOG" ]]; then
  echo "ERROR: .ralph/backlog.json not found. Run from project root."
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found. Install with: sudo apt install jq"
  exit 1
fi

# Parse flags if provided
TYPE=""
PRIORITY=""
TITLE=""
DESCRIPTION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)       TYPE="$2";        shift 2 ;;
    --priority)   PRIORITY="$2";   shift 2 ;;
    --title)      TITLE="$2";      shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# Interactive prompts for missing values
if [[ -z "$TYPE" ]]; then
  echo "Type (bug / refactor / feature / chore):"
  read -r TYPE
fi

if [[ -z "$PRIORITY" ]]; then
  echo "Priority (1=highest, 2, 3, 4=lowest):"
  read -r PRIORITY
fi

if [[ -z "$TITLE" ]]; then
  echo "Title (short, one line):"
  read -r TITLE
fi

if [[ -z "$DESCRIPTION" ]]; then
  echo "Description (what needs doing, symptoms, context — end with a blank line):"
  DESCRIPTION=""
  while IFS= read -r line; do
    [[ -z "$line" ]] && break
    DESCRIPTION="$DESCRIPTION$line "
  done
  DESCRIPTION="${DESCRIPTION% }"
fi

# Generate next ID
LAST_ID=$(jq -r '.items[-1].id // "000"' "$BACKLOG")
NEXT_NUM=$(( 10#"$LAST_ID" + 1 ))
NEXT_ID=$(printf "%03d" "$NEXT_NUM")

# Build new item JSON
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
    acceptanceCriteria: ["(add acceptance criteria — edit backlog.json directly)"],
    status: "pending",
    completedAt: null
  }')

# Append to backlog
UPDATED=$(jq --argjson item "$NEW_ITEM" '.items += [$item]' "$BACKLOG")
echo "$UPDATED" > "$BACKLOG"

echo ""
echo "✓ Added item $NEXT_ID: [$TYPE] $TITLE"
echo ""
echo "IMPORTANT: Open .ralph/backlog.json and add proper acceptanceCriteria for item $NEXT_ID."
echo "  The loop relies on criteria to know when a task is done."
echo ""
echo "Current backlog:"
./ralph-status.sh 2>/dev/null || true
