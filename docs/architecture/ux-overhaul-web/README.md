# UX/DX Overhaul — Phase 4: Web Parity, Status Vocabulary & Agent Contract

Phase 4 (the final phase) of the rauf UX/DX overhaul. It makes the **human- and
operator-facing surface** coherent to match the substrate (Phase 1) and command/contract
(Phase 2+3) work: a stuck loop can now be recovered from the web, every surface names a loop
state identically, and the agent contract is documented. Shipped as **rauf v0.6.0** — a normal
additive minor bump (no `minRunnerVersion` change, no feature-forge lockstep, no breaking flip).

Source of truth: `specs/ux-overhaul-web/` (PRD + tech-spec + 00–06) and `specs/ux-overhaul/CANON.md`
(§4.3 status vocabulary, §4.6 agent contract). This doc describes the **landed code**.

## What shipped

Three workstreams:

1. **Web recovery parity.** The recovery/ops actions that were CLI-only — `reset`, `resume`,
   `loop review`, `backlog unblock`, `backlog validate` — are now web endpoints with status-page
   controls. An operator watching a loop in the browser no longer has to drop to a terminal.
2. **Shared status vocabulary.** One core module (`state-labels.ts`) is the single source of truth
   for a loop state's display label + a semantic _tone_, consumed identically by the CLI and both
   web pages. Two states that previously rendered silently — `reviewing` and `paused_usage_limit` —
   are now distinct, badged values (`REVIEWING`, `PAUSED_USAGE_LIMIT`), and `rauf status` exit codes
   reflect them.
3. **Agent-contract docs.** The signal spec, model cascade, and a `progress.md` session-log stub are
   now documented in the agent templates. (The `CLAUDE_ADDON.md → AGENT_ADDON.md` rename is
   deliberately deferred to the separate Part-B provider refactor.)

## Quick start

**Recover a loop from the web** (server on `127.0.0.1:5173`; all mutations need the
`X-Rauf-Request: true` header):

```bash
# Unblock all blocked items
curl -X POST http://127.0.0.1:5173/api/projects/<id>/backlog/unblock \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' -d '{}'

# Validate the backlog (read-only GET — no header needed)
curl http://127.0.0.1:5173/api/projects/<id>/backlog/validate

# Resume a paused/stopped loop (reconcile + relaunch)
curl -X POST http://127.0.0.1:5173/api/projects/<id>/resume \
  -H 'X-Rauf-Request: true' -H 'Content-Type: application/json' -d '{}'
```

Or use the **Recovery** control group on the project status page (Reset / Resume / Review /
Unblock / Validate).

**Read the shared label map** (CLI or web):

```ts
import { STATE_LABELS, getStateLabel } from "@rauf/core";

getStateLabel("PAUSED_USAGE_LIMIT"); // → { label: "Usage Limit (Paused)", tone: "warning" }
getStateLabel("PAUSED_HUMAN"); // → { label: "Needs Human", tone: "warning" }
```

## Key concepts

- **Recovery actions wrap existing logic.** The web routes are thin adapters over `@rauf/core`
  (`resetProject`, `unblockItems`, `validateBacklog`) and `@rauf/loop` (`recoverInterruptedLoop`,
  the review pass via `LoopManager`). No recovery business logic lives in the web layer (CLAUDE.md
  rule #1). To make that possible, the shared resume core was **relocated** from `@rauf/cli` down to
  `@rauf/loop` (see [architecture](./architecture.md#d1-recovery-relocation)).
- **Two guard strengths.** `reset` and `resume` mutate across multiple steps, so they
  **acquire-and-hold** the loop lock across the whole operation (closing a TOCTOU window);
  `unblock` is a single write guarded by a lightweight `checkLock` pre-check; `validate` is a
  read-only `GET` and is never guarded.
- **Label + semantic tone, not color.** The core label map carries no CSS — each surface maps the
  `tone` (`neutral|info|success|warning|danger`) to its own palette (terminal colors in the CLI, CSS
  in the web client). This kills the previous per-surface label/color drift.
- **Status derivation is unchanged.** Adding the two enum values only extends the existing
  file-based derivation; no new subprocess, no change to staleness handling.

## Package surface (new / changed)

| Export / file                                        | What                                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@rauf/core` → `state-labels.ts`                     | `STATE_LABELS`, `getStateLabel`, `StateTone`, `StateLabel` (shared label map)                                                                |
| `@rauf/core` → `schemas.ts`                          | `LoopStateEnum` += `REVIEWING`, `PAUSED_USAGE_LIMIT`                                                                                         |
| `@rauf/core` → `status.ts`                           | `mapLoopStateStatus` (now exported) remaps the two raw states                                                                                |
| `@rauf/loop` → `recovery.ts`                         | `recoverInterruptedLoop`, `reconcileAndRequeue`, `acquireRecoveryLock`, `releaseRecoveryLock`, `detectInterruptedItems` (relocated from cli) |
| `@rauf/cli` → `status-commands.ts`                   | `statusExitCode` maps the two new states; `colorLoopState` is tone-driven                                                                    |
| `@rauf/web` → `routes/projects.ts`, `routes/loop.ts` | the 5 recovery endpoints                                                                                                                     |
| `@rauf/web` → `loop-manager.ts`                      | `startReviewLoop` (+ the shared `launch` helper)                                                                                             |
| `@rauf/web` → `routes/recovery-guard.ts`             | `assertNoLiveLoop`                                                                                                                           |
| `@rauf/web` → `client/components/StateBadge.tsx`     | shared status badge (replaces two copies)                                                                                                    |

## Further reading

- [Architecture](./architecture.md) — design decisions, the dependency-direction story, data flow
- [API Reference](./api-reference.md) — the 5 endpoints, the label map, exit codes, relocated exports
- [Recovery Guide](./guides/recovery.md) — using the web recovery actions + the CLI↔web parity table
- `specs/ux-overhaul-web/` (00–06) and `specs/ux-overhaul/CANON.md` — the source specs
