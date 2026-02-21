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
