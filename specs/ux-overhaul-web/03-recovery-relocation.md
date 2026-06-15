# 03 — Recovery Relocation (`cli → @rauf/loop`)

> Domain document for `ux-overhaul-web` (Phase 4). Owns the **relocation half** of decisions
> D3.1 (resume's reusable core moves to `@rauf/loop`) and D3.4 (acquire-and-hold lock model) for
> **REQ-WEB-02** (web resume action) and **REQ-WEB-08** (no business logic in the web layer).
>
> This document elaborates the move table in `01-architecture-layout.md` §3 and uses the exact type
> shapes from `00-core-definitions.md` §4. It is a **pure refactor**: the moved code is byte-for-byte
> the same logic; only its package home and import sites change. `rauf resume` / `rauf reset` behavior
> is unchanged (stated as an explicit invariant in §4 and verified in §8).
>
> The web side that *consumes* the relocated symbols (the `POST /:id/resume` and `POST /:id/reset`
> routes, the `assertNoLiveLoop` helper) is wired in `04-web-recovery-routes.md`. The test move is
> specified in `06-testing-strategy.md`. This document specifies **what moves, how the imports
> re-wire, and the lock contract** that both CLI and web callers must honor.

## Requirement Coverage

| Requirement | Section |
|---|---|
| REQ-WEB-08 (no business logic in web; shared impl lives down the graph) | §2 Partition; §3 Import mechanics; §5 Dependency-direction safety |
| REQ-WEB-02 (web resume reuses the relocated `recoverInterruptedLoop`) | §2 Moved functions; §4 Lock contract; §6 Error handling |
| D3.1 (relocation) | §2, §3 |
| D3.4 (acquire-and-hold lock model, as it applies to recovery) | §4 |

> The status-vocabulary half of this feature (REQ-VOCAB-\*, REQ-EXIT-\*) is owned by
> `02-status-vocabulary.md`; the web routes (REQ-WEB-01..07, REQ-SEC-\*) by `04-web-recovery-routes.md`;
> agent docs (REQ-AGENT-\*) by `05-agent-contract-docs.md`. This document owns only REQ-WEB-02 and
> REQ-WEB-08's relocation obligation.

## Dependencies

Implement in this order:

1. `00-core-definitions.md` — defines the relocated type shapes (§4) and the `Result`/`BacklogPaths`/
   `LockStatus`/`ErrorCodes` anchors (§1) this document references. Do **not** redefine them here.
2. `01-architecture-layout.md` — §3 declares the move (`cli → loop`, down the dependency graph) and
   §2 the dependency invariant this document preserves.

No code in `02`, `04`, `05`, `06` is a prerequisite for the relocation itself — but `04` (web routes)
and `06` (test move) **depend on this document** being implemented first.

---

## 1. Background — what `recovery.ts` is today

`packages/cli/src/recovery.ts` is the shared reconcile/resume core used by both `rauf reset`
(`reset-commands.ts`) and `rauf resume` (`resume-commands.ts`). It currently sits in `@rauf/cli` but
its shared half depends only on `@rauf/core` and three `@rauf/loop` git primitives — so it can move
**down** the dependency graph to `@rauf/loop`, which both the CLI and the web server already import.

Verified imports at the top of the current file (`packages/cli/src/recovery.ts:17-38`):

```ts
import * as fs from "node:fs";
import { spawn } from "node:child_process";

import {
  readBacklog, writeBacklog, readJsonFile, acquireLock, checkLock, releaseLock,
  resetStalledItems, clearDoneFile, clearCancelFile, ok, err, ErrorCodes,
  LoopStateSchema, type Backlog, type BacklogPaths, type Result,
} from "@rauf/core";
import { findItemCommit, isTreeClean, gitCommit } from "@rauf/loop";
```

The only `@rauf/loop` cross-package dependency is `findItemCommit`, `isTreeClean`, `gitCommit` — all
three are already re-exported from `packages/loop/src/index.ts:4,7` and defined in
`packages/loop/src/git-commit.ts` (`gitCommit`) and `packages/loop/src/git-reconcile.ts`
(`findItemCommit`, `isTreeClean`). `@rauf/loop` already declares `"@rauf/core": "workspace:*"`
(`packages/loop/package.json:17`), so the `@rauf/core` imports survive the move verbatim.

`spawn` (`node:child_process`) is used **only** by `defaultVerifyRunner`, which stays in `@rauf/cli`
(§2.2) — so after the move it is removed from the loop copy's imports and kept in the cli copy.

---

## 2. The exact partition

`01-architecture-layout.md` §3 gives the move table. This section gives the **full signature of every
moved symbol** so the new `packages/loop/src/recovery.ts` can be written from this document alone.

### 2.1 MOVE to `packages/loop/src/recovery.ts` (shared reconcile/resume core)

Re-exported from `packages/loop/src/index.ts` (§3.2). Types are the exact shapes from
`00-core-definitions.md` §4 — shown here only as the function-signature surface; do not re-author the
type bodies, copy them verbatim from the current file.

**Types moved** (bodies in `00-core-definitions.md` §4 / current `recovery.ts:42-77,367-370,425-430`):
`KeptBlock`, `InterruptedItem`, `ReconcileSummary`, `RecoverySummary` (`extends ReconcileSummary`),
`AcquiredRecoveryLock`.

**Private helper moved** (stays unexported inside the loop module — current `recovery.ts:87`):

```ts
async function findInterruptedItems(
  items: Backlog["items"],
  projectPath: string,
  baseCommitHash: string | null,
  treeClean: boolean,
): Promise<Result<InterruptedItem[]>>;
```

**Exported functions moved** (full signatures, verbatim from the current file):

```ts
// recovery.ts:114 — read-only interrupted-iteration detection
export async function detectInterruptedItems(
  paths: BacklogPaths,
): Promise<Result<InterruptedItem[]>>;

// recovery.ts:163 — atomic reconcile + false-block requeue
export async function reconcileAndRequeue(
  paths: BacklogPaths,
): Promise<Result<ReconcileSummary>>;

// recovery.ts:388 — acquire the loop lock for a recovery window (TOCTOU close — §4)
export function acquireRecoveryLock(
  paths: BacklogPaths,
): Result<AcquiredRecoveryLock>;

// recovery.ts:410 — owner-aware release (safe in a `finally` — §4)
export function releaseRecoveryLock(
  paths: BacklogPaths,
): Result<void>;

// recovery.ts:445 — full recovery sequence (ASYNC: callers must `await`)
export async function recoverInterruptedLoop(
  paths: BacklogPaths,
): Promise<Result<RecoverySummary>>;
```

`recoverInterruptedLoop`'s internal sequence (unchanged): `reconcileAndRequeue` → `resetStalledItems`
(`@rauf/core`) → `fs.unlinkSync(paths.state)` (ENOENT-tolerant — §6) → `clearDoneFile` →
`clearCancelFile` (both `@rauf/core`). It uses `findItemCommit` / `isTreeClean` / `gitCommit` only
transitively (via `reconcileAndRequeue` / `findInterruptedItems`), which are now intra-package (§3.1).

### 2.2 STAY in `packages/cli/src/recovery.ts` (subprocess `--recover` path — CLI-only per D3.1)

The heavier `--recover` sub-path spawns the project's verify command as a subprocess and then commits —
ratified as **CLI-only** for Phase 4 (web resume performs reconcile + relaunch, not reverify-and-commit;
tech-spec §3.1 "Scope"). These symbols do **not** move:

```ts
// recovery.ts:247 / :253 / :260 — verify runner (uses node:child_process spawn)
export interface VerifyOutcome { passed: boolean; output: string }
export type VerifyRunner = (projectPath: string, command: string) => Promise<VerifyOutcome>;
export const defaultVerifyRunner: VerifyRunner;

// recovery.ts:271 — per-item --recover result
export interface ItemRecoveryResult {
  id: string; title: string;
  verifyPassed: boolean; committed: boolean; commitHash: string | null; output: string;
}

// recovery.ts:296 — re-verify + commit interrupted work
export async function reverifyAndCommitInterrupted(
  paths: BacklogPaths,
  items: InterruptedItem[],
  verifyCommand: string,
  runVerify?: VerifyRunner,
): Promise<Result<ItemRecoveryResult[]>>;
```

`reverifyAndCommitInterrupted` references the **moved** type `InterruptedItem` and the loop primitive
`gitCommit` — after the move the cli copy imports both from `@rauf/loop` (§3.3). `defaultVerifyRunner`
keeps `import { spawn } from "node:child_process"`.

---

## 3. Import mechanics (the re-wiring)

Five edits, all mechanical. No logic changes anywhere.

### 3.1 New `packages/loop/src/recovery.ts` — flip the loop primitives to relative imports

The moved code's `import { findItemCommit, isTreeClean, gitCommit } from "@rauf/loop"` becomes
**intra-package relative imports** (a package must not import itself):

```ts
// packages/loop/src/recovery.ts  (NEW — moved body)
import * as fs from "node:fs";

import {
  readBacklog, writeBacklog, readJsonFile, acquireLock, checkLock, releaseLock,
  resetStalledItems, clearDoneFile, clearCancelFile, ok, err, ErrorCodes,
  LoopStateSchema, type Backlog, type BacklogPaths, type Result,
} from "@rauf/core";
import { findItemCommit, isTreeClean } from "./git-reconcile.js";
import { gitCommit } from "./git-commit.js";
```

- The `@rauf/core` import block is **unchanged** (loop already depends on core — `package.json:17`).
- `spawn` is **dropped** (it served only `defaultVerifyRunner`, which stays in cli).
- `gitCommit` is no longer referenced by any *moved* symbol (it was used only by
  `reverifyAndCommitInterrupted`, which stays). It MAY be omitted from the loop copy entirely. (It is
  shown above for completeness; if the moved body does not reference it, do not import it — strict TS
  would flag an unused import.) **Net:** the loop copy needs only `findItemCommit` and `isTreeClean`
  from `./git-reconcile.js`.

### 3.2 Re-export from `packages/loop/src/index.ts`

Add to the existing barrel (`packages/loop/src/index.ts`):

```ts
export {
  detectInterruptedItems,
  reconcileAndRequeue,
  acquireRecoveryLock,
  releaseRecoveryLock,
  recoverInterruptedLoop,
} from "./recovery.js";
export type {
  KeptBlock,
  InterruptedItem,
  ReconcileSummary,
  RecoverySummary,
  AcquiredRecoveryLock,
} from "./recovery.js";
```

`findInterruptedItems` is **not** re-exported (private helper).

### 3.3 Reduced `packages/cli/src/recovery.ts` — keep `--recover`, re-import the moved symbols

The cli file shrinks to the `--recover` symbols (§2.2) plus a **re-export** of the moved ones, so any
CLI code that reaches them via `./recovery` keeps compiling unchanged:

```ts
// packages/cli/src/recovery.ts  (REDUCED)
import { spawn } from "node:child_process";
import {
  readBacklog, writeBacklog, ok, type BacklogPaths, type Result,
} from "@rauf/core";
import {
  gitCommit,
  type InterruptedItem,
} from "@rauf/loop";

// --- re-export the relocated shared core so `./recovery` consumers keep working ---
export {
  detectInterruptedItems,
  reconcileAndRequeue,
  acquireRecoveryLock,
  releaseRecoveryLock,
  recoverInterruptedLoop,
} from "@rauf/loop";
export type {
  KeptBlock,
  InterruptedItem,
  ReconcileSummary,
  RecoverySummary,
  AcquiredRecoveryLock,
} from "@rauf/loop";

// --- CLI-only --recover path (unchanged bodies) ---
export interface VerifyOutcome { /* … */ }
export type VerifyRunner = /* … */;
export const defaultVerifyRunner: VerifyRunner = /* … */;
export interface ItemRecoveryResult { /* … */ }
export async function reverifyAndCommitInterrupted(/* … */) { /* … */ }
```

Notes:
- The cli copy now imports `gitCommit` and the type `InterruptedItem` from `@rauf/loop` (was
  intra-cli). `gitCommit` was already a `@rauf/loop` import in this file — only `InterruptedItem`'s
  source changes.
- Trim the `@rauf/core` import to only what `reverifyAndCommitInterrupted` actually uses
  (`readBacklog`, `writeBacklog`, `ok`, `BacklogPaths`, `Result`). Strict TS / `noUnusedLocals` (and
  ESLint) will flag any leftover unused import — confirm the final set against the retained body.

### 3.4 Caller import-source change — `resume-commands.ts` and `reset-commands.ts` (INVARIANT: no behavior change)

The two CLI callers keep importing from `./recovery.js` exactly as today, because §3.3 re-exports the
moved symbols. **Two acceptable wirings, both behavior-neutral:**

- **(A) No edit.** Leave `resume-commands.ts:41-49` and `reset-commands.ts:23-28` importing from
  `./recovery.js` — they resolve through the re-export. This is the lowest-risk option and satisfies
  D3.1's "no behavior change" verbatim.
- **(B) Repoint to `@rauf/loop`** (what `01` §5 describes): change the moved symbols' import source to
  `@rauf/loop`, keeping `reverifyAndCommitInterrupted` / `VerifyRunner` / `InterruptedItem` from
  `./recovery.js`. This makes the source-of-truth explicit.

Current caller import surfaces (for reference):

```ts
// resume-commands.ts:41-49 — MOVED: acquireRecoveryLock, releaseRecoveryLock,
//   recoverInterruptedLoop, detectInterruptedItems, type InterruptedItem
//   STAYS:  reverifyAndCommitInterrupted, type VerifyRunner
import {
  acquireRecoveryLock, releaseRecoveryLock, recoverInterruptedLoop,
  detectInterruptedItems, reverifyAndCommitInterrupted,
  type InterruptedItem, type VerifyRunner,
} from "./recovery.js";

// reset-commands.ts:23-28 — ALL MOVED
import {
  acquireRecoveryLock, releaseRecoveryLock, recoverInterruptedLoop,
  type RecoverySummary,
} from "./recovery.js";
```

> **INVARIANT (D3.1):** Whichever wiring is chosen, `resume-commands.ts` and `reset-commands.ts`
> change **only their import source(s)** — no statement inside `handleResume` / `handleReset` is
> touched. `rauf resume` and `rauf reset` produce byte-identical behavior before and after the move
> (acquire-and-hold lock window, the `finally` release, the relaunch handoff, all summary output, all
> exit codes). This is the load-bearing guarantee of the relocation and is verified in §8.

> **Recommendation:** option **(B)** — repoint to `@rauf/loop` — to make the dependency direction
> visible at the import site and avoid an indefinite re-export shim. Keep the §3.3 re-export regardless
> (cheap, and it protects any other `./recovery` consumer).

---

## 4. The acquire-and-hold lock model (D3.4) as it applies to recovery

This is the contract every recovery **caller** (CLI `resume`/`reset` and the web `resume`/`reset`
routes in `04`) must honor. The functions move unchanged; the contract is restated here because it is
what makes the shared core safe under concurrency (REQ-WEB-02 reuses it; REQ-WEB-09 in `04` depends on
it).

### 4.1 `acquireRecoveryLock` — close the check-then-mutate TOCTOU (quoting `recovery.ts:372-401`)

The doc-comment is the contract (verbatim from the current source, `recovery.ts:372-386`):

> Acquire the loop lock for a recovery/resume window, closing the check-then-mutate TOCTOU race: a
> concurrent `rauf loop run` cannot acquire the lock and start between a staleness check and the
> backlog mutation, because we hold the lock for the whole window.
> - A live lock held by another process → propagates `acquireLock`'s `LOCK_CONFLICT` error. The
>   caller MUST refuse and perform NO mutation, and MUST NOT release — the lock belongs to the live
>   loop.
> - A stale lock (dead/recycled PID) → cleared and re-acquired (`cleared: true`).
> - No lock → acquired (`cleared: false`).
> On success the caller owns the lock and MUST release it via `releaseRecoveryLock` (in a `finally`,
> and — for resume — before relaunching).

Implementation (unchanged — `recovery.ts:388-401`): `checkLock(paths)` is consulted **only** to report
whether a stale lock was cleared (`locked === true && stale === true`); `acquireLock(paths)`
(`@rauf/core`, `lock.ts:131`) is the authoritative atomic gate — it refuses a live lock and clears a
stale one, so even a lock that races in between the `checkLock` and the `acquireLock` is handled
correctly. Both `checkLock` (`lock.ts:243`) and `acquireLock` are existing `@rauf/core` exports; the
loop copy imports them from `@rauf/core` (§3.1). No PID logic is reimplemented.

### 4.2 `recoverInterruptedLoop` does NOT touch the lock (caller holds it)

Verbatim contract (`recovery.ts:442-443`):

> Does NOT touch the lock — acquire it via `acquireRecoveryLock` first and hold it across this call.

Therefore every caller MUST: `acquireRecoveryLock(paths)` → on `LOCK_CONFLICT` refuse with no mutation
and no release → otherwise `try { await recoverInterruptedLoop(paths); … } finally { releaseRecoveryLock(paths) }`.
This is exactly what the two CLI callers already do (`reset-commands.ts:56-81`,
`resume-commands.ts:268-424`) — and what the web `reset`/`resume` routes must replicate (`04`). The lock
is held across the **whole** reconcile, and (for resume) across the relaunch *decision* but released
**before** the relaunch hand-off so the loop's own lock acquisition succeeds (CLI:
`resume-commands.ts:420-441` releases in `finally`, then `runLoop`; web: release before
`loopManager.startLoop`).

### 4.3 `releaseRecoveryLock` — owner-aware, `finally`-safe (`recovery.ts:403-421`)

Verbatim contract (`recovery.ts:403-409`):

> Release a recovery lock acquired via `acquireRecoveryLock`. Owner-aware: it never deletes a lock
> owned by a live DIFFERENT pid (defends against the lock being replaced during the recovery window).
> A stale lock or a lock we own is removed. Safe to call in a `finally` block.

Implementation (unchanged — `recovery.ts:410-421`): `checkLock(paths)`; if
`lock.locked && lock.stale !== true && lock.pid !== process.pid` → **no-op** (`ok(undefined)`, a live
different-pid lock is not ours to remove); otherwise `releaseLock(paths)` (`@rauf/core`, `lock.ts:174`).
This is what makes calling it unconditionally in a `finally` safe even on the `LOCK_CONFLICT`
early-return path of a sibling process.

> **Note for `04`:** the web routes run in the **server process**, so `process.pid` is the server's
> pid — the same owner-aware semantics apply; the server only ever releases a lock it itself acquired
> or a stale one. The web `reset`/`resume` routes consume `acquireRecoveryLock` /
> `recoverInterruptedLoop` / `releaseRecoveryLock` from `@rauf/loop` directly (already a web dep);
> `unblock` uses the lighter `assertNoLiveLoop` (core `checkLock`) — both wired in `04`.

---

## 5. Dependency-direction safety (rule #1 preserved)

The move goes **down** the graph, never up:

- `recovery.ts` shared core moves `@rauf/cli → @rauf/loop`. `@rauf/loop` sits **below** both `@rauf/cli`
  and `@rauf/web` (`01` §2). The moved code's only cross-package dependency is `@rauf/core` (unchanged)
  plus two now-intra-package loop primitives — so `@rauf/loop` gains **no new package edge**.
- `@rauf/web` already imports `@rauf/loop` (via `loop-manager.ts`), so the web routes in `04` consume
  the relocated symbols with **no new edge** and, critically, **no `@rauf/cli` import** — rule #1
  (`core` has zero cli/web imports; web does not reach into cli) holds. Before this move the only way
  web could share `recoverInterruptedLoop` was to import `@rauf/cli` (forbidden) or fork the logic
  (violates REQ-WEB-08); the relocation is exactly what makes REQ-WEB-08 satisfiable.
- `@rauf/core` imports are **unchanged** — no new `core → cli/web` edge is introduced (rule #1).
- `@rauf/cli` still imports `@rauf/loop` (it already did, for `findItemCommit`/`isTreeClean`/
  `gitCommit`); the relocation reverses the *direction of one symbol's flow* (recovery now comes
  **from** loop) without adding an edge.

Result: dependency direction stays `core ← loop ← {cli, web}` (`01` §2). Verified by §8 (`@rauf/web`
contains no `from "@rauf/cli"`).

---

## 6. Error handling

All moved functions return `Result<T, RaufError>` (`00` §1) — they never throw. Propagation is
unchanged by the move; the contract callers rely on:

- **`acquireRecoveryLock`** → `err({ code: LOCK_CONFLICT, … })` when a live loop holds the lock
  (propagated from `acquireLock`). Callers MUST refuse with no mutation and no release. (Web maps this
  to `409` — `04` / `00` §8.1.)
- **`recoverInterruptedLoop`** → propagates the first failing inner `Result`:
  `reconcileAndRequeue` (git/IO errors from `findItemCommit`/`isTreeClean` or `writeBacklog`),
  `resetStalledItems`, `clearDoneFile`, `clearCancelFile`. On `ok`, resolves `RecoverySummary`.
- **state.json unlink** (`recovery.ts:457-468`): `fs.unlinkSync(paths.state)` is wrapped — a missing
  file (`ENOENT`) is tolerated (`stateCleared` stays `false`); **any other** errno surfaces as
  `err({ code: ErrorCodes.FILE_NOT_FOUND, message: "Failed to delete state.json: …", details: { path: paths.state } })`.
  This exact behavior moves verbatim — do not alter the errno handling or the error code. (`ErrorCodes`
  is a `@rauf/core` export, already imported by the moved code.)
- **`reconcileAndRequeue` / `detectInterruptedItems`** → propagate `readBacklog` / `readJsonFile`
  parse errors and the git-primitive `Result` errors verbatim.
- **`releaseRecoveryLock`** → returns `ok(undefined)` for a live different-pid lock (no-op) or the
  result of `releaseLock`; safe in a `finally`.

No new error codes are introduced by the relocation. Web's `Result → HTTP` mapping for these is owned
by `00` §8.1 and `04`.

---

## 7. Example — the canonical caller shape (shared by CLI and web)

Both the existing CLI callers and the new web routes (`04`) follow this acquire-and-hold skeleton. The
CLI form is the reference (`resume-commands.ts:268-441`, `reset-commands.ts:56-81`); the web form
(`04`) is structurally identical, differing only in the relaunch mechanism (`loopManager.startLoop`
vs. `handleLoopRun`) and the `Result → HTTP` mapping instead of `ExitCode`.

```ts
import {
  acquireRecoveryLock, releaseRecoveryLock, recoverInterruptedLoop,
} from "@rauf/loop";
import { ErrorCodes } from "@rauf/core";

const acquired = acquireRecoveryLock(paths);
if (!acquired.ok) {
  // LOCK_CONFLICT → live loop holds the lock. Refuse; do NOT mutate; do NOT release.
  return /* CLI: USAGE exit | web: 409 LOCK_CONFLICT */;
}

let relaunch = false;
try {
  const recovered = await recoverInterruptedLoop(paths); // does NOT touch the lock
  if (!recovered.ok) {
    /* surface recovered.error (CLI: error+ERROR exit | web: Result→HTTP) */
  } else {
    // decide eligibility (selectNextItem) → set `relaunch`
  }
} finally {
  releaseRecoveryLock(paths); // owner-aware; safe even on the early-return path
}

if (relaunch) {
  /* CLI: handleLoopRun(runCtx) | web: loopManager.startLoop(projectPath, opts) */
}
```

---

## 8. Verification

The relocation is correct iff it is **invisible to behavior** and **invisible to the dependency
graph**. Verify all of:

1. **Typecheck green.** `pnpm typecheck` passes across all packages after the move (the moved symbols
   resolve from `@rauf/loop`; the cli re-export resolves; no unused imports remain in the reduced cli
   file — strict TS / `noUnusedLocals`).
2. **No new edge / rule #1 intact.** `grep -rn 'from "@rauf/cli"' packages/web/src` returns nothing;
   `grep -rn 'from "@rauf/loop"' packages/loop/src` returns nothing for `recovery.ts`'s own primitives
   (they are relative `./git-reconcile.js` / `./git-commit.js`). The barrel
   `packages/loop/src/index.ts` re-exports the five functions + five types (§3.2).
3. **Symbols resolve where expected.** `recoverInterruptedLoop`, `reconcileAndRequeue`,
   `detectInterruptedItems`, `acquireRecoveryLock`, `releaseRecoveryLock` and the five types import
   cleanly from `@rauf/loop` in both `@rauf/cli` and `@rauf/web`; `reverifyAndCommitInterrupted` /
   `defaultVerifyRunner` / `VerifyOutcome` / `VerifyRunner` / `ItemRecoveryResult` import from
   `@rauf/cli`'s `./recovery.js` only.
4. **Behavior unchanged for `rauf resume` / `rauf reset` (pure refactor).** The relocated unit tests
   (moved to `packages/loop` per `06-testing-strategy.md`) pass unchanged against the new home, proving
   `recoverInterruptedLoop` / `reconcileAndRequeue` / `acquireRecoveryLock` / `releaseRecoveryLock` /
   `detectInterruptedItems` behavior is byte-for-byte preserved. The existing `resume`/`reset` command
   tests in `@rauf/cli` (which exercise `handleResume`/`handleReset`) pass with **no edits to the
   command logic** — only their import source may change (§3.4). The acquire-and-hold lock window, the
   `finally` release, the relaunch handoff, the summary output, and the exit codes are all unchanged.
5. **CLI import-smoke.** `@rauf/cli` retains a small assertion that the moved symbols are importable
   via `@rauf/loop` (and, if the §3.3 shim is kept, via `./recovery.js`) — guards against a future
   accidental drop of the re-export. (Detail in `06-testing-strategy.md`.)
6. **Full gate.** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` is green
   (PRD §8 success criterion; the gate is the merge bar for this phase).

---

## Cross-References

- `00-core-definitions.md` — §1 (`Result`, `BacklogPaths`, `LockStatus`, `ErrorCodes`, `checkLock`),
  §4 (the relocated recovery type bodies — use verbatim, do not redefine).
- `01-architecture-layout.md` — §2 (dependency graph), §3 (the move table this doc elaborates),
  §5 (cli changes), §6.3 (`assertNoLiveLoop` helper for the lightweight `unblock` guard).
- `04-web-recovery-routes.md` — consumes `acquireRecoveryLock` / `recoverInterruptedLoop` /
  `releaseRecoveryLock` from `@rauf/loop` for the `POST /:id/resume` and `POST /:id/reset` routes
  (the web side of D3.4) and `ResumeResult` (`00` §6).
- `06-testing-strategy.md` — the unit-test move to `packages/loop` + the CLI import-smoke test (§8.4,
  §8.5).
