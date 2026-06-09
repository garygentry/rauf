---
name: review-rauf-guidance
description: >
  Review and update the rauf-installed guidance file (.rauf/RAUF.md)
  in a rauf-managed project to ensure it's accurate for the target project.
  Use this skill when the user asks to "review rauf guidance", "check rauf config",
  "audit rauf files", "update RAUF.md", "fix my rauf setup", or asks whether
  .rauf/RAUF.md is correct for their project. Also use when the user
  reports that the rauf loop is using wrong verification commands, missing project
  context, or behaving as if it doesn't understand the project.
---

# Review Rauf Guidance

When rauf is installed into a project, it creates `.rauf/RAUF.md` — the primary file the autonomous loop agent reads every iteration. If this file is wrong, the loop will waste iterations or produce broken work. This skill walks you through auditing it and fixing any issues.

## `.rauf/RAUF.md` — Per-iteration agent instructions

This file contains:

1. **Verification commands** (inside `<!-- rauf:managed:start -->` / `<!-- rauf:managed:end -->` sentinels) — the test/typecheck/lint/build/format commands the agent runs before marking work complete. These are overwritten by `rauf update`.
2. **Workflow** — step-by-step iteration process (read backlog → implement → verify → commit → signal). Note: the verify command in workflow step 6 is outside the managed sentinels — it is NOT auto-updated.
3. **Agent delegation** — instructions for using sub-agents when `agentDelegation` is present on a backlog item
4. **Important rules** — constraints like "work on ONE item only" and "don't modify backlog.json"
5. **Project-specific instructions** — a section at the bottom where custom guidance can be added. This section survives `rauf update`.

## Review Process

### Step 1: Read the files

```
Read .rauf/RAUF.md
Read .rauf.json
```

The marker file's `profile` field shows what rauf detected during installation — stack, package manager, monorepo flag, and commands. This is what drove the template rendering.

### Step 2: Check .rauf.json ↔ RAUF.md sync

Compare the commands in `.rauf.json` `profile.commands` and `profile.verify` against the rendered commands in RAUF.md's managed section. They should match exactly. If they don't, the files are out of sync — likely someone ran `rauf profile set` without `rauf update` afterward. Flag this as a **critical issue** before proceeding.

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

**If `rauf` CLI is available:**

```bash
rauf profile set . <key> <value>   # Updates .rauf.json AND auto-syncs RAUF.md
```

**If `rauf` CLI is not available:**
Edit both files to keep them in sync:

1. Edit `.rauf.json` — update `profile.commands.<key>` and recalculate `profile.verify` (the `&&`-joined chain of all non-null commands)
2. Edit `.rauf/RAUF.md` — update the corresponding entries in the managed section between `<!-- rauf:managed:start -->` and `<!-- rauf:managed:end -->`

### Step 5: Check workflow step 6

The verify command in workflow step 6 (`Run verification: \`...\``) is **outside the managed sentinels** — it was rendered at install time and is not auto-updated. Compare it to the managed section's full verify command. If they differ, update step 6 directly to match.

### Step 6: Audit project-specific instructions

The section below `## Project-Specific Instructions` is where project-specific guidance goes — and it survives `rauf update`. Consider adding:

- Key architectural constraints ("never import from X into Y")
- Testing patterns specific to this project ("use factory functions from tests/helpers/")
- Common pitfalls ("the database migration must run before tests")
- File organization rules ("components go in src/components/, not src/pages/")
- Any project conventions that the agent wouldn't know from reading code alone

If this section is empty (just the HTML comment placeholder), that's a missed opportunity. Help the user populate it with the most impactful guidance for their project.

### Step 7: Report findings

Present findings organized as:

1. **Critical issues** — things that will cause the loop to fail (wrong verify commands, .rauf.json/RAUF.md out of sync, broken sentinels)
2. **Improvements** — things that would make the loop more effective (empty project-specific instructions, missing architectural context)
3. **Looks good** — things that are correctly configured

For each issue, explain what's wrong and propose the fix. Apply fixes only after the user confirms.

## Common Issues

| Symptom                                           | Likely cause                                   | Fix                                                                      |
| ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Loop fails every iteration on verification        | Wrong test/build commands in RAUF.md           | Fix commands via `rauf profile set` or edit both .rauf.json + RAUF.md    |
| Loop produces code that violates project patterns | Empty project-specific instructions in RAUF.md | Add key conventions and constraints to project-specific section          |
| `rauf profile set` didn't take effect             | RAUF.md not synced after profile change        | Run `rauf update` or edit RAUF.md managed section to match               |
| Workflow step 6 has stale verify command          | Step 6 is outside managed sentinels            | Edit step 6 directly to match current verify command                     |
| Sentinel sections corrupted                       | Manual editing broke the HTML comment markers  | Restore sentinel markers exactly                                         |
| Commands use wrong package manager                | Profile detection picked wrong manager         | Fix via `rauf profile set . packageManager <correct>` or edit .rauf.json |

## Important: What NOT to change

- Don't modify content inside `<!-- rauf:managed:start/end -->` if you want changes to persist — update `.rauf.json` profile instead (via `rauf profile set` or direct edit) and run `rauf update`
- Don't remove the sentinel markers themselves — rauf uses these to find and update its sections
- Don't add rauf-loop-specific instructions to CLAUDE.md outside its sentinels — put them in RAUF.md's project-specific section instead, because CLAUDE.md is read by ALL agent sessions (not just the loop)
