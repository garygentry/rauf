#!/usr/bin/env bun
/** Verify the Copilot surfaces intended for each rauf distribution boundary. */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { VERSION } from "../packages/core/src/version.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function fail(message: string): never {
  throw new Error(`Copilot distribution check failed: ${message}`);
}

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")) as Record<
    string,
    unknown
  >;
}

/** Check repository, built-package, and npm-launcher distribution contracts. */
export function checkCopilotDistribution(): void {
  const plugin = readJson("adapters/copilot/plugin.json");
  if (plugin["version"] !== VERSION) {
    fail(`adapters/copilot/plugin.json version ${String(plugin["version"])} != ${VERSION}`);
  }
  for (const relative of [
    "adapters/copilot/plugin.json",
    "adapters/copilot/agents/rauf-backlog-reviewer.agent.md",
    "adapters/copilot/agents/rauf-loop-driver.agent.md",
    "adapters/copilot/skills/author-backlog/SKILL.md",
    "adapters/copilot/skills/drive-rauf-loop/SKILL.md",
    "adapters/copilot/skills/review-backlog/SKILL.md",
    "adapters/copilot/skills/review-rauf-guidance/SKILL.md",
  ]) {
    if (!fs.existsSync(path.join(REPO_ROOT, relative)))
      fail(`repository artifact missing: ${relative}`);
  }

  // `pnpm gate` runs build first. These files prove the release binary's static entry graph carries
  // both the dedicated provider and the installed child-instruction templates.
  const builtProvider = path.join(REPO_ROOT, "packages/loop/dist/providers/copilot-cli.js");
  const builtArtifacts = path.join(REPO_ROOT, "packages/core/dist/embedded-artifacts.js");
  if (!fs.existsSync(builtProvider)) fail("built Copilot provider is missing");
  if (!fs.readFileSync(builtProvider, "utf-8").includes('const COPILOT_AGENT_ID = "copilot"')) {
    fail("built loop package does not contain the dedicated Copilot provider");
  }
  const embedded = fs.readFileSync(builtArtifacts, "utf-8");
  for (const marker of ["AGENTS_ADDON.md", ".rauf/RAUF.md.tmpl", "rauf:managed:start"]) {
    if (!embedded.includes(marker))
      fail(`built core package is missing embedded marker: ${marker}`);
  }

  // The published npm artifact is intentionally a thin launcher, not an operator-plugin tarball.
  // Its allowlist and actual directory must stay exact; it resolves the same-version release binary,
  // which is where the provider runtime lives.
  const npmPackage = readJson("npm-dist/package.json");
  if (npmPackage["version"] !== VERSION) fail("npm launcher version is not lockstep");
  const declared = npmPackage["files"];
  if (!Array.isArray(declared)) fail("npm launcher has no files allowlist");
  const expectedNpmFiles = ["LICENSE", "README.md", "package.json", "rauf.mjs"];
  const actualNpmFiles = fs
    .readdirSync(path.join(REPO_ROOT, "npm-dist"), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualNpmFiles) !== JSON.stringify(expectedNpmFiles)) {
    fail(`npm-dist contents changed: ${actualNpmFiles.join(", ")}`);
  }
  const allowlisted = [...declared.map(String), "package.json"].sort();
  if (JSON.stringify(allowlisted) !== JSON.stringify(expectedNpmFiles)) {
    fail(`npm files allowlist changed: ${allowlisted.join(", ")}`);
  }
  const launcher = fs.readFileSync(path.join(REPO_ROOT, "npm-dist/rauf.mjs"), "utf-8");
  if (
    !launcher.includes('readFileSync(join(HERE, "package.json")') ||
    !launcher.includes("/releases/download/v${version}")
  ) {
    fail("npm launcher no longer resolves the same-version GitHub release binary");
  }
}

/** Runtime-check a locally compiled release-shaped binary when supplied by package preflight. */
export function checkCompiledBinary(binaryPath: string): void {
  const absolute = path.resolve(binaryPath);
  const version = spawnSync(absolute, ["version", "--json"], { encoding: "utf-8" });
  if (version.status !== 0 || !version.stdout.includes(`"version": "${VERSION}"`)) {
    fail(`compiled binary version smoke failed: ${absolute}`);
  }
  const agents = spawnSync(absolute, ["agents", "--json"], { encoding: "utf-8" });
  if (agents.status !== 0) fail(`compiled binary agents smoke failed: ${absolute}`);
  const parsed = JSON.parse(agents.stdout) as { agents?: Array<{ id?: string }> };
  if (!parsed.agents?.some((agent) => agent.id === "copilot")) {
    fail("compiled binary does not enumerate the dedicated Copilot provider");
  }
}

if (import.meta.main) {
  checkCopilotDistribution();
  const binaryFlag = process.argv.indexOf("--binary");
  if (binaryFlag !== -1) {
    const binary = process.argv[binaryFlag + 1];
    if (!binary) fail("--binary requires a path");
    checkCompiledBinary(binary);
  }
  console.log("Copilot distribution surfaces are complete and version-locked.");
}
