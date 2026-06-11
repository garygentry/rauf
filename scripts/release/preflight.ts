/**
 * CI drift guard + prerelease classifier
 * (specs/release-automation/04-ci-preflight-and-workflow.md §1-2).
 *
 * Invoked by release.yml step 5 via `bun run scripts/release/preflight.ts`.
 * Machine-side enforcement of REQ-TRIGGER-02: the tag, the canonical
 * version.ts, and all six package.json versions must agree — a single
 * mismatch exits nonzero BEFORE any build or publish step. Every failure
 * message carries the greppable `drift: ` prefix.
 *
 * This file is an executable: nothing imports it except preflight.test.ts,
 * which imports only the pure detectDrift below. The env/filesystem-touching
 * flow runs only under `bun run` (import.meta.main), never on import.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  fail,
  isPrerelease,
  isValidVersion,
  readVersionLocations,
  type VersionLocation,
} from "./lib";

/**
 * Bun's import.meta extensions, typed locally (same pattern as prepare.ts)
 * so the file typechecks in both the Bun and Node-based vitest type
 * environments. `main` is true only under `bun run preflight.ts` and
 * undefined when vitest imports detectDrift; `dir` is only read inside main().
 */
const meta = import.meta as ImportMeta & { dir: string; main: boolean };

// ── Pure drift detection (REQ-TRIGGER-02) ───────────────────────────────────

/**
 * Check tag ↔ version.ts ↔ every package.json agreement. Returns the
 * `drift: `-prefixed failure message naming the offending location, or null
 * when all locations agree with the tag. Pure — factored out of main() so
 * preflight.test.ts exercises it without the Actions env
 * (07-testing-strategy.md §2.3).
 */
export function detectDrift(tagVersion: string, locations: VersionLocation[]): string | null {
  const canonical = locations.find((l) => l.canonical)!.version;

  // tag ↔ version.ts
  if (tagVersion !== canonical) {
    return `drift: tag v${tagVersion} (=${tagVersion}) != version.ts VERSION (${canonical})`;
  }
  // version.ts ↔ every package.json
  for (const loc of locations) {
    if (!loc.canonical && loc.version !== canonical) {
      return `drift: ${loc.file} version ${loc.version} != canonical ${canonical}`;
    }
  }
  return null;
}

// ── Main (Actions-only flow) ────────────────────────────────────────────────

function main(): void {
  // Tag comes from the push trigger (GITHUB_REF_NAME = "v0.3.0") or the
  // workflow_dispatch `tag` input forwarded as INPUT_TAG.
  const ref = process.env.GITHUB_REF_NAME ?? process.env.INPUT_TAG ?? "";
  if (!ref.startsWith("v")) fail(`drift: expected a v* tag, got "${ref}"`);
  const tagVersion = ref.slice(1);
  if (!isValidVersion(tagVersion)) fail(`drift: tag ${ref} is not a valid version`);

  const repoRoot = path.resolve(meta.dir, "../..");
  const locations = readVersionLocations(repoRoot);

  const drift = detectDrift(tagVersion, locations);
  if (drift !== null) fail(drift);

  const isPre = isPrerelease(tagVersion);
  const outFile = process.env.GITHUB_OUTPUT;
  if (!outFile) fail("drift: GITHUB_OUTPUT not set (must run inside Actions)");
  fs.appendFileSync(outFile, `version=${tagVersion}\n`);
  fs.appendFileSync(outFile, `is_prerelease=${isPre}\n`);
  console.log(`preflight OK: ${ref} (${isPre ? "prerelease" : "stable"})`);
}

if (meta.main) main();
