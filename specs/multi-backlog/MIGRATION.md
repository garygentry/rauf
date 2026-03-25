# Multi-Backlog Migration Guide

## Do I Need to Migrate?

**If your project uses only the default `.ralph/` directory** (i.e., your backlog lives at `.ralph/backlog.json` and you have never used the `--backlog` flag), **no migration is needed.** The default root layout is unchanged — everything works exactly as before.

Migration is only relevant if you want to:

- Run ralph against a backlog located outside `.ralph/` (e.g., `specs/auth/backlog.json`)
- Use feature-forge generated backlogs in place without copying them to `.ralph/`
- Operate multiple independent backlogs within the same project

## What Changed

The multi-backlog feature introduces the concept of a **backlog root** — any directory containing a `backlog.json` that ralph can target via the `--backlog` flag. Each backlog root gets its own isolated state directory (`.ralph/` subdirectory within the root) containing `state.json`, `ralph.log`, `progress.md`, and other runtime files.

Key changes:

- All CLI commands now accept `--backlog <dir>` to specify a non-default backlog root
- State files are isolated per backlog root (no cross-contamination)
- A lock file (`.loop.lock`) prevents concurrent loops on the same root
- `ralph status` shows the default root plus any active non-default roots
- Artifact templates (RALPH.md, CLAUDE_ADDON.md) use path-agnostic wording; actual paths are injected at runtime via the "Active Backlog Root" prompt section

## Step-by-Step: Adding a Non-Default Backlog Root

Follow these steps to set up a new backlog root for a feature or module:

### 1. Create the backlog directory

Choose a location within your project for the new backlog. Common conventions:

```bash
# Feature-forge convention
specs/my-feature/

# Module-based convention
modules/auth/

# Any directory within the project root works
backlogs/sprint-42/
```

### 2. Place or create a backlog.json

Either copy an existing backlog or create a new one:

```bash
# Option A: Use an existing backlog (e.g., from feature-forge)
# The file is already at specs/my-feature/backlog.json — no action needed

# Option B: Create a new backlog
ralph backlog add . --backlog specs/my-feature
# This creates specs/my-feature/backlog.json if it doesn't exist
```

The `backlog.json` can live either directly in the backlog root directory or inside its `.ralph/` subdirectory. Ralph checks the root directory first, then falls back to the `.ralph/` subdirectory.

### 3. Run the loop against the new root

```bash
ralph loop run . --backlog specs/my-feature
```

On first run, ralph automatically:

- Creates the state directory (`specs/my-feature/.ralph/`)
- Creates `state.json`, `ralph.log`, and other state files inside it
- Acquires a lock file to prevent concurrent execution
- Resolves instruction files (RALPH.md) with per-root override support

### 4. Manage the backlog

All backlog commands work with the `--backlog` flag:

```bash
ralph backlog list . --backlog specs/my-feature
ralph backlog add . --backlog specs/my-feature
ralph backlog show . --backlog specs/my-feature 001
ralph status . --backlog specs/my-feature
ralph progress . --backlog specs/my-feature
ralph log . --backlog specs/my-feature
ralph reset . --backlog specs/my-feature
```

### 5. (Optional) Add per-root instructions

If you want custom RALPH.md instructions for this specific backlog root (rather than using the project-wide `.ralph/RALPH.md`), create:

```
specs/my-feature/.ralph/RALPH.md
```

Ralph checks for per-root RALPH.md first, then falls back to the project-level `.ralph/RALPH.md`.

### 6. Verify isolation

Check that state files are correctly isolated:

```bash
# State for the new root
ls specs/my-feature/.ralph/
# Should contain: state.json, ralph.log, progress.md, iteration-status.json, etc.

# Default root is unaffected
ls .ralph/
# Still contains its own state.json, backlog.json, etc.
```

## Migrating an Existing Backlog to a Non-Default Root

If you have work items in `.ralph/backlog.json` that you want to move to a feature-specific location:

1. **Copy the backlog:**

   ```bash
   mkdir -p specs/my-feature
   cp .ralph/backlog.json specs/my-feature/backlog.json
   ```

2. **Optionally copy progress:**

   ```bash
   mkdir -p specs/my-feature/.ralph
   cp .ralph/progress.md specs/my-feature/.ralph/progress.md
   ```

3. **Remove migrated items from the default backlog** (if they should no longer appear there).

4. **Run against the new root:**
   ```bash
   ralph loop run . --backlog specs/my-feature
   ```

Note: State files (`state.json`, `ralph.log`) are not worth migrating — they reset naturally when the loop starts on a new root.

## Agent Prompt for Automated Migration

The following prompt can be pasted into a Claude Code session to automate the migration of backlog items from the default root to a non-default backlog root. Replace `TARGET_DIR` with your desired backlog root path.

---

````
You are migrating a ralph project from single-backlog to multi-backlog layout. The goal is to move backlog items from the default `.ralph/backlog.json` to a feature-specific backlog root.

## Configuration

- **Target backlog root:** TARGET_DIR (replace with actual path, e.g., specs/my-feature)
- **Project root:** . (current directory)

## Steps

1. Read `.ralph/backlog.json` to understand the current backlog contents.

2. Read `.ralph/progress.md` if it exists — this contains accumulated learnings.

3. Create the target directory structure:
   ```bash
   mkdir -p TARGET_DIR
   mkdir -p TARGET_DIR/.ralph
   ```

4. Copy the backlog to the new location:
   ```bash
   cp .ralph/backlog.json TARGET_DIR/backlog.json
   ```

5. Copy progress learnings if they exist:
   ```bash
   if [ -f .ralph/progress.md ]; then
     cp .ralph/progress.md TARGET_DIR/.ralph/progress.md
   fi
   ```

6. Verify the new backlog root works:
   ```bash
   ralph backlog list . --backlog TARGET_DIR
   ```
   Confirm the output matches the original backlog items.

7. Verify status shows the new root:
   ```bash
   ralph status . --backlog TARGET_DIR
   ```

8. Clean up the default backlog (ONLY if all items were moved):
   - If the default `.ralph/backlog.json` should be emptied, remove completed/moved items
   - If the default root is no longer needed for loop execution, you can leave it with an empty items array
   - Do NOT delete `.ralph/` itself — it is still the project's ralph installation marker

9. Report what was done:
   - How many items were migrated
   - The new backlog root path
   - Whether progress.md was copied
   - Any items left in the default backlog

## Important Rules

- Do NOT delete `.ralph/` or `.ralph.json` — these are required for ralph to recognize the project
- Do NOT modify `.ralph/state.json` — the loop runner manages it
- The target backlog root must be WITHIN the project root (no path traversal)
- If the default backlog has items that belong to different features, ask the user which items go where before splitting
````

---

## Troubleshooting

### "PATH_VIOLATION" error with --backlog

The backlog root path must resolve to a location within the project root (the directory containing `.ralph.json`). Paths like `../../other-project` are rejected. Use a relative path within the project.

### "LOCK_CONFLICT" error when starting a loop

Another loop process is already running against this backlog root. Either:

- Wait for it to finish
- Stop it with `ralph loop stop . --backlog <dir>`
- Force-clear with `ralph loop run . --backlog <dir> --force` (use with caution)

### State files appearing in the wrong location

Ensure you're passing the `--backlog` flag to every command. Without it, ralph defaults to `.ralph/`. The state directory is always `{backlog-root}/.ralph/` (except for the default root where it's `.ralph/` itself).
