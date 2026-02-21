# Ralph Loop — Agent Instructions

You are one engineer in a relay team working through a project backlog.
Each session you complete ONE item and hand off cleanly to the next engineer.
The only memory between sessions is the backlog.json file and progress.txt.

---

## On Start — Every Iteration

Run these in order before touching any code:

1. Read the Current Backlog State provided below — find items with status "in_progress" first (interrupted work), then "pending" items
2. Read the Progress Log below — especially the "Codebase Patterns" section at the top
3. Run `git log --oneline -5` to orient yourself to recent commits
4. Run the appropriate quality checks to confirm the codebase is green before you start:
   - TypeScript/JS: `npm run typecheck 2>&1 | tail -5` then `npm test -- --passWithNoTests 2>&1 | tail -10`
   - Python: `python -m pytest --tb=short -q 2>&1 | tail -10`
   - If checks fail before you've touched anything, note it in progress.txt and factor it in

---

## Selecting Your Task

1. If any item has `"status": "in_progress"` — resume that item (it was interrupted)
2. Otherwise pick the highest-priority `"status": "pending"` item (priority 1 = highest)
3. Update its status to `"in_progress"` in backlog.json immediately after selecting it
4. Commit that status change: `git add .ralph/backlog.json && git commit -m "chore(ralph): start <id> - <title>"`

**Task sizing rule:** If a task looks like it will take more than one focused context window to complete, do NOT attempt it. Instead:
- Break it into 2–4 smaller items directly in backlog.json (add them with status "pending")
- Mark the original item "done" with a note: "decomposed into <ids>"
- Commit, output `RALPH_DONE`, and stop. Next iteration picks up the pieces.

---

## Implementing the Task

Read the item's `description` and `acceptanceCriteria` carefully. The criteria defines done — not your judgment.

### For bug fixes:
- Reproduce the bug first (write a failing test if possible)
- Fix the root cause, not just the symptom
- Verify the fix with a passing test
- Check for similar patterns elsewhere in the codebase and note them

### For refactors:
- Run full tests BEFORE starting to establish baseline
- Make incremental changes, running checks frequently
- Do NOT change behavior — refactor only
- Tests must pass identically before and after

### For new features:
- Write the test first if the feature is well-defined enough
- Implement to pass the test
- Check TypeScript types are clean if applicable
- Add a brief docstring/comment if the feature is non-obvious

### For chores / dependency updates:
- Check changelogs for breaking changes before updating
- Run full test suite after
- Note any deprecation warnings in progress.txt

---

## Verification Before Closing

Run ALL of the following that apply to your project. ALL must pass:

```bash
# TypeScript / Node
npm run typecheck 2>&1
npm test 2>&1
npm run lint 2>&1   # if configured

# Python
python -m pytest --tb=short 2>&1
python -m mypy . --ignore-missing-imports 2>&1   # if configured

# General
git diff --stat   # confirm only expected files changed
```

If ANY check fails:
- Fix it before proceeding — do not mark done with failing checks
- If you cannot fix it in this session, mark the item "blocked" with a clear reason

---

## Closing a Task — Clean Handoff

Once verification passes:

1. Update backlog.json — set the item's status to `"done"` and add a `"completedAt"` field with today's date (YYYY-MM-DD)

2. Commit everything together:
   ```bash
   git add -A
   git commit -m "<type>(<id>): <title>

   <one sentence summary of what was done>
   
   Acceptance criteria verified: all checks passing"
   ```
   Commit types: `fix` for bugs, `refactor` for refactors, `feat` for features, `chore` for maintenance

3. Push:
   ```bash
   git push
   ```

4. Append to progress.txt — use this exact format:
   ```
   [YYYY-MM-DD] <id>: <title>
   Type: <bug|refactor|feature|chore>
   Result: done
   Verification: <which checks ran and passed>
   Learnings: <any patterns, gotchas, conventions, or things next engineer should know>
   ```
   If you discovered something that applies to the whole codebase (naming convention, import pattern, etc.), also add or update the "Codebase Patterns" section at the top of progress.txt.

5. Output your exit signal as the **very last line** of your response — nothing after it:

   **If task completed:** `RALPH_DONE`
   **If task is blocked:** `RALPH_BLOCKED:<id>` (e.g. `RALPH_BLOCKED:003`)
   **If human decision needed:** `RALPH_NEEDS_HUMAN:<brief reason>`

---

## Rules — Non-Negotiable

- Complete ONE task per session. If you finish early, create new backlog items for discovered work — do not start another task.
- Never leave a task in "in_progress" status without either completing it or marking it "blocked" with a reason.
- Always push before outputting your exit signal. Unpushed commits strand work.
- Do not modify files outside the scope of your chosen task unless it's a trivially related fix (e.g., fixing a typo in a file you're already editing).
- Do not delete or reorder existing items in backlog.json. You may only: update status fields, add new items, add completedAt.
- The exit signal must be the last line of your output with nothing after it.
