# Verification Report: forge-skill-spec-purity (backlog)
Date: 2026-06-16
Pipeline Stage: forge-5-loop (backlog complete, pre-loop verification)
Artifacts Reviewed:
- backlog.json (9 items)
- PRD.md, tech-spec.md, TRACEABILITY.md
- 00-core-definitions.md, 01-architecture-layout.md, 02-frontmatter-purity-and-inventory.md, 03-portable-root-resolver.md, 04-body-size-discipline.md, 05-spec-purity-checker.md, 06-testing-strategy.md
- Cross-repo creation targets cross-checked against the live `feature-forge` tree (/home/gary/workspace/feature-forge)

Method: parallel dimensioned fan-out — 4 `forge-verifier` instances over the 25 backlog checks (B01–B25), plus the deterministic loop-runner gate `rauf-stable backlog validate` (result: `valid:true`, 0 findings).

## Summary
- Total findings: 6
- Gaps: 1
- Inconsistencies: 1
- Improvements: 4
- Errors: 0

**Check roll-up:** 24 of 25 checks PASS. The single FAIL is CHECK-B19 (priority/dependency inversion). Schema/enum (B01–B06), spec coverage & traceability (B07–B10, B20–B24), dependency-graph integrity (B15–B18), and scoping/AC verifiability (B11–B14, B25) are otherwise clean. This is a strong, well-grounded backlog: per-item counts (10 argument-hint skills, 23 `${CLAUDE_PLUGIN_ROOT}` occurrences, 517/418/337 body lines) were verified against the live feature-forge tree and all match.

> **Cross-repo note (constraint C-1):** all implementation lands in the **feature-forge** repo; specs/backlog/loop run from **rauf**. specReferences correctly point at the rauf spec docs (00–06); creation targets (forge-root.sh, check-spec-purity.py, validate.sh, …) live in feature-forge and are not specReferences. Per-item verification uses `python3 scripts/check-spec-purity.py`, `python3 -m pytest tests`, `bash scripts/validate.sh` from the feature-forge root — there is no TypeScript/pnpm gate for this feature.

## Findings

### V-001: Priority inversion — pri-1 item 009 depends on pri-2 item 008
- **Severity:** inconsistency
- **Location:** backlog.json — item `009` (`priority: 1`, `dependsOn` includes `"008"`) vs item `008` (`priority: 2`)
- **Issue:** Item 009 ("Wire checker into validate.sh and pass the completion gate"), priority 1, lists 008 ("Author vendor-construct inventory"), priority 2, in its `dependsOn`. Under the convention that 1 is highest priority (lower number = higher priority), a dependency should carry a priority number ≤ its dependent's. Here the dependency (008, pri 2) ranks *below* the item it gates (009, pri 1) — a priority/dependency inversion, and the only check that failed (CHECK-B19). Impact assessment: this will **not** corrupt execution — `dependsOn` governs eligibility, so a correct runner will not start 009 until 008 is complete regardless of priority. The real (bounded) hazard is latent scheduling delay: a priority-greedy scheduler defers the pri-2 chore 008 behind every other pri-1 item, and because 009's completion gate depends on 008, the audit doc becomes an unintended long-pole on the critical path to REQ-VER-03.
- **Suggested fix:** Promote item 008 to `priority: 1`. It is on the critical path to the completion gate, so pri-1 matches reality and removes the inversion. (Alternative, if pri-2 ranking is deliberate: keep 008 at pri 2 but add a one-line `notes` on 008/009 stating the rank is intentional and that the `dependsOn` edge — not priority — governs ordering, so a future verifier does not re-flag it. Recommended: promote.)
- **References:** backlog.json items 008, 009; 01-architecture-layout.md §5 (completion gate, REQ-VER-03)
- **Checklist:** CHECK-B19

### V-002: Item 001 resolver-test AC does not pin the exact stderr/stdout assertions the spec requires
- **Severity:** gap
- **Location:** backlog.json item `001`, `acceptanceCriteria[4]` (the pytest AC) — compare to `acceptanceCriteria[2]`
- **Issue:** AC[2] correctly pins the exact failure string ("…writes exactly 'feature-forge: cannot locate plugin root. Set CLAUDE_PLUGIN_ROOT or run from an installed skill dir.' to stderr and exits 1"). But AC[4], which governs pytest coverage, only says the test "covers cases (a) self-location, (b) total failure, (c) env fallback, (d) candidate probe, with HOME redirected for every failure/fallback/candidate case" — it does not state that case (b) must assert the *exact* stderr message + exit 1, nor that (a)/(c)/(d) assert the *exact stdout root*. Spec 06 §3 pins all four assertions concretely. A fresh agent could satisfy AC[4] with a weak test (e.g. case (b) asserting only `returncode == 1` without checking the message). The description does point to "the four cases in spec 06 section 3", so the detail is reachable — this is a gap between the AC wording and the spec's testable contract, not a missing requirement.
- **Suggested fix:** Extend `acceptanceCriteria[4]` to make per-case assertions checkable, e.g. "…case (a)/(c)/(d) assert exit 0 AND stdout equals the expected absolute root; case (b) asserts exit 1 AND stderr contains the exact message from AC #3; HOME redirected for cases (b)/(c)/(d) per spec 06 §3." Adds no new work — only aligns the AC with spec 06 §3.
- **References:** 06-testing-strategy.md §3 (cases a/b/c/d assertion table), 00-core-definitions.md §7 (forge-root.sh exit contract), tech-spec.md §8
- **Checklist:** CHECK-B13, CHECK-B12

### V-003: Item 002 both-limbs body-size fixture AC does not name the two required tokens
- **Severity:** improvement
- **Location:** backlog.json item `002`, `acceptanceCriteria[3]` (the tests/fixtures AC)
- **Issue:** The AC requires fixtures covering "rule-4 word-limit and both-limbs (two BODY_SIZE violations, body-size=2) cases". Spec 06 §2.2 pins a more concrete contract for the both-limbs case: BOTH the `body … lines exceeds 300` AND `body … words exceeds 5000` tokens must appear AND the per-rule tally must read `body-size=2`. The AC compresses this to "(two BODY_SIZE violations, body-size=2)" without naming the two tokens, so a fixture could assert only the count and miss that both messages must be present.
- **Suggested fix:** Tighten `acceptanceCriteria[3]` to name the observable, e.g. "…the both-limbs case (`bad-oversized-both`) asserts BOTH the `body … lines exceeds 300` and `body … words exceeds 5000` tokens appear AND the tally line reports `body-size=2`."
- **References:** 06-testing-strategy.md §2.2, 00-core-definitions.md §5 (VR_BODY_LINES / VR_BODY_WORDS), 05-spec-purity-checker.md §3.4
- **Checklist:** CHECK-B13

### V-004: Items 005/006/007 frame the budget as a line target; the word limb is only in the parenthetical
- **Severity:** improvement
- **Location:** backlog.json items `005`/`006`/`007` — titles ("517 → ≤300 lines", etc.) and body-size ACs (`005.acceptanceCriteria[3]`, `006.acceptanceCriteria[3]`, `007.acceptanceCriteria[2]`)
- **Issue:** Each title frames the work purely as a line reduction. The ACs *do* cite both limbs ("final body ≤300 lines AND ≤5000 words") and the `python3 scripts/check-spec-purity.py` clause enforces both, so these ACs are objectively verifiable — this is a clarity nit, not a gap. The line cap binds for all three today (word counts are well under 5000 per spec 04 §3), so the framing is accurate now, but a fresh agent relocating content could focus only on the line count.
- **Suggested fix:** Optional. Append to each title or first description line a short note like "(line cap binds; word count already under 5000 per spec 04 §3 — the gate checks both)". No change strictly required since the checker-driven AC already enforces the AND-budget.
- **References:** 04-body-size-discipline.md §1, §3; 05-spec-purity-checker.md §3.4; tech-spec.md §3.3 / §10 (D1)
- **Checklist:** CHECK-B11, CHECK-B13

### V-005: P0 REQ-COMPAT-01/02/03 are covered in item 009's description/notes, not in an acceptanceCriteria entry
- **Severity:** improvement
- **Location:** backlog.json item `009`, `acceptanceCriteria` (vs `description` + `notes`)
- **Issue:** The three P0 compatibility requirements (REQ-COMPAT-01/02/03 — all 11 skills still trigger/behave identically under Claude, plugin still loads, bundled scripts locatable via the resolver) are named in item 009's `description` and `notes` but appear in no `acceptanceCriteria` line. This is **by design** — the behavioral smoke is a non-loop-automatable manual maintainer step, correctly not a loop gate. Coverage exists; it simply lives in prose. Flagged at improvement severity only so the gap between "P0" and "no AC" is visible and intentional.
- **Suggested fix:** No change required for correctness. Optionally add a single **non-gating** AC to item 009 recording the manual handoff, e.g. "Maintainer follow-up (manual; not loop-verified): after the gate is green, run the Claude behavioral smoke (REQ-COMPAT-01/02/03, spec 06 §5) — plugin loads, all 11 skills trigger with byte-unchanged descriptions, resolver-backed flows run, relocated content reachable via in-body pointers." Do not make it loop-blocking.
- **References:** PRD §4.1 (REQ-COMPAT-01/02/03), 06-testing-strategy.md §5, item 009 description + notes
- **Checklist:** CHECK-B08

### V-006: Item 002 sits at the upper edge of single-iteration size (checker + tests + ~16 fixtures)
- **Severity:** improvement
- **Location:** backlog.json item `002`, description + `estimatedIterations: 2`
- **Issue:** Item 002 asks one iteration to create `check-spec-purity.py` (the full 5-rule checker, ~250 lines per spec 05) AND `test_check_spec_purity.py` AND ~16 fixture trees. Large surface, but correctly scoped: a checker is unverifiable without its tests, so splitting checker-from-tests would produce an un-testable fragment. Mitigated by `estimatedIterations: 2` and the spec providing the complete checker source (05 §1–§4) and fixture table (06 §2.2/§2.3) verbatim. This is the largest item by volume (the CHECK-B25 watch item) — flagged for awareness, **not** for breakdown.
- **Suggested fix:** No structural change recommended. Optionally note in item 002 that, if the iteration runs long, a minimum viable first pass is checker + clean-skills + one-fixture-per-rule, with reader-robustness + both-limbs fixtures completing in the second iteration — but all must be green before the ACs pass. Ensure the loop honors `estimatedIterations: 2`.
- **References:** 05-spec-purity-checker.md (full checker source), 06-testing-strategy.md §2.2 / §2.3 (16 fixtures)
- **Checklist:** CHECK-B25, CHECK-B11

## Fix Execution Plan

### User Decisions Required
- **V-001 (priority inversion):** one decision — promote item 008 to `priority: 1` (recommended), OR keep it at pri 2 and add an intentional-inversion `notes`. Everything else is direct, low-risk AC-wording tightening with no decision needed. V-004/V-005/V-006 are optional polish.

### Execution Steps

Apply in order. Each step is self-contained and edits only `backlog.json` in
`specs/agent-agnostic/forge-skill-spec-purity/`. All are pure backlog-metadata edits — no
spec docs or source change. After editing, re-run the loop-runner gate to confirm it still
validates green:
`rauf-stable backlog validate . --backlog specs/agent-agnostic/forge-skill-spec-purity --specs-dir specs/agent-agnostic/forge-skill-spec-purity --json`

#### Step 1: Resolve the priority inversion (V-001)
- **Files:** backlog.json
- **Addresses:** V-001
- **Checklist:** CHECK-B19
- **Action:** Set item `008`'s `priority` from `2` to `1` (recommended — 008 is on the critical path to the 009 completion gate). If the maintainer prefers to keep 008 deferrable, instead leave `priority: 2` and add a `notes` line to items 008 and 009 stating the inversion is intentional and that `dependsOn` (not priority) governs ordering.
- **Depends on:** none
- **Rationale:** Only failing check; do it first and independently so the validate gate is re-confirmed before the cosmetic AC edits.

#### Step 2: Tighten test-assertion ACs (V-002, V-003)
- **Files:** backlog.json
- **Addresses:** V-002, V-003
- **Checklist:** CHECK-B12, CHECK-B13
- **Action:** (a) Item 001 `acceptanceCriteria[4]`: add explicit per-case assertions — cases (a)/(c)/(d) assert exit 0 AND stdout equals the expected absolute root; case (b) asserts exit 1 AND stderr contains the exact message from AC #3; HOME redirected for (b)/(c)/(d) per spec 06 §3. (b) Item 002 `acceptanceCriteria[3]`: name the two required tokens for the both-limbs case (`body … lines exceeds 300` AND `body … words exceeds 5000`) plus the `body-size=2` tally line.
- **Depends on:** none (independent of Step 1)
- **Rationale:** Both are AC-wording precision fixes that align the backlog with already-pinned testable contracts in spec 06; grouped because both touch test-coverage ACs.

#### Step 3 (optional polish): V-004, V-005, V-006
- **Files:** backlog.json
- **Addresses:** V-004, V-005, V-006
- **Checklist:** CHECK-B08, CHECK-B11, CHECK-B25
- **Action:** (a) V-004 — append a "(line cap binds; word count already under 5000 per spec 04 §3 — gate checks both)" note to items 005/006/007. (b) V-005 — add a single non-gating manual-follow-up AC to item 009 recording the REQ-COMPAT-01/02/03 behavioral smoke. (c) V-006 — add an optional staging note to item 002 about the minimum-viable first pass under `estimatedIterations: 2`.
- **Depends on:** none
- **Rationale:** All three are clarity/awareness improvements with no correctness impact; safe to skip if the maintainer prefers to proceed to the loop. Grouped last so the loop is not blocked on cosmetics.

## Fix Progress
- Step 1: [APPLIED] 2026-06-16 — V-001 resolved: item 008 priority 2 → 1 (priority inversion removed; all items now pri 1).
- Step 2: [APPLIED] 2026-06-16 — V-002 (item 001 AC[4] now pins per-case exit/stdout/stderr assertions per spec 06 §3) and V-003 (item 002 AC[3] now names the two both-limbs tokens + body-size=2 tally).
- Step 3: [APPLIED] 2026-06-16 — V-004 (line-cap-binds note added to items 005/006/007 notes), V-005 (non-gating manual-smoke AC added to item 009), V-006 (minimum-viable-first-pass staging note added to item 002).
- Post-fix gate: `rauf-stable backlog validate` → valid:true, 0 findings. JSON valid, 9 items.
