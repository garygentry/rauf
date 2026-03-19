# Ralph Manager

## Overview

Ralph Manager is a CLI + web tool for installing, managing, and monitoring ralph autonomous coding loops across local software projects. It provides backlog CRUD, status dashboards, and installation wizards — all backed by a shared `packages/core` library.

## Repository Layout

```
ralph/
├── packages/
│   ├── core/    — Shared business logic (discovery, installer, backlog, status, profile, template)
│   ├── loop/    — Loop runner engine (LoopRunner, events, claude process, signal parsing)
│   ├── cli/     — CLI tool (commands call core directly or HTTP when server is running)
│   └── web/     — Hono API server + React frontend (TanStack Router + Query)
├── artifacts/   — Canonical template files installed into target projects
│   └── variants/
│       └── backlog-json/
├── docs/        — Specifications (ARCHITECTURE, SCHEMAS, SPEC-CORE, SPEC-CLI, SPEC-WEB, SPEC-ARTIFACTS)
└── .ralph/      — This project's own ralph loop state (self-hosting)
```

## Tech Stack

- **Runtime:** Bun (TypeScript, native execution, single-binary compilation)
- **Package Manager:** pnpm with workspaces
- **Server:** Hono on Bun (localhost:5173, bound to 127.0.0.1)
- **Frontend:** React + TanStack Router + TanStack Query + Tailwind CSS
- **CLI:** TypeScript, compiled via `bun build --compile`
- **Testing:** Vitest
- **Linting:** ESLint + Prettier

## Key Architecture Rules

1. **`packages/core` has ZERO imports from `cli` or `web`.** All filesystem logic lives in core.
2. **All file writes use atomic write** (write .tmp → rename) with .bak backup for backlog.json.
3. **Path sandboxing:** Never write outside ROOT_DIRECTORY or ~/.ralph/. Validate with `path.resolve()` + `startsWith()`.
4. **The web server binds to 127.0.0.1 ONLY.** All mutation endpoints require `X-Ralph-Request: true` header.
5. **Per-project artifacts are self-contained.** A project with ralph installed must work without the manager tool.
6. **Status derivation reads files directly** — never invokes subprocesses for status.

## Specification Documents

Before implementing any feature, read the relevant spec:

- **System architecture & data flow:** `docs/ARCHITECTURE.md`
- **All TypeScript types & JSON schemas:** `docs/SCHEMAS.md`
- **Core package logic:** `docs/SPEC-CORE.md`
- **CLI commands & behavior:** `docs/SPEC-CLI.md`
- **Web API & frontend:** `docs/SPEC-WEB.md`
- **Artifact templates (RALPH.md, CLAUDE_ADDON.md, etc.):** `docs/SPEC-ARTIFACTS.md`
- **Claude Code Tasks integration notes:** `docs/CLAUDE-CODE-TASKS.md`

## Development Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (vitest)
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint
pnpm format:check     # Prettier check
```

## Test Sandbox

`test-sandbox/` provides a self-contained ralph project with mock Claude scripts for testing the loop runner without API access.

```bash
bash test-sandbox/run.sh                  # Default scenario (stream-done)
bash test-sandbox/run.sh stream-blocked   # Specific scenario
bash test-sandbox/verify.sh               # All scenarios with assertions
```

When modifying `packages/loop/` or loop CLI commands, use the sandbox to verify changes. See the `test-ralph-loop` skill for detailed guidance.

## Dev Environment Setup

### Prerequisites

- **Bun** — TypeScript runtime (`curl -fsSL https://bun.sh/install | bash`)
- **pnpm** — Package manager (`npm install -g pnpm@9`)
- **direnv** — Auto-loads environment per directory (recommended)

### Installing direnv

```bash
# macOS
brew install direnv

# Ubuntu/Debian
sudo apt install direnv

# Arch
sudo pacman -S direnv
```

Then hook it into your shell by adding to `~/.zshrc` (or `~/.bashrc`):

```bash
eval "$(direnv hook zsh)"   # or: eval "$(direnv hook bash)"
```

Restart your shell, then from the repo root:

```bash
direnv allow
```

### Running the CLI in dev

After `pnpm install`, direnv automatically adds `scripts/bin/ralph` to your PATH. This wrapper runs `bun` directly on the TypeScript source — no build step needed, always uses the latest code:

```bash
ralph status .          # Show loop state + backlog summary
ralph backlog list .    # List all backlog items
ralph loop run .        # Run a loop iteration
```

If you don't use direnv, you can achieve the same manually:

```bash
export PATH="$(pwd)/scripts/bin:$PATH"
```

Alternatively, `pnpm ralph <args>` also works (routes through `node_modules/.bin/ralph` which requires `pnpm build` first).

## Coding Conventions

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- Named exports only (no default exports except React components that need them)
- Prefer `node:` prefix for Node built-ins (`node:fs`, `node:path`)
- Error handling: return `Result<T, E>` types from core functions, never throw for expected errors
- File paths: always use `path.resolve()` before any operation
- JSON parsing: always wrap in try/catch, return structured errors
- Tests: colocate with source as `*.test.ts`

## Claude Code Tasks vs Ralph Backlog

This project uses `.ralph/backlog.json` as the persistent task queue for the ralph loop. Claude Code's native Tasks system (`~/.claude/tasks/`) is a separate, session-scoped mechanism. **Do not confuse them:**

- **backlog.json** = What work items exist (human-managed, persistent, cross-session)
- **Claude Code Tasks** = How the agent decomposes current work within a session (ephemeral)
- The ralph loop reads backlog.json at iteration start — it is the source of truth
- You MAY use Claude Code Tasks internally to plan your approach to a backlog item, but backlog.json status updates are what matter

## Self-Hosting Note

This repository IS a ralph-managed project. The `.ralph/` directory at the repo root is this project's own ralph loop state. Run the loop with `ralph loop run` (direct mode) or `ralph loop start` (server mode). The `artifacts/variants/backlog-json/` directory contains the _templates_ used when installing ralph into OTHER projects. Do not confuse them.

---

<!-- ralph:start -->

## Autonomous Loop (Ralph)

When running as a ralph loop iteration, follow these operational rules:

### Reading Your Task

1. Read `.ralph/RALPH.md` for detailed per-iteration instructions
2. Read `.ralph/backlog.json` — find the current `in_progress` item
3. The item's `acceptanceCriteria` define "done" for this iteration

### Working

4. Implement the changes described in the item's description
5. Follow acceptance criteria precisely — each one must pass
6. Run the verification command before considering work complete

### Completing

7. If all acceptance criteria pass: output `RALPH_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RALPH_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RALPH_NEEDS_HUMAN:<reason>`
10. Commit your changes with message: `[ralph] <item-id>: <title>`

### Rules

- ONE item per iteration — do not work on multiple items
- Do not modify `.ralph/backlog.json` — the loop runner manages status
- Do not modify `.ralph/state.json` — the loop runner manages state
- Read `.ralph/progress.md` for accumulated project learnings
- Append new learnings to `.ralph/progress.md` if you discover important patterns
<!-- ralph:end -->
