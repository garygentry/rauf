#!/bin/bash
# Reset test-sandbox to clean state
cd "$(dirname "$0")"
SANDBOX_DIR="$(pwd)"

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

# ─── Isolated throwaway git repo for the sandbox ─────────────────────────
# The loop runner refuses to run on a dirty tree / default branch and
# auto-commits with `git add -A` after each completed item. Inside this
# repo (test-sandbox/ is tracked by the parent rauf repo), that would trip
# the dirty-tree guard and commit sandbox runs into the parent's history.
#
# To isolate it, the sandbox keeps its OWN git dir at `.sandbox-git` (NOT
# named `.git`, so the parent never treats it as an embedded submodule).
# run.sh/verify.sh export GIT_DIR/GIT_WORK_TREE to point the loop's git
# commands here, so the guard sees a clean `sandbox` branch and any
# auto-commit lands in this throwaway repo, never the parent.
SBX_GIT_DIR="$SANDBOX_DIR/.sandbox-git"
sbx_git() {
  git --git-dir="$SBX_GIT_DIR" --work-tree="$SANDBOX_DIR" \
    -c user.email="sandbox@rauf.test" -c user.name="Rauf Sandbox" \
    -c commit.gpgsign=false "$@"
}
if [ ! -d "$SBX_GIT_DIR" ]; then
  sbx_git init -q
  # Use a non-default branch so the loop's protected-branch guard passes.
  sbx_git symbolic-ref HEAD refs/heads/sandbox
  # Keep the git dir itself out of its own work tree.
  printf '.sandbox-git/\n' >"$SBX_GIT_DIR/info/exclude"
fi
# Commit the freshly-reset state as the clean baseline (no-op if unchanged).
sbx_git add -A
sbx_git commit -q -m "sandbox baseline" >/dev/null 2>&1 || true

echo "Sandbox reset. Ready for testing."
