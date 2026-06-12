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

### Rules
- ONE item per iteration — do not work on multiple items
- Do not modify `backlog.json` — the loop runner manages status
- Do not modify `state.json` — the loop runner manages state
- Read `progress.md` for accumulated project learnings
- Append new learnings to `progress.md` if you discover important patterns
<!-- rauf:end -->
