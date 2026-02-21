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
