# Progress — release-automation

## Iteration 1 — item 001 (scaffold scripts/release/lib.ts)

- Created `scripts/release/lib.ts` (types + constants + `fail()`, exact TypeScript from spec 00) and `.bun-version` (`1.3.10`).
- **Learnings for future iterations:**
  - Root `pnpm typecheck` is `pnpm -r typecheck` — it only covers `packages/*`, NOT `scripts/`. To typecheck `scripts/release/*.ts` directly use:
    `bunx tsc --noEmit --strict --noUncheckedIndexedAccess --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --typeRoots packages/core/node_modules --types bun-types scripts/release/lib.ts`
    (`bun-types` is hoisted only into package-level node_modules, hence the `--typeRoots`; `--skipLibCheck` is required — bun-types 1.3.9 has lib errors otherwise.)
  - `pnpm format:check` (`prettier --check .`) was failing on 16 pre-existing files under `specs/release-automation/` (forge-generated docs + backlog.json, which the loop runner manages and iterations must not modify). Fixed durably by adding `specs` to `.prettierignore` — consistent with the existing ignores (`.rauf`, `plans`, `artifacts`, `schemas`).
  - `SEMVER_RE` confirmed byte-identical to the regex at `scripts/bump-version.sh:17` (item 003 removes that script).
