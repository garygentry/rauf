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
