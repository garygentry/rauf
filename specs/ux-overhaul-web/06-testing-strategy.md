# 06 — Testing Strategy

> Implementation spec for `ux-overhaul-web` (Phase 4, final). Defines the test suite that proves the
> recovery routes (`04-web-recovery-routes.md`), the status vocabulary (`02-status-vocabulary.md`), and
> the cli→loop recovery relocation (`03-recovery-relocation.md`) behave as specified. Implements
> `tech-spec.md` §8 and the PRD's testing requirements REQ-TEST-01/02/03. Every test below is concrete:
> file path + exact cases + a runnable-shaped skeleton mirroring the existing suite.
>
> **Scope note (foundation docs read):** `00-core-definitions.md` and `01-architecture-layout.md` were
> read and are referenced for all shared types and the file-change map. Sibling domain docs
> `02-status-vocabulary.md`, `03-recovery-relocation.md`, `04-web-recovery-routes.md` are authored in
> parallel; where one was not yet readable at authoring time, the cases here are derived from the
> PRD/tech-spec for that area and the citation is marked `(from PRD/tech-spec; cross-check against NN
> when available)`.

## Requirement Coverage

| Requirement | Section |
|---|---|
| REQ-TEST-01 (backend route tests for the 5 endpoints) | §3 Backend route tests |
| REQ-TEST-02 (label-map + status unit tests) | §4 Core unit tests |
| REQ-TEST-02 (relocated recovery tests) | §5 Relocated recovery tests |
| REQ-TEST-03 (no React harness — deliberate) | §6 No frontend harness |
| (gate / coverage targets, all of the above) | §7 Coverage targets & gate |

Supporting requirements verified *through* these tests (not owned here): REQ-SEC-01 (§3.3 403 cases),
REQ-WEB-09 (§3.4 409 live-loop cases), REQ-VOCAB-02/03/04/05/06/07 (§4.1/§4.2), REQ-EXIT-01 (§4.3),
REQ-WEB-08/REQ-ARCH-01 (§5 relocation behavior unchanged).

## Dependencies

This doc tests what the others build, so it is implemented **last**:

- `00-core-definitions.md` — the type surface under test (`STATE_LABELS`, `getStateLabel`,
  `LoopStateEnum`, `ResumeResult`, the route body schemas, the `ErrorCodes`→HTTP table).
- `01-architecture-layout.md` — the file-change map (which test files move; where new test files land).
- `02-status-vocabulary.md` — the concrete `STATE_LABELS` label+tone table and the `mapLoopStateStatus`
  / `statusExitCode` remap that §4 asserts.
- `03-recovery-relocation.md` — the cli→loop relocation that §5's test move mirrors.
- `04-web-recovery-routes.md` — the five route handlers, their guard placement, error codes, and the
  `assertNoLiveLoop` / `acquireRecoveryLock` guards that §3 exercises.

These tests must not be implemented before the code they cover exists (they will fail to compile/run).

---

## 1. Conventions inherited from the existing suite

All new tests use **Vitest**, colocate as `*.test.ts` beside source, and follow the patterns already in
the repo. Verified anchors:

- **Router-factory + temp dir** for web route tests: `createApp(Date.now(), { rootDirectory })` then
  `app.request(path, init)` — `packages/web/src/server/routes/projects.test.ts:12-13`,
  `routes/loop.test.ts:48-50`.
- **CSRF header** on mutations: `{ "X-Rauf-Request": "true", "Content-Type": "application/json" }` —
  `projects.test.ts:48` (`csrfHeaders` const). Omitting it must yield **403** —
  `projects.test.ts:182-190`, `loop.test.ts:289-295`.
- **Project seeding** into the temp root: `writeMarker` (`.rauf.json`), `writeBacklog`
  (`.rauf/backlog.json`), `writeRaufMd` (`.rauf/RAUF.md`), composed by `createProject(name, items)` —
  `loop.test.ts:56-114`. Reuse these helpers verbatim.
- **Seeding a live lock** inside a project's `.rauf/` (so `checkLock`/`acquireRecoveryLock` report a
  live loop): write `.loop.lock` with `{ pid: process.pid, startedAt, processStartTime: null }` —
  this is the exact shape `loop-manager.test.ts:325-333` and `status.test.ts:89-97` use; `null`
  `processStartTime` skips the recycle check so the current process counts as alive. `LOCK_FILENAME`
  is exported from `@rauf/core` (`loop.test.ts:32`).
- **`HOME` isolation** for any test that touches the active-loop registry (`~/.rauf/active/`): the
  `vi.hoisted` redirect of `$HOME`/`$USERPROFILE` to a temp dir **before `@rauf/core` import** —
  `loop.test.ts:18-41`. The route tests for recovery do **not** register loops, so they need this
  only if a handler calls `listActiveLoops`/`registerLoop`; the resume relaunch path (which calls
  `loopManager.startLoop`) does, so `recovery.test.ts` (web) **must** include the `HOME` redirect and
  the `ACTIVE_DIR` cleanup in `afterEach` (`loop.test.ts:41,207-211`).
- **`resetLoopManager()`** in `beforeEach`/`afterEach` for any test that drives the LoopManager
  singleton (resume relaunch, review) — `loop.test.ts:39,205,209`.
- **Reading a JSON response:** `const body = (await res.json()) as { data: ... } | { error: { code } }`
  — `projects.test.ts:16-18`, `loop.test.ts:52-54`.
- **Mock claude** for any path that actually starts a runner: `setupMockClaude("RAUF_DONE")` (immediate
  exit) or `setupLongRunningClaude()` (`exec sleep 999`, stays in-flight) — `loop.test.ts:89-105`.

---

## 2. Test file inventory (what to add / move) — REQ-TEST-01/02

| File | New / Extend / Move | Covers | §  |
|---|---|---|---|
| `packages/web/src/server/routes/recovery.test.ts` | **NEW** | `POST /reset`, `POST /resume`, `POST /backlog/unblock`, `GET /backlog/validate` | §3.1–3.5 |
| `packages/web/src/server/routes/loop.test.ts` | **EXTEND** | `POST /:id/loop/review` (lives in `loop.ts` per `01` §6.1) | §3.6 |
| `packages/web/src/server/loop-manager.test.ts` | **EXTEND** | `startReviewLoop` unit behavior | §3.7 |
| `packages/core/src/state-labels.test.ts` | **NEW** | `STATE_LABELS` totality + label/tone + `getStateLabel` | §4.1 |
| `packages/core/src/status.test.ts` | **EXTEND** | `mapLoopStateStatus` 12-raw coverage incl. 2 new | §4.2 |
| `packages/cli/src/status-commands.test.ts` | **EXTEND** | `statusExitCode` REVIEWING→6, PAUSED_USAGE_LIMIT→4 | §4.3 |
| `packages/loop/src/recovery.test.ts` | **MOVE** (from `packages/cli/src/recovery.test.ts`) | relocated lock + reconcile cases | §5 |
| `packages/cli/src/recovery.test.ts` | **REDUCE** to import-smoke | re-export resolves; `--recover` symbols stay | §5 |

Rationale for placing the four `projects.ts` routes in a dedicated **`recovery.test.ts`** rather than
extending `projects.test.ts`: the recovery routes need the mock-claude + `HOME`-isolation + lock-seeding
machinery that `projects.test.ts` (a pure metadata/discovery suite, no PATH/HOME mutation) does not set
up. A new file keeps that machinery (mirrored from `loop.test.ts`) isolated and avoids polluting the
discovery suite's clean `beforeEach`. `review` extends `loop.test.ts` because `01` §6.1 places the
handler in `loop.ts` and that file already has the full mock-claude + manager harness.

---

## 3. Backend route tests — REQ-TEST-01 (`recovery.test.ts` + `loop.test.ts`)

Each of the five endpoints gets, per `tech-spec.md` §8: **success**, **403 missing `X-Rauf-Request`**
(POST only), **409 when a loop is live**, **404 missing backlog/state**, **400 bad body**. `validate`
is `GET` (read-only) so it has no 403/409 case but adds a "safe during a live run" case.

### 3.0 Shared harness (top of `recovery.test.ts`)

Copy the `loop.test.ts` preamble (the `vi.hoisted` HOME redirect, `ACTIVE_DIR`, `createProject`,
`setupMockClaude`/`setupLongRunningClaude`, `resetLoopManager`, `afterEach` cleanup) verbatim, then add
the two recovery-specific helpers below.

```ts
// packages/web/src/server/routes/recovery.test.ts
// ── preamble copied from loop.test.ts: vi.hoisted HOME redirect (lines 18-41),
//    createProject / writeMarker / writeBacklog / writeRaufMd / setupMockClaude /
//    setupLongRunningClaude, ACTIVE_DIR, resetLoopManager, beforeEach/afterEach ──

import { LOCK_FILENAME } from "@rauf/core"; // re-exported; see loop.test.ts:32

const csrf = { "X-Rauf-Request": "true", "Content-Type": "application/json" };

/** Seed a LIVE .loop.lock in a project's default .rauf root so checkLock /
 *  acquireRecoveryLock report a live loop (mirrors loop-manager.test.ts:325-333). */
function seedLiveLock(projectPath: string): void {
  const raufDir = path.join(projectPath, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(
    path.join(raufDir, LOCK_FILENAME),
    JSON.stringify({
      pid: process.pid, // our process is alive → locked && !stale
      startedAt: new Date().toISOString(),
      processStartTime: null, // null → recycle check skipped (status.test.ts:89-97)
    }),
  );
}

/** Seed a state.json with the given raw status (status.test.ts:57-62 shape). */
function seedState(projectPath: string, status: string): void {
  const raufDir = path.join(projectPath, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(
    path.join(raufDir, "state.json"),
    JSON.stringify({
      status,
      iteration: 1,
      maxIterations: 10,
      currentItem: null,
      lastSignal: "clean",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedItems: [],
      blockedItems: [],
      deferredItems: [],
      error: null,
      baseCommitHash: null,
    }),
  );
}
```

### 3.1 `POST /:id/reset` — REQ-WEB-01, REQ-WEB-09, REQ-SEC-01

Core call: `resetProject(paths, opts)` (`00` §5, `reset.ts:48`, synchronous). Guard: acquire-and-hold
(`04`; `tech-spec.md` §3.4). Body schema: `ResetBodySchema` (`00` §7).

```ts
describe("POST /:id/reset", () => {
  it("resets a project and returns 200 with ResetProjectResult", async () => {
    createProject("p", [pendingItem]);
    seedState("p", "paused"); // something to clear
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ clearBacklog: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { stateCleared: boolean } };
    expect(body.data).toHaveProperty("stateCleared");
  });

  it("returns 403 without X-Rauf-Request (app-level CSRF, app.ts:54-69)", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 409 LOCK_CONFLICT when a loop is live (acquire-and-hold guard)", async () => {
    createProject("p", [pendingItem]);
    seedLiveLock("p"); // live lock our PID holds → acquireRecoveryLock fails
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", { method: "POST", headers: csrf });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("LOCK_CONFLICT");
  });

  it("returns 404 when the project/backlog is missing", async () => {
    const app = makeApp(tmpDir); // no createProject → no .rauf.json / backlog
    const res = await app.request("/api/projects/ghost/reset", { method: "POST", headers: csrf });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed body (schema reject)", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/reset", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ clearBacklog: "yes-please" }), // boolean expected → .strict reject
    });
    expect(res.status).toBe(400);
  });
});
```

> **404 vs route shape:** the success/404 split depends on `04`'s decision of whether the handler 404s
> on a missing `.rauf.json` (project not installed, like `projects.test.ts:280-288`) or a missing
> `backlog.json` (`FILE_NOT_FOUND`, `00` §8.1). Both surface as 404; assert the status and, where `04`
> specifies it, the `error.code` (`NOT_FOUND` for un-installed, `FILE_NOT_FOUND` for missing backlog).
> *(cross-check against 04-web-recovery-routes.md.)*

### 3.2 `POST /:id/resume` — REQ-WEB-02, REQ-WEB-09

Core/loop calls: optional `updateItem` (answers) → `await recoverInterruptedLoop(paths)` (async,
relocated to `@rauf/loop`) → conditional `loopManager.startLoop`. Guard: acquire-and-hold. Success →
`200 { data: ResumeResult }` (`00` §6). Because the relaunch path drives the LoopManager + registry,
this `describe` requires the `HOME` redirect and a mock claude.

```ts
describe("POST /:id/resume", () => {
  it("reconciles and returns 200 ResumeResult (relaunched:false when nothing eligible)", async () => {
    createProject("p"); // empty backlog → no eligible item → relaunched:false
    setupMockClaude();
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reconciled: unknown; relaunched: boolean } };
    expect(body.data).toHaveProperty("reconciled");
    expect(body.data.relaunched).toBe(false);
  });

  it("relaunches a detached loop when an eligible item exists (relaunched:true)", async () => {
    createProject("p", [pendingItem]);
    setupLongRunningClaude(); // stays in-flight so startLoop succeeds
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ retryBlocked: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { relaunched: boolean } };
    expect(body.data.relaunched).toBe(true);
  });

  it("injects answers (text vocabulary) before reconcile — OQ-T2 resolution", async () => {
    // 00 §7: answers: { itemId, text }[]; wired to updateItem(..., { humanAnswer: text, ... }).
    createProject("p", [{ ...pendingItem, status: "blocked", needsHuman: true,
      blockedReason: "need API key" }]);
    setupMockClaude();
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ answers: [{ itemId: "001", text: "key=abc" }] }),
    });
    expect(res.status).toBe(200);
    // The item is unblocked back to pending (assert via a follow-up backlog read).
    const backlog = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "p", ".rauf", "backlog.json"), "utf-8"),
    ) as { items: { status: string }[] };
    expect(backlog.items[0]!.status).toBe("pending");
  });

  it("returns 403 without X-Rauf-Request", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    expect((await app.request("/api/projects/p/resume", { method: "POST" })).status).toBe(403);
  });

  it("returns 409 when a loop is live (acquire-and-hold)", async () => {
    createProject("p", [pendingItem]);
    seedLiveLock("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", { method: "POST", headers: csrf });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("LOCK_CONFLICT");
  });

  it("returns 404 when the project is missing", async () => {
    const app = makeApp(tmpDir);
    expect(
      (await app.request("/api/projects/ghost/resume", { method: "POST", headers: csrf })).status,
    ).toBe(404);
  });

  it("returns 400 for a malformed answers array", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/resume", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ answers: [{ itemId: "001" }] }), // missing `text` → schema reject
    });
    expect(res.status).toBe(400);
  });
});
```

> **Lock release after relaunch:** `04`/`tech-spec.md` §3.4 require the lock be released in a `finally`
> *after* the relaunch handoff. Add a regression case that a `resume` which relaunched still leaves the
> project resumable (no orphaned recovery lock): after the relaunch test, `manager.stopLoop` /
> `shutdownAll`, then assert a second `resume` is **not** rejected 409 by a leftover recovery lock.
> *(cross-check against 04 once readable.)*

### 3.3 `POST /:id/backlog/unblock` — REQ-WEB-04, REQ-WEB-09

Core call: `unblockItems(paths, itemId?)` (`00` §5, `backlog.ts:431`, synchronous). Guard:
**lightweight** `assertNoLiveLoop` (check-then-act via `checkLock`, `tech-spec.md` §3.4 / `04`).

```ts
const blockedItem = { ...pendingItem, status: "blocked", blockedReason: "manual" };

describe("POST /:id/backlog/unblock", () => {
  it("unblocks all blocked items and returns counts", async () => {
    createProject("p", [blockedItem, { ...blockedItem, id: "002" }]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { unblockedCount: number; unblockedIds: string[] } };
    expect(body.data.unblockedCount).toBe(2);
    expect(body.data.unblockedIds).toContain("001");
  });

  it("unblocks a single item by id", async () => {
    createProject("p", [blockedItem, { ...blockedItem, id: "002" }]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ itemId: "001" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { unblockedCount: number } }).data.unblockedCount).toBe(1);
  });

  it("returns 403 without X-Rauf-Request", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    expect((await app.request("/api/projects/p/backlog/unblock", { method: "POST" })).status).toBe(403);
  });

  it("returns 409 when a loop is live (assertNoLiveLoop / checkLock)", async () => {
    createProject("p", [blockedItem]);
    seedLiveLock("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", { method: "POST", headers: csrf });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("LOCK_CONFLICT");
  });

  it("returns 404 when the backlog is missing", async () => {
    const app = makeApp(tmpDir);
    expect(
      (await app.request("/api/projects/ghost/backlog/unblock", { method: "POST", headers: csrf }))
        .status,
    ).toBe(404);
  });

  it("returns 400 for a malformed body", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/unblock", {
      method: "POST",
      headers: csrf,
      body: JSON.stringify({ itemId: 123 }), // string expected
    });
    expect(res.status).toBe(400);
  });
});
```

### 3.4 `GET /:id/backlog/validate` — REQ-WEB-05, REQ-OBS-01

Core call: `validateBacklog(paths, {})` (`00` §5, `backlog-validate.ts:47`). **GET, read-only** → no
CSRF header required, **no 409** (safe during a live run), 404 on missing backlog, 400 on a sandbox-
escaping `?backlogRoot`.

```ts
describe("GET /:id/backlog/validate", () => {
  it("returns 200 with { valid, findings } for a clean backlog", async () => {
    createProject("p", [pendingItem]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { valid: boolean; findings: unknown[] } };
    expect(body.data.valid).toBe(true);
    expect(Array.isArray(body.data.findings)).toBe(true);
  });

  it("surfaces findings (machine-readable) for an invalid backlog — REQ-OBS-01", async () => {
    // Two items with the same id → DUPLICATE_ID finding (backlog-validate finding codes, 00 §5).
    createProject("p", [pendingItem, { ...pendingItem }]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { valid: boolean; findings: { code: string }[] };
    };
    expect(body.data.valid).toBe(false);
    expect(body.data.findings.some((f) => f.code === "DUPLICATE_ID")).toBe(true);
  });

  it("is safe during a live run (read-only — NOT 409)", async () => {
    createProject("p", [pendingItem]);
    seedLiveLock("p"); // a live loop must NOT block a read-only validate
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("does NOT require X-Rauf-Request (GET is not CSRF-gated)", async () => {
    createProject("p", [pendingItem]);
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/p/backlog/validate", { method: "GET" });
    expect(res.status).not.toBe(403);
  });

  it("returns 404 when the backlog is missing", async () => {
    const app = makeApp(tmpDir);
    expect(
      (await app.request("/api/projects/ghost/backlog/validate", { method: "GET" })).status,
    ).toBe(404);
  });

  it("returns 400 for a sandbox-escaping ?backlogRoot", async () => {
    createProject("p");
    const app = makeApp(tmpDir);
    const res = await app.request(
      "/api/projects/p/backlog/validate?backlogRoot=" + encodeURIComponent("../../escape"),
      { method: "GET" },
    );
    expect(res.status).toBe(400);
  });
});
```

### 3.5 Route-mounting smoke (mirrors `loop.test.ts:514-525`)

```ts
describe("recovery route mounting", () => {
  it("reset/resume/unblock are mounted (403 CSRF, not 404)", async () => {
    const app = makeApp(tmpDir);
    for (const p of ["reset", "resume", "backlog/unblock"]) {
      const res = await app.request(`/api/projects/test/${p}`, { method: "POST" });
      expect(res.status).toBe(403); // reached the CSRF middleware → route exists
    }
  });
});
```

### 3.6 `POST /:id/loop/review` — REQ-WEB-03 (extend `loop.test.ts`)

Handler lives in `loop.ts` (`01` §6.1); it builds `LoopStartOptions` and calls
`loopManager.startReviewLoop` (`tech-spec.md` §3.2). It goes through the start path, so its concurrency
case is **409 if a loop is already running** (not a recovery-lock 409). Add to `loop.test.ts` so it
reuses that file's mock-claude harness.

```ts
describe("POST /:id/loop/review", () => {
  it("starts a review pass and returns 200 { started: true }", async () => {
    createProject("test-project", [pendingItem]);
    setupMockClaude(); // RAUF_REVIEW path tolerated; immediate exit
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/test-project/loop/review", {
      method: "POST",
      headers: { "X-Rauf-Request": "true", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(((await json(res)) as { data: { started: boolean } }).data.started).toBe(true);
  });

  it("returns 409 when a loop is already running", async () => {
    createProject("test-project", [pendingItem]);
    setupLongRunningClaude();
    const app = makeApp(tmpDir);
    await app.request("/api/projects/test-project/loop/start", {
      method: "POST",
      headers: { "X-Rauf-Request": "true", "Content-Type": "application/json" },
      body: JSON.stringify({ maxIterations: 5 }),
    });
    const res = await app.request("/api/projects/test-project/loop/review", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });
    expect(res.status).toBe(409);
    expect(((await json(res)) as { error: { code: string } }).error.code).toBe("CONFLICT");
  });

  it("requires CSRF header (403)", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/test-project/loop/review", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid project id", async () => {
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/a%2Fb/loop/review", {
      method: "POST",
      headers: { "X-Rauf-Request": "true" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed body (e.g. non-numeric sessionTimeoutMinutes)", async () => {
    createProject("test-project");
    const app = makeApp(tmpDir);
    const res = await app.request("/api/projects/test-project/loop/review", {
      method: "POST",
      headers: { "X-Rauf-Request": "true", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionTimeoutMinutes: "soon" }),
    });
    expect(res.status).toBe(400);
  });
});
```

### 3.7 `LoopManager.startReviewLoop` unit (extend `loop-manager.test.ts`)

Mirrors `loop-manager.test.ts`'s `startLoop` describe (`:88-130`). Asserts the review pass is tracked
like a normal loop and rejects a duplicate start.

```ts
describe("startReviewLoop", () => {
  it("starts a review pass and tracks it", () => {
    const manager = new LoopManager();
    writeMarker(projectPath);
    writeBacklog(projectPath, [/* one pending item */]);
    writeRaufMd(projectPath);
    setupMockClaude();

    const result = manager.startReviewLoop(projectPath, {
      maxIterations: 1, maxRetries: 1, review: true, reviewOnly: true, sessionTimeoutMinutes: 1,
    });
    expect(result.ok).toBe(true);
    expect(manager.isRunning(projectPath)).toBe(true);
  });

  it("rejects a duplicate start (same map-key tracking as startLoop)", () => {
    const manager = new LoopManager();
    writeMarker(projectPath); writeBacklog(projectPath); writeRaufMd(projectPath);
    setupMockClaude();
    manager.startReviewLoop(projectPath, { maxIterations: 1, maxRetries: 1, sessionTimeoutMinutes: 1 });
    const dup = manager.startReviewLoop(projectPath, {
      maxIterations: 1, maxRetries: 1, sessionTimeoutMinutes: 1,
    });
    expect(dup.ok).toBe(false);
  });
});
```

---

## 4. Core unit tests — REQ-TEST-02

### 4.1 `state-labels.test.ts` (NEW) — REQ-VOCAB-02/05/06/07

Total coverage is the load-bearing assertion: **iterate the enum** so a future enum addition without a
`STATE_LABELS` entry fails the test (defense-in-depth beyond the `Record<LoopStateEnum, StateLabel>`
compile check, `00` §3). Source the enum members from `LoopStateEnumSchema.options` (`schemas.ts`).

```ts
// packages/core/src/state-labels.test.ts
import { describe, it, expect } from "vitest";
import { STATE_LABELS, getStateLabel, type StateTone } from "./state-labels.js";
import { LoopStateEnumSchema, type LoopStateEnum } from "./schemas.js";

const ALL_STATES = LoopStateEnumSchema.options as readonly LoopStateEnum[];
const TONES: readonly StateTone[] = ["neutral", "info", "success", "warning", "danger"];

describe("STATE_LABELS", () => {
  it("has an entry for EVERY LoopStateEnum value (total coverage — REQ-VOCAB-02)", () => {
    for (const s of ALL_STATES) {
      expect(STATE_LABELS[s], `missing label for ${s}`).toBeDefined();
    }
    // No extra keys beyond the enum.
    expect(Object.keys(STATE_LABELS).sort()).toEqual([...ALL_STATES].sort());
  });

  it("every entry has a non-empty Title-Case label and a valid tone (REQ-VOCAB-06/07)", () => {
    for (const s of ALL_STATES) {
      const { label, tone } = STATE_LABELS[s];
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(s); // not the SCREAMING_SNAKE machine form
      expect(TONES).toContain(tone);
    }
  });

  // Pin the human labels CANON §4.3 mandates (02-status-vocabulary.md §labels).
  it.each<[LoopStateEnum, string]>([
    ["PAUSED_HUMAN", "Needs Human"], // REQ-VOCAB-05
    ["REVIEWING", "Reviewing"], // REQ-VOCAB-03
    ["PAUSED_USAGE_LIMIT", "Usage Limit (Paused)"], // REQ-VOCAB-04
    ["NOT_INSTALLED", "Not Installed"],
    ["LIMIT_REACHED", "Limit Reached"],
    ["SLEEPING_LIMIT", "Sleeping (Limit)"],
    ["WEEKLY_LIMIT", "Weekly Limit"],
  ])("labels %s as %s", (state, label) => {
    expect(STATE_LABELS[state].label).toBe(label);
  });

  // Pin tones per tech-spec.md §3.5 (02 §tones finalizes the full table).
  it.each<[LoopStateEnum, StateTone]>([
    ["RUNNING", "info"], ["STARTING" as LoopStateEnum, "info"], ["COMPLETE", "success"],
    ["IDLE", "neutral"], ["NOT_INSTALLED", "neutral"], ["PAUSED", "info"], ["REVIEWING", "info"],
    ["PAUSED_HUMAN", "warning"], ["PAUSED_USAGE_LIMIT", "warning"], ["SLEEPING_LIMIT", "warning"],
    ["WEEKLY_LIMIT", "warning"], ["LIMIT_REACHED", "warning"], ["ERROR", "danger"],
  ].filter(([s]) => (ALL_STATES as string[]).includes(s)))("tones %s as %s", (state, tone) => {
    expect(STATE_LABELS[state].tone).toBe(tone);
  });
});

describe("getStateLabel", () => {
  it("never returns undefined for any enum value", () => {
    for (const s of ALL_STATES) {
      const entry = getStateLabel(s);
      expect(entry).toBeDefined();
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("returns the same object the table holds", () => {
    expect(getStateLabel("REVIEWING")).toEqual(STATE_LABELS.REVIEWING);
  });
});
```

> Note: `LoopStateEnum` has no `STARTING` member (`00` §2 — `starting` is a *raw* status that maps to
> `RUNNING`); the `.filter` guard above drops any tone row whose state is not actually in the enum so
> the table can be copied from `02` without an out-of-enum key. The authoritative tone values come from
> `02-status-vocabulary.md` §tones — *(cross-check against 02 when readable; tech-spec.md §3.5 is the
> interim source.)*

### 4.2 `status.test.ts` additions — `mapLoopStateStatus` (REQ-VOCAB-02/03/04)

`mapLoopStateStatus` is module-private in `status.ts` (`:106`). Two options: (a) export it (preferred —
makes the total mapping directly testable, matches `tech-spec.md` §8's "all 12 raw mapped"); or (b)
assert through `deriveStatus` by writing a `state.json` per raw status (the existing pattern,
`status.test.ts:188-265,952-1005`). This spec **requires option (a)** export so totality is asserted at
the mapping boundary; the existing `deriveStatus` cases for the two new states are also added.

```ts
// packages/core/src/status.test.ts — add near the existing deriveStatus describes
import { mapLoopStateStatus } from "./status.js"; // now exported (D from this spec)
import type { LoopState } from "./schemas.js";

describe("mapLoopStateStatus — total over the 12 raw statuses (REQ-VOCAB-02)", () => {
  it.each<[LoopState["status"], string]>([
    ["idle", "IDLE"],
    ["starting", "RUNNING"],
    ["running", "RUNNING"],
    ["paused", "PAUSED"],
    ["complete", "COMPLETE"],
    ["paused_human", "PAUSED_HUMAN"],
    ["limit_reached", "LIMIT_REACHED"],
    ["error", "ERROR"],
    ["sleeping_limit", "SLEEPING_LIMIT"],
    ["weekly_limit", "WEEKLY_LIMIT"],
    ["reviewing", "REVIEWING"], // CHANGED: was "RUNNING" (status.ts:118) — REQ-VOCAB-03
    ["paused_usage_limit", "PAUSED_USAGE_LIMIT"], // CHANGED: was "PAUSED" (status.ts:120) — REQ-VOCAB-04
  ])("maps raw %s → derived %s", (raw, derived) => {
    expect(mapLoopStateStatus(raw)).toBe(derived);
  });
});

// deriveStatus end-to-end for the two newly-distinct states (mirrors status.test.ts:952-1005).
describe("deriveStatus — REVIEWING / PAUSED_USAGE_LIMIT distinct (no collapse)", () => {
  it("derives REVIEWING from state.json status 'reviewing'", () => {
    writeStateJson(makeLoopState({ status: "reviewing" }));
    const r = deriveStatus(makePaths());
    expect(r.ok && r.value.loopState).toBe("REVIEWING"); // not RUNNING
  });

  it("derives PAUSED_USAGE_LIMIT from state.json status 'paused_usage_limit'", () => {
    writeStateJson(makeLoopState({ status: "paused_usage_limit" }));
    const r = deriveStatus(makePaths());
    expect(r.ok && r.value.loopState).toBe("PAUSED_USAGE_LIMIT"); // not PAUSED
  });
});
```

> The `it.each` enumerating all 12 raw statuses is the REQ-VOCAB-02 regression: adding a 13th raw status
> without a mapping entry makes the `Record<LoopState["status"], LoopStateEnum>` (status.ts:107) a
> compile error *and* this list will be visibly incomplete. *(Mapping authority: 02 §exit-codes /
> tech-spec.md §3.3.)*

### 4.3 `status-commands.test.ts` additions — `statusExitCode` (REQ-EXIT-01)

Extend the existing `it.each` table (`status-commands.test.ts:836-849`) with the two new states; keep a
regression assertion for the existing rows. Per `tech-spec.md` §3.3: `REVIEWING → 6` (preserves prior
observable behavior — `reviewing` already derived to RUNNING→6), `PAUSED_USAGE_LIMIT → 4` (corrects the
silent `0`).

```ts
// packages/cli/src/status-commands.test.ts — inside describe("statusExitCode ...")
it.each<[LoopStateEnum, number]>([
  ["REVIEWING", ExitCode.RUNNING], // 6 — REQ-EXIT-01 (preserves prior behavior)
  ["PAUSED_USAGE_LIMIT", ExitCode.LIMIT], // 4 — REQ-EXIT-01 (was silent 0)
])("maps new state %s → %d", (state, expected) => {
  expect(statusExitCode(state)).toBe(expected);
});

it("PAUSED_USAGE_LIMIT no longer exits 0 (the bug REQ-EXIT-01 fixes)", () => {
  expect(statusExitCode("PAUSED_USAGE_LIMIT")).not.toBe(ExitCode.SUCCESS);
});
```

Also extend the *existing* parametrized table (`:836`) so the full enum is covered in one place; with
the two new states added, the `statusExitCode` `switch` (`status-commands.ts:512`, default-less) is
total — TS errors if a new enum value is added without a case, and this table proves the runtime mapping.

---

## 5. Relocated recovery tests (cli → loop) — REQ-TEST-02, REQ-WEB-08

`tech-spec.md` §3.1 / `01` §3 move `recoverInterruptedLoop`, `reconcileAndRequeue`,
`detectInterruptedItems`, `acquireRecoveryLock`, `releaseRecoveryLock` (and their types) from
`packages/cli/src/recovery.ts` to `packages/loop/src/recovery.ts`. The tests move with them.

### 5.1 Move `packages/cli/src/recovery.test.ts` → `packages/loop/src/recovery.test.ts`

The existing file (123 lines) tests **only** the relocated lock functions — `acquireRecoveryLock`
(`recovery.test.ts:40-72`) and `releaseRecoveryLock` (`:76-121`). Move the file verbatim and change the
import on `recovery.test.ts:9` from `./recovery.js` (now resolving to the `@rauf/loop` copy) — the
import already reads `from "./recovery.js"`, so after the file lands in `packages/loop/src/` it resolves
to the relocated module with **no test-body change**. The `@rauf/core` import (`:7`) is unchanged.

Behavior assertions to preserve **unchanged** (proving the relocation is behavior-neutral — REQ-WEB-08):
- `acquireRecoveryLock`: clean acquire (`cleared:false`, writes our PID); clears a stale lock
  (`cleared:true`); refuses `LOCK_CONFLICT` on a live lock and leaves it intact (`:41,50,61`).
- `releaseRecoveryLock`: releases an owned lock; no-op when absent; removes a stale (dead-PID) lock;
  **never** deletes a live different-PID lock (`:77,86,91,98`).

`03-recovery-relocation.md` §2 definitively relocates `recoverInterruptedLoop` / `reconcileAndRequeue`
to `@rauf/loop`, and `04`'s resume route depends on `recoverInterruptedLoop`. The current cli
`recovery.test.ts` does not contain unit cases for them, so **the following two async cases are required**
in the relocated `packages/loop/src/recovery.test.ts` (guaranteeing REQ-WEB-08 relocation-behavior-neutral
coverage for the reconcile path):
- `recoverInterruptedLoop` resolves a `Result<RecoverySummary>` (async — `await` it) on a clean tree
  with no in-progress items (no-op summary: empty arrays, `treeClean:true`, `stalledReset:0`).
- a stalled in-progress item (no commit) is reset to pending (`stalledReset` increments, item back to
  `pending`) — mirrors `loop-manager.test.ts:282-308`'s reset assertion.
*(cross-check the exact moved set against 03-recovery-relocation.md.)*

### 5.2 CLI keeps an import-smoke test

After the move, `packages/cli/src/recovery.test.ts` is **reduced** to a smoke test proving (a) the CLI
re-export of the moved symbols still resolves (so `resume-commands.ts`/`reset-commands.ts` callers keep
compiling) and (b) the CLI-only `--recover` symbols stay put.

```ts
// packages/cli/src/recovery.test.ts (reduced)
import { describe, it, expect } from "vitest";
import * as recovery from "./recovery.js";

describe("@rauf/cli recovery re-export smoke", () => {
  it("re-exports the relocated symbols from @rauf/loop", () => {
    // Relocated (now sourced from @rauf/loop, re-exported here) — 01 §3.
    expect(typeof recovery.acquireRecoveryLock).toBe("function");
    expect(typeof recovery.releaseRecoveryLock).toBe("function");
    expect(typeof recovery.recoverInterruptedLoop).toBe("function");
  });

  it("keeps the CLI-only --recover symbols (NOT moved)", () => {
    // reverifyAndCommitInterrupted + defaultVerifyRunner stay in @rauf/cli (D3.1).
    expect(typeof recovery.reverifyAndCommitInterrupted).toBe("function");
    expect(typeof recovery.defaultVerifyRunner).toBe("function");
  });
});
```

> If `01` §3 re-exports the moved symbols from cli `recovery.ts` (it does — "re-imports the moved ones
> from `@rauf/loop`"), the first assertion holds. If a later decision drops the cli re-export, replace
> the first `it` with an assertion that `resume-commands.ts` imports from `@rauf/loop` directly. The
> `resume`/`reset` behavior-unchanged guarantee (REQ-WEB-08, D3.1) is what these smoke tests defend.

### 5.3 `resume` / `reset` behavior unchanged

No new CLI behavior tests are required (the relocation is import-path-only, `tech-spec.md` §3.1). The
existing CLI command tests for `rauf resume` / `rauf reset` (in their respective `*-commands.test.ts`,
if present) must continue to pass **unmodified** after the relocation — that is the regression bar. If
those command-level tests do not exist today, this spec does **not** mandate creating them (out of scope
for an import-path move); the relocated unit tests in §5.1 plus the smoke test in §5.2 are sufficient.

---

## 6. No new frontend test harness — REQ-TEST-03

This phase **deliberately does not** stand up a React component test harness. Verified: there are **no
`*.test.tsx` files** anywhere under `packages/web/src/client` (or the repo) today — confirmed by
`find packages -name "*.test.tsx"` returning empty. This phase keeps it that way.

**Rationale (PRD §6, REQ-TEST-03):**
- The recovery controls (`status.tsx` "Recovery" group, `01` §6.4) are thin TanStack Query
  mutations/queries that POST/GET the routes tested in §3 — the *behavior* (success, 403, 409, 404,
  400, machine-readable findings) is fully exercised at the route boundary, which is where the contract
  lives.
- The shared badge component reads `STATE_LABELS` (`01` §6.4); the label/tone correctness it depends on
  is fully covered by §4.1's core unit tests. The tone→CSS palette table is presentational and
  low-risk; adding jsdom + a component renderer to assert a class name is disproportionate.
- Standing up a component harness (jsdom/Testing Library config, render setup) is a non-trivial infra
  commitment the PRD scopes out to keep this final phase additive and low-risk.

**What covers the frontend instead:** §3 (backend route tests — the request/response contract every
control depends on) + §4.1 (core label-map unit tests — the display labels and tones the badge renders).
This is recorded as a **deliberate choice**, not an omission (REQ-TEST-03 is P1 precisely so it is
documented).

A verification check (§7) asserts the harness was not silently introduced: `find ... -name "*.test.tsx"`
must remain empty after this phase.

---

## 7. Coverage targets & the full gate

### 7.1 The gate command (must be green — PRD §8, tech-spec.md §8)

```
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

- `pnpm test` runs Vitest across all packages (`@rauf/core`, `@rauf/loop`, `@rauf/cli`, `@rauf/web`).
- `pnpm typecheck` is itself a coverage mechanism here: the `Record<LoopStateEnum, StateLabel>`
  (`state-labels.ts`), the `Record<LoopState["status"], LoopStateEnum>` (`status.ts:107`), and the
  default-less `statusExitCode` switch (`status-commands.ts:512`) are **compile-enforced total** — a
  missing case fails `typecheck` before any test runs (`00` §8, tech-spec.md §3.3).
- New tests must keep every per-package suite green; they must not depend on real `$HOME`, real network,
  or the real `rauf-stable` binary (C-3) — all I/O is against temp dirs + mock claude (§1).

### 7.2 Per-package suites touched

| Package | Suites added/changed |
|---|---|
| `@rauf/core` | `state-labels.test.ts` (new), `status.test.ts` (mapLoopStateStatus + 2 deriveStatus cases) |
| `@rauf/loop` | `recovery.test.ts` (moved in) |
| `@rauf/cli` | `status-commands.test.ts` (statusExitCode rows), `recovery.test.ts` (reduced to smoke) |
| `@rauf/web` | `routes/recovery.test.ts` (new), `routes/loop.test.ts` (review), `loop-manager.test.ts` (startReviewLoop) |

### 7.3 Coverage targets (case-level, not a % threshold)

The repo does not enforce a numeric coverage gate; the target is **case completeness** per
`tech-spec.md` §8:
- All **5** new endpoints have: success + (POST) 403 + 409-when-live (or 409-already-running for review)
  + 404 + 400. (`validate` substitutes a read-only-safe-during-run case for 409 and a no-CSRF-required
  case for 403.)
- `STATE_LABELS` asserts an entry for **every** `LoopStateEnum` value by iterating the enum (totality),
  plus pinned labels/tones for the new + renamed states.
- `mapLoopStateStatus` asserts all **12** raw statuses, including the two remaps.
- `statusExitCode` asserts the two new states (6 / 4) plus the existing regression rows.
- The relocated lock tests pass unchanged from `@rauf/loop`; the CLI smoke test proves the re-export.
- No `*.test.tsx` exists (REQ-TEST-03 negative check).

### 7.4 Fixture guidance (seeding a temp `.rauf`)

For the route tests, a project is a temp dir under `rootDirectory` containing:
- `.rauf.json` — `writeMarker` (`loop.test.ts:56-74`) — required for project discovery/installed check.
- `.rauf/backlog.json` — `writeBacklog(dir, items)` (`:76-81`) — seed items per the case
  (pending/blocked/duplicate-id).
- `.rauf/RAUF.md` — `writeRaufMd` (`:83-87`) — required by the runner-backed paths (resume relaunch,
  review).
- `.rauf/state.json` — `seedState(dir, status)` (§3.0) — only when a case needs a specific raw status.
- `.rauf/.loop.lock` — `seedLiveLock(dir)` (§3.0) — the **live-loop** fixture for every 409 case; use
  `pid: process.pid` + `processStartTime: null` so the lock reads as live (not stale).
- Mock claude on `PATH` (`setupMockClaude` / `setupLongRunningClaude`) for resume-relaunch and review.

All temp dirs are created in `beforeEach` (`fs.mkdtempSync(path.join(os.tmpdir(), "..."))`) and removed
in `afterEach` (`fs.rmSync(..., { recursive: true, force: true })`), plus `ACTIVE_DIR` cleanup and
`resetLoopManager()` for any suite that drives the manager/registry (`loop.test.ts:201-212`).

---

## Verification

An implementation matches this spec when:

1. `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` is **green** across all four packages.
2. `packages/web/src/server/routes/recovery.test.ts` exists and contains the success/403/409/404/400
   cases for `reset`, `resume`, `unblock`, and the success/404/400/read-only-safe cases for `validate`
   (§3.1–3.5); `routes/loop.test.ts` contains the `review` cases (§3.6).
3. `packages/core/src/state-labels.test.ts` iterates `LoopStateEnumSchema.options` and asserts a
   `STATE_LABELS` entry for every member, the pinned labels for `PAUSED_HUMAN`/`REVIEWING`/
   `PAUSED_USAGE_LIMIT`, and `getStateLabel` never undefined (§4.1).
4. `status.test.ts` asserts `mapLoopStateStatus` over all 12 raw statuses incl. `reviewing→REVIEWING`,
   `paused_usage_limit→PAUSED_USAGE_LIMIT` (§4.2); `status-commands.test.ts` asserts
   `statusExitCode(REVIEWING)===6`, `statusExitCode(PAUSED_USAGE_LIMIT)===4` (§4.3).
5. `packages/loop/src/recovery.test.ts` exists (moved) and passes; `packages/cli/src/recovery.test.ts`
   is the reduced smoke test (§5).
6. `find packages -name "*.test.tsx"` returns **empty** (REQ-TEST-03 — no React harness added) (§6).
7. Removing any single `STATE_LABELS` entry, any `mapLoopStateStatus` raw case, or either
   `statusExitCode` new case causes a `typecheck` and/or `test` failure (totality is enforced, not
   incidental).
