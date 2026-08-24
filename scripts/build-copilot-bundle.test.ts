import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildBundle, findDrift } from "./build-copilot-bundle";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildBundle", () => {
  const bundle = buildBundle();

  it("emits a versioned Agent Plugins manifest", () => {
    const manifest = JSON.parse(bundle.get("plugin.json")!);
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
    expect(manifest).toMatchObject({
      name: "rauf",
      version: pkg.version,
      agents: "agents/",
      skills: "skills/",
    });
  });

  it("emits every canonical skill with provenance and bundled files", () => {
    const skillDirectories = fs
      .readdirSync(path.join(REPO_ROOT, "skills"), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(REPO_ROOT, "skills", entry.name, "SKILL.md")),
      );
    expect(skillDirectories).toHaveLength(4);
    for (const entry of skillDirectories) {
      const content = bundle.get(path.join("skills", entry.name, "SKILL.md"));
      expect(content).toContain(`Source: skills/${entry.name}/SKILL.md`);
    }
    expect(bundle.has("skills/author-backlog/references/backlog-examples.md")).toBe(true);
  });

  it("emits both operator agents with explicit bounded policy", () => {
    const agents = [...bundle].filter(([relative]) => relative.startsWith("agents/"));
    expect(agents).toHaveLength(2);
    for (const [relative, content] of agents) {
      expect(relative).toMatch(/\.agent\.md$/);
      expect(content).toContain("tools:\n  - read\n  - search\n  - execute");
      expect(content).toContain("agents: []");
      expect(content).toContain("user-invocable: false");
      expect(content).toContain("Source: agents/");
    }
  });

  it("records every source mapping and explicit drop result", () => {
    const report = bundle.get("COPILOT-BUNDLE-REPORT.md")!;
    expect(report).toContain("| Skill | `skills/author-backlog/SKILL.md`");
    expect(report).toContain("| Agent | `agents/rauf-loop-driver.md`");
    expect(report).toContain("| none |");
  });

  it("is deterministic by generated path", () => {
    const paths = [...bundle.keys()];
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
  });
});

describe("findDrift", () => {
  it("detects changed, missing, and stale files", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-copilot-bundle-"));
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, "changed.txt"), "old");
    fs.writeFileSync(path.join(directory, "stale.txt"), "stale");
    const expected = new Map([
      ["changed.txt", "new"],
      ["missing.txt", "new"],
    ]);

    expect(findDrift(expected, directory)).toEqual([
      "changed.txt",
      "missing.txt",
      "stale.txt (stale — not produced by generator)",
    ]);
  });
});
