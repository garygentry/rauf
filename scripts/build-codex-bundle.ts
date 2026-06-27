#!/usr/bin/env bun
/**
 * build-codex-bundle.ts
 *
 * Generates the Codex plugin bundle (`.codex-plugin/`) from the SAME canonical
 * skills the Claude plugin uses (`skills/<name>/SKILL.md`). This is the Codex
 * sibling of the Claude `.claude-plugin/` packaging: it gives Codex users
 * first-class access to rauf's authoring/review/guidance/loop skills WITHOUT a
 * hand-maintained divergent copy (the review's "do not hand-maintain divergent
 * skill copies" rule). The committed bundle is always derived from canonical;
 * `--check` is the drift guard wired into `pnpm gate`.
 *
 * Codex plugin format (developers.openai.com/codex/plugins/build, verified
 * 2026-06-27):
 *   .codex-plugin/plugin.json   required manifest: name, version, description;
 *                               optional skills:"./skills/", keywords, repository
 *   skills/<name>/SKILL.md      skill (frontmatter requires name + description)
 *   skills/<name>/references/*  optional skill references (copied verbatim)
 *
 * rauf's canonical SKILL.md frontmatter already carries ONLY `name` + `description`
 * (Codex's required set), so skills copy through verbatim. If a skill ever adds a
 * non-Codex frontmatter key, this generator fails loud rather than silently leaking
 * a Claude-only construct into the Codex bundle.
 *
 * Usage:
 *   bun run scripts/build-codex-bundle.ts            # write the bundle
 *   bun run scripts/build-codex-bundle.ts --check    # drift guard (gate)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const CLAUDE_PLUGIN_JSON = path.join(REPO_ROOT, ".claude-plugin", "plugin.json");
const CODEX_PLUGIN_DIR = path.join(REPO_ROOT, ".codex-plugin");

/** Codex SKILL.md frontmatter keys we know how to carry. Anything else fails loud. */
const SUPPORTED_FRONTMATTER_KEYS = new Set(["name", "description"]);

interface SkillSource {
  /** Skill id == directory name (and the frontmatter `name`). */
  id: string;
  /** Verbatim SKILL.md text. */
  skillMd: string;
  /** Relative-to-skill reference files (e.g. "references/backlog-examples.md") → content. */
  references: Map<string, string>;
}

/** Extract the top-level frontmatter keys from a SKILL.md (lines like `key:` at column 0). */
export function frontmatterKeys(skillMd: string, source: string): string[] {
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

/** Discover and validate every canonical skill. */
function readSkills(): SkillSource[] {
  const entries = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const skills: SkillSource[] = [];
  for (const id of entries) {
    const skillMdPath = path.join(SKILLS_DIR, id, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue; // not a skill dir
    const source = `skills/${id}/SKILL.md`;
    const skillMd = fs.readFileSync(skillMdPath, "utf-8");

    const keys = frontmatterKeys(skillMd, source);
    if (!keys.includes("name")) throw new Error(`${source}: frontmatter missing required 'name'`);
    if (!keys.includes("description")) {
      throw new Error(`${source}: frontmatter missing required 'description'`);
    }
    const unsupported = keys.filter((k) => !SUPPORTED_FRONTMATTER_KEYS.has(k));
    if (unsupported.length > 0) {
      throw new Error(
        `${source}: frontmatter has non-Codex key(s) [${unsupported.join(", ")}]. ` +
          `Teach scripts/build-codex-bundle.ts to map or drop them before they leak into the Codex bundle.`,
      );
    }

    const references = new Map<string, string>();
    const refDir = path.join(SKILLS_DIR, id, "references");
    if (fs.existsSync(refDir)) {
      for (const f of fs.readdirSync(refDir).sort()) {
        const abs = path.join(refDir, f);
        if (fs.statSync(abs).isFile()) {
          references.set(path.join("references", f), fs.readFileSync(abs, "utf-8"));
        }
      }
    }

    skills.push({ id, skillMd, references });
  }

  if (skills.length === 0) throw new Error("No skills found under skills/.");
  return skills;
}

/** Build the full expected bundle as a relative-path → content map. */
export function buildBundle(): Map<string, string> {
  const claudePlugin = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_JSON, "utf-8")) as {
    version: string;
    description: string;
    keywords?: string[];
  };
  const skills = readSkills();

  const manifest = {
    name: "rauf",
    version: claudePlugin.version, // lockstep with the Claude plugin (single source of record)
    description: claudePlugin.description,
    repository: "https://github.com/garygentry/rauf",
    keywords: claudePlugin.keywords ?? ["rauf", "backlog", "autonomous", "loop", "agent"],
    skills: "./skills/",
  };

  const files = new Map<string, string>();
  files.set("plugin.json", JSON.stringify(manifest, null, 2) + "\n");

  for (const skill of skills) {
    files.set(path.join("skills", skill.id, "SKILL.md"), skill.skillMd);
    for (const [rel, content] of skill.references) {
      files.set(path.join("skills", skill.id, rel), content);
    }
  }

  files.set("CODEX-BUNDLE-REPORT.md", buildReport(skills));
  return files;
}

function buildReport(skills: SkillSource[]): string {
  const rows = skills.map((s) => `| \`${s.id}\` | ${s.references.size} | none |`).join("\n");
  return [
    "<!-- GENERATED — DO NOT EDIT. Regenerate: bun run scripts/build-codex-bundle.ts -->",
    "",
    "# Codex Bundle Report",
    "",
    "This `.codex-plugin/` bundle is generated from the canonical `skills/<name>/SKILL.md`",
    "sources by `scripts/build-codex-bundle.ts`. Do not hand-edit it — edit the canonical",
    "skill and regenerate. `pnpm gate` runs `codex:check` to guard against drift.",
    "",
    "rauf's canonical skill frontmatter is already Codex-compatible (`name` + `description`",
    "only), so every skill maps through with no dropped constructs.",
    "",
    "| Skill | Reference files | Dropped constructs |",
    "| ----- | --------------- | ------------------ |",
    rows,
    "",
  ].join("\n");
}

/** Recursively list committed files under .codex-plugin/ as repo-relative-to-bundle paths. */
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
  const bundle = buildBundle();

  if (check) {
    const drift: string[] = [];
    for (const [rel, content] of bundle) {
      const abs = path.join(CODEX_PLUGIN_DIR, rel);
      const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
      if (current !== content) drift.push(rel);
    }
    // Stale committed files no longer produced by the generator.
    for (const rel of listCommitted(CODEX_PLUGIN_DIR)) {
      if (!bundle.has(rel)) drift.push(`${rel} (stale — not produced by generator)`);
    }
    if (drift.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `Codex bundle drift detected — these differ from the canonical skills:\n` +
          drift.map((d) => `  - .codex-plugin/${d}`).join("\n") +
          `\n\nRun: bun run scripts/build-codex-bundle.ts  (then commit the result)`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`Codex bundle is in sync with the canonical skills (${bundle.size} files).`);
    process.exit(0);
  }

  // Write mode: rebuild the bundle from scratch so removed skills are pruned.
  fs.rmSync(CODEX_PLUGIN_DIR, { recursive: true, force: true });
  for (const [rel, content] of bundle) {
    const abs = path.join(CODEX_PLUGIN_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  // eslint-disable-next-line no-console
  console.log(`Generated .codex-plugin/ with ${bundle.size} files.`);
}

// Only run when invoked directly (not when imported by tests).
if (import.meta.main) main();
