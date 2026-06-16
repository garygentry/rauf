# Verification Report: forge-skill-spec-purity (tech)
Date: 2026-06-16
Pipeline Stage: forge-2-tech (complete) → forge-verify-tech
Artifacts Reviewed:
- specs/agent-agnostic/forge-skill-spec-purity/PRD.md
- specs/agent-agnostic/forge-skill-spec-purity/tech-spec.md
- (cross-checked against live source under /home/gary/workspace/feature-forge: SKILL.md bodies, scripts/validate.sh, tests/conftest.py)

## Summary
- Total findings: 7
- Gaps: 4
- Inconsistencies: 0
- Improvements: 2
- Errors: 1

Verification coverage: Executed 17 of 17 tech-mode checks (CHECK-T01–T17). Results: 11 pass, 5 fail, 1 n/a.

| Check | Result | Check | Result | Check | Result |
|---|---|---|---|---|---|
| CHECK-T01 | pass | CHECK-T07 | fail (V-007) | CHECK-T13 | fail (V-002) |
| CHECK-T02 | pass | CHECK-T08 | fail (V-005) | CHECK-T14 | fail (V-004) |
| CHECK-T03 | pass | CHECK-T09 | pass | CHECK-T15 | pass |
| CHECK-T04 | pass | CHECK-T10 | pass | CHECK-T16 | fail (V-006) |
| CHECK-T05 | fail (V-001) | CHECK-T11 | fail (V-003) | CHECK-T17 | n/a (static tooling refactor; no scalability dimension) |
| CHECK-T06 | pass | CHECK-T12 | pass | | |

> Note (not re-raised as a finding): the pre-existing `plugin.json` `0.10.0` vs `marketplace.json` `0.9.0` version mismatch is correctly identified and deferred to `packaging-docs-ci` in tech-spec §6. Left out of scope here intentionally.

## Findings

### V-001: forge-0-epic body line count is wrong (511 stated, 517 actual)
- **Severity:** error
- **Location:** tech-spec.md §1 decision D1 (line ~20) AND §3.3 body-size table (line ~128) — both state `forge-0-epic` = `511`.
- **Issue:** The §3.3 audit table is presented as ground truth ("verified across all 11 skills") and D1's margin argument depends on it. Re-measuring the live source confirms the other two over-budget figures (`forge-5-loop` 418, `forge-verify` 337) and the next-largest margin (`forge-2-tech` 192) are correct, but `forge-0-epic`'s body (content below the closing frontmatter `---`) is **517 lines, not 511** (`skills/forge-0-epic/SKILL.md` is 522 total lines; 5 frontmatter/fence lines → 517 body). The figure is off by 6 in two places. This is a factual error in an audit table that downstream specs and the checker's reduction targets will trust verbatim.
- **Suggested fix:** Change `511` → `517` in both occurrences: the D1 bullet in §1 ("`forge-0-epic` 511" → "`forge-0-epic` 517") and the §3.3 table row (`| forge-0-epic | 511 | 3,594 |` → `| forge-0-epic | 517 | 3,594 |`). Optionally add a one-line note that body counts are line-of-spec-authorship time and the checker re-measures at gate time (mirrors the §3.2 "do not trust counts, re-grep at impl time" caveat). Re-confirm the `3,594` word count too while editing (it was not independently re-measured here).
- **References:** PRD.md REQ-SIZE-01..03, OQ-1; tech-spec.md §1 D1, §3.3; live `skills/forge-0-epic/SKILL.md`
- **Checklist:** CHECK-T05

### V-002: Executable-bit requirement for the two new scripts is unspecified
- **Severity:** gap
- **Location:** tech-spec.md §2 (module structure, the two NEW `scripts/` entries) and §3.2 / §3.4 (deliverable definitions for `forge-root.sh` and `check-spec-purity.py`).
- **Issue:** Two runtime gates depend on `scripts/forge-root.sh` being executable, but the spec never states it must carry the executable bit. (1) The §3.2 bootstrap prelude gates discovery on `[ -x "$d/scripts/forge-root.sh" ]` — a non-executable resolver is silently invisible to the prelude, so `$R` ends up empty and every skill invocation dies with "cannot locate plugin root" even though the file exists. (2) `feature-forge/scripts/validate.sh` carries a permission-check step that enforces `+x` on shipped scripts. A new script added without `chmod +x` (and without the permission step being told about it) is a latent, hard-to-debug failure that won't surface until a skill is actually run under an agent.
- **Suggested fix:** Add an explicit deliverable note in §2 (or §3.2/§3.4) that `scripts/forge-root.sh` and `scripts/check-spec-purity.py` MUST be created mode `0755` (executable), and that the backlog item creating each must `chmod +x` it and confirm it is picked up by `validate.sh`'s permission-check step. If `validate.sh`'s permission check uses an explicit allow-list of scripts, note that both new scripts must be added to it.
- **References:** tech-spec.md §2, §3.2 (prelude `-x` test), §3.4, §6 (`validate.sh`); live `feature-forge/scripts/validate.sh` permission step
- **Checklist:** CHECK-T08, CHECK-T13

### V-003: Test coverage for the resolver's own resolution logic is left "optional"
- **Severity:** gap
- **Location:** tech-spec.md §8 Testing Approach (the `scripts/forge-root.sh` bullet) and §3.4 rule 5.
- **Issue:** `forge-root.sh` implements P0 logic — the 4-step resolution order (self-location → candidate probe → env fallback → actionable failure, REQ-RES-02/03/04) and the `is_root()` sentinel test. §8 covers it only "indirectly by the green checker run + manual verification," and calls a direct shell test "optional." But the checker (§3.4) verifies the *canon's* purity (no residual var, prelude byte-identity); it does **not** exercise the resolver's branch logic. So the feature's most behaviorally-load-bearing new artifact has no automated coverage of: env-fallback path, the failure exit-1 + stderr message (REQ-RES-04), or the `is_root` sentinel. Likewise §3.4 rule 5 asserts prelude byte-identity in one direction (each occurrence matches canon) but the test plan (§8) does not state that the checker is fed a *drifted* prelude fixture to prove the rule actually fails — only "drifted prelude" is listed among impure fixtures without tying it to both directions.
- **Suggested fix:** In §8, promote at least a minimal automated check of `forge-root.sh` from "optional" to required: a small shell/bats (or pytest-driving-subprocess) test asserting (a) exit 0 + correct stdout when invoked from inside an install dir, (b) exit 1 + the exact stderr message when no root is discoverable and `CLAUDE_PLUGIN_ROOT` is unset, (c) env-fallback success path. Tie §3.4 rule 5 to a concrete both-directions test in §8: a clean fixture (identical prelude → pass) AND a drifted-prelude fixture (→ non-zero, file/reason reported). If a fully-automated resolver test is genuinely infeasible in CI, state that explicitly and define the manual smoke steps as the gate instead of leaving it "optional."
- **References:** PRD.md REQ-RES-02..05, REQ-VER-01..03; tech-spec.md §3.2, §3.4 (rule 5), §8
- **Checklist:** CHECK-T11

### V-004: Candidate-root list is duplicated with no single-source maintenance procedure
- **Severity:** gap
- **Location:** tech-spec.md §3.2 (resolver step 2 "maintained list of known install roots" + the prelude's `for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge`), §10 TQ-1.
- **Issue:** The set of candidate install roots is the feature's only real configuration surface, and it exists in **two** places: the resolver's step-2 probe list and the bootstrap prelude's `for d in …` loop. §10 TQ-1 acknowledges the duplication is "inherent to the bootstrap" and is "checker-guarded for identity" — but the checker only guards prelude *byte-identity across occurrences* (REQ-MAINT-01); it does **not** guard that the prelude's candidate set stays in sync with the resolver's. When `cross-agent-installer` later adds a per-agent install dir, an editor must update both lists, and nothing detects drift between resolver-list and prelude-list. The spec leaves "where the canonical candidate list lives and how the two copies are kept in sync" implicit.
- **Suggested fix:** Add a short subsection (or a TQ-1 resolution note) naming a single documented maintenance procedure: e.g. "the prelude is intentionally a minimal bootstrap subset (`$HOME` Claude paths only) and delegates authoritative resolution to `forge-root.sh`; when adding an install root, update `forge-root.sh` step-2 first, then extend the prelude only if the new root is needed for *bootstrap discovery of forge-root.sh itself*." State explicitly whether the checker should (now or in a follow-up) assert the prelude's candidate set is a subset of the resolver's, or accept that this remains a manual-review item. This removes the ambiguity about which list is authoritative.
- **References:** PRD.md REQ-RES-02/05, REQ-MAINT-01; tech-spec.md §3.2, §3.4 (rule 5), §10 TQ-1
- **Checklist:** CHECK-T14, CHECK-T16

### V-005: validate.sh integration ordering and hard-fail-vs-skip semantics are ambiguous
- **Severity:** improvement
- **Location:** tech-spec.md §3.4 ("Wired into `validate.sh` as a new step"), §6 (`validate.sh` bullet: "non-fatal-skip pattern available if desired, but purity is a hard gate").
- **Issue:** The spec says `check-spec-purity.py` is added "as a new step" but does not pin **where** in the existing `validate.sh` step sequence it runs (before/after `py_compile`, before/after `pytest`), nor confirm the gate semantics unambiguously. §6 hedges: "non-fatal-skip pattern available if desired, but purity is a hard gate" — leaving a reader unsure whether the checker step may be skipped when (e.g.) Python tooling is degraded, the way `pytest` is allowed to no-op when absent. For a hard gate, "skip when X" and "fail the whole script on non-zero" are materially different behaviors and the implementer needs the rule stated, not "available if desired."
- **Suggested fix:** State the placement and semantics concretely: e.g. "insert the `check-spec-purity.py` step immediately after the `py_compile` step and before `pytest`; it runs unconditionally (python3 stdlib only, always available) and a non-zero exit fails `validate.sh` immediately (`set -e`)—unlike the `pytest` step it is **never** soft-skipped." Remove the "available if desired" hedge from §6 so there is one prescribed behavior.
- **References:** tech-spec.md §3.4, §6, §7; live `feature-forge/scripts/validate.sh` (existing py_compile/pytest steps)
- **Checklist:** CHECK-T08, CHECK-T10, CHECK-T15

### V-006: Hand-rolled stdlib frontmatter reader is unproven against real/post-transform shapes
- **Severity:** improvement
- **Location:** tech-spec.md §3.4 (minimal hand-rolled reader: `^[A-Za-z][\w-]*:` at column 0 = top-level key; indented = nested), §8 (test fixtures).
- **Issue:** The checker deliberately avoids pyyaml and parses frontmatter with a regex/indentation heuristic. The design correctly anticipates the `metadata:` → nested `argument-hint` case, but the heuristic has untested edges that real frontmatter can hit: quoted values containing a colon (`description: "foo: bar"`), multi-line/folded scalars (`description: >` / `|`), values that themselves contain a leading `---`, blank lines inside the block, and BOM/CRLF. A false negative (heuristic mis-reads a malformed block as clean) defeats REQ-FM-04; a false positive (flags a legal description as a disallowed key) blocks a clean canon. §8 lists rule-targeted impure fixtures but not adversarial frontmatter-shape fixtures for the reader itself.
- **Suggested fix:** Add to §8 a small set of reader-robustness fixtures: a `description` whose value contains a colon and/or is a quoted/folded scalar, a frontmatter block with blank lines, and a CRLF file — each asserting the reader extracts the correct top-level key set. In §3.4, state the reader's documented assumptions explicitly (e.g. "only column-0 `key:` lines are treated as top-level keys; quoted/folded scalar *values* on continuation lines are not re-scanned for keys") so the implementer codes to a defined contract rather than an example.
- **References:** PRD.md REQ-FM-01/03/04; tech-spec.md §3.4, §4 (frontmatter schema), §8
- **Checklist:** CHECK-T11, CHECK-T16

### V-007: Prelude's exec-in-command-substitution means first-resolver-wins, but the spec reads as iterating
- **Severity:** gap
- **Location:** tech-spec.md §3.2 (bootstrap prelude code block, the `for d in …; do [ -x … ] && exec "$d/scripts/forge-root.sh"; done` line).
- **Issue:** The prelude's `exec` inside the `$(…)` command substitution means the **first** candidate directory containing an executable `forge-root.sh` replaces the subshell and produces `$R` — the loop can never advance to a second candidate, and the resolver it `exec`s is the sole authority for the final answer. This is almost certainly correct-by-design (consistent with D2: the prelude is a thin bootstrap that delegates to `forge-root.sh`, which itself does the real multi-candidate probe). But the surrounding prose ("iterate a maintained list", "candidate set covers the only current consumer", "extended as per-agent install dirs land") reads as if the prelude itself iterates and tries multiple roots. A future editor could wrongly "fix" the prelude to keep looping past the first match, or add a second candidate expecting fallback behavior the `exec` precludes. The first-resolver-wins semantics are an undocumented invariant.
- **Suggested fix:** Add one sentence to §3.2 immediately after the prelude block: "The `exec` makes this *first-discoverable-resolver-wins*: the prelude stops at the first directory with an executable `forge-root.sh` and delegates ALL final root resolution to that script (which performs the real multi-candidate probe per §3.2 step 1–4). The prelude's `for` list is a discovery order for *forge-root.sh itself*, not a fallback chain for the plugin root." This defaults V-007 to documenting the intended behavior (no behavior change), so no user decision is required.
- **References:** tech-spec.md §1 D2, §3.2; PRD.md REQ-RES-02/05
- **Checklist:** CHECK-T07, CHECK-T16

## Fix Execution Plan

### User Decisions Required
None — all fixes can be applied directly. V-007 defaults to documenting the intended first-resolver-wins behavior (consistent with D2); V-005 prescribes the conventional hard-gate placement. No spec value is genuinely contested.

### Execution Steps

Apply in order. All steps edit the single file `specs/agent-agnostic/forge-skill-spec-purity/tech-spec.md` unless noted; they are grouped to avoid overlapping edits to the same section.

#### Step 1: Correct the forge-0-epic body-line figure (error fix)
- **Files:** specs/agent-agnostic/forge-skill-spec-purity/tech-spec.md
- **Addresses:** V-001
- **Checklist:** CHECK-T05
- **Action:** Replace `511` with `517` in both places: (a) the §1 D1 bullet — change "`forge-0-epic` 511" to "`forge-0-epic` 517"; (b) the §3.3 table row — change `| forge-0-epic | 511 | 3,594 |` to `| forge-0-epic | 517 | 3,594 |`. (Verified against live `skills/forge-0-epic/SKILL.md`: 522 total lines, 517 body lines below the closing frontmatter `---`. The other rows — forge-5-loop 418, forge-verify 337, forge-2-tech 192 — were re-measured and are correct; leave them.) Optionally append to the §3.3 prose: "body counts are authorship-time measurements; the checker re-measures at gate time (cf. §3.2 'do not trust counts, re-grep at impl time')."
- **Depends on:** none
- **Rationale:** Factual correction first; it is isolated and unblocks trusting the audit table for downstream reduction targets.

#### Step 2: Pin executable-bit requirement for the two new scripts
- **Files:** specs/agent-agnostic/forge-skill-spec-purity/tech-spec.md
- **Addresses:** V-002
- **Checklist:** CHECK-T08, CHECK-T13
- **Action:** In §2 (module-structure NEW entries for `forge-root.sh` and `check-spec-purity.py`) or §3.2/§3.4, add an explicit note: both new scripts MUST be created executable (mode 0755); the backlog item creating each must `chmod +x` it and verify it is recognized by `validate.sh`'s permission-check step (add both to that step's script list if it is an explicit allow-list). Call out the concrete failure mode: the §3.2 prelude's `[ -x … ]` test silently skips a non-executable `forge-root.sh`, yielding an empty `$R` and a "cannot locate plugin root" error despite the file existing.
- **Depends on:** none
- **Rationale:** Closes a latent runtime-failure gap that both the prelude and validate.sh depend on; independent of the §3.2 prose edits in later steps.

#### Step 3: Document first-resolver-wins + candidate-list maintenance in §3.2
- **Files:** specs/agent-agnostic/forge-skill-spec-purity/tech-spec.md (§3.2, §10 TQ-1)
- **Addresses:** V-007, V-004
- **Checklist:** CHECK-T07, CHECK-T14, CHECK-T16
- **Action:** (V-007) Immediately after the §3.2 bootstrap-prelude code block, add a sentence stating the `exec`-in-`$(…)` makes it *first-discoverable-resolver-wins*: the prelude stops at the first dir with an executable `forge-root.sh` and delegates all final resolution to that script; the `for` list is a discovery order for forge-root.sh itself, not a plugin-root fallback chain. (V-004) Add (in §3.2 or as a TQ-1 resolution note) the single-source maintenance procedure: `forge-root.sh` step-2 is the authoritative candidate list; the prelude is intentionally a minimal `$HOME`-Claude bootstrap subset; when adding an install root, update `forge-root.sh` first and extend the prelude only if needed for bootstrap discovery of forge-root.sh. State whether the checker should assert prelude-set ⊆ resolver-set or leave it manual-review.
- **Depends on:** none (but grouped because both touch §3.2 — apply together to avoid conflicting edits)
- **Rationale:** Both findings clarify the same §3.2 invariant surface; documenting them together prevents a future editor from "fixing" the prelude loop or drifting the two candidate lists.

#### Step 4: Pin validate.sh placement + hard-gate semantics
- **Files:** specs/agent-agnostic/forge-skill-spec-purity/tech-spec.md (§3.4, §6)
- **Addresses:** V-005
- **Checklist:** CHECK-T08, CHECK-T10, CHECK-T15
- **Action:** In §3.4 and §6, replace the hedged "non-fatal-skip pattern available if desired, but purity is a hard gate" with a single prescribed behavior: insert the `check-spec-purity.py` step at a named position in `validate.sh` (e.g. after `py_compile`, before `pytest`); it runs unconditionally (python3 stdlib, always present) and any non-zero exit fails `validate.sh` immediately under `set -e` — never soft-skipped, unlike the `pytest` step.
- **Depends on:** none
- **Rationale:** Removes integration ambiguity so the implementer wires one deterministic gate behavior.

#### Step 5: Strengthen the testing approach (resolver + reader robustness)
- **Files:** specs/agent-agnostic/forge-skill-spec-purity/tech-spec.md (§8, with cross-refs into §3.4)
- **Addresses:** V-003, V-006
- **Checklist:** CHECK-T11, CHECK-T16
- **Action:** (V-003) In §8, promote resolver coverage from "optional" to required: a minimal shell/bats or pytest-subprocess test asserting forge-root.sh's (a) exit-0 + stdout from inside an install dir, (b) exit-1 + exact stderr message when no root is discoverable and CLAUDE_PLUGIN_ROOT is unset, (c) env-fallback success. Tie §3.4 rule 5 to a concrete both-directions test: clean-prelude fixture passes AND a drifted-prelude fixture fails with file/reason. If full CI automation is infeasible, say so and define the manual smoke steps as the gate instead of "optional." (V-006) Add reader-robustness fixtures: a `description` value containing a colon and/or a quoted/folded scalar, a block with blank lines, and a CRLF file — each asserting correct top-level key extraction; and document the reader's assumptions in §3.4 (only column-0 `key:` lines are top-level; continuation/quoted scalar values are not re-scanned for keys).
- **Depends on:** none
- **Rationale:** Both findings harden §8; grouped as the single testing-strategy edit so the spec's test plan is internally coherent.

## Fix Progress

- Step 1: [APPLIED] 2026-06-16 — V-001: corrected `forge-0-epic` body count 511→517 in §1 D1 and §3.3 table; added authorship-time/checker-authoritative caveat to §3.3.
- Step 2: [APPLIED] 2026-06-16 — V-002: added executable-bit (0755) requirement for `forge-root.sh` + `check-spec-purity.py` to §2, with the prelude `-x` silent-skip failure mode called out.
- Step 3: [APPLIED] 2026-06-16 — V-007 + V-004: added §3.2 bullets documenting first-discoverable-resolver-wins (`exec` invariant) and single-source candidate-list maintenance (resolver authoritative; prelude is bootstrap subset; subset-check is manual-review).
- Step 4: [APPLIED] 2026-06-16 — V-005: pinned `check-spec-purity.py` step placement (after py_compile, before pytest) and unconditional hard-fail-under-`set -e` semantics in §3.4 and §6; removed the "non-fatal-skip available if desired" hedge.
- Step 5: [APPLIED] 2026-06-16 — V-003 + V-006: §8 promotes resolver coverage to required (3 assertions) and adds both-directions prelude-identity test + reader-robustness fixtures; §3.4 documents the frontmatter reader's assumptions.
