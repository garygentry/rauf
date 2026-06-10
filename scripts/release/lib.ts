/**
 * Shared release-tooling module (specs/release-automation/00-core-definitions.md).
 *
 * Runs under Bun. Standalone: MUST NOT import from @rauf/* or node:child_process
 * (REQ-PREP-06, C-4) — release tooling stays out of the shipped product.
 */

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Constants ──────────────────────────────────────────────────────────────

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

/** Checksums file attached to every release (REQ-INTEGRITY-01). */
export const CHECKSUMS_FILE = "SHA256SUMS";

/** owner/repo, confirmed in root package.json repository.url and install-binary.sh RAUF_REPO. */
export const REPO_SLUG = "garygentry/rauf";

/** Pinned Bun version for reproducible builds; mirrors the .bun-version file (tech-spec §3.9). */
export const PINNED_BUN_VERSION = "1.3.10";

/** ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ — sole input gate (REQ-VER-04). */
export const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/;

// ── Exit / error model ─────────────────────────────────────────────────────

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
