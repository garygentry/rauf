---
name: review-ralph-guidance
description: >
  Review and update the ralph-installed guidance file (.ralph/RALPH.md)
  in a ralph-managed project to ensure it's accurate for the target project.
  Use this skill when the user asks to "review ralph guidance", "check ralph config",
  "audit ralph files", "update RALPH.md", "fix my ralph setup", or asks whether
  .ralph/RALPH.md is correct for their project. Also use when the user
  reports that the ralph loop is using wrong verification commands, missing project
  context, or behaving as if it doesn't understand the project.
---

# Review Ralph Guidance

When ralph is installed into a project, it creates `.ralph/RALPH.md` — the primary file the autonomous loop agent reads every iteration. If this file is wrong, the loop will waste iterations or produce broken work. This skill walks you through auditing it and fixing any issues.

## `.ralph/RALPH.md` — Per-iteration agent instructions

This file contains:

1. **Verification commands** (inside `<!-- ralph:managed:start -->` / `<!-- ralph:managed:end -->` sentinels) — the test/typecheck/lint/build/format commands the agent runs before marking work complete. These are overwritten by `ralph update`.
2. **Workflow** — step-by-step iteration process (read backlog → implement → verify → commit → signal). Note: the verify command in workflow step 6 is outside the managed sentinels — it is NOT auto-updated.
3. **Agent delegation** — instructions for using sub-agents when `agentDelegation` is present on a backlog item
4. **Important rules** — constraints like "work on ONE item only" and "don't modify backlog.json"
5. **Project-specific instructions** — a section at the bottom where custom guidance can be added. This section survives `ralph update`.

## Review Process

### Step 1: Read the files

```
Read .ralph/RALPH.md
Read .ralph.json
```

The marker file's `profile` field shows what ralph detected during installation — stack, package manager, monorepo flag, and commands. This is what drove the template rendering.

### Step 2: Check .ralph.json ↔ RALPH.md sync

Compare the commands in `.ralph.json` `profile.commands` and `profile.verify` against the rendered commands in RALPH.md's managed section. They should match exactly. If they don't, the files are out of sync — likely someone ran `ralph profile set` without `ralph update` afterward. Flag this as a **critical issue** before proceeding.

### Step 3: Verify each command by running it

This is the most important step. For each non-empty command in the managed section, **actually run it** and record pass/fail:

1. Run the `Test` command — does it execute the project's test suite? Watch for: wrong package manager prefix, "command not found", test framework not installed
2. Run the `Typecheck` command — is there a tsconfig.json? If the project isn't TypeScript, this should be empty
3. Run the `Lint` command — does the linter run? Does it use the right config?
4. Run the `Build` command — does it succeed? (May not exist for all projects)
5. Run the `Format` command — does the format check pass?
6. Run the full `verify` command — the `&&`-chained pipeline. Verify the exit code is 0

If a command is empty in the managed section, confirm it's also absent from the full verify chain.

Record results:
- **Pass** — command runs and exits 0 (or exits non-zero with expected test failures, not "command not found")
- **Fail** — command not found, wrong framework, crashes, or exits non-zero unexpectedly
- **Missing** — command is empty but should exist (e.g., project has TypeScript but no typecheck command)

### Step 4: Fix wrong commands

If any commands are wrong:

**If `ralph` CLI is available:**
```bash
ralph profile set . <key> <value>   # Updates .ralph.json AND auto-syncs RALPH.md
```

**If `ralph` CLI is not available:**
Edit both files to keep them in sync:
1. Edit `.ralph.json` — update `profile.commands.<key>` and recalculate `profile.verify` (the `&&`-joined chain of all non-null commands)
2. Edit `.ralph/RALPH.md` — update the corresponding entries in the managed section between `<!-- ralph:managed:start -->` and `<!-- ralph:managed:end -->`

### Step 5: Check workflow step 6

The verify command in workflow step 6 (`Run verification: \`...\``) is **outside the managed sentinels** — it was rendered at install time and is not auto-updated. Compare it to the managed section's full verify command. If they differ, update step 6 directly to match.

### Step 6: Audit project-specific instructions

The section below `## Project-Specific Instructions` is where project-specific guidance goes — and it survives `ralph update`. Consider adding:

- Key architectural constraints ("never import from X into Y")
- Testing patterns specific to this project ("use factory functions from tests/helpers/")
- Common pitfalls ("the database migration must run before tests")
- File organization rules ("components go in src/components/, not src/pages/")
- Any project conventions that the agent wouldn't know from reading code alone

If this section is empty (just the HTML comment placeholder), that's a missed opportunity. Help the user populate it with the most impactful guidance for their project.

### Step 7: Report findings

Present findings organized as:

1. **Critical issues** — things that will cause the loop to fail (wrong verify commands, .ralph.json/RALPH.md out of sync, broken sentinels)
2. **Improvements** — things that would make the loop more effective (empty project-specific instructions, missing architectural context)
3. **Looks good** — things that are correctly configured

For each issue, explain what's wrong and propose the fix. Apply fixes only after the user confirms.

## Common Issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Loop fails every iteration on verification | Wrong test/build commands in RALPH.md | Fix commands via `ralph profile set` or edit both .ralph.json + RALPH.md |
| Loop produces code that violates project patterns | Empty project-specific instructions in RALPH.md | Add key conventions and constraints to project-specific section |
| `ralph profile set` didn't take effect | RALPH.md not synced after profile change | Run `ralph update` or edit RALPH.md managed section to match |
| Workflow step 6 has stale verify command | Step 6 is outside managed sentinels | Edit step 6 directly to match current verify command |
| Sentinel sections corrupted | Manual editing broke the HTML comment markers | Restore sentinel markers exactly |
| Commands use wrong package manager | Profile detection picked wrong manager | Fix via `ralph profile set . packageManager <correct>` or edit .ralph.json |

## Important: What NOT to change

- Don't modify content inside `<!-- ralph:managed:start/end -->` if you want changes to persist — update `.ralph.json` profile instead (via `ralph profile set` or direct edit) and run `ralph update`
- Don't remove the sentinel markers themselves — ralph uses these to find and update its sections
- Don't add ralph-loop-specific instructions to CLAUDE.md outside its sentinels — put them in RALPH.md's project-specific section instead, because CLAUDE.md is read by ALL agent sessions (not just the loop)
