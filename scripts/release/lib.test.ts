/**
 * Unit suite for scripts/release/lib.ts pure functions
 * (specs/release-automation/07-testing-strategy.md §2.1).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRepoFixtures, makeChangelog, makeRepoFixture } from "./__fixtures__";
import {
  PACKAGE_JSON_PATHS,
  VERSION_TS_PATH,
  compareVersions,
  extractSection,
  getUnreleasedBody,
  isPrerelease,
  isValidVersion,
  parseVersionTs,
  readVersionLocations,
  rollChangelog,
  setPackageJsonVersion,
  setVersionTs,
} from "./lib";

describe("parseVersionTs", () => {
  it("extracts the VERSION value", () => {
    const content = '// canonical version\nexport const VERSION = "0.2.0";\n';
    expect(parseVersionTs(content)).toBe("0.2.0");
  });

  it("throws when no VERSION line is present", () => {
    expect(() => parseVersionTs("export const NOT_VERSION = 1;\n")).toThrow(
      /could not find 'export const VERSION/,
    );
  });
});

describe("setVersionTs", () => {
  it("replaces only the VERSION value, preserving surrounding content", () => {
    const content = '// canonical version\nexport const VERSION = "0.2.0";\n';
    expect(setVersionTs(content, "0.3.0")).toBe(
      '// canonical version\nexport const VERSION = "0.3.0";\n',
    );
  });

  it("round-trips through parseVersionTs", () => {
    const content = 'export const VERSION = "0.2.0";\n';
    expect(parseVersionTs(setVersionTs(content, "1.0.0-rc.1"))).toBe("1.0.0-rc.1");
  });

  it("throws when no VERSION line is present", () => {
    expect(() => setVersionTs("const x = 1;\n", "0.3.0")).toThrow(/no VERSION constant/);
  });
});

describe("setPackageJsonVersion", () => {
  it("preserves 2-space indentation", () => {
    const input = '{\n  "name": "x",\n  "version": "1.0.0"\n}\n';
    expect(setPackageJsonVersion(input, "2.0.0")).toBe(
      '{\n  "name": "x",\n  "version": "2.0.0"\n}\n',
    );
  });

  it("preserves 4-space indentation", () => {
    const input = '{\n    "name": "x",\n    "version": "1.0.0"\n}\n';
    expect(setPackageJsonVersion(input, "2.0.0")).toBe(
      '{\n    "name": "x",\n    "version": "2.0.0"\n}\n',
    );
  });

  it("preserves tab indentation", () => {
    const input = '{\n\t"name": "x",\n\t"version": "1.0.0"\n}\n';
    expect(setPackageJsonVersion(input, "2.0.0")).toBe(
      '{\n\t"name": "x",\n\t"version": "2.0.0"\n}\n',
    );
  });

  it("preserves the absence of a trailing newline", () => {
    const input = '{\n  "name": "x",\n  "version": "1.0.0"\n}';
    expect(setPackageJsonVersion(input, "2.0.0")).toBe(
      '{\n  "name": "x",\n  "version": "2.0.0"\n}',
    );
  });

  it("keeps the version field's position among other keys", () => {
    const input = '{\n  "name": "x",\n  "version": "1.0.0",\n  "private": true\n}\n';
    expect(setPackageJsonVersion(input, "2.0.0")).toBe(
      '{\n  "name": "x",\n  "version": "2.0.0",\n  "private": true\n}\n',
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => setPackageJsonVersion("{not json", "2.0.0")).toThrow(/invalid package\.json/);
  });
});

describe("isValidVersion", () => {
  it.each(["1.2.3", "1.2.3-rc.1"])("accepts %s", (v) => {
    expect(isValidVersion(v)).toBe(true);
  });

  it.each(["v1.2.3", "1.2", "1.2.3+build", ""])("rejects %j", (v) => {
    expect(isValidVersion(v)).toBe(false);
  });
});

describe("compareVersions", () => {
  it("orders plain versions", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  });

  it("orders a prerelease below its release (1.2.3-rc.1 < 1.2.3)", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3-rc.1")).toBe(1);
  });

  it("orders prerelease identifiers per semver §11", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3-rc.2")).toBe(-1);
    expect(compareVersions("1.2.3-rc.2", "1.2.3-rc.10")).toBe(-1); // numeric, not lexical
    expect(compareVersions("1.2.3-alpha", "1.2.3-rc")).toBe(-1); // ASCII order
    expect(compareVersions("1.2.3-rc", "1.2.3-rc.1")).toBe(-1); // fewer identifiers → lower
    expect(compareVersions("1.2.3-1", "1.2.3-alpha")).toBe(-1); // numeric < alphanumeric
    expect(compareVersions("1.2.3-rc.1", "1.2.3-rc.1")).toBe(0);
  });
});

describe("isPrerelease", () => {
  it("is false for a stable version", () => {
    expect(isPrerelease("0.3.0")).toBe(false);
  });

  it("is true for a prerelease", () => {
    expect(isPrerelease("0.3.0-rc.1")).toBe(true);
  });
});

describe("getUnreleasedBody", () => {
  it("returns the trimmed body of a non-empty section", () => {
    const content = makeChangelog({
      unreleased: "- Added X\n- Fixed Y",
      priorSections: [{ version: "0.2.0", body: "- Old thing" }],
    });
    expect(getUnreleasedBody(content)).toBe("- Added X\n- Fixed Y");
  });

  it('returns "" when the section is empty', () => {
    const content = makeChangelog({
      unreleased: "",
      priorSections: [{ version: "0.2.0", body: "- Old thing" }],
    });
    expect(getUnreleasedBody(content)).toBe("");
  });

  it('returns "" when the heading is absent', () => {
    expect(getUnreleasedBody("# Changelog\n\n## 0.2.0\n\n- Old thing\n")).toBe("");
  });
});

describe("rollChangelog", () => {
  it("rolls a greenfield changelog (no prior sections) byte-exactly", () => {
    const input = makeChangelog({ unreleased: "- Added X\n- Fixed Y" });
    // Pin the factory output so the byte-exact assertion below is meaningful.
    expect(input).toBe(
      ["# Changelog", "", "## Unreleased", "", "- Added X", "- Fixed Y", ""].join("\n"),
    );

    const { updated, sectionBody } = rollChangelog(input, "0.3.0");
    expect(updated).toBe(
      ["# Changelog", "", "## Unreleased", "", "## 0.3.0", "", "- Added X", "- Fixed Y", ""].join(
        "\n",
      ),
    );
    expect(sectionBody).toBe("- Added X\n- Fixed Y");
  });

  it("rolls above prior sections byte-exactly, preserving them verbatim", () => {
    const input = makeChangelog({
      unreleased: "- New thing",
      priorSections: [{ version: "0.2.0", body: "- Old thing" }],
    });
    expect(input).toBe(
      [
        "# Changelog",
        "",
        "## Unreleased",
        "",
        "- New thing",
        "",
        "## 0.2.0",
        "",
        "- Old thing",
        "",
      ].join("\n"),
    );

    const { updated, sectionBody } = rollChangelog(input, "0.3.0");
    expect(updated).toBe(
      [
        "# Changelog",
        "",
        "## Unreleased",
        "",
        "## 0.3.0",
        "",
        "- New thing",
        "",
        "## 0.2.0",
        "",
        "- Old thing",
        "",
      ].join("\n"),
    );
    expect(sectionBody).toBe("- New thing");
  });

  it("throws when the Unreleased section is empty", () => {
    const input = makeChangelog({ unreleased: "" });
    expect(() => rollChangelog(input, "0.3.0")).toThrow(/`## Unreleased` section is empty/);
  });

  it("throws when the Unreleased section is absent", () => {
    expect(() => rollChangelog("# Changelog\n\n## 0.2.0\n\n- Old thing\n", "0.3.0")).toThrow(
      /`## Unreleased` section is empty/,
    );
  });
});

describe("extractSection", () => {
  it("returns the verbatim trimmed body of a present section", () => {
    const content = makeChangelog({
      unreleased: "- New thing",
      priorSections: [{ version: "0.2.0", body: "- Old thing\n  - nested detail" }],
    });
    expect(extractSection(content, "0.2.0")).toBe("- Old thing\n  - nested detail");
  });

  it("matches a prerelease heading literally", () => {
    const content = makeChangelog({
      unreleased: "- New thing",
      priorSections: [{ version: "0.3.0-rc.1", body: "- Candidate" }],
    });
    expect(extractSection(content, "0.3.0-rc.1")).toBe("- Candidate");
  });

  it("throws when the section is absent", () => {
    const content = makeChangelog({ unreleased: "- New thing" });
    expect(() => extractSection(content, "9.9.9")).toThrow(/no "## 9\.9\.9" section/);
  });

  it("regex-escapes the version: dots are not wildcards", () => {
    // If "." were a wildcard, the version 0.3.0-rc.1 would match this heading.
    const content = ["# Changelog", "", "## 0X3X0-rcX1", "", "- evil", ""].join("\n");
    expect(() => extractSection(content, "0.3.0-rc.1")).toThrow(/no "## 0\.3\.0-rc\.1" section/);
  });
});

describe("readVersionLocations", () => {
  afterEach(cleanupRepoFixtures);

  it("reads all seven locations with version.ts canonical at index 0", () => {
    const dir = makeRepoFixture("0.2.0");
    const locs = readVersionLocations(dir);
    expect(locs).toHaveLength(7);
    expect(locs[0]).toEqual({ file: VERSION_TS_PATH, version: "0.2.0", canonical: true });
    expect(locs.filter((l) => l.canonical)).toHaveLength(1);
    expect(locs.map((l) => l.file)).toEqual([VERSION_TS_PATH, ...PACKAGE_JSON_PATHS]);
    expect(locs.every((l) => l.version === "0.2.0")).toBe(true);
  });

  it("reports a divergent version as written (docs drift)", () => {
    const dir = makeRepoFixture({ "*": "0.2.0", "packages/docs/package.json": "0.1.0" });
    const locs = readVersionLocations(dir);
    const docs = locs.find((l) => l.file === "packages/docs/package.json");
    expect(docs?.version).toBe("0.1.0");
    expect(locs.filter((l) => l.version === "0.2.0")).toHaveLength(6);
  });

  it("throws when an expected file is missing", () => {
    const dir = makeRepoFixture("0.2.0");
    fs.rmSync(path.join(dir, "packages/docs/package.json"));
    expect(() => readVersionLocations(dir)).toThrow();
  });

  it("throws on invalid package.json JSON, naming the file", () => {
    const dir = makeRepoFixture("0.2.0");
    fs.writeFileSync(path.join(dir, "packages/cli/package.json"), "{not json");
    expect(() => readVersionLocations(dir)).toThrow(/packages\/cli\/package\.json: invalid JSON/);
  });

  it("throws on a non-string version field, naming the file", () => {
    const dir = makeRepoFixture("0.2.0");
    fs.writeFileSync(
      path.join(dir, "packages/web/package.json"),
      JSON.stringify({ name: "@rauf/web", version: 123 }, null, 2) + "\n",
    );
    expect(() => readVersionLocations(dir)).toThrow(
      /packages\/web\/package\.json: missing or non-string "version"/,
    );
  });

  it("throws when version.ts has no VERSION constant", () => {
    const dir = makeRepoFixture("0.2.0");
    fs.writeFileSync(path.join(dir, VERSION_TS_PATH), "export const NOPE = 1;\n");
    expect(() => readVersionLocations(dir)).toThrow(/could not find 'export const VERSION/);
  });
});
