#!/usr/bin/env bun
/**
 * build-npm-dist-pi-skills.ts
 *
 * Copies the generated Pi skill bundle (`adapters/pi/skills/`) into the published
 * npm launcher package (`npm-dist/adapters/pi/skills/`) so `pi install
 * npm:@garygentry/rauf` can load rauf's Pi skills without a local source checkout
 * (GH #89). Previously `npm-dist/package.json` had neither the skill files nor a
 * `pi` manifest key, so Pi had nothing to discover after installing the package.
 *
 * `adapters/pi/skills/` is itself generated + committed by
 * `scripts/build-pi-bundle.ts` (its skill-relative repo references are already
 * rewritten to skill-local `references/*` files, so each skill is self-contained),
 * so this script does a verbatim recursive copy — no rewriting needed here.
 *
 * `npm-dist/package.json` declares `files: [..., "adapters/pi/skills"]` and a
 * top-level `pi.skills: ["./adapters/pi/skills"]` manifest key so Pi can find the
 * copied skills once the package is installed.
 *
 * The copy is committed (like `adapters/pi/` and `.codex-plugin/` are), not
 * generated at publish time, because the publish job in
 * `.github/workflows/release.yml` runs `npm publish` directly against the
 * checked-out `npm-dist/` with no build step. `--check` is the
 * drift guard, wired into `pnpm gate` the same way `pi:check`/`codex:check` are.
 *
 * Usage:
 *   bun run scripts/build-npm-dist-pi-skills.ts          # write npm-dist/adapters/pi/skills
 *   bun run scripts/build-npm-dist-pi-skills.ts --check  # drift guard (gate)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_DIR = path.join(REPO_ROOT, "adapters", "pi", "skills");
const DEST_DIR = path.join(REPO_ROOT, "npm-dist", "adapters", "pi", "skills");
/** The generated Pi extensions (rauf-loop-supervisor, #154) ship the same way. */
const EXT_SOURCE_DIR = path.join(REPO_ROOT, "adapters", "pi", "extensions");
const EXT_DEST_DIR = path.join(REPO_ROOT, "npm-dist", "adapters", "pi", "extensions");

/** Recursively read every file under `dir` as a relative-path → content map. */
function readTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  function visit(sub: string): void {
    for (const e of fs
      .readdirSync(sub, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(sub, e.name);
      if (e.isDirectory()) visit(abs);
      else if (e.isFile()) files.set(path.relative(dir, abs), fs.readFileSync(abs, "utf-8"));
    }
  }
  visit(dir);
  return files;
}

/** Build the expected copy as a relative-path → content map, from canonical `adapters/pi/skills/`. */
export function buildBundle(): Map<string, string> {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(
      `${path.relative(REPO_ROOT, SOURCE_DIR)} does not exist — run ` +
        `\`bun run scripts/build-pi-bundle.ts\` first.`,
    );
  }
  const bundle = readTree(SOURCE_DIR);
  if (bundle.size === 0) {
    throw new Error(`No files found under ${path.relative(REPO_ROOT, SOURCE_DIR)}.`);
  }
  return bundle;
}

/** Build the expected extensions copy, from generated `adapters/pi/extensions/`. */
export function buildExtensionsBundle(): Map<string, string> {
  if (!fs.existsSync(EXT_SOURCE_DIR)) {
    throw new Error(
      `${path.relative(REPO_ROOT, EXT_SOURCE_DIR)} does not exist — run ` +
        `\`bun run scripts/build-pi-bundle.ts\` first.`,
    );
  }
  return readTree(EXT_SOURCE_DIR);
}

/** Recursively list committed files under `dir` as paths relative to `dir`. */
function listCommitted(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listCommitted(abs, base));
    else if (e.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

function main(): void {
  const check = process.argv.includes("--check");
  const trees = [
    { bundle: buildBundle(), dest: DEST_DIR, label: "skills" },
    { bundle: buildExtensionsBundle(), dest: EXT_DEST_DIR, label: "extensions" },
  ];

  if (check) {
    const drift: string[] = [];
    for (const { bundle, dest, label } of trees) {
      for (const [rel, content] of bundle) {
        const abs = path.join(dest, rel);
        const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
        if (current !== content) drift.push(`${label}/${rel}`);
      }
      for (const rel of listCommitted(dest)) {
        if (!bundle.has(rel)) drift.push(`${label}/${rel} (stale — not produced by generator)`);
      }
    }
    if (drift.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `npm-dist Pi copy drift detected — these differ from adapters/pi/:\n` +
          drift.map((d) => `  - npm-dist/adapters/pi/${d}`).join("\n") +
          `\n\nRun: bun run scripts/build-npm-dist-pi-skills.ts  (then commit the result)`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(
      `npm-dist/adapters/pi is in sync with adapters/pi (${trees
        .map((t) => `${t.bundle.size} ${t.label} files`)
        .join(", ")}).`,
    );
    process.exit(0);
  }

  // Write mode: rebuild from scratch so a file removed upstream is pruned here too.
  for (const { bundle, dest } of trees) {
    fs.rmSync(dest, { recursive: true, force: true });
    for (const [rel, content] of bundle) {
      const abs = path.join(dest, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `Copied adapters/pi/{skills,extensions} into npm-dist/adapters/pi (${trees
      .map((t) => `${t.bundle.size} ${t.label} files`)
      .join(", ")}).`,
  );
}

if (import.meta.main) main();
