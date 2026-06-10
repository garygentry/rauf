# Progress — release-automation

## Iteration 1 — item 001 (scaffold scripts/release/lib.ts)

- Created `scripts/release/lib.ts` (types + constants + `fail()`, exact TypeScript from spec 00) and `.bun-version` (`1.3.10`).
- **Learnings for future iterations:**
  - Root `pnpm typecheck` is `pnpm -r typecheck` — it only covers `packages/*`, NOT `scripts/`. To typecheck `scripts/release/*.ts` directly use:
    `bunx tsc --noEmit --strict --noUncheckedIndexedAccess --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --typeRoots packages/core/node_modules --types bun-types scripts/release/lib.ts`
    (`bun-types` is hoisted only into package-level node_modules, hence the `--typeRoots`; `--skipLibCheck` is required — bun-types 1.3.9 has lib errors otherwise.)
  - `pnpm format:check` (`prettier --check .`) was failing on 16 pre-existing files under `specs/release-automation/` (forge-generated docs + backlog.json, which the loop runner manages and iterations must not modify). Fixed durably by adding `specs` to `.prettierignore` — consistent with the existing ignores (`.rauf`, `plans`, `artifacts`, `schemas`).
  - `SEMVER_RE` confirmed byte-identical to the regex at `scripts/bump-version.sh:17` (item 003 removes that script).

## Iteration 2 — item 002 (lib.ts pure functions + lib.test.ts + vitest harness)

- Implemented all ten pure functions in `scripts/release/lib.ts` (spec 02), `scripts/release/__fixtures__.ts` (makeChangelog / makeRepoFixture / cleanupRepoFixtures), `scripts/release/lib.test.ts` (39 tests, all spec 07 §2.1 cases), root `vitest.config.ts`, and the root package.json wiring (`test`: `pnpm -r test && vitest run`, vitest `^3.0.0` devDep).
- **Learnings for future iterations:**
  - **Runtime mismatch the specs didn't account for:** spec 02 says `compareVersions` wraps `Bun.semver.order`, but the root vitest suite runs under **Node** (vitest's bin shebang is node; same for the package suites) where the `Bun` global does not exist. Resolution: `compareVersions` uses `Bun.semver.order` when `typeof Bun !== "undefined"` (production — prepare/preflight always run under Bun) and falls back to a local semver §11 comparator for the SEMVER_RE-validated subset under Node. Both paths verified to agree on all 12 ordering cases (Bun path checked via `bun -e` one-off). A module-scoped `declare const Bun: {...} | undefined` keeps it typechecking in both type environments.
  - `makeRepoFixture` accepts `string` (all seven locations) or `Record<string,string>` keyed by location path with `"*"` default — designed so item 004's `detectDrift` tests can express per-file divergence (e.g. `{ "*": "0.2.0", "packages/docs/package.json": "0.1.0" }`). Call `cleanupRepoFixtures()` in `afterEach`.
  - `makeChangelog` output shape is pinned by literal assertions in the byte-exact rollChangelog tests — if you change the factory's blank-line layout, those literals must change too (intentional coupling).
  - The scripts typecheck command from iteration 1 works for the test files too (vitest types resolve from root node_modules with `--moduleResolution bundler`).
  - `pnpm lint` is `pnpm -r lint` — root-level `scripts/` is not linted, only prettier-checked.
## Iteration 3 — item 003 (prepare.ts + prepare.test.ts; remove bump-version.sh)

- Created `scripts/release/prepare.ts` (all five guards, dry-run, seven-location bump, changelog roll, commit/tag, branch-first push w/ recovery), `scripts/release/prepare.test.ts` (10 tests over the three pure predicates), added root `release:prepare` script, removed `scripts/bump-version.sh`, and reworded the two lib.ts comments that contained the literal "bump-version.sh" (the acceptance grep covers `scripts/`, which includes `scripts/release/lib.ts`).
- **Learnings for future iterations:**
  - **Executable-vs-import pattern for prepare/preflight:** the whole git-touching flow lives in `main()` gated by `if (meta.main)`, where `const meta = import.meta as ImportMeta & { dir: string; main: boolean }` (a local cast, same trick as lib.ts's `declare const Bun`). Under `bun run` `import.meta.main` is true; under Node-based vitest it is undefined, so `prepare.test.ts` imports the exported pure predicates (`checkValidVersion`, `checkVersionForward`, `checkChangelogNonEmpty`) without triggering any git/exec. Item 004's preflight.ts should use the same pattern for `detectDrift`.
  - **This machine has `tag.gpgSign=true` in global git config** — a bare `git tag <name>` forces an annotated/signed tag, demands a message, and dies non-interactively with `fatal: no tag message?`. prepare.ts therefore tags with `git tag -m <tag> <tag>` (signed annotated tag; verified it works non-interactively). Anything else in this feature that creates tags must do the same.
  - **Smoke-test trick for the git-mutating paths without touching the real repo:** `git clone <repo> /tmp/x -b feature/release-automation && git -C /tmp/x branch -m main` — the renamed branch keeps its upstream, so `@`/`@{u}`/merge-base agree and all guards pass; `--dry-run` and `--no-push` then exercise the full flow safely (origin = the local repo path, so fetch/ls-remote work offline). Both paths verified end-to-end this way (dry-run: byte-identical to spec 03 §5 worked example incl. the docs `(corrects drift)` annotation; --no-push: commit + signed tag + clean tree).
  - The interactive shell aliases `rm` to `rm -i` — a plain `rm` in the Bash tool silently no-ops on the prompt. Use `rm -f` and re-verify deletions.
## Iteration 4 — item 004 (preflight.ts drift guard + preflight.test.ts)

- Created `scripts/release/preflight.ts` (v* tag validation, pure `detectDrift()`, GITHUB_OUTPUT emission, all failures via `fail()` with the greppable `drift: ` prefix) and `scripts/release/preflight.test.ts` (6 tests: all-agree stable+prerelease, tag-mismatch, docs-package-mismatch, isPrerelease true/false). Used the same `import.meta.main` + `const meta = import.meta as ImportMeta & {...}` executable-vs-import pattern from prepare.ts.
- **Learnings for future iterations:**
  - Running preflight against the REAL repo currently (correctly) fails with `drift: packages/docs/package.json version 0.1.0 != canonical 0.2.0` — the historical docs drift is live until the first `release:prepare` run corrects it. Don't mistake that for a preflight bug.
  - **Smoke-test trick for preflight's success path:** copy `lib.ts` + `preflight.ts` into a temp tree (`$FIX/scripts/release/`) alongside a fabricated `packages/core/src/version.ts` + six agreeing package.json files — `import.meta.dir` then resolves repoRoot to the fixture, so both the stable and prerelease GITHUB_OUTPUT paths run for real without touching the repo. Both verified (version=/is_prerelease= lines exact), plus INPUT_TAG fallback and the missing-GITHUB_OUTPUT failure.
  - Prettier wants long multi-name import lines broken — run `npx prettier --write` on new scripts/release files before `pnpm format:check` (it bit this iteration; scripts/ is format-checked but not linted).

## Iteration 5 — item 005 (build-notes.ts + build-notes.test.ts)

- Created `scripts/release/build-notes.ts` (pure `composeNotes()` + main flow: extractSection → `git describe --tags --abbrev=0 --match 'v*' <tag>^` → write dist/NOTES.md, mkdir -p dist) and `scripts/release/build-notes.test.ts` (2 tests: prior tag appends the compare link byte-exact; null omits it). Same `import.meta.main` executable-vs-import pattern.
- **Learnings for future iterations:**
  - `node:child_process` is allowed in `scripts/release/*` executables (build-notes.ts, prepare.ts) — the prohibition only covers `lib.ts` (the pure module). Don't over-apply the constraint.
  - **Smoke-test trick for build-notes:** temp git repo with `lib.ts`+`build-notes.ts` under `$FIX/scripts/release/`, a CHANGELOG, and tags `pre-rauf-rename` → `v0.2.0` → `v0.3.0`. Verified the compare base resolves to v0.2.0 (decoy excluded by `--match 'v*'`); deleting v0.2.0 from the history → first-release path, no compare line. In the fixture use `git -c tag.gpgSign=false tag <name>` for lightweight tags (the gpgSign learning from iteration 3).
  - On the first-release path `git describe`'s `fatal: No tags can describe …` goes to stderr (execFileSync inherits stderr) before the catch swallows the nonzero exit — expected noise in CI logs, not a failure; the spec's sample code behaves identically.
## Iteration 6 — item 006 (quality-gate composite action + ci.yml refactor)

- Created `.github/actions/quality-gate/action.yml` (exact YAML from spec 04 §5) and replaced ci.yml's six inline gate steps with `- uses: ./.github/actions/quality-gate` (setup/install steps untouched).
- **Learnings for future iterations:**
  - **YAML parse validation without extra deps:** `Bun.YAML.parse(await Bun.file(f).text())` via `bun -e` — no js-yaml/pyyaml install needed. Item 007's "release.yml parses as valid YAML" criterion can use the same one-liner.

## Iteration 7 — item 007 (release.yml release workflow)

- Created `.github/workflows/release.yml` — verbatim from spec 04 §3 (triggers push tags v* + workflow_dispatch(tag), permissions contents: write only, concurrency release-${{ github.ref }} / cancel-in-progress: false, 13 steps: checkout → authorize actor → setup-bun/pnpm → install → preflight + no-existing-release assert → quality-gate → cross-compile ×5 → SHA256SUMS → build-notes → gh release create → summary). Completed in 1 iteration (estimate was 2 — the spec YAML was copy-ready).
- **Learnings for future iterations:**
  - Structural acceptance checks on workflow YAML are scriptable with the same `Bun.YAML.parse` trick: parse, then index `y.jobs.release.steps` to assert step order/`if:` conditions/`run:` contents programmatically rather than eyeballing.
  - The spec YAML is already prettier-clean for .github files (prettier reformats `tags: ['v*']`→`["v*"]` style but our spec already used double quotes); comment alignment inside `run: |` blocks is untouched by prettier since it's string content.
  - GitHub Actions injection hygiene (a PostToolUse hook flags workflow edits): `github.event.inputs.tag` must only reach `run:` blocks via `env:` (TAG/INPUT_TAG), never direct `${{ }}` interpolation in shell text — the spec's YAML already follows this; keep the pattern for any future workflow steps.

## Iteration 8 — item 008 (SHA256 verification in install-binary.sh)

- Inserted the spec 05 §1.2 verification block into `scripts/install-binary.sh` (download mode only, after the curl into `$TMP`, before `install -m 0755`). detect_asset() and the URL scheme untouched.
- **Spec bug found & fixed:** the spec's snippet does `EXPECTED="$(grep " ${ASSET}\$" "$SUMS_TMP" | awk '{print $1}')"` — under the script's `set -euo pipefail`, a no-match grep makes the assignment fail and kills the script with a silent exit 1, breaking the "unlisted asset → warn + continue" semantics. Fixed by appending `|| true` inside the substitution. Item 009's ps1 is unaffected (PowerShell), but any future bash that greps under set -e needs the same guard.
- **Smoke-test trick for installer paths without a release:** a PATH-prepended `curl` shim (`case "$URL" in */SHA256SUMS) …`) that copies fixture files lets every path run for real: OK / mismatch / unreachable-sums / unlisted-asset all verified, incl. exit codes and "binary never installed on failure". For the missing-tool path, build a restricted PATH dir of symlinks — but use zsh's `whence -p` (NOT `command -v`, which returns alias text like `alias rm='rm -i'` and builtin names in the interactive zsh the Bash tool runs).
- `--local` skip verified with a curl shim that exits 97 if invoked — no network call, no checksum output.
## Iteration 9 — item 009 (install-binary.ps1)

- Created `scripts/install-binary.ps1` per spec 05 §2.2 (download `rauf-windows-x64.exe` + SHA256SUMS → mandatory Get-FileHash verify → Move-Item to `$HOME\.local\bin\rauf.exe` → user-PATH append → `& $Target version`). RAUF_REPO/RAUF_VERSION overrides honored.
- **Spec bug found & fixed (PowerShell twin of iteration 8's `|| true`):** the spec's `(Select-String …).Line.Split(" ")[0]` throws a null-method error when the asset is NOT listed in SHA256SUMS — before the intended `remove temp + throw "not listed"` path runs, leaving the unverified download on disk. Fixed by guarding the match (`$SumsMatch = Select-String … | Select-Object -First 1; $expected = if ($SumsMatch) { … } else { $null }`) so the unlisted-asset path removes $Tmp and throws the spec's message.
- No `pwsh` on this machine (`whence -p pwsh powershell` → nothing), so acceptance was verified by inspection as the item's notes prescribe. Prettier has no PowerShell parser — `.ps1` files pass `format:check` untouched.

## Iteration 10 — item 010 (release/install docs + one-time setup)

- Created `docs/RELEASING.md` (release-tags ruleset as FIRST-RELEASE BLOCKER with exact GitHub steps, pre-release checklist, release:prepare flow, Unix/Windows install one-liners, macOS quarantine note + curl-not-quarantined caveat, v1 unsigned/deferred-signing stance) and added an Install section + docs-table row to README.md.
- **Learnings for future iterations:**
  - There is no `docs/architecture/` dir despite spec 01's layout line — docs are flat UPPERCASE files under `docs/`; `RELEASING.md` follows that convention.
  - `packages/docs` (Astro Starlight) auto-builds from `docs/` content collections but only the pages in its sidebar config — adding `docs/RELEASING.md` did NOT break `pnpm build` (it's simply not routed); if it should appear on the docs site, that's a separate sidebar/content-collection change.
  - Item 011 is the RAUF_NEEDS_HUMAN e2e gate; it depends on the `release-tags` ruleset (manual GitHub config documented in docs/RELEASING.md §1.1) being created by the maintainer BEFORE its step 2.
