# 07 — Testing Strategy

How release-automation is tested: colocated vitest unit suites for the pure/testable logic, a scoped root vitest project that runs them inside `pnpm test`, and a documented manual end-to-end procedure for the parts that cannot be unit-tested (the workflow). Cross-compilation was already empirically validated during the tech spec (§3.3) and is not re-tested per-commit.

## Requirement Coverage

| REQ ID            | Requirement / behavior verified                         | Section |
| ----------------- | ------------------------------------------------------- | ------- |
| REQ-NOTES-01      | `rollChangelog` correctness                             | 2.1     |
| REQ-NOTES-02/03   | `extractSection` + Full Changelog omission              | 2.1, 2.3|
| REQ-PREP-04/05    | version-forward + empty-changelog predicates            | 2.2     |
| REQ-VER-01/03/05  | version-location read/write incl. docs                  | 2.1, 2.2|
| REQ-TRIGGER-02    | drift detection across all seven locations              | 2.3     |
| REQ-BUILD-05      | prerelease classification                               | 2.1, 2.3|
| REQ-BUILD-04/05   | latest vs prerelease publish (manual)                   | 4       |
| REQ-RELIABILITY-01/02 | atomic publish + refuse-existing (manual)           | 4       |
| REQ-PERF-01       | scoped root vitest avoids double-running packages       | 3       |

## 1. Framework & layout

- **Framework:** Vitest `^3.0.0` (matches the four packages; tech-spec §6.3). Tests run under Bun.
- **Location:** colocated `*.test.ts` beside source in `scripts/release/` (project convention — CLAUDE.md "colocate with source").
- **Runner wiring:** the root `vitest.config.ts` `include` is scoped to `scripts/release/**/*.test.ts` and excludes `packages/**` (`01-architecture-layout.md` §2). `pnpm test` = `pnpm -r test && vitest run`, so the scripts suite runs once at the root and the four package suites run once each — no double-runs (REQ-PERF-01).

## 2. Unit tests

### 2.1 `lib.test.ts` (the bulk of coverage — pure functions)

| Function                | Cases                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `rollChangelog`         | greenfield (no prior `## X.Y.Z`); with prior sections (newest-first preserved); **byte-exact** output asserted; throws on empty/absent `## Unreleased`. |
| `extractSection`        | section present (verbatim body, trimmed); section absent → throws.                                 |
| `getUnreleasedBody`     | non-empty; empty (heading present, no body); absent heading → `""`.                                |
| `isValidVersion`        | accepts `1.2.3`, `1.2.3-rc.1`; rejects `v1.2.3`, `1.2`, `1.2.3+build`, `""`.                       |
| `compareVersions`       | `<`, `=`, `>`; prerelease ordering (`1.2.3-rc.1` < `1.2.3`).                                        |
| `isPrerelease`          | `0.3.0` → false; `0.3.0-rc.1` → true.                                                              |
| `setPackageJsonVersion` | 2-space / 4-space / tab indent preserved; trailing newline preserved/absent; throws on bad JSON.   |
| `parseVersionTs` / `setVersionTs` | present line round-trips; absent VERSION line → throws.                                  |
| `readVersionLocations`  | fixture repo with all seven files → seven `VersionLocation`s, exactly one `canonical`; missing/bad file → throws. |

`readVersionLocations` tests use a temp fixture directory (built by a factory, §2.4), not the real repo.

### 2.2 `prepare.test.ts` (pure guard predicates)

The guard predicates are factored out of the git-touching flow so they test without a repo (tech-spec §8):
- version-forward: `compareVersions(target, current) === 1` accept/reject (downgrade, equal, forward).
- valid-version gate.
- changelog-empty gate (`getUnreleasedBody(...) === ""`).

The git-mutating and push-recovery code paths (`§3`–`§4` of `03-prepare-helper.md`) are **not** unit-tested (they shell out to git); they are covered by the manual procedure (§4) and by reasoning about the documented recovery messages.

### 2.3 `preflight.test.ts` + `build-notes.test.ts`

`preflight` drift logic is factored into a pure function `detectDrift(tagVersion, locations): string | null` (returns the failure message or null) so it tests without Actions env:
- all seven agree → `null`.
- tag ≠ version.ts → message names the tag mismatch.
- one package.json (e.g. docs) ≠ canonical → message names that file.
- classification: `isPrerelease` true/false drives the `is_prerelease` output.

`build-notes` prev-tag logic is factored into a pure `composeNotes(sectionBody, prevTag | null, tag, repoSlug): string`:
- with a prior tag → appends the `**Full Changelog**: …/compare/<prev>...<tag>` line.
- with `null` (first release) → **omits** the line entirely (tech-spec §3.4 step 9). The `--match 'v*'` exclusion of `pre-rauf-rename` is exercised by passing `prevTag = null` for the first-release case.

### 2.4 Fixtures & factories

A small `__fixtures__`/factory module under `scripts/release/`:
- `makeChangelog({ unreleased })` → a CHANGELOG string with the given `## Unreleased` body (and optional prior sections).
- `makeRepoFixture(versions)` → writes a temp dir containing `version.ts` + the six `package.json` files at the given versions; returns its path. Used by `readVersionLocations`/`detectDrift` tests; cleaned up in `afterEach`.

## 3. Coverage targets

- `lib.ts`: **100%** of branches for the changelog and version-location functions (they are pure and high-risk — a bug ships a wrong release). This is the priority suite.
- `prepare`/`preflight`/`build-notes` extracted predicates: every branch of `detectDrift`, `composeNotes`, and the three guard predicates.
- Workflow YAML and the git-mutating/push code: not unit-covered; validated manually (§4). No coverage gate is set on these — flagged explicitly so the gap is visible rather than implied-covered.

## 4. Manual end-to-end validation (workflow — not unit-testable)

Run once before relying on the pipeline, per tech-spec §8 / Success Criteria:

1. **Prerelease dry-run:** `pnpm release:prepare 0.3.0-rc.1 --dry-run` → prints seven edits (incl. docs drift correction) + rolled section + tag; no repo change. (SC #1/#2)
2. **Prerelease publish:** `pnpm release:prepare 0.3.0-rc.1` → on tag push, the run publishes all five assets + `SHA256SUMS`, marks the release **prerelease** (not latest), notes match the `## 0.3.0-rc.1` section, and `releases/latest/...` is unchanged. (SC #3/#6)
3. **Install the prerelease by tag:** `RAUF_VERSION=v0.3.0-rc.1` install on Unix + Windows; `rauf version` prints `0.3.0-rc.1`. (SC #4)
4. **Promote to stable:** `pnpm release:prepare 0.3.0` → published release becomes `latest`; default `install-binary.sh` installs it; `rauf version` prints `0.3.0`. (SC #4/#5)
5. **Drift negative:** hand-push a tag whose value ≠ `version.ts` → run fails at preflight before any build. (SC #5/#9)
6. **Re-release refusal:** re-run the workflow for an already-published stable tag → "Assert no existing release" fails, nothing mutated. (SC #8)
7. **Guard refusals:** exercise each unsafe prep condition (not-on-main, dirty, behind/ahead/diverged, existing tag, non-incrementing, empty changelog) → each leaves the repo untouched with a distinct `refusing:` line. (SC #2)
8. **Checksum tamper:** corrupt a downloaded asset → install scripts hard-fail with `MISMATCH`. (REQ-INTEGRITY-02)

## Dependencies

- `02-shared-lib.md`, `03-prepare-helper.md`, `04-ci-preflight-and-workflow.md`, `05-install-scripts.md` — the code under test.
- `01-architecture-layout.md` — the root `vitest.config.ts` scoping that makes `pnpm test` cover this suite.

## Verification

- `pnpm test` runs the `scripts/release/**` suite exactly once (alongside each package suite once) and passes.
- `pnpm typecheck` passes for the test files (vitest types resolve at the root).
- The manual checklist (§4) has been executed at least once against a real prerelease→stable cycle before the feature is considered done.
