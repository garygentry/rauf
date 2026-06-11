# Verification Report: release-automation (backlog)
Date: 2026-06-10
Pipeline Stage: forge-5-loop (forge-4-backlog complete, awaiting forge-verify-backlog)
Artifacts Reviewed: PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-shared-lib.md, 03-prepare-helper.md, 04-ci-preflight-and-workflow.md, 05-install-scripts.md, 06-security-and-setup.md, 07-testing-strategy.md, TRACEABILITY.md, backlog.json, .pipeline-state.json

## Validator Results (deterministic)

1. `rauf-stable backlog validate . --backlog specs/release-automation --specs-dir ./specs --json` → **exit 0**, `{ "valid": true, "findings": [] }`
2. `python3 .../validate-traceability.py specs/release-automation/PRD.md specs/release-automation/ --json` → **exit 0**, `total_requirements: 40, uncovered_requirements: [], orphaned_references: [], valid: true`

Both deterministic gates are green. The findings below are agent-driven gaps the validators do not check.

## Checklist Tally (CHECK-B01 … CHECK-B25)

Executed 25 of 25 — 22 clean pass, 3 pass-with-finding (surfaced as V-001/V-002/V-005), 0 fail.

| Check | Result | Note |
| --- | --- | --- |
| B01 valid JSON | pass | parses cleanly |
| B02 required fields | pass | all 10 items complete |
| B03 unique ids | pass | 001–010 unique |
| B04 valid type | pass | only `feature`, `chore` (both in enum) |
| B05 valid priority | pass | 1 and 2 |
| B06 valid status | pass | all `pending` |
| B07 every spec referenced | pass | all 8 spec docs (00–07) referenced by ≥1 item |
| B08 P0 reqs covered | pass | every P0 REQ has an implementing item (see V-002 for manual-e2e nuance) |
| B09 no missing spec file | pass | all specReferences resolve |
| B10 specReferences valid relative paths | pass | project-root-relative, all exist |
| B11 single-iteration sizing | pass | 003 & 007 declare `estimatedIterations: 2` w/ justification; rest =1 |
| B12 fresh-context detail | pass | descriptions self-contained |
| B13 verifiable acceptance criteria | pass | each ends in a runnable verify |
| B14 files to create/modify named | pass | explicit in every item |
| B15 dependsOn valid ids | pass | no phantom ids |
| B16 no circular deps | pass | DAG; deepest chain 001→002→004→007→010 (depth 5) |
| B17 foundation items have no deps | pass | 001 and 006 have `[]` (see V-003) |
| B18 type-consumers ref creator | pass | 003/004/005→002; 007→004/005/006; 010→003/007 |
| B19 priority vs dep ordering | pass | see V-004 (007 P1 depends on 005 P2) |
| B20 scaffold item | pass | 001 |
| B21 shared types + error hierarchy | pass | 001 + 002 |
| B22 items per subsystem | pass | lib, prepare, preflight, build-notes, quality-gate, release.yml, install.sh, install.ps1, docs |
| B23 integration wiring | pass | 007 wires preflight+build-notes+quality-gate into release.yml |
| B24 test items | pass | tests colocated in each feature item (see V-001 for fixtures gap) |
| B25 no oversized items | pass | largest is 003 (see V-005) |

## Summary
- Total findings: 5
- Gaps: 2 (V-001, V-002)
- Inconsistencies: 0
- Improvements: 2 (V-003, V-004)
- Errors: 0
- Scope/quality: 1 (V-005)

## Findings

### V-001: Shared test fixtures/factory module (`makeChangelog`, `makeRepoFixture`) has no owning backlog item
- **Severity:** gap
- **Location:** backlog.json items 002 and 004; spec 07-testing-strategy.md §2.4
- **Issue:** Spec 07 §2.4 specifies a shared `__fixtures__`/factory module under `scripts/release/` exporting `makeChangelog({ unreleased })` and `makeRepoFixture(versions)`, used by both `readVersionLocations` tests (item 002) and `detectDrift` tests (item 004). No item names this factory module as a deliverable. Item 002 only says "readVersionLocations via a temp fixture dir cleaned in afterEach" (inline), and item 004 says tests "exercise detectDrift/isPrerelease directly" without referencing a shared `makeRepoFixture`. Result: whichever item runs first must invent the helper ad-hoc, and the second may duplicate it — defeating the factory's purpose and risking divergent fixture shapes.
- **Suggested fix:** Add an acceptance criterion to item 002 (the earliest test item): "Create `scripts/release/__fixtures__.ts` (or `fixtures.ts`) exporting `makeChangelog({ unreleased, priorSections? })` and `makeRepoFixture(versions): string` per spec 07 §2.4; `lib.test.ts` uses them." Then update item 004's description to consume `makeRepoFixture` from that module rather than re-creating fixtures. Optionally note the file in 01-architecture-layout.md §1's directory tree, which currently omits it.
- **References:** 07-testing-strategy.md §2.4, 01-architecture-layout.md §1, backlog.json items 002, 004
- **Checklist:** CHECK-B24, CHECK-B14, CHECK-B07

### V-002: Manual end-to-end validation procedure (spec 07 §4) is not tracked by any backlog item
- **Severity:** gap
- **Location:** backlog.json (no item); spec 07-testing-strategy.md §4 + §Verification; .pipeline-state.json notes
- **Issue:** Spec 07 §4 defines an 8-step manual e2e procedure (prerelease dry-run → publish → install-by-tag → promote-to-stable → drift negative → re-release refusal → guard refusals → checksum tamper) and its §Verification states the checklist "has been executed at least once against a real prerelease→stable cycle before the feature is considered done." This is the only validation for the workflow YAML, the git-mutating prepare paths, and the install scripts (CI cannot run install-binary.ps1; the workflow only runs on a real tag push). The backlog drops it: item 010 documents the *pre-release setup checklist* and the *tag ruleset* (a separate manual GitHub-config blocker), but no item represents *executing* the §4 e2e procedure as a feature-completion gate. A loop runner will mark all 10 items "complete" while the feature is, per its own testing strategy, not yet validated.
- **Suggested fix:** Add a final `chore` item (e.g. 011, dependsOn 008, 009, 010) "Execute manual end-to-end release validation (spec 07 §4)" whose acceptance criteria enumerate the 8 §4 steps as a human-run checklist, flagged `RAUF_NEEDS_HUMAN` (requires a real tag push and the tag ruleset from item 010 in place). Alternatively, if §4 is intentionally out-of-loop, add a one-line note to item 010 (or the backlog `description`) stating §4 e2e validation is a tracked manual gate outside the backlog so it is not assumed covered. Either way the gap should be visible rather than implied.
- **References:** 07-testing-strategy.md §4 and §Verification, 06-security-and-setup.md §4, .pipeline-state.json notes (OTQ-1 manual config), PRD §8 Success Criteria #1–9
- **Checklist:** CHECK-B08, CHECK-B22, CHECK-B25

### V-003: Item 006 `dependsOn: []` is correct — but the rationale should be recorded
- **Severity:** improvement
- **Location:** backlog.json item 006 (quality-gate composite action)
- **Issue:** Item 006 extracts the quality-gate composite action whose steps include `pnpm test`. It looks like 006 should depend on 002 (which creates the `scripts/release/**` tests `pnpm test` discovers). It does not, and that is correct: 006's acceptance criteria only require the YAML to contain the six commands in order and to parse — they do not require running `pnpm test`, and the action is never executed during 006 (it runs in CI on a future push). So `dependsOn: []` is sound. The risk is a future maintainer/re-planning agent "correcting" this to `dependsOn: ["002"]`, needlessly serializing two independent items and reducing loop parallelism (006/008/009 are the three independent roots).
- **Suggested fix:** Add a clause to item 006's `notes`: "dependsOn is intentionally [] — acceptance is YAML-structure + parse only; the gate is never executed here, so it does not require the scripts/release tests (item 002) to exist." No structural change.
- **References:** backlog.json item 006, 04-ci-preflight-and-workflow.md §5, 01-architecture-layout.md §3.2
- **Checklist:** CHECK-B17, CHECK-B15, CHECK-B16

### V-004: Item 007 (P1) depends on item 005 (P2) — minor priority/dependency ordering wrinkle
- **Severity:** improvement
- **Location:** backlog.json item 007 (priority 1) dependsOn includes 005 (priority 2)
- **Issue:** CHECK-B19 expects a dependency to have equal-or-higher priority than its dependent. Item 007 (`release.yml`, P1) lists `dependsOn: ["004","005","006"]`, but 005 (`build-notes.ts`) is P2 while 004/006 are P1. Not a correctness bug (DAG is acyclic and 005 is genuinely required by 007's step 9), but the priority signal under-rates 005 relative to what 007 needs, and a strictly priority-ordered scheduler could attempt 007 before 005 is reachable. Benign for 009 (P2, no dependents) and 010 (P2 leaf).
- **Suggested fix:** Bump item 005 from priority 2 to 1 so it matches its P1 dependent (007) and the REQ-NOTES-02 (P0) requirement it implements. (Item 009 install-binary.ps1 also implements a P0 requirement, REQ-INSTALL-02, yet is P2 — consider the same bump for consistency, though 009 has no dependents so it is lower risk.)
- **References:** backlog.json items 005, 007, 009; PRD REQ-NOTES-02 (P0), REQ-INSTALL-02 (P0); TRACEABILITY.md
- **Checklist:** CHECK-B19

### V-005: Item 003 silently expands scope into the product package `packages/loop/src/git-status.ts`
- **Severity:** gap
- **Location:** backlog.json item 003 `notes` (last sentence) vs its acceptanceCriteria
- **Issue:** Item 003's `notes` say: "Mirror the branch/detached/dirty checks in packages/loop/src/git-status.ts (checkLoopPreconditions) and add the remote up-to-date check it lacks." This points at a **product** package (`packages/loop/`), but none of item 003's acceptance criteria mention `git-status.ts` — they are entirely about `scripts/release/prepare.ts`, its tests, the package.json script, and removing bump-version.sh. A fresh-context agent will either skip the notes-only instruction (acceptance criteria are the contract), leaving the intended enhancement undone, or act on it and touch a product file outside the item's verifiable scope and outside `scripts/release/` — in tension with REQ-PREP-06/C-4 ("release tooling stays out of the product"). Spec 03 §2.2 only says prepare.ts *mirrors the pattern* of `checkLoopPreconditions`; it does not ask for `git-status.ts` itself to be modified.
- **Suggested fix:** Decide intent and make it explicit. If `checkLoopPreconditions` should gain a remote up-to-date check, split that into its own `feature` item with its own acceptance criteria and tests — do not bury it in 003's notes. If it should NOT change (more likely, given the specs only ask prepare.ts to mirror the pattern), reword item 003's notes to: "prepare.ts mirrors the branch/detached/dirty *pattern* of checkLoopPreconditions and adds the remote up-to-date check **in prepare.ts** (git-status.ts is unchanged)." This keeps item 003 within `scripts/release/` and within its file budget.
- **References:** backlog.json item 003 (notes vs acceptance), 03-prepare-helper.md §2.2, PRD REQ-PREP-06 / C-4, packages/loop/src/git-status.ts (`checkLoopPreconditions`)
- **Checklist:** CHECK-B14, CHECK-B13, CHECK-B25

## Fix Execution Plan

### User Decisions Required
- **V-002:** Track the manual e2e procedure (spec 07 §4) as a new `RAUF_NEEDS_HUMAN` item 011, or record it as an explicit out-of-loop manual gate note? Recommend: add item 011.
- **V-004:** Confirm bumping item 005 to priority 1 (and optionally item 009). Recommend yes for 005.
- **V-005:** Intent for the `checkLoopPreconditions` enhancement — split into a new product item, or scope it out (notes reword)? Recommend: scope it out (git-status.ts unchanged).

### Execution Steps

#### Step 1: Add the fixtures-factory deliverable (V-001)
- **Files:** specs/release-automation/backlog.json (item 002 description + acceptanceCriteria, item 004 description); optionally 01-architecture-layout.md §1
- **Addresses:** V-001
- **Checklist:** CHECK-B24, CHECK-B14
- **Action:** In item 002, add an acceptance criterion requiring `scripts/release/__fixtures__.ts` (or `fixtures.ts`) exporting `makeChangelog({ unreleased, priorSections? })` and `makeRepoFixture(versions): string` per spec 07 §2.4, consumed by lib.test.ts. In item 004's description, consume `makeRepoFixture` from that shared module. Optionally add the file to 01 §1's tree.
- **Depends on:** none

#### Step 2: Reword item 003 scope (V-005)
- **Files:** specs/release-automation/backlog.json (item 003 `notes`)
- **Addresses:** V-005
- **Checklist:** CHECK-B14, CHECK-B25
- **Action:** Apply the V-005 decision. Default (recommended): reword the last notes sentence to confine the remote up-to-date check to prepare.ts and state `packages/loop/src/git-status.ts` is unchanged. If the loop enhancement is wanted, add a new `feature` item with its own acceptance criteria/tests instead.
- **Depends on:** none

#### Step 3: Add note to item 006 (V-003)
- **Files:** specs/release-automation/backlog.json (item 006 `notes`)
- **Addresses:** V-003
- **Checklist:** CHECK-B17
- **Action:** Append a clause explaining `dependsOn: []` is intentional (acceptance is YAML structure + parse only; the gate is not executed here, so it does not require item 002's tests).
- **Depends on:** none

#### Step 4: Align item 005 priority (V-004)
- **Files:** specs/release-automation/backlog.json (item 005 `priority`; optionally item 009)
- **Addresses:** V-004
- **Checklist:** CHECK-B19
- **Action:** Per decision, change item 005 `priority` 2→1. Optionally do the same for item 009.
- **Depends on:** none

#### Step 5: Track the manual e2e gate (V-002)
- **Files:** specs/release-automation/backlog.json (new item 011, or a note on item 010 / top-level `description`)
- **Addresses:** V-002
- **Checklist:** CHECK-B08, CHECK-B22
- **Action:** Per decision, add item 011 `chore` "Execute manual end-to-end release validation (spec 07 §4)", `dependsOn: ["008","009","010"]`, acceptance criteria enumerating the 8 §4 steps, flagged `RAUF_NEEDS_HUMAN` (requires a real tag push and the tag ruleset from item 010). If not tracked as an item, add an explicit out-of-loop-gate note instead.
- **Depends on:** none (if added as item 011, re-run Step 6)

#### Step 6: Re-validate
- **Files:** none (commands only)
- **Addresses:** all
- **Checklist:** CHECK-B01, CHECK-B15, CHECK-B16
- **Action:** Re-run `rauf-stable backlog validate . --backlog specs/release-automation --specs-dir ./specs --json` (expect exit 0) and `python3 .../validate-traceability.py specs/release-automation/PRD.md specs/release-automation/ --json` (expect 40/40, 0 uncovered) to confirm no regression.
- **Depends on:** Steps 1–5
