#!/usr/bin/env bun
/**
 * build-codex-agents.ts
 *
 * Generates rauf's Codex subagents (`.codex/agents/<name>.toml`) from the canonical
 * agent definitions in `agents/<name>.md`. Codex subagents are a SEPARATE channel
 * from the plugin (the plugin format has no `agents/` slot — see
 * scripts/build-codex-bundle.ts): they live at `.codex/agents/*.toml`, project- or
 * user-scoped. These are committed repo-level so anyone running Codex on the rauf
 * repo (or who copies them into their project) gets the subagents; `rauf install`
 * does NOT deploy them, keeping user installs clean.
 *
 * Codex subagent format (developers.openai.com/codex/subagents, verified 2026-06-27):
 *   required: name, description, developer_instructions
 *   optional: model, sandbox_mode, skills.config, … (omitted ⇒ inherit parent session)
 *
 * Canonical source `agents/<name>.md`: YAML frontmatter (`name`, `description`) + a
 * markdown body that becomes `developer_instructions`. Single source of truth, no
 * hand-maintained TOML. `--check` is the drift guard wired into `pnpm gate`.
 *
 * Usage:
 *   bun run scripts/build-codex-agents.ts            # write the agents
 *   bun run scripts/build-codex-agents.ts --check    # drift guard (gate)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const AGENTS_SRC_DIR = path.join(REPO_ROOT, "agents");
const CODEX_AGENTS_DIR = path.join(REPO_ROOT, ".codex", "agents");

interface AgentSource {
  name: string;
  description: string;
  developerInstructions: string;
}

/** Parse `agents/<name>.md`: frontmatter `name` + `description`, body ⇒ developer_instructions. */
export function parseAgent(text: string, source: string): AgentSource {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new Error(`${source}: missing YAML frontmatter (expected leading --- block)`);
  }
  const fm = m[1];
  const body = m[2].trim();

  const name = fieldValue(fm, "name");
  const description = fieldValue(fm, "description");
  if (!name) throw new Error(`${source}: frontmatter missing required 'name'`);
  if (!description) throw new Error(`${source}: frontmatter missing required 'description'`);
  if (!body) throw new Error(`${source}: body (developer_instructions) is empty`);

  return { name, description, developerInstructions: body };
}

/** Read a single-line `key: value` from a frontmatter block (value may be quoted). */
function fieldValue(frontmatter: string, key: string): string | null {
  const line = frontmatter.split("\n").find((l) => l.match(new RegExp(`^${key}:\\s`)));
  if (!line) return null;
  let v = line.slice(line.indexOf(":") + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

/** Escape a string for a TOML basic (double-quoted) value. */
function tomlBasicString(v: string): string {
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** Render one agent as a Codex `.toml`. */
export function renderAgentToml(agent: AgentSource, source: string): string {
  if (agent.developerInstructions.includes('"""')) {
    throw new Error(
      `${source}: developer_instructions contains a TOML multiline delimiter ("""); ` +
        `rewrite the canonical agent body to avoid it.`,
    );
  }
  return [
    "# GENERATED — DO NOT EDIT. Regenerate: bun run scripts/build-codex-agents.ts",
    `# Source: agents/${path.basename(source)}`,
    "",
    `name = ${tomlBasicString(agent.name)}`,
    `description = ${tomlBasicString(agent.description)}`,
    'developer_instructions = """',
    agent.developerInstructions,
    '"""',
    "",
  ].join("\n");
}

/** Build the expected agent set as a repo-relative-to-.codex/agents path → content map. */
export function buildAgents(): Map<string, string> {
  if (!fs.existsSync(AGENTS_SRC_DIR)) throw new Error("No agents/ source directory found.");
  const files = fs
    .readdirSync(AGENTS_SRC_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (files.length === 0) throw new Error("No agent definitions found under agents/.");

  const out = new Map<string, string>();
  for (const f of files) {
    const source = `agents/${f}`;
    const agent = parseAgent(fs.readFileSync(path.join(AGENTS_SRC_DIR, f), "utf-8"), source);
    const filename = `${agent.name}.toml`;
    if (out.has(filename)) throw new Error(`Duplicate agent name "${agent.name}" (${source})`);
    out.set(filename, renderAgentToml(agent, source));
  }
  return out;
}

function listCommitted(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
}

function main(): void {
  const check = process.argv.includes("--check");
  const agents = buildAgents();

  if (check) {
    const drift: string[] = [];
    for (const [rel, content] of agents) {
      const abs = path.join(CODEX_AGENTS_DIR, rel);
      const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
      if (current !== content) drift.push(rel);
    }
    for (const rel of listCommitted(CODEX_AGENTS_DIR)) {
      if (!agents.has(rel)) drift.push(`${rel} (stale — not produced by generator)`);
    }
    if (drift.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `Codex agents drift detected — these differ from agents/<name>.md:\n` +
          drift.map((d) => `  - .codex/agents/${d}`).join("\n") +
          `\n\nRun: bun run scripts/build-codex-agents.ts  (then commit the result)`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`Codex agents are in sync with agents/ (${agents.size} files).`);
    process.exit(0);
  }

  fs.rmSync(CODEX_AGENTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(CODEX_AGENTS_DIR, { recursive: true });
  for (const [rel, content] of agents) {
    fs.writeFileSync(path.join(CODEX_AGENTS_DIR, rel), content);
  }
  // eslint-disable-next-line no-console
  console.log(`Generated .codex/agents/ with ${agents.size} files.`);
}

// Only run when invoked directly (not when imported by tests).
if (import.meta.main) main();
