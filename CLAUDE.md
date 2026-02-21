# Ralph Manager

## Overview

Ralph Manager is a CLI + web tool for installing, managing, and monitoring ralph autonomous coding loops across local software projects. It provides backlog CRUD, status dashboards, and installation wizards — all backed by a shared `packages/core` library.

## Repository Layout

```
ralph/
├── packages/
│   ├── core/    — Shared business logic (discovery, installer, backlog, status, profile, template)
│   ├── cli/     — CLI tool (commands call core directly or HTTP when server is running)
│   └── web/     — Hono API server + React frontend (TanStack Router + Query)
├── artifacts/   — Canonical template files installed into target projects
│   └── backlog-json/
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
6. **Status derivation reads files directly** — never invokes shell scripts or subprocesses for status.

## Specification Documents

Before implementing any feature, read the relevant spec:

- **System architecture & data flow:** `docs/ARCHITECTURE.md`
- **All TypeScript types & JSON schemas:** `docs/SCHEMAS.md`
- **Core package logic:** `docs/SPEC-CORE.md`
- **CLI commands & behavior:** `docs/SPEC-CLI.md`
- **Web API & frontend:** `docs/SPEC-WEB.md`
- **Artifact templates (ralph.sh, RALPH.md, etc.):** `docs/SPEC-ARTIFACTS.md`
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

This repository IS a ralph-managed project. The `.ralph/` directory at the repo root and `ralph.sh` etc. are this project's own ralph installation. The `artifacts/backlog-json/` directory contains the *templates* used when installing ralph into OTHER projects. Do not confuse them.

---

<!-- ralph:start -->
## Autonomous Loop (Ralph)

When running as a ralph loop iteration (`claude -p`), follow these rules:

1. Read `.ralph/RALPH.md` for per-iteration instructions
2. Read `.ralph/backlog.json` to find the current task (first `pending` item by priority)
3. Mark the item `in_progress` using targeted jq write
4. Implement the task, following acceptance criteria
5. Run verification: `pnpm test && pnpm typecheck`
6. Commit changes with a descriptive message referencing the item ID
7. Emit the appropriate exit signal (RALPH_DONE, RALPH_BLOCKED, RALPH_NEEDS_HUMAN)
<!-- ralph:end -->
