#!/bin/bash
# Reset test-sandbox to clean state
cd "$(dirname "$0")"

# Remove transient state files
rm -f .rauf/state.json .rauf/rauf.log .rauf/DONE .rauf/CANCEL
rm -f .rauf/iteration-status.json .rauf/backlog.json.bak

# Restore backlog to original (all pending)
cp backlog-template.json .rauf/backlog.json

# Clean up multi-backlog scenario state
rm -rf specs/feature-a/.rauf
rm -rf specs/feature-a

# Set up multi-backlog scenario if the directory exists in scenarios/
if [ -d scenarios/multi-backlog/specs/feature-a ]; then
  mkdir -p specs/feature-a
  cp scenarios/multi-backlog/specs/feature-a/backlog.json specs/feature-a/backlog.json
fi

echo "Sandbox reset. Ready for testing."
