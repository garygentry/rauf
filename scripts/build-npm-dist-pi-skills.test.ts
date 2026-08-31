import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildBundle } from "./build-npm-dist-pi-skills";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("buildBundle", () => {
  const bundle = buildBundle();

  it("includes every file under adapters/pi/skills, byte-identical to its source", () => {
    function walk(dir: string, base = dir): string[] {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(abs, base));
        else if (e.isFile()) out.push(path.relative(base, abs));
      }
      return out;
    }

    const sourceDir = path.join(REPO_ROOT, "adapters", "pi", "skills");
    const sourceFiles = walk(sourceDir);
    expect(sourceFiles.length).toBeGreaterThanOrEqual(4);

    for (const rel of sourceFiles) {
      const canonical = fs.readFileSync(path.join(sourceDir, rel), "utf-8");
      expect(bundle.get(rel), `bundle missing ${rel}`).toBe(canonical);
    }
    expect(bundle.size).toBe(sourceFiles.length);
  });

  it("carries a skill's SKILL.md through verbatim", () => {
    const rel = path.join("author-backlog", "SKILL.md");
    const canonical = fs.readFileSync(
      path.join(REPO_ROOT, "adapters", "pi", "skills", "author-backlog", "SKILL.md"),
      "utf-8",
    );
    expect(bundle.get(rel)).toBe(canonical);
  });
});
