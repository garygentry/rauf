# Progress & Learnings

## Codebase Patterns

- Monorepo: packages/core (shared logic), packages/cli, packages/web
- Core has ZERO imports from cli or web
- All file writes use atomic pattern (write .tmp → rename)
- Result<T,E> type for all core function returns — never throw for expected errors
- Zod schemas in core/src/schemas.ts are the canonical type definitions
- Path validation before any filesystem write

## Session Log
<!-- Each iteration appends its learnings here -->

### 001: Project Scaffolding (completed)
- pnpm install/build/test/typecheck/lint/format:check all pass
- Core tsconfig needs `composite: true` for project references from cli/web
- Vitest needs `passWithNoTests: true` in config to exit 0 with no test files
- ESLint flat config at root with `typescript-eslint` — all packages inherit it
- Web package: dual build (`vite build` for React SPA, `tsc` for server code)
- Prettier formats docs/ and CLAUDE.md — `.prettierignore` excludes .ralph, .claude, artifacts, plans
- `@eslint/js` v9 matches eslint v9; v10 requires eslint v10 (peer dep mismatch)
- *.tsbuildinfo added to .gitignore (build artifact from composite projects)

### 002: Core Zod Schemas (completed)
- All schemas in `packages/core/src/schemas.ts`, types inferred via `z.infer<>`
- BacklogItemPrioritySchema uses `.min(1).max(4)` with cast to `z.ZodType<1|2|3|4>` for literal union type
- MarkerFile uses `z.literal(true)` for ralph sentinel — rejects `false` and `"true"`
- BacklogItemIdSchema regex `^\d{3,}$` — requires minimum 3 digits, zero-padded
- `VALID_STATUS_TRANSITIONS` map and `LOG_PATTERNS` regexes also live in schemas.ts
- `apiSuccessSchema()` is a factory function (generic over data schema) since Zod can't infer generics statically
- Result<T,E> is a structural type alias, not a Zod schema — it's used at compile time only
- 60 unit tests covering valid/invalid for every schema

### 003: Result type, error codes, fs-utils (completed)
- `Result<T,E>` moved from schemas.ts → errors.ts to separate runtime validation (Zod) from error handling
- `RalphError` type stays in schemas.ts (Zod-inferred), errors.ts imports it — avoids duplicate export collision
- `ErrorCodes` is `as const` object (8 codes matching SPEC-CORE.md): FILE_NOT_FOUND, INVALID_JSON, VALIDATION_ERROR, PATH_VIOLATION, ALREADY_INSTALLED, NOT_INSTALLED, CONFLICT, TRANSITION_INVALID
- `atomicWrite` creates .bak backup ONLY for `backlog.json` files (basename check), not other files
- `validatePath` uses `resolved.startsWith(root + path.sep)` to prevent prefix-of-path false positives (e.g. /foo shouldn't match /foobar)
- `readJsonFile` returns 3 distinct error codes: FILE_NOT_FOUND → INVALID_JSON → VALIDATION_ERROR (cascading)
- `computeHash` reads file as Buffer (not utf-8 string) to handle binary files correctly
- When re-exporting with `export * from` in index.ts, name collisions across modules cause TS2308 — must ensure no duplicate exports
- 50 new tests (13 errors + 37 fs-utils), total 110 across core package

### 004: Project discovery module (completed)
- `discoverProjects()` returns `DiscoveryResult { projects, ignored, warnings }` — richer than just `DiscoveredProject[]`
- Scans rootDir itself + immediate children (depth=1 only) for `.ralph.json`
- Uses `readJsonFile` with `MarkerFileSchema` for validation — reuses existing fs-utils
- `/artifacts/` exclusion uses `path.sep` for platform-independent matching
- `ignoreInTool: true` projects separated into `ignored` array (not filtered out silently)
- Projects sorted case-insensitively by name via `localeCompare`
- 14 new tests with temp directory fixtures, total 124 across core package

### 005: Config module — marker file and tool config (completed)
- `readMarkerFile` and `writeMarkerFile` are thin wrappers around `readJsonFile`/`atomicWrite` + path join
- `readToolConfig` returns `DEFAULT_TOOL_CONFIG` when `~/.ralph/config.json` is missing (FILE_NOT_FOUND → defaults)
- `writeToolConfig` calls `ensureDir(~/.ralph/)` before writing — safe for first-run
- `resolveRootDirectory` implements priority chain: cliRoot → envRoot param → RALPH_ROOT env var → config file → cwd
- Empty string args treated as falsy (fall through to next source) — intentional for CLI flag parsing
- Tests for writeToolConfig/readToolConfig round-trip save/restore the real `~/.ralph/config.json` to avoid side effects
- Constants exported for testability: MARKER_FILENAME, TOOL_CONFIG_DIR, TOOL_CONFIG_PATH, DEFAULT_TOOL_CONFIG, RALPH_ROOT_ENV
- 29 new tests, total 153 across core package

### 006: Tech-stack detection and profile management (completed)
- `detectProfile()` is read-only — scans filesystem for indicator files, returns `ProjectProfile`
- Language detection uses first-match-wins over ordered indicator file list (package.json → pyproject.toml → go.mod → Cargo.toml)
- Node.js projects refined to `node-typescript` vs `node-javascript` based on `tsconfig.json` presence
- Package manager detection checks lock files in priority: pnpm-lock.yaml → bun.lockb → bun.lock → yarn.lock → package-lock.json → npm default
- Monorepo detected from pnpm-workspace.yaml, lerna.json, or package.json `workspaces` field
- Command derivation for Node.js reads `package.json` scripts — only suggests commands that actually exist (e.g. won't suggest `pnpm test` if no `test` script)
- npm uses `npm run <script>` prefix; pnpm/yarn/bun use `<manager> <script>` directly
- `format:check` script preferred over `format` script for format command
- `readPackageJsonSafe()` is a best-effort JSON read (no Zod validation) — package.json has a much broader shape than we need
- `getPreset()` returns deep copies to prevent mutation of the preset registry
- `mergeProfileOverrides()` treats empty string as "explicitly disabled" → sets command to null
- Composite `verify` string rebuilt after any override to stay consistent
- Non-Node.js projects (Python, Go, Rust) have hardcoded sensible default commands
- 57 new tests, total 210 across core package

### 008: Core: CLAUDE.md smart merge logic (completed)
- `mergeClaudeMd(projectPath, ralphBlockContent)` handles four scenarios: create, append (merged), skip, replace (updated)
- Returns `ClaudeMdMergeResult { action, filePath }` — action aligns with `InstallAction` types for installer integration
- Reuses `updateSentinelBlock` from template.ts for append and replace — no duplication of sentinel logic
- Skip detection normalizes whitespace (trim) before comparing inner content — prevents false updates from formatting differences
- `extractRalphBlock(addonContent)` parses CLAUDE_ADDON.md template, stripping sentinel markers to get inner content
- Idempotency verified: create→skip, append→skip, replace→skip all tested
- Sentinel constants exported: `CLAUDE_MD_SENTINEL_START = "<!-- ralph:start -->"`, `CLAUDE_MD_SENTINEL_END = "<!-- ralph:end -->"`
- 20 new tests, total 262 across core package

### 009: Core: Backlog CRUD with validation and smart defaults (completed)
- `readBacklog`/`writeBacklog` are thin wrappers around `readJsonFile`/`atomicWrite` — `.bak` backup is automatic since `atomicWrite` detects `backlog.json` by basename
- `addItem` computes next ID as `max(existing IDs as numbers) + 1`, zero-padded to 3 digits — gaps from deletions are intentional (never renumber)
- Smart default criterion: reads `.ralph.json` marker file to get `profile.verify` command, falls back to generic "All verification checks pass" if no marker
- `CreateItemInput` and `UpdateItemInput` interfaces defined locally in backlog.ts — these are input DTOs, not Zod schemas (validation is structural)
- `validateStatusTransition` allows same-status (no-op) as valid — simplifies callers that unconditionally pass status
- `updateItem` auto-sets `completedAt` to ISO 8601 when status transitions to `"done"` — uses `new Date().toISOString()`
- `deleteItem` checks `state.json` for active loop (status `"running"` or `"starting"`) — only blocks `in_progress` items; other statuses always deletable
- If `state.json` is missing or invalid, loop is assumed inactive — deletion proceeds (safe default)
- `restoreFromBackup` does a simple `fs.copyFileSync(.bak → current)` — no validation of .bak content (trusts atomic write integrity)
- Cross-module dependency: backlog.ts imports `readMarkerFile` from config.ts for smart defaults — acceptable within `@ralph/core`
- 66 new tests, total 328 across core package

### 010: Core: Status derivation (state.json + log parsing fallback) (completed)
- `deriveStatus(projectPath)` implements two-tier status derivation: Tier 1 (state.json) → Tier 2 (log parsing fallback)
- Tier 1: reads state.json via `readJsonFile` + `LoopStateSchema`, maps `LoopState.status` → `LoopStateEnum` (e.g. "starting"/"running" → "RUNNING")
- Staleness detection: if status is "running"/"starting" and `updatedAt` > 5 min old → downgrades to "PAUSED"
- Tier 2 fallback: checks log mtime (<60s → RUNNING), DONE file (→ COMPLETE/PAUSED_HUMAN/LIMIT_REACHED/ERROR), stale log (→ PAUSED)
- DONE file content parsed heuristically: "human"/"needs_human" → PAUSED_HUMAN, "limit" → LIMIT_REACHED, "error" → ERROR, else → COMPLETE
- Log parsing extracts iteration/maxIterations from `--- Iteration N / M ---` patterns, startedAt from timestamps, lastSignal from signal patterns
- `readLogTail(projectPath, lines?)` returns last N lines, capped at 10,000, handles missing files gracefully (returns `[]`)
- `watchLog(projectPath, callback)` uses `fs.watch` with incremental reads (tracks lastSize, reads only new bytes) — returns cleanup function
- BacklogSummary always populated via `computeBacklogSummary()` — reads backlog.json, returns zeros on failure
- NOT_INSTALLED state returned when `.ralph/` directory doesn't exist
- Export collision fix: `STATE_FILENAME` was already exported from backlog.ts — removed duplicate export from status.ts to avoid TS2308
- `RALPH_DIR` constant (".ralph") exported from status.ts alongside `BACKLOG_DIR` from backlog.ts — same value, different name
- 48 new tests, total 376 across core package

### 011: Core: Installer module for existing projects (completed)
- `install()` orchestrates: preflight → profile detect → ensureDir → deploy scripts → render RALPH.md → create backlog → deploy progress → merge CLAUDE.md → write .ralph.json
- Scripts (ralph.sh, ralph-status.sh, ralph-add.sh) deploy to **project root** (not .ralph/), with chmod +x
- Data files (RALPH.md, backlog.json, progress.md) deploy to `.ralph/` directory
- CLAUDE.md merge delegated to existing `mergeClaudeMd()` + `extractRalphBlock()` from claude-md.ts
- `update()` implements three-way hash comparison: stored (from .ralph.json) vs current (disk) vs canonical (source artifact)
  - `up_to_date`: current == canonical → skip
  - `safe_update`: current == stored (no local mods) → auto-update
  - `local_only`: stored == canonical (no new version) → preserve local changes
  - `conflict`: all three differ → warn, skip
- `uninstall()` defaults to preserving backlog.json, progress.md, ralph.log; removes scripts, RALPH.md, marker, CLAUDE.md section
- `preflight()` checks: directory exists (error), git repo (warning), already installed (error), jq in PATH (warning), claude in PATH (warning)
- `isCommandInPath()` scans PATH directories with `fs.accessSync(X_OK)` — no subprocess needed
- Export collision trap: `RALPH_DIR` already exported from status.ts — installer uses local `DOT_RALPH` constant and avoids re-exporting
- Same trap with `MARKER_FILENAME` from config.ts — installer imports from config.ts instead of defining its own
- Circular import risk: installer.ts must NOT import from index.ts (since index.ts re-exports installer) — defines `TOOL_VERSION` locally
- Idempotency: install() handles already-installed case gracefully (re-deploys artifacts, skips identical files)
- backlog.json never overwritten if it exists — validated and skipped
- 57 new tests, total 433 across core package

### 012: Core: Greenfield project initialization (completed)
- `initProject(targetPath, options)` implements 8-step greenfield flow: mkdir → validate path → git init → profile from preset → scaffold CLAUDE.md → install artifacts → seed backlog → return report
- Uses `spawnSync("git", [...])` with array args for git init/add/commit — safe against injection, explicit env vars for CI headless environments
- Profile fixup pattern: installer's `detectProfile()` returns `stack: "unknown"` on empty dir — greenfield calls `getPreset()`, passes commands as `profileOverrides`, then patches marker file with correct profile after install completes
- CLAUDE.md two-pass: greenfield renders `CLAUDE_GREENFIELD.md.tmpl` (includes ralph sentinels) → when installer's `deployClaudeMd` runs, `mergeClaudeMd` finds existing sentinels and skips
- `profileToOverrides()` converts profile commands to `ProfileOverrides` — empty string means "explicitly disabled" (null in profile → "" in overrides → null after merge)
- Stack-appropriate `.gitignore` templates for node-typescript, node-javascript, python, go, rust, custom — plus ralph-specific entries (state.json, DONE, ralph.log) appended to all
- `parseBacklogSeed()` supports two formats: JSON (full Backlog schema or partial item array) and Markdown (`- [ ] [type] title`)
- Markdown parsing: regex `/^-\s+\[[ x]\]\s+(?:\[(\w+)\]\s+)?(.+)$/` — type is optional, defaults to "feature", case-insensitive
- Priority auto-assignment: position-based (1, 2, 3, 4, 4, 4, ...) — capped at 4
- Backlog seeding calls `addItem()` per item — preserves proper ID assignment and smart default criteria
- `rootDirectory` validation is a warning, not blocking — project is created but may not appear in discovery
- No export collision issues — `CLAUDE_GREENFIELD_TEMPLATE` and other constants are unique names
- 49 new tests, total 482 across core package

### 035: Artifact: ralph.sh with state.json writes and targeted jq updates (completed)
- Canonical ralph.sh lives at `artifacts/variants/backlog-json/ralph.sh` — root `ralph.sh` is a **symlink** to it (enforced by `repo-integrity.test.ts`)
- maxIterations resolution chain: CLI arg → `.ralph.json` options.maxIterations → default 20 (spec default)
- `jq -r '.options.maxIterations // 20' ".ralph.json"` reads marker file with fallback — `2>/dev/null || echo 20` handles missing jq gracefully
- Script was already feature-complete from project bootstrapping — main change was aligning default with spec (100 → 20) and making `.ralph.json` options functional
- `write_state()` produces valid JSON matching all 10 LoopState schema fields via cat heredoc + mv atomic write
- Targeted jq writes (`mark_in_progress`, `mark_done`, `mark_blocked`, `reset_to_pending`) each operate on a single item by ID — safe for concurrent manager tool access
- `select_next_item()` includes dependency checking: only picks pending items whose `dependsOn` IDs are all in `done` status
- Retry logic (beyond spec minimum): `declare -A RETRY_COUNTS` tracks per-item failures in memory, auto-blocks after MAX_RETRIES
- `cleanup` EXIT trap resets stranded in_progress items on unexpected termination — CURRENT_ITEM_ID cleared after each iteration to prevent false resets
- Self-hosting pattern: this project's `.ralph.json` has `maxIterations: 100`, so the symlinked script reads that value rather than defaulting to 20

### 013: CLI: Command framework, arg parsing, help, output formatting (completed)
- Custom lightweight arg parser in `parser.ts` — no external deps (commander/yargs)
- Parser separates global flags (`--json`, `--no-color`, `--quiet`/`-q`, `--root`) from per-command args
- `parseArgs(argv, subcommandNames?)` takes optional subcommand set for two-level routing (e.g. `backlog list`)
- Flag helpers: `extractBoolFlag`, `extractStringFlag`, `extractNumberFlag`, `extractRepeatableFlag` — consume from Map and remove
- `extractRepeatableFlag` works on raw argv (not Map) since Map can't store duplicates
- Output formatter in `formatter.ts` wraps picocolors with runtime `--no-color` gating
- picocolors checks NO_COLOR/TTY at import time; our wrapper adds runtime `colorEnabled` toggle for CLI flags
- In non-TTY (vitest), picocolors returns plain text regardless — tests can't assert ANSI presence without FORCE_COLOR
- `configureOutput()` sets global state: `colorEnabled`, `quietMode`, `jsonMode` — affects `info()`, `warn()`, `success()` output
- `renderTable(columns, rows)` computes column widths from headers and data, supports right-align and max-width truncation
- `stripAnsi()` regex for width calculation of colored strings in table alignment
- Command registry in `commands.ts` — all 14 SPEC-CLI.md commands registered with descriptions and subcommands
- Only `version` and `help` have handlers; unimplemented commands return exit 1 with "not yet implemented" message
- Unknown commands (not in registry) return exit 2 with Levenshtein-based "did you mean?" suggestion
- Entry point `index.ts` does two-pass parsing: first pass identifies command, second re-parses with subcommand awareness
- `detectColorSupport()` checks `NO_COLOR` env and `process.stdout.isTTY` before CLI flags override
- Exit codes match SPEC-CLI.md: 0=success, 1=error, 2=invalid args, 3=not found, 4=validation, 5=conflict
- 91 new tests (45 parser + 21 formatter + 25 commands), total 573 across monorepo

### 020: Web: Hono server setup — middleware, CSRF, health endpoint (completed)
- `createApp(startedAt?)` factory function in `app.ts` — no Bun-specific imports, fully testable in Vitest/Node
- `index.ts` (entry point) calls `Bun.serve({ hostname: "127.0.0.1", ... })` — never 0.0.0.0
- CSRF middleware: POST/PUT/DELETE require `X-Ralph-Request: true` exactly — `"false"`, `"1"`, missing all return 403
- GET/HEAD/OPTIONS pass through without CSRF check — read-only methods are safe
- No CORS headers added — browser blocks cross-origin reads automatically; custom header adds defense-in-depth
- `GET /api/health` returns `{ data: { version, uptime, rootDirectory, projectCount } }` — uptime in seconds
- `projectCount: 0` is hardcoded until `/api/projects` route (021) is implemented
- `app.onError()` + `app.notFound()` both return standard `{ error: { code, message } }` format
- `errorResponse()` helper omits `details` key entirely when not provided (not set to `undefined`)
- Static serving via `hono/bun`'s `serveStatic` — only in entry point, not in `app.ts` (avoids Bun coupling in tests)
- Test strategy: `app.request(path, init)` — Hono's built-in test helper, no real HTTP server needed
- `startedAt` injected into factory so tests can control uptime (e.g., pass `Date.now() - 2000` to test uptime >= 1)
- 20 new tests in web package, total ~723 across monorepo

### 014: CLI: Server management commands (completed)
- Server handlers in `server-commands.ts`: handleServerStart, handleServerStop, handleServerRestart, handleServerStatus, handleServerLogs
- PID file at `~/.ralph/server.pid`, log file at `~/.ralph/server.log` — both in RALPH_CONFIG_DIR
- `resolveServerEntry()` walks from `packages/cli/src/` up to repo root, returns path to `packages/web/src/server/index.ts`
- Daemon mode: `child_process.spawn` with `{ detached: true, stdio: ['ignore', logFd, logFd] }` — open log file with `fs.openSync` for fd-based redirection, then `child.unref()` + `fs.closeSync(logFd)` in parent
- Foreground mode: `child_process.spawnSync("bun", ["run", serverEntry], { stdio: "inherit" })` — blocks until exit
- Process liveness: `process.kill(pid, 0)` — signal 0 validates existence without killing; throws ESRCH if dead
- Health endpoint: `fetch(http://127.0.0.1:{port}/api/health)` with AbortController timeout (2s) — returns null on any failure
- Non-TTY auto-selects daemon mode when neither --foreground nor --daemon is specified
- Test pattern: backup and restore real `~/.ralph/server.pid` and `~/.ralph/server.log` in beforeEach/afterEach to avoid test pollution
- 29 new tests, total 252 in CLI package (adding to overall monorepo count)

### 015: CLI: Install and init commands (completed)
- Four new command handlers in `install-commands.ts`: handleInstall, handleInit, handleUpdate, handleUninstall
- Each handler is a thin adapter: parse flags → resolve paths → call core → format output (no business logic in CLI)
- `resolveArtifactsDir()` uses `import.meta.url` to walk from `packages/cli/src/` up to repo root → `artifacts/variants/backlog-json/`
- Preflight display runs before install (unless `--yes`): shows ✓/✗/⚠ for each check, maps directory_exists failure to NOT_FOUND exit code
- Profile override flags (`--test-cmd`, `--typecheck-cmd`, etc.) are only passed to core when at least one is specified — `undefined` vs empty object matters
- `handleCoreError()` maps core `ErrorCodes` → CLI `ExitCode`: FILE_NOT_FOUND→NOT_FOUND, NOT_INSTALLED→NOT_FOUND, VALIDATION_ERROR→VALIDATION, CONFLICT→CONFLICT
- Init validates `--stack` preset against a known set before calling `initProject()` — fail-fast with INVALID_ARGS instead of a core error
- Init checks for existing `.ralph.json` and returns CONFLICT — prevents accidentally re-initializing a project
- Uninstall preserves data files by default (`keepBacklog: true`, `keepProgress: true`, `keepLog: true`)
- JSON output mode (`--json`): install/init/update output the full `InstallationReport`, uninstall outputs `{success, path, keepData}`
- 27 new tests covering all commands, all flag combinations, error paths, JSON output, and registry integration; total 600 tests across monorepo

### 023: Web API: Status routes + SSE log streaming (completed)
- `createStatusRouter()` in `packages/web/src/server/routes/status.ts` — mounted at `/api/projects` alongside `createProjectsRouter()`
- Route ordering: `/:id/log/stream` registered before `/:id/log` (though Hono handles different segment counts correctly, explicit order clarifies intent)
- SSE via `streamSSE(c, cb)` from `hono/streaming` — Hono 4.12.1 wraps TransformStream, exposes `stream.onAbort()` for cleanup
- **Key insight**: `stream.closed` is only `true` when `stream.close()` is explicitly called; `stream.aborted` is `true` when client disconnects (via `responseReadable.cancel` → `this.abort()`)
- **OOM trap avoided**: Using `while (!stream.closed)` loop caused OOM in tests because `stream.closed` never became true from client cancellation. Fixed by using `await abortPromise` instead — resolves when `stream.onAbort()` fires
- SSE pattern: send initial events, set up `setInterval` for heartbeat (30s) and status polling (5s), `await abortPromise` to block, cleanup in `forEach` after resolve
- `watchLog` uses `fs.watch` — throws ENOENT if log file doesn't exist, must wrap in try/catch
- `LoopStateSchema.lastSignal` is `z.enum(["clean","blocked","needs_human","error"])` — NOT nullable; test fixtures that use `lastSignal: null` fail schema validation silently (fall to Tier 2 log parsing)
- Progress endpoint reads `.ralph/progress.md` directly (no core function exists), returns `{ data: "" }` on missing file
- 23 new tests, total 105 in web package (now across backlog, projects, status, app test files)
- Pre-existing CLI test failure (`handleServerStatus > reports running with JSON output when PID is alive`): expects `uptime: null` but gets real uptime when ralph server is running in test environment — NOT caused by 023

### 026: Web Frontend: React + TanStack Router + Query setup, app shell (completed)
- Tailwind CSS v4 requires `@tailwindcss/vite` Vite plugin (NOT `postcss.config.js`) — install as devDep, import in vite.config.ts
- Tailwind v4 CSS: `@import "tailwindcss"` (not `@tailwind base/components/utilities`) + `@theme {}` block for custom variables
- TanStack Router v1: code-based routing — `createRootRoute`, `createRoute`, `createRouter` — no Vite plugin needed
- Router `redirect()` must be thrown inside `beforeLoad` (not returned): `throw redirect({ to: "/projects" })`
- `useParams({ strict: false })` on leaf routes — without strict mode, params from parent routes are accessible
- ThemeProvider stores preference in localStorage; `data-theme` attribute on `<html>` element drives dark mode CSS vars
- Light/dark theme via CSS custom properties scoped to `[data-theme="dark"]` on `<html>` element
- `QueryClient` with `staleTime: 30_000` matches SPEC-WEB "auto-refresh every 30s" requirement
- Shared `ralphFetch` wrapper sets `X-Ralph-Request: true` header — required by CSRF middleware on all mutations
- Vite dev server proxies `/api` → `127.0.0.1:5173` — allows frontend dev on 5174 to hit the Hono server on 5173
- Build outputs: `build/index.html` + `build/assets/*.{css,js}` — these are the static assets served by Hono's `serveStatic`
- Provider stack in main.tsx: ThemeProvider → QueryClientProvider → RouterProvider (order: theme outermost)
