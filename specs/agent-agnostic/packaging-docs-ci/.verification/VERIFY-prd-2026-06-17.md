# Verification Report: packaging-docs-ci (prd)

- **Date:** 2026-06-17
- **Mode:** prd
- **Pipeline stage:** forge-2-tech (forge-1-prd complete)
- **Artifacts reviewed:** `specs/agent-agnostic/packaging-docs-ci/PRD.md`; epic charter (`EPIC.md` + `epic-manifest.json`); live state of `/home/gary/workspace/feature-forge` and `/home/gary/workspace/rauf` trees
- **Checks:** Executed 15 of 15 — 11 pass, 4 fail, 0 n/a

## Check Tally

| Check | Result | Note |
|---|---|---|
| CHECK-P01 (all template sections populated) | pass | §1–§8 all present and rich |
| CHECK-P02 (no TBD/TODO) | pass | none; OQ-* are legitimately deferred |
| CHECK-P03 (out-of-scope specific) | pass | §6 is 6 concrete, named exclusions |
| CHECK-P04 (open questions actionable) | pass | OQ-01..04 each names a concrete decision |
| CHECK-P05 (success criteria measurable) | **fail** | SC-08 not objectively verifiable — V-004 |
| CHECK-P06 (unique REQ IDs) | pass | all unique, REQ-{CAT}-NN form |
| CHECK-P07 (priority on every REQ) | **fail** | §5 REQ-CONST-01..04 + REQ-CONS-01..03 carry no Priority — V-003 |
| CHECK-P08 (testable) | pass (mostly) | weak cases folded into V-004/V-005 |
| CHECK-P09 (no smuggled tech decisions) | pass | GitHub Actions/shellcheck/ruff are in §5 Constraints w/ justification or labeled tool mandates |
| CHECK-P10 (stories cover all actors) | pass | new user, per-agent user, maintainer, contributor, downstream consumer |
| CHECK-P11 (NFRs quantified) | pass | REQ-PERF-01 "a few minutes"; acceptable for advisory target |
| CHECK-P12 (security explicit) | pass | REQ-SEC-01/02 explicit |
| CHECK-P13 (must vs should distinguished) | pass | consistent MUST/SHOULD/MAY usage |
| CHECK-P14 (implicit requirements) | **fail** | charter `consumes forge-loop-runner-contract` has no REQ — V-001 |
| CHECK-P15 (requirement conflicts) | **fail (minor)** | version-mismatch description factually wrong + gemini 0.0.0 unaddressed — V-002 |

**Charter contract-obligation coverage map:** READMEs → REQ-README-01/02/03 ✓; per-agent docs → REQ-DOCS-01/02/03 ✓; validate --strict → REQ-CI-01 ✓; SKILL schema name/desc + name==dir → REQ-CI-02 ✓; shellcheck/ruff → REQ-CI-03 ✓; trigger-accuracy evals → REQ-EVAL-01/02 ✓; OS-matrix dry-run+uninstall → REQ-CI-07/08 ✓; adapters regen-diff → REQ-CI-04 ✓; .gitattributes LF/export-ignore → REQ-OS-01 ✓; executable bits → REQ-OS-02 ✓; semver+CHANGELOG → REQ-VER-01/REQ-CHANGELOG-01 ✓; synced version headers → REQ-CI-05/REQ-VER-02 ✓ (SKILL.md exclusion deliberate, REQ-CONS-02); licensing → REQ-LIC-01/02 ✓ (MIT deviation deliberate, REQ-CONS-03). The three Charter Deviations are clearly justified. **One charter `consumes` item is uncovered** — V-001.

## Summary

- **Total findings:** 5 — gaps: 1, inconsistencies: 0, improvements: 2, errors: 2
- The four deliberate interview decisions (MIT, manifests-only version sync, rauf README shape, OOS items) are correctly recorded with rationale in REQ-CONS-01/02/03 + §6 and were **not** flagged. The substantive coverage gap is V-001; V-002/V-003 are factual/format errors worth fixing before the tech spec builds on them.

## Findings

### V-001: Charter `consumes` obligation `forge-loop-runner-contract` has no corresponding REQ
- **Severity:** gap
- **Location:** PRD.md §3.2 Per-Agent Setup Docs (REQ-DOCS-01..03); cross-ref `epic-manifest.json` `packaging-docs-ci.consumes[forge-loop-runner-contract]`
- **Issue:** The charter declares this feature **consumes** `forge-loop-runner-contract` with the obligation: *"Documented as the default forge↔rauf loop path in the per-agent docs."* Every other `consumes` item maps to a REQ (`cross-agent-installer-cli` → REQ-CI-07/REQ-README-03, `adapters-output` → REQ-CI-04, `spec-pure-skills` → REQ-CI-02/REQ-CONST-03), but the forge↔rauf loop contract is never required to be documented. REQ-DOCS-03 only covers "install + first use" — not that forge-5-loop defaults to rauf. "loop"/"forge-loop"/"loop-runner-contract" appears nowhere in §3.1/§3.2. Genuine charter-obligation gap, not one of the deliberate Charter Deviations.
- **Suggested fix:** Add a P1 requirement — **REQ-DOCS-04: Per-agent docs document the default forge↔rauf loop path.** "At least one doc (per-agent setup docs and/or the feature-forge README) MUST explain that forge-5-loop defaults to rauf as its loop runner and how agent selection flows forge→rauf, satisfying the charter's `consumes forge-loop-runner-contract` obligation." Add/extend a success criterion (SC-02) to cover it.
- **References:** `epic-manifest.json` consumes block; `EPIC.md` line 185; PRD.md §3.2
- **Checklist:** CHECK-P14, CHECK-P08

### V-002: Version-mismatch description names the wrong files; real mismatch is plugin.json vs marketplace.json, and gemini 0.0.0 is unaddressed
- **Severity:** error
- **Location:** PRD.md §1 Problem Statement ("Packaging is inconsistent…"), REQ-VER-02, REQ-CI-05
- **Issue:** The PRD says the mismatch is "`.claude-plugin` manifest `0.9.0` vs `plugin.json` `0.10.0`." Verified against the live tree this is wrong two ways: (1) **There is no root `plugin.json`** — the only `plugin.json` is `.claude-plugin/plugin.json` and it holds `0.10.0`; the `0.9.0` lives in `.claude-plugin/marketplace.json`. The PRD mislabels which file holds which value and references a non-existent root file. (2) REQ-CI-05 lists `gemini-extension.json` in feature-forge's synced set, but `adapters/gemini/gemini-extension.json` is `0.0.0` — a **third** desynced value the PRD never mentions, so an implementer could reconcile two files and leave the third broken while satisfying REQ-VER-02's literal text.
- **Suggested fix:** In §1 and REQ-VER-02, correct to "`.claude-plugin/plugin.json` (`0.10.0`) vs `.claude-plugin/marketplace.json` (`0.9.0`)". Add `adapters/gemini/gemini-extension.json` (currently `0.0.0`) to REQ-VER-02's reconciliation set so it agrees with REQ-CI-05's three-file scope. Note that `gemini-extension.json` is a generated adapter (DO-NOT-EDIT per REQ-MAINT-01), so reconciliation happens at the generator/source, not by hand-edit — flag for the tech spec.
- **References:** live `/home/gary/workspace/feature-forge/.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json:11`, `adapters/gemini/gemini-extension.json:7`; PRD.md REQ-CI-05, REQ-VER-02, REQ-MAINT-01
- **Checklist:** CHECK-P15, CHECK-P08

### V-003: Constraints and Charter-Deviation requirements carry no Priority
- **Severity:** error
- **Location:** PRD.md §5 (REQ-CONST-01..04) and §5 Charter Deviations (REQ-CONS-01..03)
- **Issue:** CHECK-P07 requires every requirement to carry a priority. All §3/§4 REQs do; the seven REQs in §5 do not. They share the `REQ-{CAT}-NN` form, so by the checklist they need a priority or an explicit exemption statement.
- **Suggested fix:** Add a one-line note at the top of §5: "Constraints (REQ-CONST-*) are P0 mandates by definition; Charter-Deviation records (REQ-CONS-*) document decisions and carry no independent priority." (Lighter than annotating each.)
- **References:** PRD.md §5; CHECK-P07
- **Checklist:** CHECK-P07

### V-004: SC-08 (and partially SC-01) success criterion is not objectively verifiable as written
- **Severity:** improvement
- **Location:** PRD.md §8 SC-08, SC-01
- **Issue:** SC-08 is phrased hypothetically ("A user *could* follow…"). The parenthetical names a method (walk the dry-run path) but the pass condition is subjective. SC-01 has a similar soft clause ("match their required shape"). Given the §6 done-bar is "authored + locally validated," these should state the concrete local check that constitutes a pass.
- **Suggested fix:** Reword SC-08 to: "Each install command/path in both READMEs is executed in a local dry-run (installer `--dry-run`, marketplace path resolved, every referenced doc/adapter path `ls`-confirmed to exist); zero stale or failing instructions." Pin SC-01 to REQ-README-03's "every command/path resolves to a real artifact" check; drop or bind the soft "match their required shape" to the REQ-README-01 a/b/c ordered list.
- **References:** PRD.md §8 SC-01, SC-08; REQ-README-03; §6 done-bar
- **Checklist:** CHECK-P05, CHECK-P08

### V-005: "First screen" / "within the first screen" is an unmeasurable acceptance bar
- **Severity:** improvement
- **Location:** PRD.md §2 (user story 1), REQ-README-01
- **Issue:** REQ-README-01 requires the README to "open (within the first screen)" with the three install elements in order. "First screen" is viewport-dependent and not objectively testable. Ordering and presence (a→b→c) are testable; "first screen" is not.
- **Suggested fix:** Replace "within the first screen" with a deterministic bound, e.g. "before the first non-install `##`-level section after the title" (or "within the first N lines"). Keep the ordered a/b/c list as the verifiable core so a docs-lint or reviewer can check it deterministically.
- **References:** PRD.md §2 story 1, REQ-README-01, SC-01
- **Checklist:** CHECK-P08, CHECK-P05

## Fix Execution Plan

### User Decisions Required

- **V-002 / OQ-02:** Confirm the single reconciled feature-forge version (OQ-02 already flags `0.10.0` as likely), and whether `gemini-extension.json` `0.0.0` is reconciled at the generator/source vs. expected to track the manifest version — this affects REQ-VER-02's wording. All other fixes apply directly.

### Execution Steps

#### Step 1: Correct the version-mismatch facts and widen reconciliation scope
- **Files:** `specs/agent-agnostic/packaging-docs-ci/PRD.md` (§1 Problem Statement, REQ-VER-02, REQ-CI-05)
- **Addresses:** V-002 — **Checklist:** CHECK-P15, CHECK-P08
- **Action:** Replace "`.claude-plugin` manifest `0.9.0` vs `plugin.json` `0.10.0`" everywhere with "`.claude-plugin/plugin.json` (`0.10.0`) vs `.claude-plugin/marketplace.json` (`0.9.0`)". In REQ-VER-02 add `adapters/gemini/gemini-extension.json` (currently `0.0.0`) to the set that MUST be reconciled, noting it is a generated adapter (reconcile at source). Resolve OQ-02 first.
- **Rationale:** Factual correctness of the central problem statement gates everything downstream; do it first.

#### Step 2: Add the missing forge↔rauf loop-documentation requirement
- **Files:** PRD.md (§3.2, §8)
- **Addresses:** V-001 — **Checklist:** CHECK-P14, CHECK-P08
- **Action:** Add REQ-DOCS-04 (P1) requiring per-agent docs / README to document the default forge↔rauf loop path and forge→rauf agent selection. Update/extend SC-02 to cover it.

#### Step 3: Add priority-exemption note to §5
- **Files:** PRD.md (§5 Constraints + Charter Deviations)
- **Addresses:** V-003 — **Checklist:** CHECK-P07
- **Action:** Add the §5 header note (constraints = P0 by definition; REQ-CONS-* = decision records, no independent priority).

#### Step 4: Tighten unmeasurable success criteria and acceptance bars
- **Files:** PRD.md (§8 SC-01/SC-08; §2 story 1; REQ-README-01)
- **Addresses:** V-004, V-005 — **Checklist:** CHECK-P05, CHECK-P08
- **Action:** Reword SC-08 to the concrete local dry-run + path-existence check; pin SC-01 to REQ-README-03's resolvable-artifact check; replace "within the first screen" with a deterministic bound, keeping the a/b/c ordering as the verifiable core.
