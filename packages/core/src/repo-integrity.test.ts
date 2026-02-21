import { describe, expect, it } from "vitest";
import { lstatSync, readlinkSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import { renderTemplate } from "./template.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("repo integrity", () => {
  it("ralph.sh at repo root is a symlink to artifacts/variants/backlog-json/ralph.sh", () => {
    const rootScript = resolve(REPO_ROOT, "ralph.sh");
    const canonicalScript = resolve(REPO_ROOT, "artifacts/variants/backlog-json/ralph.sh");

    // Canonical file must exist as a regular file
    expect(existsSync(canonicalScript), "canonical ralph.sh must exist").toBe(true);
    const canonicalStat = lstatSync(canonicalScript);
    expect(canonicalStat.isFile(), "canonical ralph.sh must be a regular file").toBe(true);

    // Root ralph.sh must be a symlink
    const rootStat = lstatSync(rootScript);
    expect(rootStat.isSymbolicLink(), "root ralph.sh must be a symlink").toBe(true);

    // Symlink must point to the canonical location
    const target = readlinkSync(rootScript);
    expect(target).toBe("artifacts/variants/backlog-json/ralph.sh");
  });

  it("ralph-add.sh at repo root is a symlink to artifacts/variants/backlog-json/ralph-add.sh", () => {
    const rootScript = resolve(REPO_ROOT, "ralph-add.sh");
    const canonicalScript = resolve(REPO_ROOT, "artifacts/variants/backlog-json/ralph-add.sh");

    expect(existsSync(canonicalScript), "canonical ralph-add.sh must exist").toBe(true);
    const canonicalStat = lstatSync(canonicalScript);
    expect(canonicalStat.isFile(), "canonical ralph-add.sh must be a regular file").toBe(true);

    const rootStat = lstatSync(rootScript);
    expect(rootStat.isSymbolicLink(), "root ralph-add.sh must be a symlink").toBe(true);

    const target = readlinkSync(rootScript);
    expect(target).toBe("artifacts/variants/backlog-json/ralph-add.sh");
  });

  it("ralph-status.sh at repo root is a symlink to artifacts/variants/backlog-json/ralph-status.sh", () => {
    const rootScript = resolve(REPO_ROOT, "ralph-status.sh");
    const canonicalScript = resolve(REPO_ROOT, "artifacts/variants/backlog-json/ralph-status.sh");

    expect(existsSync(canonicalScript), "canonical ralph-status.sh must exist").toBe(true);
    const canonicalStat = lstatSync(canonicalScript);
    expect(canonicalStat.isFile(), "canonical ralph-status.sh must be a regular file").toBe(true);

    const rootStat = lstatSync(rootScript);
    expect(rootStat.isSymbolicLink(), "root ralph-status.sh must be a symlink").toBe(true);

    const target = readlinkSync(rootScript);
    expect(target).toBe("artifacts/variants/backlog-json/ralph-status.sh");
  });

  it("ralph-stop.sh at repo root is a symlink to artifacts/variants/backlog-json/ralph-stop.sh", () => {
    const rootScript = resolve(REPO_ROOT, "ralph-stop.sh");
    const canonicalScript = resolve(REPO_ROOT, "artifacts/variants/backlog-json/ralph-stop.sh");

    expect(existsSync(canonicalScript), "canonical ralph-stop.sh must exist").toBe(true);
    const canonicalStat = lstatSync(canonicalScript);
    expect(canonicalStat.isFile(), "canonical ralph-stop.sh must be a regular file").toBe(true);

    const rootStat = lstatSync(rootScript);
    expect(rootStat.isSymbolicLink(), "root ralph-stop.sh must be a symlink").toBe(true);

    const target = readlinkSync(rootScript);
    expect(target).toBe("artifacts/variants/backlog-json/ralph-stop.sh");
  });
});

// ─── Artifact template rendering tests ───────────────────────────

const ARTIFACTS_DIR = resolve(REPO_ROOT, "artifacts/variants/backlog-json");

/** Variables that installer.ts's buildTemplateVars() provides */
const RALPH_MD_VARS: Record<string, string> = {
  verifyCommand: "pnpm test && pnpm -r typecheck",
  testCommand: "pnpm test",
  typecheckCommand: "pnpm -r typecheck",
  lintCommand: "pnpm -r lint",
  buildCommand: "pnpm build",
  formatCommand: "pnpm run format:check",
};

/** Variables that greenfield.ts's scaffoldClaudeMd() provides */
const GREENFIELD_VARS: Record<string, string> = {
  projectName: "My Project",
  projectDescription: "A sample project description",
  requirements: "Some requirements here",
  stackDescription: "node-typescript",
  testCommand: "pnpm test",
  typecheckCommand: "pnpm -r typecheck",
  lintCommand: "pnpm -r lint",
  buildCommand: "pnpm build",
  verifyCommand: "pnpm test && pnpm -r typecheck",
};

describe("artifact templates", () => {
  describe("RALPH.md.tmpl", () => {
    const templatePath = join(ARTIFACTS_DIR, ".ralph/RALPH.md.tmpl");

    it("file exists in the artifacts directory", () => {
      expect(existsSync(templatePath), "RALPH.md.tmpl must exist").toBe(true);
    });

    it("contains all expected template variables", () => {
      const content = readFileSync(templatePath, "utf-8");
      for (const varName of Object.keys(RALPH_MD_VARS)) {
        expect(content, `RALPH.md.tmpl must contain {{${varName}}}`).toContain(`{{${varName}}}`);
      }
    });

    it("renders correctly — no unresolved variables remain", () => {
      const content = readFileSync(templatePath, "utf-8");
      const rendered = renderTemplate(content, RALPH_MD_VARS);
      // No {{varName}} patterns should remain after rendering with all known vars
      expect(rendered).not.toMatch(/\{\{\w+\}\}/);
    });

    it("has properly formatted managed sentinel block", () => {
      const content = readFileSync(templatePath, "utf-8");
      const startSentinel = "<!-- ralph:managed:start -->";
      const endSentinel = "<!-- ralph:managed:end -->";

      expect(content, "must contain managed start sentinel").toContain(startSentinel);
      expect(content, "must contain managed end sentinel").toContain(endSentinel);

      const startIdx = content.indexOf(startSentinel);
      const endIdx = content.indexOf(endSentinel);
      expect(startIdx, "managed start must come before managed end").toBeLessThan(endIdx);

      // Sentinels must be on their own lines
      const lines = content.split("\n");
      expect(
        lines.some((l) => l.trim() === startSentinel),
        "managed start sentinel must be on its own line",
      ).toBe(true);
      expect(
        lines.some((l) => l.trim() === endSentinel),
        "managed end sentinel must be on its own line",
      ).toBe(true);
    });

    it("rendered output contains verification commands section", () => {
      const content = readFileSync(templatePath, "utf-8");
      const rendered = renderTemplate(content, RALPH_MD_VARS);
      expect(rendered).toContain("pnpm test && pnpm -r typecheck");
      expect(rendered).toContain("pnpm test");
    });
  });

  describe("CLAUDE_ADDON.md", () => {
    const addonPath = join(ARTIFACTS_DIR, "CLAUDE_ADDON.md");

    it("file exists in the artifacts directory", () => {
      expect(existsSync(addonPath), "CLAUDE_ADDON.md must exist").toBe(true);
    });

    it("has ralph:start sentinel", () => {
      const content = readFileSync(addonPath, "utf-8");
      expect(content).toContain("<!-- ralph:start -->");
    });

    it("has ralph:end sentinel", () => {
      const content = readFileSync(addonPath, "utf-8");
      expect(content).toContain("<!-- ralph:end -->");
    });

    it("sentinels are properly ordered (start before end)", () => {
      const content = readFileSync(addonPath, "utf-8");
      const startIdx = content.indexOf("<!-- ralph:start -->");
      const endIdx = content.indexOf("<!-- ralph:end -->");
      expect(startIdx, "ralph:start must come before ralph:end").toBeLessThan(endIdx);
    });

    it("sentinels are on their own lines", () => {
      const content = readFileSync(addonPath, "utf-8");
      const lines = content.split("\n");
      expect(
        lines.some((l) => l.trim() === "<!-- ralph:start -->"),
        "ralph:start must be on its own line",
      ).toBe(true);
      expect(
        lines.some((l) => l.trim() === "<!-- ralph:end -->"),
        "ralph:end must be on its own line",
      ).toBe(true);
    });

    it("contains no template variables (it is a static file)", () => {
      const content = readFileSync(addonPath, "utf-8");
      expect(content).not.toMatch(/\{\{\w+\}\}/);
    });

    it("contains the autonomous loop instructions", () => {
      const content = readFileSync(addonPath, "utf-8");
      expect(content).toContain("RALPH_DONE");
      expect(content).toContain("RALPH_BLOCKED");
      expect(content).toContain("RALPH_NEEDS_HUMAN");
    });
  });

  describe("CLAUDE_GREENFIELD.md.tmpl", () => {
    const templatePath = join(ARTIFACTS_DIR, "CLAUDE_GREENFIELD.md.tmpl");

    it("file exists in the artifacts directory", () => {
      expect(existsSync(templatePath), "CLAUDE_GREENFIELD.md.tmpl must exist").toBe(true);
    });

    it("contains all expected template variables", () => {
      const content = readFileSync(templatePath, "utf-8");
      for (const varName of Object.keys(GREENFIELD_VARS)) {
        expect(content, `CLAUDE_GREENFIELD.md.tmpl must contain {{${varName}}}`).toContain(
          `{{${varName}}}`,
        );
      }
    });

    it("renders correctly — no unresolved variables remain", () => {
      const content = readFileSync(templatePath, "utf-8");
      const rendered = renderTemplate(content, GREENFIELD_VARS);
      expect(rendered).not.toMatch(/\{\{\w+\}\}/);
    });

    it("has properly formatted ralph sentinel block", () => {
      const content = readFileSync(templatePath, "utf-8");
      const startSentinel = "<!-- ralph:start -->";
      const endSentinel = "<!-- ralph:end -->";

      expect(content, "must contain ralph:start sentinel").toContain(startSentinel);
      expect(content, "must contain ralph:end sentinel").toContain(endSentinel);

      const startIdx = content.indexOf(startSentinel);
      const endIdx = content.indexOf(endSentinel);
      expect(startIdx, "ralph:start must come before ralph:end").toBeLessThan(endIdx);

      // Sentinels must be on their own lines
      const lines = content.split("\n");
      expect(
        lines.some((l) => l.trim() === startSentinel),
        "ralph:start sentinel must be on its own line",
      ).toBe(true);
      expect(
        lines.some((l) => l.trim() === endSentinel),
        "ralph:end sentinel must be on its own line",
      ).toBe(true);
    });

    it("rendered output contains project-specific content", () => {
      const content = readFileSync(templatePath, "utf-8");
      const rendered = renderTemplate(content, GREENFIELD_VARS);
      expect(rendered).toContain("My Project");
      expect(rendered).toContain("A sample project description");
      expect(rendered).toContain("node-typescript");
    });

    it("rendered output contains the autonomous loop section with signal keywords", () => {
      const content = readFileSync(templatePath, "utf-8");
      const rendered = renderTemplate(content, GREENFIELD_VARS);
      expect(rendered).toContain("RALPH_DONE");
      expect(rendered).toContain("RALPH_BLOCKED");
      expect(rendered).toContain("RALPH_NEEDS_HUMAN");
    });
  });
});
