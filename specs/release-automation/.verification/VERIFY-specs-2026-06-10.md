# Verification Report: release-automation (specs)
Date: 2026-06-10
Pipeline Stage: forge-4-backlog (verifying forge-3-specs output)
Artifacts Reviewed: PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-shared-lib.md, 03-prepare-helper.md, 04-ci-preflight-and-workflow.md, 05-install-scripts.md, 06-security-and-setup.md, 07-testing-strategy.md, TRACEABILITY.md
Checks Executed: 38 of 38 (33 pass, 4 fail, 1 not-applicable)

## Summary
- Total findings: 5
- Gaps: 0
- Inconsistencies: 1
- Improvements: 3
- Errors: 1

This is a high-quality, third-pass spec suite (PRD v2, tech-spec v1, both prior verifications applied). Traceability is clean: `validate-traceability.py` re-confirms **40/40 requirements covered, 0 uncovered, 0 orphaned references**. Every TypeScript signature, import path, file reference, package.json, regex, git tag, and the `Bun.semver.order` semantics in the specs were checked against actual repo source and resolve correctly — except for the items below. The one substantive bug is a real correctness defect in a pure, spec'd function (`extractSection`); the rest are a count inconsistency and minor self-containment improvements.

## Findings

### V-001: Quality gate mislabeled "7-command" / "seven-command" — it is 6 commands
- **Severity:** inconsistency
- **Location:** tech-spec.md (line 26 module-tree comment, §6.3 line 280), 01-architecture-layout.md (§1 tree line 29, §3.2 line 140), 04-ci-preflight-and-workflow.md (§Verification line 265)
- **Issue:** The shared quality-gate composite action is repeatedly described as the "7-command quality gate" / "seven-command list," but the enumerated sequence is exactly **six** commands: `pnpm build → pnpm schema:check → pnpm typecheck → pnpm lint → pnpm format:check → pnpm test`. The actual `action.yml` spelled out in 04 §5 has exactly six `run:` steps, and the real `ci.yml` `check` job (verified) has these same six inline steps. There is no seventh command anywhere. The count "7"/"seven" is factually wrong in five places.
- **Suggested fix:** Replace "7-command"/"seven-command" with "6-command"/"six-command" (or simply "quality gate," dropping the count) in all five locations. Recommend dropping the numeric prefix entirely to avoid re-drift if a step is ever added/removed — e.g. "the shared quality gate (`build → schema:check → typecheck → lint → format:check → test`)".
- **References:** Real `ci.yml` check job (6 steps), 04 §5 composite action (6 run steps), root `package.json` scripts (all six resolve)
- **Checklist:** CHECK-S05, CHECK-S08, CHECK-S12

### V-002: `extractSection` heading-escape regex is broken — version dots act as wildcards
- **Severity:** error
- **Location:** 02-shared-lib.md, §5.3 (`extractSection`), the line ``const headingRe = new RegExp(`^## ${v.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`);``
- **Issue:** The character class `/[.*+?^${}()|[\\]\\\\]/g` is malformed: the `\\]` closes the character class early, so the intended metacharacter set is not matched and the replacement inserts **no** escapes. Verified empirically under Bun: for `v = "0.3.0-rc.1"`, `v.replace(...)` returns the unmodified string `"0.3.0-rc.1"`, producing the regex `^## 0.3.0-rc.1\s*$` in which every `.` is a wildcard — `re.test("## 0X3X0-rcX1")` returns `true`. This means `extractSection` can match the wrong heading (any string differing only at the `.` positions). The collision risk on real changelogs is low, but this is a factual defect in a pure function the release notes depend on (REQ-NOTES-02), and the spec presents it as working code. (Note: `getUnreleasedBody` and `rollChangelog` use a static `/^## Unreleased\s*$/` and are unaffected — only the version-interpolating `extractSection` has this flaw.)
- **Suggested fix:** Replace the escape with the standard MDN-idiom form `v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`. Verified under Bun that this correctly escapes the dots (`escaped → "0\\.3\\.0-rc\\.1"`) so `re.test("## 0X3X0-rcX1")` returns `false` while `re.test("## 0.3.0-rc.1")` stays `true`. Optionally add a `lib.test.ts` case asserting `extractSection` does not match a heading that differs only at a `.` position.
- **References:** 02 §5.3, 07-testing-strategy.md §2.1 (extractSection test cases), 04 §3 step 9 (build-notes.ts consumes extractSection)
- **Checklist:** CHECK-S09, CHECK-S18, CHECK-S37

### V-003: `build-notes.ts` snippet omits its import block (less self-contained than the prepare.ts snippet)
- **Severity:** improvement
- **Location:** 04-ci-preflight-and-workflow.md, §3 "Step 9 detail — build-notes.ts" (lines ~197–217)
- **Issue:** The `build-notes.ts` code block references `extractSection` and `REPO_SLUG` (from `lib.ts`/00) and `execFileSync`, `fs`, `path` (node builtins) with no `import` statements shown. By contrast, the 03 `prepare.ts` snippet explicitly shows `import { execFileSync } from "node:child_process";`. A fresh agent implementing `build-notes.ts` from this snippet has to infer the imports. The 04 Dependencies section does list which symbols come from where, so it is recoverable, but the inline code is not directly implementable as-shown.
- **Suggested fix:** Prepend an import block to the build-notes.ts snippet, e.g. `import * as fs from "node:fs"; import * as path from "node:path"; import { execFileSync } from "node:child_process"; import { extractSection, REPO_SLUG } from "./lib";` — mirroring the self-contained style of the 03 prepare.ts snippet.
- **References:** 04 §3 step 9, 03 §2 (import-style precedent), 02 (lib exports), 00 §2.3 (REPO_SLUG)
- **Checklist:** CHECK-S10, CHECK-S17, CHECK-S26

### V-004: First-release `Bun.semver.order` version-forward guard against `0.2.0` is not called out, though it works
- **Severity:** improvement
- **Location:** 03-prepare-helper.md §2.4, 02-shared-lib.md §4.2 (`compareVersions`)
- **Issue:** The version-forward guard (`compareVersions(version, current) !== 1`) compares the target against the canonical `version.ts` value, which is currently `0.2.0` (verified). For the first real release the maintainer must therefore pick a version strictly greater than `0.2.0` (e.g. `0.3.0` or `0.2.1`), even though `docs/package.json` is at `0.1.0`. The specs correctly use the *canonical* value (not the drifted docs value), and the worked example in 03 §5 uses `0.3.0`, so behavior is right — but the interaction "first release must exceed 0.2.0, not 0.1.0" is implicit. This is the kind of edge a fresh implementer or maintainer could trip on. (Not a correctness defect — `Bun.semver.order("0.3.0","0.2.0") === 1` confirmed.)
- **Suggested fix:** Add one sentence to 03 §2.4 (or the §5 worked example): "The comparison is always against the canonical `version.ts` value (currently `0.2.0`), never the drifted `docs` `0.1.0` — so the first release must be strictly greater than `0.2.0`." Optionally add a `prepare.test.ts` predicate case: target `0.2.1` vs current `0.2.0` → accept.
- **References:** 03 §2.4, 03 §5, 02 §4.2, 06 §4 checklist item 2 (drift correction)
- **Checklist:** CHECK-S02, CHECK-S28, CHECK-S38

### V-005: `git-status.ts:71` line reference points at the `execGit` helper, not `checkLoopPreconditions`
- **Severity:** improvement
- **Location:** 03-prepare-helper.md, §2 (line 50): "mirrors `checkLoopPreconditions`' `execFile("git", …)` pattern (`packages/loop/src/git-status.ts:71`)"
- **Issue:** Verified against source: `checkLoopPreconditions` is declared at line ~21; line 71 is the private `execGit` helper declaration, and the actual `execFile("git", …)` call is at line 73. The `:71` is approximately right (it lands in the function that wraps `execFile`) but slightly imprecise, and line-number references drift as the file changes. The durable anchor is the function name, which is already given.
- **Suggested fix:** Either drop the `:71` (the function name `checkLoopPreconditions` / `execGit` is the stable anchor) or correct it to the `execGit`/`execFile` call site (~line 73). Low priority — purely a precision nit.
- **References:** packages/loop/src/git-status.ts (checkLoopPreconditions @21, execGit/execFile @71–73)
- **Checklist:** CHECK-S14, CHECK-S15

## Checks with notable clean results (verified, no finding)

- **CHECK-S09 (type validity):** `VersionLocation`, `ReleaseTarget`, `PreparePlan` are valid TS with full JSDoc on every field. The `canonical: boolean` field is consistently used in `readVersionLocations`/preflight/prepare.
- **CHECK-S12 (no conflicting defs):** `SEMVER_RE`, `PACKAGE_JSON_PATHS`, `RELEASE_TARGETS`, `REPO_SLUG`, `PINNED_BUN_VERSION` defined once in 00, re-stated (not redefined) in 01/02 with explicit "single definition site" notes. `SEMVER_RE` matches the real `bump-version.sh` regex byte-for-byte.
- **CHECK-S14/S26 (file/import refs):** All cross-referenced spec filenames exist; `version.ts`, `git-status.ts`, `binary-entry.ts`, `install-binary.sh` (`detect_asset`/`RAUF_REPO`/URL scheme), six `package.json` files, `scripts/generate-json-schemas.ts` (schema:check target) all resolve. `.github/actions/` correctly does NOT exist yet (marked NEW).
- **CHECK-S18–S21 (error handling):** `fail()` model, prep guard refusals, push-phase recovery (both branch-fail and tag-fail paths), preflight drift messages, checksum mismatch/missing-tool/unreachable paths, and re-release refusal are all specified with concrete user-facing messages.
- **CHECK-S27 (concurrency):** Cross-tag concurrency (prerelease vs stable `--latest` stealing) reasoned through in 04 §3 notes and tech §3.7.
- **CHECK-S33–S37 (testing):** 07 exists; unit/manual split is explicit; fixture factories (`makeChangelog`, `makeRepoFixture`) defined; coverage targets stated (100% lib branches); the workflow-YAML/git-mutation coverage gap is flagged explicitly rather than hidden.
- **Workflow YAML correctness:** `gh release create … $( [ "$IS_PRERELEASE" = "true" ] && echo --prerelease || echo --latest )` verified to emit the correct flag in both branches under `set -euo pipefail`; `--verify-tag`, `contents: write`, `concurrency` keyed on `github.ref`, `fetch-depth: 0`, and `INPUT_TAG` wiring are all sound.
- **Install-script logic:** `detect_asset()` output (`rauf-{os}-{arch}`) matches `RELEASE_TARGETS[*].asset`; checksum insertion point (`before install -m 0755`), grep/awk extraction, and hard-fail-on-mismatch semantics are consistent with the real script structure.

## Fix Execution Plan

### User Decisions Required
None — all five fixes can be applied directly. (V-002 has one correct replacement; V-001/V-003/V-004/V-005 are mechanical edits.)

### Execution Steps

#### Step 1: Fix the `extractSection` escape regex (correctness)
- **Files:** specs/release-automation/02-shared-lib.md (§5.3), specs/release-automation/07-testing-strategy.md (§2.1)
- **Addresses:** V-002
- **Checklist:** CHECK-S09, CHECK-S18, CHECK-S37
- **Action:** In the `extractSection` body, replace `v.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")` with `v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`. In 07-testing-strategy.md §2.1, add an `extractSection` case asserting it does NOT match a heading differing only at a `.` position (e.g. `## 0X3X0-rcX1` must not match version `0.3.0-rc.1`).
- **Depends on:** none
- **Rationale:** Sole substantive correctness defect; isolated to one function and its test case.

#### Step 2: Correct the quality-gate command count
- **Files:** specs/release-automation/tech-spec.md, specs/release-automation/01-architecture-layout.md, specs/release-automation/04-ci-preflight-and-workflow.md
- **Addresses:** V-001
- **Checklist:** CHECK-S05, CHECK-S08, CHECK-S12
- **Action:** Replace every occurrence of "7-command"/"seven-command" with "6-command"/"six-command" (or drop the count and refer to "the quality gate (`build → schema:check → typecheck → lint → format:check → test`)"). Locations: tech-spec.md line 26 and §6.3; 01 §1 tree comment and §3.2; 04 §Verification.
- **Depends on:** none
- **Rationale:** Pure terminology correction across files; grouping all edits in one pass avoids partial fixes.

#### Step 3: Make the build-notes.ts snippet self-contained and clarify the first-release version floor
- **Files:** specs/release-automation/04-ci-preflight-and-workflow.md (§3 step 9), specs/release-automation/03-prepare-helper.md (§2.4 / §5)
- **Addresses:** V-003, V-004
- **Checklist:** CHECK-S02, CHECK-S10, CHECK-S17, CHECK-S26, CHECK-S28
- **Action:** (a) Prepend an import block to the build-notes.ts snippet in 04 §3 step 9: `import * as fs from "node:fs"; import * as path from "node:path"; import { execFileSync } from "node:child_process"; import { extractSection, REPO_SLUG } from "./lib";`. (b) Add one clarifying sentence to 03 §2.4 (or §5): the version-forward comparison is against the canonical `version.ts` value (currently `0.2.0`), not the drifted docs `0.1.0`, so the first release must exceed `0.2.0`.
- **Depends on:** none
- **Rationale:** Two small self-containment/clarity improvements in adjacent helper specs; no behavioral change.

#### Step 4: Loosen the `git-status.ts` line reference (optional precision nit)
- **Files:** specs/release-automation/03-prepare-helper.md (§2, line 50)
- **Addresses:** V-005
- **Checklist:** CHECK-S14, CHECK-S15
- **Action:** Drop the `:71` from `packages/loop/src/git-status.ts:71` (rely on the function name as the durable anchor), or correct it to the `execFile` call site (~line 73).
- **Depends on:** none
- **Rationale:** Lowest priority; line-number references are drift-prone. Optional.

---

Checks: Executed 38 of 38. Results: 33 pass, 4 fail, 1 not-applicable.

The 1 not-applicable: CHECK-S31 observability-via-PRD — the PRD's REQ-OBS-01/02 are GitHub-Actions-UI/summary visibility, fully covered by 04 §3 steps 11 and the named-step job design; there is no application-level logging/metrics/tracing surface for this build-tooling feature, so the "logging/metrics/tracing approach" sub-clause does not apply.

## Fix Progress

- Step 1: [APPLIED] 2026-06-10 — V-002: fixed `extractSection` escape regex in 02 §5.3 (`/[.*+?^${}()|[\]\\]/g` — dots now escaped, no longer wildcards); added the regex-escape test case to 07 §2.1.
- Step 2: [APPLIED] 2026-06-10 — V-001: corrected "7-command"/"seven-command" → 6-command/six-command in all 5 locations (tech-spec.md ×2, 01 ×2, 04 ×1).
- Step 3: [APPLIED] 2026-06-10 — V-003: prepended the import block to the build-notes.ts snippet in 04 §3 step 9. V-004: added a note to 03 §2.4 that the version-forward comparison is against canonical version.ts (0.2.0), not the drifted docs 0.1.0.
- Step 4: [APPLIED] 2026-06-10 — V-005: dropped the drift-prone `:71` line number from the git-status.ts reference in 03 §2 (function name is the durable anchor).
