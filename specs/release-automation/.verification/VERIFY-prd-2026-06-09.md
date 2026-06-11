# Verification Report: release-automation (prd)
Date: 2026-06-09
Pipeline Stage: forge-2-tech
Artifacts Reviewed: specs/release-automation/PRD.md (grounded against scripts/install-binary.sh, scripts/bump-version.sh, .github/workflows/ci.yml, package.json, packages/core/src/version.ts, packages/*/package.json, CHANGELOG.md)
Checks Executed: 15 of 15 (8 pass, 5 fail, 2 not-applicable)

## Per-Check Results
- CHECK-P01 (all template sections populated): **pass** — Problem, User Stories, Functional Reqs, NFRs, Constraints, Out of Scope, Open Questions, Success Criteria all present.
- CHECK-P02 (no TBD/TODO): **pass** — none found. (Factual-accuracy sub-check surfaced V-009.)
- CHECK-P03 (out-of-scope specific): **pass** — six concrete deferred items, each named.
- CHECK-P04 (open questions actionable): **pass** — all four OQs are concrete decisions; but see V-005 re: one that should be resolved now.
- CHECK-P05 (success criteria measurable): **pass** — nine numbered, verifiable criteria.
- CHECK-P06 (unique REQ IDs): **pass**.
- CHECK-P07 (priorities assigned): **pass** — every REQ has P0/P1/P2.
- CHECK-P08 (testable): **fail** — V-004 (REQ-SEC-02 "authorized releaser" not testable without OQ-4 resolved), V-007 (REQ-PERF-01 "roughly 15 minutes" soft).
- CHECK-P09 (no tech decisions outside constraints): **pass** — Bun/`--compile`, GITHUB_TOKEN, SHA256 appear, but all justified as existing-infra constraints (C-2, C-5) or integrity reqs.
- CHECK-P10 (user stories cover all actors): **pass** — Maintainer, End User, CI/Automation all covered.
- CHECK-P11 (NFRs quantified): **pass with note** — PERF-01 quantified (15 min); see V-007.
- CHECK-P12 (security explicit): **pass** — REQ-SEC-01/02/03 explicit.
- CHECK-P13 (mandates vs preferences): **pass** — MUST/SHOULD/nice-to-have used consistently; constraints labeled.
- CHECK-P14 (implicit requirements): **fail** — V-001, V-002, V-003, V-008 (docs-package lockstep, "current committed version" definition, cross-build verification, re-run vs leftover release).
- CHECK-P15 (requirement conflicts/tensions): **fail** — V-001 (lockstep claim contradicts reality), V-006 (Bun cross-build risk), V-008 (all-or-nothing vs re-runnable tension).
- Not-applicable: none formally; CHECK-P09 borderline but passed.

## Summary
- Total findings: 9
- Gaps: 4
- Inconsistencies: 2
- Improvements: 2
- Errors: 1

## Findings

### V-001: Lockstep version claim contradicts repo reality — `@rauf/docs` is not in lockstep
- **Severity:** inconsistency
- **Location:** PRD.md §3.2 REQ-VER-01, §1 (paragraph: "rewrites the version string in `version.ts` and five `package.json` files"), Constraint C-3
- **Issue:** REQ-VER-01 asserts `core, loop, cli, web, docs, and the root` all "share a single lockstep version." This is factually false in the current repo: root/core/cli/loop/web are at `0.2.0` but `packages/docs/package.json` is at `0.1.0` (confirmed). Worse, the helper "evolves from `bump-version.sh`" (REQ-PREP-06), and `bump-version.sh`'s `PACKAGE_FILES` array does NOT include `packages/docs/package.json` — so docs has never been bumped by the tool and would silently stay behind. The §1 prose also says "five `package.json` files," which is what `bump-version.sh` actually touches (root + 4 packages, excluding docs) — but that count contradicts REQ-VER-01's six-location lockstep set (root + 5 packages).
- **Suggested fix:** Resolve the contradiction explicitly. Either (a) state that `@rauf/docs` IS in lockstep and add a P0 requirement that the prep helper MUST bump `packages/docs/package.json` too (and note the existing drift from 0.1.0 must be corrected on first release), or (b) explicitly exclude docs from lockstep in REQ-VER-01 and Constraint C-3, and fix the §1 prose. Make the "five files" prose consistent with whichever package set is chosen.
- **References:** packages/docs/package.json (0.1.0), packages/{core,cli,loop,web}/package.json + root (0.2.0), scripts/bump-version.sh PACKAGE_FILES array (lines 33-39), packages/core/src/version.ts
- **Checklist:** CHECK-P14, CHECK-P15, CHECK-P09

### V-002: "Current committed version" is undefined when version locations disagree — weakens the drift guard
- **Severity:** gap
- **Location:** PRD.md §3.1 REQ-TRIGGER-02, §3.3 REQ-PREP-04, §3.2 REQ-VER-03
- **Issue:** REQ-TRIGGER-02 (the "single most important correctness invariant") requires the tag to equal "the version committed at the tagged commit (`version.ts` and all `package.json` files)." REQ-PREP-04 refuses if the target is not "strictly greater than the current committed version." Both treat "the committed version" as a single value, but there are six version locations that can disagree (and currently DO — see V-001). The PRD never specifies which location is authoritative for the comparison, nor whether the drift guard requires all six locations to be mutually equal before comparing to the tag.
- **Suggested fix:** Add to REQ-VER-03 / REQ-TRIGGER-02 that `packages/core/src/version.ts` `VERSION` is THE value used for both the tag-equality check and the "strictly greater" comparison, AND add an explicit requirement that the drift guard MUST also verify all `package.json` versions equal `version.ts` (fail the release if any location diverges), so the existing docs drift can't ship a half-consistent release. Constraint C-6 already names version.ts as canonical — make REQ-TRIGGER-02 cite it.
- **References:** PRD.md C-6, V-001, packages/core/src/version.ts
- **Checklist:** CHECK-P08, CHECK-P14

### V-003: No requirement covering Bun cross-compilation verification, despite it being the load-bearing assumption
- **Severity:** gap
- **Location:** PRD.md §3.5 REQ-BUILD-01, Constraint C-2
- **Issue:** REQ-BUILD-01 mandates building all five targets (linux-x64/arm64, darwin-x64/arm64, windows-x64), and C-2 fixes the build method to `bun build --compile`. But the entire feature hinges on `bun build --compile` being able to PRODUCE those cross-platform binaries — and the existing `pnpm compile` only builds for the current platform (`bun build --compile ... --outfile rauf-bin` with no `--target`). The PRD never states a requirement that cross-targeting must be proven to work, nor a fallback if a target (notably windows-x64 or darwin-arm64) cannot be cross-compiled from CI's `ubuntu-latest` runner. This is a requirements-level risk: if Bun cannot emit a working `windows-x64` or `darwin-*` binary from Linux, REQ-BUILD-01 + REQ-RELIABILITY-01 (all-or-nothing) make EVERY release impossible, not just Windows.
- **Suggested fix:** Add a requirement (or an Open Question if the answer is genuinely unknown) that the release workflow MUST produce each target via Bun's cross-target compilation, and call out the validated mechanism: Bun supports `bun build --compile --target=bun-<os>-<arch>` (e.g. `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`) from a single host. State that the tech spec MUST verify each `--target` value produces a runnable binary, and note the fallback (matrix of native runners — `ubuntu`, `macos`, `windows`) if any cross-target proves unviable. Flag windows-x64 and the darwin pair as the highest-risk targets to validate first.
- **References:** package.json `compile` script (line 20, single-target), scripts/install-binary.sh (asset naming this must match), PRD.md REQ-RELIABILITY-01, REQ-BUILD-02
- **Checklist:** CHECK-P14, CHECK-P15

### V-004: REQ-SEC-02 "authorized releaser" is not testable as written (depends on unresolved OQ-4)
- **Severity:** gap
- **Location:** PRD.md §4.2 REQ-SEC-02 (P0), Open Question OQ-4
- **Issue:** REQ-SEC-02 is a P0 mandate ("MUST verify the actor/tagger ... is an authorized releaser (the repo owner)") but OQ-4 leaves HOW "authorized releaser" is determined entirely open (hardcoded login vs owner-association lookup vs tag-protection ruleset). A P0 requirement whose enforcement mechanism is an open question cannot have an acceptance test written for it — you cannot test "rejects unauthorized actor" without knowing what defines authorization. Open-question status is fine for tech detail, but the load-bearing security control's BASIS should be decided at PRD time so the tech spec has a fixed target.
- **Suggested fix:** Promote the core decision out of OQ-4 into REQ-SEC-02: state the authorization basis (recommend: GitHub tag-protection/rulesets as the primary control, with the workflow actor-check as defense-in-depth, since a workflow-only check can't stop the tag from being created). Leave only the implementation nuance in OQ-4. Then REQ-SEC-02 becomes testable: "a tag pushed by a non-owner is blocked by the ruleset AND, if it reaches the workflow, the actor check fails the job."
- **References:** PRD.md REQ-SEC-01, REQ-SEC-03, Success Criteria #9
- **Checklist:** CHECK-P08, CHECK-P12, CHECK-P04

### V-005: OQ-1 (Windows install invocation) should be resolved at PRD time — it gates a P0 requirement
- **Severity:** improvement
- **Location:** PRD.md §7 OQ-1, §3.8 REQ-INSTALL-02 (P0)
- **Issue:** REQ-INSTALL-02 is P0 and mandates a Windows install path "via a one-line command." OQ-1 leaves the canonical invocation and hosting open. Unlike OQ-3 (Gatekeeper) and OQ-2 (checksum default), which are genuinely deferrable nuances, the existence and shape of the one-line command IS the P0 requirement's acceptance criterion. Leaving it fully open means Success Criterion #4 ("the Windows install script downloads the released binary") can't be concretely validated. The hosting pattern is also already determined by precedent: the Unix script is served from `raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh` (see the curl example in install-binary.sh line 27), so OQ-1's "where is it hosted" half is effectively already answered.
- **Suggested fix:** Resolve the hosting half of OQ-1 in REQ-INSTALL-02 (same `raw.githubusercontent.com/.../main/scripts/` pattern as the Unix script, confirmed by install-binary.sh's own documented curl invocation). Keep only the exact PowerShell idiom (`irm <url> | iex` vs `iwr`) as a genuinely-open nuance, or resolve it too. This makes REQ-INSTALL-02 testable.
- **References:** scripts/install-binary.sh line 27 (raw.githubusercontent hosting precedent), PRD.md Success Criteria #4
- **Checklist:** CHECK-P04, CHECK-P08

### V-006: Bun cross-build feasibility risk not captured as a requirements-level risk (paired with V-003)
- **Severity:** improvement
- **Location:** PRD.md §3.5, Constraint C-2 ("Existing infrastructure / team tooling")
- **Issue:** C-2 labels `bun build --compile` as "Existing infrastructure," which is true for single-platform compilation but misleading for the five-target matrix this feature introduces — cross-target compilation is NEW capability, not existing infra. The PRD presents the all-targets build as a settled constraint when it is actually the single biggest technical unknown of the feature (compounded by all-or-nothing semantics in REQ-RELIABILITY-01: one unbuildable target blocks all releases). There is no risk note acknowledging this.
- **Suggested fix:** Add a brief "Risks / Assumptions" note (or extend C-2) stating: "Assumption — `bun build --compile --target=...` can cross-build all five targets from a single CI host. This is unproven in this repo (current `compile` is single-target). If any target cannot be cross-built, the tech spec must fall back to a per-OS runner matrix. windows-x64 and darwin-* are the highest-risk targets." This makes the assumption visible to the tech-spec stage rather than buried as a 'constraint.'
- **References:** V-003, package.json line 20, PRD.md REQ-RELIABILITY-01
- **Checklist:** CHECK-P15, CHECK-P13

### V-007: REQ-PERF-01 target ("roughly 15 minutes") is soft and unverifiable as a pass/fail
- **Severity:** improvement
- **Location:** PRD.md §4.1 REQ-PERF-01 (P1)
- **Issue:** "SHOULD complete within roughly 15 minutes ... under normal conditions" mixes a quantified target (15 min) with two softeners ("roughly," "normal conditions") and no defined failure behavior. As written it cannot produce a pass/fail. As a P1 SHOULD this is acceptable, but the word "roughly" makes even a soft check ambiguous.
- **Suggested fix:** Drop "roughly" and state it as a soft budget: "SHOULD complete within 15 minutes wall-clock from tag push under normal CI conditions; exceeding this is a non-blocking signal to investigate, not a release failure." This keeps it P1/non-gating but verifiable.
- **References:** PRD.md REQ-OBS-01
- **Checklist:** CHECK-P11, CHECK-P08

### V-008: Tension between all-or-nothing (REQ-RELIABILITY-01) and safe re-runnability (REQ-RELIABILITY-03) is under-specified
- **Severity:** gap
- **Location:** PRD.md §3.7 REQ-RELIABILITY-01, REQ-RELIABILITY-02, REQ-RELIABILITY-03
- **Issue:** REQ-RELIABILITY-01 requires all artifacts built before the release is published (no partial release). REQ-RELIABILITY-02 forbids overwriting a PUBLISHED release. REQ-RELIABILITY-03 requires a failed run to be re-runnable "provided no published release yet exists." The unaddressed middle case: GitHub release creation is not atomic — a run can create a draft release, upload some assets, then fail. On re-run, does a leftover DRAFT (or partially-uploaded) release for the tag count as "no published release exists" (so re-run proceeds and must clean it up), or does any pre-existing release object block the re-run? REQ-RELIABILITY-02 only addresses non-draft/non-prerelease releases, leaving draft/prerelease leftovers in a gap.
- **Suggested fix:** Add a requirement clarifying re-run behavior against leftover non-published state: e.g., "A re-run MUST treat an existing DRAFT or incomplete (unpublished) release for the tag as re-usable/overwritable, deleting or recreating it so the final publish is complete; only a fully PUBLISHED stable/prerelease blocks re-run (REQ-RELIABILITY-02)." Alternatively require the workflow to build all assets in CI artifacts and create the GitHub release only once, atomically, at the end — which makes 'partial release object' impossible and should be stated explicitly as the chosen strategy.
- **References:** PRD.md REQ-RELIABILITY-02, Success Criteria #7
- **Checklist:** CHECK-P15, CHECK-P14

### V-009: §1 prose factual error — "five `package.json` files"
- **Severity:** error
- **Location:** PRD.md §1 Problem Statement, sentence: "`scripts/bump-version.sh` rewrites the version string in `version.ts` and five `package.json` files"
- **Issue:** `bump-version.sh` rewrites the root + 4 package files (root, core, cli, loop, web = 5 total package.json files). It does NOT touch `packages/docs/package.json` at all, so the implied "all packages" reading is wrong — docs is excluded. The "five" count pairs with the six-location lockstep set elsewhere (V-001), creating an internal inconsistency about how many version locations exist (5 vs 6).
- **Suggested fix:** Correct the prose to be precise: "rewrites the version string in `version.ts` and five `package.json` files (root, core, cli, loop, web — but NOT `packages/docs`)." This both fixes the count's ambiguity and surfaces the docs-exclusion that V-001 depends on.
- **References:** scripts/bump-version.sh lines 33-39, V-001
- **Checklist:** CHECK-P02 (factual accuracy), CHECK-P15

## Fix Execution Plan

### User Decisions Required
- **V-001 / V-002 (docs lockstep):** Decide whether `@rauf/docs` is in lockstep (helper must bump it + correct the existing 0.1.0 drift) or explicitly excluded. This choice drives the wording of REQ-VER-01, C-3, REQ-TRIGGER-02, and the §1 prose fix (V-009).
- **V-004 (authorized releaser basis):** Decide the authorization mechanism for REQ-SEC-02 (recommend tag-protection rulesets primary + workflow actor-check defense-in-depth). Needed before that P0 becomes testable.
- **V-008 (re-run vs leftover release):** Decide the strategy — atomic single-shot release creation vs. draft-then-publish with cleanup. Drives the new REQ-RELIABILITY wording.

### Execution Steps

#### Step 1: Resolve and align the version/lockstep model
- **Files:** specs/release-automation/PRD.md (§3.2 REQ-VER-01, §3.1 REQ-TRIGGER-02, §3.3 REQ-PREP-04, Constraint C-3, C-6, §1 prose)
- **Addresses:** V-001, V-002, V-009
- **Checklist:** CHECK-P14, CHECK-P15, CHECK-P08, CHECK-P02
- **Action:** Apply the user's V-001 decision. Update REQ-VER-01 + C-3 to state whether docs is in/out of lockstep. If in lockstep, add a P0 requirement that the prep helper bumps `packages/docs/package.json` and that the existing 0.1.0→aligned drift is corrected on first release. Add to REQ-VER-03/REQ-TRIGGER-02 that `version.ts` `VERSION` is THE value compared against the tag, and that the drift guard MUST verify every `package.json` equals `version.ts`. Fix the §1 prose per V-009 (precise file list, docs exclusion called out).
- **Depends on:** User decision V-001/V-002
- **Rationale:** All version-related findings share the same root contradiction; fixing them together keeps the document internally consistent.

#### Step 2: Add the Bun cross-build requirement + risk note
- **Files:** specs/release-automation/PRD.md (§3.5 REQ-BUILD-01 area, Constraint C-2)
- **Addresses:** V-003, V-006
- **Checklist:** CHECK-P14, CHECK-P15, CHECK-P13
- **Action:** Add a requirement that the workflow produces each target via `bun build --compile --target=bun-<os>-<arch>` (enumerate the five), that the tech spec must verify each produces a runnable binary, and that a per-OS native runner matrix is the fallback. Add a Risks/Assumptions note (or extend C-2) flagging cross-compilation as unproven in-repo and naming windows-x64 + darwin-* as highest risk, given all-or-nothing semantics.
- **Depends on:** none
- **Rationale:** Independent of the version model; surfaces the feature's biggest technical unknown before the tech-spec stage.

#### Step 3: Make the P0 security requirement testable
- **Files:** specs/release-automation/PRD.md (§4.2 REQ-SEC-02, §7 OQ-4)
- **Addresses:** V-004
- **Checklist:** CHECK-P08, CHECK-P12, CHECK-P04
- **Action:** Apply user's V-004 decision: move the authorization basis into REQ-SEC-02, leaving only implementation nuance in OQ-4. Ensure the requirement now supports an acceptance test (non-owner tag blocked).
- **Depends on:** User decision V-004
- **Rationale:** A P0 control must have a fixed enforcement basis before the tech spec designs it.

#### Step 4: Tighten install + perf + reliability requirements
- **Files:** specs/release-automation/PRD.md (§3.8 REQ-INSTALL-02 + §7 OQ-1; §4.1 REQ-PERF-01; §3.7 REQ-RELIABILITY-01/02/03)
- **Addresses:** V-005, V-007, V-008
- **Checklist:** CHECK-P04, CHECK-P08, CHECK-P11, CHECK-P15
- **Action:** (V-005) Resolve OQ-1's hosting half into REQ-INSTALL-02 using the existing `raw.githubusercontent.com/.../main/scripts/` precedent; keep only the PowerShell idiom open. (V-007) Reword REQ-PERF-01 to drop "roughly" and frame 15 min as a non-gating budget. (V-008) Apply user's re-run strategy decision and add the clarifying requirement covering leftover draft/unpublished releases.
- **Depends on:** User decision V-008 (for the reliability sub-step only); V-005 and V-007 have no dependency.
- **Rationale:** Groups the remaining lower-coupling clarity fixes; only the reliability piece needs a user decision.
