# 01 — Architecture & Layout

> Foundation document for `ux-overhaul-web`. The file-by-file change map, the cli→loop recovery
> relocation, the dependency graph, exports, route registration, and the version bump. Implements
> `tech-spec.md` §2, §9. Consumes the types from `00-core-definitions.md`.

## Requirement Coverage

| Requirement | Section |
|---|---|
| REQ-ARCH-01, REQ-WEB-08 | §2 Dependency graph; §3 cli→loop relocation |
| REQ-VOCAB-01 | §4 `@rauf/core` changes (state-labels module) |
| REQ-WEB-01..05, REQ-SEC-01 | §6 `@rauf/web` changes (routes + registration) |
| REQ-VOCAB-03/04, REQ-EXIT-01 | §4 `@rauf/core`; §5 `@rauf/cli` |
| REQ-AGENT-01..03 | §7 docs & templates |
| C-1 (additive minor bump) | §8 Version |

## Dependencies

Depends on `00-core-definitions.md` (type surface). All domain docs (`02`–`06`) depend on this layout.

## 1. Principle: additive, dependency-direction-preserving

No new package; no breaking flip. The one structural move (recovery cli→loop, §3) goes **down** the
dependency graph, never up, so rule #1 (core has zero cli/web imports) and the overall direction
`core ← loop ← {cli, web}` are preserved. Everything else is new files or additive edits.

## 2. Dependency graph (after this feature)

```
@rauf/core   (no deps on loop/cli/web)
   ▲   ▲
   │   └──────────────┐
@rauf/loop            │     loop imports core
   ▲      ▲           │
   │      │           │
@rauf/cli │       @rauf/web      cli & web import loop + core
          └───────────┘
```

- `@rauf/web` already imports `@rauf/loop` (via `loop-manager.ts`) and `@rauf/core` — no new edges.
- `@rauf/cli` already imports `@rauf/loop` (`findItemCommit`/`isTreeClean`/`gitCommit`) — the relocation
  reverses one symbol's direction (recovery now comes *from* loop) but adds no new edge.
- The new `state-labels.ts` lives in `@rauf/core` so both cli and web import it downward (REQ-ARCH-01).

## 3. The cli → loop recovery relocation (D3.1) — REQ-WEB-08

Create `packages/loop/src/recovery.ts` and **move** the shared reconcile/resume core from
`packages/cli/src/recovery.ts`:

| Symbol | Move? | New home |
|---|---|---|
| `recoverInterruptedLoop` (async) | move | `@rauf/loop` |
| `reconcileAndRequeue` (async) | move | `@rauf/loop` |
| `detectInterruptedItems` (async) | move | `@rauf/loop` |
| `acquireRecoveryLock` / `releaseRecoveryLock` | move | `@rauf/loop` |
| types `KeptBlock`, `InterruptedItem`, `ReconcileSummary`, `RecoverySummary`, `AcquiredRecoveryLock` | move | `@rauf/loop` |
| `findInterruptedItems` (internal helper) | move | `@rauf/loop` (private) |
| `reverifyAndCommitInterrupted`, `defaultVerifyRunner` | **stay** | `@rauf/cli` (subprocess `--recover`) |
| types `VerifyOutcome`, `VerifyRunner`, `ItemRecoveryResult` | **stay** | `@rauf/cli` |

Mechanics:
- The moved code's imports flip: it currently does `import { findItemCommit, isTreeClean, gitCommit }
  from "@rauf/loop"` — inside `@rauf/loop` these become intra-package relative imports; its `@rauf/core`
  imports are unchanged.
- Re-export the moved symbols from `packages/loop/src/index.ts`.
- `packages/cli/src/recovery.ts` keeps only the `--recover` symbols and **re-imports** the moved ones
  from `@rauf/loop` (so any CLI code reaching them via `./recovery` keeps working). `resume-commands.ts`
  / `reset-commands.ts` update their import source only — **no behavior change** (D3.1).
- Move the corresponding unit tests to `packages/loop` (see `06-testing-strategy.md`); CLI retains an
  import-smoke test.

## 4. `@rauf/core` changes

- **NEW `packages/core/src/state-labels.ts`** — `StateTone`, `StateLabel`, `STATE_LABELS`,
  `getStateLabel` (`00` §3; table in `02`). Pure; no other-package deps. Export from
  `packages/core/src/index.ts`.
- **`packages/core/src/schemas.ts`** — add `REVIEWING`, `PAUSED_USAGE_LIMIT` to `LoopStateEnumSchema`
  (`:228`). Raw `LoopStateStatusSchema` (`:167`) unchanged.
- **`packages/core/src/status.ts`** — remap `mapLoopStateStatus` (`:106`): `reviewing → REVIEWING`,
  `paused_usage_limit → PAUSED_USAGE_LIMIT` (the `Record<LoopState["status"], LoopStateEnum>` stays
  total — compile-enforced). No change to `deriveStatus`'s file-based derivation (REQ-ARCH-02).
- **`packages/core/src/version.ts`** — bump to `0.6.0` (§8).

## 5. `@rauf/cli` changes

- `packages/cli/src/recovery.ts` — reduced to the `--recover` symbols + re-export of the moved ones
  (§3).
- `packages/cli/src/resume-commands.ts`, `reset-commands.ts` — import the moved recovery symbols from
  `@rauf/loop` instead of `./recovery` (no behavior change).
- `packages/cli/src/status-commands.ts` — `colorLoopState` (`:538`) refactors to map `tone → terminal
  color` via `STATE_LABELS` (handles all 12, no `default:` silent branch); `statusExitCode` (`:512`)
  adds the two new cases (`02` §exit-codes). Both become total over `LoopStateEnum`.

## 6. `@rauf/web` changes — REQ-WEB-01..05, REQ-SEC-01

### 6.1 Routes (new handlers)

| File | Handler |
|---|---|
| `packages/web/src/server/routes/projects.ts` | `POST /:id/reset`, `POST /:id/resume`, `POST /:id/backlog/unblock`, `GET /:id/backlog/validate` |
| `packages/web/src/server/routes/loop.ts` | `POST /:id/loop/review` |

Placement rationale: `reset`/`resume` are project-root recovery verbs alongside the existing recovery
shape; `unblock`/`validate` sit beside the existing `backlog/sweep`/`backlog/restore` in `projects.ts`;
`review` sits with the loop lifecycle routes in `loop.ts`. All inherit the app-level CSRF guard
(`app.ts:54`) and the path guards `resolveProjectPath`/`validateProjectPath`; all resolve `BacklogPaths`
via `resolveBacklogPathsFromParam`. Full handler shapes in `04-web-recovery-routes.md`.

### 6.2 Loop manager

- `packages/web/src/server/loop-manager.ts` — add `startReviewLoop(projectPath, options)` beside
  `startLoop` (`:86`): same map-key + promise tracking, but calls `runner.startReviewOnly()` (D3.2).

### 6.3 Route-layer guard helper

- A small `assertNoLiveLoop(paths): Result<void>` helper (web server layer, e.g. a shared
  `routes/recovery-guard.ts` or inline in `projects.ts`) wrapping core `checkLock` for the lightweight
  `unblock` guard. `reset`/`resume` use `acquireRecoveryLock`/`releaseRecoveryLock` directly (`03`/`04`).

### 6.4 Frontend (status page)

- `packages/web/src/client/routes/projects/status.tsx` — a "Recovery" control group (reset/resume/
  review/unblock/validate) as TanStack Query mutations (validate = query), each sending
  `X-Rauf-Request: true`, each surfacing its result (REQ-WEB-06) and disabling when not applicable
  (REQ-WEB-07). Detail in `04`.
- **Shared badge:** both `STATE_BADGE` copies (`projects/status.tsx:18`, `projects/index.tsx:48`) are
  replaced by one badge component reading `STATE_LABELS` + a single tone→CSS-palette table (`02` §5).

## 7. Docs & templates — REQ-AGENT-01..03, C-5

- Agent-contract doc items land in the artifact templates (`RAUF.md`, the agent addon `CLAUDE_ADDON.md`
  — name unchanged this phase, see PRD §6, and `progress.md` stub) + `docs/SPEC-ARTIFACTS.md`. If any
  embedded template changes, regenerate `packages/core/src/embedded-artifacts.ts` via
  `pnpm --filter @rauf/core build` (Phase 1 landmine). Detail in `05-agent-contract-docs.md`.
- Affected specs updated (C-5): `docs/SPEC-WEB.md` (new routes), `docs/SCHEMAS.md` (enum + label map),
  `docs/SPEC-ARTIFACTS.md` (agent docs), vocabulary mentions in `docs/SPEC-CLI.md` / `ARCHITECTURE.md`.

## 8. Version

`packages/core/src/version.ts` → `0.6.0` (minor). Additive new web features; **not** a contract break.
`minRunnerVersion` and feature-forge are untouched (C-1).

## Verification

- `pnpm typecheck` green across all packages; `@rauf/web` has no `@rauf/cli` import (rule #1).
- `grep` for `from "@rauf/loop"` in `packages/web/src/server` shows the recovery imports resolve.
- `rauf version --json` → `{ "version": "0.6.0" }`.
- Full gate (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`) green.
