# Ralph

**Autonomous coding loops, managed.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.1.0-green)

Ralph installs, manages, and monitors AI coding loops across your local projects. Define a backlog, start the loop, and let [Claude Code](https://docs.anthropic.com/en/docs/claude-code) ship work items autonomously — with full visibility through a CLI and web dashboard.

<p align="center">
  <img src="screenshots/dashboard.png" alt="Ralph Manager — Projects Dashboard" width="720" />
</p>

> **Self-hosted from day one.** Ralph built itself: 44 backlog items, each implemented, verified, and committed by its own loop. The screenshots below are ralph managing ralph.

---

## How It Works

<p align="center">
  <img src="docs/images/ralph-loop.png" alt="Ralph loop diagram" width="720" />
</p>

1. **Backlog** — You define work items with titles, priorities, and acceptance criteria
2. **Pick** — The loop runner (`ralph.sh`) selects the next pending item by priority
3. **Claude Code** — A fresh Claude Code session reads the item, implements changes, and runs verification
4. **Verify & Commit** — If all criteria pass, changes are committed and the loop advances

Each iteration produces one of three exit signals:

| Signal | Meaning | What happens |
|--------|---------|-------------|
| `RALPH_DONE` | All acceptance criteria passed | Item marked done, loop continues |
| `RALPH_BLOCKED` | Missing dependency or unclear spec | Item paused, loop retries or skips |
| `RALPH_NEEDS_HUMAN` | Requires a decision or API key | Loop pauses for human input |

---

## Features

- **Auto-detect & install** — Detects Node.js, Python, Go, Rust stacks and deploys loop scripts in one command
- **Greenfield init** — Scaffold a new project with git, CLAUDE.md, backlog, and loop infrastructure
- **Structured backlog** — JSON-based task queue with priorities, types, acceptance criteria, and dependencies
- **Real-time status** — Loop state derived directly from `state.json` with log-parsing fallback
- **Web dashboard** — React SPA with project cards, backlog management, live log streaming via SSE
- **Full CLI** — Every dashboard action available headless for scripting and CI
- **Single binary** — Compiles to one executable via `bun build --compile` (CLI + server + frontend + templates)
- **Self-contained projects** — Installed projects work standalone, no ralph manager required

---

## Quick Start

**Prerequisites:** [Bun](https://bun.sh/) 1.0+, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI, [jq](https://jqlang.github.io/jq/), Git

```bash
# Clone and build
git clone https://github.com/your-org/ralph.git
cd ralph && pnpm install && pnpm build

# Install ralph into an existing project
ralph install ~/workspace/my-project --yes

# Add a work item
ralph backlog add ~/workspace/my-project \
  --title "Add user authentication" \
  --type feature --priority 1 \
  --ac "Login endpoint returns JWT" \
  --ac "pnpm test passes"

# Start the loop
cd ~/workspace/my-project && ./ralph.sh
```

---

## Web Dashboard

```bash
ralph server start     # http://localhost:5173
```

**Backlog management** — Add, edit, prioritize, and sweep items. Filter by status, type, or priority.

<p align="center">
  <img src="screenshots/backlog.png" alt="Backlog view" width="720" />
</p>

**Status monitoring** — Live loop state, iteration counts, recent completions, and log streaming.

<p align="center">
  <img src="screenshots/status.png" alt="Status view" width="720" />
</p>

---

## CLI

### Project Setup

```bash
ralph install <path> [--yes]              # Install into existing project
ralph init <path> --name --stack --seed   # Scaffold new project
ralph update <path> [--yes]               # Update ralph artifacts
ralph uninstall <path> [--yes]            # Remove ralph from project
```

### Backlog

```bash
ralph backlog list <path>                 # List items (--status, --type filters)
ralph backlog add <path> --title --ac     # Add item with acceptance criteria
ralph backlog edit <path> <id>            # Edit item fields
ralph backlog delete <path> <id>          # Delete item
ralph backlog show <path> <id>            # Show item details
ralph backlog sweep <path> --yes          # Archive completed items
```

### Monitoring

```bash
ralph status <path>                       # Loop state + backlog summary
ralph log <path> [--follow]               # View or tail loop log
ralph progress <path>                     # View accumulated learnings
```

### Server

```bash
ralph server start [--daemon] [--port N]  # Start web dashboard
ralph server stop                         # Stop server
ralph server status                       # Show server status
```

**Global flags:** `--json` `--no-color` `--quiet` `--root <path>`

---

## Project Structure

```
ralph/
├── packages/core/     Shared business logic (zero deps on cli/web)
├── packages/cli/      CLI tool
├── packages/web/      Hono API + React frontend
├── artifacts/         Template files installed into target projects
└── docs/              Architecture and specification documents
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, component boundaries |
| [Schemas](docs/SCHEMAS.md) | All TypeScript types and JSON schemas |
| [Core Spec](docs/SPEC-CORE.md) | Core package logic and algorithms |
| [CLI Spec](docs/SPEC-CLI.md) | CLI commands, flags, and behavior |
| [Web Spec](docs/SPEC-WEB.md) | API endpoints and frontend architecture |
| [Artifacts Spec](docs/SPEC-ARTIFACTS.md) | Template files and installation process |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. The essentials:

```bash
pnpm install        # Install dependencies
pnpm test           # Run tests (vitest)
pnpm typecheck      # TypeScript strict mode
pnpm lint           # ESLint
```

## License

[MIT](LICENSE)
