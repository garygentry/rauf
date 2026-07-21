#!/usr/bin/env bun
/**
 * Generates the Pi package bundle (`adapters/pi/`) from canonical rauf skills.
 *
 * Pi loads skills from package manifests (`package.json#pi.skills`) and expects
 * skill-relative references to resolve from each copied skill directory. rauf's
 * canonical skills intentionally reference repo-level docs/source files, so this
 * generator rewrites those repo-relative references to skill-local `references/*`
 * files and copies the referenced material into each generated skill.
 *
 * Usage:
 *   bun run scripts/build-pi-bundle.ts          # write adapters/pi
 *   bun run scripts/build-pi-bundle.ts --check  # drift guard
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const PI_ADAPTER_DIR = path.join(REPO_ROOT, "adapters", "pi");

const SUPPORTED_FRONTMATTER_KEYS = new Set(["name", "description"]);
const REPO_REFERENCE_RE =
  /(?<![A-Za-z0-9_./-])((?:docs\/(?:SPEC-BACKLOG-TOOL-CONTRACT|SPEC-CLI|SPEC-CORE)\.md)|(?:packages\/core\/src\/state-labels\.ts))(?![A-Za-z0-9_./-])/g;

interface SkillSource {
  id: string;
  skillMd: string;
  files: Map<string, string>;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
}

function frontmatterKeys(skillMd: string, source: string): string[] {
  const m = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m || m[1] === undefined) {
    throw new Error(`${source}: missing YAML frontmatter (expected leading --- block)`);
  }
  const keys: string[] = [];
  for (const line of m[1].split("\n")) {
    const km = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
    if (km && km[1] !== undefined) keys.push(km[1]);
  }
  return keys;
}

function validateSkillFrontmatter(skillMd: string, source: string): void {
  const keys = frontmatterKeys(skillMd, source);
  if (!keys.includes("name")) throw new Error(`${source}: frontmatter missing required 'name'`);
  if (!keys.includes("description")) {
    throw new Error(`${source}: frontmatter missing required 'description'`);
  }
  const unsupported = keys.filter((k) => !SUPPORTED_FRONTMATTER_KEYS.has(k));
  if (unsupported.length > 0) {
    throw new Error(
      `${source}: frontmatter has non-Pi key(s) [${unsupported.join(", ")}]. ` +
        `Teach scripts/build-pi-bundle.ts to map or drop them before publishing the Pi bundle.`,
    );
  }
}

function piReferencePath(repoRel: string): string {
  const parsed = path.parse(repoRel);
  return path.posix.join("references", parsed.base);
}

function rewriteSkillReferences(text: string, extraReferences: Set<string>): string {
  return text.replace(REPO_REFERENCE_RE, (_match, repoRel: string) => {
    const abs = path.join(REPO_ROOT, repoRel);
    if (!fs.existsSync(abs)) throw new Error(`Referenced source does not exist: ${repoRel}`);
    extraReferences.add(repoRel);
    return piReferencePath(repoRel);
  });
}

function rewriteCopiedReferenceContent(text: string, extraReferences: Set<string>): string {
  return text.replace(REPO_REFERENCE_RE, (_match, repoRel: string) => {
    const abs = path.join(REPO_ROOT, repoRel);
    if (!fs.existsSync(abs)) return repoRel;
    extraReferences.add(repoRel);
    return path.basename(repoRel);
  });
}

function expandRepoReferences(extraReferences: Set<string>): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (const repoRel of [...extraReferences]) {
      const text = fs.readFileSync(path.join(REPO_ROOT, repoRel), "utf-8");
      for (const match of text.matchAll(REPO_REFERENCE_RE)) {
        const nested = match[1];
        if (
          nested !== undefined &&
          fs.existsSync(path.join(REPO_ROOT, nested)) &&
          !extraReferences.has(nested)
        ) {
          extraReferences.add(nested);
          changed = true;
        }
      }
    }
  }
}

function readSkillFiles(id: string): Map<string, string> {
  const skillDir = path.join(SKILLS_DIR, id);
  const files = new Map<string, string>();
  function visit(dir: string): void {
    for (const e of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) visit(abs);
      else if (e.isFile()) files.set(path.relative(skillDir, abs), fs.readFileSync(abs, "utf-8"));
    }
  }
  visit(skillDir);
  return files;
}

function readSkills(): SkillSource[] {
  const entries = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const skills: SkillSource[] = [];
  for (const id of entries) {
    const skillMdPath = path.join(SKILLS_DIR, id, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;
    const source = `skills/${id}/SKILL.md`;
    const skillMd = fs.readFileSync(skillMdPath, "utf-8");
    validateSkillFrontmatter(skillMd, source);
    skills.push({ id, skillMd, files: readSkillFiles(id) });
  }
  if (skills.length === 0) throw new Error("No skills found under skills/.");
  return skills;
}

export function buildBundle(): Map<string, string> {
  const pkg = readJson(path.join(REPO_ROOT, "package.json"));
  const skills = readSkills();
  const files = new Map<string, string>();

  const adapterManifest = {
    name: "rauf-pi-adapter",
    private: true,
    version: String(pkg.version ?? "0.0.0"),
    description: "Generated Pi skill bundle for rauf autonomous coding loops",
    keywords: ["pi-package", "rauf", "agent-skills"],
    pi: {
      skills: ["./skills"],
    },
  };
  files.set("package.json", JSON.stringify(adapterManifest, null, 2) + "\n");

  const reportRows: string[] = [];
  for (const skill of skills) {
    const extraReferences = new Set<string>();
    for (const [rel, content] of skill.files) {
      const rewritten = rewriteSkillReferences(content, extraReferences);
      files.set(path.join("skills", skill.id, rel), rewritten);
    }
    expandRepoReferences(extraReferences);
    for (const repoRel of [...extraReferences].sort()) {
      files.set(
        path.join("skills", skill.id, piReferencePath(repoRel)),
        rewriteCopiedReferenceContent(
          fs.readFileSync(path.join(REPO_ROOT, repoRel), "utf-8"),
          extraReferences,
        ),
      );
    }
    reportRows.push(
      `| \`${skill.id}\` | ${skill.files.size} | ${
        extraReferences.size > 0
          ? [...extraReferences]
              .sort()
              .map((r) => `\`${r}\``)
              .join(", ")
          : "none"
      } |`,
    );
  }

  files.set("PI-BUNDLE-REPORT.md", buildReport(reportRows));
  return files;
}

function buildReport(rows: string[]): string {
  return [
    "<!-- GENERATED — DO NOT EDIT. Regenerate: bun run scripts/build-pi-bundle.ts -->",
    "",
    "# Pi Bundle Report",
    "",
    "This `adapters/pi/` package is generated from canonical `skills/<name>/SKILL.md` sources",
    "by `scripts/build-pi-bundle.ts`. Do not hand-edit it — edit the canonical skill and",
    "regenerate. `pnpm gate` runs `pi:check` to guard against drift.",
    "",
    "Repo-relative rauf docs/source references are rewritten to skill-local `references/*` files",
    "so generated Pi skills remain self-contained after package installation.",
    "",
    "| Skill | Canonical files | Copied repo references |",
    "| ----- | --------------- | ---------------------- |",
    ...rows,
    "",
  ].join("\n");
}

function listGenerated(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listGenerated(abs, base));
    else if (e.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

function main(): void {
  const check = process.argv.includes("--check");
  const bundle = buildBundle();

  if (check) {
    const drift: string[] = [];
    for (const [rel, content] of bundle) {
      const abs = path.join(PI_ADAPTER_DIR, rel);
      const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
      if (current !== content) drift.push(rel);
    }
    for (const rel of listGenerated(PI_ADAPTER_DIR)) {
      if (!bundle.has(rel)) drift.push(`${rel} (stale — not produced by generator)`);
    }
    if (drift.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `Pi bundle drift detected — these differ from canonical sources:\n` +
          drift.map((d) => `  - adapters/pi/${d}`).join("\n") +
          `\n\nRun: bun run scripts/build-pi-bundle.ts  (then commit the result)`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`Pi bundle is in sync with canonical skills (${bundle.size} files).`);
    process.exit(0);
  }

  fs.rmSync(PI_ADAPTER_DIR, { recursive: true, force: true });
  for (const [rel, content] of bundle) {
    const abs = path.join(PI_ADAPTER_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  // eslint-disable-next-line no-console
  console.log(`Generated adapters/pi/ with ${bundle.size} files.`);
}

if (import.meta.main) main();
