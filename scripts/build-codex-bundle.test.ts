import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildBundle, frontmatterKeys } from "./build-codex-bundle";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("frontmatterKeys", () => {
  it("extracts top-level keys and ignores indented block-scalar continuations", () => {
    const md = [
      "---",
      "name: x",
      "description: >",
      "  a long",
      "  wrapped value",
      "---",
      "",
      "body",
    ].join("\n");
    expect(frontmatterKeys(md, "test")).toEqual(["name", "description"]);
  });

  it("throws when frontmatter is absent", () => {
    expect(() => frontmatterKeys("# no frontmatter\n", "test")).toThrow(/frontmatter/);
  });
});

describe("buildBundle", () => {
  const bundle = buildBundle();

  it("emits a valid Codex plugin manifest with the required fields", () => {
    const manifest = JSON.parse(bundle.get("plugin.json")!);
    expect(manifest.name).toBe("rauf");
    expect(manifest.description).toBeTruthy();
    expect(manifest.skills).toBe("./skills/");
    // version is lockstep with the Claude plugin (single source of record).
    const claude = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
    );
    expect(manifest.version).toBe(claude.version);
  });

  it("includes every canonical skill, byte-identical to its source (no divergent copy)", () => {
    const skillDirs = fs
      .readdirSync(path.join(REPO_ROOT, "skills"), { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() && fs.existsSync(path.join(REPO_ROOT, "skills", e.name, "SKILL.md")),
      )
      .map((e) => e.name);

    expect(skillDirs.length).toBeGreaterThanOrEqual(4);
    for (const id of skillDirs) {
      const rel = path.join("skills", id, "SKILL.md");
      const canonical = fs.readFileSync(path.join(REPO_ROOT, "skills", id, "SKILL.md"), "utf-8");
      expect(bundle.get(rel), `bundle missing ${rel}`).toBe(canonical);
    }
  });

  it("carries skill reference files through verbatim", () => {
    const rel = path.join("skills", "author-backlog", "references", "backlog-examples.md");
    const canonical = fs.readFileSync(
      path.join(REPO_ROOT, "skills", "author-backlog", "references", "backlog-examples.md"),
      "utf-8",
    );
    expect(bundle.get(rel)).toBe(canonical);
  });

  it("includes a generated bundle report", () => {
    expect(bundle.get("CODEX-BUNDLE-REPORT.md")).toMatch(/GENERATED — DO NOT EDIT/);
  });
});
