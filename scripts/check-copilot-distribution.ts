#!/usr/bin/env bun
/**
 * Verify the Copilot surfaces intended for each rauf distribution boundary (#131, RAUF-204).
 *
 * - Repository: the generated `adapters/copilot/` Agent Plugins bundle (plugin + four skills + two
 *   agents), version-locked to `packages/core/src/version.ts`.
 * - Built packages (what the compiled release binary bundles): the dedicated `copilot` provider and
 *   the embedded installed-child instruction templates.
 * - npm launcher (`npm-dist/`): stays a launcher + the Pi package surface. The Copilot plugin is a
 *   repository/plugin distribution and must not leak into the tarball; the launcher resolves the
 *   same-version GitHub release binary, which is where the Copilot runtime provider lives.
 * - Optional `--binary <path>`: runtime-smoke a locally compiled binary (version + provider list).
 *
 * Wired into `pnpm gate` as `copilot:package:check`, after `pnpm build`.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { VERSION } from "../packages/core/src/version.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export const COPILOT_REPOSITORY_ARTIFACTS = [
  "adapters/copilot/plugin.json",
  "adapters/copilot/agents/rauf-backlog-reviewer.agent.md",
  "adapters/copilot/agents/rauf-loop-driver.agent.md",
  "adapters/copilot/skills/author-backlog/SKILL.md",
  "adapters/copilot/skills/drive-rauf-loop/SKILL.md",
  "adapters/copilot/skills/review-backlog/SKILL.md",
  "adapters/copilot/skills/review-rauf-guidance/SKILL.md",
];

/** Exact `files` allowlist of the npm launcher (plus the always-included package.json). */
export const NPM_LAUNCHER_FILES = [
  "LICENSE",
  "README.md",
  "adapters/pi/extensions",
  "adapters/pi/skills",
  "package.json",
  "rauf.mjs",
];

/** Exact top-level entries of `npm-dist/` (directories suffixed with `/`). */
const NPM_LAUNCHER_ENTRIES = ["LICENSE", "README.md", "adapters/", "package.json", "rauf.mjs"];

function fail(message: string): never {
  throw new Error(`Copilot distribution check failed: ${message}`);
}

function readJson(root: string, relativePath: string): Record<string, unknown> {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) fail(`missing ${relativePath}`);
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${(error as Error).message}`);
  }
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

/** Check repository, built-package, and npm-launcher distribution contracts. */
export function checkCopilotDistribution(
  root: string = REPO_ROOT,
  version: string = VERSION,
): void {
  const plugin = readJson(root, "adapters/copilot/plugin.json");
  if (plugin["version"] !== version) {
    fail(`adapters/copilot/plugin.json version ${String(plugin["version"])} != ${version}`);
  }
  for (const relative of COPILOT_REPOSITORY_ARTIFACTS) {
    if (!fs.existsSync(path.join(root, relative))) fail(`repository artifact missing: ${relative}`);
  }

  // `pnpm gate` runs build first. These files prove the release binary's static entry graph carries
  // both the dedicated provider and the installed child-instruction templates.
  const builtProvider = path.join(root, "packages/loop/dist/providers/copilot-cli.js");
  const builtArtifacts = path.join(root, "packages/core/dist/embedded-artifacts.js");
  if (!fs.existsSync(builtProvider)) fail("built Copilot provider is missing (run pnpm build)");
  if (!fs.readFileSync(builtProvider, "utf-8").includes('const COPILOT_AGENT_ID = "copilot"')) {
    fail("built loop package does not contain the dedicated Copilot provider");
  }
  if (!fs.existsSync(builtArtifacts)) fail("built embedded artifacts are missing (run pnpm build)");
  const embedded = fs.readFileSync(builtArtifacts, "utf-8");
  for (const marker of ["AGENTS_ADDON.md", ".rauf/RAUF.md.tmpl", "rauf:managed:start"]) {
    if (!embedded.includes(marker))
      fail(`built core package is missing embedded marker: ${marker}`);
  }

  // The npm artifact is the thin launcher plus the Pi package surface — never the Copilot plugin.
  const npmPackage = readJson(root, "npm-dist/package.json");
  if (npmPackage["version"] !== version) fail("npm launcher version is not lockstep");
  const declared = npmPackage["files"];
  if (!Array.isArray(declared)) fail("npm launcher has no files allowlist");
  const allowlisted = [...declared.map(String), "package.json"];
  if (!sameList(allowlisted, NPM_LAUNCHER_FILES)) {
    fail(`npm files allowlist changed: ${[...allowlisted].sort().join(", ")}`);
  }
  const entries = fs
    .readdirSync(path.join(root, "npm-dist"), { withFileTypes: true })
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  if (!sameList(entries, NPM_LAUNCHER_ENTRIES)) {
    fail(`npm-dist contents changed: ${[...entries].sort().join(", ")}`);
  }
  const adapters = fs.readdirSync(path.join(root, "npm-dist/adapters"));
  if (!sameList(adapters, ["pi"])) {
    fail(`npm-dist/adapters must contain only pi, found: ${[...adapters].sort().join(", ")}`);
  }
  const launcher = fs.readFileSync(path.join(root, "npm-dist/rauf.mjs"), "utf-8");
  if (
    !launcher.includes('readFileSync(join(HERE, "package.json")') ||
    !launcher.includes("/releases/download/v${version}")
  ) {
    fail("npm launcher no longer resolves the same-version GitHub release binary");
  }
}

/** Runtime-check a locally compiled release-shaped binary when supplied by package preflight. */
export function checkCompiledBinary(binaryPath: string, version: string = VERSION): void {
  const absolute = path.resolve(binaryPath);
  const versionRun = spawnSync(absolute, ["version", "--json"], { encoding: "utf-8" });
  let reported: unknown;
  try {
    reported = (JSON.parse(versionRun.stdout) as { version?: unknown }).version;
  } catch {
    reported = undefined;
  }
  if (versionRun.status !== 0 || reported !== version) {
    fail(`compiled binary version smoke failed: ${absolute} reported ${String(reported)}`);
  }
  const agents = spawnSync(absolute, ["agents", "--json"], { encoding: "utf-8" });
  if (agents.status !== 0) fail(`compiled binary agents smoke failed: ${absolute}`);
  let parsed: { agents?: Array<{ id?: string }> };
  try {
    parsed = JSON.parse(agents.stdout) as { agents?: Array<{ id?: string }> };
  } catch {
    fail(`compiled binary agents --json output is not JSON: ${absolute}`);
  }
  if (!parsed.agents?.some((agent) => agent.id === "copilot")) {
    fail("compiled binary does not enumerate the dedicated Copilot provider");
  }
}

if (import.meta.main) {
  try {
    checkCopilotDistribution();
    const binaryFlag = process.argv.indexOf("--binary");
    if (binaryFlag !== -1) {
      const binary = process.argv[binaryFlag + 1];
      if (!binary) fail("--binary requires a path");
      checkCompiledBinary(binary);
    }
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    process.exit(1);
  }
  console.log("Copilot distribution surfaces are complete and version-locked.");
}
