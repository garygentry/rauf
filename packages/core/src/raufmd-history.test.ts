import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalizeLegacyRaufMd,
  legacyRaufMdHash,
  matchShippedRaufMd,
} from "./raufmd-history.js";
import { SHIPPED_RAUF_MD_HASHES } from "./raufmd-shipped-hashes.js";
import { renderTemplate } from "./template.js";

const FIXTURES_DIR = path.join(import.meta.dirname, "__fixtures__", "raufmd-shipped");
const fixtures = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".md.tmpl"))
  .map((f) => ({
    version: f.replace(/\.md\.tmpl$/, ""),
    content: fs.readFileSync(path.join(FIXTURES_DIR, f), "utf-8"),
  }));

const VARS = {
  projectName: "",
  projectDescription: "",
  testCommand: "pnpm test",
  typecheckCommand: "pnpm typecheck",
  lintCommand: "pnpm lint",
  buildCommand: "pnpm build",
  formatCommand: "pnpm format:check",
  verifyCommand: "pnpm build && pnpm typecheck && pnpm test",
  stackDescription: "",
  verificationWarning: "",
};

describe("shipped RAUF.md record", () => {
  it("has one fixture per recorded hash, named after the first release that shipped it", () => {
    expect(fixtures.map((f) => f.version).sort()).toEqual(
      SHIPPED_RAUF_MD_HASHES.map((e) => e.versions[0]).sort(),
    );
  });

  it("derives every recorded hash from its fixture (pins the canonicalization)", () => {
    for (const entry of SHIPPED_RAUF_MD_HASHES) {
      const fixture = fixtures.find((f) => f.version === entry.versions[0]);
      expect(fixture, entry.versions[0]).toBeDefined();
      expect(legacyRaufMdHash(fixture!.content), entry.versions[0]).toBe(entry.sha256);
    }
  });

  it("covers the last pre-ownership release", () => {
    expect(SHIPPED_RAUF_MD_HASHES.flatMap((e) => e.versions)).toContain("v0.18.0");
  });

  it("relies on verifyCommand in Workflow step 6 being the only placeholder outside the managed block", () => {
    for (const { version, content } of fixtures) {
      const outside = content.replace(
        /<!-- rauf:managed:start -->[\s\S]*<!-- rauf:managed:end -->/,
        "",
      );
      expect(outside.match(/\{\{\w+\}\}/g), version).toEqual(["{{verifyCommand}}"]);
      expect(outside, version).toContain("Run verification: `{{verifyCommand}}`");
    }
  });
});

describe("matchShippedRaufMd", () => {
  it("recognizes every shipped template as rendered, whatever the profile values", () => {
    for (const { version, content } of fixtures) {
      const rendered = renderTemplate(content, VARS);
      expect(matchShippedRaufMd(rendered), version).toContain(version);
      const other = renderTemplate(content, { ...VARS, verifyCommand: "make ci", testCommand: "" });
      expect(matchShippedRaufMd(other), version).toContain(version);
    }
  });

  it("ignores user content below the anchor, CRLF and trailing whitespace", () => {
    const v18 = fixtures.find((f) => f.version === "v0.18.0")!.content;
    const rendered = renderTemplate(v18, VARS) + "\nMy project rule.\n";
    expect(matchShippedRaufMd(rendered.replace(/\n/g, "  \r\n"))).toEqual(["v0.18.0"]);
  });

  it("recognizes an older install whose managed block was refreshed by a later update", () => {
    const v9 = renderTemplate(fixtures.find((f) => f.version === "v0.9.0")!.content, VARS);
    const v18 = renderTemplate(fixtures.find((f) => f.version === "v0.18.0")!.content, VARS);
    const managed = (s: string) =>
      s.slice(s.indexOf("<!-- rauf:managed:start -->"), s.indexOf("<!-- rauf:managed:end -->"));
    expect(matchShippedRaufMd(v9.replace(managed(v9), managed(v18)))).toContain("v0.9.0");
  });

  it("recognizes a shipped file whose sentinels were stripped", () => {
    const v15 = renderTemplate(fixtures.find((f) => f.version === "v0.15.0")!.content, VARS);
    const stripped = v15
      .replace("<!-- rauf:managed:start -->\n", "")
      .replace("<!-- rauf:managed:end -->\n", "");
    expect(matchShippedRaufMd(stripped)).toEqual(["v0.15.0"]);
  });

  it("rejects edited rauf text and malformed sentinels", () => {
    const v18 = renderTemplate(fixtures.find((f) => f.version === "v0.18.0")!.content, VARS);
    expect(
      matchShippedRaufMd(v18.replace("Work on ONE item only", "Work on TWO items")),
    ).toBeNull();
    expect(matchShippedRaufMd(v18 + "<!-- rauf:managed:end -->\n")).not.toBeNull(); // below anchor
    expect(canonicalizeLegacyRaufMd(v18.replace("<!-- rauf:managed:end -->", ""))).toBeNull();
  });
});
