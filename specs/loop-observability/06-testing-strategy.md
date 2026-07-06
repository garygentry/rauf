# 06 — Testing Strategy

> **Final numbered document.** Turns the Verification checklists in `02`–`05` and
> the per-phase test list in [`tech-spec.md`](./tech-spec.md) §8 into a concrete,
> colocated Vitest plan: file locations, fixtures/factories, and load-bearing
> assertions. Nothing here changes the contract — it proves each phase satisfies
> its requirements and is independently green under `pnpm gate` (REQ-GATE-01).
> Traces to [`PRD.md`](./PRD.md) §4.5 (REQ-GATE-01), §9 (success criteria), and
> tech-spec §8.

This document reuses the **real** conventions of the existing suites — not
invented ones. Every snippet below matches the patterns actually in
`packages/core/src/status.test.ts` and `packages/core/src/events-log.test.ts`:
`mkdtempSync` temp dirs, colocated `.test.ts`, `Result`-shape assertions
(`expect(result.ok).toBe(true); if (!result.ok) return;`), builder helpers
(`makeLoopState`, `makeBacklog`, `event(seq, overrides)`), and — critically —
**`Date.now()`-relative timestamps rather than an injected clock** (the repo has
no clock-injection seam; see §4.3).

---

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-GATE-01 | Each phase independently green under `pnpm gate` | 1, 7 |
| REQ-PERF-01 | ≤1 `readIterationStatus` per `deriveStatus` — read-spy test | 3.1, 3.4 |
| REQ-CONTRACT-05 | Additive-only status change — existing-shape parse still succeeds | 3.2, 3.5 |
| REQ-CMD-03 | `follow --json`/`--verbose` emit every event; default = item only | 5.1, 5.2 |
| REQ-A11Y-01 | Non-TTY / `NO_COLOR` header is label-based, color-free | 5.4 |
| REQ-SCOPE-01 | Machine-context missing/ambiguous → hard `Result` error | 4.1, 4.2 |
| REQ-SAFE-01 | Sandbox containment rejects out-of-root targets | 4.4 |
| REQ-SUCCESS-01 | One poll = full decision; recipe inputs present on `DerivedStatus` | 4.5 |
| REQ-SUCCESS-05 | No breaking machine-surface change; gate green each phase | 3.2, 3.5, 7 |
| C-02 | No subprocess in derivation (asserted alongside the read-spy) | 3.4 |

---

## 1. Framework & tooling

- **Runner:** Vitest (`pnpm test`), the project's existing test runner. No new
  dev dependency (tech-spec §9).
- **Colocation:** every test file lives next to its source as `*.test.ts`
  (`packages/core/src/status.ts` → `packages/core/src/status.test.ts`), matching
  the existing convention (project CLAUDE.md: "Tests: colocate with source as
  `*.test.ts`"). **No new test files are created** — each new suite is appended
  to the existing colocated file for the module under test:

  | New coverage | Appends to existing file | Phase |
  |--------------|--------------------------|-------|
  | `health` + `statusSchemaVersion` derivation, read-spy | `packages/core/src/status.test.ts` | 1 |
  | additive-compat parse of `DerivedStatusSchema` | `packages/core/src/schemas.test.ts` | 1 |
  | `resolveTarget()` variants + sandbox | `packages/core/src/backlog-root.test.ts` | 2 |
  | `eventAltitude()` exhaustive table | `packages/core/src/events-log.test.ts` | 3 |
  | item-level `follow` default / `--verbose` / `--json` | `packages/cli/src/follow-command.test.ts` | 3 |
  | sticky-header render + A11Y degradation | `packages/cli/src/event-format.test.ts` | 3 |
  | `status` cwd-default / `--all` broadening wiring | `packages/cli/src/status-commands.test.ts` | 2/3 |

- **The gate is the single source of truth (REQ-GATE-01, REQ-SUCCESS-05).**
  "Green" means **`pnpm gate`** (build + `schema:check` + `version:check` +
  typecheck + lint + `format:check` + test), not the narrower `test` subset —
  matching `forge.config.json`'s `gateCommand`. In particular:
  - **`schema:check`** must stay in sync after the additive `DerivedStatusSchema`
    change (Phase 1) — regenerate the committed snapshot if the gate flags it
    (see `01-architecture-layout.md` §6). This is part of Phase 1's acceptance,
    not a separate step.
  - **`version:check`** must pass without a version bump (no `version.ts` change —
    `01` §6).
- **Determinism:** no test may depend on wall-clock absolute time. Freshness/age
  assertions use `Date.now()`-relative timestamps with a tolerance window (§4.3),
  exactly as `status.test.ts` already does for `elapsed` and staleness.

---

## 2. Unit vs. integration split

| Layer | What to test | What to mock/stub |
|-------|--------------|-------------------|
| `core` pure/`fs` (health derivation, `eventAltitude`, `resolveTarget`) | Real logic against real temp-dir fixtures | Nothing mocked except **`isMachineContext`/`isTTY`** (passed in as booleans — `resolveTarget` never probes `process`, per `00` §4.1) and `listActiveLoops` where enumeration is exercised |
| `cli` render (`follow`, sticky header) | Filter/altitude routing, header string, color degradation | TTY detection (`detectColorSupport`) and `process.env.NO_COLOR`; the event feed is fed from an in-memory `PersistedEvent[]` fixture, not a live watcher |
| cross-package (cli↔core) | The CLI passes the enriched `DerivedStatus`/`resolveTarget` result straight through | Real `core` — no core mock; only stdout capture |

**Pure functions get full branch coverage** because they are I/O-free and cheap
to exhaust (tech-spec §8 coverage target): `eventAltitude` (every event type),
`resolveTarget` (every `TargetErrorCode` + every success shape), health
derivation (`stuckWarning` true/false, fresh/stale, `null`).

---

## 3. Phase 1 — `health` + `statusSchemaVersion` (`02-health-status-contract.md`)

Appends to `packages/core/src/status.test.ts` and `schemas.test.ts`. Reuses the
existing `makePaths()`, `writeStateJson()`, `writeIterationStatusFile()`, and
`makeLoopState()` helpers already in `status.test.ts` (lines 50–148) — extend the
iteration-status writer to take `stuckWarning`/`lastActivityAt` overrides rather
than adding a parallel fixture.

### 3.1 Fixture extension

Generalize the existing `writeIterationStatusFile` helper so health cases can vary
`stuckWarning` and `lastActivityAt` independently:

```ts
// extend the existing helper in status.test.ts
function writeIterationStatusFile(
  opts: { updatedAt?: string; lastActivityAt?: string; stuckWarning?: boolean } = {},
): void {
  createRaufDir();
  const updatedAt = opts.updatedAt ?? new Date().toISOString();
  const filePath = path.join(tmpDir, DEFAULT_ROOT_DIR, "iteration-status.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        itemId: "003",
        startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        updatedAt,
        currentTool: "Edit",
        recentTools: ["Read", "Edit"],
        tokens: { input: 1000, output: 500 },
        lastActivityAt: opts.lastActivityAt ?? updatedAt,
        stuckWarning: opts.stuckWarning ?? false,
      },
      null,
      2,
    ) + "\n",
  );
}
```

> The existing callers pass a positional `updatedAt` string; migrating them to the
> options object is a mechanical edit and keeps one fixture builder (no drift).

### 3.2 Health-population tests

```ts
describe("deriveStatus — health block (REQ-CONTRACT-03/04)", () => {
  it("mirrors stuckWarning=true from iteration-status.json", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    writeIterationStatusFile({ stuckWarning: true });

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.health).not.toBeNull();
    expect(result.value.health?.stuckWarning).toBe(true);
  });

  it("mirrors stuckWarning=false", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    writeIterationStatusFile({ stuckWarning: false });

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.health?.stuckWarning).toBe(false);
  });

  it("returns health=null when iteration-status.json is absent", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    // no writeIterationStatusFile()
    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.health).toBeNull();
  });

  it("returns health=null (never an error) when iteration-status.json is unparseable", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    createRaufDir();
    fs.writeFileSync(
      path.join(tmpDir, DEFAULT_ROOT_DIR, "iteration-status.json"),
      "not json",
    );
    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true); // best-effort, non-fatal (00 §1.2, tech-spec §7)
    if (!result.ok) return;
    expect(result.value.health).toBeNull();
  });

  it("stamps statusSchemaVersion === '1' on every tier", () => {
    // Tier 1 (state.json)
    writeStateJson(makeLoopState());
    let r = deriveStatus(makePaths());
    expect(r.ok && r.value.statusSchemaVersion).toBe("1");

    // Tier 2 (log parsing) — fresh temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-status-"));
    writeLog("[2026-02-21 10:00:00] --- Iteration 1 / 10 ---\n");
    r = deriveStatus(makePaths());
    expect(r.ok && r.value.statusSchemaVersion).toBe("1");

    // Tier "none" — empty dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-status-"));
    createRaufDir();
    r = deriveStatus(makePaths());
    expect(r.ok && r.value.statusSchemaVersion).toBe("1");
  });
});
```

### 3.3 Freshness / age against a fixed relative clock

`iterationFresh` and `secondsSinceActivity` are asserted with `Date.now()`-relative
timestamps and a tolerance window — the repo's real technique (there is **no**
clock-injection seam; `status.test.ts` uses this exact pattern for `elapsed` and
staleness at lines 363–376, 269–333). See §4.3 for the rationale.

```ts
describe("deriveStatus — health freshness & age", () => {
  it("iterationFresh true when updatedAt is within ITERATION_STATUS_FRESH_MS (60s)", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    writeIterationStatusFile({ updatedAt: tenSecondsAgo, lastActivityAt: tenSecondsAgo });

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.health?.iterationFresh).toBe(true);
    // ~10s since activity, ±2s tolerance for test-execution wall time
    expect(result.value.health?.secondsSinceActivity).toBeGreaterThanOrEqual(9);
    expect(result.value.health?.secondsSinceActivity).toBeLessThanOrEqual(12);
  });

  it("iterationFresh false when updatedAt is older than 60s", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    const twoMinAgo = new Date(Date.now() - 120_000).toISOString();
    writeIterationStatusFile({ updatedAt: twoMinAgo, lastActivityAt: twoMinAgo });

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.health?.iterationFresh).toBe(false);
  });

  it("clamps secondsSinceActivity at 0 for a future lastActivityAt (clock skew)", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    const future = new Date(Date.now() + 30_000).toISOString();
    writeIterationStatusFile({ lastActivityAt: future });

    const result = deriveStatus(makePaths());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.health?.secondsSinceActivity).toBe(0); // 00 §1.1, nonnegative
  });
});
```

### 3.4 Read-spy — ≤1 `readIterationStatus` per `deriveStatus` (REQ-PERF-01, C-02) — LOAD-BEARING

`deriveStatus` must read `iteration-status.json` **at most once** per invocation
(tech-spec §3.1, §6 #1/#2; `00` §Constants). The classic mock-the-import approach
is awkward here because `deriveStatus` imports `readIterationStatus` from
`./iteration-status.js` at module scope; the robust, repo-friendly counter is an
**`fs.readFileSync` spy filtered to the `iteration-status.json` path** (tech-spec
§8 "assert via a read spy/counter"). This also transitively proves **no subprocess**
(C-02): a spawn would show up as zero file reads for a stall signal that is
nonetheless present.

```ts
import { vi } from "vitest";

describe("deriveStatus — I/O budget (REQ-PERF-01, C-02)", () => {
  it("reads iteration-status.json at most once per deriveStatus (healthy path)", () => {
    writeStateJson(makeLoopState({ status: "running" }));
    writeIterationStatusFile({ stuckWarning: false });

    const realRead = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      // delegate to the real reader; we only count.
      return (realRead as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.readFileSync);

    try {
      const result = deriveStatus(makePaths());
      expect(result.ok).toBe(true);

      const iterReads = spy.mock.calls.filter(([p]) =>
        String(p).endsWith(path.join(DEFAULT_ROOT_DIR, "iteration-status.json")),
      );
      // ≤1 — a single promoted shared read feeds BOTH freshness and health.
      expect(iterReads.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("also holds on the staleness-downgrade path (the old sole read site)", () => {
    const staleTime = new Date(Date.now() - STALENESS_THRESHOLD_MS - 60_000).toISOString();
    writeStateJson(makeLoopState({ status: "running", updatedAt: staleTime }));
    writeIterationStatusFile({ updatedAt: new Date().toISOString() }); // fresh iter → keeps RUNNING

    const realRead = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) =>
      (realRead as (...a: unknown[]) => unknown)(p, ...rest)) as typeof fs.readFileSync);
    try {
      deriveStatus(makePaths());
      const iterReads = spy.mock.calls.filter(([p]) =>
        String(p).endsWith(path.join(DEFAULT_ROOT_DIR, "iteration-status.json")),
      );
      expect(iterReads.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});
```

> **Implementation note the test enforces:** the shared-read promotion (tech-spec
> OTQ-1 / §3.1) must not leave `isLoopLive`'s old conditional read in place *in
> addition* to the new promoted read — that would make the count 2 on the
> staleness path and fail the second test. The two must be unified into one read.

### 3.5 Additive-compat — existing-shape parse still succeeds (REQ-CONTRACT-05, REQ-SUCCESS-05)

Appends to `packages/core/src/schemas.test.ts`. Proves the change is additive: an
object built to the **pre-feature shape** (no `health`, no `statusSchemaVersion`)
plus the two new fields still validates, and a consumer that ignores unknown
fields is unaffected. Mirrors the `00` §Verification checklist.

```ts
import { DerivedStatusSchema } from "./schemas.js";

describe("DerivedStatusSchema — additive compatibility (REQ-CONTRACT-05)", () => {
  const baseline = {
    statusSchemaVersion: "1",
    loopState: "RUNNING",
    stateSource: "state.json",
    iteration: 2,
    maxIterations: 10,
    currentItem: "003",
    lastSignal: "clean",
    startedAt: new Date().toISOString(),
    elapsed: 12,
    backlogSummary: { pending: 1, inProgress: 1, blocked: 0, needsHuman: 0, deferred: 0, done: 4, total: 6 },
    lock: { present: false, pid: null, startedAt: null, alive: false, stale: false },
  };

  it("accepts the object with health=null", () => {
    expect(DerivedStatusSchema.safeParse({ ...baseline, health: null }).success).toBe(true);
  });

  it("accepts the object with a populated health block", () => {
    const parsed = DerivedStatusSchema.safeParse({
      ...baseline,
      health: { stuckWarning: false, iterationFresh: true, lastActivityAt: baseline.startedAt, secondsSinceActivity: 3 },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a statusSchemaVersion other than '1'", () => {
    expect(DerivedStatusSchema.safeParse({ ...baseline, statusSchemaVersion: "2", health: null }).success).toBe(false);
  });

  it("an existing-shape consumer that reads only pre-feature fields is unaffected", () => {
    const enriched = { ...baseline, health: null };
    // A pre-feature consumer never referenced health/version — these still work.
    expect(enriched.loopState).toBe("RUNNING");
    expect(enriched.backlogSummary.done).toBe(4);
  });
});
```

---

## 4. Phase 2 — `resolveTarget()` + skill (`03-target-resolution.md`, `05-supervision-recipe.md`)

Appends to `packages/core/src/backlog-root.test.ts` (which already exercises
`resolveBacklogRoot` and containment, so the sandbox fixture pattern is present).
`resolveTarget` never probes `process` — `isMachineContext`/`isTTY` are passed in
(`00` §4.1), so no `process.stdout` stubbing is needed; the tests drive those
booleans directly. `listActiveLoops` is stubbed for the enumeration cases.

### 4.1 Machine context — missing target is a hard error (REQ-SCOPE-01)

```ts
import { resolveTarget } from "./backlog-root.js";

describe("resolveTarget — machine context strictness (REQ-SCOPE-01, REQ-SAFE-02)", () => {
  it("errors missing_target when no path and machine context", () => {
    const r = resolveTarget({ isMachineContext: true, isTTY: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("missing_target");
  });

  // REQ-SUCCESS-04 (P0): the missing-target path must be a HARD ERROR, never a
  // silent scan of the machine — assert no enumeration read occurs (03 §Verification
  // "no listActiveLoops / cwd read on that path, via a call spy").
  it("does not scan (listActiveLoops never called) on the missing_target path", () => {
    const spy = vi.spyOn(loopRegistry, "listActiveLoops");
    const r = resolveTarget({ isMachineContext: true, isTTY: false });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("errors ambiguous_target when several active roots in machine context", () => {
    // several live loops discovered but no explicit path → hard fail, never a scan
    const r = resolveTarget({ isMachineContext: true, isTTY: false /* + fixture of 2 active roots */ });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("ambiguous_target");
  });
});
```

### 4.2 Every `TargetErrorCode` variant is reachable

```ts
describe("resolveTarget — TargetError variants", () => {
  it.each([
    ["missing_target", { isMachineContext: true, isTTY: false }],
    ["not_found", { pathArg: "/does/not/exist", isMachineContext: false, isTTY: true }],
  ] as const)("returns %s", (code, opts) => {
    const r = resolveTarget(opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe(code);
  });
});
```

`ambiguous_target` (§4.1) and `outside_sandbox` (§4.4) are covered separately
because they need active-loop / escape fixtures. All four codes from `00` §4.3
are thereby reachable (`00` §Verification).

### 4.3 TTY convenience — cwd default, single vs. multiple

```ts
describe("resolveTarget — TTY resolution (REQ-SCOPE-02/03)", () => {
  it("defaults root to cwd on a TTY when no path given and one active root exists", () => {
    const r = resolveTarget({ isMachineContext: false, isTTY: true /* cwd == a live root */ });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("resolved");
  });

  it("returns kind:'ambiguous' with candidates when several active roots (TTY)", () => {
    const r = resolveTarget({ isMachineContext: false, isTTY: true /* 2 active roots fixture */ });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("ambiguous");
    if (r.value.kind !== "ambiguous") return;
    expect(r.value.candidates.length).toBeGreaterThan(1);
  });
});
```

> **Clock/enumeration injection note (the real repo pattern).** There is **no**
> clock-injection or `process`-probing seam in `core`, and this document does not
> invent one. Time-dependent behavior is tested with `Date.now()`-relative
> fixtures + a tolerance window (§3.3), and context-dependent behavior
> (`isMachineContext`/`isTTY`) is tested by passing the booleans in — exactly the
> shape `00` §4.1 defines. Active-root enumeration is driven by the temp-dir
> fixtures `scanActiveRoots`/`listActiveLoops` already read (see
> `status.test.ts` `scanActiveRoots` suite, lines 1350–1537), not by mocking the
> function, wherever a real fixture is cheap.

### 4.4 Sandbox containment rejects out-of-root (REQ-SAFE-01)

Mirrors the existing `events-log.test.ts` escape-path test (lines 66–75): a
`..`-escaping target must fail with the containment error, never touch the FS.

```ts
describe("resolveTarget — sandbox containment (REQ-SAFE-01)", () => {
  it("rejects a target that resolves outside ROOT_DIRECTORY / ~/.rauf", () => {
    const r = resolveTarget({ pathArg: path.join(tmpDir, "..", "escape"), isMachineContext: true, isTTY: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("outside_sandbox");
  });
});
```

### 4.5 Recipe executability — decision-tree inputs present on one poll (REQ-SUCCESS-01)

The rewritten `drive-rauf-loop` skill is **prose** (no unit test — tech-spec §8).
What we *can* and *must* assert is that a single `deriveStatus` poll carries every
input the recipe's four-way decision tree (`05-supervision-recipe.md`) reads — so
the recipe is executable "from one poll" with **zero raw-file reads** (keystone
REQ-SUCCESS-01). Appends to `status.test.ts`.

```ts
describe("deriveStatus — single-poll decision completeness (REQ-SUCCESS-01)", () => {
  it("carries loopState, health, lock, and backlogSummary.needsHuman in one object", () => {
    writeBacklog(makeBacklog([
      makeItem({ id: "001", status: "blocked", blockedReason: "need key", needsHuman: true }),
    ]));
    writeStateJson(makeLoopState({ status: "running" }));
    writeIterationStatusFile({ stuckWarning: true });
    writeLock(process.pid);

    const r = deriveStatus(makePaths());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value;
    // Every branch input of the 05-supervision-recipe decision tree, from ONE poll:
    expect(s.loopState).toBeDefined();                    // done / healthy
    expect(s.lastSignal !== undefined).toBe(true);        // needs-human
    expect(s.backlogSummary.needsHuman).toBe(1);          // needs-human
    expect(s.health?.stuckWarning).toBe(true);            // recoverable-stall
    expect(s.lock?.stale).toBeDefined();                  // reset-on-dead-lock rung
  });
});
```

### 4.6 `--all` broadening + machine-wide front door (REQ-SCOPE-03/04, REQ-SUCCESS-03b)

The P0 criterion REQ-SUCCESS-03(b) — "see **every** live loop on the machine" —
and the bare-`status` cwd→`--all` broadening (`03-target-resolution.md` §5–§6) get
concrete CLI tests. Appends to `packages/cli/src/status-commands.test.ts`; uses the
temp-dir active-root fixtures (`registerLoop`/`listActiveLoops`) the existing
`--all` suite already relies on. stdout is captured to assert the JSON *shape*.

```ts
describe("status — cwd→--all broadening (REQ-SCOPE-03)", () => {
  it("broadens to the --all view when the cwd has no live loop but loops exist elsewhere", async () => {
    // fixture: cwd backlog idle; a second root live elsewhere (registerLoop)
    const out = await captureStdout(() => handleStatus({ /* bare, TTY */ }));
    expect(out).toContain(/* the other live root's id / the machine-wide listing */);
  });

  it("does NOT broaden when the cwd has a live loop", async () => {
    // fixture: cwd backlog live
    const spy = vi.spyOn(statusCommands, "handleStatusAll");
    await handleStatus({ /* bare, TTY */ });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("status --all --json — front door is a loop list, not a DerivedStatus (REQ-SCOPE-04)", () => {
  it("emits { loops: ActiveLoopEntry[] }, never a single-loop DerivedStatus", async () => {
    // fixture: >=1 live root registered
    const out = await captureStdout(() => handleStatusAll({ json: true }));
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed.loops)).toBe(true);
    // it is human/tooling scope — NOT the single-loop agent contract:
    expect(parsed.statusSchemaVersion).toBeUndefined();
    expect(parsed.loopState).toBeUndefined();
  });
});
```

> `--all --json` is explicitly **human/tooling** scope, not the single-loop agent
> contract (`03` §6): the absence of `statusSchemaVersion`/`loopState` at the top
> level is the assertion that guards that boundary.

---

## 5. Phase 3 — `eventAltitude()` + `follow` (`04-event-altitude-follow.md`)

### 5.1 EXHAUSTIVE altitude table (all 24 types) — LOAD-BEARING

Appends to `packages/core/src/events-log.test.ts`, reusing its `event(seq, overrides)`
factory (line 27) to stamp each type. Every one of the 24 `LoopEvent` types
(confirmed at `schemas.ts:445–586`) has a pinned expected altitude; the table is
the executable form of the classification in tech-spec §3.3 and `04` §2.

```ts
import { eventAltitude, type EventAltitude } from "./events-log.js";
import type { PersistedEvent } from "./schemas.js";

const ALTITUDE: Record<string, EventAltitude> = {
  // item (default feed) — 19 types
  loop_started: "item", item_selected: "item", item_completed: "item",
  item_blocked: "item", item_retried: "item", needs_human: "item",
  signal_parsed: "item", loop_paused: "item", review_started: "item",
  review_completed: "item", review_failed: "item", loop_completed: "item",
  loop_error: "item", loop_cancelled: "item", usage_limit_hit: "item",
  usage_limit_cleared: "item", sleep_start: "item", sleep_end: "item",
  llm_stuck_warning: "item",
  // firehose (--verbose only) — 5 types
  iteration_start: "firehose", llm_spawned: "firehose", llm_exited: "firehose",
  llm_tool_activity: "firehose", llm_token_update: "firehose",
};

describe("eventAltitude — exhaustive 24-type table (REQ-CMD-02)", () => {
  it("classifies all 24 event types exactly as specified", () => {
    expect(Object.keys(ALTITUDE)).toHaveLength(24);
    for (const [type, expected] of Object.entries(ALTITUDE)) {
      const ev = { ...event(0), type } as unknown as PersistedEvent;
      expect(eventAltitude(ev), `altitude for ${type}`).toBe(expected);
    }
  });

  // Runtime fallback branch (04 §2.3): an unrecognized type must default to
  // "firehose" (visible under --verbose, never silently dropped) and never throw.
  // This exercises the runtime default branch that the compile-time `never` guard
  // cannot — closing the "full branch coverage" claim in §7.
  it("defaults an unknown runtime type to 'firehose' without throwing", () => {
    const ev = { ...event(0), type: "made_up_future_type" } as unknown as PersistedEvent;
    expect(() => eventAltitude(ev)).not.toThrow();
    expect(eventAltitude(ev)).toBe("firehose");
  });
});
```

> **Compile-time exhaustiveness (a *typecheck* guard, not a runtime test).** `04`
> §2 specifies `eventAltitude` end with a `never`-typed default branch over the
> discriminated union. Adding a 25th `LoopEvent` type without classifying it makes
> that assignment fail `pnpm typecheck` — so the "future unclassified type fails
> typecheck" guarantee (tech-spec §8) is enforced by the **gate's typecheck step**,
> which is why the exhaustiveness lives in the source, and the table above is its
> runtime companion. To document the intent for maintainers, include a
> type-level assertion in the test file:
>
> ```ts
> // If a new LoopEvent type is added, this line stops compiling until ALTITUDE
> // gains the key — a belt-and-braces reminder alongside the source `never` guard.
> const _exhaustive: Record<PersistedEvent["type"], EventAltitude> = ALTITUDE;
> void _exhaustive;
> ```

### 5.2 `follow` output routing — JSON/verbose emit everything; default item-only (REQ-CMD-03)

Appends to `packages/cli/src/follow-command.test.ts`. The event feed is fed from an
in-memory `PersistedEvent[]` mixing both altitudes; assertions are on what reaches
stdout for each mode. `--json` and `--verbose` MUST emit **every** event; the
default emits only `item`-altitude events. The altitude filter must never touch
JSON (REQ-CMD-03, REQ-COMPAT-01).

```ts
describe("follow — output altitude routing (REQ-CMD-03)", () => {
  const feed: PersistedEvent[] = [
    { ...event(0), type: "item_selected" } as PersistedEvent,      // item
    { ...event(1), type: "llm_token_update" } as PersistedEvent,   // firehose
    { ...event(2), type: "item_completed" } as PersistedEvent,     // item
  ];

  it("--json emits every event untouched by the altitude filter", () => {
    const out = renderFollow(feed, { json: true });
    expect(out.map((e) => e.type)).toEqual(["item_selected", "llm_token_update", "item_completed"]);
  });

  it("--verbose emits every event (full firehose)", () => {
    const lines = renderFollow(feed, { verbose: true });
    expect(lines).toHaveLength(3);
  });

  it("default emits only item-altitude events", () => {
    const lines = renderFollow(feed, {}); // TTY default
    expect(lines).toHaveLength(2); // token_update filtered out
  });
});
```

> `renderFollow` here names whatever seam `handleFollow` exposes for rendering a
> known event list (a thin extraction so the filter is testable without a live
> `watchEvents`). If `handleFollow` cannot be exercised without the watcher, the
> equivalent assertion is made directly on `eventAltitude` + a stdout-capture
> integration test (§6). **WARNING:** confirm the exact render seam in
> `follow-command.ts` when implementing — `04-event-altitude-follow.md` owns that
> boundary; if no pure render seam exists, extract one as part of Phase 3.

### 5.3 Sticky header string from a fixture `DerivedStatus`

Appends to `packages/cli/src/event-format.test.ts`. The header is derived purely
from a `DerivedStatus` (`backlogSummary` + `currentItem`), so it is unit-testable
with a literal fixture — no FS.

```ts
describe("sticky progress header (REQ-CMD-05)", () => {
  it("renders '4/12 done · 1 blocked · on auth-007' from DerivedStatus", () => {
    const status = {
      statusSchemaVersion: "1", loopState: "RUNNING",
      currentItem: "auth-007",
      backlogSummary: { done: 4, total: 12, blocked: 1, needsHuman: 0, deferred: 0, pending: 7, inProgress: 1 },
      // …remaining DerivedStatus fields…
    } as unknown as DerivedStatus;
    expect(renderStickyHeader(status, { color: true })).toContain("4/12 done");
    expect(renderStickyHeader(status, { color: true })).toContain("1 blocked");
    expect(renderStickyHeader(status, { color: true })).toContain("on auth-007");
  });

  // Segment elision (04 §Verification): the `blocked` and `on` segments drop out
  // when blocked === 0 / currentItem === null — a distinct render branch, so §7's
  // full-branch-coverage claim requires it be exercised.
  it("elides the 'blocked' and 'on' segments when blocked===0 and currentItem===null", () => {
    const status = {
      statusSchemaVersion: "1", loopState: "RUNNING",
      currentItem: null,
      backlogSummary: { done: 4, total: 12, blocked: 0, needsHuman: 0, deferred: 0, pending: 8, inProgress: 0 },
      // …remaining DerivedStatus fields…
    } as unknown as DerivedStatus;
    const line = renderStickyHeader(status, { color: true });
    expect(line).toContain("4/12 done");
    expect(line).not.toContain("blocked");
    expect(line).not.toContain("on ");
  });
});
```

### 5.4 A11Y — color-free, label-based degradation (REQ-A11Y-01)

State (blocked / needs-human / healthy) must be conveyed by **text label**, never
color alone, on a non-TTY / `NO_COLOR` / narrow terminal. Reuses
`detectColorSupport()` (`formatter.ts:33`).

```ts
describe("sticky header A11Y (REQ-A11Y-01)", () => {
  it("emits no ANSI escapes and a text state label when NO_COLOR is set", () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const status = { /* needsHuman: 1 fixture */ } as unknown as DerivedStatus;
      const line = renderStickyHeader(status, { color: false });
      // eslint-disable-next-line no-control-regex
      expect(line).not.toMatch(/\[/);          // no ANSI color codes
      expect(line.toLowerCase()).toContain("needs human"); // state by label, not color
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });
});
```

---

## 6. Integration approach (cli↔core)

The pure-function suites above cover the bulk of behavior; a thin integration
layer confirms the CLI passes core's enriched output through **unchanged**
(REQ-COMPAT-01, the prime directive):

- **`status --json` passthrough** (`status-commands.test.ts`): run the handler
  against a temp-dir fixture with a live `iteration-status.json`, capture stdout,
  `JSON.parse` it, and assert `statusSchemaVersion === "1"` and a populated
  `health` block are present — proving `outputJson` adds no version logic and
  strips nothing (`01` §5 #13). This is the end-to-end proof of the keystone.
- **Missing-target `--json` error path** (`status-commands.test.ts`): a machine
  context with no path prints `outputJson({ error })` and exits `USAGE(2)` — the
  gap `03-target-resolution.md` §4 closes.
- **`follow` default vs. `--verbose`** stdout capture: assert a firehose event
  (`llm_token_update`) is absent by default and present under `--verbose`, and
  that `--json` output line-parses to every event.

Integration tests use the same `mkdtempSync` temp-dir fixtures and stdout capture
already used across `cli/src/*.test.ts`; no `core` module is mocked.

---

## 7. Coverage targets & per-phase gate

- **Parity with existing suites (tech-spec §8):** the new suites match the
  breadth of `status.test.ts` / `events-log.test.ts` — every state/branch of the
  new logic has a case.
- **Full branch coverage on the new pure functions** (I/O-free, cheap to
  exhaust): `eventAltitude` (all 24 types, §5.1), `resolveTarget` (all four
  `TargetErrorCode` + both success shapes, §4), health derivation (`stuckWarning`
  true/false, fresh/stale, future-skew clamp, `null` on absent/unparseable, §3).
- **Each phase independently green under `pnpm gate` (REQ-GATE-01, REQ-SUCCESS-05):**
  a phase is not "done" until the full gate passes at its branch tip —
  `schema:check` reconciled (Phase 1), `version:check` unbumped, typecheck (which
  enforces the `eventAltitude` exhaustiveness `never` guard), lint, format, test.

---

## 8. Test fixtures & factories

All fixtures live **inline in the colocated test file**, built by helper
factories — matching the repo's actual pattern (no shared `fixtures/` dir today).

| Fixture / factory | Home | Source pattern reused |
|-------------------|------|-----------------------|
| `writeIterationStatusFile({ updatedAt, lastActivityAt, stuckWarning })` | `status.test.ts` | extend existing helper (§3.1) |
| `makeLoopState`, `makeBacklog`, `makeItem`, `writeStateJson`, `writeBacklog`, `writeLog`, `writeLock`, `makePaths` | `status.test.ts` | reused as-is (lines 50–174) |
| `event(seq, overrides)` — minimal `PersistedEvent` | `events-log.test.ts` | reused as-is (line 27) for the altitude table + `follow` feed |
| `baseline` `DerivedStatus` literal | `schemas.test.ts` | new inline (§3.5) — the additive-compat anchor |
| in-memory `PersistedEvent[]` mixed-altitude feed | `follow-command.test.ts` | built from `event()` (§5.2) |
| `DerivedStatus` header fixture (`4/12 done · 1 blocked · on auth-007`) | `event-format.test.ts` | new inline literal (§5.3) |
| active-root enumeration fixtures | `backlog-root.test.ts` | temp-dir `.rauf/state.json` trees, as `scanActiveRoots` suite already builds |

---

## Test file location conventions

- Colocated `*.test.ts` next to source; **no** separate test tree, **no** new test
  files (append to the module's existing suite — §1 table).
- Vitest `describe`/`it`/`expect`; temp dirs via `fs.mkdtempSync` in `beforeEach`,
  cleaned in `afterEach` (`fs.rmSync(..., { recursive: true, force: true })`).
- `Result` assertions use the repo idiom
  `expect(result.ok).toBe(true); if (!result.ok) return;`.
- Time is `Date.now()`-relative with a tolerance window — **never** an absolute or
  injected clock (§3.3, §4.3).

---

## Dependencies

- **Depends on all of `00`–`05`.** This document verifies their Verification
  checklists:
  - `00-core-definitions.md` — the schemas/types the additive-compat and variant
    tests assert against (`HealthSchema`, `DerivedStatusSchema`, `EventAltitude`,
    `TargetError*`).
  - `02-health-status-contract.md` — health derivation, read-spy, version stamp
    (§3).
  - `03-target-resolution.md` — `resolveTarget` variants + sandbox (§4).
  - `04-event-altitude-follow.md` — altitude table, `follow` routing, header,
    A11Y (§5); owns the render seam named in §5.2.
  - `05-supervision-recipe.md` — the decision-tree inputs asserted present in §4.5
    (the skill itself is prose, untested).
- **No new external dependency** (tech-spec §9); Vitest only.

## Verification

- [ ] `pnpm gate` is green at the tip of **each** phase branch (REQ-GATE-01,
      REQ-SUCCESS-05) — including `schema:check` (Phase 1) and `version:check`.
- [ ] The read-spy test (§3.4) asserts **≤1** `iteration-status.json` read per
      `deriveStatus` on both the healthy and staleness-downgrade paths
      (REQ-PERF-01) — and fails if the old `isLoopLive` read is not unified into
      the promoted shared read.
- [ ] The 24-type altitude table (§5.1) enumerates exactly 24 keys and passes;
      the source `never` guard makes an unclassified 25th type fail `pnpm
      typecheck` (tech-spec §8).
- [ ] The additive-compat suite (§3.5) confirms an enriched object still parses
      and a pre-feature consumer is unaffected (REQ-CONTRACT-05).
- [ ] All four `TargetErrorCode` variants are reachable via `resolveTarget` tests
      (§4.1, §4.2, §4.4); the out-of-root case returns `outside_sandbox`
      (REQ-SAFE-01).
- [ ] `follow --json` and `--verbose` emit every event; default emits only
      item-altitude events (§5.2, REQ-CMD-03).
- [ ] The `NO_COLOR` header path (§5.4) emits no ANSI codes and a text state label
      (REQ-A11Y-01).
- [ ] A single `deriveStatus` poll carries `loopState`, `health`, `lock`, and
      `backlogSummary.needsHuman` (§4.5, REQ-SUCCESS-01).
