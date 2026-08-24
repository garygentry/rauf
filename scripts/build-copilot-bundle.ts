#!/usr/bin/env bun
/** Generate the native Copilot operator plugin from rauf's canonical skills and agents. */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const OUTPUT_DIR = path.join(REPO_ROOT, "adapters", "copilot");
const SUPPORTED_FRONTMATTER_KEYS = new Set(["name", "description"]);
const SUPPORTED_COPILOT_TOOL_ALIASES = new Set(["read", "search", "execute", "edit"]);

interface CanonicalDocument {
  name: string;
  description: string;
  body: string;
}

interface AgentPolicy {
  tools: readonly string[];
}

const AGENT_POLICIES: Readonly<Record<string, AgentPolicy>> = {
  "rauf-backlog-reviewer": { tools: ["read", "search", "execute"] },
  "rauf-loop-driver": { tools: ["read", "search", "execute"] },
};

function parseFrontmatter(text: string, source: string): CanonicalDocument {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error(`${source}: missing YAML frontmatter (expected leading --- block)`);
  }

  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field?.[1] || field[2] === undefined) continue;
    if (!SUPPORTED_FRONTMATTER_KEYS.has(field[1])) {
      throw new Error(
        `${source}: unsupported canonical field '${field[1]}'; add an explicit Copilot mapping or drop record`,
      );
    }
    if (fields.has(field[1]))
      throw new Error(`${source}: duplicate frontmatter field '${field[1]}'`);
    let value = field[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields.set(field[1], value);
  }

  const name = fields.get("name");
  const description = fields.get("description");
  if (!name) throw new Error(`${source}: frontmatter missing required 'name'`);
  if (!description) throw new Error(`${source}: frontmatter missing required 'description'`);
  return { name, description, body: match[2] };
}

function withProvenance(text: string, source: string): string {
  return text.replace(
    "---\n",
    `---\n# GENERATED — DO NOT EDIT. Source: ${source}. Regenerate: bun run scripts/build-copilot-bundle.ts\n`,
  );
}

function renderAgent(document: CanonicalDocument, source: string, policy: AgentPolicy): string {
  return [
    "---",
    `# GENERATED — DO NOT EDIT. Source: ${source}. Regenerate: bun run scripts/build-copilot-bundle.ts`,
    `name: ${document.name}`,
    `description: ${JSON.stringify(document.description)}`,
    "tools:",
    ...policy.tools.map((tool) => `  - ${tool}`),
    "agents: []",
    "user-invocable: false",
    "---",
    document.body,
  ].join("\n");
}

function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  function visit(directory: string): void {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        files.set(path.relative(root, absolute), fs.readFileSync(absolute, "utf-8"));
      }
    }
  }
  if (fs.existsSync(root)) visit(root);
  return files;
}

export function buildBundle(
  agentPolicies: Readonly<Record<string, AgentPolicy>> = AGENT_POLICIES,
): Map<string, string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) as {
    version: string;
    description: string;
  };
  const files = new Map<string, string>();
  files.set(
    "plugin.json",
    JSON.stringify(
      {
        name: "rauf",
        description: pkg.description,
        version: pkg.version,
        agents: "agents/",
        skills: "skills/",
      },
      null,
      2,
    ) + "\n",
  );

  const reportRows: string[] = [];
  const skillDirectories = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
  for (const id of skillDirectories) {
    const source = `skills/${id}/SKILL.md`;
    const skillRoot = path.join(SKILLS_DIR, id);
    const skillFiles = readTree(skillRoot);
    const skillDocument = parseFrontmatter(skillFiles.get("SKILL.md") ?? "", source);
    if (skillDocument.name !== id) {
      throw new Error(
        `${source}: frontmatter name '${skillDocument.name}' must match directory '${id}'`,
      );
    }
    for (const [relative, content] of skillFiles) {
      files.set(
        path.join("skills", id, relative),
        relative === "SKILL.md" ? withProvenance(content, source) : content,
      );
    }
    reportRows.push(
      `| Skill | \`${source}\` | \`skills/${id}/SKILL.md\` | name, description, body, ${skillFiles.size - 1} bundled file(s) | none |`,
    );
  }

  const agentFiles = fs
    .readdirSync(AGENTS_DIR)
    .filter((file) => file.endsWith(".md"))
    .sort();
  const seenPolicies = new Set<string>();
  for (const file of agentFiles) {
    const source = `agents/${file}`;
    const document = parseFrontmatter(
      fs.readFileSync(path.join(AGENTS_DIR, file), "utf-8"),
      source,
    );
    if (path.basename(file, ".md") !== document.name) {
      throw new Error(`${source}: frontmatter name '${document.name}' must match filename`);
    }
    const policy = agentPolicies[document.name];
    if (!policy)
      throw new Error(`${source}: no explicit Copilot agent policy for '${document.name}'`);
    const unknownTools = policy.tools.filter((tool) => !SUPPORTED_COPILOT_TOOL_ALIASES.has(tool));
    if (unknownTools.length > 0) {
      throw new Error(`${source}: unknown Copilot tool alias(es): ${unknownTools.join(", ")}`);
    }
    seenPolicies.add(document.name);
    const output = `agents/${document.name}.agent.md`;
    files.set(output, renderAgent(document, source, policy));
    reportRows.push(
      `| Agent | \`${source}\` | \`${output}\` | name, description, body; tools=${policy.tools.join(",")}; agents=[]; user-invocable=false | none |`,
    );
  }
  const orphanedPolicies = Object.keys(agentPolicies).filter((name) => !seenPolicies.has(name));
  if (orphanedPolicies.length > 0) {
    throw new Error(
      `Copilot agent policies have no canonical source: ${orphanedPolicies.join(", ")}`,
    );
  }

  files.set(
    "COPILOT-BUNDLE-REPORT.md",
    [
      "<!-- GENERATED — DO NOT EDIT. Regenerate: bun run scripts/build-copilot-bundle.ts -->",
      "",
      "# Copilot Bundle Report",
      "",
      "This Agent Plugins 1.0 bundle is generated from rauf's canonical operator sources.",
      "Unsupported canonical fields fail generation unless an explicit mapping or drop record is added.",
      "",
      "<!-- prettier-ignore -->",
      "| Kind | Canonical source | Generated output | Mappings | Dropped fields |",
      "| ---- | ---------------- | ---------------- | -------- | -------------- |",
      ...reportRows,
      "",
    ].join("\n"),
  );
  return new Map([...files].sort(([left], [right]) => left.localeCompare(right)));
}

export function findDrift(expected: Map<string, string>, outputDirectory: string): string[] {
  const drift: string[] = [];
  for (const [relative, content] of expected) {
    const absolute = path.join(outputDirectory, relative);
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, "utf-8") !== content)
      drift.push(relative);
  }
  for (const relative of readTree(outputDirectory).keys()) {
    if (!expected.has(relative)) drift.push(`${relative} (stale — not produced by generator)`);
  }
  return drift.sort();
}

function main(): void {
  const check = process.argv.includes("--check");
  const bundle = buildBundle();
  if (check) {
    const drift = findDrift(bundle, OUTPUT_DIR);
    if (drift.length > 0) {
      console.error(
        `Copilot bundle drift detected:\n${drift.map((item) => `  - adapters/copilot/${item}`).join("\n")}\n\n` +
          "Run: bun run scripts/build-copilot-bundle.ts",
      );
      process.exit(1);
    }
    console.log(`Copilot bundle is in sync (${bundle.size} files).`);
    return;
  }

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  for (const [relative, content] of bundle) {
    const absolute = path.join(OUTPUT_DIR, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  console.log(`Generated adapters/copilot/ with ${bundle.size} files.`);
}

if (import.meta.main) main();
