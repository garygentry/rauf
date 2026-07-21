# rauf

> Robust autonomous coding loops over a structured backlog.

[![CI](https://github.com/garygentry/rauf/actions/workflows/ci.yml/badge.svg)](https://github.com/garygentry/rauf/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/release/garygentry/rauf)](https://github.com/garygentry/rauf/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Using a coding agent?** Tell it: _"Install rauf in this project — `npm i -g @garygentry/rauf`
> (or `npx @garygentry/rauf`), verify with `rauf version`, then run `rauf install .` here."_ It
> installs the CLI, wires the per-project loop artifacts, and adds the managed `AGENTS.md`/`CLAUDE.md`
> block. (Most people reach rauf through [feature-forge](https://github.com/garygentry/feature-forge),
> whose agent-setup flow installs and wires rauf for you.)

Rauf is a "ralph" runner: it works through a highly structured backlog file one item at a time, gives each item its own fresh agent context, then verifies the result and commits it. You rarely write that backlog by hand. The coding agent usually authors it, using skills that ship with rauf, so you describe what you want and the agent turns it into well-scoped, verifiable items.

Each iteration starts from a clean slate: one item, a focused prompt, and the backlog as read-only context. That fresh-context-per-iteration discipline (the [ralph](https://ghuntley.com/ralph/) pattern) is what keeps long autonomous runs from drifting.

Rauf is CLI-first, driven by you or by an agent, and optimized for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), which it spawns by default. The loop runner is deliberately separated from the agent it spawns, so rauf isn't tied to a single harness.

<p align="center">
  <img src="docs/images/rauf-loop.png" alt="Rauf loop diagram: backlog, pick, agent, verify and commit" width="720" />
</p>

> **Self-hosted from day one.** Rauf built itself: every backlog item in this repo was implemented, verified, and committed by its own loop.

---

## How It Works

1. **Backlog:** You (or, more often, the agent) define work items with titles, priorities, and acceptance criteria
2. **Pick:** The loop runner selects the next pending item by priority (dependency-aware)
3. **Agent:** A fresh agent session reads the item, implements changes, and runs verification. It is a clean context every iteration, with no state carried between items
4. **Verify & Commit:** If all criteria pass, the runner verifies and commits the work, then advances

Each iteration produces one of three exit signals:

| Signal             | Meaning                            | What happens                       |
| ------------------ | ---------------------------------- | ---------------------------------- |
| `RAUF_DONE`        | All acceptance criteria passed     | Item marked done, loop continues   |
| `RAUF_BLOCKED`     | Missing dependency or unclear spec | Item paused, loop retries or skips |
| `RAUF_NEEDS_HUMAN` | Requires a decision or API key     | Loop pauses for human input        |

---

## Backlogs

The backlog is a structured JSON queue of work items with priorities, types, acceptance criteria, and dependencies. You rarely write it by hand: the `author-backlog` and `review-backlog` skills that ship with rauf let the agent turn a feature description into well-scoped, verifiable items, and QA them.

- **Repo-wide (default):** one queue at `<project>/.rauf/backlog.json`, the right model for a single stream of work.
- **Isolated per-feature backlogs (the key feature):** point any command at a separate backlog directory with `--backlog <dir>`. Each gets a fully independent loop and state (its own backlog, events, and status) that never collide, so discrete features run as separate, self-contained efforts.

See [Multi-Backlog & Multi-Project](https://garygentry.github.io/rauf/guides/multi-backlog/) for the full model.

## feature-forge

Rauf is tightly integrated with [feature-forge](https://github.com/garygentry/feature-forge) but does not depend on it. feature-forge is an agent-agnostic spec-and-backlog pipeline that runs on Claude, Codex, Copilot, Cursor, Gemini, and Pi. It generates a backlog per feature and hands it to a conforming loop runner; rauf is the default and reference implementation. The two work well together, but rauf runs fine on a hand-rolled or skill-authored backlog without it. See feature-forge's README for the cross-agent install story.

---

## Agents

Rauf spawns a coding-agent CLI each iteration. It defaults to and is optimized for [Claude Code](https://docs.anthropic.com/en/docs/claude-code); other agents are selectable with `--agent <id>` (`codex`, `gemini`, `copilot`, `cursor`, `pi`). For Pi on Claude-authored backlogs, prefer `rauf loop run <project> --agent pi --no-model` so Claude-only model aliases are not forwarded to Pi.

> **Honest testing state.** We are candid about how far each agent's invocation is actually verified against its real CLI — not just against rauf's unit tests. A preset whose flags only pass a literal-asserting unit test can still be rejected by the real binary (this is exactly how the Codex loop shipped broken in 0.9.0, fixed in 0.10.0). Current state:
>
> | Agent           | Adapter                              | Verified against the real CLI                                                                                                       |
> | --------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
> | **Claude Code** | native (default)                     | ✅ Primary target — exercised continuously                                                                                          |
> | **Codex**       | dedicated provider + JSONL telemetry | ✅ End-to-end (codex-cli 0.141)                                                                                                     |
> | **Copilot**     | preset                               | ✅ End-to-end — runs headless and emits output (copilot 1.0.65)                                                                     |
> | **Gemini**      | preset                               | ⚠️ Argv verified to enter headless mode; full run-to-completion not yet confirmed (gemini-cli 0.49)                                 |
> | **Cursor**      | preset                               | ⚠️ Argv verified (incl. the `--print` headless trigger); full run-to-completion not yet confirmed (cursor-agent 2026.06)            |
> | **Pi**          | preset                               | ✅ Sentinel end-to-end — `pi -p --approve --no-session` prints parseable output (Pi 0.80.10); production preset keeps tools enabled |
>
> "Argv verified" means the real binary accepts the invocation and enters non-interactive/headless mode (no argument rejection, no interactive hang). "End-to-end" additionally means a real run completed and rauf observed the agent's output. The `⚠️` agents need provider credentials to close the last step; their flags are correct, only the authenticated round-trip is unconfirmed. If you hit a spawn or output-capture issue on any agent, please open an issue — that feedback is how these rows move to ✅.

---

## Features

- **Auto-detect & install:** Detects Node.js, Python, Go, Rust stacks and deploys loop artifacts in one command
- **Cross-agent instructions:** Installs a managed block into `AGENTS.md` (the host-agnostic repo-instructions file read by Codex and others) alongside a Claude-optimized `CLAUDE.md`
- **Greenfield init:** Scaffold a new project with git, `AGENTS.md` + `CLAUDE.md`, backlog, and loop infrastructure
- **Structured backlog:** JSON-based task queue with priorities, types, acceptance criteria, and dependencies
- **Real-time status:** Loop state derived directly from `state.json` with log-parsing fallback
- **Full CLI:** Headless and scriptable, drivable by a human or a supervising agent
- **Single binary:** Compiles to one executable via `bun build --compile` (CLI + server + frontend + templates)
- **Self-contained projects:** Installed projects work standalone, with no rauf manager required
- **Optional web dashboard:** A local UI to view and manage loops (see below)

---

## Install

**Prerequisites:** a coding-agent CLI and Git. Rauf spawns an agent session each iteration and commits the result; it is optimized for and defaults to [Claude Code](https://docs.anthropic.com/en/docs/claude-code), so make sure your agent CLI works on its own first. Building from source also needs [Bun](https://bun.sh/) 1.0+, [pnpm](https://pnpm.io/) 9+, and Node.js ≥ 22.

### Via npm

The quickest way to get `rauf` is from npm, with no clone or build step:

```bash
npm install -g @garygentry/rauf   # the installed command is still `rauf`
npx @garygentry/rauf status .      # or one-off, no install
```

**Verify it's on your PATH** before wiring it into a project:

```bash
rauf version                       # prints a semver; feature-forge's floor is >= 0.6.0
```

If `rauf: command not found` after a global install, the npm global bin (or `~/.local/bin` for
the binary/source paths) isn't on your `PATH` — add it, or fall back to `npx @garygentry/rauf`.

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

### Claude Code skills (optional)

Rauf ships its agent skills — `author-backlog`, `review-backlog`, `drive-rauf-loop`, `review-rauf-guidance` — as a Claude Code plugin. Installing them as a plugin (rather than copying skill folders) namespaces them under `rauf:` (e.g. `rauf:author-backlog`), so they won't collide with similarly named skills and they update with one command:

```
/plugin marketplace add garygentry/rauf
/plugin install rauf@rauf
```

Later, pull updates with `/plugin marketplace update rauf`. These skills are a convenience for authoring and reviewing backlogs interactively in Claude Code — the `rauf` CLI itself does not require them.

To enable the plugin declaratively (e.g. provisioning a machine), add to `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "rauf": { "source": { "source": "github", "repo": "garygentry/rauf" } }
  },
  "enabledPlugins": { "rauf@rauf": true }
}
```

### Codex skills (optional)

The same four skills ship as a **Codex plugin** at [`.codex-plugin/`](./.codex-plugin/), generated from the identical canonical sources (no divergent copy — `scripts/build-codex-bundle.ts`, guarded by `pnpm codex:check`). Install it with Codex's plugin tooling pointed at this repo / the bundle directory; see the [Codex plugins docs](https://developers.openai.com/codex/plugins). Like the Claude plugin, these skills are an authoring/review convenience — the `rauf` CLI does not require them, and rauf already drives the loop under `--agent codex`.

rauf also ships two **Codex subagents** — `rauf-backlog-reviewer` and `rauf-loop-driver` — at [`.codex/agents/`](./.codex/agents/), generated from canonical `agents/<name>.md` definitions. They let a Codex session delegate a backlog QA audit or loop supervision to a focused subagent. They are repo-level (available when you run Codex on this repo, or copy them into your project's `.codex/agents/`); `rauf install` does not deploy them.

### Pi skills (optional)

The same four skills ship as a **Pi package** at [`adapters/pi/`](./adapters/pi/), generated from the canonical `skills/<name>/SKILL.md` sources by `scripts/build-pi-bundle.ts` and guarded by `pnpm pi:check`. The generated bundle rewrites repo-level doc/source references to skill-local `references/*` files so `/skill:author-backlog`, `/skill:review-backlog`, `/skill:drive-rauf-loop`, and `/skill:review-rauf-guidance` work after Pi installs the package.

During development, load it for one run with:

```bash
pi -e ./adapters/pi
```

or install it into Pi with:

```bash
pi install ./adapters/pi
```

Like the Claude and Codex packages, these skills are an authoring/review convenience — the `rauf` CLI does not require them, and rauf already drives loop iterations under `--agent pi`.

> Maintainers: never hand-edit `.codex-plugin/`, `.codex/agents/`, or `adapters/pi/` — edit the canonical `skills/<name>/SKILL.md` / `agents/<name>.md` and run `pnpm codex:generate` or `pnpm pi:generate`.

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
  <img src="docs/images/package-graph.svg" alt="Package dependency graph: cli and web depend on loop and core; loop depends on core; core is standalone" width="640" />
</p>

`core` never imports from `loop`, `web`, or `cli`; `loop` never imports from `web` or `cli`. See [Architecture](docs/ARCHITECTURE.md) for the full design.

## Web Dashboard (optional)

The CLI is the primary surface. For a visual alternative, rauf also ships an optional local web UI for viewing and managing loops in the browser. It is a newer, less battle-tested surface than the CLI. It reads the same on-disk state the CLI does, so it reports on any loop in a project, including ones it didn't start.

```bash
rauf server start     # http://localhost:5173
```

Manage the backlog (add, edit, prioritize, sweep), watch live loop state and log streaming, and run recovery actions. These are the same headless CLI actions, with a UI.

<p align="center">
  <img src="docs/images/screenshots/dashboard.png" alt="Rauf web dashboard, projects view" width="720" />
</p>

## Documentation

📚 **[Full documentation site →](https://garygentry.github.io/rauf/)**

The site is the best starting point, a consumer-first journey from install to power use:

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
