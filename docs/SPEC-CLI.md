---
title: CLI Reference
description: Command-line interface specification — commands, flags, exit codes, and output formats.
---

Reference: `packages/cli/`

## Binary

Name: `ralph` (global). Must not conflict with `./ralph.sh` (project-level script).

## Command Tree

```
ralph <command> [subcommand] [options]

ralph server start [--port N] [--root <path>] [--foreground] [--daemon]
ralph server stop
ralph server restart
ralph server status
ralph server logs [--tail N]

ralph projects list [--root <path>]
ralph projects status [<project>]

ralph install <path> [options]
ralph update <path> [--yes]
ralph uninstall <path> [--yes] [--keep-data]

ralph init <path> [options]

ralph backlog list <path> [--status <s>] [--type <t>] [--json]
ralph backlog add <path> --title "..." --type <t> --priority N [options]
ralph backlog edit <path> <id> [field options]
ralph backlog delete <path> <id> [--yes]
ralph backlog show <path> <id> [--json]
ralph backlog restore <path> [--yes]
ralph backlog sweep <path> [--min-age-days N] [--dry-run] [--yes]
ralph backlog archive list <path>
ralph backlog archive view <path> <month>
ralph backlog archive purge <path> [--month YYYY-MM] [--yes]

ralph status <path>
ralph log <path> [--tail N] [--follow]
ralph progress <path>

ralph config get <key>
ralph config set <key> <value>
ralph config list

ralph profile show <path>
ralph profile detect <path>
ralph profile set <path> <key> <value>

ralph version
ralph help [command]
```

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

## Command Details

### ralph server start

- `--foreground` (default in TTY): run in foreground, log to stdout
- `--daemon`: fork to background, write PID to `~/.ralph/server.pid`, log to `~/.ralph/server.log`
- Check for existing server (PID file + health endpoint ping) before starting
- Print URL on startup: `Ralph server running at http://localhost:5173`

### ralph server stop

- Read PID from `~/.ralph/server.pid`, send SIGTERM
- Wait 5s for graceful shutdown, then SIGKILL
- Report success or "no server running"

### ralph install <path>

- Run full installation flow headlessly
- Auto-detect tech stack, display results
- `--yes`: skip confirmations, use detected defaults
- `--gitignore-scripts`: add .sh files to .gitignore
- `--test-cmd`, `--typecheck-cmd`, `--lint-cmd`, `--build-cmd`, `--format-cmd`: override detected
- Print installation report to stdout
- Exit 0 on success

### ralph init <path>

- Greenfield: create directory, git init, scaffold CLAUDE.md, install artifacts
- `--name`: project name (default: directory name)
- `--description`: project description for CLAUDE.md
- `--stack <preset>`: tech stack preset (node-typescript, python, go, rust, custom)
- `--seed <file>`: seed backlog from JSON or markdown
- Print creation report to stdout

### ralph backlog add <path>

- `--title` and `--type` required
- `--ac` flag is **repeatable** — each instance adds one acceptance criterion
- If no `--ac` flags, smart default is applied + warning printed
- `--depends-on`: comma-separated IDs
- `--notes`: free-text
- Prints new item ID on success

### ralph backlog edit <path> <id>

- `--ac` flags **replace** entire criteria array (not append)
- Only provided fields are updated
- Status transitions validated

### ralph backlog sweep <path>

- Moves all done backlog items into `.ralph/archive/YYYY-MM.json` files grouped by `completedAt` month
- `--min-age-days N`: only sweep items completed more than N days ago (0 = all done items)
- `--dry-run`: preview what would be swept without writing any files
- `--yes`: required for confirmation (without it, prints usage and exits non-zero)
- `--json`: output `{ archivedCount, archivedMonths }` as JSON
- Items with `completedAt: null` fall back to the current calendar month

### ralph backlog archive list <path>

- List all archive months with item counts: `Month | Items` table
- `--json`: output `[{ month, count }]` array

### ralph backlog archive view <path> <month>

- Read items from `.ralph/archive/<month>.json` and display as a table
- `<month>` must be in `YYYY-MM` format
- `--json`: output the full `ArchiveMonth` object

### ralph backlog archive purge <path>

- Delete archive files. Requires `--yes` for confirmation.
- `--month YYYY-MM`: delete only the specified month's file
- Without `--month`: delete all archive files and remove the `.ralph/archive/` directory
- Non-existent months are silently treated as no-op (idempotent)

### ralph backlog list <path>

- Default: human-readable table with columns: ID, Type, Pri, Status, Title
- `--json`: raw JSON array
- `--status`: filter by status
- `--type`: filter by type

### ralph status <path>

- Print status summary: loop state, iteration, backlog counts
- Indicate state source: "via state.json" or "via log parsing (fallback)"
- Machine-friendly exit codes: 0=idle/complete, 1=running, 2=blocked/needs_human, 3=limit_reached

### ralph log <path>

- `--tail N`: last N lines (default 20)
- `--follow`: tail -f behavior, stream until Ctrl+C

### ralph profile detect <path>

- Re-run detection, show what would change
- Does NOT write — user must `ralph profile set` or `ralph update`

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

When the server is running (detected via PID file + health ping):

- CLI can route requests through HTTP API for consistency
- Optional — for v1, CLI always calls core functions directly

When server is not running:

- CLI calls core package functions in-process
- All operations work without the server
