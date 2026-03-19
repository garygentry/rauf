#!/bin/bash
# Reset test-sandbox to clean state
cd "$(dirname "$0")"

# Remove transient state files
rm -f .ralph/state.json .ralph/ralph.log .ralph/DONE .ralph/CANCEL
rm -f .ralph/iteration-status.json .ralph/backlog.json.bak

# Restore backlog to original (all pending)
cp backlog-template.json .ralph/backlog.json

echo "Sandbox reset. Ready for testing."
