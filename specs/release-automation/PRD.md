# Release Automation — Product Requirements Document

## 1. Problem Statement

Cutting a rauf release today is entirely manual and, critically, **incomplete**. The public install path — `scripts/install-binary.sh` — downloads a compiled, single-file binary named `rauf-{os}-{arch}` from this repo's **GitHub Releases** (`releases/latest/download/...`). But nothing in the repository actually *produces or publishes* those cross-platform binaries:

- `pnpm compile` builds **one** binary for the **current** platform only.
- `scripts/bump-version.sh` rewrites the version string in `version.ts` and five `package.json` files, but does nothing else.
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
- REQ-TRIGGER-02: The tag value (minus the leading `v`) MUST equal the version committed at the tagged commit (`packages/core/src/version.ts` and all `package.json` files). A mismatch MUST fail the release before any artifact is built or published.
  - Priority: P0
  - Notes: This is the version/tag drift guard — the single most important correctness invariant of the feature.
- REQ-TRIGGER-03: A manual `workflow_dispatch` trigger for the release workflow is a nice-to-have, allowing a maintainer to re-run the release for an existing tag from the Actions UI.
  - Priority: P2

### 3.2 Version Management

- REQ-VER-01: All packages share a single **lockstep** version (`core`, `loop`, `cli`, `web`, `docs`, and the root). A release bumps them together to one number. Per-package independent versioning is explicitly not supported.
  - Priority: P0
- REQ-VER-02: The next version number is chosen **explicitly by the maintainer** and supplied to the prep command. Automation applies it; it is not derived from commit history.
  - Priority: P0
  - Notes: Rationale — for a single-maintainer private monorepo, conventional-commits / changesets tooling adds machinery without payoff. Explicit versioning matches the existing `bump-version.sh` model.
- REQ-VER-03: `packages/core/src/version.ts` (the `VERSION` constant) is the canonical version source of truth that the running binary reports; all `package.json` versions MUST be kept identical to it.
  - Priority: P0
- REQ-VER-04: A supplied version MUST be a valid semantic version (optionally with a prerelease suffix), consistent with the existing `bump-version.sh` validation.
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

- REQ-RELIABILITY-01: Releases are **all-or-nothing**: every binary and the checksums file MUST be built and ready before the GitHub Release is published. A failure on any single platform publishes nothing — no partially-released version is ever visible to users.
  - Priority: P0
- REQ-RELIABILITY-02: If a **published** (non-draft, non-prerelease) GitHub Release already exists for the tag, the release workflow MUST refuse and make no changes. Re-releasing requires the maintainer to deliberately remove the existing release/tag first.
  - Priority: P0
- REQ-RELIABILITY-03: A failed release run MUST be safely re-runnable (after the cause is fixed) for the same tag, provided no published release yet exists for it.
  - Priority: P1
- REQ-RELIABILITY-04: When a release fails, the failure MUST be clearly surfaced (job failure in the Actions UI) with diagnostics identifying which step/platform failed.
  - Priority: P1

### 3.8 Install Experience

- REQ-INSTALL-01: After the first real release, the existing `scripts/install-binary.sh` Unix install path MUST successfully download and install the `latest` binary for a supported OS/arch with no changes required to its expected asset URLs.
  - Priority: P0
- REQ-INSTALL-02: A Windows install path (e.g. a PowerShell install script mirroring `install-binary.sh`) MUST be provided so Windows users can install via a one-line command, and `rauf-windows-x64.exe` MUST be a published asset.
  - Priority: P0

## 4. Non-Functional Requirements

### 4.1 Performance

- REQ-PERF-01: A full release (quality gate + all five platform builds + publish) SHOULD complete within roughly 15 minutes of the tag push under normal conditions, so releasing is not a long-poll chore.
  - Priority: P1

### 4.2 Security

- REQ-SEC-01: The release job MUST publish using the workflow's built-in `GITHUB_TOKEN`, scoped to the minimum permission needed (`contents: write`). No personal access tokens or additional publish secrets are introduced.
  - Priority: P0
- REQ-SEC-02: The release workflow MUST verify that the actor/tagger who pushed the `v*` tag is an authorized releaser (the repo owner) before publishing; a tag pushed by an unauthorized actor MUST NOT produce a release.
  - Priority: P0
- REQ-SEC-03: No secrets, tokens, or credentials may be embedded in published binaries or release notes.
  - Priority: P0

### 4.3 Observability

- REQ-OBS-01: Release progress and outcome MUST be visible in the GitHub Actions UI, with distinguishable steps for the quality gate, each platform build, checksum generation, and publish.
  - Priority: P1
- REQ-OBS-02: A successful release's outcome (the published release URL and version) SHOULD be reported in the workflow summary/logs.
  - Priority: P2

## 5. Constraints

- **C-1 (GitHub Releases is the distribution channel):** Binaries are distributed exclusively via this repo's GitHub Releases, consumed by `install-binary.sh` at `releases/{latest|<tag>}/download/rauf-{os}-{arch}`. The automation must produce assets at exactly those names/locations. (Existing infrastructure.)
- **C-2 (Bun single-binary compilation):** Binaries are produced by `bun build --compile`, which bundles the Bun runtime so the installed `rauf` needs neither this repo nor Bun/Node on the target. (Existing infrastructure / team tooling.)
- **C-3 (Lockstep, private packages):** All workspace packages are `private: true` and share one version. The automation must not assume npm publishing and must keep versions in lockstep. (Existing project model.)
- **C-4 (Release tooling stays out of the product):** The maintainer-facing prep helper lives under `scripts/`, not in the shipped `rauf` CLI. (Organizational/product-scope decision — see REQ-PREP-06.)
- **C-5 (Built-in token only):** Publishing authority is the workflow `GITHUB_TOKEN`; no external secret management. (Security/operational constraint.)
- **C-6 (Single source of version truth):** `packages/core/src/version.ts` is canonical; all other version locations derive from it. (Existing convention.)

## 6. Out of Scope

The following are explicitly **not** part of this version:

- **npm package publishing.** All packages remain `private: true`; nothing is published to the npm registry.
- **Alternative distribution channels.** No Homebrew tap, apt/yum repository, or Docker image. GitHub Releases binaries only.
- **Binary auto-update.** No `rauf self-update` or in-binary update checks; users re-run the install script to upgrade.
- **Per-package / independent versioning.** Lockstep versioning is retained; no changeset-style per-package versions.
- **Conventional-commits / changeset-driven version computation.** The version is chosen explicitly by the maintainer.
- **Cryptographic signing / SLSA provenance.** Deferred (REQ-INTEGRITY-03); only SHA256 checksums ship in this version.

## 7. Open Questions

- OQ-1: For the Windows install script, what is the canonical invocation users will be told to run (e.g. `irm <url> | iex`), and where is it hosted/raw-served — same `raw.githubusercontent.com/.../main/scripts/...` pattern as the Unix script?
- OQ-2: Should `install-binary.sh` checksum verification (REQ-INTEGRITY-02) be on by default or opt-in, given the script is often piped from `curl | bash`?
- OQ-3: Does the macOS binary need any handling for Gatekeeper/quarantine (since artifacts are unsigned in v1), or is a documented `xattr`/manual-allow note sufficient?
- OQ-4: How is "authorized releaser" (REQ-SEC-02) determined in practice — hardcoded owner login, repository-owner association lookup, or tag-protection ruleset as the primary control with the workflow check as defense-in-depth?

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
