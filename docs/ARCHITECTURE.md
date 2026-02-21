# Architecture

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Developer Machine                           │
│                                                                  │
│  ┌──────────┐       HTTP        ┌─────────────────────────────┐ │
│  │ ralph CLI │◄────────────────►│ ralph web server             │ │
│  │ (global)  │                  │ Hono + Bun @ 127.0.0.1:5173 │ │
│  └─────┬─────┘                  │                              │ │
│        │                        │ ┌──────────────────────────┐ │ │
│        │                        │ │ React + TanStack Router  │ │ │
│        │ direct calls           │ │ (SPA, served statically) │ │ │
│        │ when headless          │ └──────────────────────────┘ │ │
│        │                        └──────────┬──────────────────┘ │
│        │                                   │                     │
│        ▼                                   ▼                     │
│  ┌─────────────────────────────────────────────┐                │
│  │              packages/core                    │                │
│  │  discovery · installer · backlog · status     │                │
│  │  config · profile · template                  │                │
│  └──────────────────┬──────────────────────────┘                │
│                     │                                            │
│                     ▼                                            │
│  ┌─────────────────────────────────────────────┐                │
│  │         ROOT_DIRECTORY filesystem             │                │
│  │  ~/workspace/                                 │                │
│  │  ├── project-a/.ralph.json, .ralph/, ...      │                │
│  │  └── project-b/.ralph.json, .ralph/, ...      │                │
│  └─────────────────────────────────────────────┘                │
│                                                                  │
│  ┌───────────────┐                                              │
│  │ ~/.ralph/      │  Tool config, server PID, logs              │
│  └───────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Package Dependency Graph

```
packages/web  ──imports──►  packages/core
packages/cli  ──imports──►  packages/core
packages/core ──imports──►  (nothing — standalone)
```

**Rule: `core` NEVER imports from `web` or `cli`.** Core is the shared foundation.

## Package Responsibilities

### packages/core

All filesystem operations and business logic. Zero UI or CLI concerns.

| Module | Responsibility |
|--------|---------------|
| `discovery.ts` | Scan ROOT_DIRECTORY for .ralph.json files, return project list |
| `config.ts` | Read/write .ralph.json marker files, read/write ~/.ralph/config.json |
| `profile.ts` | Tech-stack detection heuristics, profile management |
| `template.ts` | Render .tmpl files with {{variable}} interpolation, sentinel block handling |
| `installer.ts` | Orchestrate artifact installation (existing projects) |
| `greenfield.ts` | Orchestrate greenfield project initialization |
| `backlog.ts` | CRUD operations on backlog.json, validation, atomic writes |
| `status.ts` | Derive loop state from state.json (primary) or ralph.log (fallback) |
| `fs-utils.ts` | Atomic write, JSON read with error handling, path validation, hash computation |
| `schemas.ts` | Zod schemas + TypeScript types for all data structures |
| `errors.ts` | Result type, error codes, structured error types |

### packages/cli

Command-line interface. Parses arguments, calls core functions, formats output.

- Each command is a separate file in `src/commands/`
- Can call core functions directly (headless) or HTTP API (when server running)
- Outputs human-readable by default, `--json` for machine-readable
- Exit codes follow standard (0=success, 1=error, 2=bad args, etc.)

### packages/web

Hono HTTP server + React SPA.

**Server (`src/server/`):**
- API route handlers that call core functions
- CSRF middleware (X-Ralph-Request header check on mutations)
- SSE endpoint for log streaming
- Static file serving for built React app

**Client (`src/client/`):**
- React + TanStack Router for routing
- TanStack Query for server state
- Tailwind CSS for styling
- Shared fetch wrapper with automatic X-Ralph-Request header

**Shared (`src/shared/`):**
- API type definitions shared between server and client

## Data Flow Examples

### Installation Flow
```
User → CLI `ralph install ./project`
       → core/installer.ts
         → core/profile.ts (detect tech stack)
         → core/template.ts (render RALPH.md)
         → core/fs-utils.ts (atomic writes)
         → core/config.ts (write .ralph.json)
       → CLI formats installation report
```

### Status View
```
User → Web UI "Status" tab
       → GET /api/projects/:id/status
       → core/status.ts
         → Read .ralph/state.json (primary)
         → Read .ralph/backlog.json (summary)
         → Fallback: parse .ralph/ralph.log
       → JSON response → React renders
```

### Backlog Add
```
User → Web UI "Add Item" form → POST /api/projects/:id/backlog
       → core/backlog.ts
         → Validate item schema
         → Auto-assign ID (max + 1)
         → Apply smart default acceptance criteria
         → Atomic write to backlog.json (with .bak backup)
       → JSON response → React updates list
```

## ROOT_DIRECTORY Resolution

Priority order:
1. `--root` CLI flag
2. `RALPH_ROOT` environment variable
3. `rootDirectory` in `~/.ralph/config.json`
4. Current working directory

## Security Model

- Server binds to 127.0.0.1 ONLY (never 0.0.0.0)
- No CORS headers set (blocks cross-origin reads)
- Custom `X-Ralph-Request: true` header required on all POST/PUT/DELETE
- Path sandboxing: all writes validated against ROOT_DIRECTORY
- No authentication (localhost single-user only)

## Concurrency Model

- Manager tool: atomic writes (write .tmp → rename)
- ralph.sh loop: targeted jq writes (modify single item by ID)
- No file locking — last-write-wins is acceptable for single-developer use
- Backup on every backlog write (.ralph/backlog.json.bak)
