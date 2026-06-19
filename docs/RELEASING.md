# Releasing & Installing Rauf

Maintainer and end-user documentation for the tag-driven release pipeline: one-time
GitHub setup, the pre-release checklist, how a release is cut, and how end users
install the published binaries.

---

## 1. One-Time Setup (maintainer)

### 1.1 The `release-tags` tag ruleset (first-release blocker)

> **⛔ The first `vX.Y.Z` release MUST NOT proceed until this ruleset exists.**
> The ruleset is the primary authorization layer (REQ-SEC-02): it prevents
> non-owners from creating `v*` tags at all, so the release workflow never even
> starts for an unauthorized actor. The workflow's own actor check is only
> defense-in-depth. Shipping with only the actor check active is explicitly
> disallowed.

This is manual GitHub configuration. A human with repository admin rights
must perform it once in the repo settings (it cannot be automated from this
repository's code):

1. Go to **Settings → Rules → Rulesets → New ruleset → New tag ruleset**.
2. **Name:** `release-tags`
3. **Enforcement status:** **Active**
4. **Target tags:** tag name pattern `v*` (fnmatch)
5. **Rules:** enable **Restrict creations**: only actors on the bypass list may
   create matching tags.
6. **Bypass list:** **Repository admin** (the owner, `garygentry`) only.

Verification: Settings → Rules shows an **Active** `release-tags` ruleset, and a
`v*` tag push by a non-owner is rejected by GitHub before any workflow run.

### 1.2 Pre-release setup checklist

Run through this once before the **first** release (items 1 and 2 are blockers):

- [ ] **[blocker]** Create the `release-tags` tag ruleset (§1.1 above).
- [ ] **[blocker]** Confirm `packages/core/src/version.ts` and all seven
      `package.json` files (root, `packages/core`, `packages/cli`,
      `packages/loop`, `packages/web`, `packages/docs`, `npm-dist`) agree on the
      version. The first `pnpm release:prepare` run corrects the historical
      `packages/docs` `0.1.0` drift automatically, but verify the result.
- [ ] Confirm `.bun-version` exists at the repo root and CI is green on the
      pinned Bun version.
- [ ] Confirm `CHANGELOG.md` has a `## Unreleased` section with real notes
      (the prepare helper refuses to release an empty changelog).

---

## 2. Cutting a Release (maintainer)

A release is **a release-prep PR + an owner tag**. There are two human-driven
phases: (1) anyone can prepare and merge the version-bump PR; (2) only the owner
tags the merged commit, which triggers the binary build.

### Why a PR, not a direct push

`main` is a **protected branch** that requires the `check` status (which runs
`pnpm gate`) on every push — `required_pull_request_reviews` is off, but the
required status check still rejects a direct `git push origin main`. So the
version bump cannot be pushed straight to `main`; it lands via a PR like any
other change (`required_linear_history` is on, so PRs are squash-merged). Tags
are governed by the separate `release-tags` ruleset (owner-only), **not** branch
protection, so the owner can push the tag where a `main` push would be rejected.

### Phase 1 — release-prep PR

```bash
pnpm release:prepare 0.3.0            # bump + changelog roll + commit on release/0.3.0 + push branch
pnpm release:prepare 0.3.0 --dry-run  # preview the planned edits, no writes / no branch / no push
pnpm release:prepare 0.3.0 --no-push  # commit on the branch locally, push manually later
pnpm release:prepare 0.3.0 --open-pr  # also run `gh pr create` for the branch
```

`release:prepare` guards against unsafe states (must start on a clean `main`
synced with origin; existing tag; existing `release/X.Y.Z` branch;
non-incrementing version; empty changelog — each failure prints a distinct
`refusing: …` line and leaves the repo untouched). It then creates a
`release/X.Y.Z` branch, bumps all eight version locations, renames
`## Unreleased` to `## X.Y.Z` in the changelog, commits `chore(release): vX.Y.Z`,
and pushes the **branch**. It does **not** tag and does **not** push `main` —
tagging a pre-merge branch commit would orphan the tag on the squash-merge.

Open the PR (the command is printed, or use `--open-pr`), let CI's `check` go
green, and **squash-merge** it to `main`.

### Phase 2 — cut the release (owner-only)

After the PR merges on green CI, the owner tags the merged commit:

```bash
git checkout main && git pull
git tag -m v0.3.0 v0.3.0 && git push origin v0.3.0
```

The `v*` tag push triggers `.github/workflows/release.yml`, which:

1. Verifies the actor is the repository owner (defense-in-depth behind the
   ruleset).
2. Runs preflight: the tag must match `version.ts` and all seven `package.json`
   versions exactly. Any drift fails the run before any build.
3. Runs the full quality gate (build, schema:check, typecheck, lint,
   format:check, test).
4. Cross-compiles five platform binaries, generates `SHA256SUMS` and release
   notes from the changelog section.
5. Publishes everything atomically in a single `gh release create`. A failure
   anywhere earlier creates no release object.

Prereleases (`0.3.0-rc.1`) are marked **prerelease** and never become
`latest`; stable versions are published as `latest`.

### 2.1 Publishing the npm launcher (`@garygentry/rauf`)

The `npx @garygentry/rauf` launcher (`npm-dist/`) is published **separately and
manually**, after the binary release above. It is _not_ part of the tag-driven
flow and has no automatic trigger:

1. Confirm the `vX.Y.Z` GitHub release exists (the launcher downloads that
   release's platform binary on first run).
2. Trigger `.github/workflows/npm-publish.yml`: **Actions → "npm Publish
   (manual)" → Run workflow** (optionally set a `dist-tag`; default `latest`).

`release:prepare` already bumped `npm-dist/package.json` to `X.Y.Z` (one of the
eight version locations), so the launcher publishes in lockstep with the binary
release: `npx @garygentry/rauf@X.Y.Z` resolves to the `vX.Y.Z` binary. Publishing
uses npm Trusted Publishing (OIDC): no token, owner-dispatched only.
Re-publishing an already-published version is rejected by npm, so a new publish
always follows a new release/version bump.

> **Worked example:** [`RELEASE-AUTOMATION-RUNBOOK.md` §7–8](./RELEASE-AUTOMATION-RUNBOOK.md)
> walks the same PR → merge → owner-tag sequence end-to-end for a feature built
> through the forge pipeline. This document is the canonical reference.

---

## 3. Installing Rauf (end users)

The published binaries are self-contained: they bundle the Bun runtime, so
the target machine needs neither this repo nor Bun/Node.

### 3.1 Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.sh | bash
```

Installs the latest release to `~/.local/bin/rauf`. The script verifies the
download against the release's published `SHA256SUMS` before installing: a
checksum mismatch hard-fails and the binary is never installed. (If no sha256
tool is available or the checksums file is unreachable, the script warns and
continues rather than blocking the install.)

Env overrides:

| Variable       | Default           | Purpose                                    |
| -------------- | ----------------- | ------------------------------------------ |
| `RAUF_VERSION` | `latest`          | Install a specific tag, e.g. `v0.3.0-rc.1` |
| `RAUF_REPO`    | `garygentry/rauf` | Fetch releases from a different repo       |
| `INSTALL_DIR`  | `~/.local/bin`    | Install destination                        |

### 3.2 Windows

```powershell
irm https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.ps1 | iex
```

Installs `rauf-windows-x64.exe` as `%USERPROFILE%\.local\bin\rauf.exe` and adds
that directory to your user `PATH` if it isn't already there (open a new
terminal afterwards). Checksum verification via `Get-FileHash` is mandatory on
Windows; any mismatch aborts the install.

The same `RAUF_VERSION` / `RAUF_REPO` env overrides apply (set them before
running the one-liner).

Only `windows-x64` is built; Windows arm64 is out of scope.

### 3.3 macOS Gatekeeper / quarantine note

The darwin binaries are **unsigned in v1** (code signing and notarization are
deferred). If Gatekeeper blocks the binary (typically when it was downloaded
through a browser or Finder), remove the quarantine attribute:

```bash
xattr -d com.apple.quarantine ./rauf
```

(or right-click the binary in Finder and choose **Open** once).

**Caveat:** binaries fetched via `curl` / `install-binary.sh` are usually
**not** quarantined (the `com.apple.quarantine` attribute is applied by
browsers and Finder, not by `curl`), so terminal installs are normally
unaffected and need no workaround.

---

## 4. Integrity & Security Stance (v1)

- Every release publishes a `SHA256SUMS` file alongside the five binaries; both
  install scripts verify against it (hard-fail on mismatch).
- x64 binaries are built with Bun's `-baseline` runtime so they run on every x64
  CPU (no AVX2 requirement); the default runtime SIGILLs on non-AVX2 hosts. This
  changes only the compile target, not the published asset names.
- Publishing uses only the workflow's built-in `GITHUB_TOKEN` with
  `contents: write`: no personal access tokens or extra secrets.
- Release notes are sourced verbatim from the human-curated changelog section;
  no CI environment values are interpolated.
- **Code signing / SLSA provenance is deferred** (REQ-INTEGRITY-03): v1 ships
  unsigned binaries with checksum verification as the integrity mechanism. The
  macOS quarantine workaround above exists because of this stance.

---

## 5. First-Release Validation (one-time human gate)

This is **backlog item 011** of the release-automation feature: a deliberate
human gate (`RAUF_NEEDS_HUMAN`), not loop-automatable. It requires a maintainer
with repo-admin rights to push real tags, drive GitHub Actions end-to-end, and
run the Windows installer. The release _code_ (helpers, workflow, install
scripts, checksums for items 001 through 010) is implemented and unit-tested; this gate
validates one real prerelease→stable cycle before relying on it. Run it once,
against `0.3.0-rc.1` → `0.3.0`, and record the results. Reference: spec 07 §4.

Prerequisite: the `release-tags` ruleset (§1.1) must be active.

- [ ] **1. Prerelease dry-run**: `prepare` prints the seven edits (incl. docs
      drift correction) and makes **no** repo change.
- [ ] **2. Prerelease publish**: the release attaches all five assets +
      `SHA256SUMS`, is marked **prerelease** (not "latest"), and its notes match
      the changelog section.
- [ ] **3. Install the prerelease by tag** on **Unix and Windows**;
      `rauf version` reports `0.3.0-rc.1`.
- [ ] **4. Promote to stable**: the release becomes "latest" and the default
      install installs it; `rauf version` reports `0.3.0`.
- [ ] **5 and 6. Negative paths**: drift check and re-release refusal both fail
      **before** any publish and mutate nothing.
- [ ] **7. Prep guards**: every prep guard fires, each leaving the repo
      untouched with a distinct `refusing:` line.
- [ ] **8. Checksum tamper**: tampering makes both install scripts hard-fail
      with `MISMATCH`.

When all eight are recorded as executed against a real cycle, mark item 011 done
(`rauf backlog unblock . 011` then set it done, or edit the backlog). Until then
it stays `blocked` + `needsHuman` so the loop sets it aside and never halts on
it.
