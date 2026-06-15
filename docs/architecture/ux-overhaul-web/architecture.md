# Architecture — Web Parity, Status Vocabulary & Agent Contract (v0.6.0)

How Phase 4 is built and why. The throughline: **this is an additive surface layer over reused
engine logic.** No change to `LoopRunner`'s loop, the server daemon's lifecycle, or the Phase-1
file-backed observation substrate. The recovery engine functions already existed; Phase 4 _exposes_
them on the web and _relocates_ one of them so the web can reach it without breaking a dependency
rule.

## The problems it solves

1. **CLI↔web parity gap (CANON §2.6).** `reset`/`resume`/`loop review`/`backlog unblock`/`backlog
validate` were CLI-only — a loop wedged in the web UI had no recovery path.
2. **Status vocabulary drift (CANON §2.5).** The raw→display mapping was triplicated (CLI
   `colorLoopState`, web `status.tsx`, web `index.tsx`) with subtly different labels/colors, and two
   raw states (`reviewing`, `paused_usage_limit`) had no distinct derived value — a usage-limited
   loop _looked idle_.
3. **Undocumented agent contract (CANON §4.6).** The signal tokens, model cascade, and `progress.md`
   format were learned by imitation, not from a spec.

## Decisions

### D1 — Recovery relocation: `@rauf/cli` → `@rauf/loop`

The reusable resume/reconcile core (`recoverInterruptedLoop`, `reconcileAndRequeue`,
`detectInterruptedItems`, `acquireRecoveryLock`, `releaseRecoveryLock` + their types) lived in
`packages/cli/src/recovery.ts`. The web server needs it for the `reset`/`resume` routes — but
**CLAUDE.md rule #1 forbids web importing cli** (the dependency direction is `core ← loop ←
{cli, web}`).

The functions depend only on `@rauf/core` plus three `@rauf/loop` git primitives
(`findItemCommit`/`isTreeClean`/`gitCommit`), so they could move **down** the graph to `@rauf/loop` —
which both cli and web already import. After the move:

- `packages/loop/src/recovery.ts` holds the shared core; re-exported from the package index.
- `packages/cli/src/recovery.ts` keeps only the subprocess-bound `--recover` path
  (`reverifyAndCommitInterrupted`, `defaultVerifyRunner`) and **re-exports** the moved symbols, so
  `resume-commands.ts` / `reset-commands.ts` keep working with no behavior change.
- `@rauf/web` imports the recovery symbols from `@rauf/loop`. **No `@rauf/cli` import in web** — rule
  #1 holds. This is exactly what made web parity possible without forking logic (REQ-WEB-08).

- **Alternative considered:** extract a pure `resumeProject` into `@rauf/core` — rejected: it needs
  the `@rauf/loop` git/tree primitives, so there is no clean core home.
- **Scope:** the heavier `--recover` (re-verify via subprocess, then commit) stays CLI-only; the web
  resume does reconcile + relaunch and _surfaces_ interrupted-uncommitted work in its response
  rather than auto-committing it.

### D2 — Review pass via a `LoopManager` method (engine reused as-is)

`LoopRunner.startReviewOnly()` already implements a standalone review pass. `LoopManager` gained
`startReviewLoop`, which mirrors `startLoop` but calls `startReviewOnly()`. The two share a private
`launch(projectPath, options, run)` helper (the runner-entrypoint is the only difference), so the
key-resolution / already-running guard / event fan-out / promise tracking live in one place. The
review route (`POST /:id/loop/review`) builds `LoopStartOptions` via `LoopStartOptionsSchema.parse`
(supplying the required `sessionTimeoutMinutes` default) and returns immediately; the pass is
observed via the existing Phase-1 events SSE.

### D3 — Concurrency guard: two strengths, by action

Recovery mutations must not corrupt a live loop's state (REQ-WEB-09).

- **`reset`, `resume` — acquire-and-hold.** These run `recoverInterruptedLoop` (which by contract
  does _not_ touch the lock — the caller must hold it). A bare pre-check leaves a TOCTOU window where
  a CLI `loop run` could acquire the lock between the web check and the web mutation. So they
  `acquireRecoveryLock(paths)` and **hold it** across the whole operation, releasing in a `finally`
  via the owner-aware `releaseRecoveryLock`. For `resume`, release happens **before** the relaunch
  hand-off so the relaunched loop's own lock acquisition succeeds.
- **`unblock` — lightweight check-then-act.** A single `unblockItems` write; a `checkLock`-based
  `assertNoLiveLoop` pre-check is sufficient. It is **cross-process** (catches a detached/CLI loop,
  not only loops this server started) and **fail-open** on a lock-read IO error.
- **`review` — start-path 409.** Goes through `startReviewLoop`'s existing already-running dedupe.
- **`validate` — none.** Read-only `GET`; safe during a live run.

### D4 — Shared label map: label + semantic tone (no CSS in core)

`packages/core/src/state-labels.ts` exports `STATE_LABELS: Record<LoopStateEnum, StateLabel>` where
`StateLabel = { label: string; tone: StateTone }` and `StateTone = neutral|info|success|warning|
danger`. The map is **total over the enum** (a missing key is a compile error) and carries **no
color** — each surface owns the tone→palette mapping:

- CLI `colorLoopState` maps `tone → terminal color` via a `Record<StateTone, …>` (no `default:`
  branch).
- The web `StateBadge` component maps `tone → CSS palette` and is typed on `LoopStateEnum` (no
  `?? IDLE` fallback). It replaces the two previous `STATE_BADGE` copies on the dashboard and status
  page.

Adding a future derived state now _forces_ a `STATE_LABELS` entry (compile error otherwise), which
automatically supplies both the CLI color and the web badge — closing the drift that motivated the
phase.

### D5 — Two new derived states + exit-code alignment

`LoopStateEnum` gained `REVIEWING` (raw `reviewing`, was collapsed to `RUNNING`) and
`PAUSED_USAGE_LIMIT` (raw `paused_usage_limit`, was collapsed to `PAUSED`). `mapLoopStateStatus`
(now exported, total over the 12 raw statuses) remaps them. `statusExitCode` adds:
`REVIEWING → RUNNING(6)` (preserves prior observable behavior) and `PAUSED_USAGE_LIMIT → LIMIT(4)`
(corrects today's silent `0` — a usage-limited loop no longer "looks idle" to a supervisor). The
unified v0.5.0 exit table is otherwise unchanged. `deriveFromStateJson`'s staleness branch still keys
on the **raw** status, so `REVIEWING` is not swept into a stale-downgrade.

### D6 — Agent-contract documentation (doc-only)

The signal spec (`RAUF_DONE`/`RAUF_BLOCKED`/`RAUF_NEEDS_HUMAN`/`RAUF_REVIEW`, line-by-itself,
backward-scan-from-end, no-signal→exit-context), the model cascade
(`item.model > --model/options > project default > provider default`), and a `progress.md`
session-log stub were added to the artifact templates + `docs/SPEC-ARTIFACTS.md`. Because the
templates are embedded, `embedded-artifacts.ts` was regenerated. The `CLAUDE_ADDON.md → AGENT_ADDON.md`
rename and "Task tool" → provider-neutral wording are **deferred to Part-B** (they couple to that
refactor).

## Data flow (recovery action)

```
  browser control ──POST /api/projects/:id/<action> (X-Rauf-Request)──▶ Hono route
       │                                                                    │
       │   resolveProjectPath → validateProjectPath → safeParse(body)       │
       │   → resolveBacklogPathsFromParam → guard (D3)                      │
       ▼                                                                    ▼
   reset/resume ── acquire-and-hold ──▶ @rauf/core / @rauf/loop fns ──▶ atomic file writes
   unblock      ── assertNoLiveLoop  ──▶ unblockItems (core)                │
   validate (GET, ungated)           ──▶ validateBacklog (core)            │
       │                                                                    │
       ▼  Result<T> ── recoveryErrorStatus ──▶ { data } | { error }        │
   observers (status page, CLI status/follow) ── read files ◀──────────────┘
```

The action surface adds no new observation path — everything is still reconstructed from files
(Phase 1), so CLI and web stay in agreement by construction.

## What changed, by package

| Package          | Change                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@rauf/core`     | NEW `state-labels.ts`; `LoopStateEnum` += 2 values; `mapLoopStateStatus` exported + remapped; `version.ts` → 0.6.0                                              |
| `@rauf/loop`     | NEW `recovery.ts` (relocated from cli) + re-exports; engine (`LoopRunner`) unchanged                                                                            |
| `@rauf/cli`      | `recovery.ts` reduced to `--recover` + re-exports; `statusExitCode` += 2 cases; `colorLoopState` tone-driven                                                    |
| `@rauf/web`      | 5 recovery routes; `LoopManager.startReviewLoop` + `launch` helper; `recovery-guard.ts`; `loop-defaults.ts`; shared `StateBadge`; status-page Recovery controls |
| docs / artifacts | agent-template doc items + regenerated `embedded-artifacts.ts`; `SPEC-WEB`/`SCHEMAS`/`SPEC-CLI`/`SPEC-ARTIFACTS`/`ARCHITECTURE` updated                         |

## Further reading

- [API Reference](./api-reference.md) — exact endpoints, the label map, exit codes, relocated exports
- [Recovery Guide](./guides/recovery.md) — operator usage + CLI↔web parity
- `specs/ux-overhaul-web/` (00–06), `specs/ux-overhaul/CANON.md`
