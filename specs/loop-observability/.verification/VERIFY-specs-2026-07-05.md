# Verification Findings — loop-observability (specs)

**Date:** 2026-07-05
**Mode:** specs
**Pipeline stage verified:** `forge-3-specs` (version 1)
**Method:** parallel dimensioned fan-out — 5 `forge-verifier` instances over disjoint
dimensions (types/contracts, architecture/layout, cross-reference & traceability,
testing strategy, integration), plus the deterministic traceability validator.

## Summary

| Metric | Value |
|--------|-------|
| Deterministic traceability | **36/36 covered, 0 orphaned references** |
| Total findings | **9** |
| — error | 1 (V-009) |
| — gap | 4 (V-003, V-004, V-005, V-006) |
| — inconsistency | 2 (V-001, V-007) |
| — improvement | 2 (V-002, V-008) |
| Dimensions clean (0 findings) | types/contracts (9/9 pass), integration (14/14 pass) |

**Overall:** the suite is strong. Every type claim and every integration `file:line`
was grounded against real source with **zero drift** — the spec authors verified
against the codebase and it holds. All 9 findings are **doc-only, mechanical** edits
concentrated in `01-architecture-layout.md`, `06-testing-strategy.md`, `TRACEABILITY.md`,
and one pointer in `05-supervision-recipe.md`. No finding touches a type contract,
integration signature, or the code to be written. No P0 requirement is uncovered; the
gaps are missing *test specs* and *doc-inventory* items, not missing *design*.

---

## Findings

### V-001 — `01` §1 directory tree omits the 4th driver mirror `.codex/agents/rauf-loop-driver.toml`
- **Severity:** inconsistency
- **Location:** `01-architecture-layout.md` §1 (directory tree) & §5 conflict-check note
- **What's wrong:** `01` §1 lists only three skill/agent homes (`skills/drive-rauf-loop/SKILL.md`, `.codex-plugin/skills/drive-rauf-loop/SKILL.md`, `agents/rauf-loop-driver.md`). `git ls-files` confirms a **fourth** file, `.codex/agents/rauf-loop-driver.toml`, which `05-supervision-recipe.md` §1 correctly enumerates (as file #4). The foundation/placement doc undercounts the touched-file set and disagrees with its own owning domain doc (`05`).
- **Suggested fix:** Add a `.codex/` branch to `01` §1's tree: `.codex/agents/rauf-loop-driver.toml  · verify defers to skill (likely no edit) — see 05 §1/§4.3`. Keep the verify-only characterization consistent with `05`.
- **References:** `05-supervision-recipe.md` §1, §4.3, §8; `git ls-files` output.
- **Checklist:** CHECK-S (architecture/layout — file-placement completeness; cross-doc consistency)

### V-002 — `01` §1 path-caveat grep misses the agent mirrors
- **Severity:** improvement
- **Location:** `01-architecture-layout.md` §1, path-caveat blockquote
- **What's wrong:** The caveat says to verify skill/agent homes with `git ls-files | grep -i drive-rauf-loop`. That pattern matches only the two `drive-rauf-loop` SKILL files — it surfaces **neither** `rauf-loop-driver` agent file. `05` §1 uses the correct two-pattern form. An implementer following only `01`'s grep would miss both agent mirrors.
- **Suggested fix:** Change the command to `git ls-files | grep -iE "drive-rauf-loop|rauf-loop-driver"` (matching `05` §1).
- **References:** `05-supervision-recipe.md` §1.
- **Checklist:** CHECK-S (architecture/layout — placement-verification instructions)

### V-003 — `01` §2 phase→file matrix omits the `.codex/**` agent-mirror verify step
- **Severity:** gap
- **Location:** `01-architecture-layout.md` §2 (phase→file matrix, Phase 2 row)
- **What's wrong:** `05` §1 assigns the verify-only touch of `agents/rauf-loop-driver.md` **and** `.codex/agents/rauf-loop-driver.toml` to **Phase 2**. `01` §2's Phase 2 "Files" cell reads `core/backlog-root.ts, cli/status-commands.ts (+tests); skills/drive-rauf-loop/*` — the `skills/*` glob covers the two SKILL.md copies but neither agent mirror. A phase-scoped `git diff --stat` reviewer (per `01` §Verification item 1) would have no expectation those files were inspected.
- **Suggested fix:** Extend `01` §2's Phase 2 "Files" cell: `… ; skills/drive-rauf-loop/* ; agents/rauf-loop-driver.md + .codex/agents/rauf-loop-driver.toml (verify-only, likely no edit)`.
- **References:** `05-supervision-recipe.md` §1 (Phase 2 rows), §4.3.
- **Checklist:** CHECK-S (phase→file matrix internal consistency vs domain docs)

### V-004 — `06` specifies no concrete test for `--all` broadening / machine-wide front door
- **Severity:** gap
- **Location:** `06-testing-strategy.md` §1 table (the `status` cwd-default / `--all` broadening row) — no `describe`/`it` spec exists for it in §3–§6.
- **What's wrong:** `03-target-resolution.md` §Verification declares two load-bearing acceptances: REQ-SCOPE-03 (bare `status` on a TTY with idle cwd + a loop live elsewhere surfaces `handleStatusAll`; with a live cwd loop it does **not** broaden) and REQ-SCOPE-04 (`--all --json` emits `{ loops: ActiveLoopEntry[] }`, never a `DerivedStatus`). These are the test half of the P0 criterion REQ-SUCCESS-03(b) ("see every live loop on the machine"). `06` names the row but specifies no test body/fixture/assertion.
- **Suggested fix:** Add a subsection (e.g. `06` §4.6 or a §6 integration bullet) with two `it`s in `status-commands.test.ts`: (a) temp-dir fixture with an idle cwd backlog + a second live root → assert bare `status` invokes the `--all` path; with a live cwd loop → assert it does **not** broaden; (b) `--all --json` → parse stdout, assert shape `{ loops: [...] }` and **not** a `DerivedStatus` (no top-level `statusSchemaVersion`/`loopState`). Cross-link the §1 table row to it.
- **References:** `03-target-resolution.md` §Verification (REQ-SCOPE-03/04); PRD §9 REQ-SUCCESS-03.
- **Checklist:** CHECK-S (testing: every load-bearing requirement has a concrete test; P0 success-criterion coverage)

### V-005 — `06` does not test the runtime "unknown event type → firehose" fallback
- **Severity:** gap
- **Location:** `06-testing-strategy.md` §5.1 (altitude table test)
- **What's wrong:** `04-event-altitude-follow.md` §Verification declares: an unrecognized runtime `type` returns `"firehose"` and does **not** throw (the §2.3 runtime default). `06` §5.1 tests only the 24 known types plus the compile-time `never` guard — it never asserts the runtime fallback branch, which is real code. `06` §7 claims "full branch coverage," contradicted by this omission.
- **Suggested fix:** Add an `it` to the §5.1 `describe`: `eventAltitude({ ...event(0), type: "made_up_future_type" } as unknown as PersistedEvent)` returns `"firehose"` and does not throw.
- **References:** `04-event-altitude-follow.md` §Verification, §2.3.
- **Checklist:** CHECK-S (concrete test per load-bearing behavior; branch coverage)

### V-006 — `06` does not test sticky-header segment elision (`blocked === 0` / `currentItem === null`)
- **Severity:** gap
- **Location:** `06-testing-strategy.md` §5.3 (sticky-header render test)
- **What's wrong:** `04` §Verification requires the `blocked` and `on` segments be elided when `blocked === 0` / `currentItem === null`. `06` §5.3 tests only the all-segments-present case; the elision branch (a distinct path in the header renderer) is untested, again contradicting §7's full-branch-coverage claim.
- **Suggested fix:** Add an `it` in the §5.3 `describe`: fixture with `backlogSummary.blocked = 0` and `currentItem = null` → assert the header contains neither `"blocked"` nor `"on "`.
- **References:** `04-event-altitude-follow.md` §Verification (elision clause); `06` §7.
- **Checklist:** CHECK-S (branch coverage / concrete test per acceptance)

### V-007 — `TRACEABILITY.md` overstates REQ-CMD-05 coverage (forward row & doc-03 reverse-check)
- **Severity:** inconsistency
- **Location:** `TRACEABILITY.md` forward row for REQ-CMD-05 (`01, 03, 04, 06`) and the doc-`03` reverse-check entry (trailing `CMD-05`)
- **What's wrong:** REQ-CMD-05 appears in a **Requirement Coverage table** only in `01` and `04`. In `03` it is a single inline prose mention (a constraint it *respects*, no coverage-table row); in `06` it appears only in a test `describe(...)` heading (no coverage-table row), and `TRACEABILITY`'s own reverse-check for `06` correctly omits it — so the forward row (which lists `06`) and the reverse-check disagree. The forward "Covered by" cell claims coverage two of its four docs' tables don't substantiate.
- **Suggested fix (recommended two-doc direction):** In `TRACEABILITY.md` change the forward row to `| REQ-CMD-05 | P1 | 01, 04 | 04 |` and remove the trailing `CMD-05` from the doc-`03` reverse-check entry. This makes the forward table, reverse-check, and each doc's own coverage table agree. *(Alternative: add an explicit REQ-CMD-05 row to `03`'s and `06`'s coverage tables and add `CMD-05` to `06`'s reverse-check — then leave the forward row as-is. Pick one direction.)*
- **References:** `TRACEABILITY.md`; `03-target-resolution.md` §Requirement Coverage; `06-testing-strategy.md` §Requirement Coverage; `01` / `04` coverage tables.
- **Checklist:** CHECK-S (traceability-matrix accuracy / forward↔reverse consistency)

### V-008 — `06` `missing_target` test omits the "no scan / no cwd read" call-spy assertion
- **Severity:** improvement
- **Location:** `06-testing-strategy.md` §4.1 (`missing_target` case)
- **What's wrong:** `03` §Verification (REQ-SCOPE-01 / REQ-SUCCESS-04) requires more than the error code: assert that **no `listActiveLoops` / cwd read occurs** on the `missing_target` path (via a call spy) — the security-relevant "never a silent wrong-root scan" guarantee (P0 REQ-SUCCESS-04). `06` §4.1 asserts only `code === "missing_target"`. Since `06` §4 already stubs `listActiveLoops`, adding the assertion is cheap.
- **Suggested fix:** In §4.1's `missing_target` `it`, spy on `listActiveLoops` and assert `expect(listActiveLoopsSpy).not.toHaveBeenCalled()`.
- **References:** `03-target-resolution.md` §Verification (call-spy clause); PRD §9 REQ-SUCCESS-04.
- **Checklist:** CHECK-S (test fully covers the declared acceptance, not a subset)

### V-009 — `05` §5.3 cites a non-existent tech-spec section (§4.4)
- **Severity:** error
- **Location:** `05-supervision-recipe.md` §5.3 — "…deferred entirely to a follow-up feature (Q2 ratified, tech-spec §1, §4.4)."
- **What's wrong:** `tech-spec.md` has no §4.4 — §4 contains only §4.1 (`HealthSchema`) and §4.2 (amended `DerivedStatusSchema`), then §5. The Q2 web-parity deferral actually lives in tech-spec §1 (Overview) and §10 (Open Technical Questions, "Q2 — RESOLVED: deferred … Phase 4 is docs-only"). The `§4.4` pointer resolves to nothing.
- **Suggested fix:** In `05` §5.3 change "tech-spec §1, §4.4" → "tech-spec §1, §10 (Q2)". *(Note: `05` §3.7 already cites §3.7 correctly for deference — only this pointer is dangling.)*
- **References:** `tech-spec.md` §4.1/§4.2, §10 Q2.
- **Checklist:** CHECK-S (cross-doc section reference resolves to a real section)

---

## Confirmed clean (checked, no finding)

- **Types/contracts:** every `Health` field maps to a real `IterationStatus` field (`stuckWarning`/`lastActivityAt`/`updatedAt` @ `schemas.ts:721/:720/:713`); the `DerivedStatusSchema` addition is genuinely additive (no rename/removal); `BacklogSummarySchema`/`IterationStatusSchema` untouched; `EventAltitude`/`STATUS_SCHEMA_VERSION`/resolver types internally consistent.
- **Integration:** all 14 cited integration `file:line`s confirmed exact. The load-bearing premise — `iteration-status.json` is read **only** inside private `isLoopLive` (call site `status.ts:179`, staleness-downgrade branch), not on the healthy path — is factually correct, so the ≤1-read refactor (REQ-PERF-01) is sound. `03`'s two forward-looking notes verified (`outputJson` not yet imported in `follow-command.ts`; `ExitCode.USAGE = 2` @ `commands.ts:94`). All 24 `LoopEvent` tags present at `schemas.ts:591`. Both `drive-rauf-loop` SKILL copies byte-identical.
- **Traceability semantics:** Open Questions handled correctly — Q1 (health encoding) & Q4 (recovery ladder N=3) resolved consistently; Q2 (web parity) deferred; Q3 (cross-repo) out of scope; OTQ-1 (`resolveTarget` home) resolved to `backlog-root.ts`. Altitude table 19 item + 5 firehose = 24 agrees across `04` and tech-spec §3.3. `health` nullability treated consistently everywhere. REQ-SUCCESS-06 post-hoc tags are substantive in both `04` and `05`.
- **Testing realism:** proposed test-file locations match the repo's colocated convention; the no-clock-injection `Date.now()`-relative + tolerance technique matches existing `status.test.ts`; the read-spy mechanism (`vi.spyOn(fs,"readFileSync")` filtered to the iteration-status path) is workable because `readIterationStatus` reads via `fs.readFileSync` on the shared `node:fs` namespace.

---

## Fix Execution Plan

All fixes are mechanical, doc-only, and independent. **No user decision is required** except the direction of V-007 (recommended: two-doc — treat REQ-CMD-05 as owned by `01`, `04` only). No fix touches a type contract, integration signature, or the code to be implemented.

### Step 1 — Reconcile `01`'s driver-mirror inventory with reality (4 files) and `05`
- **File:** `01-architecture-layout.md`
- **Addresses:** V-001, V-002, V-003
- **Action:** (a) add `.codex/agents/rauf-loop-driver.toml` (verify-only) to the §1 tree; (b) change the §1 path-caveat grep to `grep -iE "drive-rauf-loop|rauf-loop-driver"`; (c) extend the §2 Phase 2 "Files" cell to include `agents/rauf-loop-driver.md + .codex/agents/rauf-loop-driver.toml (verify-only, likely no edit)`.

### Step 2 — Fill the missing test specs in `06`
- **File:** `06-testing-strategy.md`
- **Addresses:** V-004, V-005, V-006, V-008
- **Action:** (a) add the `--all` broadening + `--all --json` shape tests (new §4.6 or §6 bullet) and cross-link the §1 table row; (b) add the unknown-type→`"firehose"` `it` to §5.1; (c) add the header segment-elision `it` to §5.3; (d) add the `listActiveLoops` not-called call-spy assertion to the §4.1 `missing_target` case.

### Step 3 — Reconcile REQ-CMD-05 in `TRACEABILITY.md`
- **File:** `TRACEABILITY.md`
- **Addresses:** V-007
- **User decision:** confirm the two-doc direction (recommended). Then set the forward row to `| REQ-CMD-05 | P1 | 01, 04 | 04 |` and drop trailing `CMD-05` from the doc-`03` reverse-check entry.

### Step 4 — Fix the dangling tech-spec pointer in `05`
- **File:** `05-supervision-recipe.md`
- **Addresses:** V-009
- **Action:** In §5.3 replace "tech-spec §1, §4.4" → "tech-spec §1, §10 (Q2)".

---

## Fix Progress

- User decision (V-007): **two-doc direction** chosen — REQ-CMD-05 owned by `01`, `04` only.
- Step 1: [APPLIED] 2026-07-05 — `01`: added `.codex/agents/rauf-loop-driver.toml` to §1 tree; broadened §1 path-caveat grep to `-iE "drive-rauf-loop|rauf-loop-driver"`; extended §2 Phase 2 files cell with both agent mirrors (verify-only). [V-001, V-002, V-003]
- Step 2: [APPLIED] 2026-07-05 — `06`: added §4.6 `--all` broadening + `--all --json` shape tests; §5.1 unknown-type→firehose fallback test; §5.3 header segment-elision test; §4.1 `listActiveLoops`-not-called call-spy. [V-004, V-005, V-006, V-008]
- Step 3: [APPLIED] 2026-07-05 — `TRACEABILITY.md`: forward REQ-CMD-05 row → `01, 04`; dropped trailing `CMD-05` from doc-03 reverse-check entry. [V-007]
- Step 4: [APPLIED] 2026-07-05 — `05` §5.3: `tech-spec §4.4` → `§10 (Q2)`. [V-009]

All 9 findings applied. Fixes are doc-only; no code, type contract, or integration signature changed.
