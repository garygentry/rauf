/**
 * Shared test fixtures/factories for the scripts/release suites
 * (specs/release-automation/07-testing-strategy.md §2.4).
 *
 * Consumed by lib.test.ts and preflight.test.ts — tests build changelog
 * strings and version-location repos through these factories rather than
 * hand-rolling them.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PACKAGE_JSON_PATHS, VERSION_TS_PATH } from "./lib";

export interface PriorSection {
  /** Bare version for the `## X.Y.Z` heading (no leading "v"). */
  version: string;
  /** Verbatim section body (no surrounding blank lines). */
  body: string;
}

/**
 * Build a CHANGELOG.md string per the grammar in 00-core-definitions.md §4:
 * `# Changelog` → `## Unreleased` (with the given body, possibly empty) →
 * any prior `## X.Y.Z` sections, newest first. Every section is followed by
 * a blank line; the file ends with a trailing newline.
 */
export function makeChangelog(opts: {
  unreleased: string;
  priorSections?: PriorSection[];
}): string {
  const parts: string[] = ["# Changelog", "", "## Unreleased", ""];
  if (opts.unreleased !== "") {
    parts.push(opts.unreleased, "");
  }
  for (const s of opts.priorSections ?? []) {
    parts.push(`## ${s.version}`, "", s.body, "");
  }
  return parts.join("\n");
}

const createdFixtures: string[] = [];

/**
 * Write a temp-dir repo fixture containing version.ts plus the seven
 * package.json files and return its absolute path. `versions` is either a
 * single version applied to all eight locations, or a map keyed by location
 * file path (VERSION_TS_PATH or a PACKAGE_JSON_PATHS entry) with "*" as the
 * default for unspecified files — divergent maps drive the drift tests.
 *
 * Created dirs are tracked; call cleanupRepoFixtures() in afterEach.
 */
export function makeRepoFixture(versions: string | Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-release-fixture-"));
  createdFixtures.push(dir);

  const versionFor = (file: string): string => {
    if (typeof versions === "string") return versions;
    const v = versions[file] ?? versions["*"];
    if (v === undefined) {
      throw new Error(`makeRepoFixture: no version for ${file} (add a "*" default)`);
    }
    return v;
  };

  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  write(VERSION_TS_PATH, `export const VERSION = "${versionFor(VERSION_TS_PATH)}";\n`);
  for (const rel of PACKAGE_JSON_PATHS) {
    const name = rel === "package.json" ? "rauf" : `@rauf/${path.basename(path.dirname(rel))}`;
    write(rel, JSON.stringify({ name, version: versionFor(rel) }, null, 2) + "\n");
  }
  return dir;
}

/** Remove every fixture dir created by makeRepoFixture (call from afterEach). */
export function cleanupRepoFixtures(): void {
  for (const dir of createdFixtures.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
