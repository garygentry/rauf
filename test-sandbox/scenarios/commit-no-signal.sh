#!/bin/bash
# Commit-but-no-signal: the agent does its work and commits it as a proper
# `[rauf] <id>:` commit (staging everything via `git add -A`, like a commit hook
# or the agent committing itself), then the session dies BEFORE printing
# RAUF_DONE. The signal is lost, so the runner would otherwise wrongly block the
# item — this is the incident's item 003 (committed yet marked blocked).
#
# Commit reconciliation (item 009) must detect the landed `[rauf] 001:` commit
# and the resulting clean tree and record the item DONE (recovered_via_commit),
# WITHOUT committing a second time.
#
# GIT_DIR / GIT_WORK_TREE are exported by run.sh / verify.sh and point at the
# sandbox's throwaway repo, so the git commands here land there, never the
# parent rauf repo.
cat > /dev/null
echo '{"type":"message_start","message":{"usage":{"input_tokens":12000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Implemented the change and committing it.\n\n"}}'
echo '{"type":"content_block_stop","index":0}'

# Produce a real code change and commit it as the iteration's work. `git add -A`
# also stages the in_progress backlog.json bookkeeping, leaving a clean tree —
# the signature of genuinely-landed work that reconciliation recovers.
printf 'recovered work\n' > "$GIT_WORK_TREE/recovered-feature.txt"
git add -A -- . ':(exclude,glob)**/.rauf/state.json' ':(exclude,glob)**/.rauf/rauf.log' \
  ':(exclude,glob)**/.rauf/DONE' ':(exclude,glob)**/.rauf/CANCEL' \
  ':(exclude,glob)**/.rauf/iteration-status.json' ':(exclude,glob)**/.rauf/.loop.lock' \
  ':(exclude,glob)**/backlog.json.bak' >/dev/null 2>&1
git -c user.email="sandbox@rauf.test" -c user.name="Rauf Sandbox" -c commit.gpgsign=false \
  commit -q -m "[rauf] 001: recovered via commit" >/dev/null 2>&1

echo '{"type":"message_delta","usage":{"output_tokens":1800}}'
echo '{"type":"message_stop"}'
# Exit WITHOUT printing RAUF_DONE — the signal is lost.
