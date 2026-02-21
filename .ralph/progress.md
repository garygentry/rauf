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
