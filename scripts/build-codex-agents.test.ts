import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildAgents, parseAgent, renderAgentToml } from "./build-codex-agents";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("parseAgent", () => {
  it("splits frontmatter (name/description) from the developer_instructions body", () => {
    const md = ["---", "name: a", "description: does a thing", "---", "", "Do the thing."].join(
      "\n",
    );
    const agent = parseAgent(md, "test");
    expect(agent).toEqual({
      name: "a",
      description: "does a thing",
      developerInstructions: "Do the thing.",
    });
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseAgent("no frontmatter", "test")).toThrow(/frontmatter/);
  });

  it("throws when the body is empty", () => {
    expect(() => parseAgent("---\nname: a\ndescription: d\n---\n\n", "test")).toThrow(
      /developer_instructions/,
    );
  });
});

describe("renderAgentToml", () => {
  const agent = { name: "x", description: 'has "quotes"', developerInstructions: "Body line." };

  it("emits required Codex keys and escapes the description", () => {
    const toml = renderAgentToml(agent, "agents/x.md");
    expect(toml).toContain('name = "x"');
    expect(toml).toContain('description = "has \\"quotes\\""');
    expect(toml).toContain('developer_instructions = """');
    expect(toml).toContain("Body line.");
  });

  it("refuses a body containing the TOML multiline delimiter", () => {
    expect(() =>
      renderAgentToml({ ...agent, developerInstructions: 'a """ b' }, "agents/x.md"),
    ).toThrow(/multiline delimiter/);
  });
});

describe("buildAgents", () => {
  it("produces a <name>.toml for every canonical agents/*.md", () => {
    const agents = buildAgents();
    const srcCount = fs
      .readdirSync(path.join(REPO_ROOT, "agents"))
      .filter((f) => f.endsWith(".md")).length;
    expect(agents.size).toBe(srcCount);
    expect(agents.size).toBeGreaterThanOrEqual(2);
    for (const [name, content] of agents) {
      expect(name).toMatch(/\.toml$/);
      expect(content).toContain("developer_instructions");
    }
  });
});
