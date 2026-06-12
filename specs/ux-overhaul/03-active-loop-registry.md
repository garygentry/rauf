# 03 — Active-Loop Registry

The **active-loop registry** is a machine-wide index of currently-running loops, stored as one file
per loop under `~/.rauf/active/`, that answers "is a loop live, and where" in ~O(1) regardless of the
caller's working directory or tree depth. It is the data source behind cross-root discovery
(`status` empty-is-never-silent, `status --all`, the web projects view). Liveness is **never trusted
blindly**: every read **reconciles** each entry against the per-root `.loop.lock` (the ground truth)
plus OS process liveness, **self-heals** stale entries, and excludes anything whose owner is dead.

This document owns the registry **API** (`packages/core/src/loop-registry.ts`, NEW), the
`checkLockFile` **extraction** in `packages/core/src/lock.ts` (EDIT) that makes lock-based
reconciliation reusable against any state dir, and the **runner wiring** in
`packages/loop/src/runner.ts` (EDIT) that registers a loop at start and deregisters it at exit.

> Source of truth: [`PRD.md`](./PRD.md) §3.4 (REQ-DISC-*), §4.3 (REQ-SEC-01), §4.5 (REQ-OBSV-01);
> [`tech-spec.md`](./tech-spec.md) §3.5 (D5 + `checkLockFile` extraction), §3.10
> (`state.json ⇄ registry` advisory relationship + `updateLoopStatus`), §6.1 (runner wiring), §7
> (self-heal / corrupt-entry-skipped). Shared types
> (`ActiveLoopEntry`/`ActiveLoopEntrySchema`, `ACTIVE_DIR`, `LoopStateStatus`, `IO_ERROR`, the reused
> `LockStatus`/`LockFileContent`) are defined in [`00-core-definitions.md`](./00-core-definitions.md)
> and are **referenced, not redefined**, here. Where this spec and [`CANON.md`](./CANON.md) disagree,
> the canon wins.

---

## Requirement Coverage

| REQ ID       | Requirement                                                                        | Section                       |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------- |
| REQ-DISC-03  | Central registry keyed by resolved state dir, queryable in ~O(1) regardless of cwd | 2, 3.1 (`key`/`registryEntryPath`), 3.2 |
| REQ-DISC-04  | Concurrency-safe (multiple register/deregister + readers, no corruption)           | 2.1 (structural safety), 8    |
| REQ-DISC-05  | Self-heal stale entries; reconcile liveness vs lock/process before surfacing        | 3.5 (`listActiveLoops` algorithm), 4 (extraction), 7 |
| REQ-DISC-06  | Data source for "list every backlog root with a live loop machine-wide"            | 3.5 (`listActiveLoops`); surface owned by `04` |
| REQ-SEC-01   | Registry writes only under `~/.rauf`, `validatePath`-guarded                       | 3.3, 6 (PATH_VIOLATION)       |
| REQ-OBS-02   | Registry `status` advisory; `state.json` authoritative                              | 3.4 (`updateLoopStatus`), 5.2 |
| REQ-OBSV-01  | Reconciliation outcomes discoverable (pruned-stale not hidden)                     | 3.5 (return-with-reason note), 7 |
| REQ-DISC-01/02 (write side) | The registry data the CLI/web read to surface cross-root liveness   | 3.1–3.5 (the API `04`/`05` consume) |

> **Boundary.** The **registry API** is owned here. The **CLI surfacing** of that data
> (`status --all`, empty-is-never-silent) is owned by `04-cli-monitoring-surface.md`; the **web
> surfacing** (`/api/loops`, projects-view badges) is owned by `05-web-observation-parity.md`. Both
> consume `listActiveLoops()` defined below. REQ-DISC-06's *command* (`status --all`) is `04`'s; its
> *data source* (`listActiveLoops`, machine-wide) is here.

---

## 1. Module Map

| File | Change | What this doc covers |
| --- | --- | --- |
| `packages/core/src/loop-registry.ts` | **NEW** | `registerLoop`, `deregisterLoop`, `updateLoopStatus`, `listActiveLoops`, `registryEntryPath`; module-private `ACTIVE_DIR` + `key(stateDir)` (§3) |
| `packages/core/src/lock.ts` | **EDIT** (refactor) | extract `checkLockFile(lockPath): Result<LockStatus>`; `checkLock(paths)` delegates (§4) |
| `packages/loop/src/runner.ts` | **EDIT** (wire-up) | `registerLoop` at `start()`; `deregisterLoop` in the run's `finally`; `updateLoopStatus` paired with each `writeState` (§5) |

All public registry functions are re-exported from `packages/core/src/index.ts` via
`export * from "./loop-registry.js";` (see `01-architecture-layout.md` §3). `checkLockFile` surfaces
automatically because `lock.ts` is already re-exported.

Per architecture rule #1, **all filesystem + reconciliation logic lives in `packages/core`**;
`packages/loop` only *wires it up*. Per architecture rule #6, **reconciliation is pure file reads** —
no subprocess (process liveness uses `process.kill(pid, 0)` and `/proc/<pid>/stat`, not a spawned
command; see §4).

---

## 2. Storage Model & Why One File Per Loop (REQ-DISC-03/04) — D5

Storage is **one JSON file per running loop** under `~/.rauf/active/`, named by a 16-hex-char hash of
the loop's resolved state directory:

```
~/.rauf/active/
  a3f9c1e0d4b5f6a7.json   ← one entry per live loop, keyed by hash(resolve(stateDir))
  91bd02ce7740a18f.json
```

Each file holds one `ActiveLoopEntry` (defined in `00-core-definitions.md` §1.2 — **not** redefined
here; six fields: `stateDir`, `projectPath`, `backlogRoot`, `pid`, `startedAt`, `status`).

### 2.1 Why per-loop files give structural concurrency-safety (REQ-DISC-04)

The chosen shape (D5, resolving PRD OQ-1) is **per-loop entry files**, deliberately *not* a single
shared index file. The reasoning:

- **A shared index would require write-write coordination.** With one
  `~/.rauf/active/index.json` that every loop mutates, two loops registering/deregistering at the same
  instant would race on read-modify-write. Avoiding corruption would then need a *second* lock layer
  (a registry-wide lock) on top of the per-root `.loop.lock` — extra machinery and a new contention
  point.
- **Per-loop files make concurrency-safety structural, not lock-mediated.** Each loop writes, updates,
  and deletes **only its own** `<hash>.json` (a deterministic path from *its* state dir — §3.1). No
  two loops ever target the same file, so concurrent registration/deregistration **cannot** contend.
  There is nothing to lock because there is no shared mutable surface.
- **Readers never block writers and vice-versa.** `listActiveLoops` enumerates the directory and reads
  each file independently. A reader that observes a half-written or just-deleted entry simply skips it
  (corrupt → skipped; missing → not in the glob) — see §6. Each individual entry is written via
  `atomicWrite` (write `.tmp` → rename), so a reader can never observe a torn entry *file* (only its
  presence or absence), only ever a complete one or none.

This mirrors the canon note that the registry is an **intentionally multi-writer but contention-free**
surface (`01-architecture-layout.md` §4, REQ-EVT-06 Notes): the per-root single-writer invariant that
governs `events.ndjson` does **not** apply to the registry; the registry's safety comes from
file-per-loop partitioning instead.

> Trade-off (accepted): `listActiveLoops` does a directory enumeration + one `readFileSync` per entry,
> i.e. O(number of live loops), not O(1) in the strictest sense. But it is **independent of the
> caller's cwd and of project-tree depth** (REQ-DISC-03's actual ask), and the number of *concurrently
> live* loops on one machine is tiny (single digits). This is the "roughly O(1) independent of working
> directory or tree depth" the PRD specifies, and is categorically cheaper than the superseded
> per-read directory walk (`scanActiveRoots`, §5.3).

---

## 3. `loop-registry.ts` — Public API

Full module preamble (module-private `ACTIVE_DIR` and `key`; the hashing rationale follows in §3.1):

```typescript
// packages/core/src/loop-registry.ts
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { TOOL_CONFIG_DIR } from "./config.js"; // = ~/.rauf  (config.ts:13, exported config.ts:177)
import { type Result, ok, err, ErrorCodes } from "./errors.js";
import {
  atomicWrite,
  ensureDir,
  fileExists,
  readJsonFile,
  validatePath,
} from "./fs-utils.js";
import { checkLockFile } from "./lock.js"; // extracted in §4
import {
  ActiveLoopEntry,
  ActiveLoopEntrySchema,
  type LoopStateStatus,
} from "./schemas.js";

/**
 * Active-loop registry directory: ~/.rauf/active/. Inside the established sandbox
 * (REQ-SEC-01). Defined in 00-core-definitions.md §2.3 — reused, not redefined.
 */
const ACTIVE_DIR = path.join(TOOL_CONFIG_DIR, "active");

/** The .loop.lock filename within a state dir (matches LOCK_FILENAME / backlog-root.ts paths.lock). */
const LOCK_FILENAME = ".loop.lock";
```

> The exact `LoopStateStatus` import path (`./schemas.js`) and `ActiveLoopEntry`/`ActiveLoopEntrySchema`
> are confirmed in `00-core-definitions.md` §1.2/§4. `LoopStateStatusSchema` lives at `schemas.ts:167`.

### 3.1 `key` / `registryEntryPath` — the hashing (TQ-2)

The registry key is a **SHA-256 hash of the resolved state directory**, truncated to its first **16
hex characters** (tech-spec TQ-2). The state dir is the natural key because it is already the unique,
absolute, per-root identity that the lock and all state files share (`backlog-root.ts` derives every
state-file path from it).

```typescript
/**
 * Registry key: first 16 hex chars of sha256(resolved state dir). The state dir is
 * resolved with path.resolve() FIRST so the same root always hashes to the same key
 * regardless of how the caller spelled the path (REQ-DISC-03 — cwd-independent). 16
 * hex chars (64 bits) is collision-negligible at the expected scale of a single
 * machine's concurrently-live loops (TQ-2); widen to the full digest only if ever a
 * concern.
 */
const key = (stateDir: string): string =>
  createHash("sha256").update(path.resolve(stateDir)).digest("hex").slice(0, 16);

/**
 * Absolute path to a loop's registry entry file: ~/.rauf/active/<key>.json.
 * Exported so callers (tests, the runner's deregister-by-state-dir path) can locate
 * a specific entry deterministically. Pure function — no IO.
 */
export const registryEntryPath = (stateDir: string): string =>
  path.join(ACTIVE_DIR, `${key(stateDir)}.json`);
```

Because the key is a pure function of `resolve(stateDir)`, every operation
(`register`/`update`/`deregister`/`reconcile`) addresses the *same* file for the *same* root from any
working directory — this is what makes the registry cwd-independent and ~O(1) to address
(REQ-DISC-03).

### 3.2 `registerLoop` (write side of REQ-DISC-01/02, REQ-DISC-03, REQ-SEC-01)

```typescript
/**
 * Register a running loop. Called once at loop start (after the lock is acquired).
 * Writes the loop's own entry file ~/.rauf/active/<hash>.json (single file owned by
 * this loop → structurally concurrency-safe, §2.1). The write is atomic (.tmp →
 * rename) so a concurrent reader never observes a torn entry.
 *
 * Sandbox: the target path is validated against ACTIVE_DIR before any write
 * (REQ-SEC-01) — it can only ever live under ~/.rauf/active/.
 *
 * @returns ok(undefined) on success; err(IO_ERROR) on write failure;
 *          err(PATH_VIOLATION) if the entry path escapes ~/.rauf/active (defense-in-depth).
 */
export function registerLoop(entry: ActiveLoopEntry): Result<void> {
  const ensured = ensureDir(ACTIVE_DIR);
  if (!ensured.ok) return ensured; // ACTIVE_DIR created on demand (first registration)

  const entryPath = registryEntryPath(entry.stateDir);

  // REQ-SEC-01: never write outside the sandbox.
  const guard = validatePath(entryPath, [ACTIVE_DIR]);
  if (!guard.ok) return guard; // PATH_VIOLATION

  const write = atomicWrite(entryPath, JSON.stringify(entry, null, 2) + "\n");
  if (!write.ok) {
    // atomicWrite returns FILE_NOT_FOUND on fs failure; normalize to IO_ERROR for the registry surface.
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `registerLoop failed: ${write.error.message}`,
      details: { path: entryPath },
    });
  }
  return ok(undefined);
}
```

> **Note on `atomicWrite`'s error code.** `atomicWrite` (`fs-utils.ts:13`) currently returns
> `FILE_NOT_FOUND` on any write failure. The registry surface normalizes that to `IO_ERROR`
> (the dedicated fs-failure code added in `00-core-definitions.md` §3.1) so registry callers get a
> semantically correct code. (`ensureDir` similarly returns `FILE_NOT_FOUND` today; its failure is
> returned as-is — a missing-home-dir failure is rare and non-fatal to the loop, which calls
> `registerLoop` best-effort per §5.1.)

### 3.3 `deregisterLoop` (REQ-DISC-05 cleanup half, REQ-SEC-01) — idempotent

```typescript
/**
 * Deregister a loop at exit (success, error, OR cancel — called from the run's
 * finally, §5.2). IDEMPOTENT: unlink-if-exists. A missing file (already removed, or
 * self-healed by a concurrent listActiveLoops) is NOT an error — this mirrors
 * releaseLock's idempotent finally-safety (lock.ts:174).
 *
 * Sandbox-guarded (REQ-SEC-01) so a malformed stateDir can never unlink outside
 * ~/.rauf/active.
 *
 * @returns ok(undefined) always, unless an unexpected (non-ENOENT) fs error occurs.
 */
export function deregisterLoop(stateDir: string): Result<void> {
  const entryPath = registryEntryPath(stateDir);

  const guard = validatePath(entryPath, [ACTIVE_DIR]);
  if (!guard.ok) return guard; // PATH_VIOLATION

  try {
    fs.unlinkSync(entryPath);
  } catch (e) {
    const code = e instanceof Error && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      return err({
        code: ErrorCodes.IO_ERROR,
        message: `deregisterLoop failed: ${e instanceof Error ? e.message : String(e)}`,
        details: { path: entryPath },
      });
    }
    // ENOENT — already gone. Idempotent: not an error.
  }
  return ok(undefined);
}
```

### 3.4 `updateLoopStatus` (REQ-OBS-02) — advisory refresh

```typescript
/**
 * Advisory last-known status refresh for THIS loop's entry. Paired with each
 * state.json transition in the runner (§5.3). REQ-OBS-02: state.json remains the
 * SINGLE authoritative status; this entry.status is a convenience for the cross-root
 * listing and MUST NOT be trusted over state.json (consumers re-derive from
 * state.json when they need authoritative status — see 04/05).
 *
 * Reads the loop's own entry, rewrites it with the new status. If the entry is
 * missing (e.g. deregistered or never registered) it is a no-op success — status is
 * advisory, so a failed advisory update must never disturb the loop.
 *
 * @returns ok(undefined). Missing/corrupt entry → ok(undefined) (best-effort, advisory).
 */
export function updateLoopStatus(stateDir: string, status: LoopStateStatus): Result<void> {
  const entryPath = registryEntryPath(stateDir);

  const guard = validatePath(entryPath, [ACTIVE_DIR]);
  if (!guard.ok) return guard; // PATH_VIOLATION

  if (!fileExists(entryPath)) return ok(undefined); // advisory: nothing to refresh

  const read = readJsonFile(entryPath, ActiveLoopEntrySchema);
  if (!read.ok) return ok(undefined); // corrupt entry → skip (advisory; do not surface)

  const next: ActiveLoopEntry = { ...read.value, status };
  const write = atomicWrite(entryPath, JSON.stringify(next, null, 2) + "\n");
  if (!write.ok) return ok(undefined); // advisory write failure is non-fatal
  return ok(undefined);
}
```

> **Why advisory-failures are swallowed.** REQ-OBS-02 makes `state.json` authoritative; the registry's
> `status` is a redundant convenience. Coupling loop health to a best-effort registry write would
> violate REQ-PERF-01's spirit (observation must not impede the loop) — so a failed/skipped
> `updateLoopStatus` returns `ok` and the loop proceeds. The advisory value is "good enough" for the
> cross-root *summary*; any consumer needing the true current state reads that root's `state.json`.

### 3.5 `listActiveLoops` — the reconciliation algorithm (REQ-DISC-05/06, REQ-OBSV-01)

This is the read side every consumer (`04` `status --all` / empty-is-never-silent; `05` `/api/loops`)
calls. It **reconciles each entry against ground truth before returning it** and **self-heals** stale
entries inline.

```typescript
/**
 * List every live loop, machine-wide (D6 — the registry lives in ~/.rauf, naturally
 * global; no scoping flag in Phase 1). For each entry, RECONCILE against ground truth
 * (REQ-DISC-05) before including it:
 *
 *   1. glob ~/.rauf/active/*.json
 *   2. parse each entry (ActiveLoopEntrySchema). Corrupt/unparseable → SKIP (not fatal, §6).
 *   3. reconcile: read {entry.stateDir}/.loop.lock via checkLockFile (§4) + process
 *      liveness. The .loop.lock is the GROUND TRUTH (C-3); the registry is a fast index
 *      over it.
 *   4. if the owning loop is NOT live (no lock, stale lock, or dead/recycled pid):
 *      UNLINK the stale entry (self-heal) and EXCLUDE it from the result.
 *   5. else include the (reconciled) entry.
 *
 * Pure file reads only — no subprocess (architecture rule #6). Liveness uses
 * checkLockFile's process.kill(pid,0) + /proc start-time guard, never a spawned command.
 *
 * @returns ok(ActiveLoopEntry[]) — only loops confirmed live. Missing ACTIVE_DIR → ok([])
 *          (REQ-REL-03-style graceful absence: nothing registered yet).
 */
export function listActiveLoops(): Result<ActiveLoopEntry[]> {
  if (!fileExists(ACTIVE_DIR)) return ok([]); // no loop has ever registered

  let files: string[];
  try {
    files = fs.readdirSync(ACTIVE_DIR).filter((f) => f.endsWith(".json"));
  } catch (e) {
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `listActiveLoops: cannot read ${ACTIVE_DIR}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const live: ActiveLoopEntry[] = [];
  for (const file of files) {
    const entryPath = path.join(ACTIVE_DIR, file);

    // (2) parse — corrupt/half-written/foreign file → skip, never fatal (§6).
    const read = readJsonFile(entryPath, ActiveLoopEntrySchema);
    if (!read.ok) continue;
    const entry = read.value;

    // (3) reconcile against the per-root lock (ground truth, C-3) + process liveness.
    const lockPath = path.join(path.resolve(entry.stateDir), LOCK_FILENAME);
    const lockStatus = checkLockFile(lockPath); // §4 — Result<LockStatus>

    const live_ =
      lockStatus.ok &&
      lockStatus.value.locked &&
      lockStatus.value.stale !== true &&
      // defense-in-depth: the lock's pid should match the entry's recorded runner pid.
      (lockStatus.value.pid === undefined || lockStatus.value.pid === entry.pid);

    if (!live_) {
      // (4) self-heal: prune the stale entry and exclude it (REQ-DISC-05).
      try {
        fs.unlinkSync(entryPath);
      } catch {
        // best-effort prune — another reader may have removed it; ignore.
      }
      continue;
    }

    // (5) live — include the reconciled entry.
    live.push(entry);
  }

  // Deterministic order for stable CLI/web output.
  live.sort((a, b) => a.stateDir.localeCompare(b.stateDir));
  return ok(live);
}
```

**Reconciliation outcomes are discoverable (REQ-OBSV-01).** A pruned stale entry is *excluded* from
the returned list (so a dead loop is never reported "live" — SC-3), and the act of pruning is the
observable outcome: the next read no longer shows it. The surface that *renders* this to the user
(e.g. `status --all` noting "1 stale entry reconciled") is owned by `04`; this function gives `04` the
truthful, already-reconciled list it needs. The reconciliation is **not hidden** — it happens on every
read and its effect (a vanished dead loop) is immediately visible to every observer. If a future phase
wants an explicit per-prune signal, the natural extension is to return a `{ live, pruned }` pair;
Phase 1 keeps the simpler `ActiveLoopEntry[]` and treats "absent from the list" as the discoverable
outcome (REQ-OBSV-01 is P2).

> **Why match `pid` defensively.** `checkLockFile` already detects PID recycling via the
> `/proc/<pid>/stat` start-time guard (`isProcessRecycled`, `lock.ts:94`). The extra
> `lockStatus.value.pid === entry.pid` check guards the narrow window where a lock file was rewritten
> by a *different* loop on the same state dir after the entry was written but before the entry was
> refreshed — extremely unlikely given the per-root lock serializes loops, but cheap insurance that
> the registry entry and the live lock describe the *same* process.

---

## 4. `lock.ts` Refactor — `checkLockFile` Extraction (REQ-DISC-05)

Reconciliation must run the **same** liveness logic the lock already implements
(`process.kill(pid, 0)` + the Linux `/proc/<pid>/stat` start-time guard against PID recycling) rather
than re-implementing PID checks. The existing `checkLock(paths)` (`lock.ts:198`) couples that logic to
a full `BacklogPaths`; the registry needs to check **any** state dir's lock by raw path. We therefore
**parameterize the body of `checkLock` on a raw `lockPath`** as `checkLockFile`, and make `checkLock`
a thin delegate.

The extracted return type is **`LockStatus`** (the existing `checkLock` return shape, `lock.ts:39`) —
**NOT** `LockSummary` (the unrelated status-*display* type at `schemas.ts:258`, produced by
`computeLockSummary`). This is stated explicitly because the two are easy to confuse; the registry
wants the raw liveness verdict (`locked`/`pid`/`startedAt`/`stale`), not the display summary.

The private helpers `isProcessAlive` (`lock.ts:56`), `getProcessStartTime` (`lock.ts:69`), and
`isProcessRecycled` (`lock.ts:94`) are **unchanged** and continue to back the extracted function.
`acquireLock` (`lock.ts:131`) and `releaseLock` (`lock.ts:174`) are **unchanged** — `acquireLock`
keeps calling `checkLock(paths)`, which now transparently delegates.

### Before (current `checkLock`, `lock.ts:198–233`)

```typescript
export function checkLock(paths: BacklogPaths): Result<LockStatus> {
  if (!fileExists(paths.lock)) {
    return ok({ locked: false });
  }

  let raw: string;
  try {
    raw = fs.readFileSync(paths.lock, "utf-8");
  } catch {
    return ok({ locked: true, stale: true });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ok({ locked: true, stale: true });
  }

  const result = LockFileContentSchema.safeParse(parsed);
  if (!result.success) {
    return ok({ locked: true, stale: true });
  }

  const content = result.data;

  if (!isProcessAlive(content.pid)) {
    return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true });
  }

  if (isProcessRecycled(content.pid, content.processStartTime)) {
    return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true });
  }

  return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: false });
}
```

### After (extracted `checkLockFile` + thin `checkLock` delegate)

The body is moved verbatim, with the **only change** being `paths.lock` → the `lockPath` parameter.
`checkLock` becomes a one-line delegate, preserving its existing signature and behavior (so all
existing `checkLock` callers and tests are unaffected — verification in §8).

```typescript
/**
 * Check the lock state for a RAW lock-file path (state-dir-agnostic). Reads the lock
 * file, checks PID liveness, and detects PID recycling — identical logic to checkLock,
 * but addressable against any state dir's .loop.lock so the active-loop registry can
 * reconcile entries against ground truth (REQ-DISC-05).
 *
 * Return type is LockStatus (lock.ts:39) — NOT LockSummary (the status-display type at
 * schemas.ts:258). Pure file reads + process.kill(pid,0)/proc — no subprocess (rule #6).
 *
 * @param lockPath - absolute path to a .loop.lock file
 */
export function checkLockFile(lockPath: string): Result<LockStatus> {
  if (!fileExists(lockPath)) {
    return ok({ locked: false });
  }

  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf-8");
  } catch {
    return ok({ locked: true, stale: true });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ok({ locked: true, stale: true });
  }

  const result = LockFileContentSchema.safeParse(parsed);
  if (!result.success) {
    return ok({ locked: true, stale: true });
  }

  const content = result.data;

  if (!isProcessAlive(content.pid)) {
    return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true });
  }

  if (isProcessRecycled(content.pid, content.processStartTime)) {
    return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: true });
  }

  return ok({ locked: true, pid: content.pid, startedAt: content.startedAt, stale: false });
}

/**
 * Check the current lock state for a backlog root. Delegates to checkLockFile on
 * paths.lock — behavior and return type unchanged (LockStatus). Existing callers
 * (acquireLock, status display, tests) are unaffected.
 */
export function checkLock(paths: BacklogPaths): Result<LockStatus> {
  return checkLockFile(paths.lock);
}
```

**Reconciliation maps lock state → liveness** in `listActiveLoops` (§3.5): an entry is live iff
`checkLockFile` returns `locked === true && stale !== true`. Every "not live" verdict —
no lock file (`locked:false`), unreadable/corrupt lock (`locked:true, stale:true`), dead pid, or
recycled pid — drives the self-heal unlink. The `.loop.lock` is the **ground truth** the registry
indexes (C-3); the registry never contradicts it.

`checkLockFile` is re-exported from `core/src/index.ts` automatically (lock.ts is already barrelled).

---

## 5. Runner Wiring (`packages/loop/src/runner.ts`) — REQ-DISC-03/05, REQ-OBS-02

The runner is the **only** writer to the registry for its own root. Wiring is three touch-points, all
best-effort (registry failures must never disturb the loop — REQ-PERF-01/OBS-02). The runner already
holds `this.paths` (a `BacklogPaths`, `runner.ts:76`) and `this.projectPath` (`runner.ts:75`); the
relevant fields are `this.paths.stateDir`, `this.paths.root` (= the `--backlog` root), and
`this.startedAt` (`runner.ts:140`).

### 5.1 Register at `start()` (REQ-DISC-03)

Register **after the lock is acquired** (so the `.loop.lock` ground truth already exists when the entry
is written) and after `this.startedAt` is set. The natural site is immediately after the successful
`acquireLock` at `runner.ts:153–157` (and after `rotateEventsLog` from `02-event-log.md`, which also
fires at `start()`):

```typescript
// runner.ts start(), just after acquireLock succeeds (~line 158):
registerLoop({
  stateDir: this.paths.stateDir,
  projectPath: this.projectPath,
  backlogRoot: this.paths.root,       // the --backlog root (paths.root = resolved backlogRoot)
  pid: process.pid,                    // SAME pid acquireLock recorded in .loop.lock → reconciliation matches
  startedAt: this.startedAt,           // ISO string set at start() (runner.ts:140)
  status: "starting",                  // advisory initial; refreshed by updateLoopStatus on each transition
});
// best-effort: ignore the Result — a registry write failure must not abort the loop (REQ-OBS-02).
```

The `pid` written here is `process.pid`, the **same** pid `acquireLock` recorded in `.loop.lock`
(`lock.ts:157`), so the §3.5 `pid`-match reconciliation aligns the entry with its lock by construction.

### 5.2 Deregister in the run's `finally` (REQ-DISC-05) — idempotent

Deregister in the **same `finally`** that already calls `releaseLock(this.paths)` (`runner.ts:324–339`),
right alongside it, so the entry is cleared on **every** exit path — success, error/throw, or cancel:

```typescript
// runner.ts start() finally block (~line 338, beside releaseLock):
} finally {
  // ... existing crash cleanup + releaseLock(this.paths) ...
  deregisterLoop(this.paths.stateDir); // idempotent; best-effort. Pairs with releaseLock.
}
```

Because `deregisterLoop` is idempotent (unlink-if-exists, §3.3) and runs in `finally`, a crash that
*skips* the finally (hard `SIGKILL`) leaves a stale entry — which is exactly what `listActiveLoops`
self-heals on the next read (§3.5): the dead pid fails `checkLockFile` liveness and the entry is
pruned. The finally-deregister is the *clean* path; the read-time self-heal is the *crash* safety net.
Together they satisfy SC-3 (a killed loop reports not-live on the next read).

### 5.3 `updateLoopStatus` paired with each `writeState` transition (REQ-OBS-02)

`state.json` is written through the private `writeState` wrapper (`runner.ts:1150–1168`), which is the
single choke point for every status transition. Pair the advisory registry refresh **inside** that
wrapper so every `state.json` transition also refreshes the entry's advisory status — keeping the
registry's `status` field roughly in step without ever becoming authoritative:

```typescript
// runner.ts writeState() (~line 1156), after the writeLoopState(...) call:
private writeState(
  status: LoopState["status"],
  currentItem: string | null,
  lastSignal?: LoopState["lastSignal"],
  error?: string,
): void {
  writeLoopState(this.paths, { /* ...unchanged... */ });
  // Advisory registry refresh (REQ-OBS-02). state.json (just written) stays authoritative;
  // this keeps the cross-root summary's status roughly current. Best-effort — ignore Result.
  updateLoopStatus(this.paths.stateDir, status);
}
```

`LoopState["status"]` is assignable to `LoopStateStatus` (both derive from `LoopStateStatusSchema`,
`schemas.ts:167`), so the call typechecks directly. If `writeState` runs before `registerLoop` (it
does not in `start()`, but defensively), `updateLoopStatus` is a no-op success because the entry does
not yet exist (§3.4) — no ordering hazard.

The pairing realizes the **`state.json ⇄ registry` advisory relationship** (tech-spec §3.10): every
authoritative transition has a corresponding advisory refresh, and the registry never *leads*
`state.json` — it follows it. Status recovery never reads the registry; consumers needing authoritative
status read `state.json` (REQ-OBS-02).

> **Self-hosting build reminder (C-5 / memory).** The dev loop executes built `dist/@rauf/loop`, not
> `src`. After editing `runner.ts`, run `pnpm --filter @rauf/loop build` before a dev-loop run reflects
> the wiring (`tech-spec.md` §6.5). Implementing loops run with the frozen `rauf-stable` binary.

---

## 6. Error Handling (every operation)

Follows the core convention: `Result<T, RaufError>` for expected errors, never throw (`errors.ts:9`).

| Operation | Failure mode | Behavior | Code |
| --- | --- | --- | --- |
| `registerLoop` | path escapes `~/.rauf/active` | `validatePath` rejects before write | `PATH_VIOLATION` |
| `registerLoop` | `atomicWrite`/`ensureDir` fs failure | return error (runner ignores — best-effort) | `IO_ERROR` (write) / `FILE_NOT_FOUND` (ensureDir, passed through) |
| `deregisterLoop` | entry already gone (`ENOENT`) | **idempotent** — `ok(undefined)`, not an error | — |
| `deregisterLoop` | other fs error / path escape | return error | `IO_ERROR` / `PATH_VIOLATION` |
| `updateLoopStatus` | entry missing or corrupt | no-op `ok(undefined)` (advisory — never disturb the loop) | — |
| `updateLoopStatus` | path escape | `validatePath` rejects | `PATH_VIOLATION` |
| `listActiveLoops` | `ACTIVE_DIR` absent | `ok([])` (nothing registered) | — |
| `listActiveLoops` | a single **corrupt entry file** | **skipped, not fatal** — earlier/later valid entries still returned | — |
| `listActiveLoops` | `readdir` fs failure | return error | `IO_ERROR` |
| `listActiveLoops` | reconcile: dead/stale/recycled pid | **prune (unlink) + exclude** (self-heal) | — (best-effort unlink) |
| all writers | any path | `validatePath(entryPath, [ACTIVE_DIR])` → `PATH_VIOLATION` outside `~/.rauf` | `PATH_VIOLATION` |

Key invariants:

- **Sandbox (REQ-SEC-01):** every write/unlink path is `validatePath`-guarded against `ACTIVE_DIR`
  (`= ~/.rauf/active`), so nothing is ever written or unlinked outside the established sandbox — per
  architecture rule #3 (`path.resolve()` + `startsWith()`, which `validatePath` implements at
  `fs-utils.ts:140`).
- **Corrupt entry skipped, not fatal (§7):** a single unparseable `<hash>.json` (half-written by a
  crash, or a foreign file) is skipped by `listActiveLoops`; it never aborts the listing for the other
  loops.
- **Deregister idempotent:** unlink-if-exists, mirroring `releaseLock`'s finally-safety — so the run's
  `finally` can always call it without guarding existence.
- **`IO_ERROR` on write failure:** the new `ErrorCodes.IO_ERROR` (`00-core-definitions.md` §3.1) is the
  registry's fs-failure code; the runner treats all registry results best-effort and never propagates
  them into loop control flow.
- **Reconciliation is pure file reads (rule #6):** liveness comes from `checkLockFile`'s
  `process.kill(pid, 0)` + `/proc/<pid>/stat` read — **no subprocess** is ever spawned for status
  derivation, satisfying architecture rule #6.

---

## 7. Self-Heal & Corrupt-Entry Semantics (REQ-DISC-05, REQ-OBSV-01) — tech-spec §7

Two distinct robustness behaviors, both inside `listActiveLoops`:

1. **Stale self-heal (REQ-DISC-05).** A loop that crashed without running its `finally`-deregister
   leaves an orphan `<hash>.json`. On the next `listActiveLoops`, that entry's `stateDir/.loop.lock` is
   reconciled via `checkLockFile`: a dead pid (`process.kill` throws → `isProcessAlive` false) or a
   recycled pid (`/proc` start-time mismatch) or an absent lock yields a not-live verdict. The entry is
   **unlinked (pruned) and excluded** — so a crashed loop is **never** reported live (SC-3). The lock
   is the ground truth; the registry self-corrects to match it. This *also* covers the case where
   `releaseLock` ran (lock gone) but `deregisterLoop` somehow did not — `checkLockFile` returns
   `locked:false`, the entry is pruned.

2. **Corrupt entry skipped, not fatal (tech-spec §7).** A `<hash>.json` that fails `JSON.parse` or
   `ActiveLoopEntrySchema` (e.g. a torn write observed mid-`atomicWrite`-rename window — vanishingly
   rare since `atomicWrite` renames atomically, or a stray/foreign file) is **skipped** in the
   listing loop (`if (!read.ok) continue;`). It does not abort the listing and does not crash the
   reader. (It is *not* eagerly pruned, since an unparseable file might be a not-yet-renamed `.tmp` or
   an unrelated file; only liveness-failed *valid* entries are pruned.)

Both outcomes are **discoverable** (REQ-OBSV-01): the pruned/skipped entry simply stops appearing in
the list every observer reads, so a stale loop visibly disappears on the next `status --all` / web
poll. Phase 1 surfaces the *effect* (the corrected list); an explicit "N reconciled" annotation in the
CLI is left to `04` and is non-binding (REQ-OBSV-01 is P2).

---

## 8. Concurrency Safety (REQ-DISC-04) — Why It Holds

REQ-DISC-04 requires the registry to tolerate many loops registering/deregistering and many readers
querying simultaneously without corruption. This is guaranteed **structurally** (§2.1), not by a lock:

- **Disjoint write targets.** Loop A writes only `<hash(A.stateDir)>.json`; loop B only
  `<hash(B.stateDir)>.json`. Distinct state dirs → distinct hashes → distinct files. Two loops can
  never write the same file, so there is no write-write race.
- **Atomic per-entry writes.** Each entry is written with `atomicWrite` (`.tmp` → `rename`), so a
  reader either sees the **complete previous** entry, the **complete new** entry, or (briefly, between
  unlink and a re-register that does not happen for the same root) **no** entry — never a torn one.
- **Reader isolation.** `listActiveLoops` reads each file independently; a missing file (just
  deregistered) is simply absent from `readdirSync`, and a corrupt/in-flight file is skipped (§7).
  Readers never block writers; writers never block readers.
- **The per-root `.loop.lock` already serializes loops per root.** Two runners cannot both hold the
  lock for the same state dir (`acquireLock`, `lock.ts:131`), so two live entries for the *same* hash
  cannot legitimately coexist — the registry inherits this serialization for free.

---

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — `ActiveLoopEntry`/`ActiveLoopEntrySchema`
  (§1.2), `ACTIVE_DIR` (§2.3), `LoopStateStatus`/`LoopStateStatusSchema`, `IO_ERROR` (§3.1), and the
  reused `LockStatus` (`lock.ts:39`) / `LockFileContent` (`lock.ts:15`). **Referenced, not redefined.**
- [`01-architecture-layout.md`](./01-architecture-layout.md) — the barrel re-export
  (`export * from "./loop-registry.js"`), the dependency graph (rule #1), and the
  multi-writer-but-contention-free note this doc realizes.
- [`02-event-log.md`](./02-event-log.md) — `rotateEventsLog` also fires at `runner.start()`; the
  register call sits beside it (ordering noted in §5.1). No code dependency, only co-location.

**Downstream consumers of this doc's API:**

- [`04-cli-monitoring-surface.md`](./04-cli-monitoring-surface.md) — consumes `listActiveLoops()` for
  `status --all` (REQ-DISC-06) and empty-is-never-silent cross-root surfacing (REQ-DISC-01/02). The
  *empty-not-silent* presentation and the `--all` flag are owned there.
- [`05-web-observation-parity.md`](./05-web-observation-parity.md) — consumes `listActiveLoops()` for
  `GET /api/loops` (REQ-WEB-03) and projects-view liveness badges. The route + UI are owned there.

---

## Verification

Maps to SC-2 (cross-root liveness surfaced) and SC-3 (crash → not-live + self-heal). Tests are
co-located `loop-registry.test.ts` (core) plus a sandbox integration check (CLAUDE.md convention;
tech-spec §8).

- [ ] **Round-trip:** `registerLoop(entry)` → `listActiveLoops()` includes it (with a live lock present)
      → `deregisterLoop(entry.stateDir)` → `listActiveLoops()` no longer includes it; the entry file is
      gone. (REQ-DISC-03.)
- [ ] **`registryEntryPath` / `key` determinism:** the same state dir spelled two ways
      (`/a/b/.rauf` vs `/a/b/../b/.rauf`) resolves to the **same** `<hash>.json` (cwd-independent key,
      REQ-DISC-03 / TQ-2: 16 hex chars of `sha256(resolve(stateDir))`).
- [ ] **Stale self-heal (SC-3 / REQ-DISC-05):** write an entry whose `.loop.lock` records a **dead**
      pid (or has no lock file); `listActiveLoops()` **prunes** the entry (file unlinked) **and
      excludes** it from the result. A recycled-pid case (Linux `/proc` mismatch) is likewise pruned.
- [ ] **Corrupt entry skipped (REQ-DISC-05 / §7):** a malformed `<hash>.json` alongside a valid live
      entry is **skipped, not fatal** — `listActiveLoops()` still returns the valid one and does not throw.
- [ ] **Concurrency (REQ-DISC-04):** many distinct state dirs register/deregister interleaved (e.g. a
      loop over N entries) with no corruption and no lost/duplicated entries; a reader run concurrently
      sees only complete entries.
- [ ] **Machine-wide listing (REQ-DISC-06 / SC-2):** entries for **distinct** state dirs (different
      projects/backlog roots) all appear in one `listActiveLoops()`, independent of the caller's cwd —
      proving the data source for "a loop is live in another root."
- [ ] **Sandbox rejects out-of-`~/.rauf` path (REQ-SEC-01):** a `registerLoop`/`deregisterLoop`/
      `updateLoopStatus` whose derived path would escape `ACTIVE_DIR` returns `PATH_VIOLATION` and
      writes/unlinks nothing. (In practice the path is always derived from `registryEntryPath`, but the
      `validatePath` guard is asserted to be present and effective.)
- [ ] **`updateLoopStatus` advisory (REQ-OBS-02):** updates the entry's `status`; a missing/corrupt
      entry yields `ok(undefined)` (no-op) and never throws; `state.json` is unaffected.
- [ ] **`checkLock` unchanged after extraction:** the existing `lock.ts` tests for `checkLock(paths)`
      (locked/unlocked/stale/recycled) **still pass** with `checkLock` delegating to `checkLockFile`;
      `checkLockFile(lockPath)` returns the identical `LockStatus` for the same lock file. (Confirms the
      refactor is behavior-preserving; SC-7 typecheck/test/lint green.)
- [ ] **Runner wiring (SC-3):** a mock-Claude sandbox run registers an entry at start and removes it in
      `finally` on normal exit; a killed-mid-run scenario (`SIGKILL`, finally skipped) leaves an entry
      that the **next** `listActiveLoops()` prunes (dead pid), and `state.json` still reports correct
      status. (`bash test-sandbox/verify.sh`.)
