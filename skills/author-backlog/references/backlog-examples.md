# Backlog Examples — Gold Standard

These examples demonstrate the quality, detail, and format expected for rauf backlog items. Use them as a reference when authoring items.

> **Enum reminder:** `type` is one of `bug | bugfix | refactor | feature | chore | test`. `status` is one of `pending | in_progress | done | blocked`. New items are always `"status": "pending"` with `"completedAt": null`. Use `dependsOn` (never `dependencies`).

> **Stack note:** Most examples below use a TypeScript monorepo stack (Bun, Hono, `@repo/*` packages). Adapt naming, commands, and file paths to your project's stack — the STRUCTURE and DETAIL level is the quality bar regardless of stack. Use the project's actual verify command (from `.rauf.json` / `.rauf/RAUF.md`) in acceptance criteria, e.g. `bun run typecheck passes for @repo/auth`, `pnpm test && pnpm typecheck passes`, `mypy src/auth/ passes`, `go vet ./auth/... passes`.

## Example 1: Foundation / Scaffold Item (`chore`)

```json
{
  "id": "001",
  "type": "chore",
  "priority": 1,
  "title": "Scaffold packages/auth with package.json, tsconfig, and directory skeleton",
  "description": "Create the `packages/auth/` directory with the full package skeleton.\n\n1. Create `packages/auth/package.json` with:\n   - name: `@repo/auth`\n   - Subpath exports: `.`, `./server`, `./client`, `./react`\n   - Dependencies: `hono`, `jose`, `arctic`, `@simplewebauthn/server`, `argon2`\n   - Internal deps: `@repo/config`, `@repo/db`\n   - Dev deps: `vitest`\n\n2. Create `packages/auth/tsconfig.json` extending `../../tsconfig.json` with `jsx: \"react-jsx\"`\n\n3. Create all source directories with empty barrel index.ts files:\n   - `src/index.ts` (re-exports ./shared)\n   - `src/shared/index.ts`\n   - `src/server/index.ts`\n   - `src/client/index.ts`\n   - `src/react/index.ts`\n\n4. Run `bun install` from monorepo root to install dependencies.",
  "acceptanceCriteria": [
    "packages/auth/package.json exists with correct name, exports, and dependencies",
    "packages/auth/tsconfig.json extends root tsconfig",
    "All four barrel index.ts files exist and export empty objects or type-only re-exports",
    "bun install succeeds from monorepo root",
    "bun run typecheck passes for @repo/auth"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": [],
  "notes": "This is the foundation item. Read spec 01-architecture-layout.md completely before implementing. Use the exact exports map from the spec.",
  "estimatedIterations": 1,
  "specReferences": ["specs/auth/01-architecture-layout.md"]
}
```

**Why this is good:**

- Self-contained: a fresh agent can implement this without reading other backlog items.
- Numbered steps with exact file paths and content.
- Acceptance criteria are verifiable commands (`bun run typecheck passes`).
- Single concern: just the scaffold, not the types or logic.
- Clear spec reference; `dependsOn: []` (no dependencies → lowest priority number).

**Adapting to other stacks:** For a Python project this might scaffold `src/auth/` with `__init__.py`, `pyproject.toml` dependency additions, and pytest config. Acceptance criteria would use `mypy src/auth/` and `pytest tests/auth/` instead of `bun run typecheck`.

## Example 2: Type System Item (`feature`)

```json
{
  "id": "002",
  "type": "feature",
  "priority": 1,
  "title": "Implement shared types, error hierarchy, and constants",
  "description": "Create the complete shared type system for @repo/auth.\n\n1. Create `src/shared/types.ts` with all types from spec 00 section 2:\n   - `SessionToken` interface with `userId`, `sessionId`, `expiresAt`, `roles` fields\n   - `AuthResult` discriminated union: `{ success: true; session: SessionToken }` | `{ success: false; error: AuthError }`\n   - `OAuthProvider` union type: 'google' | 'github' | 'discord'\n   - `Permission` type alias for string\n   - `Role` interface with `name`, `permissions` array\n\n2. Create `src/shared/errors.ts` with error class hierarchy from spec 00 section 3:\n   - `AuthError` base class extending `Error` with `code: string` property\n   - `InvalidCredentialsError` extending `AuthError` (code: 'INVALID_CREDENTIALS')\n   - `SessionExpiredError` extending `AuthError` with `expiredAt: Date` (code: 'SESSION_EXPIRED')\n   - `InsufficientPermissionsError` extending `AuthError` with `required: Permission[]`, `actual: Permission[]`\n   - All classes must have JSDoc on every property\n\n3. Create `src/shared/constants.ts` with:\n   - `SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000` (7 days)\n   - `REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000` (1 day)\n   - `ALL_OAUTH_PROVIDERS: OAuthProvider[]`\n\n4. Update `src/shared/index.ts` to re-export all types, errors, and constants.",
  "acceptanceCriteria": [
    "src/shared/types.ts exports SessionToken, AuthResult, OAuthProvider, Permission, Role",
    "src/shared/errors.ts exports AuthError, InvalidCredentialsError, SessionExpiredError, InsufficientPermissionsError",
    "All error classes have correct inheritance and typed properties",
    "src/shared/constants.ts exports SESSION_DURATION_MS, REFRESH_THRESHOLD_MS, ALL_OAUTH_PROVIDERS",
    "src/shared/index.ts re-exports everything",
    "bun run typecheck passes for @repo/auth"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["001"],
  "notes": "Use EXACT TypeScript from spec 00 — every interface and class is fully specified with JSDoc. Do not simplify or abbreviate.",
  "estimatedIterations": 1,
  "specReferences": ["specs/auth/00-core-definitions.md"]
}
```

**Why this is good:**

- Every type and field is explicitly named — no ambiguity.
- The error hierarchy is spelled out with exact class names and properties.
- Depends on 001 (scaffold must exist first).
- Notes reinforce "use exact TypeScript from spec".

## Example 3: Integration Item (`feature`)

```json
{
  "id": "008",
  "type": "feature",
  "priority": 3,
  "title": "Wire auth middleware into @starter/app-shell Hono server",
  "description": "Integrate the @repo/auth session middleware with the existing @starter/app-shell Hono application.\n\n1. In `packages/auth/src/server/middleware.ts` (created in item 005), export `createAuthMiddleware(config: AuthConfig): MiddlewareHandler` that:\n   - Reads the session cookie from the request\n   - Validates the JWT using `jose`\n   - Attaches `session: SessionToken | null` to the Hono context via `c.set('session', session)`\n   - Does NOT reject unauthenticated requests (that's the route's job)\n\n2. In `apps/app-shell/src/server.ts`, add the auth middleware:\n   - Import `createAuthMiddleware` from `@repo/auth/server`\n   - Import `AuthConfig` from `@repo/auth`\n   - Add `app.use('*', createAuthMiddleware({ ... }))` before route handlers\n   - Read JWT secret from `@repo/config`\n\n3. Add `@repo/auth` as a dependency in `apps/app-shell/package.json`\n\n4. Run `bun install` from monorepo root.",
  "acceptanceCriteria": [
    "apps/app-shell/package.json includes @repo/auth as a dependency",
    "apps/app-shell/src/server.ts imports and uses createAuthMiddleware",
    "Auth middleware is registered before route handlers",
    "Session is accessible via c.get('session') in route handlers",
    "bun run typecheck passes for both @repo/auth and @starter/app-shell",
    "Existing app-shell tests still pass"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["005", "006"],
  "notes": "Read the existing app-shell server.ts to understand the current middleware chain. The auth middleware should slot in AFTER the config middleware but BEFORE route handlers. Check that the Hono context type is extended correctly.",
  "estimatedIterations": 1,
  "specReferences": ["specs/auth/04-integration-points.md", "specs/auth/03-session-management.md"]
}
```

**Why this is good:**

- Integration items specify BOTH sides of the integration (auth package AND app-shell).
- Exact import paths and function signatures.
- Notes call out ordering concerns (middleware chain order).
- Multiple spec references for cross-cutting concerns.
- Acceptance criteria verify both packages typecheck.

## Example 4: Parallelizable Item with Agent Delegation (`feature`)

```json
{
  "id": "032",
  "type": "feature",
  "priority": 2,
  "title": "Migrate auth CLI to @repo/cli (27 commands)",
  "description": "Migrate all 27 auth commands from Commander.js to @repo/cli defineCommand/defineGroup format.\n\nCreate new files:\n- packages/auth/cli/index.ts — exports authCommands GroupDef\n- packages/auth/cli/middleware.ts — withAuthDatabase middleware\n- packages/auth/cli/commands/users.ts — 8 commands\n- packages/auth/cli/commands/roles.ts — 5 commands\n- packages/auth/cli/commands/permissions.ts — 4 commands\n- packages/auth/cli/commands/sessions.ts — 3 commands\n- packages/auth/cli/commands/mfa.ts — 2 commands\n- packages/auth/cli/commands/audit.ts — 2 commands\n- packages/auth/cli/commands/seed.ts — 2 commands\n- packages/auth/cli/commands/migrate.ts — 1 command\n\nEach command must:\n- Preserve all existing flags and arguments from the Commander.js version\n- Use danger: 'destructive' instead of --force for destructive commands\n- Use ctx.output.records/detail/message instead of manual formatting\n- Use ctx.prompt instead of direct @inquirer/prompts imports\n- Translate AuthError catches to CliError subclasses (NotFoundError, ValidationError, etc.)\n- Keep the same business logic — delegate to existing auth services\n\nThe withAuthDatabase middleware replaces the bootstrap pattern:\n- Opens DB connection (ctx.flags.db path)\n- Runs migrations\n- Creates auth instance\n- Injects into ctx.services.db and ctx.services.auth\n- Closes in finally block\n\nAdd @repo/cli as dependency in packages/auth/package.json. Add /cli export path.\n\nDo NOT delete old CLI files yet — that happens in item 039.\n\nError remapping table (REQ-MIG-04):\n- Auth GENERAL_ERROR (1) → InternalError (10)\n- Auth INVALID_USAGE (2) → ValidationError (1)\n- Auth NOT_FOUND (3) → NotFoundError (2)\n- Auth VALIDATION_ERROR (4) → ValidationError (1)\n- Auth DATABASE_ERROR (5) → DatabaseError (4)\n- Auth CANCELLED (6) → not an error (prompt cancellation)",
  "acceptanceCriteria": [
    "authCommands GroupDef exported from packages/auth/cli/index.ts",
    "All 27 commands defined with correct flags, args, danger levels",
    "withAuthDatabase middleware initializes DB and auth service",
    "Destructive commands use danger: 'destructive' (no --force flag)",
    "Auth group has inherited --db flag",
    "AuthError exceptions translated to CliError subclasses",
    "ctx.output used for all output (not console.log or manual tables)",
    "@repo/cli added as dependency in packages/auth/package.json",
    "bun run typecheck && bun run build && bun check passes",
    "Auth commands using @inquirer/prompts migrated to ctx.prompt.* API",
    "Auth error code remapping applied per REQ-MIG-04"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["031"],
  "estimatedIterations": 3,
  "agentDelegation": {
    "recommendedConcurrency": 3,
    "strategy": "Split by command group. Each sub-agent handles one or two command group files independently. All share the same middleware and index structure.",
    "subtasks": [
      "Create packages/auth/cli/middleware.ts (withAuthDatabase) and packages/auth/cli/commands/users.ts (8 user commands: list, create, get, delete, deactivate, reactivate, reset-password, set-password). Reference existing packages/auth/cli/commands/users.ts for business logic. Use defineCommand from @repo/cli.",
      "Create packages/auth/cli/commands/roles.ts (5 commands), packages/auth/cli/commands/permissions.ts (4 commands), and packages/auth/cli/commands/sessions.ts (3 commands). Reference existing files for business logic.",
      "Create packages/auth/cli/commands/mfa.ts (2 commands), packages/auth/cli/commands/audit.ts (2 commands), packages/auth/cli/commands/seed.ts (2 commands), packages/auth/cli/commands/migrate.ts (1 command), and packages/auth/cli/index.ts that assembles the full GroupDef with all subgroups."
    ]
  },
  "specReferences": ["specs/cli/12-migration.md", "specs/cli/tech-spec.md"]
}
```

**Why this is good:**

- `agentDelegation` splits 27 commands across 3 subagents — each subtask is fully self-contained with specific file paths and command counts.
- The `strategy` explains the split logic (by command group, sharing middleware and index).
- `recommendedConcurrency` matches the number of subtasks (3).
- Stays as one backlog item because all commands share one verification step (`bun run typecheck && bun run build && bun check passes`) and must ship together.
- Each subtask references existing files for business logic, so subagents know where to look.
- `estimatedIterations: 3` reflects that this is large/complex despite the parallelization. `model` is omitted so the item stays agent-portable — if the user has opted into Claude tiering, they'd add `"model": "opus"` here (or `"opus[1m]"` if it needed to hold many large files in context at once, unlocking the 1M window at no cost premium). Tier aliases are Claude-only; see the `model` section in SKILL.md.

**When NOT to use agentDelegation:**

- Subtasks have sequential dependencies (subtask B needs subtask A's output).
- Each subtask has its own independent verification step — split into separate backlog items instead.
- The item only touches 1–2 files — the overhead of delegation isn't worth it.

## Example 5: Bug Fix Item (`bugfix`)

```json
{
  "id": "014",
  "type": "bugfix",
  "priority": 1,
  "title": "Fix session cookie not cleared on logout",
  "description": "On logout, the session cookie is set to an empty value but its Max-Age is not set to 0, so browsers keep the (now-empty) cookie and some clients treat it as a live session.\n\nCurrent behavior: `logout()` in `packages/auth/src/server/session.ts` calls `c.header('Set-Cookie', 'session=; Path=/')`.\n\nExpected behavior: the Set-Cookie must include `Max-Age=0` (and the same `Path`, `Secure`, `HttpOnly`, `SameSite` attributes used when the cookie was set) so the browser deletes it immediately.\n\nFix: update `logout()` to build the clearing cookie via the existing `serializeSessionCookie()` helper with `maxAge: 0` and an empty value, instead of the hand-rolled string. Reuse the same attribute set as `setSessionCookie()`.",
  "acceptanceCriteria": [
    "logout() emits a Set-Cookie header with Max-Age=0",
    "The clearing cookie carries the same Path, Secure, HttpOnly, and SameSite attributes as the set cookie",
    "Unit test asserts the logout Set-Cookie header contains Max-Age=0",
    "bun run typecheck passes for @repo/auth"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": [],
  "notes": "Root cause is the hand-rolled cookie string bypassing serializeSessionCookie(). Don't introduce a new cookie helper — reuse the existing one.",
  "estimatedIterations": 1,
  "specReferences": ["specs/auth/03-session-management.md"]
}
```

**Why this is good:**

- States current behavior, expected behavior, root cause, and fix approach — the four things a bugfix description needs.
- Names the exact file, function, and helper to reuse.
- The verification criterion is a concrete unit-test assertion, not "logout works".

## Example 6: Standalone Test Item (`test`)

```json
{
  "id": "021",
  "type": "test",
  "priority": 3,
  "title": "Add edge-case coverage for JWT validation",
  "description": "Add a test suite for `validateSessionJwt()` in `packages/auth/src/server/jwt.ts` covering the edge cases that current tests skip.\n\nCreate `packages/auth/src/server/jwt.test.ts` with cases:\n1. Expired token → returns `{ valid: false, reason: 'expired' }`\n2. Token signed with the wrong secret → `{ valid: false, reason: 'signature' }`\n3. Token missing the `roles` claim → `{ valid: false, reason: 'malformed' }`\n4. Token with `nbf` in the future → `{ valid: false, reason: 'not_yet_valid' }`\n5. Valid token → `{ valid: true, session: SessionToken }`\n\nUse the `signTestJwt()` helper from `tests/helpers/jwt.ts` to mint fixtures. Do not change production code — this item is test-only. If a case reveals a real defect, STOP and signal it rather than editing jwt.ts.",
  "acceptanceCriteria": [
    "packages/auth/src/server/jwt.test.ts exists with the five cases above",
    "Each case asserts the exact reason string returned by validateSessionJwt()",
    "No production source files under src/ are modified",
    "bun test packages/auth/src/server/jwt.test.ts passes"
  ],
  "status": "pending",
  "completedAt": null,
  "dependsOn": ["006"],
  "notes": "Prefer folding tests into the implementation item; this standalone test item exists only because coverage was deferred. Use the existing signTestJwt() helper rather than minting tokens by hand.",
  "estimatedIterations": 1,
  "specReferences": ["specs/auth/03-session-management.md"]
}
```

**Why this is good:**

- Uses the `test` type because the test suite is the deliverable (most tests should instead live in an implementation item's acceptance criteria).
- Enumerates the exact cases and expected results — not "test the edge cases".
- Constrains the agent to test-only changes and tells it what to do if a real bug surfaces.
