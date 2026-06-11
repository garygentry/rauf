---
title: CLI Reference
description: Command-line interface specification — commands, flags, exit codes, and output formats.
---

Reference: `packages/cli/`

## Binary

Name: `rauf` (global).

---

## Command Overview

A quick-reference summary of all rauf commands organized by group. Click a group or command name to jump to its detailed specification.

### [loop](#loop) — Run and manage the autonomous coding loop

| Command                               | Description                                                    |
| ------------------------------------- | -------------------------------------------------------------- |
| [loop start](#rauf-loop-start-path)   | Start a loop via the server API (auto-starts server if needed) |
| [loop stop](#rauf-loop-stop-path)     | Stop a running loop gracefully                                 |
| [loop follow](#rauf-loop-follow-path) | Stream live events from a running loop                         |
| [loop run](#rauf-loop-run-path)       | Run a loop directly in-process (no server required)            |
| [loop review](#rauf-loop-review-path) | Run a standalone review pass over completed backlog items      |

### [server](#server) — Manage the rauf web server

| Command                                | Description                                 |
| -------------------------------------- | ------------------------------------------- |
| [server start](#rauf-server-start)     | Start the web server (foreground or daemon) |
| [server stop](#rauf-server-stop)       | Stop the running server                     |
| [server restart](#rauf-server-restart) | Stop and restart the server                 |
| [server status](#rauf-server-status)   | Show server PID, port, and uptime           |
| [server logs](#rauf-server-logs)       | Tail the server log file                    |

### [backlog](#backlog) — Manage the project task backlog

| Command                                                       | Description                                    |
| ------------------------------------------------------------- | ---------------------------------------------- |
| [backlog list](#rauf-backlog-list-path)                       | List backlog items (filterable by status/type) |
| [backlog add](#rauf-backlog-add-path)                         | Add a new backlog item                         |
| [backlog show](#rauf-backlog-show-path-id)                    | Show details for a single backlog item         |
| [backlog edit](#rauf-backlog-edit-path-id)                    | Edit fields on an existing backlog item        |
| [backlog delete](#rauf-backlog-delete-path-id)                | Delete a backlog item                          |
| [backlog restore](#rauf-backlog-restore-path)                 | Restore backlog from the `.bak` backup file    |
| [backlog sweep](#rauf-backlog-sweep-path)                     | Archive completed (`done`) items               |
| [backlog reset](#rauf-backlog-reset-path)                     | Reset project state for a fresh backlog cycle  |
| [backlog archive list](#rauf-backlog-archive-list-path)       | List archive months with item counts           |
| [backlog archive view](#rauf-backlog-archive-view-path-month) | View archived items for a given month          |
| [backlog archive purge](#rauf-backlog-archive-purge-path)     | Delete archive files                           |

### [projects](#projects) — Discover and inspect rauf-enabled projects

| Command                                  | Description                                            |
| ---------------------------------------- | ------------------------------------------------------ |
| [projects list](#rauf-projects-list)     | Discover and list all rauf-enabled projects under root |
| [projects status](#rauf-projects-status) | Show loop state and backlog summary for all projects   |

### [install / update / uninstall / init](#installation) — Install and manage rauf in a project

| Command                           | Description                                            |
| --------------------------------- | ------------------------------------------------------ |
| [install](#rauf-install-path)     | Install rauf artifacts into an existing project        |
| [update](#rauf-update-path)       | Update rauf artifacts in an existing installation      |
| [uninstall](#rauf-uninstall-path) | Remove rauf from a project                             |
| [init](#rauf-init-path)           | Scaffold a brand new rauf-managed project from scratch |

### [status / log / progress](#monitoring) — Monitor a project

| Command                         | Description                                           |
| ------------------------------- | ----------------------------------------------------- |
| [status](#rauf-status-path)     | Show loop state and backlog summary for a project     |
| [log](#rauf-log-path)           | Tail the rauf loop log file                           |
| [progress](#rauf-progress-path) | Display the project's `progress.md` accumulation file |

### [reset / resume](#recovery) — Recover from an interrupted loop

| Command                     | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| [reset](#rauf-reset-path)   | Reconcile committed work, requeue false blocks, clear stale lock |
| [resume](#rauf-resume-path) | Recover an interrupted loop and continue from where it stopped   |

### [profile](#profile) — Manage per-project tech stack profile

| Command                                         | Description                                       |
| ----------------------------------------------- | ------------------------------------------------- |
| [profile show](#rauf-profile-show-path)         | Show the current profile for a project            |
| [profile detect](#rauf-profile-detect-path)     | Re-run auto-detection (read-only, does not write) |
| [profile set](#rauf-profile-set-path-key-value) | Update a single profile field and re-sync RAUF.md |

### [config](#config) — Manage global tool configuration

| Command                                  | Description                      |
| ---------------------------------------- | -------------------------------- |
| [config get](#rauf-config-get-key)       | Get a single global config value |
| [config set](#rauf-config-set-key-value) | Set a single global config value |
| [config list](#rauf-config-list)         | List all global config values    |

### [version / help](#utilities) — Utilities

| Command                    | Description             |
| -------------------------- | ----------------------- |
| [version](#rauf-version)   | Print the rauf version  |
| [help](#rauf-help-command) | Show help for a command |

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
| 3    | Project not found or not rauf-enabled             |
| 4    | Validation error (malformed files)                |
| 5    | Conflict (loop running, cannot perform operation) |

---

## Command Details

---

## loop

Subcommands that run and manage the autonomous coding loop. The loop processes backlog items one at a time, spawning Claude sessions to implement each item.

### rauf loop start [path]

Start a loop for the project at `[path]` (defaults to `.`) via the server API. Auto-starts the server daemon if not already running.

- `--iterations N`: max iterations (default: derived from backlog via `computeMaxIterations` — `ceil(pending × avgEstimatedIterations × 1.5) + 5`, floored at 20; the math is logged at startup)
- `--retries N`: max retries per item (default: 3)
- `--model <model>`: model override (e.g., `claude-opus-4-6`)
- `--timeout N`: session timeout in minutes (default: 60)
- `--follow`: stream SSE events inline after starting
- Prints a follow hint on success (unless `--follow` is used)
- API: `POST /api/projects/:id/loop/start`
- Returns exit code 5 if a loop is already running for this project

### rauf loop stop [path]

Stop a running loop gracefully for the project at `[path]` (defaults to `.`).

- Sends a graceful cancel via `POST /api/projects/:id/loop/stop`
- Requires the server to be running (does not auto-start)
- Returns exit code 3 if no active loop found for the project

### rauf loop follow [path]

Attach to a running loop and stream its events to the terminal.

- Connects to `GET /api/projects/:id/loop/events` (SSE)
- Events are formatted with colors and Unicode icons (iteration, item selection, signals, etc.)
- Requires the server to be running
- Runs until the loop completes or Ctrl+C

### rauf loop run [path]

Run the loop directly in-process without the server. Equivalent to `loop start + loop follow` but self-contained.

- `--iterations N`: max iterations (default: derived from backlog via `computeMaxIterations` — `ceil(pending × avgEstimatedIterations × 1.5) + 5`, floored at 20; the math is logged at startup)
- `--retries N`: max retries per item (default: 3)
- `--model <model>`: model override
- `--timeout N`: session timeout in minutes (default: 60)
- `--review`: enable a post-loop review pass after all items complete
- `--review-only`: run review only — create fix items but do not process them (implies `--review`)
- `--suppress-iteration-review`: run child agent sessions with per-iteration review/security hooks suppressed (single-gate review model — see below). Opt-in; default behavior is unchanged.
- Events are printed directly to the terminal with colors and Unicode icons
- Responds to SIGINT/SIGTERM for graceful cancellation
- With `--json`: outputs `LoopResult { completedCount, blockedCount, cancelled, reviewItemsCreated?, reviewSummary? }`

#### Single-gate review (suppressing per-iteration review hooks)

When a commit/`Stop`-triggered review hook (e.g. a globally-installed security-review plugin) is present, it fires inside **every** loop child agent session. For human-in-the-loop autonomous dev that is the wrong altitude — the child agent rubber-stamps its own findings, multiplied across the backlog. The adopted model is **review at the gate**: run the loop quiet, then review the cumulative `main..HEAD` diff **once**, surfaced to the human.

`--suppress-iteration-review` (also settable via the `suppressIterationReview` loop option / `POST /loop/start` body) opts into this. It merges a documented set of hook-suppression environment variables — `REVIEW_HOOK_SUPPRESSION_ENV` in `@rauf/loop` — into every child session the loop spawns. The mechanism is **generic, not hardcoded to one plugin**: the env map is the extension point (currently `ENABLE_CODE_SECURITY_REVIEW=0`), and the lower-level `childEnv` loop option lets callers suppress any hook that honors an env opt-out. Default behavior (flag absent) is unchanged — child sessions inherit the parent environment as-is.

The gate review itself is a deliberate, post-loop step over the branch diff — run `git diff main..HEAD`, open a PR (let a review hook / CI run there), or use `rauf loop review` — never per item inside the loop.

### rauf loop review [path]

Run a standalone review pass over all completed backlog items, without running a full loop.

- Reads all `done` items, spawns a review Claude session, and creates fix items with `source: "review"`
- `--model <model>`: model override
- `--timeout N`: session timeout in minutes (default: 60)
- Outputs a review summary or "no issues found"

---

## server

Subcommands that manage the rauf web server process. The server exposes a REST + SSE API used by the web UI and the `loop start/stop/follow` CLI commands.

State is stored in `~/.rauf/server.json` (PID, port, startedAt). Logs go to `~/.rauf/server.log`.

### rauf server start

Start the web server.

- `--foreground` (default in TTY): run in the foreground, log to stdout
- `--daemon`: fork to background, write state to `~/.rauf/server.json`, log to `~/.rauf/server.log`
- Checks for an existing server (state file + health endpoint ping) before starting; cleans up stale state from orphaned processes
- Prints URL on startup: `Rauf server running at http://localhost:5173`
- `--port N`: override the port (default from global config)

### rauf server stop

Stop the running server.

- Reads PID from `~/.rauf/server.json`, sends SIGTERM
- Waits 5s for graceful shutdown, then sends SIGKILL
- Reports success or "no server running"

### rauf server restart

Stop the server if running, then start it again.

### rauf server status

Show the current server state.

- Pings the health endpoint (`GET /api/health`) to confirm the server is live
- Displays PID, port, uptime, and version
- `--json`: outputs `{ pid, port, uptime, version }` or `{ running: false }`

### rauf server logs

Tail the server log file (`~/.rauf/server.log`).

- `--tail N`: show the last N lines (default: 50)

---

## backlog

Subcommands that manage the project backlog — the task queue that the rauf loop processes. Backlog state lives in `.rauf/backlog.json` and is written atomically (write `.tmp` → rename) with a `.bak` backup.

### rauf backlog list [path]

List backlog items for the project at `[path]`.

- Default: human-readable table with columns: ID, Type, Pri, Status, Title
- `--status <s>`: filter by status (`pending`, `in_progress`, `done`, `blocked`)
- `--type <t>`: filter by type (`bug`, `refactor`, `feature`, `chore`)
- `--json`: output the raw JSON array

### rauf backlog add [path]

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

### rauf backlog show [path] [id]

Show full details for a single backlog item.

- Formatted output with all fields and acceptance criteria as a bulleted list
- `--json`: output the raw item object

### rauf backlog edit [path] [id]

Edit fields on an existing backlog item. Only the fields you provide are updated.

- `--title`, `--type`, `--priority`, `--status`, `--description`, `--notes`, `--depends-on`, `--blocked-reason`, `--estimated-iterations`
- `--ac "criterion"` (repeatable): **replaces** the entire acceptance criteria array (not append)
- Status transitions are validated: `pending → in_progress`, `in_progress → done/blocked`, `blocked → pending`

### rauf backlog delete [path] [id]

Delete a backlog item permanently.

- `--yes`: required to confirm the deletion

### rauf backlog restore [path]

Restore the backlog from the `.bak` backup file created during the last write.

- `--yes`: required to confirm the restore

### rauf backlog sweep [path]

Archive completed (`done`) items out of the active backlog into monthly archive files.

- Archives to `.rauf/archive/YYYY-MM.json` grouped by `completedAt` month
- Items with `completedAt: null` fall back to the current calendar month
- `--min-age-days N`: only sweep items completed more than N days ago (0 = all done items)
- `--dry-run`: preview what would be swept without writing any files (does not require `--yes`)
- `--yes`: required for actual confirmation (without it, exits non-zero)
- `--json`: output `{ archivedCount, archivedMonths }`

### rauf backlog reset [path]

Orchestrate a full project reset for a fresh backlog cycle.

- `--yes`: required for confirmation
- `--json`: output the result object as JSON

**Without `--clear`** (soft reset): sweeps done items to archive, resets `in_progress` → `pending`, clears `state.json`/DONE/CANCEL markers. `progress.md` and `rauf.log` are untouched.

**With `--clear`** (full reset): everything above, plus empties the backlog items array and archives `progress.md` and `rauf.log` to `.rauf/archive/` with timestamp-based names (`YYYYMMDD-HHmmss-progress.md`, `YYYYMMDD-HHmmss-rauf.log`). A fresh `progress.md` template is deployed; `rauf.log` is recreated on the next loop run.

- `--keep-progress`: (with `--clear`) preserve `progress.md` instead of archiving it
- `--keep-log`: (with `--clear`) preserve `rauf.log` instead of archiving it

### rauf backlog archive list [path]

List all archive months with item counts.

- Output: `Month | Items` table
- `--json`: output `[{ month, count }]`

### rauf backlog archive view [path] [month]

View archived items for a given month.

- `<month>` must be in `YYYY-MM` format
- Output: table of archived items
- `--json`: output the full `ArchiveMonth` object

### rauf backlog archive purge [path]

Delete archive files. Requires `--yes` for confirmation.

- `--month YYYY-MM`: delete only the specified month's archive file
- Without `--month`: delete all archive files and remove the `.rauf/archive/` directory
- Non-existent months are silently treated as a no-op (idempotent)

---

## projects

Subcommands that discover and inspect all rauf-enabled projects under the configured root directory.

### rauf projects list

Discover and list all rauf-enabled projects under `ROOT_DIRECTORY`.

- Use `--root <path>` global flag to override the root for this invocation
- Output: table with Name, Stack, Pkg Mgr, Monorepo, Path
- Also lists ignored projects if any are found

### rauf projects status

Show loop state and backlog progress for all discovered projects.

- Use `--root <path>` global flag to override the root
- Output: table with Name, State, Backlog Progress, Path
- Derives status for each project independently by reading its files directly (no subprocesses)

---

## installation

Commands to install, update, and remove rauf from projects, or scaffold new projects from scratch.

### rauf install [path]

Install rauf artifacts into an existing project at `[path]`.

- Auto-detects the tech stack and displays results
- Runs preflight checks before installing (unless `--yes` is passed)
- `--yes`: skip confirmations and use detected defaults
- `--gitignore-scripts`: add `.sh` files to `.gitignore`
- Profile command overrides: `--test-cmd`, `--typecheck-cmd`, `--lint-cmd`, `--build-cmd`, `--format-cmd`
- Prints an installation report to stdout on success

### rauf update [path]

Update rauf artifacts in an existing installation.

- `--yes`: skip confirmation prompts

### rauf uninstall [path]

Remove rauf from a project.

- Removes all rauf artifacts and the CLAUDE_ADDON section from `CLAUDE.md`
- `--yes`: skip confirmation
- `--keep-data`: keep `backlog.json`, `progress.md`, and `rauf.log` (data is preserved by default)

### rauf init [path]

Scaffold a brand new rauf-managed project from scratch (greenfield).

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

### rauf status [path]

Show a status summary for the project at `[path]`.

- Output: loop state, current iteration, current item, elapsed time, backlog counts, lock liveness, and blocked/deferred breakdown
- **Lock line:** whether `.rauf/.loop.lock` exists and whether its PID is alive (e.g. `Lock: PID 1234 (alive)`, `Lock: stale`, `Lock: none`)
- **Last signal:** the `lastSignal` from `state.json` (e.g. `clean`, `blocked`, `needs_human`)
- **Blocked breakdown:** `Blocked: N` (genuine agent blocks) and `Deferred: N` (runner false-blocks — items with `deferred: true`) are shown separately so the aftermath of a usage-limit event is legible
- Indicates state source: "via state.json" or "via log parsing (fallback)"
- `--watch`: continuously refresh the status display (clears and redraws screen)
- `--interval N`: refresh interval in seconds (default: 2, requires `--watch`)

**Machine-friendly exit codes for `rauf status`:**

| Code | Loop State                                                                    |
| ---- | ----------------------------------------------------------------------------- |
| 0    | IDLE, COMPLETE, PAUSED, ERROR, SLEEPING_LIMIT, WEEKLY_LIMIT, or NOT_INSTALLED |
| 1    | RUNNING                                                                       |
| 2    | PAUSED_HUMAN (needs human input)                                              |
| 3    | LIMIT_REACHED                                                                 |

### rauf log [path]

Tail the rauf loop log file (`.rauf/rauf.log`) for the project at `[path]`.

- `--tail N`: show the last N lines (default: 20)
- `--follow`: stream new lines as they are written (tail -f behavior), runs until Ctrl+C

### rauf progress [path]

Display the contents of `.rauf/progress.md` — the accumulation file where the loop records project learnings.

- `--json`: output `{ content: "..." }` or `{ content: null }` if the file does not exist

---

## recovery

Commands to recover from an interrupted or corrupted loop state without manual JSON editing.

### rauf reset [path]

Reconcile committed work, requeue runner false-blocks, and clear stale state so the loop can be restarted cleanly.

- `[path]`: project path (default: `.`)
- Refuses with exit code 5 if a live loop holds the lock (live PID detected)
- Clears a stale lock (dead or recycled PID) automatically

**Steps (in order):**

1. **Lock gate** — refuse if lock PID is alive; release stale lock
2. **Commit reconciliation** — for each non-done item, if `findItemCommit` finds a `[rauf] <id>:` commit AND the working tree is clean, promote the item to `done` (`recovered_via_commit`)
3. **False-block requeue** — items with `deferred: true` are reset to `pending` (clear `deferred` + `blockedReason`); items with an explicit agent block (`RAUF_BLOCKED`/`RAUF_NEEDS_HUMAN`) stay blocked and are reported
4. **Stalled items** — remaining `in_progress` items reset to `pending`
5. **State clear** — delete `state.json`, clear `.rauf/DONE` and `.rauf/CANCEL`

Output summary: recovered, requeued, kept-blocked, lock-cleared counts.

`--keep-done` (default, no-op flag) — does not sweep done items; recovery preserves them. This flag is accepted for forward-compatibility but has no effect.

`--json`: emit the result as `{ recovered, requeued, keptBlocked, stalledReset, lockCleared, stateCleared, treeClean }`.

> **Note:** `rauf reset` is a **recovery** command distinct from `rauf backlog reset` (which orchestrates a full backlog cycle sweep). `rauf reset` never sweeps done items.

### rauf resume [path]

Detect an interrupted loop and continue it from where it stopped.

- `[path]`: project path (default: `.`)
- Refuses with exit code 5 if a live loop holds the lock

**Resumable states detected:**

- `paused_usage_limit` — loop halted cleanly at a usage limit with `sleepOnLimit=false`
- `limit_reached` — iteration budget exhausted but non-done items remain
- `error` — circuit breaker or unexpected termination
- `paused`, `sleeping_limit`, `weekly_limit` — interrupted sleep or graceful pause
- Dead lock with non-done items remaining

**Steps:**

1. Check lock — refuse if alive
2. Detect resumable state (reads `state.json` + derives status)
3. Apply the same reconciliation + false-block requeue as `rauf reset`
4. Relaunch the loop via the normal `rauf loop run` entrypoint with a recomputed budget (`computeMaxIterations`) and `--allow-dirty` (since recovery may leave `.rauf/backlog.json` uncommitted)

**Early exits:**

- All items done → report "all done", no relaunch
- No eligible items after recovery (only genuine blocks/needsHuman remain) → report and exit without spawning

---

## profile

Subcommands that manage the per-project tech stack profile stored in `.rauf.json`. The profile drives which verification commands the loop runs.

### rauf profile show [path]

Show the current profile for the project at `[path]`.

- Output: Stack, Package Manager, Monorepo, and all configured commands (test, typecheck, lint, build, format), plus the composite `verify` command

### rauf profile detect [path]

Re-run auto-detection against the project at `[path]` and show what would change.

- Read-only — does not write anything
- To apply changes, use `rauf profile set` or `rauf update`

### rauf profile set [path] [key] [value]

Update a single profile field and automatically re-sync the verification commands in `RAUF.md`.

- Valid keys: `test`, `typecheck`, `lint`, `build`, `format`, `stack`, `packageManager`, `monorepo`
- Set a command key to `""` to disable it (stored as `null`)

---

## config

Subcommands that manage the global rauf tool configuration stored in `~/.rauf/config.json`.

### rauf config get [key]

Get a single global config value.

- Valid keys: `rootDirectory`, `port`, `theme`

### rauf config set [key] [value]

Set a single global config value.

- Valid keys: `rootDirectory`, `port`, `theme`
- `port`: must be a positive integer
- `theme`: must be `light`, `dark`, or `system`
- `rootDirectory`: resolved to an absolute path via `path.resolve()`

### rauf config list

List all global config values.

---

## utilities

### rauf version

Print the rauf version string.

- `--json`: output `{ version: "..." }`

### rauf help [command]

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
