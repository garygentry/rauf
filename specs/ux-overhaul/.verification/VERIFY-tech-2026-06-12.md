# Verification Report: ux-overhaul (tech)
Date: 2026-06-12
Pipeline Stage: forge-2-tech (complete) → forge-verify-tech
Artifacts Reviewed: specs/ux-overhaul/PRD.md, specs/ux-overhaul/tech-spec.md, specs/ux-overhaul/CANON.md (background context only)

## Summary
- Total findings: 10
- Gaps: 4
- Inconsistencies: 1
- Improvements: 2
- Errors: 3

**Check tally: Executed 17 of 17 checks — 11 pass, 4 fail, 2 n/a.**
CHECK-T01 pass · T02 pass · T03 pass · T04 pass · **T05 fail** · T06 pass · T07 pass · **T08 fail** · T09 pass · **T10 fail** · T11 pass · T12 pass · T13 pass · T14 n/a · T15 n/a · **T16 fail** · **T17 fail**
(T14 config and T15 migration are correctly n/a: §9 states no new external packages; the change is additive with no config surface, and REQ-COMPAT-01/02 require no migration.)

Overall: the tech-spec's integration claims are unusually well-grounded — the great majority of named symbols and line numbers were verified accurate against real source. The substantive findings are V-001/V-002 (two factual code-level errors that would make copy-pasted spec code fail to compile), V-003 (wrong rationale for a constant), and V-004/V-005/V-006 (under-specified failure/growth/watch behavior). All findings are correctable as documentation edits to `tech-spec.md`.

## Findings

### V-001: `ErrorCodes.IO_ERROR` does not exist — fabricated error code in core primitives
- **Severity:** error
- **Location:** tech-spec.md §3.2 (the `appendLine` and `readNdjson` code blocks, ~lines 171 and 184)
- **Issue:** Both new `fs-utils.ts` primitives return `err({ code: ErrorCodes.IO_ERROR, … })`. The actual `ErrorCodes` enum in `packages/core/src/errors.ts:21-33` has **no `IO_ERROR` member**. Its members are: `FILE_NOT_FOUND`, `INVALID_JSON`, `VALIDATION_ERROR`, `PATH_VIOLATION`, `ALREADY_INSTALLED`, `NOT_INSTALLED`, `CONFLICT`, `TRANSITION_INVALID`, `LOCK_CONFLICT`. A fresh agent copying §3.2 verbatim hits a TypeScript error (`ErrorCode` is a closed `as const` union). This propagates: §7 "Error Handling" leans on these returns.
- **Suggested fix:** Either (a) add `IO_ERROR: "IO_ERROR"` to `ErrorCodes` in `errors.ts` and state that as a required change in §2's core-additions table and §8 (it is a new public error code), or (b) reuse an existing code (`FILE_NOT_FOUND` has wrong semantics for append/read failure — prefer adding `IO_ERROR`). Update §3.2, §5.1, §7 to reference whichever is chosen, and add the enum addition to the module-structure table for `errors.ts`.
- **References:** packages/core/src/errors.ts:21-33; tech-spec §3.2, §5.1, §7
- **Checklist:** CHECK-T05, CHECK-T08

### V-002: `checkLockFile` / `LockSummary` claim conflates two unrelated existing symbols
- **Severity:** error
- **Location:** tech-spec.md §3.5 (~lines 313-317), §5.1 (~line 474: `checkLockFile(lockPath: string): LockSummary; // extracted; checkLock delegates to it`)
- **Issue:** The spec says it will "extract `checkLockFile(lockPath: string): LockSummary` from the current `checkLock(paths)`" and that "existing `checkLock` delegates to it." Two factual errors: (1) the current `checkLock(paths: BacklogPaths)` returns **`Result<LockStatus>`** (`LockStatus` interface at `lock.ts:39`), not `LockSummary`. (2) `LockSummary` **is** a real type — but it is an unrelated status-display Zod schema (`schemas.ts:258`, type at `:650`) produced by `computeLockSummary(paths)` in `status.ts:86`; it has nothing to do with `lock.ts`. Naming the extracted function's return `LockSummary` will collide with / be confused with the existing `LockSummary`, and the implementer will not find a `LockSummary` in `lock.ts` to delegate to. The reconciliation logic the spec actually needs (PID liveness + `/proc/<pid>/stat` recycle guard) lives in the **private** helpers `isProcessAlive`/`isProcessRecycled` (`lock.ts:56-116`), consumed by `checkLock` — those are what must be refactored to accept a raw `lockPath`.
- **Suggested fix:** Rename the extracted helper's return type to avoid the `LockSummary` collision (e.g. `checkLockFile(lockPath: string): Result<LockStatus>`, or a new small `LockLiveness` type). State precisely what is extracted: the body of `checkLock` that reads the lock file + runs `isProcessAlive`/`isProcessRecycled`, parameterized on `lockPath` instead of `BacklogPaths`. Update §3.5 and §5.1. Note that `LockStatus` (not `LockSummary`) is the existing return shape.
- **References:** packages/core/src/lock.ts:39,56-116,198; packages/core/src/schemas.ts:258,650; packages/core/src/status.ts:86; tech-spec §3.5, §5.1
- **Checklist:** CHECK-T05, CHECK-T06, CHECK-T08

### V-003: D3 coalescing justification is factually wrong — existing throttle is 5s, not ~1/sec
- **Severity:** error
- **Location:** tech-spec.md §1 D3 (line 32) and §3.1 (~line 131, `TOKEN_COALESCE_MS`, ~line 156)
- **Issue:** D3 states the 1-second token coalescing "mirrors the existing `iteration-status.json` throttle." The existing throttle in `runner.ts:70` is **`TOKEN_EVENT_THROTTLE_MS = 5_000`** (5 seconds), gating `writeIterationStatus`. So the chosen `TOKEN_COALESCE_MS = 1000` does **not** mirror it — it is 5× more frequent. The value itself is fine (REQ-EVT-02 requires "≈ ≤ 1/sec", and 1000ms satisfies that), but the stated rationale is incorrect, and there is an unflagged consequence: `events.ndjson` will carry **more** `llm_token_update` records than `iteration-status.json` reflects, so the two telemetry surfaces won't be in lockstep (a reader correlating them sees extra token lines).
- **Suggested fix:** Correct D3's rationale: drop "mirrors the existing iteration-status.json throttle" (or change to "is independent of, and finer-grained than, the existing 5s `TOKEN_EVENT_THROTTLE_MS` used for `iteration-status.json`"). Add a one-line note that the two coalescing rates are intentionally different and acceptable since each surface is independent. Consider whether reusing `TOKEN_EVENT_THROTTLE_MS` (5s) would better satisfy "bounded file size" — if 1s is deliberate, say why.
- **References:** packages/loop/src/runner.ts:70; tech-spec §1 D3, §3.1; PRD REQ-EVT-02
- **Checklist:** CHECK-T05, CHECK-T10, CHECK-T17

### V-004: Error-handling strategy under-specifies concurrent-writer and torn-write semantics
- **Severity:** gap
- **Location:** tech-spec.md §7 (Error Handling) and §3.2 (`appendLine`)
- **Issue:** The spec leans entirely on "best-effort try/catch" + "single writer per root" + "torn trailing line tolerated on read." Three failure modes are not fully defined: (1) **Torn write on append.** `appendLine` uses `fs.appendFileSync(filePath, line + "\n")`. A crash mid-append (or non-atomic append for a line > PIPE_BUF) can leave a partial line — but the single-writer invariant makes a partial line only ever trailing, which §3.2 relies on implicitly. This load-bearing reasoning ("partial line is always trailing because single writer") is never stated as the correctness argument, yet it is the whole basis for `readNdjson` tolerance being sufficient. (2) **`fs.appendFileSync` failure mid-run** (disk full, permission change): swallowed silently — the spec says "best-effort" but never says the loop should *surface* persistent persistence failure anywhere. A loop whose event log silently stopped writing is invisible. (3) **Web reader vs runner writer concurrency:** §3.9 has the web tail `events.ndjson` while the runner appends; `readNdjson` reads the whole file with `fs.readFileSync` — for a large active log this races a concurrent append (the torn-line tolerance covers the trailing line, the only at-risk line, so this is OK — but it isn't stated).
- **Suggested fix:** Add to §7: (a) an explicit invariant — "because there is exactly one writer per root and appends are whole-line, any malformed line can only be the trailing line; `readNdjson`'s skip-trailing-bad-line tolerance is therefore sufficient." (b) Decide and document whether *persistent* append failure (N consecutive failures) is surfaced anywhere (e.g. a single `appendLog` line to `rauf.log` on first failure), or explicitly state "intentionally fully silent — log writability is never user-visible" with rationale. (c) Note the web-reader-vs-writer concurrency is safe for the same trailing-line reason.
- **References:** tech-spec §3.2, §3.9, §7; PRD REQ-REL-01/02, REQ-PERF-01, REQ-OBSV-01
- **Checklist:** CHECK-T10, CHECK-T16

### V-005: events.ndjson rotation only at `start()` — unbounded growth within a long run is not addressed
- **Severity:** gap
- **Location:** tech-spec.md §1 D4 (line 33), §3.3 (`rotateEventsLog`), §10 (Open Technical Questions)
- **Issue:** The file is rotated **only at `runner.start()`** (D4). Within a single long-running loop (many iterations, hours of `llm_tool_activity` + 1/sec token updates), `events.ndjson` grows without bound — there is no in-run size cap, rotation, or truncation. `readEvents`/the web `/loop/events` history-replay do `fs.readFileSync` of the **entire** file (§3.2 `readNdjson`), so attach/replay cost and memory grow linearly with run length; a `follow` attaching late on a long run reads and parses the whole accumulated log. The PRD sets no size SLA, but CHECK-T17 (scalability/data growth) is squarely implicated and the spec is silent. Coalescing tokens to 1/sec bounds the *rate* but not the *total* for a long run.
- **Suggested fix:** Add a short "Scalability / growth" note to §3.3 or §10 acknowledging unbounded per-run growth and stating the accepted bound (e.g. "a single run's event volume is bounded in practice by maxIterations × per-iteration event count; at ~1/sec token coalescing a multi-hour run is on the order of MBs — acceptable for Phase 1; in-run rotation deferred"). If replay cost matters, note that `readEvents` could read from a byte offset / tail-N for `follow` replay rather than the whole file. At minimum, make the deferral explicit.
- **References:** tech-spec §3.2, §3.3, §3.6, §3.9; PRD REQ-OBS-04, REQ-PERF-02
- **Checklist:** CHECK-T17, CHECK-T16

### V-006: `watchEvents`/`fs.watch`-tail reliability and the seq-gap-means-corruption invariant are under-specified
- **Severity:** gap
- **Location:** tech-spec.md §3.1 (~line 152 "seq gap means corruption"), §3.3 (`watchEvents`), §10 TQ-3
- **Issue:** Two coupled robustness concerns: (1) **`fs.watch` is unreliable** (misses events under rapid writes, fires spuriously, varies across platforms/editors). TQ-3 proposes "re-read from last byte offset on change, debounced," but a missed `fs.watch` event means newly-appended records are never delivered until the next change fires — the `--interval` poll fallback is described only as "when fs.watch is unavailable," not as a safety net for *missed* events when it *is* available. (2) **The "seq gap ⇒ corruption/torn write" invariant (§3.1) is fragile.** `seq` is dense only for *persisted* records (coalesced token updates get no seq — correct). But the byte-offset tail in TQ-3, if it ever re-reads from a slightly-wrong offset or observes the writer's append mid-line, could surface an apparent gap that is actually a torn read — yet §3.1 tells readers a gap "means corruption." A reader acting on that (e.g. surfacing "corrupted log") could false-alarm on a normal concurrent read.
- **Suggested fix:** In §3.3/TQ-3, specify that the `--interval` poll is also a periodic *reconciliation* safety-net against missed `fs.watch` events (not only a fallback for absence), or that `watchEvents` always re-reads from last offset to EOF on each fire so a single missed fire self-corrects on the next. Soften §3.1: a `seq` gap observed by a *live tailing* reader should be "possibly torn/incomplete; re-read" rather than definitively "corruption"; reserve the corruption interpretation for a fully-quiesced file (no live writer). Define `watchEvents`'s debounce/offset behavior concretely enough to test (add a missed-fire/offset test to §8).
- **References:** tech-spec §3.1, §3.3, §10 TQ-3; packages/core/src/status.ts:410 (`watchLog`); PRD REQ-PERF-02, REQ-REL-01
- **Checklist:** CHECK-T16, CHECK-T17

### V-007: Web frontend has no tests today and the spec adds `<EventTimeline>` without a verification approach for it
- **Severity:** gap
- **Location:** tech-spec.md §8 (Testing Approach, "Web tests"), §3.9 / §6.3 (`<EventTimeline>`)
- **Issue:** The spec adds a **new frontend React component** `<EventTimeline>` (§3.9, §6.3) consuming `EventSource('/loop/events')`. The "Web tests" subsection in §8 covers only **backend** route tests (`routes/loop.test.ts`). There is no test or even a manual-verification checklist item for the new frontend component, and the testing strategy never acknowledges that the web client has no test harness — so the new UI is effectively unverified. SC-1 (headline) explicitly requires the **web status page** to show parity; the spec verifies that only at the backend route level, leaving the rendered timeline untested. This is an honest strategy *gap*.
- **Suggested fix:** Add an explicit statement to §8: "The web client has no automated test harness today; `<EventTimeline>` parity is verified (a) at the API boundary via `routes/loop.test.ts` and (b) manually against SC-1 (foreground `loop run` → web status page shows the timeline)." If automated coverage is desired, name the approach (e.g. a thin EventSource→render test). Add the manual SC-1 web check to the testing checklist so it is not dropped.
- **References:** tech-spec §3.9, §6.3, §8; PRD SC-1, REQ-WEB-01
- **Checklist:** CHECK-T11, CHECK-T16

### V-008: `watchEvents` return shape diverges from the `watchLog` pattern it claims to mirror
- **Severity:** inconsistency
- **Location:** tech-spec.md §3.3 (~line 227) and §5.1 (~line 460): `watchEvents(...): { close: () => void }`
- **Issue:** §3.3 says `watchEvents` "Mirrors `status.ts:watchLog`," and §6.2 reaffirms `watchLog` "is the pattern that `watchEvents` mirrors." But the actual `watchLog(paths, callback): () => void` (`status.ts:410`) returns a **bare cleanup function**, whereas the spec's `watchEvents` returns **`{ close: () => void }`** (an object with a `close` method). These are different contracts; "mirrors" is misleading and the two unsubscribe idioms will coexist confusingly in callers (the `follow` command and web each consume one or the other).
- **Suggested fix:** Pick one convention. Either change `watchEvents` to return `() => void` to genuinely mirror `watchLog`, or keep `{ close }` and remove the "mirrors `watchLog`" claim (state instead "uses `fs.watch` like `watchLog`, but returns a `{ close }` handle"). Align §3.3, §5.1, §6.2.
- **References:** tech-spec §3.3, §5.1, §6.2; packages/core/src/status.ts:410
- **Checklist:** CHECK-T05, CHECK-T06

### V-009: `z.intersection` over a `discriminatedUnion` is novel for this codebase and presented as trivial
- **Severity:** improvement
- **Location:** tech-spec.md §3.4 (~lines 242-251, `PersistedEventSchema`)
- **Issue:** `PersistedEventSchema = z.intersection(LoopEventSchema, z.object({ seq, schemaVersion }))` where `LoopEventSchema` is a `z.discriminatedUnion` (`schemas.ts:574`). There are **no existing `z.intersection` uses** in `schemas.ts` (zod `^3.24.0`). In zod 3, intersecting a discriminated union with an object works for parsing but **forfeits the discriminated-union fast path/error quality** (the intersection deep-merges results of running both schemas), and inferred-type ergonomics for a 24-member union via `z.infer<ZodIntersection<...>>` are heavier than the spec implies. It is functional, but presenting it as zero-risk ("at zero cost") understates a real papercut, and the `readNdjson<T>(…, schema)` path `safeParse`s every line against this intersection on every read.
- **Suggested fix:** Add a one-line note in §3.4 acknowledging this is the codebase's first `z.intersection` and that an alternative — extending each of the 24 member schemas with `.merge(EnvelopeSchema)` and re-forming the discriminatedUnion, or `LoopEventSchema.and(EnvelopeSchema)` — was considered; state why intersection was chosen (less boilerplate) and confirm `safeParse` performance on the read path is acceptable. This satisfies CHECK-T09 (alternatives) for this decision.
- **References:** tech-spec §3.2, §3.4; packages/core/src/schemas.ts:574; packages/core/package.json (zod ^3.24.0)
- **Checklist:** CHECK-T05, CHECK-T09, CHECK-T17

### V-010: Minor line-number drift in named integration points
- **Severity:** improvement
- **Location:** tech-spec.md §6.1 (~line 508), §3.11 item 3 (~line 396), §8 (~line 608)
- **Issue:** Three small inaccuracies that could send a fresh implementer to the wrong line: (1) §6.1 says `LoopRunner.start()` is at `runner.ts:~200`; it is actually at **`runner.ts:139`**. (2) §3.11 item 3 cites `.rauf/RAUF.md.tmpl:31` for the "Commit with:" line; it is actually at **line 32**. (3) §8 cites `loop-commands.test.ts:99` for the subcommand assertion; it is at **line 100**. All other line references checked (emitEvent:1135, writeState, git-commit 18-27, embedded-artifacts 42/364/423, CLAUDE_ADDON:21, GREENFIELD:47, loop.ts 101/233, LogPanel:321, handleLoopWatch:1387, handleLoopFollow:675, followDirectMode:588, schemas LoopEventSchema:574/IterationStatusSchema:618, deriveStatus:357, watchLog:410, resolveBacklogPaths:126) are accurate within ±2.
- **Suggested fix:** Correct the three line numbers: §6.1 `start()` → `runner.ts:139`; §3.11 item 3 → `RAUF.md.tmpl:32`; §8 → `loop-commands.test.ts:100`. Cosmetic, but the spec's value is its line-level precision, so fix them.
- **References:** packages/loop/src/runner.ts:139; artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl:32; packages/cli/src/loop-commands.test.ts:100
- **Checklist:** CHECK-T05, CHECK-T08

## Things Checked and Found Clean (honest negatives)

- **CHECK-T01/T02/T03 (traceability):** Strong. Every decision D1–D9 carries a PRD ref; the §3 subsections each cite REQ IDs; §10 maps all six OQs to decisions; §6.4 correctly defers contract/exit-code work to Phase 3 and §6.5 honors C-5 self-hosting (`rauf-stable`, dist-not-src). No decision contradicts a PRD constraint. All P0 REQs trace to a §3 decision. No Phase 2/3/4 work was smuggled in (boundary held in D8, §3.7, §3.9, §3.11 "out of scope"). The "24 events" count is **correct** (verified against `LoopEventSchema`'s 24-member union) — this corrects the PRD's own "26" error; the tech-spec uses the right number.
- **CHECK-T12 (data model):** `PersistedEvent`, `ActiveLoopEntry`, `BacklogPaths.eventsLog` align with PRD data requirements (REQ-EVT-03/04, REQ-DISC-03); the on-disk layout in §4 is accurate to the real `.rauf/` contents.
- **CHECK-T13 (module structure / exports map):** §2 + §5.1 give a complete per-file exports map; all referenced existing files exist.
- **CHECK-T14 / T15 (n/a):** §9 correctly states no new external deps; additive change with no config surface; REQ-COMPAT-01/02 (no migration) satisfied by the additive design + `readEvents → ok([])` on absent file.
- The `RUNTIME_EXCLUDE_PATHSPECS` claim (events.ndjson absent, must be added) is **correct** (`git-commit.ts:18-27`). The embedded-artifacts regeneration claim is **correct** (`generate-embedded-artifacts.ts` runs inside `@rauf/core`'s build). The prompt-builder "currently states no commit rule" claim is **correct**.

## Fix Execution Plan

### User Decisions Required
- **V-001:** [RESOLVED 2026-06-12 — **Add `IO_ERROR`**] Add a new `IO_ERROR` member to `ErrorCodes` in `errors.ts`; record it as a required core change in §2/§8.
- **V-003 / V-005 / V-006:** [RESOLVED 2026-06-12 — **Keep 1s, document divergence**] Keep `TOKEN_COALESCE_MS = 1000`; fix the wrong "mirrors iteration-status" rationale and document the intentional rate divergence + unbounded-growth/`fs.watch` posture as accepted Phase-1 deferrals. No behavior change.
- All other findings are documentation-only edits to `tech-spec.md` and can be applied directly.

### Execution Steps

#### Step 1: Fix the two factual code-level errors in the core primitives
- **Files:** specs/ux-overhaul/tech-spec.md
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-T05, CHECK-T06, CHECK-T08
- **Action:** In §3.2/§5.1/§7, resolve the `ErrorCodes.IO_ERROR` reference (per user decision: add `IO_ERROR` to the `errors.ts` additions in the §2 module table, or substitute an existing code). In §3.5/§5.1, rename the extracted lock helper's return type away from `LockSummary` (use `Result<LockStatus>` or a new `LockLiveness` type), correct the claim that `checkLock` returns `LockSummary` (it returns `Result<LockStatus>`), and describe the extraction as parameterizing the existing `checkLock` body (which uses private `isProcessAlive`/`isProcessRecycled`) on a raw `lockPath`.
- **Depends on:** none
- **Rationale:** These are the only findings that would make copy-pasted spec code fail to compile; fix first.

#### Step 2: Correct the D3 coalescing rationale and document the telemetry-rate divergence
- **Files:** specs/ux-overhaul/tech-spec.md
- **Addresses:** V-003
- **Checklist:** CHECK-T05, CHECK-T10, CHECK-T17
- **Action:** In §1 D3 and §3.1, remove/replace "mirrors the existing iteration-status.json throttle" (existing throttle is `TOKEN_EVENT_THROTTLE_MS = 5_000`). Note that events.ndjson coalesces at 1s vs. iteration-status.json at 5s, that this is intentional, and the consequence (events log carries more token records).
- **Depends on:** none

#### Step 3: Tighten the error-handling, growth, and watch-reliability sections
- **Files:** specs/ux-overhaul/tech-spec.md
- **Addresses:** V-004, V-005, V-006
- **Checklist:** CHECK-T10, CHECK-T16, CHECK-T17
- **Action:** Add to §7 the explicit "single writer ⇒ only-trailing-line-can-be-malformed ⇒ read tolerance is sufficient" correctness argument, and decide/state the persistent-append-failure surfacing posture. Add a growth note to §3.3/§10 (unbounded per-run growth accepted; optional offset-based replay). In §3.3/TQ-3, define `--interval` as a missed-`fs.watch` safety-net (not only an absence fallback) and soften the §3.1 "seq gap = corruption" claim for live readers.
- **Depends on:** none

#### Step 4: Make the web/frontend testing strategy explicit
- **Files:** specs/ux-overhaul/tech-spec.md
- **Addresses:** V-007
- **Checklist:** CHECK-T11, CHECK-T16
- **Action:** In §8, add a statement that the web client has no automated test harness and that `<EventTimeline>` parity is verified at the API boundary plus a manual SC-1 web check; add that manual check to the testing list.
- **Depends on:** none

#### Step 5: Reconcile the `watchEvents`/`watchLog` contract and the Zod-intersection note
- **Files:** specs/ux-overhaul/tech-spec.md
- **Addresses:** V-008, V-009
- **Checklist:** CHECK-T05, CHECK-T06, CHECK-T09
- **Action:** Align `watchEvents`'s return shape with `watchLog` (`() => void`) or drop the "mirrors" wording across §3.3/§5.1/§6.2. Add the §3.4 note acknowledging the codebase's first `z.intersection` over a discriminatedUnion and the alternative (`.and` / per-member `.merge`) considered.
- **Depends on:** none

#### Step 6: Correct the three drifted line numbers
- **Files:** specs/ux-overhaul/tech-spec.md
- **Addresses:** V-010
- **Checklist:** CHECK-T05, CHECK-T08
- **Action:** §6.1 `start()` → `runner.ts:139`; §3.11 item 3 → `RAUF.md.tmpl:32`; §8 → `loop-commands.test.ts:100`.
- **Depends on:** none

## Fix Progress

- Step 1: [APPLIED] 2026-06-12 — V-001 (added `IO_ERROR` to §2 errors.ts row + §3.2 note) and V-002 (corrected §2 lock.ts row, §3.5 prose, and §5.1 signature: `checkLockFile` returns `Result<LockStatus>`, not `LockSummary`; clarified extraction parameterizes `checkLock` body on raw `lockPath`).
- Step 2: [APPLIED] 2026-06-12 — V-003: §1 D3 and §3.1 corrected — dropped the false "mirrors iteration-status throttle" claim (that throttle is `TOKEN_EVENT_THROTTLE_MS = 5_000`), documented the intentional 1s-vs-5s rate divergence and the more-token-records consequence.
- Step 3: [APPLIED] 2026-06-12 — V-004/V-005/V-006: §7 gained the explicit single-writer⇒only-trailing-line correctness argument, the silent-persistent-failure posture, and the safe concurrent web-tail note; §3.3 gained the per-run unbounded-growth deferral note and the `fs.watch` offset-reread reliability note; §3.1 softened "seq gap = corruption" for live readers; TQ-3 updated for the missed-fire safety-net.
- Step 4: [APPLIED] 2026-06-12 — V-007: §8 Web tests now states the web client has no automated harness, that `<EventTimeline>` parity is verified at the API boundary + a manual SC-1 web check, and adds that manual check to the Phase-1 acceptance pass.
- Step 5: [APPLIED] 2026-06-12 — V-008: `watchEvents` return shape changed to `() => void` (genuinely mirrors `watchLog`) in §3.3 and §5.1. V-009: §3.4 gained the first-`z.intersection` implementation note (forfeited fast path, per-line safeParse cost, `.and`/per-member `.merge` alternatives, chosen-for-boilerplate rationale).
- Step 6: [APPLIED] 2026-06-12 — V-010: §6.1 `start()` → `runner.ts:139`; §3.11 item 3 → `RAUF.md.tmpl:32`; §8 → `loop-commands.test.ts:100`.
