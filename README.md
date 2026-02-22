# Ralph

A CLI + web tool for installing, managing, and monitoring autonomous coding loops across local software projects. Ralph provides backlog management, status dashboards, and installation wizards — all powered by [Claude Code](https://claude.ai/claude-code).

## How It Works

Ralph automates the iteration cycle of an AI coding agent:

1. You define work items in a **backlog** (JSON-based task queue)
2. Ralph's loop runner (`ralph.sh`) picks the next item, spawns a Claude Code session, and monitors the result
3. Each iteration reads acceptance criteria, implements changes, runs verification, and commits
4. The loop continues until the backlog is empty or a limit is reached

Ralph Manager (this tool) handles installing this loop infrastructure into your projects and provides CLI + web UI for managing backlogs and monitoring loop status.

## Features

- **Project Installation** — Auto-detect tech stack (Node.js/TypeScript, Python, Go, Rust) and deploy loop scripts + configuration
- **Greenfield Init** — Scaffold a new project with git, CLAUDE.md, backlog, and loop infrastructure in one command
- **Backlog CRUD** — Add, edit, delete, and list work items with priorities, acceptance criteria, and dependencies
- **Status Monitoring** — Real-time loop state derived from `state.json` with log-parsing fallback
- **Web Dashboard** — React SPA with project cards, backlog management, live log streaming (SSE), and installation wizards
- **CLI** — Full-featured command-line interface for headless operation
- **Single Binary** — Compiles to a self-contained binary via `bun build --compile` (CLI + web server + React frontend + embedded templates)

## Installation

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`)
- [jq](https://jqlang.github.io/jq/) (used by loop scripts)
- Git

### From Source

```bash
git clone https://github.com/your-org/ralph.git
cd ralph
pnpm install
pnpm build
```

### Compiled Binary

```bash
pnpm compile    # produces ./ralph-bin
```

The compiled binary bundles the CLI, web server, React frontend, and all artifact templates into a single executable.

## Quick Start

### 1. Install Ralph into an Existing Project

```bash
ralph install ~/workspace/my-project --yes
```

This auto-detects your tech stack, deploys loop scripts (`ralph.sh`, `ralph-status.sh`, `ralph-add.sh`), creates `.ralph/` directory with `RALPH.md` and `backlog.json`, and merges a ralph section into your `CLAUDE.md`.

### 2. Create a New Project from Scratch

```bash
ralph init ~/workspace/new-project \
  --name "my-app" \
  --stack node-typescript \
  --description "A new TypeScript project"
```

This creates the directory, runs `git init`, scaffolds `CLAUDE.md`, installs loop artifacts, and optionally seeds the backlog.

### 3. Add Backlog Items

```bash
ralph backlog add ~/workspace/my-project \
  --title "Add user authentication" \
  --type feature \
  --priority 1 \
  --ac "Login endpoint returns JWT token" \
  --ac "Logout invalidates session" \
  --ac "pnpm test passes"
```

Each `--ac` flag adds one acceptance criterion. If omitted, a smart default is generated from your project's verification command.

### 4. Run the Loop

```bash
cd ~/workspace/my-project
./ralph.sh              # default: 20 iterations, 3 retries
./ralph.sh 50           # custom iteration limit
./ralph.sh 50 5 claude-sonnet-4-6  # iterations, retries, model
```

The loop picks the next pending item by priority, marks it `in_progress`, spawns a Claude Code session, and updates status based on the exit signal (`RALPH_DONE`, `RALPH_BLOCKED`, `RALPH_NEEDS_HUMAN`).

### 5. Monitor Status

```bash
ralph status ~/workspace/my-project    # loop state + backlog summary
ralph log ~/workspace/my-project       # last 20 log lines
ralph log ~/workspace/my-project --follow  # live tail
ralph backlog list ~/workspace/my-project  # backlog table
```

### 6. Use the Web Dashboard

```bash
ralph server start          # starts on http://localhost:5173
ralph server start --daemon # background mode
```

Open `http://localhost:5173` for a full dashboard with project cards, backlog management, live log streaming, and installation wizards.

## CLI Command Reference

```
ralph <command> [subcommand] [options]
```

### Global Flags

| Flag            | Description                   |
| --------------- | ----------------------------- |
| `--json`        | Machine-readable JSON output  |
| `--no-color`    | Suppress ANSI color codes     |
| `--quiet`, `-q` | Suppress informational output |
| `--root <path>` | Override root directory       |

### Commands

#### Project Setup

| Command                                         | Description                              |
| ----------------------------------------------- | ---------------------------------------- |
| `ralph install <path> [--yes]`                  | Install ralph into an existing project   |
| `ralph init <path> [--name] [--stack] [--seed]` | Initialize a new project with ralph      |
| `ralph update <path> [--yes]`                   | Update ralph artifacts (three-way merge) |
| `ralph uninstall <path> [--yes]`                | Remove ralph from a project              |

`ralph install` flags: `--test-cmd`, `--typecheck-cmd`, `--lint-cmd`, `--build-cmd`, `--format-cmd` to override auto-detected commands. `--gitignore-scripts` to add `.sh` files to `.gitignore`.

`ralph init` flags: `--stack <preset>` (node-typescript, python, go, rust, custom), `--seed <file>` to seed backlog from JSON or markdown, `--description` for project description.

#### Backlog Management

| Command                                     | Description                                          |
| ------------------------------------------- | ---------------------------------------------------- |
| `ralph backlog list <path>`                 | List items (filters: `--status`, `--type`)           |
| `ralph backlog add <path>`                  | Add item (`--title`, `--type`, `--priority`, `--ac`) |
| `ralph backlog edit <path> <id>`            | Edit item fields                                     |
| `ralph backlog delete <path> <id>`          | Delete item (with confirmation)                      |
| `ralph backlog show <path> <id>`            | Show item details                                    |
| `ralph backlog restore <path>`              | Restore backlog from `.bak` backup                   |
| `ralph backlog sweep <path> --yes`          | Archive done items to `.ralph/archive/`              |
| `ralph backlog archive list <path>`         | List archive months                                  |
| `ralph backlog archive view <path> <month>` | View archived items                                  |
| `ralph backlog archive purge <path> --yes`  | Delete archive files                                 |

#### Monitoring

| Command                                  | Description                                  |
| ---------------------------------------- | -------------------------------------------- |
| `ralph status <path>`                    | Loop state, iteration count, backlog summary |
| `ralph log <path> [--tail N] [--follow]` | View or tail loop log                        |
| `ralph progress <path>`                  | View accumulated progress notes              |

#### Server

| Command                                    | Description        |
| ------------------------------------------ | ------------------ |
| `ralph server start [--daemon] [--port N]` | Start web server   |
| `ralph server stop`                        | Stop web server    |
| `ralph server restart`                     | Restart web server |
| `ralph server status`                      | Show server status |
| `ralph server logs [--tail N]`             | View server logs   |

#### Configuration

| Command                                  | Description                  |
| ---------------------------------------- | ---------------------------- |
| `ralph config list`                      | List all config values       |
| `ralph config get <key>`                 | Get a config value           |
| `ralph config set <key> <value>`         | Set a config value           |
| `ralph profile show <path>`              | Show project profile         |
| `ralph profile detect <path>`            | Re-detect tech stack         |
| `ralph profile set <path> <key> <value>` | Set a profile value          |
| `ralph projects list`                    | List discovered projects     |
| `ralph projects status`                  | Show status for all projects |

### Exit Codes

| Code | Meaning                 |
| ---- | ----------------------- |
| 0    | Success                 |
| 1    | General error           |
| 2    | Invalid arguments       |
| 3    | Project not found       |
| 4    | Validation error        |
| 5    | Conflict (loop running) |

## Project Structure

```
ralph/
├── packages/
│   ├── core/    — Shared business logic (zero deps on cli/web)
│   ├── cli/     — CLI tool
│   └── web/     — Hono API server + React frontend
├── artifacts/   — Canonical template files installed into projects
│   └── variants/backlog-json/
├── docs/        — Specifications
└── scripts/     — Build scripts (binary compilation, asset embedding)
```

## License

MIT
