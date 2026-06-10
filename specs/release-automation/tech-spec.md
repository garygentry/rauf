# Release Automation — Technical Specification

## 1. Overview

This feature adds an automated, guarded release pipeline to the rauf monorepo. It has two halves:

1. **A local prep helper** (`scripts/release-prepare.ts`, run via Bun) that the maintainer invokes with a target version. It validates repo state, bumps all six version locations, rolls the `CHANGELOG.md` `## Unreleased` section into a versioned section, commits, tags `vX.Y.Z`, and pushes — in one guarded step (REQ-PREP-*).
2. **A GitHub Actions release workflow** (`.github/workflows/release.yml`) triggered by the `v*` tag push. A **single `ubuntu-latest` job** runs an actor + drift preflight, the full quality gate, cross-compiles all five binaries via Bun `--target`, generates `SHA256SUMS`, extracts release notes from the changelog, and creates the GitHub Release exactly once with every asset attached (REQ-TRIGGER-*, REQ-BUILD-*, REQ-INTEGRITY-*, REQ-RELIABILITY-*).

**Key architectural decisions:**
- **Single-runner cross-compilation.** RISK-1 was empirically validated during this spec (see §3.3): Bun 1.3.10 cross-compiles all five targets — `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64` — from one Linux host, producing correctly-formatted ELF/Mach-O/PE binaries. No native-runner matrix is needed, which makes all-or-nothing atomicity trivial.
- **Atomic single-shot publish** via `gh release create <all-assets>` in one call — a partial/draft release object can never exist (REQ-RELIABILITY-01).
- **Shared, unit-tested TypeScript logic.** Changelog rolling/extraction, semver comparison, and version-location reading live in one module (`scripts/release/lib.ts`) imported by both the prep helper and the CI preflight, with colocated vitest tests. The workflow YAML stays thin.
- **Reproducible builds** via a pinned `.bun-version`.
- **Release tooling stays out of the product** (C-4): everything lives under `scripts/` and `.github/`; nothing is imported by `scripts/binary-entry.ts`, so none of it is bundled into the shipped binary.

This spec does not restate requirements; sections trace to PRD REQ IDs.

## 2. Module Structure

New and modified files (all release tooling is repo infrastructure, not shipped product — C-4 / REQ-PREP-06):

```
.bun-version                          # NEW — pins Bun (e.g. "1.3.10") for reproducible builds
.github/workflows/release.yml         # NEW — the release workflow (single ubuntu-latest job)
.github/actions/quality-gate/action.yml # NEW — shared composite action: the 7-command quality gate, used by ci.yml + release.yml (§6.3)
.github/workflows/ci.yml              # MODIFIED — `check` job invokes shared quality-gate action (§6.3); `.bun-version` now also pins CI's Bun (§3.9)
vitest.config.ts                      # NEW — root vitest project; include scoped to scripts/release/**, excludes packages/** (§6.3)
scripts/
  release/
    lib.ts                            # NEW — shared pure logic (changelog, semver, version locations)
    lib.test.ts                       # NEW — colocated unit tests for lib.ts
    prepare.ts                        # NEW — the maintainer prep helper (guards + bump + roll + commit + tag + push)
    prepare.test.ts                   # NEW — unit tests for the pure parts of prepare (guard predicates)
    preflight.ts                      # NEW — CI: drift guard + prerelease classification, emits Actions outputs
    preflight.test.ts                 # NEW — unit tests for drift/classification logic
  install-binary.sh                   # MODIFIED — add SHA256 verification (default on, graceful skip)
  install-binary.ps1                  # NEW — Windows PowerShell installer (mirror of install-binary.sh)
  bump-version.sh                     # REMOVED — subsumed by scripts/release/prepare.ts (fixes the docs omission)
package.json (root)                   # MODIFIED — add release:prepare script, root vitest devDep, test wiring
CHANGELOG.md                          # (data, not code) — grammar formalized in §4.2
docs/architecture/… or docs/         # MODIFIED — install + release docs incl. macOS quarantine note (OQ-3)
```

### Public surface (maintainer-facing)

- `pnpm release:prepare <version> [--dry-run] [--no-push]` → `bun run scripts/release/prepare.ts`
- Pushing the resulting `vX.Y.Z` tag (done by `prepare.ts` unless `--no-push`) → triggers `release.yml`
- End users: `install-binary.sh` (Unix, unchanged invocation) and `install-binary.ps1` (Windows, new)

## 3. Technical Decisions

### 3.1 Prep helper as a Bun/TypeScript script (REQ-PREP-01..07, REQ-VER-02/04/05)

`scripts/release/prepare.ts`, run via Bun, supersedes `bump-version.sh`. Rationale: changelog section-rolling (REQ-NOTES-01), strict semver comparison (REQ-PREP-04), and JSON `package.json` edits are brittle and untestable in bash; TypeScript makes them testable and type-safe, and the repo already runs `.ts` scripts via Bun (`generate-*.ts`). The existing `bump-version.sh` is **removed** — folding its logic in is the cleanest way to also fix the `packages/docs` omission (REQ-VER-05) in one place.

**Execution order (all guards run and must pass BEFORE any mutation — REQ-PREP-07):**

1. **Parse & validate the target version** (REQ-VER-04): must match `^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$` — the identical regex (character-for-character) as the old `bump-version.sh` (§6.1). This regex (`lib.isValidVersion`) is the sole input gate: `compareVersions`/`Bun.semver.order` (guard 4) is only ever invoked on a string that already passed it, so the comparator's broader grammar (e.g. build-metadata `+`) is never reached and the two notions of "valid version" cannot diverge.
2. **Git state guards** (REQ-PREP-02), shelling out to `git` via `node:child_process` `execFile` (mirroring the `checkLoopPreconditions` pattern in `packages/loop/src/git-status.ts`, but operating on the repo root and adding the remote check the existing function lacks):
   - `git rev-parse --abbrev-ref HEAD` → must be `main` and not `HEAD` (detached).
   - `git status --porcelain` → must be empty (clean tree).
   - `git fetch --quiet origin main` then compare `git rev-parse @` vs `git rev-parse @{u}` (and `git merge-base @ @{u}`) → local `main` must be **up to date** with `origin/main` (not ahead, not behind, not diverged). This is new capability beyond `checkLoopPreconditions`.
3. **Tag-existence guard** (REQ-PREP-03): `git tag -l vX.Y.Z` (local) AND `git ls-remote --tags origin vX.Y.Z` (remote) must both be empty.
4. **Version-forward guard** (REQ-PREP-04): `Bun.semver.order(target, currentVersion) === 1` where `currentVersion` is the `VERSION` from `packages/core/src/version.ts` (the authoritative source — REQ-VER-03, C-6).
5. **Changelog-content guard** (REQ-PREP-05): the `## Unreleased` section body (between `## Unreleased` and the next `## ` or EOF) must be non-empty after trimming.

**Mutations (only after all guards pass):**

6. Write `VERSION = "X.Y.Z"` into `packages/core/src/version.ts` (regex replace on `export const VERSION = ".*"`).
7. Set `version` in all **six** `package.json` files (root, core, cli, loop, web, **docs** — REQ-VER-01/05) via JSON parse/stringify preserving indentation + trailing newline (same technique as `bump-version.sh`'s `node -e`). The first release corrects the existing docs `0.1.0` drift.
8. Roll the changelog (REQ-NOTES-01) via `lib.rollChangelog()` (§3.10).
9. `git add -A && git commit -m "chore(release): vX.Y.Z"`; `git tag vX.Y.Z`.
10. Unless `--no-push`: push **branch first, then tag** — `git push origin main && git push origin vX.Y.Z`. Branch-first ordering is deliberate: the tag is the workflow trigger (§3.4), so the tagged commit must already be on `origin/main` before the tag arrives, and pushing the tag last means the irreversible release trigger is the final action. Partial-failure recovery for steps 6–10 is specified in §7.

**Flags:** `--dry-run` prints the planned version edits, the rolled changelog section, and the tag, then exits without writing or running git mutations. `--no-push` performs steps 1–9 (local prep + commit + tag) but stops before step 10, so the maintainer can inspect/undo before the irreversible trigger.

### 3.2 Shared logic module (`scripts/release/lib.ts`)

Pure, side-effect-free functions imported by `prepare.ts` and `preflight.ts`, unit-tested in `lib.test.ts`. Signatures in §5.3. No `@rauf/core` import (keeps tooling decoupled from the product per C-4; these scripts are standalone Bun programs). Uses `Bun.semver.order()` for comparison rather than adding a `semver` dependency (none exists in the repo today).

### 3.3 Cross-compile topology: single `ubuntu-latest` job (REQ-BUILD-07, RISK-1 resolved)

**Decision:** one job, cross-compiling all five targets with `bun build --compile --target=bun-<os>-<arch>`.

**Evidence (RISK-1 retired):** during this spec, with Bun 1.3.10 on Linux, all five targets compiled successfully from `scripts/binary-entry.ts`:

| `--target` | `--outfile` (published asset) | Verified format |
|---|---|---|
| `bun-linux-x64` | `rauf-linux-x64` | ELF 64-bit x86-64 |
| `bun-linux-arm64` | `rauf-linux-arm64` | ELF 64-bit ARM aarch64 |
| `bun-darwin-x64` | `rauf-darwin-x64` | Mach-O 64-bit x86_64 |
| `bun-darwin-arm64` | `rauf-darwin-arm64` | Mach-O 64-bit arm64 |
| `bun-windows-x64` | `rauf-windows-x64.exe` | PE32+ console x86-64 |

The native `rauf-linux-x64` was executed and printed `rauf v0.2.0`. `--outfile` controls the published asset name directly, so the Bun target naming (`bun-linux-x64`) never leaks into asset names — they match `install-binary.sh`'s `detect_asset()` exactly (REQ-BUILD-02): `rauf-{os}-{arch}`, with `.exe` for Windows.

**Fallback (documented, unused):** if a future Bun regression breaks a cross-target, split into a `strategy.matrix` of `ubuntu`/`macos`/`windows` runners that each build their native target, upload as workflow artifacts, with a final gather-and-publish job. Not implemented now because cross-compile works and the single-job model is simpler, faster, cheaper, and atomically publishable.

### 3.4 Release workflow structure (REQ-TRIGGER-01, REQ-BUILD-06, REQ-RELIABILITY-01/04, REQ-OBS-01)

`.github/workflows/release.yml`:

- **Trigger:** `on: push: tags: ['v*']`. Plus `workflow_dispatch` with a `tag` input (REQ-TRIGGER-03, P2) to re-run for an existing tag.
- **Permissions:** `contents: write` only (REQ-SEC-01).
- **Concurrency:** `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }` — prevents two runs racing on the same tag.
- **Single job `release` on `ubuntu-latest`**, steps in order (each failing step fails the job; nothing is published before the final create step — REQ-RELIABILITY-01):
  1. `actions/checkout@v4` with `fetch-depth: 0` (needs full history + tags for the "Full Changelog" compare link, REQ-NOTES-03).
  2. **Actor authorization guard** (REQ-SEC-02, §3.6) — fails fast if `github.actor != github.repository_owner`.
  3. `oven-sh/setup-bun@v2` (reads `.bun-version`, §3.9) + `pnpm/action-setup@v4`.
  4. `pnpm install --frozen-lockfile`.
  5. **Preflight** (`bun run scripts/release/preflight.ts`, §3.5) — drift guard + prerelease classification; emits `version` and `is_prerelease` outputs. Also assert no existing release for the tag (REQ-RELIABILITY-02): `gh release view "$TAG"` must fail (absent).
  6. **Quality gate** (REQ-BUILD-06) — `uses: ./.github/actions/quality-gate`, the **shared composite action** that runs `pnpm build` → `pnpm schema:check` → `pnpm typecheck` → `pnpm lint` → `pnpm format:check` → `pnpm test`. `ci.yml`'s `check` job invokes the *same* action, so the two gates cannot drift (§6.3).
  7. **Cross-compile** all five targets into `dist/` (§3.3). `pnpm build` already ran in step 6, so this is just the five `bun build --compile --target=… --outfile dist/…` invocations.
  8. **Checksums** (REQ-INTEGRITY-01): `cd dist && sha256sum rauf-* > SHA256SUMS` (plain filenames so `sha256sum -c` works post-download).
  9. **Notes extraction** (REQ-NOTES-02/03): `bun run scripts/release/lib.ts`-backed step writes `dist/NOTES.md` = the `## X.Y.Z` changelog section + an auto-appended `**Full Changelog**: https://github.com/garygentry/rauf/compare/<prev>...vX.Y.Z` line. The previous tag is resolved with **`git describe --tags --abbrev=0 --match 'v*' vX.Y.Z^`** — the `--match 'v*'` is mandatory so the lookup considers only release tags and never selects the unrelated existing tag `pre-rauf-rename` (which is an ancestor and would otherwise be picked up, producing a misleading compare link). First-release behavior (no prior `v*` tag → `git describe` exits nonzero): **omit the "Full Changelog" line entirely** rather than fabricating a compare base. See §3.10.
  10. **Create release (single atomic call)** (REQ-RELIABILITY-01, REQ-BUILD-03/04/05, §3.7).
  11. **Summary** (REQ-OBS-02): echo the release URL + version into `$GITHUB_STEP_SUMMARY`.

### 3.5 Preflight: drift guard + prerelease classification (REQ-TRIGGER-02, REQ-BUILD-05)

`scripts/release/preflight.ts` (Bun), invoked by workflow step 5:

- Reads the tag from `GITHUB_REF_NAME` (or the `workflow_dispatch` input), strips leading `v` → `tagVersion`.
- Reads `VERSION` from `version.ts` and the `version` field of all six `package.json` files via `lib.readVersionLocations()`.
- **Fails** (nonzero exit + precise message) if: `tagVersion !== version.ts VERSION`, OR any of the six `package.json` versions `!== version.ts VERSION`. This enforces the full drift guard (REQ-TRIGGER-02) — tag↔version.ts and version.ts↔every package.json.
- **Classifies** `is_prerelease = lib.isPrerelease(tagVersion)` (true iff the version contains a `-` prerelease segment) (REQ-BUILD-05).
- Emits `version` and `is_prerelease` to `$GITHUB_OUTPUT` for later steps.

### 3.6 Actor authorization (REQ-SEC-02)

REQ-SEC-02 (P0) designates the tag-protection ruleset as the **primary** authorization layer, with the workflow actor-check as defense-in-depth. Both are specified concretely; the primary layer is a **release blocker** (see §10 OTQ-1), not a deferral.

- **Primary — GitHub tag ruleset (manual config, one-time, blocks the first release).** Create a repository **tag ruleset** (Settings → Rules → Rulesets → New tag ruleset) configured exactly as:
  - **Target:** tag name pattern `v*` (fnmatch), enforcement **Active**.
  - **Rule:** **Restrict creations** enabled — only actors on the bypass list may create matching tags.
  - **Bypass list:** **Repository admin** (the repo owner, `garygentry`) only.
  
  This stops a non-owner from creating a `v*` tag at all, so the workflow never even starts for an unauthorized actor. The one-time setup step is documented in the release/install docs (the `docs/…` MODIFIED entry in §2) and is a **tracked prerequisite that must be completed before the first `vX.Y.Z` release** — it is not allowed to ship with only the defense-in-depth layer (decision recorded in §10 OTQ-1).
- **Defense-in-depth (in workflow):** step 2 guard — `if: github.actor != github.repository_owner` → fail the job before any build/publish. `github.repository_owner` resolves to `garygentry` without hardcoding a literal login. This is a second line of defense (e.g. against a `workflow_dispatch` re-run path), not the primary control. Acceptance test (REQ-SEC-02 note): a workflow run whose actor isn't the owner fails before publish; the ruleset blocks the tag push itself.

### 3.7 Atomic single-shot publish via `gh release create` (REQ-BUILD-03/04/05, REQ-RELIABILITY-01/02)

`gh` is pre-installed on GitHub runners and authenticates via `GITHUB_TOKEN` (REQ-SEC-01). One call attaches all assets:

```
gh release create "$TAG" dist/rauf-linux-x64 dist/rauf-linux-arm64 \
  dist/rauf-darwin-x64 dist/rauf-darwin-arm64 dist/rauf-windows-x64.exe dist/SHA256SUMS \
  --title "$TAG" --notes-file dist/NOTES.md --verify-tag \
  $( [ "$IS_PRERELEASE" = "true" ] && echo --prerelease || echo --latest )
```

- `--verify-tag` ensures the tag exists (it does — it triggered the run) before creating.
- `--latest` (stable) vs `--prerelease` maps directly onto REQ-BUILD-04/05; a prerelease never becomes "latest", so `releases/latest/download/...` keeps resolving to the last stable.
- **Cross-tag concurrency (REQ-BUILD-04/05).** The `concurrency` group in §3.4 is keyed on `github.ref`, so it only serializes runs for the *same* tag; the canonical flow (cut `v0.3.0-rc.1`, then promote `v0.3.0` — §8) involves two distinct refs whose runs may overlap. This is safe by construction: each run's only publishing action is a single `gh release create` keyed to its own distinct tag, so overlapping runs for different tags cannot corrupt each other's release object. Crucially, `--latest` is attached **only** when the version is non-prerelease (§3.5 `is_prerelease`), so a slow prerelease run that finishes *after* the stable run cannot "steal" `latest` — it never passes `--latest` at all. `releases/latest/download/...` therefore always resolves to the most recent run that published with `--latest`, i.e. the newest stable, independent of prerelease run timing. No ordering constraint between the two runs is required.
- Creates-with-assets in one operation → no partial/draft middle state (REQ-RELIABILITY-01). The earlier `gh release view` check (step 5) plus `gh release create`'s own "already exists" error enforce REQ-RELIABILITY-02. On any failure before this step, no release object exists, so re-running the tag is clean (REQ-RELIABILITY-03) — the workflow creates no drafts.

### 3.8 Checksums (REQ-INTEGRITY-01)

`SHA256SUMS` generated with `sha256sum` over the five binaries (plain filenames), attached as a release asset. Consumed by the install scripts (§3.11).

### 3.9 Bun version pinning (reproducibility)

Add a `.bun-version` file containing the pinned version (initially `1.3.10`). `oven-sh/setup-bun@v2` auto-reads `.bun-version`. Note that `ci.yml`'s existing `setup-bun` step currently passes **no** `bun-version` input — it resolves to whatever Bun the action defaults to (latest). Introducing `.bun-version` therefore **newly pins CI to 1.3.10**; this is a deliberate behavior change to CI's runtime, not a confirmation of pre-existing parity, and must be validated by re-running CI once the pin lands. After it lands, **both** `ci.yml` and `release.yml` resolve the same Bun — CI matches local matches release, and compile output is reproducible. Bumping Bun becomes a deliberate one-line change.

### 3.10 Changelog roll & notes extraction (REQ-NOTES-01/02/03)

In `lib.ts`:
- `rollChangelog(content, version)` → moves the `## Unreleased` body into a new `## X.Y.Z` section directly under it, leaves a fresh empty `## Unreleased` at the top, and returns `{ updated, sectionBody }`. Used by `prepare.ts`.
- `extractSection(content, version)` → returns the body of the `## X.Y.Z` section verbatim. Used by the workflow notes step to build `NOTES.md` (REQ-NOTES-02), to which the "Full Changelog" compare link is appended (REQ-NOTES-03) **only when a previous release tag exists**. Previous-tag resolution uses `git describe --tags --abbrev=0 --match 'v*' vX.Y.Z^` (the `--match 'v*'` filter excludes the non-release `pre-rauf-rename` tag); on the first release the line is omitted entirely (§3.4 step 9).
- Versioned headings are `## X.Y.Z` (no date) for symmetry with `## Unreleased`. (Date suffix considered and rejected to keep parsing trivial; see §10.)

### 3.11 Install scripts (REQ-INSTALL-01/02, REQ-INTEGRITY-02)

**Unix (`install-binary.sh`, modified):** after downloading the asset in download mode, also fetch `SHA256SUMS` from the same release, compute the asset's hash (`sha256sum` or `shasum -a 256`), and compare the matching line. Verification is **on by default**; a **missing** checksum tool → warn and continue; a **mismatch** → hard-fail and delete the temp file (REQ-INTEGRITY-02, OQ-2 resolved). `--local` mode skips verification. `detect_asset()` is unchanged (Unix-only, no `.exe`).

**Windows (`install-binary.ps1`, new):** mirrors `install-binary.sh`. One-liner: `irm https://raw.githubusercontent.com/garygentry/rauf/main/scripts/install-binary.ps1 | iex` (OQ-1 resolved). Downloads `rauf-windows-x64.exe` from `releases/{latest|<tag>}/download/`, installs to `$HOME\.local\bin` (symmetric with the Unix `~/.local/bin`), adds that dir to the user `PATH` if missing, and verifies via `Get-FileHash -Algorithm SHA256` against `SHA256SUMS` (always available on Windows; default on). Windows arm64 is out of scope (only `windows-x64` is built).

### 3.12 macOS Gatekeeper (OQ-3, RISK-2)

Doc-only. The install/release docs note the one-time `xattr -d com.apple.quarantine ./rauf` (or right-click → Open) workaround for the unsigned darwin binaries, with the caveat that binaries fetched via `curl`/`install-binary.sh` are typically **not** quarantined (the quarantine attribute is applied by browsers/Finder, not curl), so terminal installs are usually unaffected. No code; signing remains deferred (REQ-INTEGRITY-03).

### 3.13 Release duration vs. REQ-PERF-01 (the 15-minute SHOULD budget)

REQ-PERF-01 (P1, SHOULD) targets ≤ 15 minutes wall-clock from tag push to published release. The single-job serial topology (§3.3, §3.4) is the primary determinant of this budget, so it is reasoned about explicitly here rather than left implicit in the "atomicity/simplicity" rationale of §3.3.

Expected wall-clock breakdown on `ubuntu-latest` (one job, all steps serial):

| Phase | Steps | Rough budget |
|---|---|---|
| Setup | checkout (full history), setup-bun, pnpm install (frozen) | ~2 min |
| Quality gate | build → schema:check → typecheck → lint → format:check → test (§3.4 step 6) | ~4–6 min |
| Cross-compile | five `bun build --compile` invocations, serial (§3.3) | ~2–4 min |
| Publish | checksums, notes, single `gh release create` | ~1 min |

This sits comfortably inside the 15-minute SHOULD with margin, so the single serial job is the right default. The lever if the budget is ever exceeded is the **§3.3 native-runner matrix fallback**: it parallelizes the five compiles (and could parallelize the gate) across `ubuntu`/`macos`/`windows` runners, trading the single-job atomicity for a final gather-and-publish job. That fallback is therefore tied to **two** triggers, not one — a Bun cross-compile regression (§3.3) *or* a sustained REQ-PERF-01 breach — and either is sufficient justification to adopt it.

## 4. Data Model

### 4.1 Version locations (the six lockstep targets — REQ-VER-01)

| # | File | Field / pattern | Authority |
|---|---|---|---|
| 0 | `packages/core/src/version.ts` | `export const VERSION = "X.Y.Z"` | **canonical** (C-6) |
| 1 | `package.json` (root) | `.version` | must equal #0 |
| 2 | `packages/core/package.json` | `.version` | must equal #0 |
| 3 | `packages/cli/package.json` | `.version` | must equal #0 |
| 4 | `packages/loop/package.json` | `.version` | must equal #0 |
| 5 | `packages/web/package.json` | `.version` | must equal #0 |
| 6 | `packages/docs/package.json` | `.version` | must equal #0 (currently drifted `0.1.0`) |

### 4.2 CHANGELOG.md grammar (REQ-NOTES-01)

```
# Changelog                 ← H1, line 1
(blank)
## Unreleased               ← first H2; body = lines until next "## " or EOF
(blank)
### <subsection> …          ← H3 subsections (arbitrary)
…
## X.Y.Z                    ← versioned sections, newest first (none exist yet — greenfield)
```

Roll operation: `## Unreleased` heading → `## X.Y.Z`; insert a new `## Unreleased\n\n` block between `# Changelog` and the new `## X.Y.Z`.

### 4.3 Published release assets (REQ-BUILD-02)

`rauf-linux-x64`, `rauf-linux-arm64`, `rauf-darwin-x64`, `rauf-darwin-arm64`, `rauf-windows-x64.exe`, `SHA256SUMS`.

### 4.4 Workflow outputs (from preflight, §3.5)

`version` (string, no `v`), `is_prerelease` (`"true"`/`"false"`).

## 5. API / Interfaces

### 5.1 Prep helper CLI

```
pnpm release:prepare <X.Y.Z[-pre]> [--dry-run] [--no-push]
```
Exit 0 on success; nonzero with a single clear message on any guard failure (REQ-PREP-07).

### 5.2 Release workflow interface

- Trigger: push tag `v*`; or `workflow_dispatch` with input `tag: vX.Y.Z`.
- Consumes: `GITHUB_TOKEN` (auto), `.bun-version`, repo contents at the tagged commit.
- Produces: one GitHub Release with six assets.

### 5.3 `scripts/release/lib.ts` signatures (verified against current repo facts)

```ts
// Version locations
export interface VersionLocation { file: string; version: string; }
export function readVersionLocations(repoRoot: string): VersionLocation[]; // reads version.ts + 6 package.json
export function parseVersionTs(content: string): string;                   // extracts VERSION from version.ts
export function setVersionTs(content: string, v: string): string;
export function setPackageJsonVersion(content: string, v: string): string; // preserves indent + trailing \n

// Semver (wraps Bun.semver.order — Bun runtime API; scripts run under Bun)
export function isValidVersion(v: string): boolean;     // ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ — sole input gate; see §3.1
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function isPrerelease(v: string): boolean;       // contains a "-" prerelease segment

// Changelog
export function getUnreleasedBody(content: string): string;                       // for REQ-PREP-05 guard
export function rollChangelog(content: string, v: string): { updated: string; sectionBody: string };
export function extractSection(content: string, v: string): string;              // for NOTES.md
```

## 6. Integration Points

### 6.1 `bump-version.sh` → removed, logic folded into `prepare.ts`
The existing `scripts/bump-version.sh` (`PACKAGE_FILES` = root + core + cli + loop + web; **omits docs**; `sed` on `version.ts`; semver regex `^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$`) is **deleted**. `prepare.ts` reproduces its bump behavior, adds `packages/docs/package.json` (REQ-VER-05), and gains the guards/changelog/commit/tag/push steps. Any references (e.g. in docs) are updated to `pnpm release:prepare`.

### 6.2 `checkLoopPreconditions` (`packages/loop/src/git-status.ts`) — pattern reuse, not import
The prep helper **mirrors** this function's `execFile("git", …)` approach and its branch/detached/dirty checks, but does **not** import it (it targets the rauf repo root, not a project path, and `prepare.ts` is standalone tooling). It **adds** the remote-up-to-date check (`git fetch` + `@` vs `@{u}`), which `checkLoopPreconditions` does not perform. `PROTECTED_BRANCHES`/`ErrorCodes.CONFLICT` semantics are not reused; `prepare.ts` prints plain messages and exits nonzero.

### 6.3 `ci.yml` — quality-gate as a shared composite action + scripts test coverage (REQ-BUILD-06)

**Single source of truth for the gate (no drift by construction).** REQ-BUILD-06 requires the release gate (workflow step 6) to run the *same* quality suite as `ci.yml`'s `check` job. Rather than duplicating the seven-command list in two workflow files and relying on contributor discipline to keep them in sync, the sequence is extracted into one **local composite action**, `.github/actions/quality-gate/action.yml`, that runs `pnpm build` → `pnpm schema:check` → `pnpm typecheck` → `pnpm lint` → `pnpm format:check` → `pnpm test` (it assumes Bun/pnpm/install are already set up by the caller). Both `ci.yml`'s `check` job and `release.yml` step 6 invoke it via `uses: ./.github/actions/quality-gate`. Adding or removing a check is then a one-place edit that *automatically* applies to both workflows — divergence is structurally impossible, not merely discouraged. (Earlier alternatives — duplicating the list, or a separate `test:scripts` step in both files — are rejected: both leave two lists that can silently drift, exactly the REQ-BUILD-06 risk this closes.)

> Files affected: `.github/actions/quality-gate/action.yml` (NEW), `.github/workflows/ci.yml` (MODIFIED — `check` job calls the composite action), `.github/workflows/release.yml` (step 6 calls the same action).

**Scripts test coverage via a scoped root vitest project.** The new `scripts/release/**` logic must run inside the gate's `pnpm test` step. The root `test` script is extended so `pnpm test` also runs a root vitest project:
```
"test": "pnpm -r test && vitest run"   // + new root devDependency: vitest@^3.0.0; + vitest.config.ts at root
```
The root `vitest.config.ts` `include` is **scoped to `scripts/release/**/*.test.ts` and explicitly excludes `packages/**`**, so the root `vitest run` covers *only* the new script tests and does **not** re-discover and re-run the four packages' suites already executed by `pnpm -r test` (avoiding double-runs that would inflate CI time and muddy REQ-PERF-01). The root `vitest` devDependency pins the same major as the packages — **`^3.0.0`** (core/cli/loop/web all already pin `vitest ^3.0.0`) — so the workspace never resolves two vitest majors.

### 6.4 `install-binary.sh` asset contract (REQ-INSTALL-01, C-1)
Published asset names exactly match `detect_asset()` output (`rauf-{os}-{arch}`) and the `releases/{latest|<tag>}/download/` URL scheme already coded in the script — so the Unix install path works against the first real release with no URL changes; only checksum verification is added (§3.11).

### 6.5 `scripts/binary-entry.ts` — compile entry (unchanged)
The workflow compiles the same entry point already used by `pnpm compile` (`bun build --compile scripts/binary-entry.ts`), adding only `--target` and `--outfile`. No change to `binary-entry.ts`. Release tooling under `scripts/release/**` is **not** imported by `binary-entry.ts`, so it is not bundled into the product (C-4).

### 6.6 Repo identity
`garygentry/rauf`, confirmed in root `package.json` `repository.url` and `install-binary.sh` `RAUF_REPO` default. Used for the compare link (REQ-NOTES-03) and the PowerShell raw-content URL (REQ-INSTALL-02).

### 6.7 In-progress feature conflicts
None. `specs/multi-backlog` is complete and touches runtime/CLI, not build/release. No file overlap with the new `scripts/release/**`, `release.yml`, or install scripts.

## 7. Error Handling

- **Prep helper (REQ-PREP-07):** all guards evaluated before any mutation; the first failing guard prints one actionable line (e.g. `refusing: working tree is dirty — commit or stash first`) and exits nonzero, leaving the repo untouched. `--dry-run` never mutates.
- **Prep helper mutation/push phase (steps 6–10):** once guards pass, mutations are local-first then push-last (branch, then tag — §3.1 step 10). Because steps 6–9 only touch the local repo, a failure there leaves at most an uncommitted/committed-but-unpushed local state the maintainer can `git reset`/`git tag -d` freely. The push (step 10) is the only externally-visible action and is **not** transactional across its two commands, so failure modes are made explicit:
  - **`git push origin main` fails:** nothing was published; the local release commit + tag remain. The helper prints the recovery line `release commit & tag vX.Y.Z exist locally but were not pushed — fix the push error and re-run 'git push origin main && git push origin vX.Y.Z', or 'git reset --hard origin/main && git tag -d vX.Y.Z' to abort.` Exits nonzero.
  - **branch push succeeds, `git push origin vX.Y.Z` fails:** `origin/main` now carries the release commit but the trigger tag is absent (no workflow fired — safe intermediate state). The helper prints `main pushed but tag vX.Y.Z push failed — the release has NOT triggered; re-run 'git push origin vX.Y.Z' once resolved.` Exits nonzero. Re-running the helper is **not** the recovery path here (the tag-existence and clean-tree guards would now fire); the maintainer simply retries the single tag push.
  - **Local tag interaction with REQ-PREP-03:** any failure that leaves the local `vX.Y.Z` tag in place means a subsequent full re-run of the prep helper will (correctly) refuse at the tag-existence guard (§3.1 step 3). Recovery from a fully-aborted attempt therefore requires deleting the local tag (`git tag -d vX.Y.Z`); the recovery messages above call this out so the guard refusal is never surprising.
- **Preflight drift (REQ-TRIGGER-02):** prints the exact mismatch (which location, expected vs found) and exits nonzero before any build/publish step runs.
- **Workflow ordering (REQ-RELIABILITY-01/03):** quality gate, compile, checksum, and notes all precede the single `gh release create`. Any earlier failure → job fails red (REQ-RELIABILITY-04), no release object created, tag re-runnable after fix. No drafts are ever created.
- **Already-published (REQ-RELIABILITY-02):** `gh release view "$TAG"` succeeding (release exists) fails the preflight step; re-release requires deliberate manual removal.
- **Install scripts:** download failure → existing error path (with "no release yet?" hint); checksum mismatch → hard-fail + cleanup; missing checksum tool (Unix) → warn + continue.

## 8. Testing Approach

- **Unit (vitest, colocated, run by `pnpm test` via root vitest — §6.3):**
  - `lib.test.ts`: `rollChangelog` (greenfield + with-existing-sections), `extractSection`, `getUnreleasedBody` (empty/non-empty), `compareVersions`/`isPrerelease`/`isValidVersion`, `setPackageJsonVersion` (indent/newline preservation), `parseVersionTs`/`setVersionTs`.
  - `preflight.test.ts`: drift detection across the six locations (match, tag-mismatch, one-package-mismatch), prerelease classification.
  - `prepare.test.ts`: pure guard predicates (version-forward, valid-version, changelog-empty) factored out so they're testable without touching git.
- **Workflow (not unit-testable):** validate end-to-end by cutting a real **prerelease** tag first (e.g. `v0.3.0-rc.1`) — confirm all five assets + `SHA256SUMS` publish, the release is marked **prerelease** (not latest), notes match the changelog section, and `install-binary.sh`/`.ps1` install the prerelease by explicit tag. Then promote to a stable `vX.Y.Z` and confirm it becomes `latest` and `install-binary.sh` (no tag) installs it. (Success Criteria #3/#4/#6.)
- **Cross-compile already validated** during this spec (§3.3).

## 9. Dependencies

- **New runtime/build deps:** none in product packages (no `semver` lib — `Bun.semver` is used; C-4 keeps tooling out of the binary).
- **New root devDependency:** `vitest@^3.0.0` (for the root scripts test project; same major as the packages — §6.3).
- **New repo files as "deps":** `.bun-version` (pins Bun 1.3.10).
- **CI actions (existing versions, reused):** `actions/checkout@v4`, `oven-sh/setup-bun@v2`, `pnpm/action-setup@v4`. `gh` CLI is pre-installed on `ubuntu-latest`.
- **Runtime APIs:** `Bun.semver.order` (Bun ≥ 1.1). `sha256sum` (coreutils, present on `ubuntu-latest`). `Get-FileHash` (Windows, built-in).

## 10. Open Technical Questions

All four PRD open questions are resolved by this spec: **OQ-1** (irm|iex → `~/.local/bin`, §3.11), **OQ-2** (verify on by default, graceful skip, §3.11), **OQ-3** (doc-only quarantine note, §3.12), **OQ-4** (owner-comparison actor check + tag-protection ruleset, §3.6). Remaining minor items:

- **OTQ-1 (resolved — release blocker):** The tag-protection **ruleset** is manual GitHub configuration (not code), specified concretely in §3.6 (tag ruleset, `v*`, "Restrict creations", owner-only bypass). **Decision:** creating it is a **tracked prerequisite that gates the first `vX.Y.Z` release** — the first release MUST NOT proceed with only the workflow actor-check active, because REQ-SEC-02 (P0) names the ruleset as the *primary* layer. The one-time setup is documented as a step in the release/install docs (§2). This is no longer an open question; it is a required pre-release checklist item.
- **OTQ-2 (optional hardening):** Whether to pin `actions/*` and `pnpm/action-setup` to commit SHAs (supply-chain) rather than major tags. Current repo convention uses major tags (`@v4`); this spec follows that convention. Flagged for a future security pass.
- **OTQ-3:** Whether to also pin `setup-bun`'s read of `.bun-version` with a lockfile-style hash. Not needed now — `.bun-version` is an exact pin.
```
