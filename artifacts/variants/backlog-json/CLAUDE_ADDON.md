<!-- rauf:start -->

## Autonomous Loop (Rauf)

When running as a rauf loop iteration, follow these operational rules:

### Reading Your Task
1. Read `RAUF.md` for detailed per-iteration instructions
2. Read the backlog — find the current `in_progress` item
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
>
> `RAUF_REVIEW:<json>` is emitted only by a review pass, not a normal work
> iteration. If you emit no recognized signal, the runner does **not** auto-block
> the item — it classifies the outcome by exit context and reconciles committed
> work.

### Rules
- ONE item per iteration — do not work on multiple items
- Do not modify `backlog.json` — the loop runner manages status
- Do not modify `state.json` — the loop runner manages state
- Read `progress.md` for accumulated project learnings
- Append new learnings to `progress.md` if you discover important patterns

### Model Selection

The runner picks the model by precedence (highest wins):
`item.model` > `--model` / options > project default > provider default.
(`rauf loop run --no-model` ignores `item.model` for one run — useful for running
a Claude-aliased backlog under a non-Claude `--agent`.)

### Delegation (Claude Code)

In Claude Code, when a backlog item carries `agentDelegation`, use the **Task** tool to spawn
sub-agents for the independent subtasks, then wait for all of them before final verification. You
(the main agent) still own the `RAUF_*` exit signal — sub-agents do not emit it. The shared
`RAUF.md` guidance is host-agnostic; this Task-tool note is the Claude-specific specialization.
<!-- rauf:end -->
