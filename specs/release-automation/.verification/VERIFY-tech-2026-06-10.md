# Verification Report: release-automation (tech)
Date: 2026-06-10
Pipeline Stage: forge-2-tech (v1) complete; forge-verify-tech in progress
Artifacts Reviewed: specs/release-automation/PRD.md (v2), specs/release-automation/tech-spec.md (v1)
Checks Executed: 17 of 17 (10 pass, 7 fail, 0 not-applicable)

## Summary
- Total findings: 9
- Gaps: 5
- Inconsistencies: 2
- Improvements: 2
- Errors: 0

## Findings

### V-001: REQ-PERF-01 (15-minute release budget) has no corresponding tech decision
- **Severity:** gap
- **Location:** tech-spec.md — no section addresses it; PRD.md §4.1 REQ-PERF-01 (P1)
- **Issue:** REQ-PERF-01 (P1) sets a SHOULD target of 15 minutes wall-clock for the full release (quality gate + 5 builds + publish). The tech spec's chosen topology — a single `ubuntu-latest` job running build, schema:check, typecheck, lint, format:check, full test suite, then five sequential cross-compiles, checksums, notes, and publish — is the primary determinant of whether that budget is met, yet no section discusses expected duration, the serial-vs-parallel tradeoff against the 15-min target, or what to do if it's exceeded. CHECK-T01 requires every P1 requirement to be traced; this one is not. The single-job decision (§3.3) is justified only on atomicity/simplicity grounds, never on the performance requirement it most directly affects.
- **Suggested fix:** Add a short subsection (e.g. §3.3 addendum or a new §3.13 "Release duration") stating the expected wall-clock breakdown (quality gate vs. five serial compiles vs. publish), confirming the single-job serial model is expected to fit within REQ-PERF-01's 15-minute SHOULD, and noting that if it is exceeded the documented fallback is the native-runner matrix (which parallelizes builds) — explicitly tying §3.3's "fallback" to the performance lever, not only to a Bun cross-compile regression.
- **References:** PRD.md §4.1 REQ-PERF-01, tech-spec.md §3.3, §3.4
- **Checklist:** CHECK-T01, CHECK-T03, CHECK-T17

### V-002: setup-bun version-pinning is described as a no-op for ci.yml, but ci.yml currently pins no Bun version
- **Severity:** inconsistency
- **Location:** tech-spec.md §3.9 and §2 (ci.yml MODIFIED entry)
- **Issue:** §3.9 states that adding `.bun-version` makes "CI matches local matches release" because `oven-sh/setup-bun@v2` auto-reads `.bun-version`. Verified against `.github/workflows/ci.yml`: its `oven-sh/setup-bun@v2` step has **no `bun-version` input at all** — it currently resolves to whatever Bun the action defaults to (latest). Introducing `.bun-version` (1.3.10) therefore *changes* the Bun version CI uses; it is not the inert "they already agree" framing the spec implies. The §2 module table lists ci.yml as MODIFIED only for "add `pnpm test` coverage of scripts," omitting that pinning Bun is itself an effective behavior change to CI's runtime.
- **Suggested fix:** In §3.9, reword to acknowledge that ci.yml does not currently pin Bun, so adding `.bun-version` newly pins CI to 1.3.10 (a deliberate change, not a confirmation of existing parity), and note that this should be validated by re-running CI after the pin lands. Optionally update the §2 ci.yml MODIFIED note to mention that `.bun-version` now governs CI's Bun version too.
- **References:** tech-spec.md §3.9, §2; .github/workflows/ci.yml lines 14-24
- **Checklist:** CHECK-T05, CHECK-T08, CHECK-T15

### V-003: "Full Changelog" prev-tag computation has no specified behavior for the first release
- **Severity:** gap
- **Location:** tech-spec.md §3.4 step 9 and §3.10
- **Issue:** §3.4 step 9 derives the previous tag via `git describe --tags --abbrev=0 vX.Y.Z^` "or 'first release' fallback," and §3.10 says the compare link is appended (REQ-NOTES-03). Verified: the only existing tag is `pre-rauf-rename`, and there are no `v*` tags — so the *first* `vX.Y.Z` release has no prior `v*` tag. `git describe --tags --abbrev=0 vX.Y.Z^` will, on this repo, match `pre-rauf-rename` (it's an ancestor) rather than returning nothing, producing a misleading `compare/pre-rauf-rename...vX.Y.Z` link instead of triggering the "first release" fallback. The spec's fallback assumes `git describe` fails when there's no prior tag, but here a non-`v` tag exists and will be picked up. The exact predicate for "first release" (e.g. match only `v*` via `--match 'v*'`, and what the notes show when there is no prior `v*` tag) is unspecified.
- **Suggested fix:** Specify in §3.4 step 9 / §3.10 that prev-tag lookup must be constrained to release tags, e.g. `git describe --tags --abbrev=0 --match 'v*' vX.Y.Z^`, and define the exact first-release behavior (omit the "Full Changelog" line entirely, or link `compare/<first-commit>...vX.Y.Z`). Call out explicitly that the existing non-release tag `pre-rauf-rename` must not be selected as a "previous release."
- **References:** tech-spec.md §3.4 step 9, §3.10; PRD.md REQ-NOTES-03; existing tags: `pre-rauf-rename` only
- **Checklist:** CHECK-T05, CHECK-T16

### V-004: REQ-VER-04 says "consistent with bump-version.sh validation," but the spec's regex is stricter than the actual bump-version.sh regex
- **Severity:** inconsistency
- **Location:** tech-spec.md §3.1 step 1 and §5.3 (`isValidVersion`), vs. §6.1 and actual scripts/bump-version.sh
- **Issue:** §3.1 step 1 and §5.3 give the validation regex as `^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$` and §3.1 claims it is the "same regex as the old `bump-version.sh`." Verified against scripts/bump-version.sh: its regex is `^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$`. These are equivalent in matching behavior (`\d` == `[0-9]`), so the *claim of sameness is fine* — but §6.1 separately and correctly quotes the bracket form, so the spec contains two different spellings of "the same regex" presented as identical, which a fresh agent could read as a discrepancy or copy the wrong one. More substantively: PREP guards require `Bun.semver` ordering (`Bun.semver.order`), and `Bun.semver` accepts versions this regex rejects (and vice-versa, e.g. build-metadata `+`), so the regex and the comparator have slightly different notions of "valid version" that the spec doesn't reconcile.
- **Suggested fix:** Normalize the regex to one spelling across §3.1, §5.3, and §6.1 (pick the bracket form `^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$` to literally match bump-version.sh). Add one sentence noting that `isValidVersion` (regex) is the gate and `compareVersions`/`Bun.semver.order` is only invoked on already-validated inputs, so the comparator's broader grammar is never reached — making the two consistent by construction.
- **References:** tech-spec.md §3.1, §5.3, §6.1; PRD.md REQ-VER-04; scripts/bump-version.sh (semver regex)
- **Checklist:** CHECK-T02, CHECK-T05

### V-005: `prepare.ts` git-mutation and push steps (6-10) have no error-handling / partial-failure strategy
- **Severity:** gap
- **Location:** tech-spec.md §3.1 (mutations 6-10) and §7 (Error Handling)
- **Issue:** §7 thoroughly covers the *guard* phase ("all guards evaluated before any mutation … leaving the repo untouched"), satisfying REQ-PREP-07 for pre-mutation failures. But the mutation/push phase (steps 6-10: write version.ts, edit six package.json files, roll changelog, `git add -A && commit`, `git tag`, `git push origin main`, `git push origin vX.Y.Z`) has no described behavior if a step fails *after* mutation has begun. Concrete gaps: (a) `git push origin main` succeeds but `git push origin vX.Y.Z` fails — main now carries a release commit with no tag pushed, an inconsistent intermediate state the maintainer must manually reconcile; (b) `git tag` succeeds but push fails — a local tag lingers and would trip the REQ-PREP-03 existence guard on retry. CHECK-T10 requires the error-handling strategy to cover propagation and recovery, not just the happy refusal path.
- **Suggested fix:** Add to §7 (and reference from §3.1) the failure semantics for steps 6-10: e.g. if any push fails, print an explicit recovery instruction (which local commit/tag now exist, how to retry or roll back), and clarify whether the two pushes are ordered tag-first or branch-first and why. State whether a failed push leaves the local tag in place (and that a retry must therefore tolerate or clean it) — this interacts directly with REQ-PREP-03's local-tag-existence guard.
- **References:** tech-spec.md §3.1 steps 6-10, §7; PRD.md REQ-PREP-01, REQ-PREP-03, REQ-PREP-07
- **Checklist:** CHECK-T10, CHECK-T16

### V-006: Concurrency setting prevents same-tag races but the cross-tag / stable-promotes-prerelease scenario is unaddressed
- **Severity:** gap
- **Location:** tech-spec.md §3.4 (concurrency) and §8 (testing approach)
- **Issue:** §3.4 sets `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }`, which serializes runs *for the same ref* only. The testing approach (§8) describes the canonical flow of cutting `v0.3.0-rc.1` and then promoting to `v0.3.0`. Those are two different refs, so they fall in different concurrency groups and can run concurrently. REQ-BUILD-04/05 require that publishing stable `v0.3.0` flips `latest`, while the prerelease must not. Nothing in the spec addresses what happens if a slow prerelease run and the stable run overlap, or — more importantly — whether `releases/latest/download/...` could momentarily resolve incorrectly. CHECK-T17 (scalability/concurrency) and CHECK-T16 (implementation surprises) both touch this.
- **Suggested fix:** Add a sentence to §3.4 or §3.7 confirming that because each release is a single atomic `gh release create` keyed to a distinct tag, overlapping runs for *different* tags cannot corrupt each other, and that `--latest` only ever attaches to the stable tag — so a prerelease run finishing after a stable run does not steal `latest`. If `gh release create --latest` does not guarantee this ordering-independence, state the mitigation (e.g. publish stable only after the prerelease run completes). Note this is a reasoning gap to close, not necessarily a code change.
- **References:** tech-spec.md §3.4, §3.7, §8; PRD.md REQ-BUILD-04, REQ-BUILD-05
- **Checklist:** CHECK-T16, CHECK-T17

### V-007: OTQ-1 leaves the tag-protection ruleset's actual configuration undefined, weakening the REQ-SEC-02 "primary" layer to a TODO
- **Severity:** gap
- **Location:** tech-spec.md §3.6 (Primary layer) and §10 OTQ-1; PRD.md REQ-SEC-02 (P0)
- **Issue:** REQ-SEC-02 (P0) explicitly designates the GitHub tag-protection ruleset as the **primary** authorization layer, with the workflow actor-check only as defense-in-depth. §3.6 and OTQ-1 acknowledge the ruleset is manual config "documented as a setup step," but the spec defines neither the exact ruleset (which rule type, applied to the `v*` tag pattern, restricting creation to whom) nor where the setup-step documentation lives, and OTQ-1 admits "until it exists, only the workflow actor-check … is active." That means a P0 security requirement's primary control is, per the spec's own words, not yet specified and possibly absent at first release — leaving only the defense-in-depth check, which the PRD framed as secondary. CHECK-T03 requires every P0 requirement to have a corresponding tech decision or an explicit, justified deferral; the ruleset half of REQ-SEC-02 is effectively deferred without that being called out as a deliberate, accepted gap.
- **Suggested fix:** In §3.6, specify the ruleset concretely: rule type (tag ruleset / "Restrict creations" on tag name pattern `v*`), the bypass/allowed actor (repo owner), and the doc location where the one-time setup step will be written (the install/release docs noted in §2). Either commit to creating the ruleset before the first release as a tracked setup task, or explicitly state in §10 that the first release may ship with only the defense-in-depth actor-check active and that this is an accepted, time-boxed gap against REQ-SEC-02's primary layer.
- **References:** tech-spec.md §3.6, §10 OTQ-1; PRD.md §4.2 REQ-SEC-02, §7 OQ-4
- **Checklist:** CHECK-T03, CHECK-T16

### V-008: Root `pnpm test` rewrite to `pnpm -r test && vitest run` needs the run-from-root behavior and config scoping pinned down
- **Severity:** improvement
- **Location:** tech-spec.md §6.3 and §2 (vitest.config.ts NEW)
- **Issue:** §6.3 rewrites the root `test` script from `pnpm -r test` to `pnpm -r test && vitest run` and adds a root `vitest` devDependency plus a root `vitest.config.ts`. Verified: root `test` is currently `pnpm -r test`; vitest ^3.0.0 already exists as a devDep in core/cli/loop/web but *not* at the root; each package's own `test` is `vitest run`. Two underspecified risks: (1) a root `vitest run` with a root config that isn't scoped to `scripts/release/**` could discover and re-run the four packages' `*.test.ts` (double-running them after `pnpm -r test`), inflating CI time and muddying REQ-PERF-01; (2) the root vitest must be a compatible major (the packages pin ^3.0.0) to avoid two vitest versions in the workspace. Neither the include-glob scoping nor the version alignment is stated.
- **Suggested fix:** In §6.3 (or the §2 vitest.config.ts entry), specify that the root `vitest.config.ts` `include` is restricted to `scripts/release/**/*.test.ts` (and excludes `packages/**`) so the root run covers only the new tests and does not re-run package suites, and that the root `vitest` devDependency pins the same major (`^3.0.0`) as the packages.
- **References:** tech-spec.md §6.3, §2; root package.json (`test`, scripts), packages/core/package.json (vitest ^3.0.0)
- **Checklist:** CHECK-T11, CHECK-T13, CHECK-T14

### V-009: Quality-gate "mirroring" of ci.yml is enforced only by convention, with no drift-detection mechanism
- **Severity:** improvement
- **Location:** tech-spec.md §3.4 step 6 and §6.3
- **Issue:** REQ-BUILD-06 requires the release workflow to run the same quality suite as ci.yml on the tagged commit. §3.4 step 6 lists the seven commands and §6.3 says mirroring is "maintained by keeping both workflows on the same step list." Verified: ci.yml's `check` job runs exactly install → build → schema:check → typecheck → lint → format:check → test, matching the spec. But "mirroring by keeping both lists the same" is a manual discipline with no guard: if a future contributor adds a step to ci.yml (say, a new `pnpm audit`), release.yml will silently diverge and a release could ship having skipped a check ci.yml enforces. The spec rejected a shared `test:scripts` step to avoid widening the synced list, but did not propose any mechanism to detect the divergence it concedes is possible. CHECK-T11/T16 flag this as an implementation-surprise risk.
- **Suggested fix:** Either (a) extract the seven-command sequence into a single reusable composite action / shared script (e.g. `scripts/ci-gate.sh` or a `.github/actions/quality-gate` composite) that both ci.yml and release.yml invoke, eliminating the duplicated list, or (b) if duplication is accepted, add an explicit note in §6.3 that any change to ci.yml's check steps must be mirrored into release.yml, and consider a lightweight CI assertion that the two step lists match. State which approach is chosen rather than relying solely on contributor discipline.
- **References:** tech-spec.md §3.4 step 6, §6.3; PRD.md REQ-BUILD-06; .github/workflows/ci.yml (check job steps)
- **Checklist:** CHECK-T11, CHECK-T16

## Fix Execution Plan

### User Decisions Required
- **V-007 (tag-protection ruleset):** **RESOLVED — block first release on ruleset.** The spec now (§3.6, §10 OTQ-1) specifies the ruleset concretely (tag ruleset, `v*`, "Restrict creations", owner-only bypass) and makes its creation a tracked prerequisite that gates the first `vX.Y.Z` release; shipping with only the defense-in-depth actor-check is explicitly disallowed.
- **V-009 (gate mirroring):** **RESOLVED — shared composite action.** The 7-command quality gate is extracted into `.github/actions/quality-gate/action.yml`, invoked by both `ci.yml` and `release.yml` (§6.3, §3.4 step 6, §2). Divergence is structurally impossible.
- All other findings (V-001 through V-006, V-008) applied directly with no decision needed.

### Execution Steps

#### Step 1: Fix factual/consistency issues in version validation and Bun-pinning prose
- **Files:** specs/release-automation/tech-spec.md (§3.1, §3.9, §5.3, §6.1, §2)
- **Addresses:** V-002, V-004
- **Checklist:** CHECK-T02, CHECK-T05, CHECK-T08, CHECK-T15
- **Action:** (V-004) Normalize the semver regex to the bracket form `^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$` everywhere it appears (§3.1 step 1, §5.3 `isValidVersion`, §6.1), and add a sentence clarifying that `isValidVersion` (regex) gates input before `compareVersions`/`Bun.semver.order` is ever called. (V-002) Reword §3.9 to state that ci.yml currently pins no `bun-version`, so adding `.bun-version` 1.3.10 newly pins CI (a deliberate change to validate via a CI re-run), not a confirmation of existing parity; optionally extend the §2 ci.yml MODIFIED note to mention `.bun-version` now governs CI's Bun.
- **Depends on:** none
- **Rationale:** Pure prose corrections grounded in verified source facts; no design decision needed, safe to do first.

#### Step 2: Close error-handling and edge-case gaps in the prep helper and notes logic
- **Files:** specs/release-automation/tech-spec.md (§3.1, §3.4 step 9, §3.10, §7)
- **Addresses:** V-003, V-005
- **Checklist:** CHECK-T05, CHECK-T10, CHECK-T16
- **Action:** (V-005) Add a "mutation/push failure" paragraph to §7 (referenced from §3.1) defining behavior when steps 6-10 fail mid-way: push ordering (tag vs. branch first), what local commit/tag state remains, the recovery message, and how a retry interacts with the REQ-PREP-03 local-tag guard. (V-003) In §3.4 step 9 / §3.10, constrain prev-tag lookup to release tags via `--match 'v*'`, define exact first-release behavior (omit the Full Changelog line or link from first commit), and explicitly exclude the existing `pre-rauf-rename` non-release tag.
- **Depends on:** none
- **Rationale:** Both are gap closures on independently-verified facts (existing tags, mutation sequence); grouped as the "robustness" edits.

#### Step 3: Add performance and concurrency reasoning sections
- **Files:** specs/release-automation/tech-spec.md (§3.3/§3.4 addendum, §3.7)
- **Addresses:** V-001, V-006
- **Checklist:** CHECK-T01, CHECK-T03, CHECK-T16, CHECK-T17
- **Action:** (V-001) Add a release-duration subsection tracing REQ-PERF-01: expected wall-clock breakdown, confirmation the single serial job is expected to fit 15 min, and an explicit link from the §3.3 native-runner fallback to the performance lever. (V-006) Add a sentence to §3.4 or §3.7 confirming distinct-tag runs cannot corrupt each other and that `--latest` only attaches to stable tags (or stating the mitigation if `gh` does not guarantee this).
- **Depends on:** none
- **Rationale:** Both add missing analysis sections; grouped as the "non-functional reasoning" edits.

#### Step 4: Scope the root vitest project
- **Files:** specs/release-automation/tech-spec.md (§6.3, §2 vitest.config.ts entry)
- **Addresses:** V-008
- **Checklist:** CHECK-T11, CHECK-T13, CHECK-T14
- **Action:** Specify that root `vitest.config.ts` `include` is restricted to `scripts/release/**/*.test.ts` and excludes `packages/**` (so package suites are not double-run after `pnpm -r test`), and that the new root `vitest` devDependency pins `^3.0.0` to match the packages.
- **Depends on:** none
- **Rationale:** Self-contained config-scoping clarification verified against existing vitest ^3.0.0 pins.

#### Step 5: Resolve the two decision-gated findings
- **Files:** specs/release-automation/tech-spec.md (§3.6, §10 OTQ-1; §3.4 step 6, §6.3)
- **Addresses:** V-007, V-009
- **Checklist:** CHECK-T03, CHECK-T11, CHECK-T16
- **Action:** After the user decisions: (V-007) specify the ruleset concretely (tag ruleset "Restrict creations" on pattern `v*`, owner bypass, doc location) and either commit to pre-release creation or document an accepted time-boxed gap in §10. (V-009) either replace the duplicated gate list with a shared composite action/script invoked by both workflows, or document an explicit sync rule + optional CI assertion in §6.3.
- **Depends on:** User decisions in "User Decisions Required"
- **Rationale:** Both require maintainer input on security posture and DRY-vs-duplication; sequenced last so the rest of the document is finalized independent of those calls.

---

Checks: Executed 17 of 17. Results: 10 pass, 7 fail, 0 not-applicable.

Pass: CHECK-T01 (partial — see V-001 for the one untraced P1), CHECK-T04, CHECK-T06, CHECK-T07, CHECK-T09, CHECK-T12, CHECK-T13, CHECK-T14, CHECK-T15.
Fail (findings raised): CHECK-T02 (V-004), CHECK-T03 (V-001/V-007), CHECK-T05 (V-002/V-003/V-004), CHECK-T08 (V-002), CHECK-T10 (V-005), CHECK-T11 (V-008/V-009), CHECK-T16 (V-003/V-005/V-006/V-007/V-009), CHECK-T17 (V-001/V-006).

## Fix Progress

- Step 1: [APPLIED] 2026-06-10 — V-004: normalized semver regex to bracket form in §3.1/§5.3 (matches §6.1/bump-version.sh) + added "isValidVersion is sole gate" sentence. V-002: reworded §3.9 to state `.bun-version` newly pins CI's Bun (deliberate change, validate via CI re-run); updated §2 ci.yml note.
- Step 2: [APPLIED] 2026-06-10 — V-005: added prep-helper mutation/push-phase failure semantics to §7 (branch-first ordering, per-command recovery messages, local-tag/REQ-PREP-03 interaction) + cross-ref from §3.1 step 10. V-003: constrained prev-tag lookup to `--match 'v*'` in §3.4 step 9 & §3.10, defined first-release behavior (omit Full Changelog line), explicitly excluded `pre-rauf-rename`.
- Step 3: [APPLIED] 2026-06-10 — V-001: added §3.13 "Release duration vs. REQ-PERF-01" with wall-clock breakdown table and explicit tie of the §3.3 native-runner fallback to the perf lever. V-006: added cross-tag concurrency reasoning to §3.7 (distinct-tag runs can't corrupt each other; `--latest` only on stable so prerelease timing can't steal latest).
- Step 4: [APPLIED] 2026-06-10 — V-008: scoped root `vitest.config.ts` include to `scripts/release/**/*.test.ts` excluding `packages/**` (no double-run), pinned root `vitest@^3.0.0` to match packages; updated §2 + §6.3 + §9.
- Step 5: [APPLIED] 2026-06-10 — V-009: extracted 7-command gate into `.github/actions/quality-gate/action.yml` used by both ci.yml + release.yml (§6.3, §3.4 step 6, §2). V-007: specified tag ruleset concretely + made it a first-release blocker (§3.6, §10 OTQ-1).
