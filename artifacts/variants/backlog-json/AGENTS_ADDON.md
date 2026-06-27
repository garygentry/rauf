<!-- rauf:agents:start -->

## Autonomous Loop (Rauf)

This repository uses **rauf**, an autonomous coding loop. When you are running as a
rauf loop iteration, follow these operational rules. They are host-agnostic — they
apply whichever coding agent (Claude, Codex, Gemini, …) drives the iteration.

### Reading Your Task
1. Read `.rauf/RAUF.md` for detailed per-iteration instructions
2. Read the backlog (`.rauf/backlog.json`) — find the current `in_progress` item
3. The item's `acceptanceCriteria` define "done" for this iteration

### Working
4. Implement the changes described in the item's description
5. Follow acceptance criteria precisely — each one must pass
6. Run the verification command before considering work complete

### Completing
7. If all acceptance criteria pass: output `RAUF_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RAUF_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RAUF_NEEDS_HUMAN:<reason>`
10. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. Leave your changes in the working tree.

> Output the signal on a line by itself, as your final line — that's the safest
> habit. The runner scans backwards from the end and uses the **last** signal
> line, so trailing text after it (a commit message, a summary) does **not** break
> detection.

### Rules
- ONE item per iteration — do not work on multiple items
- Do not modify `backlog.json` — the loop runner manages status
- Do not modify `state.json` — the loop runner manages state
- Read `progress.md` for accumulated project learnings
- Append new learnings to `progress.md` if you discover important patterns

### Delegation
- If a backlog item carries `agentDelegation` and your host agent provides a
  subagent/delegation mechanism, use it to parallelize the independent subtasks;
  if it does not, complete the subtasks inline in the main session.
- You (the main agent) own the `RAUF_*` exit signal — delegated subtasks do not emit it.

### Model Selection
The runner picks the model by precedence (highest wins):
`item.model` > `--model` / options > project default > provider default.
(`rauf loop run --no-model` ignores `item.model` for one run — useful for running
a backlog whose items carry Claude-only tier aliases under a non-Claude `--agent`.)
<!-- rauf:agents:end -->
