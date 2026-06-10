# 04 — CI Preflight & Release Workflow

The CI half of the feature: the `preflight.ts` drift guard + prerelease classifier, the `release.yml` workflow that builds and publishes, the shared `quality-gate` composite action, and the `.bun-version` pin. Triggered by a `v*` tag push from the prep helper (`03-prepare-helper.md`).

## Requirement Coverage

| REQ ID            | Requirement                                                  | Section          |
| ----------------- | ----------------------------------------------------------- | ---------------- |
| REQ-TRIGGER-01    | Release triggered by `v*` tag push                          | 3 (trigger)      |
| REQ-TRIGGER-02    | Drift guard: tag↔version.ts↔all six package.json            | 2.2              |
| REQ-TRIGGER-03    | `workflow_dispatch` for an existing tag (P2)                | 3 (trigger)      |
| REQ-BUILD-01/07   | Cross-compile five targets via Bun `--target`               | 3 step 7         |
| REQ-BUILD-02      | Asset names match `install-binary.sh`                       | 3 step 7         |
| REQ-BUILD-03      | Release object with all assets + checksums                  | 3 step 10        |
| REQ-BUILD-04/05   | `--latest` for stable, `--prerelease` for pre               | 2.3, 3 step 10   |
| REQ-BUILD-06      | Full quality gate on the tagged commit                      | 3 step 6, 5      |
| REQ-INTEGRITY-01  | Generate `SHA256SUMS`                                        | 3 step 8         |
| REQ-NOTES-02/03   | Notes from changelog section + Full Changelog link          | 3 step 9         |
| REQ-RELIABILITY-01| Atomic single-shot publish                                  | 3 step 10        |
| REQ-RELIABILITY-02| Refuse if release already exists                            | 3 step 5         |
| REQ-RELIABILITY-04| Failure surfaced in Actions UI                              | 3 (job design)   |
| REQ-SEC-01        | `contents: write` GITHUB_TOKEN only                         | 3 (permissions)  |
| REQ-SEC-02        | Actor authorization (defense-in-depth half)                 | 3 step 2; see 06 |
| REQ-PERF-01       | Single serial job within 15 min                             | 3 (job design)   |
| REQ-OBS-01/02     | Distinguishable steps; summary with URL + version           | 3 step 11        |

## 1. `preflight.ts` purpose

A standalone Bun script invoked by workflow step 5. It is the **machine-side enforcement of the single most important invariant** (REQ-TRIGGER-02): the tag, the canonical `version.ts`, and all six `package.json` versions must agree. It also classifies prerelease vs stable (REQ-BUILD-05) and emits the workflow outputs.

## 2. `preflight.ts` behavior

### 2.1 Inputs

```typescript
// Tag comes from the push trigger (GITHUB_REF_NAME = "v0.3.0") or the
// workflow_dispatch `tag` input forwarded as an env var.
const ref = process.env.GITHUB_REF_NAME ?? process.env.INPUT_TAG ?? "";
if (!ref.startsWith("v")) fail(`drift: expected a v* tag, got "${ref}"`);
const tagVersion = ref.slice(1);
if (!isValidVersion(tagVersion)) fail(`drift: tag ${ref} is not a valid version`);
```

### 2.2 Drift guard (REQ-TRIGGER-02)

```typescript
const repoRoot = path.resolve(import.meta.dir, "../..");
const locations = readVersionLocations(repoRoot);
const canonical = locations.find((l) => l.canonical)!.version;

// tag ↔ version.ts
if (tagVersion !== canonical) {
  fail(`drift: tag ${ref} (=${tagVersion}) != version.ts VERSION (${canonical})`);
}
// version.ts ↔ every package.json
for (const loc of locations) {
  if (!loc.canonical && loc.version !== canonical) {
    fail(`drift: ${loc.file} version ${loc.version} != canonical ${canonical}`);
  }
}
```

A single mismatch exits nonzero **before any build or publish step runs** (REQ-PREP-07-style fail-fast on the CI side), so a half-consistent state (e.g. the historical docs drift) can never ship.

### 2.3 Classification + outputs (REQ-BUILD-05, output contract 00 §6)

```typescript
const isPre = isPrerelease(tagVersion);
const outFile = process.env.GITHUB_OUTPUT;
if (!outFile) fail("drift: GITHUB_OUTPUT not set (must run inside Actions)");
fs.appendFileSync(outFile, `version=${tagVersion}\n`);
fs.appendFileSync(outFile, `is_prerelease=${isPre}\n`);
console.log(`preflight OK: ${ref} (${isPre ? "prerelease" : "stable"})`);
```

## 3. `release.yml` — single `ubuntu-latest` job

```yaml
name: Release

on:
  push:
    tags: ["v*"]            # REQ-TRIGGER-01
  workflow_dispatch:         # REQ-TRIGGER-03 (P2)
    inputs:
      tag:
        description: "Existing vX.Y.Z tag to (re)release"
        required: true

permissions:
  contents: write            # REQ-SEC-01 — minimum needed to create a release

concurrency:
  group: release-${{ github.ref }}   # serialize same-tag runs (cross-tag safety: tech-spec §3.7)
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      # 1. Full history + tags for the Full Changelog compare link (REQ-NOTES-03).
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event.inputs.tag || github.ref }}

      # 2. Actor authorization (defense-in-depth — REQ-SEC-02; primary layer is the
      #    tag ruleset, see 06-security-and-setup.md).
      - name: Authorize actor
        if: github.actor != github.repository_owner
        run: |
          echo "::error::actor ${{ github.actor }} is not the repository owner" >&2
          exit 1

      # 3. Toolchain — setup-bun auto-reads .bun-version (§4).
      - uses: oven-sh/setup-bun@v2
      - uses: pnpm/action-setup@v4

      # 4. Dependencies.
      - run: pnpm install --frozen-lockfile

      # 5. Preflight: drift guard + classification + "no existing release" check.
      - name: Preflight
        id: preflight
        env:
          INPUT_TAG: ${{ github.event.inputs.tag }}
        run: bun run scripts/release/preflight.ts
      - name: Assert no existing release (REQ-RELIABILITY-02)
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.event.inputs.tag || github.ref_name }}
        run: |
          if gh release view "$TAG" >/dev/null 2>&1; then
            echo "::error::release $TAG already exists — refusing to overwrite" >&2
            exit 1
          fi

      # 6. Quality gate (REQ-BUILD-06) — the SAME composite action ci.yml uses (§5).
      - uses: ./.github/actions/quality-gate

      # 7. Cross-compile all five targets (REQ-BUILD-01/02/07). pnpm build already
      #    ran in step 6, so this is just the five compile invocations into dist/.
      - name: Cross-compile binaries
        run: |
          mkdir -p dist
          bun build --compile --target=bun-linux-x64    scripts/binary-entry.ts --outfile dist/rauf-linux-x64
          bun build --compile --target=bun-linux-arm64  scripts/binary-entry.ts --outfile dist/rauf-linux-arm64
          bun build --compile --target=bun-darwin-x64   scripts/binary-entry.ts --outfile dist/rauf-darwin-x64
          bun build --compile --target=bun-darwin-arm64 scripts/binary-entry.ts --outfile dist/rauf-darwin-arm64
          bun build --compile --target=bun-windows-x64  scripts/binary-entry.ts --outfile dist/rauf-windows-x64.exe

      # 8. Checksums (REQ-INTEGRITY-01) — plain filenames so `sha256sum -c` works post-download.
      - name: Checksums
        run: cd dist && sha256sum rauf-* > SHA256SUMS

      # 9. Release notes (REQ-NOTES-02/03).
      - name: Build notes
        env:
          TAG: ${{ github.event.inputs.tag || github.ref_name }}
          VERSION: ${{ steps.preflight.outputs.version }}
        run: bun run scripts/release/build-notes.ts   # writes dist/NOTES.md

      # 10. Atomic single-shot publish (REQ-RELIABILITY-01, REQ-BUILD-03/04/05).
      - name: Create release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.event.inputs.tag || github.ref_name }}
          IS_PRERELEASE: ${{ steps.preflight.outputs.is_prerelease }}
        run: |
          gh release create "$TAG" \
            dist/rauf-linux-x64 dist/rauf-linux-arm64 \
            dist/rauf-darwin-x64 dist/rauf-darwin-arm64 \
            dist/rauf-windows-x64.exe dist/SHA256SUMS \
            --title "$TAG" --notes-file dist/NOTES.md --verify-tag \
            $( [ "$IS_PRERELEASE" = "true" ] && echo --prerelease || echo --latest )

      # 11. Summary (REQ-OBS-02).
      - name: Summary
        env:
          TAG: ${{ github.event.inputs.tag || github.ref_name }}
        run: |
          URL="https://github.com/${{ github.repository }}/releases/tag/$TAG"
          echo "### Released $TAG" >> "$GITHUB_STEP_SUMMARY"
          echo "$URL" >> "$GITHUB_STEP_SUMMARY"
```

**Job-design notes:**
- **Atomicity (REQ-RELIABILITY-01).** Every asset is built and checksummed *before* step 10; the single `gh release create` attaches them all in one call. Any failure in steps 1–9 creates no release object, so the tag is cleanly re-runnable (REQ-RELIABILITY-03) — no drafts are ever made.
- **Observability (REQ-OBS-01, REQ-RELIABILITY-04).** Each named step is independently visible/red-able in the Actions UI: preflight, quality gate, compile, checksums, notes, create.
- **Performance (REQ-PERF-01).** One serial job; expected wall-clock budget in tech-spec §3.13. Fallback to a native-runner matrix is documented (tech-spec §3.3) if the budget is breached or a cross-target regresses.
- **Cross-tag concurrency (REQ-BUILD-04/05).** The `concurrency` group is keyed on `github.ref`, so it only serializes same-tag runs; distinct-tag runs (e.g. `v0.3.0-rc.1` then `v0.3.0`) may overlap safely — each publishes its own tag, and `--latest` is attached *only* on stable, so a late-finishing prerelease can never steal `latest` (tech-spec §3.7).

### Step 9 detail — `build-notes.ts` (REQ-NOTES-02/03)

A thin Bun script (sibling of `preflight.ts`) that composes `dist/NOTES.md`:

```typescript
const repoRoot = path.resolve(import.meta.dir, "../..");
const version = process.env.VERSION!;             // from preflight output
const tag = process.env.TAG!;
const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");

let notes = extractSection(changelog, version);    // REQ-NOTES-02 (verbatim section body)

// REQ-NOTES-03: append a Full Changelog link only when a PRIOR RELEASE tag exists.
// `--match 'v*'` is mandatory so the unrelated `pre-rauf-rename` tag is never selected.
let prev = "";
try {
  prev = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`],
    { cwd: repoRoot, encoding: "utf8" }).trim();
} catch { prev = ""; }   // first release — no prior v* tag

if (prev) {
  notes += `\n\n**Full Changelog**: https://github.com/${REPO_SLUG}/compare/${prev}...${tag}\n`;
}
fs.writeFileSync(path.join(repoRoot, "dist/NOTES.md"), notes);
```

> First-release behavior: when no prior `v*` tag exists, `git describe` exits nonzero, `prev` stays `""`, and the Full Changelog line is **omitted entirely** rather than fabricating a compare base against `pre-rauf-rename` (tech-spec §3.4 step 9, §3.10).

## 4. `.bun-version` & the CI pinning behavior change (tech-spec §3.9)

`.bun-version` (content `1.3.10`) is auto-read by `oven-sh/setup-bun@v2` in **both** workflows. Important: `ci.yml`'s existing `setup-bun` step passes **no** `bun-version` input today — it resolves to the action's default (latest). Introducing `.bun-version` therefore **newly pins CI to 1.3.10** — a deliberate behavior change to CI's runtime, not a confirmation of pre-existing parity. Validate by re-running CI once the pin lands. Afterward, CI, release, and local builds all resolve the same Bun (reproducible compile output).

## 5. `quality-gate` composite action (REQ-BUILD-06, tech-spec §6.3)

Single source of truth for the gate; eliminates drift between `ci.yml` and `release.yml` (V-009). Assumes the caller already set up Bun/pnpm and ran install.

```yaml
# .github/actions/quality-gate/action.yml
name: Quality Gate
description: Build + schema check + typecheck + lint + format + tests (shared by ci.yml and release.yml).
runs:
  using: composite
  steps:
    - run: pnpm build
      shell: bash
    - run: pnpm schema:check
      shell: bash
    - run: pnpm typecheck
      shell: bash
    - run: pnpm lint
      shell: bash
    - run: pnpm format:check
      shell: bash
    - run: pnpm test
      shell: bash
```

`ci.yml`'s `check` job is modified to replace its inline `build → schema:check → typecheck → lint → format:check → test` steps with a single `- uses: ./.github/actions/quality-gate` (after its existing checkout / setup-bun / pnpm / install steps). Adding or removing a check is then a one-place edit that applies to both workflows automatically.

## Dependencies

- `00-core-definitions.md` — `RELEASE_TARGETS`, `CHECKSUMS_FILE`, `REPO_SLUG`, output contract, `fail()`.
- `02-shared-lib.md` — `readVersionLocations`, `isValidVersion`, `isPrerelease`, `extractSection`.
- `03-prepare-helper.md` — produces the tag that triggers this workflow.
- `.github/actions/quality-gate/action.yml` must exist before `ci.yml`/`release.yml` reference it.

## Verification

- `preflight.test.ts` covers drift detection across all seven locations (match, tag-mismatch, one-package-mismatch) and prerelease classification (tech-spec §8).
- End-to-end (tech-spec §8): cut `v0.3.0-rc.1` → all five assets + `SHA256SUMS` publish, release marked **prerelease** (not latest), notes match the changelog section; then promote `v0.3.0` → becomes `latest`. (Success Criteria #3/#6.)
- Drift negative test: push a tag whose value ≠ `version.ts` → job fails at step 5 before any build (Success Criteria #5/#9).
- Re-run against an already-published stable tag → step 5 "Assert no existing release" fails, nothing mutated (Success Criteria #8).
- `git grep -n "quality-gate"` shows both `ci.yml` and `release.yml` referencing the composite action; neither contains the inline 7-command list.
