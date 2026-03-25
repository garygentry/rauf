---
title: CLI Reference
description: Command-line interface specification — commands, flags, exit codes, and output formats.
---

Reference: `packages/cli/`

## Binary

Name: `ralph` (global).

---

## Command Overview

A quick-reference summary of all ralph commands organized by group. Click a group or command name to jump to its detailed specification.

### [loop](#loop) — Run and manage the autonomous coding loop

| Command                                | Description                                                    |
| -------------------------------------- | -------------------------------------------------------------- |
| [loop start](#ralph-loop-start-path)   | Start a loop via the server API (auto-starts server if needed) |
| [loop stop](#ralph-loop-stop-path)     | Stop a running loop gracefully                                 |
| [loop follow](#ralph-loop-follow-path) | Stream live events from a running loop                         |
| [loop run](#ralph-loop-run-path)       | Run a loop directly in-process (no server required)            |
| [loop review](#ralph-loop-review-path) | Run a standalone review pass over completed backlog items      |

### [server](#server) — Manage the ralph web server

| Command                                 | Description                                 |
| --------------------------------------- | ------------------------------------------- |
| [server start](#ralph-server-start)     | Start the web server (foreground or daemon) |
| [server stop](#ralph-server-stop)       | Stop the running server                     |
| [server restart](#ralph-server-restart) | Stop and restart the server                 |
| [server status](#ralph-server-status)   | Show server PID, port, and uptime           |
| [server logs](#ralph-server-logs)       | Tail the server log file                    |

### [backlog](#backlog) — Manage the project task backlog

| Command                                                        | Description                                    |
| -------------------------------------------------------------- | ---------------------------------------------- |
| [backlog list](#ralph-backlog-list-path)                       | List backlog items (filterable by status/type) |
| [backlog add](#ralph-backlog-add-path)                         | Add a new backlog item                         |
| [backlog show](#ralph-backlog-show-path-id)                    | Show details for a single backlog item         |
| [backlog edit](#ralph-backlog-edit-path-id)                    | Edit fields on an existing backlog item        |
| [backlog delete](#ralph-backlog-delete-path-id)                | Delete a backlog item                          |
| [backlog restore](#ralph-backlog-restore-path)                 | Restore backlog from the `.bak` backup file    |
| [backlog sweep](#ralph-backlog-sweep-path)                     | Archive completed (`done`) items               |
| [backlog reset](#ralph-backlog-reset-path)                     | Reset project state for a fresh backlog cycle  |
| [backlog archive list](#ralph-backlog-archive-list-path)       | List archive months with item counts           |
| [backlog archive view](#ralph-backlog-archive-view-path-month) | View archived items for a given month          |
| [backlog archive purge](#ralph-backlog-archive-purge-path)     | Delete archive files                           |

### [projects](#projects) — Discover and inspect ralph-enabled projects

| Command                                   | Description                                             |
| ----------------------------------------- | ------------------------------------------------------- |
| [projects list](#ralph-projects-list)     | Discover and list all ralph-enabled projects under root |
| [projects status](#ralph-projects-status) | Show loop state and backlog summary for all projects    |

### [install / update / uninstall / init](#installation) — Install and manage ralph in a project

| Command                            | Description                                             |
| ---------------------------------- | ------------------------------------------------------- |
| [install](#ralph-install-path)     | Install ralph artifacts into an existing project        |
| [update](#ralph-update-path)       | Update ralph artifacts in an existing installation      |
| [uninstall](#ralph-uninstall-path) | Remove ralph from a project                             |
| [init](#ralph-init-path)           | Scaffold a brand new ralph-managed project from scratch |

### [status / log / progress](#monitoring) — Monitor a project

| Command                          | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| [status](#ralph-status-path)     | Show loop state and backlog summary for a project     |
| [log](#ralph-log-path)           | Tail the ralph loop log file                          |
| [progress](#ralph-progress-path) | Display the project's `progress.md` accumulation file |

### [profile](#profile) — Manage per-project tech stack profile

| Command                                          | Description                                        |
| ------------------------------------------------ | -------------------------------------------------- |
| [profile show](#ralph-profile-show-path)         | Show the current profile for a project             |
| [profile detect](#ralph-profile-detect-path)     | Re-run auto-detection (read-only, does not write)  |
| [profile set](#ralph-profile-set-path-key-value) | Update a single profile field and re-sync RALPH.md |

### [config](#config) — Manage global tool configuration

| Command                                   | Description                      |
| ----------------------------------------- | -------------------------------- |
| [config get](#ralph-config-get-key)       | Get a single global config value |
| [config set](#ralph-config-set-key-value) | Set a single global config value |
| [config list](#ralph-config-list)         | List all global config values    |

### [version / help](#utilities) — Utilities

| Command                     | Description             |
| --------------------------- | ----------------------- |
| [version](#ralph-version)   | Print the ralph version |
| [help](#ralph-help-command) | Show help for a command |

---

## Global Flags

| Flag             | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `--json`         | Machine-readable JSON output (on read commands)                 |
| `--no-color`     | Suppress ANSI codes (auto-detected via NO_COLOR env or non-TTY) |
| `--quiet` / `-q` | Suppress informational output (errors only)                     |
| `--root <path>`  | Override ROOT_DIRECTORY for this invocation                     |

## Exit Codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | Success                                           |
| 1    | General error                                     |
| 2    | Invalid arguments                                 |
| 3    | Project not found or not ralph-enabled            |
| 4    | Validation error (malformed files)                |
| 5    | Conflict (loop running, cannot perform operation) |

---

## Command Details

---

## loop

Subcommands that run and manage the autonomous coding loop. The loop processes backlog items one at a time, spawning Claude sessions to implement each item.

### ralph loop start [path]

Start a loop for the project at `[path]` (defaults to `.`) via the server API. Auto-starts the server daemon if not already running.

- `--iterations N`: max iterations (default: 20)
- `--retries N`: max retries per item (default: 3)
- `--model <model>`: model override (e.g., `claude-opus-4-6`)
- `--timeout N`: session timeout in minutes (default: 60)
- `--follow`: stream SSE events inline after starting
- Prints a follow hint on success (unless `--follow` is used)
- API: `POST /api/projects/:id/loop/start`
- Returns exit code 5 if a loop is already running for this project

### ralph loop stop [path]

Stop a running loop gracefully for the project at `[path]` (defaults to `.`).

- Sends a graceful cancel via `POST /api/projects/:id/loop/stop`
- Requires the server to be running (does not auto-start)
- Returns exit code 3 if no active loop found for the project

### ralph loop follow [path]

Attach to a running loop and stream its events to the terminal.

- Connects to `GET /api/projects/:id/loop/events` (SSE)
- Events are formatted with colors and Unicode icons (iteration, item selection, signals, etc.)
- Requires the server to be running
- Runs until the loop completes or Ctrl+C

### ralph loop run [path]

Run the loop directly in-process without the server. Equivalent to `loop start + loop follow` but self-contained.

- `--iterations N`: max iterations (default: 20)
- `--retries N`: max retries per item (default: 3)
- `--model <model>`: model override
- `--timeout N`: session timeout in minutes (default: 60)
- `--review`: enable a post-loop review pass after all items complete
- `--review-only`: run review only — create fix items but do not process them (implies `--review`)
- Events are printed directly to the terminal with colors and Unicode icons
- Responds to SIGINT/SIGTERM for graceful cancellation
- With `--json`: outputs `LoopResult { completedCount, blockedCount, cancelled, reviewItemsCreated?, reviewSummary? }`

### ralph loop review [path]

Run a standalone review pass over all completed backlog items, without running a full loop.

- Reads all `done` items, spawns a review Claude session, and creates fix items with `source: "review"`
- `--model <model>`: model override
- `--timeout N`: session timeout in minutes (default: 60)
- Outputs a review summary or "no issues found"

---

## server

Subcommands that manage the ralph web server process. The server exposes a REST + SSE API used by the web UI and the `loop start/stop/follow` CLI commands.

State is stored in `~/.ralph/server.json` (PID, port, startedAt). Logs go to `~/.ralph/server.log`.

### ralph server start

Start the web server.

- `--foreground` (default in TTY): run in the foreground, log to stdout
- `--daemon`: fork to background, write state to `~/.ralph/server.json`, log to `~/.ralph/server.log`
- Checks for an existing server (state file + health endpoint ping) before starting; cleans up stale state from orphaned processes
- Prints URL on startup: `Ralph server running at http://localhost:5173`
- `--port N`: override the port (default from global config)

### ralph server stop

Stop the running server.

- Reads PID from `~/.ralph/server.json`, sends SIGTERM
- Waits 5s for graceful shutdown, then sends SIGKILL
- Reports success or "no server running"

### ralph server restart

Stop the server if running, then start it again.

### ralph server status

Show the current server state.

- Pings the health endpoint (`GET /api/health`) to confirm the server is live
- Displays PID, port, uptime, and version
- `--json`: outputs `{ pid, port, uptime, version }` or `{ running: false }`

### ralph server logs

Tail the server log file (`~/.ralph/server.log`).

- `--tail N`: show the last N lines (default: 50)

---

## backlog

Subcommands that manage the project backlog — the task queue that the ralph loop processes. Backlog state lives in `.ralph/backlog.json` and is written atomically (write `.tmp` → rename) with a `.bak` backup.

### ralph backlog list [path]

List backlog items for the project at `[path]`.

- Default: human-readable table with columns: ID, Type, Pri, Status, Title
- `--status <s>`: filter by status (`pending`, `in_progress`, `done`, `blocked`)
- `--type <t>`: filter by type (`bug`, `refactor`, `feature`, `chore`)
- `--json`: output the raw JSON array

### ralph backlog add [path]

Add a new item to the backlog.

- `--title "..."` (required)
- `--type <t>` (required): `bug`, `refactor`, `feature`, or `chore`
- `--priority N`: priority 1–4 (default: 2)
- `--description`: detailed description
- `--notes`: free-text notes
- `--depends-on`: comma-separated item IDs this item depends on
- `--estimated-iterations N`: estimated loop iterations to complete
- `--ac "criterion"` (repeatable): each flag adds one acceptance criterion
- If no `--ac` flags are provided, a smart default is applied and a warning is printed
- Prints the new item ID on success

### ralph backlog show [path] [id]

Show full details for a single backlog item.

- Formatted output with all fields and acceptance criteria as a bulleted list
- `--json`: output the raw item object

### ralph backlog edit [path] [id]

Edit fields on an existing backlog item. Only the fields you provide are updated.

- `--title`, `--type`, `--priority`, `--status`, `--description`, `--notes`, `--depends-on`, `--blocked-reason`, `--estimated-iterations`
- `--ac "criterion"` (repeatable): **replaces** the entire acceptance criteria array (not append)
- Status transitions are validated: `pending → in_progress`, `in_progress → done/blocked`, `blocked → pending`

### ralph backlog delete [path] [id]

Delete a backlog item permanently.

- `--yes`: required to confirm the deletion

### ralph backlog restore [path]

Restore the backlog from the `.bak` backup file created during the last write.

- `--yes`: required to confirm the restore

### ralph backlog sweep [path]

Archive completed (`done`) items out of the active backlog into monthly archive files.

- Archives to `.ralph/archive/YYYY-MM.json` grouped by `completedAt` month
- Items with `completedAt: null` fall back to the current calendar month
- `--min-age-days N`: only sweep items completed more than N days ago (0 = all done items)
- `--dry-run`: preview what would be swept without writing any files (does not require `--yes`)
- `--yes`: required for actual confirmation (without it, exits non-zero)
- `--json`: output `{ archivedCount, archivedMonths }`

### ralph backlog reset [path]

Orchestrate a full project reset for a fresh backlog cycle.

- `--yes`: required for confirmation
- `--json`: output the result object as JSON

**Without `--clear`** (soft reset): sweeps done items to archive, resets `in_progress` → `pending`, clears `state.json`/DONE/CANCEL markers. `progress.md` and `ralph.log` are untouched.

**With `--clear`** (full reset): everything above, plus empties the backlog items array and archives `progress.md` and `ralph.log` to `.ralph/archive/` with timestamp-based names (`YYYYMMDD-HHmmss-progress.md`, `YYYYMMDD-HHmmss-ralph.log`). A fresh `progress.md` template is deployed; `ralph.log` is recreated on the next loop run.

- `--keep-progress`: (with `--clear`) preserve `progress.md` instead of archiving it
- `--keep-log`: (with `--clear`) preserve `ralph.log` instead of archiving it

### ralph backlog archive list [path]

List all archive months with item counts.

- Output: `Month | Items` table
- `--json`: output `[{ month, count }]`

### ralph backlog archive view [path] [month]

View archived items for a given month.

- `<month>` must be in `YYYY-MM` format
- Output: table of archived items
- `--json`: output the full `ArchiveMonth` object

### ralph backlog archive purge [path]

Delete archive files. Requires `--yes` for confirmation.

- `--month YYYY-MM`: delete only the specified month's archive file
- Without `--month`: delete all archive files and remove the `.ralph/archive/` directory
- Non-existent months are silently treated as a no-op (idempotent)

---

## projects

Subcommands that discover and inspect all ralph-enabled projects under the configured root directory.

### ralph projects list

Discover and list all ralph-enabled projects under `ROOT_DIRECTORY`.

- Use `--root <path>` global flag to override the root for this invocation
- Output: table with Name, Stack, Pkg Mgr, Monorepo, Path
- Also lists ignored projects if any are found

### ralph projects status

Show loop state and backlog progress for all discovered projects.

- Use `--root <path>` global flag to override the root
- Output: table with Name, State, Backlog Progress, Path
- Derives status for each project independently by reading its files directly (no subprocesses)

---

## installation

Commands to install, update, and remove ralph from projects, or scaffold new projects from scratch.

### ralph install [path]

Install ralph artifacts into an existing project at `[path]`.

- Auto-detects the tech stack and displays results
- Runs preflight checks before installing (unless `--yes` is passed)
- `--yes`: skip confirmations and use detected defaults
- `--gitignore-scripts`: add `.sh` files to `.gitignore`
- Profile command overrides: `--test-cmd`, `--typecheck-cmd`, `--lint-cmd`, `--build-cmd`, `--format-cmd`
- Prints an installation report to stdout on success

### ralph update [path]

Update ralph artifacts in an existing installation.

- `--yes`: skip confirmation prompts

### ralph uninstall [path]

Remove ralph from a project.

- Removes all ralph artifacts and the CLAUDE_ADDON section from `CLAUDE.md`
- `--yes`: skip confirmation
- `--keep-data`: keep `backlog.json`, `progress.md`, and `ralph.log` (data is preserved by default)

### ralph init [path]

Scaffold a brand new ralph-managed project from scratch (greenfield).

- Creates the directory, runs `git init`, scaffolds `CLAUDE.md`, and installs artifacts
- `--name <name>`: project name (default: directory name)
- `--description <desc>`: project description for `CLAUDE.md`
- `--stack <preset>`: tech stack preset (`node-typescript`, `node-javascript`, `python`, `go`, `rust`, `custom`)
- `--seed <file>`: seed the backlog from a JSON or markdown file
- Profile command overrides: `--test-cmd`, `--typecheck-cmd`, `--lint-cmd`, `--build-cmd`, `--format-cmd`
- Prints a creation report with next steps

---

## monitoring

Commands to monitor a project's loop state and logs.

### ralph status [path]

Show a status summary for the project at `[path]`.

- Output: loop state, current iteration, current item, elapsed time, backlog counts
- Indicates state source: "via state.json" or "via log parsing (fallback)"
- `--watch`: continuously refresh the status display (clears and redraws screen)
- `--interval N`: refresh interval in seconds (default: 2, requires `--watch`)

**Machine-friendly exit codes for `ralph status`:**

| Code | Loop State                                      |
| ---- | ----------------------------------------------- |
| 0    | IDLE, COMPLETE, PAUSED, ERROR, or NOT_INSTALLED |
| 1    | RUNNING                                         |
| 2    | PAUSED_HUMAN (needs human input)                |
| 3    | LIMIT_REACHED                                   |

### ralph log [path]

Tail the ralph loop log file (`.ralph/ralph.log`) for the project at `[path]`.

- `--tail N`: show the last N lines (default: 20)
- `--follow`: stream new lines as they are written (tail -f behavior), runs until Ctrl+C

### ralph progress [path]

Display the contents of `.ralph/progress.md` — the accumulation file where the loop records project learnings.

- `--json`: output `{ content: "..." }` or `{ content: null }` if the file does not exist

---

## profile

Subcommands that manage the per-project tech stack profile stored in `.ralph.json`. The profile drives which verification commands the loop runs.

### ralph profile show [path]

Show the current profile for the project at `[path]`.

- Output: Stack, Package Manager, Monorepo, and all configured commands (test, typecheck, lint, build, format), plus the composite `verify` command

### ralph profile detect [path]

Re-run auto-detection against the project at `[path]` and show what would change.

- Read-only — does not write anything
- To apply changes, use `ralph profile set` or `ralph update`

### ralph profile set [path] [key] [value]

Update a single profile field and automatically re-sync the verification commands in `RALPH.md`.

- Valid keys: `test`, `typecheck`, `lint`, `build`, `format`, `stack`, `packageManager`, `monorepo`
- Set a command key to `""` to disable it (stored as `null`)

---

## config

Subcommands that manage the global ralph tool configuration stored in `~/.ralph/config.json`.

### ralph config get [key]

Get a single global config value.

- Valid keys: `rootDirectory`, `port`, `theme`

### ralph config set [key] [value]

Set a single global config value.

- Valid keys: `rootDirectory`, `port`, `theme`
- `port`: must be a positive integer
- `theme`: must be `light`, `dark`, or `system`
- `rootDirectory`: resolved to an absolute path via `path.resolve()`

### ralph config list

List all global config values.

---

## utilities

### ralph version

Print the ralph version string.

- `--json`: output `{ version: "..." }`

### ralph help [command]

Show help for all commands or for a specific command.

- `--json`: output the help content as structured JSON

---

## Output Formatting

Human-readable:

- Tables: simple ASCII with column alignment
- Status badges: Unicode indicators (✓, ⚠, ✗, ●)
- Colors: via picocolors (respects NO_COLOR, non-TTY detection)

Machine-readable (`--json`):

- Raw JSON to stdout
- Errors to stderr
- No ANSI codes

## Headless vs Server Mode

The loop commands (`loop start`, `loop stop`, `loop follow`) require the server. All other commands call `packages/core` functions directly in-process and work without the server running.

`loop start` automatically starts the server daemon if it is not already running, so you rarely need to manage the server manually.
