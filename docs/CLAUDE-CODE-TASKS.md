---
title: Claude Code Tasks
description: How ralph's backlog.json relates to Claude Code's native Tasks system.
---

# Claude Code Tasks Integration

## Background

Claude Code v2.1.16+ (January 2026) introduced a native **Tasks** system that replaced the older Todos. Tasks persist to `~/.claude/tasks/<task-list-id>/` and support dependencies, multi-session coordination, and DAG-based execution ordering.

## How Tasks Work

- Tasks are created via `TaskCreate`, updated via `TaskUpdate`, listed via `TaskList`, fetched via `TaskGet`
- Storage: `~/.claude/tasks/<CLAUDE_CODE_TASK_LIST_ID>/tasks.json` (per-list-ID JSON files)
- Tasks persist across context compactions within a session
- Tasks are session-scoped by default unless `CLAUDE_CODE_TASK_LIST_ID` is set
- Multiple sessions can share a task list via the same `CLAUDE_CODE_TASK_LIST_ID`

## Ralph's Backlog vs Claude Code Tasks

These are **complementary, not competing** systems:

| Aspect             | ralph backlog.json                   | Claude Code Tasks                  |
| ------------------ | ------------------------------------ | ---------------------------------- |
| **Purpose**        | Project-level work queue             | Session-level execution tracking   |
| **Persistence**    | File in project directory, permanent | `~/.claude/tasks/`, session-scoped |
| **Managed by**     | Human + ralph manager tool           | Claude Code agent                  |
| **Granularity**    | Feature/bug/chore items              | Sub-steps to implement one item    |
| **Cross-session**  | Always (it's a file)                 | Only if TASK_LIST_ID is set        |
| **Status updates** | Loop runner + manager tool           | Claude Code internally             |

### The Relationship

```
backlog.json item "001: Implement user auth"
  └─► Loop runner picks it, marks in_progress
      └─► claude -p session starts
          └─► Agent may use Tasks internally:
              Task 1: "Design auth schema" ──►
              Task 2: "Implement login endpoint" (blocked by 1) ──►
              Task 3: "Add tests" (blocked by 2) ──►
          └─► Session ends, agent outputs RALPH_DONE
      └─► Loop runner marks item "done" in backlog.json
```

## Configuration Recommendations

### Do NOT set CLAUDE_CODE_TASK_LIST_ID in the loop runner

Each ralph iteration spawns a fresh `claude -p` session. Setting a shared task list ID would cause:

- Stale tasks from previous iterations leaking into new sessions
- Confusion between items from different backlog entries
- Potential namespace collisions

Let each `claude -p` session use its default ephemeral task scope.

### RALPH.md Should NOT Reference Tasks API

The per-iteration prompt (RALPH.md) instructs the agent to read backlog.json. It should NOT instruct the agent to create Claude Code Tasks from backlog items — that would be redundant. The agent may naturally use Tasks internally for its own decomposition, which is fine.

### Do NOT Disable Tasks

Setting `CLAUDE_CODE_ENABLE_TASKS=false` is unnecessary. Tasks and backlog.json coexist without conflict since they use completely separate storage locations and serve different purposes.

## Potential Friction Points

1. **Agent confusion:** An agent might try to "sync" backlog.json items into Tasks. RALPH.md should clarify: "backlog.json is your source of truth. Do not modify it — the loop runner manages status updates."

2. **Duplicate tracking:** The agent might track the same work in both Tasks and as mental notes. This is harmless — Tasks are ephemeral and disappear after the session.

3. **Status mismatch:** Tasks might show "completed" internally while the backlog item is still "in_progress" (because the loop hasn't processed the exit signal yet). This is expected — the loop runner is the authority on backlog status.

## For Self-Hosting (ralph building ralph)

When using ralph loops to develop the ralph tool itself, the same principles apply:

- `.ralph/backlog.json` defines what to build
- Claude Code Tasks are the agent's internal planning tool for each iteration
- The two systems don't interfere because they use separate storage
- No special configuration needed
