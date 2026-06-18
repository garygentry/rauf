# Rauf

**Robust autonomous coding loops over a structured backlog.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/github/v/release/garygentry/rauf)](https://github.com/garygentry/rauf/releases)

Rauf is a **"ralph" runner**: it iterates over a highly structured backlog file, giving each work item its **own fresh agent context**, then verifies the result and commits it. That backlog is almost always **authored by the coding agent itself** — via skills that ship with rauf — so you describe intent and the agent turns it into well-scoped, verifiable items.

Each iteration starts from a clean slate — one item, a focused prompt, the backlog as read-only context. That fresh-context-per-iteration discipline (the [ralph](https://ghuntley.com/ralph/) pattern) is what keeps long autonomous runs from drifting.

Rauf is **CLI-first** — driven by you or by an agent — and **optimized for [Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, which it spawns by default. The loop runner is deliberately separated from the agent it spawns, so rauf isn't wired to a single harness.

<p align="center">
  <img src="docs/images/rauf-loop.png" alt="Rauf loop diagram — backlog → pick → agent → verify & commit" width="720" />
</p>

> **Self-hosted from day one.** Rauf built itself — every backlog item in this repo was implemented, verified, and committed by its own loop.

---

## How It Works

1. **Backlog** — You (or, more often, the agent) define work items with titles, priorities, and acceptance criteria
2. **Pick** — The loop runner selects the next pending item by priority (dependency-aware)
3. **Agent** — A **fresh agent session** reads the item, implements changes, and runs verification — a clean context every iteration, never carrying state between items
4. **Verify & Commit** — If all criteria pass, the runner verifies and commits the work, then advances

Each iteration produces one of three exit signals:

| Signal             | Meaning                            | What happens                       |
| ------------------ | ---------------------------------- | ---------------------------------- |
| `RAUF_DONE`        | All acceptance criteria passed     | Item marked done, loop continues   |
| `RAUF_BLOCKED`     | Missing dependency or unclear spec | Item paused, loop retries or skips |
| `RAUF_NEEDS_HUMAN` | Requires a decision or API key     | Loop pauses for human input        |

---

## Backlogs

The backlog is the heart of rauf — a structured JSON queue of work items with priorities, types, acceptance criteria, and dependencies. You rarely write it by hand: the **`author-backlog`** and **`review-backlog`** skills that ship with rauf let the agent turn a feature description into well-scoped, verifiable items (and QA them).

- **Repo-wide (default)** — one queue at `<project>/.rauf/backlog.json`, the right model for a single stream of work.
- **Isolated per-feature backlogs (the key feature)** — point any command at a separate backlog directory with `--backlog <dir>`. Each gets a **fully independent loop and state** — its own backlog, events, and status — that never collide. This is what lets discrete features run as separate, self-contained efforts.

See [Multi-Backlog & Multi-Project](https://garygentry.github.io/rauf/guides/multi-backlog/) for the full model.

## feature-forge

Rauf is tightly integrated with — but **not dependent on** — [feature-forge](https://github.com/garygentry/feature-forge), an agent-agnostic spec-and-backlog **pipeline** that runs on Claude, Codex, Copilot, Cursor, and Gemini. feature-forge generates a backlog per feature and hands it to a conforming loop runner; rauf is the default and reference implementation. The two work as a pair, but rauf runs perfectly well on a hand-rolled or skill-authored backlog without it. See feature-forge's README for the cross-agent install story.

---

## Features

- **Auto-detect & install** — Detects Node.js, Python, Go, Rust stacks and deploys loop artifacts in one command
- **Greenfield init** — Scaffold a new project with git, CLAUDE.md, backlog, and loop infrastructure
- **Structured backlog** — JSON-based task queue with priorities, types, acceptance criteria, and dependencies
- **Real-time status** — Loop state derived directly from `state.json` with log-parsing fallback
- **Full CLI** — Headless and scriptable, drivable by a human or a supervising agent
- **Single binary** — Compiles to one executable via `bun build --compile` (CLI + server + frontend + templates)
- **Self-contained projects** — Installed projects work standalone, no rauf manager required
- **Optional web dashboard** — A local UI to view and manage loops (see below)

---

## Install

**Prerequisites:** a coding-agent CLI and Git. Rauf spawns an agent session each iteration and commits the result; it is optimized for and defaults to [Claude Code](https://docs.anthropic.com/en/docs/claude-code), so make sure your agent CLI works on its own first. Building from source also needs [Bun](https://bun.sh/) 1.0+, [pnpm](https://pnpm.io/) 9+, and Node.js ≥ 22.

### Via npm

The quickest way to get `rauf` is from npm — no clone, no build:

```bash
npm install -g @garygentry/rauf   # the installed command is still `rauf`
npx @garygentry/rauf status .      # or one-off, no install
```

The package is scoped (`@garygentry/rauf`) because the bare `rauf` name is blocked by npm's
name-similarity filter; the installed command remains `rauf`. The npm launcher fetches the
matching self-contained binary for your platform on first run.

### From source

Building from source gives you the current version (it may run ahead of the latest npm release):

```bash
git clone https://github.com/garygentry/rauf.git
cd rauf
pnpm install && pnpm build
bash scripts/install-global.sh   # symlinks `rauf` into ~/.local/bin
rauf version                     # verify (~/.local/bin must be on your PATH)
```

### Prebuilt binary (optional)

Each tagged release also publishes self-contained binaries (no Bun/Node on the target machine), verified against the release's `SHA256SUMS`. This installs the **latest published release**, which may lag the source tree:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.ps1 | iex
```

Set `RAUF_VERSION=<tag>` to pin a specific release instead of latest. macOS binaries are unsigned; if Gatekeeper blocks one downloaded via a browser, run `xattr -d com.apple.quarantine ./rauf`. See [Releasing & Installing](docs/RELEASING.md) for details.

---

## Quick Start

Once `rauf` is on your `PATH` (see [Install](#install) above):

```bash
# Install rauf into an existing project
rauf install ~/workspace/my-project --yes

# Add a work item
rauf backlog add ~/workspace/my-project \
  --title "Add user authentication" \
  --type feature --priority 1 \
  --ac "Login endpoint returns JWT" \
  --ac "pnpm test passes"

# Start the loop
rauf loop run ~/workspace/my-project
```

New to rauf? The [Your First Loop](https://garygentry.github.io/rauf/getting-started/your-first-loop/) tutorial walks through this end to end.

---

## CLI

### Project Setup

```bash
rauf install <path> [--yes]              # Install into existing project
rauf init <path> --name --stack --seed   # Scaffold new project
rauf update <path> [--yes]               # Update rauf artifacts
rauf uninstall <path> [--yes]            # Remove rauf from project
```

### Backlog

```bash
rauf backlog list <path>                 # List items (--status, --type filters)
rauf backlog add <path> --title --ac     # Add item with acceptance criteria
rauf backlog edit <path> <id>            # Edit item fields
rauf backlog delete <path> <id>          # Delete item
rauf backlog show <path> <id>            # Show item details
rauf backlog sweep <path> --yes          # Archive completed items
```

### Loop

```bash
rauf loop run <path>                     # Run loop directly (foreground, no server)
rauf loop run <path> --detached          # Run loop detached (server-owned, auto-starts daemon)
rauf loop stop <path>                    # Stop a detached/server-owned loop
rauf follow <path>                       # Stream loop events in terminal (top-level verb)
```

### Monitoring

```bash
rauf status <path>                       # Loop state + backlog summary
rauf log <path> [--follow]               # View or tail loop log
rauf progress <path>                     # View accumulated learnings
```

### Server

```bash
rauf server start [--daemon] [--port N]  # Start web dashboard
rauf server stop                         # Stop server
rauf server status                       # Show server status
```

**Global flags:** `--json` `--no-color` `--quiet` `--root <path>`

---

## Project Structure

```
rauf/
├── packages/core/     Shared business logic (zero deps on cli/web/loop)
├── packages/loop/     Loop runner engine (LoopRunner, events, claude process)
├── packages/cli/      CLI tool
├── packages/web/      Hono API + React frontend
├── artifacts/         Template files installed into target projects
└── docs/              Architecture and specification documents
```

<p align="center">
  <img src="docs/images/package-graph.svg" alt="Package dependency graph — cli and web depend on loop and core; loop depends on core; core is standalone" width="640" />
</p>

`core` never imports from `loop`, `web`, or `cli`; `loop` never imports from `web` or `cli`. See [Architecture](docs/ARCHITECTURE.md) for the full design.

## Web Dashboard (optional)

The CLI is the primary surface. For a visual alternative, rauf also ships an **optional** local web UI — a newer, less battle-tested surface than the CLI — to view and manage loops in the browser. It reads the same on-disk state the CLI does, so it reports on any loop in a project, including ones it didn't start.

```bash
rauf server start     # http://localhost:5173
```

Manage the backlog (add, edit, prioritize, sweep), watch live loop state and log streaming, and run recovery actions — all the headless CLI actions, with a UI.

<p align="center">
  <img src="docs/images/screenshots/dashboard.png" alt="Rauf web dashboard — projects view" width="720" />
</p>

## Documentation

📚 **[Full documentation site →](https://garygentry.github.io/rauf/)**

The site is the best starting point — a consumer-first journey from install to power use:

| Section                                                                            | What's there                                                                                              |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Getting Started](https://garygentry.github.io/rauf/getting-started/installation/) | Installation, Your First Loop, and Core Concepts.                                                         |
| [Guides](https://garygentry.github.io/rauf/guides/monitoring/)                     | Monitoring, recovery, multi-backlog, the web dashboard, scripting & CI, customizing the agent, migrating. |
| [Reference](https://garygentry.github.io/rauf/spec-cli/)                           | CLI reference, machine surfaces & contract, and the backlog schema.                                       |

The canonical specs live under **Internals** on the site and as Markdown in [`docs/`](docs/):
[Architecture](docs/ARCHITECTURE.md) · [Schemas](docs/SCHEMAS.md) · [Core](docs/SPEC-CORE.md) ·
[CLI](docs/SPEC-CLI.md) · [Web](docs/SPEC-WEB.md) · [Artifacts](docs/SPEC-ARTIFACTS.md) ·
[Releasing](docs/RELEASING.md).

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
