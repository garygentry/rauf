# Verification Report: forge-skill-spec-purity (prd)
Date: 2026-06-15
Pipeline Stage: forge-1-prd complete, forge-verify-prd pending
Artifacts Reviewed:
- `specs/agent-agnostic/forge-skill-spec-purity/PRD.md`
- `specs/agent-agnostic/epic-manifest.json` (contract cross-check)
- `/home/gary/workspace/feature-forge/` working tree (factual cross-check of §1/§3.3/§3.4 claims)

## Summary
- Total findings: 7
- Gaps: 1
- Inconsistencies: 2
- Improvements: 3
- Errors: 1

Executed 15 of 15 checks. Results: 8 pass, 7 fail, 0 not-applicable.

The PRD is unusually clean factually: the load-bearing counts in §1/§3.4 (11 skills, oversized
bodies 522/423/342, all five bundled scripts, `name == directory`, plugin manifest valid) all
verified exactly against the live `feature-forge` tree. The one factual **error** is that
REQ-VND-02 mandates removing Codex/Copilot/Cursor invocation directives from skill bodies, but
**zero such directives exist** today — the only real in-canon vendor constructs are
`argument-hint` (10 skills), `hooks.json`, and `${CLAUDE_PLUGIN_ROOT}` (~20–21, not "~20" exactly).
The most consequential structural issues are testability gaps where REQ-SIZE-01/03 and REQ-VER-01
hinge on a size budget that OQ-1 leaves unresolved, and the REQ-RES-03 locus list omitting a
`references/` file that does contain a `${CLAUDE_PLUGIN_ROOT}` occurrence.

## Findings

### V-001: REQ-VND-02 mandates removing Codex/Copilot/Cursor invocation directives that do not exist in any skill today
- **Severity:** error
- **Location:** PRD.md §3.2 REQ-VND-02 (and the same claim echoed in §1 and the epic charter)
- **Issue:** REQ-VND-02 states "Any other vendor-only directive discovered during the audit (Claude hook wiring, **and forward-looking Codex/Copilot/Cursor invocation policy**) MUST be removed from the canonical `SKILL.md` body and frontmatter." A direct grep of all 11 `SKILL.md` files in `/home/gary/workspace/feature-forge` finds **zero** occurrences of `codex`, `copilot`, `cursor`, or `gemini`, and the only top-level frontmatter keys present across the entire suite are `name` (11), `description` (11), and `argument-hint` (10). Claude hook wiring lives exclusively in `hooks/hooks.json` (already governed by REQ-VND-04), not in any body. So the "other vendor-only directive" clause describes constructs that do not exist — the audit will find nothing to remove there, making the requirement non-actionable as written and implying a phantom workstream.
- **Suggested fix:** Reword REQ-VND-02 to reflect reality: the only in-canon vendor constructs are `argument-hint` (handled by REQ-VND-01), `hooks.json` (REQ-VND-04), and `${CLAUDE_PLUGIN_ROOT}` (REQ-RES-03). Either (a) demote the Codex/Copilot/Cursor clause to a contingency — "IF the audit discovers any vendor invocation directive (none are known to exist today), it MUST be relocated/removed" — or (b) delete the speculative clause and keep REQ-VND-02 as the catch-all for whatever REQ-VND-03's exhaustive audit surfaces. Align §1's "Claude hook wiring" phrasing accordingly.
- **References:** PRD.md §1 (line 8), §3.2 REQ-VND-03/04, epic-manifest.json `forge-skill-spec-purity.charter`; verified against `/home/gary/workspace/feature-forge/skills/*/SKILL.md`
- **Checklist:** CHECK-P08, CHECK-P14, CHECK-P15

### V-002: REQ-RES-03 locus list omits `forge-verify/references/verification-checklists.md`, which contains a `${CLAUDE_PLUGIN_ROOT}` occurrence
- **Severity:** inconsistency
- **Location:** PRD.md §3.3 REQ-RES-03 Notes (line 58)
- **Issue:** REQ-RES-03 scopes "`SKILL.md` bodies, `references/`, and `hooks` invocations" and its Notes enumerate the loci as "`forge-0-epic`, `forge`, `forge-verify`, `forge-5-loop`, `forge-6-docs`, `forge-init`, `shared-conventions.md`, and `hooks.json`." Actual grep finds ~21 occurrences, including one at `skills/forge-verify/references/verification-checklists.md` — a `references/` surface explicitly in scope but absent from the enumerated list. The list names the `forge-verify` SKILL.md and `shared-conventions.md` but silently drops this second `references/` file. A fresh implementer working from this list could leave that occurrence unconverted and still believe the audit was exhaustive.
- **Suggested fix:** Add `forge-verify/references/verification-checklists.md` to the REQ-RES-03 Notes locus list (and note `references/shared-conventions.md` carries 2 occurrences). Better: replace the hand-maintained list with a directive that the implementation derive loci by grepping the tree, so the spec-purity checker (REQ-VER-01) is the source of truth rather than a frozen enumeration.
- **References:** verified loci in `/home/gary/workspace/feature-forge`: forge-0-epic(12), forge(3), forge-5-loop(1), forge-6-docs(1), forge-init(1), forge-verify SKILL(1), forge-verify/references/verification-checklists.md(1), references/shared-conventions.md(2) under `skills/` (~20), plus `hooks/hooks.json`(1) = ~21 total
- **Checklist:** CHECK-P08, CHECK-P14

### V-003: REQ-SIZE-01 and REQ-SIZE-03 are non-verifiable until OQ-1 fixes the budget; one is stated as containing a MUST clause
- **Severity:** gap
- **Location:** PRD.md §3.4 REQ-SIZE-01 / REQ-SIZE-03, and §8 Success Criterion 4
- **Issue:** REQ-SIZE-01 ("reduced to within the Agent Skills recommended size budget") and REQ-SIZE-03 ("A concrete, checkable size budget MUST be defined") both depend on the exact line/word budget that OQ-1 explicitly leaves open ("~500 lines / ~5k words" is only a *default*). No acceptance test for REQ-SIZE-01 can be written today: the boundary (e.g. could a body at 480 lines pass?) is undefined until OQ-1 resolves. REQ-SIZE-01 itself contains a hard MUST ("overflow detail MUST be moved into `references/`") gated on an undefined threshold of what counts as overflow. Success Criterion 4 ("within the defined size budget") inherits the same un-writable test. (OQ-1 itself is a legitimate open question and is NOT flagged — only the MUST-bearing requirements that cannot be tested until it resolves.)
- **Suggested fix:** Either (a) promote OQ-1's default (~500 lines / ~5k words body) into REQ-SIZE-03 as the binding budget so REQ-SIZE-01/03 and SC-4 become testable now, marking it provisional pending tech-spec confirmation; or (b) explicitly note on REQ-SIZE-01/03 and SC-4 that their acceptance gate is blocked on OQ-1 and the checker's size rule is parameterized, so the dependency is visible rather than implicit. Recommend (a) — the three named overruns (522/423/342) all exceed any plausible ~500 budget, so the default is safe to commit.
- **References:** PRD.md §7 OQ-1, §3.6 REQ-VER-01 (size budget compliance check), §8 SC-4
- **Checklist:** CHECK-P05, CHECK-P08

### V-004: REQ-VER-01 acceptance check ("size budget compliance") inherits the undefined budget — checker cannot be fully specified until OQ-1 resolves
- **Severity:** improvement
- **Location:** PRD.md §3.6 REQ-VER-01 (line 85), §8 Success Criterion 1
- **Issue:** REQ-VER-01 says the checker validates "size budget compliance," and REQ-VER-03/SC-1 make "checker runs green" the completion gate. But "size budget compliance" is undefined until OQ-1 (V-003). This is a transitive testability dependency: the feature's *primary acceptance gate* (the checker passing) cannot be authored until the budget number exists. Not an error — the intent is clear — but the dependency should be explicit so it isn't discovered mid-implementation.
- **Suggested fix:** Add a Note to REQ-VER-01 that its size rule is parameterized by the budget defined in REQ-SIZE-03 (resolved via OQ-1), so the checker's size assertion is a single configurable threshold. This pairs with the V-003 fix; resolving OQ-1's default unblocks both.
- **References:** PRD.md §3.4 REQ-SIZE-03, §7 OQ-1, §8 SC-1/SC-4
- **Checklist:** CHECK-P05, CHECK-P08

### V-005: REQ-SIZE-01 uses SHOULD while its sibling success criterion and REQ-VER treat size as a hard gate — mandate strength is inconsistent
- **Severity:** inconsistency
- **Location:** PRD.md §3.4 REQ-SIZE-01 ("SHOULD be reduced") vs §3.6 REQ-VER-01/03 + §8 SC-1/SC-4
- **Issue:** REQ-SIZE-01 deliberately uses "SHOULD be reduced to within the budget" (soft), while REQ-SIZE-02 uses MUST (preserve content) — that MUST/SHOULD split is sensible and likely intentional (you must not lose content; reducing size is the goal but soft). However, REQ-VER-01 lists "size budget compliance" as a checker assertion and REQ-VER-02 requires the checker to "exit non-zero … when canon is impure," with REQ-VER-03 making a green checker the *completion gate* and SC-1/SC-4 reaffirming it. That turns the SHOULD into a de-facto MUST: if the checker fails on an over-budget body, the feature cannot complete. So a P1 SHOULD is silently enforced as a hard P0 gate. The reader cannot tell whether an over-budget body blocks completion.
- **Suggested fix:** Decide and state explicitly: either (a) keep REQ-SIZE-01 as SHOULD and make the checker's size assertion a **warning** (non-failing) so it doesn't contradict the SHOULD — then SC-4 should say "the three named skills are reduced," not gated by the checker; or (b) if over-budget truly blocks completion, change REQ-SIZE-01 to MUST (for the three named skills at minimum) so it matches REQ-VER-03/SC-4. Recommend (b) scoped to the three known overruns, since SC-4 already treats them as a hard outcome.
- **References:** PRD.md §3.4 REQ-SIZE-02 (MUST), §3.6 REQ-VER-02/03, §8 SC-1/SC-4
- **Checklist:** CHECK-P13, CHECK-P07, CHECK-P15

### V-006: "Consumed by" frontmatter omits `packaging-docs-ci`, which the epic manifest declares as a second consumer of `spec-pure-skills`
- **Severity:** improvement
- **Location:** PRD.md header (line 4): "Consumed by: `forge-agent-adapters-build`"
- **Issue:** The PRD header names a single downstream consumer, but `epic-manifest.json` shows `packaging-docs-ci` also `consumes` `spec-pure-skills` ("Gated by the SKILL.md schema / spec-purity CI check"), and the PRD body itself acknowledges this (§2 user story for `packaging-docs-ci`, §3.6 REQ-VER-01 Notes "`packaging-docs-ci` wires this into CI later," §6 Out of Scope). The header's single-consumer line under-states the contract surface and is inconsistent with both the manifest and the PRD's own body.
- **Suggested fix:** Update the header line to "Consumed by: `forge-agent-adapters-build`, `packaging-docs-ci`" to match the manifest's `consumes` edges and the PRD body. (Note the manifest implies the resolver flows transitively into adapters; only `spec-pure-skills` is consumed by packaging-docs-ci, so the resolver consumer remains just `forge-agent-adapters-build`.)
- **References:** epic-manifest.json `packaging-docs-ci.consumes[ from: forge-skill-spec-purity ]`, PRD.md §2, §3.6 REQ-VER-01 Notes, §6
- **Checklist:** CHECK-P10, CHECK-P15

### V-007: REQ-RES-02 / REQ-RES-03 fallback wording is testably ambiguous about ordering and about what "routed through" permits
- **Severity:** improvement
- **Location:** PRD.md §3.3 REQ-RES-02 (line 54) and REQ-RES-03 (line 56)
- **Issue:** REQ-RES-02 specifies a 3-stage resolution order (own on-disk location → probe candidate roots → honored env vars including `${CLAUDE_PLUGIN_ROOT}`), which is testable. But REQ-RES-03 says each occurrence "MUST be replaced by (or routed through) the portable resolver, OR retained only as a documented fallback inside the resolver itself" — "routed through" and "retained as a documented fallback" are not crisply distinguishable, and REQ-VER-01's check ("no residual `${CLAUDE_PLUGIN_ROOT}` in canonical surfaces (outside the resolver's documented fallback)") needs an exact definition of which file(s) constitute "the resolver." Without naming the single resolver file, the checker can't mechanically decide whether a given `${CLAUDE_PLUGIN_ROOT}` is the sanctioned fallback or a violation — relevant because the resolver doesn't exist yet, so "inside the resolver" is forward-referential. Also note `hooks.json`'s `${CLAUDE_PLUGIN_ROOT}` (REQ-VND-04 leaves hooks.json as a non-canonical Claude artifact) — is that occurrence in scope for REQ-RES-03 or exempted as non-canonical? The two requirements don't reconcile this.
- **Suggested fix:** (1) State that the resolver is a single named file (deferred to OQ-2/tech spec) and that REQ-VER-01's "documented fallback" exemption applies only to that file. (2) Reconcile hooks.json: since REQ-VND-04 classifies it as non-canonical, explicitly exempt its `${CLAUDE_PLUGIN_ROOT}` from REQ-RES-03's "canonical surfaces" (or state it's converted too). (3) Drop the ambiguous "routed through" or define it as "the body calls the resolver instead of referencing the env var directly."
- **References:** PRD.md §3.2 REQ-VND-04, §3.6 REQ-VER-01, §7 OQ-2; hooks/hooks.json `${CLAUDE_PLUGIN_ROOT}` occurrence
- **Checklist:** CHECK-P08, CHECK-P15

## Per-Check Execution Log

- **CHECK-P01** (template sections populated): **pass** — Problem, User Stories, Functional Reqs, NFRs, Constraints, Out of Scope, Open Questions, Success Criteria all present and non-empty.
- **CHECK-P02** (no TBD/TODO): **pass** — grep for TBD/TODO/FIXME/XXX found none.
- **CHECK-P03** (out-of-scope specific): **pass** — §6 lists six concrete exclusions, each attributing scope to a named downstream feature.
- **CHECK-P04** (open questions actionable): **pass** — OQ-1/2/3 each have a concrete decision, a stated default, and a "→ tech spec" disposition.
- **CHECK-P05** (success criteria measurable): **fail** — SC-4 not measurable until OQ-1 fixes the budget (V-003); SC-1 inherits it (V-004).
- **CHECK-P06** (unique REQ IDs): **pass** — 28 requirements, all REQ-XXX-NN format, no duplicate IDs.
- **CHECK-P07** (priority on every req): **pass** — 28 requirements, 28 `Priority:` lines; P0/P1 used.
- **CHECK-P08** (testable): **fail** — REQ-SIZE-01/03, REQ-VER-01 non-verifiable pending OQ-1 (V-003/V-004); REQ-VND-02 non-actionable (V-001); REQ-RES-03 fallback ambiguity (V-007).
- **CHECK-P09** (no un-labeled tech decisions): **pass** — concrete tech choices deferred to OQ-1/OQ-2; the Agent Skills frontmatter set is labeled as constraint C-2 with justification.
- **CHECK-P10** (user stories cover actors): **fail** — §2 personas complete, but the header "Consumed by" omits packaging-docs-ci (V-006).
- **CHECK-P11** (NFRs quantified): **pass** — NFRs here are qualitative-by-nature; none have latency/throughput dimensions to quantify.
- **CHECK-P12** (security explicit): **pass** — REQ-SEC-01 explicitly bounds resolver path resolution and forbids sourcing untrusted paths.
- **CHECK-P13** (constraints distinguish must/should): **fail** — §5 uses clear MUST/SHOULD, but REQ-SIZE-01's SHOULD is silently enforced as a hard completion gate (V-005).
- **CHECK-P14** (implicit requirements): **fail** — missing references/ locus (V-002) and the speculative vendor-directive clause (V-001).
- **CHECK-P15** (conflicts/tensions): **fail** — SHOULD-vs-gate (V-005), hooks.json scope ambiguity (V-007), consumer-list drift (V-006).

## Fix Execution Plan

### User Decisions Required
- **V-003 / V-004 / V-005:** Resolve OQ-1's size budget direction — adopt the `~500 lines / ~5k words` default as the binding (provisional) budget now, *and* decide whether over-budget bodies hard-block completion (V-005 option b) or are warning-only (option a). These three findings cannot be fully applied without that one decision. Recommended default: commit the ~500-line budget provisionally and make it a hard gate scoped to the three named overruns.
  - **RESOLVED (2026-06-16):** Adopt **500 lines / 5,000 words** as the binding (provisional) body budget, enforced as a **hard gate scoped to the three named overruns** (`forge-0-epic`, `forge-5-loop`, `forge-verify`). REQ-SIZE-01 becomes MUST for those three; the checker fails on an over-budget body.
- **V-007:** Confirm whether `hooks.json`'s `${CLAUDE_PLUGIN_ROOT}` is converted by the resolver or exempted as a non-canonical Claude artifact (interacts with OQ-3). Recommended: exempt, consistent with REQ-VND-04.
  - **RESOLVED (2026-06-16):** **Exempt** — `hooks/hooks.json` is non-canonical (REQ-VND-04); its `${CLAUDE_PLUGIN_ROOT}` is out of scope for REQ-RES-03 and stays as a documented Claude artifact.

### Execution Steps

#### Step 1: Correct the factual vendor-construct claims
- **Files:** `specs/agent-agnostic/forge-skill-spec-purity/PRD.md`
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-P08, CHECK-P14
- **Action:** In REQ-VND-02, reword the "Codex/Copilot/Cursor invocation policy" clause to a contingency ("IF the audit surfaces any such directive — none exist in the current tree —"). In REQ-RES-03 Notes, add `forge-verify/references/verification-checklists.md` to the locus list and note `references/shared-conventions.md` carries 2 occurrences; or replace the frozen list with "derive loci by grepping `${CLAUDE_PLUGIN_ROOT}` across the tree (~21 occurrences as of authoring)."
- **Depends on:** none
- **Rationale:** Pure factual corrections, no user decision needed; do first so later edits build on accurate text.

#### Step 2: Resolve the size-budget testability chain
- **Files:** `specs/agent-agnostic/forge-skill-spec-purity/PRD.md`
- **Addresses:** V-003, V-004, V-005
- **Checklist:** CHECK-P05, CHECK-P08, CHECK-P13
- **Action:** Per the user decision above, write the chosen budget into REQ-SIZE-03 as binding-provisional; add a Note to REQ-VER-01 that its size rule is parameterized by REQ-SIZE-03; reconcile REQ-SIZE-01's SHOULD with the checker gate (either soften the checker's size assertion to a warning, or raise REQ-SIZE-01 to MUST for the three named skills); update §8 SC-4 wording to match.
- **Depends on:** Step 1 (and the user decision)
- **Rationale:** All three findings share the single OQ-1 decision; fix together to keep the size requirements internally consistent.

#### Step 3: Reconcile contract surface and resolver fallback wording
- **Files:** `specs/agent-agnostic/forge-skill-spec-purity/PRD.md`
- **Addresses:** V-006, V-007
- **Checklist:** CHECK-P10, CHECK-P15, CHECK-P08
- **Action:** Update header "Consumed by" to include `packaging-docs-ci` (matches epic-manifest.json). In §3.3, state the resolver is a single named file (deferred to OQ-2) and that REQ-VER-01's "documented fallback" exemption applies only to that file; per the user decision, explicitly exempt or convert `hooks.json`'s `${CLAUDE_PLUGIN_ROOT}`; drop/define the ambiguous "routed through."
- **Depends on:** Step 1
- **Rationale:** Both are contract-clarity edits in the header and §3.3; grouping keeps the consumer/contract story coherent.

## Fix Progress

- Step 1: [APPLIED] 2026-06-16 — Factual corrections. REQ-VND-02 reworded to a contingency (Codex/Copilot/Cursor invocation directives confirmed absent today; audit-driven catch-all retained). REQ-RES-03 Notes corrected to ~21 occurrences with accurate per-file loci including `forge-verify/references/verification-checklists.md` and `shared-conventions.md` (2); directs deriving loci by grep. Addresses V-001, V-002.
- Step 2: [APPLIED] 2026-06-16 — Size-budget testability chain. REQ-SIZE-03 now binds a provisional 500-line / 5,000-word body budget. REQ-SIZE-01 raised to P0/MUST (hard gate) for the three named overruns. REQ-VER-01 Notes state the size assertion is parameterized by REQ-SIZE-03 and is a hard failure. Per user decision (~500 lines, hard gate scoped to three overruns). Addresses V-003, V-004, V-005.
- Step 3: [APPLIED] 2026-06-16 — Contract surface + resolver fallback. Header "Consumed by" now lists `forge-agent-adapters-build` + `packaging-docs-ci` (matches epic manifest). REQ-RES-03 body scoped to canonical surfaces (SKILL.md bodies + references/), defined "routed through", named the single resolver file as the sole sanctioned fallback, and exempted non-canonical `hooks/hooks.json` (per user decision). REQ-VER-01 parenthetical and SC-4 updated to match. Addresses V-006, V-007.
