import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildBundle, frontmatterKeys, makeTsReferenceSelfContained } from "./build-pi-bundle";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

// The exact repo-relative paths the generator is allowed to rewrite (mirrors REPO_REFERENCE_RE in
// build-pi-bundle.ts). Used by the inverted drift guard below.
const REPO_REFERENCE_RE =
  /(?:docs\/(?:SPEC-BACKLOG-TOOL-CONTRACT|SPEC-CLI|SPEC-CORE)\.md)|(?:packages\/core\/src\/state-labels\.ts)/;

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

  it("emits a Pi adapter manifest with the required fields", () => {
    const manifest = JSON.parse(bundle.get("package.json")!);
    expect(manifest.name).toBe("rauf-pi-adapter");
    expect(manifest.private).toBe(true);
    expect(manifest.pi.skills).toEqual(["./skills"]);
    // Version is lockstep with the repo package (single source of record).
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
    expect(manifest.version).toBe(pkg.version);
  });

  it("includes every canonical skill's SKILL.md", () => {
    const skillDirs = fs
      .readdirSync(path.join(REPO_ROOT, "skills"), { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() && fs.existsSync(path.join(REPO_ROOT, "skills", e.name, "SKILL.md")),
      )
      .map((e) => e.name);

    expect(skillDirs.length).toBeGreaterThanOrEqual(4);
    for (const id of skillDirs) {
      expect(
        bundle.get(path.join("skills", id, "SKILL.md")),
        `bundle missing SKILL.md for ${id}`,
      ).toBeTruthy();
    }
  });

  it("includes a generated bundle report", () => {
    expect(bundle.get("PI-BUNDLE-REPORT.md")).toMatch(/GENERATED — DO NOT EDIT/);
  });

  // Inverted drift guard (the failure mode pi:check structurally cannot see): a repo-relative
  // reference that the generator does NOT rewrite would silently ship a path that cannot resolve
  // once Pi installs the package. Every generated file except the report — which intentionally
  // lists the copied source paths — must be free of raw repo reference paths.
  it("rewrites every repo-relative reference away from generated content", () => {
    for (const [rel, content] of bundle) {
      if (rel === "PI-BUNDLE-REPORT.md") continue;
      expect(REPO_REFERENCE_RE.test(content), `raw repo reference path survived into ${rel}`).toBe(
        false,
      );
    }
  });

  it("ships a self-contained state-labels.ts (no dangling sibling import)", () => {
    const [, stateLabels] =
      [...bundle].find(([rel]) => rel.endsWith("references/state-labels.ts")) ?? [];
    expect(stateLabels, "generator produced no state-labels.ts reference").toBeTruthy();
    // No dangling relative import survives, and the type it needed is inlined locally.
    expect(stateLabels).not.toMatch(/from\s*"\.\//);
    expect(stateLabels).toMatch(/type LoopStateEnum =/);
    // The inlined union is derived from STATE_LABELS' keys, so every real state is present.
    for (const key of ["IDLE", "REVIEWING", "PAUSED_USAGE_LIMIT"]) {
      expect(stateLabels).toContain(`"${key}"`);
    }
  });
});

describe("makeTsReferenceSelfContained", () => {
  it("inlines a known type import and drops the sibling module path", () => {
    const src = [
      'import type { LoopStateEnum } from "./schemas.js";',
      "export const STATE_LABELS: Record<LoopStateEnum, string> = {",
      '  IDLE: "Idle",',
      '  ERROR: "Error",',
      "};",
    ].join("\n");
    const out = makeTsReferenceSelfContained("state-labels.ts", src);
    expect(out).not.toContain('from "./schemas.js"');
    expect(out).toMatch(/type LoopStateEnum =\n\s*\| "IDLE"\n\s*\| "ERROR";/);
  });

  it("throws on a type import it does not know how to reconstruct", () => {
    const src = 'import type { SomethingNew } from "./schemas.js";\nexport const x = 1;\n';
    expect(() => makeTsReferenceSelfContained("x.ts", src)).toThrow(/SomethingNew/);
  });

  it("throws on a leftover relative import (guards against a new dangling import)", () => {
    const src = 'import { helper } from "./util.js";\nexport const x = helper;\n';
    expect(() => makeTsReferenceSelfContained("x.ts", src)).toThrow(/unresolved relative import/);
  });
});
