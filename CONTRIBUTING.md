---
title: Contributing
description: Development setup, coding conventions, and contribution workflow for ralph.
---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Bun](https://bun.sh/) v1.0+ (runtime for the web server and binary compilation)
- [pnpm](https://pnpm.io/) v9+ (package manager)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (for running loops)

### Getting Started

```bash
git clone https://github.com/your-org/ralph.git
cd ralph
pnpm install
pnpm build
```

### Development Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (Vitest)
pnpm typecheck        # TypeScript type checking (pnpm -r typecheck)
pnpm lint             # ESLint across all packages
pnpm format:check     # Prettier format check
pnpm format           # Prettier auto-format
pnpm dev              # Start Vite dev server for the web frontend
pnpm compile          # Build + compile single binary (./ralph-bin)
```

### Running Individual Packages

```bash
# Core tests only
cd packages/core && pnpm test

# CLI tests only
cd packages/cli && pnpm test

# Web tests only
cd packages/web && pnpm test

# Web dev server (frontend hot reload on :5174, API proxy to :5173)
cd packages/web && pnpm dev
```

## Repository Layout

```
ralph/
├── packages/
│   ├── core/    — Shared business logic (discovery, installer, backlog, status, profile, template)
│   ├── loop/    — Loop runner engine (LoopRunner, events, claude process, signal parsing)
│   ├── cli/     — CLI tool (commands call core directly or HTTP when server is running)
│   └── web/     — Hono API server + React frontend (TanStack Router + Query)
├── artifacts/   — Canonical template files installed into target projects
│   └── variants/backlog-json/
├── docs/        — Specifications (ARCHITECTURE, SCHEMAS, SPEC-CORE, SPEC-CLI, SPEC-WEB)
├── scripts/     — Build scripts (embedded artifacts/assets generation, binary entry point)
└── .ralph/      — This project's own ralph loop state (self-hosting)
```

## Architecture Rules

1. **`packages/core` has zero imports from `cli` or `web`.** All filesystem logic lives in core.
2. **All file writes use atomic write** (write `.tmp` then rename) with `.bak` backup for `backlog.json`.
3. **Path sandboxing:** Never write outside `ROOT_DIRECTORY` or `~/.ralph/`. Validate with `path.resolve()` + `startsWith()`.
4. **The web server binds to `127.0.0.1` only.** All mutation endpoints require `X-Ralph-Request: true` header.

## Coding Conventions

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- Named exports only (no default exports except where required by React)
- Prefer `node:` prefix for Node built-ins (`node:fs`, `node:path`)
- Error handling: return `Result<T, E>` types from core functions, never throw for expected errors
- File paths: always use `path.resolve()` before any operation
- JSON parsing: always wrap in try/catch, return structured errors
- Tests: colocate with source as `*.test.ts`

## Testing

Tests use [Vitest](https://vitest.dev/) and are colocated with source files:

```
packages/core/src/backlog.ts
packages/core/src/backlog.test.ts
```

Run the full verification pipeline before submitting:

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format:check
```

## Specification Documents

Before implementing features, read the relevant spec in `docs/`:

| Document            | Covers                                               |
| ------------------- | ---------------------------------------------------- |
| `ARCHITECTURE.md`   | System architecture, data flow, package dependencies |
| `SCHEMAS.md`        | All TypeScript types and JSON schemas                |
| `SPEC-CORE.md`      | Core package modules and logic                       |
| `SPEC-CLI.md`       | CLI commands, flags, exit codes                      |
| `SPEC-WEB.md`       | Web API endpoints and frontend components            |
| `SPEC-ARTIFACTS.md` | Artifact templates (RALPH.md, CLAUDE_ADDON.md, etc.) |

## Self-Hosting

This repository is itself a ralph-managed project. The `.ralph/` directory at the repo root is this project's own ralph loop state. Run the loop with `ralph loop run` (direct mode) or `ralph loop start` (server mode). The `artifacts/variants/backlog-json/` directory contains the _templates_ used when installing ralph into other projects. Do not confuse them.
