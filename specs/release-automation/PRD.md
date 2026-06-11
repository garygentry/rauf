# Release Automation — Product Requirements Document

## 1. Problem Statement

Cutting a rauf release today is entirely manual and, critically, **incomplete**. The public install path — `scripts/install-binary.sh` — downloads a compiled, single-file binary named `rauf-{os}-{arch}` from this repo's **GitHub Releases** (`releases/latest/download/...`). But nothing in the repository actually *produces or publishes* those cross-platform binaries:

- `pnpm compile` builds **one** binary for the **current** platform only.
- `scripts/bump-version.sh` rewrites the version string in `version.ts` and five `package.json` files (root, core, cli, loop, web — but **not** `packages/docs`, which has drifted to `0.1.0` while everything else is `0.2.0`), and does nothing else.
- `CHANGELOG.md` has a hand-maintained `## Unreleased` section that must be edited by hand.
- There is **no release workflow** (only `ci.yml` checks and `docs.yml`), **no published GitHub Release**, and **no version tags** (only `pre-rauf-rename`).

The result: `install-binary.sh` promises an install experience that cannot succeed, because `releases/latest/download/rauf-linux-x64` (and its siblings) do not exist. A maintainer who wants to ship a release must manually bump versions, hand-edit the changelog, build binaries one platform at a time (impossible from a single machine for all targets), and assemble a GitHub Release by hand — an error-prone, partially-impossible process.

**Who has this problem:** the rauf maintainer (currently a single developer) who needs to ship installable releases, and every end user who runs the documented `install-binary.sh` install command and gets a 404.

**Why it matters now:** rauf is being distributed as a compiled binary via GitHub Releases. Until releases are automated and complete, the advertised install path is broken and no version of the tool can be installed the intended way.

This feature delivers a **repeatable, guarded, single-command release process**: a maintainer runs one local prep command and pushes a `vX.Y.Z` tag; CI then builds every supported binary, generates checksums, and publishes a complete GitHub Release with curated notes — all-or-nothing, with no half-shipped versions.

## 2. User Stories

### Primary Actor: Maintainer (the person shipping a release)

- As the maintainer, I want to run one local command (e.g. `release prepare X.Y.Z`) that bumps every version, rolls the changelog's `## Unreleased` section into a versioned section, commits, tags, and pushes — so that triggering a release is a single, reviewable step instead of a multi-file manual ritual.
- As the maintainer, I want the prep command to **refuse** when I'm in an unsafe state (not on main, dirty tree, behind remote, tag already exists, version not moving forward, empty changelog) — so that I cannot accidentally ship a broken or duplicate release.
- As the maintainer, I want pushing a `vX.Y.Z` tag to automatically build and publish a complete release — so that I never assemble binaries or release notes by hand.
- As the maintainer, I want a release to be **all-or-nothing** — so that a failure on one platform never leaves a partially-published version visible to users.
- As the maintainer, I want the committed version and the pushed tag to be guaranteed identical — so that the binary's `rauf version` can never disagree with the release it was published under.
- As the maintainer, I want pre-release tags (e.g. `v0.3.0-beta.1`) to publish as GitHub *prereleases* that do **not** become "latest" — so that I can ship betas without redirecting the stable install path.

### Secondary Actor: End User (installing rauf)

- As an end user on Linux or macOS, I want `install-binary.sh` to successfully download a working `latest` binary for my OS/arch — so that the documented install command actually works.
- As an end user on Windows, I want an equivalent install script and a published `.exe` — so that I can install rauf without manual asset hunting.
- As a security-conscious user, I want a published checksums file — so that I can verify the binary I downloaded matches what was released.

### Secondary Actor: CI / Automation (the release workflow)

- As the release workflow, I want to run the full quality suite on the exact tagged commit before building anything — so that a bad tag cannot ship.
- As the release workflow, I want to refuse to overwrite an already-published release — so that a shipped version is immutable.
- As the release workflow, I want to reject tags pushed by anyone other than an authorized releaser — so that a foreign tag push cannot publish a release.

## 3. Functional Requirements

### 3.1 Release Trigger

- REQ-TRIGGER-01: A release is triggered by pushing a git tag matching the pattern `v*` (semantic, e.g. `v0.3.0`, `v0.3.0-beta.1`). The tag is the authoritative identifier of the release version.
  - Priority: P0
- REQ-TRIGGER-02: The tag value (minus the leading `v`) MUST equal the canonical `VERSION` in `packages/core/src/version.ts` at the tagged commit. The guard MUST additionally verify that all six `package.json` versions (REQ-VER-01) equal that same `VERSION`. Any mismatch — tag↔version.ts, or version.ts↔any package.json — MUST fail the release before any artifact is built or published.
  - Priority: P0
  - Notes: This is the version/tag drift guard — the single most important correctness invariant of the feature. `version.ts` `VERSION` is the authoritative value (REQ-VER-03, C-6); the six package.json files must all agree with it, so a half-consistent state (e.g. the current docs drift) cannot ship.
- REQ-TRIGGER-03: A manual `workflow_dispatch` trigger for the release workflow is a nice-to-have, allowing a maintainer to re-run the release for an existing tag from the Actions UI.
  - Priority: P2

### 3.2 Version Management

- REQ-VER-01: All packages share a single **lockstep** version across **six** locations: the root `package.json`, `packages/core`, `packages/loop`, `packages/cli`, `packages/web`, **and `packages/docs`**. A release bumps them together to one number. Per-package independent versioning is explicitly not supported.
  - Priority: P0
  - Notes: `packages/docs` IS part of the lockstep set, but has drifted (currently `0.1.0` vs `0.2.0` elsewhere) because the existing `bump-version.sh` omits it (see REQ-VER-05). This drift MUST be corrected on the first automated release.
- REQ-VER-02: The next version number is chosen **explicitly by the maintainer** and supplied to the prep command. Automation applies it; it is not derived from commit history.
  - Priority: P0
  - Notes: Rationale — for a single-maintainer private monorepo, conventional-commits / changesets tooling adds machinery without payoff. Explicit versioning matches the existing `bump-version.sh` model.
- REQ-VER-03: `packages/core/src/version.ts` (the `VERSION` constant) is the canonical version source of truth that the running binary reports; all six `package.json` versions (REQ-VER-01) MUST be kept identical to it. The `VERSION` value is the single authoritative value used for both the tag-equality check (REQ-TRIGGER-02) and the "strictly greater" comparison (REQ-PREP-04).
  - Priority: P0
- REQ-VER-04: A supplied version MUST be a valid semantic version (optionally with a prerelease suffix), consistent with the existing `bump-version.sh` validation.
  - Priority: P0
- REQ-VER-05: The prep helper MUST bump **all six** version locations (REQ-VER-01), including `packages/docs/package.json` — extending the existing `bump-version.sh` `PACKAGE_FILES` set, which currently omits docs. The drift guard (REQ-TRIGGER-02) MUST fail the release if any of the six `package.json` versions diverges from `version.ts`.
  - Priority: P0

### 3.3 Release Preparation Helper

- REQ-PREP-01: A single maintainer-facing helper performs full pre-tag preparation in one invocation: bump all versions, roll the changelog `## Unreleased` section into a `## X.Y.Z` section, commit the result, create the `vX.Y.Z` tag, and push the commit and tag.
  - Priority: P0
- REQ-PREP-02: The helper MUST refuse to proceed unless the repository is on the default branch (`main`), the working tree is clean, and local `main` is up to date with the remote.
  - Priority: P0
  - Notes: Mirrors the existing `loop run` safety guard (main/dirty/detached-HEAD) for consistency.
- REQ-PREP-03: The helper MUST refuse if the target `vX.Y.Z` tag already exists locally or on the remote.
  - Priority: P0
- REQ-PREP-04: The helper MUST refuse if the target version is not strictly greater than the current committed version (no downgrade or re-release of the same number).
  - Priority: P0
- REQ-PREP-05: The helper MUST refuse if the changelog `## Unreleased` section has no content, forcing real release notes to exist before a release goes out.
  - Priority: P0
- REQ-PREP-06: The helper lives as repository maintainer tooling under `scripts/` (an evolution of `bump-version.sh`), **not** as a command shipped in the rauf product binary. End users never see release tooling.
  - Priority: P0
  - Notes: Constraint — keeps `packages/cli` focused on managing loops. See Constraints §5.
- REQ-PREP-07: If any guard fails, the helper MUST make no changes (no partial bump, no commit, no tag) and exit with a clear, actionable message.
  - Priority: P0

### 3.4 Changelog & Release Notes

- REQ-NOTES-01: On preparation, the contents of the `## Unreleased` changelog section are moved into a new `## X.Y.Z` section, and a fresh empty `## Unreleased` section is left at the top.
  - Priority: P0
- REQ-NOTES-02: The GitHub Release notes body is the `## X.Y.Z` section extracted verbatim from `CHANGELOG.md` — the human-curated single source of truth.
  - Priority: P0
- REQ-NOTES-03: The release notes additionally include an auto-appended "Full Changelog" comparison link spanning the previous release tag to the new tag.
  - Priority: P1

### 3.5 Artifact Build & Publishing

- REQ-BUILD-01: Each release MUST build a compiled single-file binary for all of: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, and `windows-x64`.
  - Priority: P0
  - Notes: The first four match the OS/arch detection already in `install-binary.sh`; Windows is newly added.
- REQ-BUILD-07: The workflow MUST produce each target via Bun cross-target compilation (`bun build --compile --target=bun-<os>-<arch>`, i.e. `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`). The current `pnpm compile` is single-target (no `--target`); the tech spec MUST verify that each `--target` value produces a *runnable* binary. If any target cannot be reliably cross-built from a single host, the tech spec MUST fall back to a matrix of native runners (`ubuntu`/`macos`/`windows`). See Assumptions/Risks (§5a).
  - Priority: P0
  - Notes: `windows-x64` and the `darwin-*` pair are the highest-risk targets to validate first. Because of all-or-nothing semantics (REQ-RELIABILITY-01), a single unbuildable target blocks every release, not just that platform.
- REQ-BUILD-02: Released binary assets MUST be named to match what `install-binary.sh` expects (`rauf-{os}-{arch}`, with the platform-appropriate executable extension for Windows).
  - Priority: P0
- REQ-BUILD-03: Each release MUST produce a GitHub Release object at the tag, containing all binary assets and the checksums file (§3.6).
  - Priority: P0
- REQ-BUILD-04: A stable (non-prerelease) tag's GitHub Release MUST be marked as "latest" so that `releases/latest/download/...` resolves to it.
  - Priority: P0
- REQ-BUILD-05: A tag carrying a prerelease suffix (e.g. `-beta.1`) MUST publish as a GitHub **prerelease** and MUST NOT become "latest"; the stable install path continues to resolve to the last stable release. Full binaries and checksums are still produced.
  - Priority: P0
- REQ-BUILD-06: The full quality suite MUST pass on the exact tagged commit before any binary is built or published: build, schema drift check, typecheck, lint, format check, and tests (the same checks enforced by `ci.yml`). The release workflow runs these itself rather than trusting a prior `main` check.
  - Priority: P0
  - Notes: Self-contained gating is the only honest guarantee, since a tag can point at any commit, not just a green `main` tip.

### 3.6 Artifact Integrity

- REQ-INTEGRITY-01: A `SHA256SUMS` file covering every published binary asset MUST be generated and attached to the release.
  - Priority: P0
- REQ-INTEGRITY-02: The install scripts SHOULD be able to verify a downloaded binary against the published checksums.
  - Priority: P1
- REQ-INTEGRITY-03: Cryptographic signing and/or SLSA build provenance for release artifacts is a future enhancement, explicitly deferred from this version.
  - Priority: P2

### 3.7 Failure Handling & Idempotency

- REQ-RELIABILITY-01: Releases are **all-or-nothing**, achieved via **atomic single-shot creation**: every binary and the checksums file MUST be built and validated (held as CI build artifacts) *before* the GitHub Release is created, and the GitHub Release MUST be created exactly once, at the end, with every asset attached in that single operation. A failure on any single platform creates no release object at all — no partial, draft, or half-uploaded release is ever visible to users.
  - Priority: P0
  - Notes: This strategy makes a "partial release object" structurally impossible, which is what keeps re-runs clean (REQ-RELIABILITY-03).
- REQ-RELIABILITY-02: If a GitHub Release already exists for the tag, the release workflow MUST refuse to publish and make no changes; re-releasing requires the maintainer to deliberately remove the existing release/tag first.
  - Priority: P0
  - Notes: With atomic single-shot creation (REQ-RELIABILITY-01), any pre-existing release object for the tag is a completed release — there is no draft/partial middle state to disambiguate.
- REQ-RELIABILITY-03: A failed release run (failing before the single create-release step) MUST be safely re-runnable for the same tag after the cause is fixed, because no release object was created. The workflow MUST NOT leave behind orphaned draft or partially-uploaded releases on failure.
  - Priority: P1
- REQ-RELIABILITY-04: When a release fails, the failure MUST be clearly surfaced (job failure in the Actions UI) with diagnostics identifying which step/platform failed.
  - Priority: P1

### 3.8 Install Experience

- REQ-INSTALL-01: After the first real release, the existing `scripts/install-binary.sh` Unix install path MUST successfully download and install the `latest` binary for a supported OS/arch with no changes required to its expected asset URLs.
  - Priority: P0
- REQ-INSTALL-02: A Windows install path — a PowerShell install script mirroring `install-binary.sh` — MUST be provided so Windows users can install via a one-line command, and `rauf-windows-x64.exe` MUST be a published asset. The script MUST be hosted under the same `raw.githubusercontent.com/garygentry/rauf/main/scripts/` pattern as the Unix `install-binary.sh` (the precise PowerShell idiom — e.g. `irm <url> | iex` — is finalized in the tech spec; see OQ-1).
  - Priority: P0

## 4. Non-Functional Requirements

### 4.1 Performance

- REQ-PERF-01: A full release (quality gate + all five platform builds + publish) SHOULD complete within 15 minutes of wall-clock time from the tag push under normal CI conditions. Exceeding this is a non-blocking signal to investigate, not a release failure.
  - Priority: P1

### 4.2 Security

- REQ-SEC-01: The release job MUST publish using the workflow's built-in `GITHUB_TOKEN`, scoped to the minimum permission needed (`contents: write`). No personal access tokens or additional publish secrets are introduced.
  - Priority: P0
- REQ-SEC-02: Only an authorized releaser (the repo owner) may publish a release. Authorization is enforced by two layers: (1) **primary** — a GitHub tag-protection ruleset on `v*` tags that prevents non-owners from creating/pushing such a tag at all; and (2) **defense-in-depth** — the release workflow verifies the actor/tagger is the authorized releaser and fails the job if not. A tag pushed by an unauthorized actor MUST be blocked by the ruleset and, if it somehow reaches the workflow, MUST fail the actor check before publishing.
  - Priority: P0
  - Notes: Acceptance test — a `v*` tag push attempted by a non-owner is rejected by the ruleset; a workflow run whose tagger is not authorized fails before the publish step.
- REQ-SEC-03: No secrets, tokens, or credentials may be embedded in published binaries or release notes.
  - Priority: P0

### 4.3 Observability

- REQ-OBS-01: Release progress and outcome MUST be visible in the GitHub Actions UI, with distinguishable steps for the quality gate, each platform build, checksum generation, and publish.
  - Priority: P1
- REQ-OBS-02: A successful release's outcome (the published release URL and version) SHOULD be reported in the workflow summary/logs.
  - Priority: P2

## 5. Constraints

- **C-1 (GitHub Releases is the distribution channel):** Binaries are distributed exclusively via this repo's GitHub Releases, consumed by `install-binary.sh` at `releases/{latest|<tag>}/download/rauf-{os}-{arch}`. The automation must produce assets at exactly those names/locations. (Existing infrastructure.)
- **C-2 (Bun single-binary compilation):** Binaries are produced by `bun build --compile`, which bundles the Bun runtime so the installed `rauf` needs neither this repo nor Bun/Node on the target. **Existing infra for single-platform builds only** — the five-target cross-compilation this feature requires (REQ-BUILD-07) is *new* capability, not existing infra; see the assumption in §5a.
- **C-3 (Lockstep, private packages):** All workspace packages are `private: true` and share one version. The automation must not assume npm publishing and must keep versions in lockstep. (Existing project model.)
- **C-4 (Release tooling stays out of the product):** The maintainer-facing prep helper lives under `scripts/`, not in the shipped `rauf` CLI. (Organizational/product-scope decision — see REQ-PREP-06.)
- **C-5 (Built-in token only):** Publishing authority is the workflow `GITHUB_TOKEN`; no external secret management. (Security/operational constraint.)
- **C-6 (Single source of version truth):** `packages/core/src/version.ts` is canonical; all other version locations derive from it. (Existing convention.)

## 5a. Assumptions & Risks

- **RISK-1 (cross-compilation, highest):** This feature assumes `bun build --compile --target=...` can cross-build all five targets from a single CI host. This is **unproven in this repo** — the current `compile` script is single-target. Compounded by all-or-nothing semantics (REQ-RELIABILITY-01), one unbuildable target blocks *every* release. Mitigation: validate `windows-x64` and `darwin-*` first; fall back to a per-OS native runner matrix if any cross-target proves unviable (REQ-BUILD-07).
- **RISK-2 (unsigned macOS/Windows binaries):** v1 ships unsigned binaries (signing deferred, REQ-INTEGRITY-03). macOS Gatekeeper/quarantine and Windows SmartScreen may warn users. See OQ-3.

## 6. Out of Scope

The following are explicitly **not** part of this version:

- **npm package publishing.** All packages remain `private: true`; nothing is published to the npm registry.
- **Alternative distribution channels.** No Homebrew tap, apt/yum repository, or Docker image. GitHub Releases binaries only.
- **Binary auto-update.** No `rauf self-update` or in-binary update checks; users re-run the install script to upgrade.
- **Per-package / independent versioning.** Lockstep versioning is retained; no changeset-style per-package versions.
- **Conventional-commits / changeset-driven version computation.** The version is chosen explicitly by the maintainer.
- **Cryptographic signing / SLSA provenance.** Deferred (REQ-INTEGRITY-03); only SHA256 checksums ship in this version.

## 7. Open Questions

- OQ-1: For the Windows install script, what is the exact canonical invocation (`irm <url> | iex` vs `iwr ... | iex`), plus its error handling and PATH-setup behavior? Hosting is resolved (REQ-INSTALL-02: same `raw.githubusercontent.com/.../main/scripts/...` pattern as the Unix script); only the PowerShell idiom detail remains for the tech spec.
- OQ-2: Should `install-binary.sh` checksum verification (REQ-INTEGRITY-02) be on by default or opt-in, given the script is often piped from `curl | bash`?
- OQ-3: Does the macOS binary need any handling for Gatekeeper/quarantine (since artifacts are unsigned in v1), or is a documented `xattr`/manual-allow note sufficient? (See RISK-2.)
- OQ-4: The authorization *basis* for REQ-SEC-02 is resolved (tag-protection ruleset primary + workflow actor-check defense-in-depth). Remaining implementation nuance: how the workflow actor-check identifies the authorized releaser (hardcoded owner login vs repository-owner association lookup), and the exact ruleset configuration.

## 8. Success Criteria

The feature is done and working correctly when:

1. A maintainer can run one local prep command with a target version and, after it succeeds, a single `git push` of the tag is the only remaining action to ship a release.
2. The prep helper correctly refuses each unsafe condition (not on main, dirty tree, behind remote, existing tag, non-incrementing version, empty changelog) and leaves the repo untouched when it refuses.
3. Pushing a valid `vX.Y.Z` stable tag results in a published GitHub Release marked "latest" containing all five platform binaries plus a `SHA256SUMS` file, with notes drawn from the matching `CHANGELOG.md` section.
4. A fresh machine running the documented `install-binary.sh` (Unix) or the Windows install script downloads the released binary, and `rauf version` prints exactly the released version.
5. The version reported by the installed binary always matches the release tag it came from (drift guard never lets them differ).
6. A prerelease tag publishes as a GitHub prerelease and does **not** change what `releases/latest/download/...` resolves to.
7. A release that fails on any platform publishes nothing, and re-pushing/re-running after a fix produces a complete release.
8. Re-running against an already-published stable tag is refused without mutating the shipped release.
9. A release cannot be published if the quality suite fails on the tagged commit, nor by an unauthorized actor's tag push.
