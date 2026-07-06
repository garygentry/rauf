# Verification Report: loop-observability (impl)

Date: 2026-07-06
Pipeline Stage: forge-verify-impl
Mode: impl (parallel dimensioned fan-out — 4 forge-verifier instances)

Dimensions & artifacts reviewed:
- **(1) requirement coverage vs specs** — PRD.md, 02/03/04-*.md, backlog.json (7 items, all done), core src (status/schemas/backlog-root/events-log), cli src (status-commands/follow-command/event-format), drive-rauf-loop SKILL.md, SPEC-CLI / SPEC-BACKLOG-TOOL-CONTRACT
- **(2) integration correctness** — core + cli + loop + web consumers of DerivedStatus / LoopEvent; `pnpm typecheck`, `pnpm build`
- **(3) testing** — status.test.ts, schemas.test.ts, events-log.test.ts, backlog-root.test.ts vs 06-testing-strategy.md; `pnpm --filter @rauf/core test`
- **(4) code-quality / conventions** — core src + SKILL.md vs project conventions; `pnpm lint`, `pnpm format:check`

Checks executed: 28 total across dimensions (6 requirement-coverage, 5 integration, 7 testing, 10 code-quality) — 24 pass, 4 findings, 0 not-applicable.

## Summary
- Total findings: 4
- Gaps: 2
- Inconsistencies: 0
- Improvements: 2
- Errors: 0

Build/test/lint ground truth (authoritative per repo CLAUDE.md, not the editor LSP):
- `pnpm typecheck` — passes across all 5 packages
- `pnpm build` — succeeds (cross-package `.d.ts` resolve)
- `pnpm --filter @rauf/core test` — 27 files, 993 tests, all pass
- `pnpm lint` + `pnpm format:check` — clean across all packages
- The 6 failing `@rauf/loop` `runner.test.ts` usage-limit tests are the known local-only live-API flakes (branch never touched `runner.ts`); CI runs them green — **not findings**.

Requirement coverage (dimension 1) and integration correctness (dimension 2) returned **zero** findings — requirement→code traceability is unusually tight because backlog items carried exact `file:line` targets and the implementation followed them near-verbatim. All 4 findings are in the testing dimension (2 missing spec-prescribed test cases) plus one cosmetic code-quality nit on pre-existing code.

## Findings

### V-001: Keystone single-poll decision-completeness test (§4.5, REQ-SUCCESS-01) is missing
- **Severity:** gap
- **Location:** `packages/core/src/status.test.ts` (append per 06-testing-strategy.md §4.5)
- **Issue:** 06-testing-strategy.md §4.5 prescribes a LOAD-BEARING test proving a single `deriveStatus` poll carries **every** input the 05-supervision-recipe four-way decision tree reads — `loopState`, `health.stuckWarning`, `lock.stale`, and `backlogSummary.needsHuman` — all present on **one** returned object (keystone REQ-SUCCESS-01: "one poll = full decision, zero raw-file reads"). The individual pieces are each tested in isolation (health block 1642-1805, lock summary 738-798, needsHuman 632-653), but there is **no** test asserting all four fields are simultaneously defined on a single `DerivedStatus`. The 06 §Verification line 829-830 checklist item is therefore not exercised.
- **Suggested fix:** Append a `describe("deriveStatus — single-poll decision completeness (REQ-SUCCESS-01)")` with one test: write a backlog item `{ status: "blocked", needsHuman: true }`, a running state.json, an iteration-status.json with `stuckWarning: true`, and a live lock (via existing `writeLock`), then assert on the single result: `s.loopState` defined, `s.backlogSummary.needsHuman === 1`, `s.health?.stuckWarning === true`, `s.lock?.stale` defined — the fixture in 06 §4.5.
- **References:** 06-testing-strategy.md §4.5 + §Verification (line 829); 05-supervision-recipe.md
- **Checklist:** impl-testing (key-behavior coverage), 06 §Verification

### V-002: Additive-compat suite omits the "rejects statusSchemaVersion !== '1'" case (§3.5)
- **Severity:** gap
- **Location:** `packages/core/src/schemas.test.ts`, `describe("DerivedStatusSchema")` (803-907)
- **Issue:** 06-testing-strategy.md §3.5 prescribes three parse assertions for additive-compat: (a) accepts `health: null`, (b) accepts a populated health block, (c) **rejects a statusSchemaVersion other than '1'** (`{ ...baseline, statusSchemaVersion: "2" }` → `success === false`). The suite covers (a) 845-866, (b) 868-889, and rejects a **missing** version 891-906 — but never asserts a **present-but-wrong** version (`"2"`) is rejected. Since `statusSchemaVersion` is the literal-`"1"` guard pinning the machine contract (REQ-CONTRACT-05 / REQ-SUCCESS-05), the "wrong value rejected" branch is the one that protects consumers from a silent version bump, and it is untested.
- **Suggested fix:** Add one test to `describe("DerivedStatusSchema")`: build the valid baseline object, set `statusSchemaVersion: "2"`, assert `DerivedStatusSchema.safeParse(obj).success === false`. Per 06 §3.5 lines 353-355.
- **References:** 06-testing-strategy.md §3.5 (lines 353-355); 00-core-definitions.md (statusSchemaVersion literal)
- **Checklist:** impl-testing (spec-prescribed case coverage)

### V-003: Read-spy invariant (§3.4) does not cover the staleness-downgrade path
- **Severity:** improvement
- **Location:** `packages/core/src/status.test.ts:1767-1785` (I/O-budget tests)
- **Issue:** The ≤1-read invariant (REQ-PERF-01) is proven on the Tier-1 healthy path (1767-1775) and the Tier-2/none zero-read path (1777-1785). 06-testing-strategy.md §3.4 additionally calls for the assertion on the **staleness-downgrade path** — "also holds on the staleness-downgrade path (the old sole read site)" (06 §3.4 lines 290-307; §Verification line 816). That path (stale state.json + fresh iteration-status.json keeping RUNNING) is exactly where the old `isLoopLive` conditional read could coexist with the promoted read and push the count to 2. The behavior itself is tested (355-365 keeps RUNNING) but not the read-count on that branch. (The chosen module-mock counter via `vi.hoisted` is a valid, cleaner alternative to the spec's fs.readFileSync-filter approach — not a finding; only the missing path is.)
- **Suggested fix:** Add a third I/O-budget test mirroring the "keeps RUNNING when state.json is stale but iteration-status.json is fresh" fixture (status.test.ts:355), reset `readIterationStatusSpy.count = 0`, call `deriveStatus`, assert `readIterationStatusSpy.count <= 1`.
- **References:** 06-testing-strategy.md §3.4 (lines 290-314) + §Verification (line 816); status.test.ts:355-365
- **Checklist:** impl-testing (branch/edge coverage of spec-flagged path)

### V-004: `computeElapsed` uses global `isNaN` while sibling health code uses `Number.isNaN`
- **Severity:** improvement
- **Location:** `packages/core/src/status.ts:406` (inside `computeElapsed`)
- **Issue:** New health-derivation code uses `Number.isNaN` consistently (lines 160, 188, 193), but the shared `computeElapsed` helper still uses global `isNaN` (line 406), which coerces its argument. Minor internal NaN-checking inconsistency. **Note: `computeElapsed` is pre-existing code — the feature did not touch this line.** Flagged for consistency only; not a defect in the shipped feature.
- **Suggested fix:** Change `if (isNaN(start)) return null;` to `if (Number.isNaN(start)) return null;` (`start` is already a `number` from `.getTime()`, so behavior is identical — purely stylistic). Optional; safe to skip given it is outside this feature's diff.
- **References:** `packages/core/src/status.ts` lines 160/188/193
- **Checklist:** code-quality/conventions (strict-TS / consistency)

## Fix Execution Plan

### User Decisions Required
None. All four findings are mechanical and additive: V-001/V-002/V-003 are spec-prescribed test cases (06-testing-strategy.md §3.4/§3.5/§4.5) with fixtures given verbatim; V-004 is a one-token stylistic alignment on pre-existing code (optional). No design judgment needed.

### Execution Steps

#### Step 1: Add the two prescribed schema/status test gaps (V-001, V-002)
- **Files:** `packages/core/src/status.test.ts`, `packages/core/src/schemas.test.ts`
- **Addresses:** V-001, V-002
- **Action:**
  - status.test.ts: append the single-poll decision-completeness `describe` (blocked+needsHuman item, running state.json, iteration-status `stuckWarning:true`, live lock) asserting `loopState` / `backlogSummary.needsHuman === 1` / `health?.stuckWarning === true` / `lock?.stale` all defined on one `deriveStatus` result.
  - schemas.test.ts: in `describe("DerivedStatusSchema")`, add a test asserting a baseline object with `statusSchemaVersion: "2"` fails `safeParse`.
- **Depends on:** none

#### Step 2: Add the staleness-downgrade read-spy test (V-003)
- **Files:** `packages/core/src/status.test.ts`
- **Addresses:** V-003
- **Action:** Add an I/O-budget test using the stale-state + fresh-iteration-status fixture (status.test.ts:355), reset `readIterationStatusSpy.count = 0`, assert `<= 1`.
- **Depends on:** none

#### Step 3 (optional): Align NaN check in `computeElapsed` (V-004)
- **Files:** `packages/core/src/status.ts`
- **Addresses:** V-004
- **Action:** Line 406, replace `if (isNaN(start))` with `if (Number.isNaN(start))`. Behavior-identical; skip freely (pre-existing code, outside feature diff).
- **Depends on:** none

### Verification after fixes
Run `pnpm --filter @rauf/core test` (baseline 993 passing → +3 with V-001/V-002/V-003) and `pnpm gate` for the full green check.

## Fix Progress
- Step 1: [APPLIED] 2026-07-06 — Added single-poll decision-completeness test (V-001, status.test.ts) + wrong-version rejection test (V-002, schemas.test.ts).
- Step 2: [APPLIED] 2026-07-06 — Added staleness-downgrade path read-spy ≤1 test (V-003, status.test.ts).
- Step 3: [APPLIED] 2026-07-06 — Aligned computeElapsed to Number.isNaN (V-004, status.ts). Core tests: 996 passing (+3).
