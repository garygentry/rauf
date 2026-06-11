# 01 — Architecture & Layout

How the release-automation feature is structured in the repo: the file tree, manifest/build wiring, module export surface, and build/deploy considerations. All paths are repo-root-relative.

## Requirement Coverage

| REQ ID         | Requirement                                          | Section                  |
| -------------- | ---------------------------------------------------- | ------------------------ |
| REQ-PREP-06    | Release tooling under `scripts/`, not in the product | 1, 4 (no binary-entry import) |
| REQ-BUILD-06   | Quality gate shared via composite action             | 1, 3.2                   |
| REQ-PERF-01    | Single serial job fits the 15-min budget             | 4 (build/deploy)         |
| REQ-INSTALL-02 | Windows installer hosted under `scripts/`            | 1                        |
| (tech §3.9)    | `.bun-version` pins Bun for CI + release             | 1, 3.1                   |
| (tech §6.3)    | Scoped root vitest project                           | 2, 3.1                   |

## 1. Directory tree

New (`+`) and modified (`~`) files. Removed (`-`). Everything is repo infrastructure — none is bundled into the shipped binary (REQ-PREP-06, C-4).

```
rauf/
├── .bun-version                              + pins Bun "1.3.10" (tech-spec §3.9)
├── vitest.config.ts                          + root vitest project, scoped to scripts/release/** (§3.1)
├── package.json                              ~ release:prepare script, vitest devDep, test wiring (§3.1)
├── CHANGELOG.md                              ~ (data) grammar per 00-core-definitions.md §4
├── .github/
│   ├── actions/
│   │   └── quality-gate/
│   │       └── action.yml                    + composite: the 6-command gate (04-…workflow.md §3)
│   └── workflows/
│       ├── ci.yml                            ~ check job → uses ./.github/actions/quality-gate (§3.2)
│       └── release.yml                       + the release workflow, single ubuntu-latest job
├── scripts/
│   ├── release/
│   │   ├── lib.ts                            + shared pure logic (02-shared-lib.md)
│   │   ├── lib.test.ts                       + colocated unit tests
│   │   ├── prepare.ts                        + maintainer prep helper (03-prepare-helper.md)
│   │   ├── prepare.test.ts                   + unit tests for pure guard predicates
│   │   ├── preflight.ts                      + CI drift guard + classification (04-…workflow.md §2)
│   │   ├── preflight.test.ts                 + unit tests for drift/classification
│   │   ├── build-notes.ts                    + CI: compose dist/NOTES.md (04-…workflow.md §3 step 9)
│   │   └── build-notes.test.ts               + unit test for the prev-tag/notes-omission logic
│   ├── install-binary.sh                     ~ add SHA256 verification (05-install-scripts.md)
│   ├── install-binary.ps1                    + Windows PowerShell installer (05-install-scripts.md)
│   ├── bump-version.sh                        - REMOVED — subsumed by scripts/release/prepare.ts
│   └── binary-entry.ts                       (unchanged — compile entry, tech-spec §6.5)
└── docs/architecture/ (or docs/)             ~ install + release docs incl. macOS quarantine + ruleset setup
```

### Public surface (maintainer-facing)

- `pnpm release:prepare <X.Y.Z[-pre]> [--dry-run] [--no-push]` → `bun run scripts/release/prepare.ts`
- Pushing the resulting `vX.Y.Z` tag (done by `prepare.ts` unless `--no-push`) → triggers `release.yml`
- End users: `install-binary.sh` (Unix, unchanged invocation) and `install-binary.ps1` (Windows, new)

## 2. Manifest & build wiring

### Root `package.json` changes (tech-spec §6.3, §3.1)

```jsonc
{
  "scripts": {
    // NEW — the maintainer entry point
    "release:prepare": "bun run scripts/release/prepare.ts",
    // MODIFIED — also run the scoped root vitest project so scripts/release/** is covered
    // by the same `pnpm test` the quality gate invokes (REQ-BUILD-06)
    "test": "pnpm -r test && vitest run"
  },
  "devDependencies": {
    // NEW — same MAJOR as the packages (core/cli/loop/web all pin ^3.0.0) so the
    // workspace never resolves two vitest majors (tech-spec §6.3, V-008)
    "vitest": "^3.0.0"
  }
}
```

> No new **runtime** dependency is added (REQ-PREP-06, C-4): semver comparison uses `Bun.semver` (no `semver` lib), and the scripts import nothing from `@rauf/*`.

### Root `vitest.config.ts` (NEW — tech-spec §6.3)

Scoped so the root run covers **only** the new script tests and does NOT re-discover the four packages' suites already run by `pnpm -r test` (avoids double-runs that would inflate CI time / REQ-PERF-01):

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cover only scripts/release/** — packages run via `pnpm -r test`.
    include: ["scripts/release/**/*.test.ts"],
    exclude: ["packages/**", "node_modules/**"],
  },
});
```

### `.bun-version` (NEW)

```
1.3.10
```

Auto-read by `oven-sh/setup-bun@v2` in both `ci.yml` and `release.yml`. See `04-ci-preflight-and-workflow.md` §4 for the CI-pinning behavior change this introduces.

## 3. Module export structure

### 3.1 `scripts/release/lib.ts` export surface

Pure, side-effect-free, no `process.exit`, no `@rauf/core` import. Full signatures and algorithms in `02-shared-lib.md`. Summary of the public surface:

```typescript
// Types & constants (re-stated from 00-core-definitions.md)
export interface VersionLocation { /* … */ }
export interface ReleaseTarget { /* … */ }
export const VERSION_TS_PATH: string;
export const PACKAGE_JSON_PATHS: readonly string[];
export const RELEASE_TARGETS: ReleaseTarget[];
export const SEMVER_RE: RegExp;
export function fail(message: string): never;

// Version locations
export function readVersionLocations(repoRoot: string): VersionLocation[];
export function parseVersionTs(content: string): string;
export function setVersionTs(content: string, v: string): string;
export function setPackageJsonVersion(content: string, v: string): string;

// Semver
export function isValidVersion(v: string): boolean;
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function isPrerelease(v: string): boolean;

// Changelog
export function getUnreleasedBody(content: string): string;
export function rollChangelog(content: string, v: string): { updated: string; sectionBody: string };
export function extractSection(content: string, v: string): string;
```

> `prepare.ts` and `preflight.ts` are **executables** (they have top-level effects / `process.exit`), so they are NOT imported by anything except their own `*.test.ts`, which import only the pure predicates they re-export. The testable predicates are factored so tests never touch git or the filesystem (tech-spec §8).

### 3.2 Workflow / composite-action structure

- `.github/actions/quality-gate/action.yml` — a **local composite action** running the 6-command gate (`build → schema:check → typecheck → lint → format:check → test`). Single source of truth; both `ci.yml`'s `check` job and `release.yml` step 6 do `uses: ./.github/actions/quality-gate`. Drift between the two gates is structurally impossible (tech-spec §6.3, V-009).
- `release.yml` — one `release` job on `ubuntu-latest`, 11 ordered steps (`04-ci-preflight-and-workflow.md` §3).

## 4. Build & deployment considerations

- **No product impact.** `scripts/binary-entry.ts` imports only `packages/web` + `packages/cli` (verified). Nothing under `scripts/release/**` is reachable from it, so the compiled binary is byte-for-byte unaffected by this feature (REQ-PREP-06, C-4).
- **Single serial job (REQ-PERF-01).** The release runs as one `ubuntu-latest` job: setup → quality gate → five serial cross-compiles → checksums → notes → single `gh release create`. Expected wall-clock fits the 15-min SHOULD with margin (tech-spec §3.13). The documented fallback if the budget is breached (or a Bun cross-target regresses) is the native-runner matrix (tech-spec §3.3).
- **Reproducibility.** `.bun-version` pins the toolchain so CI, release, and local builds resolve the same Bun.
- **Atomicity.** All binaries + checksums are produced and validated **before** the single release-create call, so a failure on any target publishes nothing (REQ-RELIABILITY-01).

## Dependencies

- `00-core-definitions.md` — all types/constants referenced here.

## Verification

- `pnpm typecheck` passes with the new root `vitest.config.ts` and `scripts/release/**`.
- `pnpm test` runs the four package suites once each **and** the scripts/release suite once — no package test runs twice (confirm by test count / timing).
- `grep -r "scripts/release" scripts/binary-entry.ts` returns nothing (product isolation).
- `bump-version.sh` no longer exists; `grep -rn "bump-version.sh" docs/ scripts/ README.md` finds only historical/removed references that have been updated to `pnpm release:prepare`.
- Both `ci.yml` and `release.yml` reference `./.github/actions/quality-gate` (no duplicated step list).
