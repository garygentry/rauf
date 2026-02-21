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
