# 00 — Core Definitions

Shared types, constants, and contracts for the release-automation feature. Every other spec document references definitions here. All release tooling lives under `scripts/release/` and `.github/`; none of it is imported by the product (`scripts/binary-entry.ts`), per constraint C-4 / REQ-PREP-06.

> **Runtime note.** Every `.ts` file in `scripts/release/` runs under **Bun** (not Node), so Bun-only globals (`Bun.semver`, `Bun.file`) are available. The scripts are standalone programs and do **not** import `@rauf/core` (keeps tooling decoupled from the shipped product — tech-spec §3.2).

## Requirement Coverage

| REQ ID         | Requirement                                              | Section                       |
| -------------- | ------------------------------------------------------- | ----------------------------- |
| REQ-VER-01     | Six lockstep `package.json` version locations           | 1.1, 2.1                      |
| REQ-VER-03     | `version.ts` `VERSION` is canonical                     | 1.1, 2.1                      |
| REQ-VER-04     | Valid semver (optional prerelease suffix)               | 3.1 (regex constant)          |
| REQ-VER-05     | `packages/docs/package.json` included in the set        | 2.1                           |
| REQ-BUILD-01   | Build all five platform binaries                        | 2.2 `RELEASE_TARGETS`         |
| REQ-BUILD-02   | Asset names match `install-binary.sh` `detect_asset()`  | 2.2 `RELEASE_TARGETS`         |
| REQ-BUILD-07   | Bun cross-target compilation `bun-<os>-<arch>`          | 2.2 `RELEASE_TARGETS`         |
| REQ-INTEGRITY-01 | `SHA256SUMS` filename                                  | 2.3                           |
| REQ-NOTES-01   | CHANGELOG `## Unreleased` → `## X.Y.Z` grammar           | 4. CHANGELOG grammar          |
| REQ-PREP-07    | Guard failures exit nonzero with one clear message      | 5. Exit/error model           |
| REQ-RELIABILITY-04 | Failures surfaced with diagnostics                  | 5. Exit/error model           |
| (tech §3.5/§4.4) | Workflow outputs `version`, `is_prerelease`           | 6. Workflow output contract   |

## 1. Types

### 1.1 `VersionLocation` (REQ-VER-01, REQ-VER-03)

The unit of the drift guard. One entry per version-bearing file. Produced by `readVersionLocations()` (see `02-shared-lib.md`) and consumed by both the prep helper (`03-prepare-helper.md`) and the CI preflight (`04-ci-preflight-and-workflow.md`).

```typescript
/**
 * A single resolved version location: a file plus the version string
 * currently recorded in it. `version.ts` is location index 0 (canonical,
 * REQ-VER-03); the six package.json files follow. The drift guard
 * (REQ-TRIGGER-02) holds when every `version` here equals the canonical one.
 */
export interface VersionLocation {
  /** Repo-root-relative path, e.g. "packages/core/src/version.ts" or "package.json". */
  file: string;
  /**
   * The version string read from `file`. For version.ts this is the
   * `VERSION` constant value; for a package.json it is the `.version` field.
   * Never includes a leading "v".
   */
  version: string;
  /**
   * True for the single canonical source (`packages/core/src/version.ts`).
   * Exactly one location in a well-formed set has `canonical: true`.
   */
  canonical: boolean;
}
```

### 1.2 `ReleaseTarget` (REQ-BUILD-01, REQ-BUILD-02, REQ-BUILD-07)

A compile target: the Bun `--target` triple and the published asset name. The asset name is what `install-binary.sh`'s `detect_asset()` constructs, so the two MUST stay in sync (see `05-install-scripts.md`).

```typescript
/**
 * One cross-compile target. `bunTarget` is passed to
 * `bun build --compile --target=<bunTarget>`; `asset` is the published
 * file name (also the `--outfile`). Windows carries a ".exe" extension;
 * the others have none. Asset names match install-binary.sh detect_asset()
 * output exactly (REQ-BUILD-02): `rauf-{os}-{arch}[.exe]`.
 */
export interface ReleaseTarget {
  /** Bun compile triple, e.g. "bun-linux-x64". */
  bunTarget: string;
  /** Published asset / --outfile name, e.g. "rauf-linux-x64" or "rauf-windows-x64.exe". */
  asset: string;
}
```

### 1.3 `PreparePlan` (REQ-PREP-01, dry-run support)

The computed, not-yet-applied result of a prep run. `--dry-run` prints this and exits without mutating; a normal run applies it. Lets the mutation phase be a pure function of validated inputs.

```typescript
/**
 * The fully-validated, about-to-be-applied state of a `release:prepare` run.
 * Computed only after every guard in 03-prepare-helper.md §2 passes.
 */
export interface PreparePlan {
  /** Target version, no leading "v" (e.g. "0.3.0", "0.3.0-rc.1"). */
  version: string;
  /** The git tag to create (always "v" + version). */
  tag: string;
  /** True if `version` carries a prerelease suffix (REQ-BUILD-05). */
  isPrerelease: boolean;
  /** The rolled changelog content to write (REQ-NOTES-01). */
  changelog: string;
  /** The new `## X.Y.Z` section body (for the dry-run preview). */
  sectionBody: string;
  /** Every file that will be rewritten with the new version. */
  locations: VersionLocation[];
}
```

## 2. Constants

### 2.1 Version locations (REQ-VER-01, REQ-VER-05)

Defined once in `scripts/release/lib.ts` and reused everywhere. **All seven** must agree for a release to proceed.

```typescript
/** Canonical version source — the value the running binary reports (REQ-VER-03, C-6). */
export const VERSION_TS_PATH = "packages/core/src/version.ts";

/**
 * The six lockstep package.json files (REQ-VER-01). Order is stable for
 * deterministic output. NOTE the inclusion of packages/docs — the legacy
 * bump-version.sh omitted it, which is why docs drifted to 0.1.0 while
 * everything else is 0.2.0 (REQ-VER-05). This set corrects that.
 */
export const PACKAGE_JSON_PATHS = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/loop/package.json",
  "packages/web/package.json",
  "packages/docs/package.json",
] as const;
```

### 2.2 Release targets (REQ-BUILD-01, REQ-BUILD-02, REQ-BUILD-07)

```typescript
/**
 * The five platform binaries every release builds (REQ-BUILD-01). Asset
 * names match install-binary.sh detect_asset() (REQ-BUILD-02). Cross-compiled
 * from a single ubuntu-latest host — empirically validated on Bun 1.3.10
 * (tech-spec §3.3, RISK-1 retired).
 */
export const RELEASE_TARGETS: ReleaseTarget[] = [
  { bunTarget: "bun-linux-x64", asset: "rauf-linux-x64" },
  { bunTarget: "bun-linux-arm64", asset: "rauf-linux-arm64" },
  { bunTarget: "bun-darwin-x64", asset: "rauf-darwin-x64" },
  { bunTarget: "bun-darwin-arm64", asset: "rauf-darwin-arm64" },
  { bunTarget: "bun-windows-x64", asset: "rauf-windows-x64.exe" },
];

/** The single entry point compiled for every target (unchanged — tech-spec §6.5). */
export const COMPILE_ENTRY = "scripts/binary-entry.ts";
```

### 2.3 Integrity & identity (REQ-INTEGRITY-01, REQ-NOTES-03)

```typescript
/** Checksums file attached to every release (REQ-INTEGRITY-01). */
export const CHECKSUMS_FILE = "SHA256SUMS";

/** owner/repo, confirmed in root package.json repository.url and install-binary.sh RAUF_REPO. */
export const REPO_SLUG = "garygentry/rauf";

/** Pinned Bun version for reproducible builds; mirrors the .bun-version file (tech-spec §3.9). */
export const PINNED_BUN_VERSION = "1.3.10";
```

## 3. Validation contracts

### 3.1 Semver regex (REQ-VER-04)

The single input gate, identical character-for-character to the removed `bump-version.sh` (tech-spec §3.1, §6.1). This regex — not `Bun.semver` — defines "valid version"; `compareVersions`/`Bun.semver.order` is only ever invoked on a string that already passed it, so the two notions cannot diverge.

```typescript
/** ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ — sole input gate (REQ-VER-04). */
export const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/;
```

A version is a **prerelease** iff it contains a `-` segment (REQ-BUILD-05); `isPrerelease()` (`02-shared-lib.md`) tests `v.includes("-")` after validation.

## 4. CHANGELOG grammar (REQ-NOTES-01)

`CHANGELOG.md` is human-curated data, not code, but the roll/extract functions depend on this exact grammar (tech-spec §4.2):

```
# Changelog                 ← H1, line 1
(blank)
## Unreleased               ← first H2; body = lines until the next "## " or EOF
(blank)
### <subsection> …          ← arbitrary H3 subsections inside Unreleased
…
## X.Y.Z                    ← versioned sections, newest first (none exist yet — greenfield)
```

- **Unreleased body**: everything between the `## Unreleased` heading and the next line beginning `## ` (or EOF), trimmed. The REQ-PREP-05 guard refuses an empty body.
- **Roll** (REQ-NOTES-01): rename the `## Unreleased` heading to `## X.Y.Z` and insert a fresh `## Unreleased\n\n` block between `# Changelog` and the new `## X.Y.Z`.
- **Versioned headings carry no date** (`## X.Y.Z`, not `## X.Y.Z - 2026-…`) — keeps parsing trivial and symmetric with `## Unreleased` (tech-spec §3.10).

## 5. Exit / error model (REQ-PREP-07, REQ-RELIABILITY-04)

The release scripts are standalone Bun programs, so they do **not** use the product's `Result<T,E>` / `ErrorCodes` (those live in `@rauf/core`, which the scripts must not import — tech-spec §6.2). Instead:

```typescript
/**
 * Print one actionable line to stderr and terminate the process nonzero.
 * Every guard failure in prepare.ts / preflight.ts funnels through this so
 * REQ-PREP-07 (no partial mutation, clear message) and REQ-RELIABILITY-04
 * (clearly surfaced failure) hold uniformly. Never throws — it exits.
 */
export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
```

Conventions:
- **Guard messages** start with `refusing: ` (prep) or `drift: ` (preflight) so the reason is greppable in logs. Example: `refusing: working tree is dirty — commit or stash first`.
- **Exit 0** only on full success. Any guard or mutation failure → nonzero.
- The pure logic in `lib.ts` **throws typed `Error`s**; the executable entry points (`prepare.ts`, `preflight.ts`) catch and route them through `fail()`. Pure functions never call `process.exit` (keeps them unit-testable — see `07-testing-strategy.md`).

## 6. Workflow output contract (tech-spec §3.5, §4.4)

`preflight.ts` emits two outputs to `$GITHUB_OUTPUT`, consumed by later workflow steps (`04-ci-preflight-and-workflow.md`):

| Output          | Type                  | Meaning                                                        |
| --------------- | --------------------- | ------------------------------------------------------------- |
| `version`       | string (no leading v) | The validated release version (tag minus `v`).                |
| `is_prerelease` | `"true"` \| `"false"` | Whether to publish `--prerelease` vs `--latest` (REQ-BUILD-05). |

## Dependencies

None — this is the foundation document. Everything else depends on it.

## Verification

- `pnpm typecheck` resolves every type/constant exported here from `scripts/release/lib.ts`.
- `RELEASE_TARGETS[*].asset` matches `install-binary.sh` `detect_asset()` output for the four Unix targets (`rauf-linux-x64`, `rauf-linux-arm64`, `rauf-darwin-x64`, `rauf-darwin-arm64`) plus the new `rauf-windows-x64.exe`.
- `PACKAGE_JSON_PATHS` lists exactly six files and includes `packages/docs/package.json`.
- `SEMVER_RE.source` is byte-identical to the regex in the (removed) `bump-version.sh`.
