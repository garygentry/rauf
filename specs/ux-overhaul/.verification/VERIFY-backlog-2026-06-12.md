# Verification Report: ux-overhaul (backlog)
Date: 2026-06-12
Pipeline Stage: forge-5-loop (pre-loop backlog gate)
Artifacts Reviewed: specs/ux-overhaul/backlog.json (14 items), PRD.md, tech-spec.md, 00-core-definitions.md … 07-testing-strategy.md, TRACEABILITY.md, forge.config.json; backlog.schema.json (skill + core/runner + zod source)

Method: 4 parallel `forge-verifier` instances over disjoint CHECK-ID slices (scoping/AC, dependency/ordering, spec-coverage/completeness, schema/enum). Deterministic `rauf-stable backlog validate . --backlog specs/ux-overhaul --specs-dir specs/ux-overhaul --json` → `{ valid: true, findings: [] }` (exit 0).

## Summary
- Total findings: 6
- Gaps: 1
- Inconsistencies: 1
- Improvements: 4
- Errors: 0

Checks executed: 25 of 25 (B01–B25). Results: 25 structurally pass. All 6 findings are quality-level (improvement/gap/inconsistency) — no item is unbuildable or unverifiable as written. Most actionable: **V-001** (a real coverage gap for REQ-PERF-01's silent-write-failure invariant) and **V-002** (a 5-vs-6 loci counting mismatch that could mislead a fresh agent).

Schema/enum (B01–B06), spec coverage & traceability (B07–B10, B20–B24), and dependency/ordering (B15–B19) are all clean — the dependency graph is a sound DAG (all edges low→high item id), every one of the 8 impl specs is referenced, every in-scope P0 REQ maps to ≥1 item's acceptance criteria, all 9 specReferences paths resolve on disk, and skill/core/zod enum sets agree exactly (no enum drift).

## Findings

### V-001: Item 014 acceptance criteria omit the "best-effort persistence is invisible" silent-write-failure scenario
- **Severity:** gap
- **Location:** backlog.json item `014` ("Integration, dogfood & compatibility gate"), acceptanceCriteria
- **Issue:** Spec 07 §4 defines a sandbox assertion — "Best-effort persistence is invisible to loop correctness": a run where `events.ndjson` is unwritable (read-only state dir) still completes the loop and reports correct status (verifies REQ-PERF-01, REQ-REL-02). Item 014 covers the missing-file / missing-`~/.rauf/active` degradation (REQ-REL-03) but NOT the write-failure-during-an-active-run path. This is the only place the "persistence failure is fully silent" invariant (REQ-PERF-01) gets end-to-end coverage; item 003's unit coverage only asserts `appendEvent` returns `err(IO_ERROR)`, not that the runner survives it.
- **Suggested fix:** Add an AC line to item 014: "best-effort persistence: a sandbox run with an unwritable events.ndjson (e.g. read-only state dir) still completes the loop and reports correct status from state.json + rauf.log — persistence failure is silent (REQ-PERF-01/REQ-REL-02)." Optionally add `REQ-PERF-01` to the item's rationale.
- **References:** 07-testing-strategy.md §4 (bullet 3); PRD REQ-PERF-01, REQ-REL-02/03; backlog.json item 003 (unit err path only)
- **Checklist:** CHECK-B13, CHECK-B25

### V-002: Item 013 title says "6 template loci" but description says "5 source loci" — different counting bases, no explanation
- **Severity:** inconsistency
- **Location:** backlog.json item `013` ("Fix agent commit rule across all 6 template loci + regenerate"), title vs description
- **Issue:** Title says "6 template loci"; description says "Edit five source loci". Spec 06 §2's table enumerates loci 1, 2, 3a/3b, 4 (embedded-artifacts.ts — REGENERATED, not hand-edited), 5 (SPEC-ARTIFACTS.md), 6 (prompt-builder.ts), 7 (git-commit.ts — owned by item 006). The "5" (hand-edited source files) and "6" (those + regenerated embedded copy) are reconcilable, but the two numbers use different bases without explanation, and two "loci" (SPEC-ARTIFACTS.md, prompt-builder.ts) aren't templates. A fresh agent could wrongly assume something is missing or that 013 must also touch git-commit.ts.
- **Suggested fix:** Align title and body on one framing, e.g. title "Fix agent commit rule across all source loci + regenerate embedded copy"; description: "Edit 5 source loci by hand (CLAUDE_ADDON.md, CLAUDE_GREENFIELD.md.tmpl, .rauf/RAUF.md.tmpl [2 sites], SPEC-ARTIFACTS.md, prompt-builder.ts), then REGENERATE embedded-artifacts.ts via the build. (git-commit.ts's events.ndjson exclude — spec 06 locus 7 — is owned by item 006, not this item.)"
- **References:** 06-agent-commit-rule.md §2 (loci table), §5 (locus 7); backlog.json item 006 (owns git-commit.ts exclude)
- **Checklist:** CHECK-B12, CHECK-B14
- **Note:** Surfaced independently by both the scoping and coverage verifiers; merged here.

### V-003: Item 009 bundles three substantial sub-features (clean-break deletions + new follow command + parser change)
- **Severity:** improvement
- **Location:** backlog.json item `009` ("CLI follow surface + clean break of old monitor verbs"), `estimatedIterations: 2`
- **Issue:** The largest scoping risk in the backlog. Spec 04 treats three concerns in separate sections: (a) `status --follow`/`log --follow`/`-f` alias + parser normalization (§6.4), (b) a new `follow-command.ts` replay-then-tail engine promoted from `followDirectMode` (§5, ~110 lines), (c) clean-break deletion of `handleStatusWatch`, `handleLoopWatch`, `handleLoopFollow` + test rewrites (§4). `estimatedIterations: 2` already signals it exceeds one iteration (CHECK-B11).
- **Suggested fix:** Optional split — 009a "Add new follow-command.ts + status/log --follow + -f parser normalization (additive, no removals)", 009b "Clean break: delete the three handlers + update clean-break test assertions" (009b depends on 009a). If kept as one item, make the bundling a conscious decision given the explicit 2-iteration estimate and the §7 note that 009/010 edit the same command surface in sequence. No AC content is wrong.
- **References:** 04-cli-monitoring-surface.md §4, §5, §6.4; backlog.json items 009, 010
- **Checklist:** CHECK-B11, CHECK-B25

### V-004: Item 012 AC "renders all 24 LoopEvent types" is not objectively verifiable by its own build gate
- **Severity:** improvement
- **Location:** backlog.json item `012` ("Web frontend EventTimeline + projects-view liveness badges"), acceptanceCriteria line 1
- **Issue:** AC requires "<EventTimeline> … renders all 24 LoopEvent types," but Phase 1 has no frontend test harness (spec 07 §5) and the AC's verification command is only `pnpm typecheck && pnpm build`. "Renders all 24 types" is verified only by manual SC-1 (spec 07 §6), not by the item's own done-check — a subjective AC against CHECK-B13.
- **Suggested fix:** Reword to separate the buildable contract from the manual claim, e.g.: "<EventTimeline> opens an EventSource on /loop/events, replays then tails, and includes a render branch for each of the 24 LoopEvent types via an **exhaustive switch over the discriminated union** (typecheck enforces no missing case); lifecycle mirrors LogPanel." Add a notes line: "Visual confirmation is the manual SC-1 check (spec 07 §6), not an automated gate — Phase 1 has no frontend harness." The exhaustive switch makes "all 24 handled" typecheck-enforceable.
- **References:** 07-testing-strategy.md §5, §6; PRD §1 (24 LoopEvent types); backlog.json item 012 notes
- **Checklist:** CHECK-B13

### V-005: Item 008 AC use spec-prose without a concrete observable shape, risking a forbidden deriveStatus signature change
- **Severity:** improvement
- **Location:** backlog.json item `008` ("Surface inspected dir + cross-root liveness in status.ts"), acceptanceCriteria lines 1–2
- **Issue:** AC describe behavior ("expose the inspected directory", "reports cross-root liveness via listActiveLoops()") but don't pin the data shape a test asserts against. Spec 04 §1's file table forbids a `deriveStatus` signature change and §8 says Phase 1 *surfaces* the inspected dir via the existing `stateSource: "none"` discriminator rather than adding a new signal. The item doesn't restate that constraint, so a fresh agent could satisfy the AC by changing `DerivedStatus`'s shape/signature — which spec 04 §1 forbids.
- **Suggested fix:** Add a constraint AC: "deriveStatus's signature is NOT changed (per 04 §1); the inspected directory + cross-root liveness are surfaced via the existing DerivedStatus fields (or a sibling helper callers invoke) — specify which in the spec test." Add a notes pointer to spec 04 §8 and the `stateSource: "none"` discriminator (surface, don't re-derive).
- **References:** 04-cli-monitoring-surface.md §1 (file table: "no deriveStatus signature change"), §8; backlog.json item 008
- **Checklist:** CHECK-B13, CHECK-B14

### V-006: Items 006 and 007 directly consume item 001 symbols but declare only a transitive dependency on it
- **Severity:** improvement
- **Location:** backlog.json items `006` (`dependsOn: ["003"]`) and `007` (`dependsOn: ["005","006"]`)
- **Issue:** Item 006 directly uses `EVENTS_SCHEMA_VERSION`, `TOKEN_COALESCE_MS`, `PersistedEvent` (created by item 001) but lists only `003`; item 007 uses `ActiveLoopEntry` (001) but lists `[005, 006]`. NOT a correctness gap — 003 depends on 001 and 005 depends on 001, so 001 is guaranteed complete before either can start (transitive closure holds, no cycle, ordering sound). Purely a traceability nit against the strict CHECK-B18 reading (declare every direct type-creator edge).
- **Suggested fix:** Optional. If `dependsOn` should capture every direct type-creator edge: set item 006 → `["001","003"]` and item 007 → `["001","005","006"]`. If `dependsOn` expresses only minimal ordering edges (transitive closure assumed), leave as-is — scheduling is unaffected (all priority 1, 001 is lowest).
- **References:** backlog.json items 001, 003, 005, 006, 007; tech-spec.md §3.1
- **Checklist:** CHECK-B18

## Fix Execution Plan

### User Decisions Required
- **V-003 (split item 009):** RESOLVED — user chose **split into 009a/009b**. 009a = additive follow surface (no removals); 009b = clean-break deletions, depends on 009a. Items 010 and 014 rewired to depend on 009b. Backlog now 15 items.
- **V-006 (strict vs minimal dependsOn):** RESOLVED — user chose **add explicit `001` edges**. Item 006 → `[001,003]`, item 007 → `[001,005,006]`.

### Execution Steps

#### Step 1: Tighten acceptance criteria & descriptions (directly applicable)
- **Files:** specs/ux-overhaul/backlog.json
- **Addresses:** V-001, V-002, V-004, V-005
- **Checklist:** CHECK-B12, CHECK-B13, CHECK-B14, CHECK-B25
- **Action:** Apply the four suggested-fix edits exactly as written above — item 014 (add silent-write-failure AC line), item 013 (reconcile title/description loci wording + git-commit.ts ownership note), item 012 (reword AC to exhaustive-switch contract + manual-SC-1 note), item 008 (add no-signature-change constraint AC + stateSource:"none" pointer). All are edits within backlog.json; no spec docs change. Re-run `rauf-stable backlog validate . --backlog specs/ux-overhaul --specs-dir specs/ux-overhaul --json` afterward to confirm still `valid: true`.
- **Depends on:** none
- **Rationale:** All four are non-structural string edits to a single file that sharpen verifiability without changing item count or dependency graph; safe to apply in one pass.

#### Step 2 (optional, gated on user decision): Split item 009
- **Files:** specs/ux-overhaul/backlog.json
- **Addresses:** V-003
- **Checklist:** CHECK-B11, CHECK-B25
- **Action:** Only if the user opts to split — replace item 009 with 009a (additive: new follow-command.ts + status/log --follow + -f parser) and 009b (clean-break deletions + test rewrites), set 009b `dependsOn` to include 009a, and update item 010 + 014 `dependsOn` references accordingly. Re-validate.
- **Depends on:** Step 1
- **Rationale:** Structural; changes item count and dependency edges, so isolate it from the safe string edits and only do it on explicit user request.

#### Step 3 (optional, gated on user decision): Make dependsOn edges explicit
- **Files:** specs/ux-overhaul/backlog.json
- **Addresses:** V-006
- **Checklist:** CHECK-B18
- **Action:** Only if the user opts in — item 006 `dependsOn` → `["001","003"]`, item 007 → `["001","005","006"]`. Re-validate.
- **Depends on:** Step 1
- **Rationale:** Cosmetic traceability; no behavior change.

## Fix Progress
- Step 1: [APPLIED] 2026-06-12 — item 014 +silent-write-failure AC (V-001); item 013 title reconciled + git-commit.ts ownership note (V-002); item 012 AC reworded to exhaustive-switch contract + manual-SC-1 note (V-004); item 008 +no-signature-change constraint AC + stateSource:"none" notes pointer (V-005). Re-validated: valid, 0 findings.
- Step 2: [APPLIED] 2026-06-12 — split item 009 → 009a (additive follow surface) + 009b (clean break, dependsOn 009a) per user decision; rewired item 010 (`009`→`009b`) and item 014 (`009`→`009b`). Backlog 14→15 items. Re-validated: valid, 0 findings; DAG intact.
- Step 3: [APPLIED] 2026-06-12 — explicit `001` edges added per user decision: item 006 `[003]`→`[001,003]`, item 007 `[005,006]`→`[001,005,006]`. Re-validated: valid, 0 findings.
