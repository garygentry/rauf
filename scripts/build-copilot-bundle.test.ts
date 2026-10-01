import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildBundle, findDrift, parseFrontmatter, writeBundle } from "./build-copilot-bundle";

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
    const reviewer = bundle.get("agents/rauf-backlog-reviewer.agent.md")!;
    const driver = bundle.get("agents/rauf-loop-driver.agent.md")!;
    for (const content of [reviewer, driver]) {
      expect(content).toContain("tools:\n  - read\n  - search\n  - execute");
      expect(content).not.toMatch(/^\s+- edit$/m);
      expect(content).toContain("agents: []");
      expect(content).toContain("user-invocable: false");
      expect(content).toContain("Sources: agents/");
    }
    expect(reviewer).toContain("You only review and report.");
    expect(reviewer).toContain("Required canonical skill contract: `review-backlog`");
    expect(reviewer).toContain("## Review Dimensions");
    expect(driver).toContain("you DRIVE rauf from the outside");
    expect(driver).toContain("You do NOT behave as a loop iteration");
    expect(driver).toContain("Required canonical skill contract: `drive-rauf-loop`");
    expect(driver).toContain("### The stream never decides");
    for (const content of [reviewer, driver]) {
      expect(content).toContain("the agent boundary above always wins");
    }
  });

  it("fails on unknown Copilot tool aliases", () => {
    expect(() =>
      buildBundle({
        "rauf-backlog-reviewer": {
          tools: ["read", "search", "execute", "mystery-tool"],
          requiredSkill: "review-backlog",
        },
        "rauf-loop-driver": {
          tools: ["read", "search", "execute"],
          requiredSkill: "drive-rauf-loop",
        },
      }),
    ).toThrow("unknown Copilot tool alias(es): mystery-tool");
  });

  it("fails on unknown required Copilot skills", () => {
    expect(() =>
      buildBundle({
        "rauf-backlog-reviewer": {
          tools: ["read", "search", "execute"],
          requiredSkill: "missing-skill",
        },
        "rauf-loop-driver": {
          tools: ["read", "search", "execute"],
          requiredSkill: "drive-rauf-loop",
        },
      }),
    ).toThrow("unknown required Copilot skill 'missing-skill'");
  });

  it("records every source mapping and explicit drop result", () => {
    const report = bundle.get("COPILOT-BUNDLE-REPORT.md")!;
    expect(report).toContain("| Skill | `skills/author-backlog/SKILL.md`");
    expect(report).toContain(
      "| Agent | `agents/rauf-loop-driver.md` + `skills/drive-rauf-loop/SKILL.md`",
    );
    expect(report).toContain("composed-skill=drive-rauf-loop");
    expect(report).toContain("| none |");
  });

  it("is deterministic by generated path", () => {
    const paths = [...bundle.keys()];
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
  });
});

describe("parseFrontmatter", () => {
  it("folds block-scalar descriptions instead of keeping the indicator", () => {
    const document = parseFrontmatter(
      "---\nname: demo\ndescription: >\n  First line\n  second line.\n---\nBody\n",
      "demo.md",
    );
    expect(document.description).toBe("First line second line.");
    expect(document.body).toBe("Body\n");
  });

  it("parses the canonical skills' folded descriptions", () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, "skills/drive-rauf-loop/SKILL.md"), "utf-8");
    const { description } = parseFrontmatter(text, "skills/drive-rauf-loop/SKILL.md");
    expect(description).toMatch(/^Operate the rauf CLI/);
  });

  it("fails on indented lines outside a block scalar", () => {
    expect(() =>
      parseFrontmatter("---\nname: demo\n  hidden: true\ndescription: x\n---\n", "demo.md"),
    ).toThrow("unsupported frontmatter line 'hidden: true'");
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

describe("release-prep version bump (#131, issue #119 twin)", () => {
  it("regenerating after a simulated bump leaves the bundle in sync with only plugin.json changed", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-copilot-bump-"));
    temporaryDirectories.push(directory);
    const current = buildBundle();
    // The bundle as committed before release:prepare runs.
    writeBundle(current, directory);
    const bumped = buildBundle(undefined, { version: "99.0.0" });

    // Before regeneration the bump is detected as drift, and only in plugin.json.
    expect(findDrift(bumped, directory)).toEqual(["plugin.json"]);

    // release:prepare's §3.2c step: regenerate via the generator.
    writeBundle(bumped, directory);
    expect(findDrift(bumped, directory)).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "plugin.json"), "utf-8"));
    expect(manifest.version).toBe("99.0.0");
  });
});
