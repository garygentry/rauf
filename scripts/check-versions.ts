#!/usr/bin/env bun
/**
 * Version-sync guard (REM-3): assert every workspace package.json `version`
 * matches the authoritative `VERSION` in packages/core/src/version.ts.
 *
 * Wired into `pnpm gate` (and thus CI). The two version cutovers (v0.5.0, v0.6.0)
 * both shipped with package.json versions lagging version.ts; this prevents recurrence.
 *
 * Exit 0 when all in sync; exit 1 with a clear report otherwise.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Authoritative source: packages/core/src/version.ts → `export const VERSION = "x.y.z"`.
const versionTsPath = join(repoRoot, "packages/core/src/version.ts");
const versionTs = readFileSync(versionTsPath, "utf8");
const match = versionTs.match(/export\s+const\s+VERSION\s*=\s*["']([^"']+)["']/);
if (!match) {
  console.error(`✗ Could not parse VERSION from ${versionTsPath}`);
  process.exit(1);
}
const expected = match[1];

// Every workspace package.json + the root manifest + the npm launcher must agree.
const manifests = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/loop/package.json",
  "packages/web/package.json",
  "packages/docs/package.json",
  "npm-dist/package.json",
];

const mismatches: string[] = [];
for (const rel of manifests) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, rel), "utf8")) as { version?: string };
  if (pkg.version !== expected) {
    mismatches.push(`  ${rel}: ${pkg.version ?? "(none)"} (expected ${expected})`);
  }
}

if (mismatches.length > 0) {
  console.error(
    `✗ Version mismatch — version.ts is ${expected}, but these disagree:\n${mismatches.join("\n")}\n` +
      `  Fix: set each package.json "version" to ${expected} (or update version.ts).`,
  );
  process.exit(1);
}

console.log(
  `Versions in sync: all manifests are ${expected} (matches packages/core/src/version.ts).`,
);
