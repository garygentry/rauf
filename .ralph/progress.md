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
