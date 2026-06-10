/**
 * Shared release-tooling module (specs/release-automation/00-core-definitions.md
 * and 02-shared-lib.md).
 *
 * Runs under Bun. Standalone: MUST NOT import from @rauf/* or node:child_process
 * (REQ-PREP-06, C-4) — release tooling stays out of the shipped product.
 *
 * Pure functions throw typed Errors on malformed input (callers route them
 * through fail()). They never call process.exit. Filesystem reads are confined
 * to readVersionLocations.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The single Bun API surface this module touches (compareVersions). Declared
 * locally (module-scoped, shadows the bun-types global when present) so the
 * file typechecks in both the Bun runtime and the Node-based vitest runtime,
 * where the global is absent at runtime.
 */
declare const Bun: { semver: { order(a: string, b: string): number } } | undefined;

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
 * bump script (replaced by `pnpm release:prepare`) omitted it, which is why
 * docs drifted to 0.1.0 while everything else is 0.2.0 (REQ-VER-05). This set
 * corrects that.
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

// ── Version locations ──────────────────────────────────────────────────────

/**
 * Read the canonical version (version.ts, index 0) and all six package.json
 * versions, in the order of PACKAGE_JSON_PATHS. Throws if any expected file
 * is missing or unparseable — a malformed repo must not silently pass the
 * drift guard. `repoRoot` is an absolute path to the rauf repo root.
 */
export function readVersionLocations(repoRoot: string): VersionLocation[] {
  const out: VersionLocation[] = [];

  const versionTs = fs.readFileSync(path.join(repoRoot, VERSION_TS_PATH), "utf8");
  out.push({ file: VERSION_TS_PATH, version: parseVersionTs(versionTs), canonical: true });

  for (const rel of PACKAGE_JSON_PATHS) {
    const raw = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    let parsed: { version?: unknown };
    try {
      parsed = JSON.parse(raw) as { version?: unknown };
    } catch (e) {
      throw new Error(`${rel}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    if (typeof parsed.version !== "string") {
      throw new Error(`${rel}: missing or non-string "version" field`);
    }
    out.push({ file: rel, version: parsed.version, canonical: false });
  }
  return out;
}

/**
 * Extract the VERSION string from a version.ts file body. Matches
 * `export const VERSION = "X.Y.Z"`. Throws if not found (the canonical
 * source must always be present and well-formed).
 */
export function parseVersionTs(content: string): string {
  const m = content.match(/export const VERSION = "([^"]*)"/);
  if (!m) throw new Error(`${VERSION_TS_PATH}: could not find 'export const VERSION = "..."'`);
  return m[1]!;
}

/**
 * Return `content` with the VERSION constant replaced by `v`. Idempotent and
 * formatting-preserving (only the quoted value changes). Throws if no VERSION
 * line is present, so a silent no-op write is impossible.
 */
export function setVersionTs(content: string, v: string): string {
  if (!/export const VERSION = "[^"]*"/.test(content)) {
    throw new Error(`${VERSION_TS_PATH}: no VERSION constant to replace`);
  }
  return content.replace(/export const VERSION = "[^"]*"/, `export const VERSION = "${v}"`);
}

/**
 * Return a package.json `content` with `.version` set to `v`, preserving the
 * file's original indentation and trailing newline (mirrors the technique the
 * removed legacy bump script used via `node -e`). Throws on invalid JSON.
 */
export function setPackageJsonVersion(content: string, v: string): string {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`invalid package.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  pkg.version = v;
  // Preserve original indentation; default to two spaces.
  const indentMatch = content.match(/^([ \t]+)"/m);
  const indent = indentMatch ? indentMatch[1]! : "  ";
  const trailingNewline = content.endsWith("\n") ? "\n" : "";
  return JSON.stringify(pkg, null, indent) + trailingNewline;
}

// ── Semver ─────────────────────────────────────────────────────────────────

/** True iff `v` matches SEMVER_RE — the sole input gate (00-core-definitions.md §3.1). */
export function isValidVersion(v: string): boolean {
  return SEMVER_RE.test(v);
}

/**
 * -1 if a < b, 0 if equal, 1 if a > b. Wraps Bun.semver.order (Bun ≥ 1.1).
 * PRECONDITION: both inputs already passed isValidVersion — this is only ever
 * called on validated strings, so Bun.semver's broader grammar is never reached
 * (keeps the regex and the comparator consistent by construction, tech-spec §3.1).
 *
 * The vitest suite runs under Node (no Bun global), so a fallback comparator
 * implementing semver §11 ordering for the SEMVER_RE-validated subset covers
 * that runtime; prepare.ts / preflight.ts always run under Bun.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  if (typeof Bun !== "undefined" && typeof Bun.semver !== "undefined") {
    return Bun.semver.order(a, b) as -1 | 0 | 1;
  }
  return orderValidated(a, b);
}

function cmp(x: number, y: number): -1 | 0 | 1 {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** semver §11 ordering, valid only for SEMVER_RE-validated inputs. */
function orderValidated(a: string, b: string): -1 | 0 | 1 {
  const dashA = a.indexOf("-");
  const dashB = b.indexOf("-");
  const coreA = (dashA === -1 ? a : a.slice(0, dashA)).split(".").map(Number);
  const coreB = (dashB === -1 ? b : b.slice(0, dashB)).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const c = cmp(coreA[i]!, coreB[i]!);
    if (c !== 0) return c;
  }

  const preA = dashA === -1 ? null : a.slice(dashA + 1);
  const preB = dashB === -1 ? null : b.slice(dashB + 1);
  if (preA === null && preB === null) return 0;
  if (preA === null) return 1; // release > prerelease
  if (preB === null) return -1;

  const idsA = preA.split(".");
  const idsB = preB.split(".");
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
    const ia = idsA[i];
    const ib = idsB[i];
    if (ia === undefined) return -1; // fewer identifiers → lower
    if (ib === undefined) return 1;
    const numA = /^[0-9]+$/.test(ia);
    const numB = /^[0-9]+$/.test(ib);
    if (numA && numB) {
      const c = cmp(Number(ia), Number(ib));
      if (c !== 0) return c;
    } else if (numA) {
      return -1; // numeric identifiers < alphanumeric
    } else if (numB) {
      return 1;
    } else if (ia !== ib) {
      return ia < ib ? -1 : 1;
    }
  }
  return 0;
}

/**
 * True iff the version carries a prerelease suffix (e.g. "0.3.0-rc.1").
 * PRECONDITION: validated by isValidVersion, so a "-" can only be the
 * prerelease separator (build-metadata "+" is rejected by SEMVER_RE).
 */
export function isPrerelease(v: string): boolean {
  return v.includes("-");
}

// ── Changelog ──────────────────────────────────────────────────────────────
// These operate on the grammar fixed in 00-core-definitions.md §4. The "## "
// section delimiter is an H2 heading at line start.

/**
 * Return the trimmed body of the `## Unreleased` section: every line after the
 * `## Unreleased` heading up to (but excluding) the next line starting "## "
 * or EOF. Returns "" if the section is absent or empty. The REQ-PREP-05 guard
 * refuses to proceed when this is "".
 */
export function getUnreleasedBody(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * Move the `## Unreleased` body into a new `## X.Y.Z` section directly under a
 * fresh empty `## Unreleased`, and return both the updated file content and the
 * rolled section body (for the dry-run preview / sanity checks).
 *
 * Throws if there is no `## Unreleased` section, or if its body is empty
 * (callers SHOULD have already run the REQ-PREP-05 guard, but rolling an empty
 * section is a hard error regardless).
 *
 * Greenfield (no prior `## X.Y.Z` sections) and with-existing-sections inputs
 * both produce: `# Changelog` → empty `## Unreleased` → `## X.Y.Z` (new) →
 * any prior versioned sections, newest first. The before/after slices are
 * preserved verbatim so unrelated whitespace and prior sections are untouched.
 */
export function rollChangelog(
  content: string,
  v: string,
): { updated: string; sectionBody: string } {
  const body = getUnreleasedBody(content);
  if (body === "") throw new Error("cannot roll changelog: `## Unreleased` section is empty");

  const lines = content.split("\n");
  const uIdx = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  // End of the Unreleased section (next "## " or EOF).
  let uEnd = lines.length;
  for (let i = uIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) {
      uEnd = i;
      break;
    }
  }

  const before = lines.slice(0, uIdx); // up to & incl. "# Changelog" + blank
  const sectionLines = lines.slice(uIdx + 1, uEnd); // the Unreleased body (raw, untrimmed)
  const after = lines.slice(uEnd); // prior versioned sections (may be empty)

  const rebuilt = [...before, "## Unreleased", "", `## ${v}`, ...sectionLines, ...after].join("\n");

  return { updated: rebuilt, sectionBody: body };
}

/**
 * Return the verbatim body of the `## X.Y.Z` section (lines between that
 * heading and the next "## " or EOF), trimmed of leading/trailing blank lines.
 * Used by the workflow notes step to build NOTES.md. Throws if the section is
 * absent — the release notes MUST come from a real changelog section
 * (REQ-NOTES-02), never silently empty. The Full Changelog compare link
 * (REQ-NOTES-03) is appended by the workflow notes step, not here.
 */
export function extractSection(content: string, v: string): string {
  const lines = content.split("\n");
  const headingRe = new RegExp(`^## ${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) throw new Error(`changelog has no "## ${v}" section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}
