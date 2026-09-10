/**
 * Unit tests for the pure guard predicates factored out of prepare.ts
 * (specs/release-automation/07-testing-strategy.md §2.2). These never touch
 * git or the filesystem — the git-mutating and push-recovery paths are
 * covered by the manual procedure (spec 07 §4).
 */

import { describe, expect, it } from "vitest";
import { makeChangelog } from "./__fixtures__";
import type { PreparePlan } from "./lib";
import {
  checkChangelogNonEmpty,
  checkValidVersion,
  checkVersionForward,
  dryRunLines,
  releaseBranchName,
} from "./prepare";

describe("checkValidVersion (guard 2.1, REQ-VER-04)", () => {
  it("passes valid stable and prerelease versions", () => {
    expect(checkValidVersion("1.2.3")).toBeNull();
    expect(checkValidVersion("0.3.0-rc.1")).toBeNull();
  });

  it("refuses a leading v, incomplete core, build metadata, and empty string", () => {
    for (const bad of ["v1.2.3", "1.2", "1.2.3+build", ""]) {
      const msg = checkValidVersion(bad);
      expect(msg).toMatch(/^refusing: /);
      expect(msg).toContain("not a valid version");
    }
  });
});

describe("checkVersionForward (guard 2.4, REQ-PREP-04)", () => {
  it("passes a strictly greater version", () => {
    expect(checkVersionForward("0.3.0", "0.2.0")).toBeNull();
    expect(checkVersionForward("0.3.0-rc.1", "0.2.0")).toBeNull();
    // A stable release moves forward from its own prerelease.
    expect(checkVersionForward("0.3.0", "0.3.0-rc.1")).toBeNull();
  });

  it("refuses an equal version", () => {
    const msg = checkVersionForward("0.2.0", "0.2.0");
    expect(msg).toMatch(/^refusing: /);
    expect(msg).toContain("not greater than current 0.2.0");
  });

  it("refuses a downgrade", () => {
    expect(checkVersionForward("0.1.9", "0.2.0")).toMatch(/^refusing: /);
  });

  it("refuses a prerelease of the current stable (prerelease < release)", () => {
    expect(checkVersionForward("0.3.0-rc.1", "0.3.0")).toMatch(/^refusing: /);
  });
});

describe("checkChangelogNonEmpty (guard 2.5, REQ-PREP-05)", () => {
  it("passes when ## Unreleased has content", () => {
    const changelog = makeChangelog({ unreleased: "### Added\n\n- something new" });
    expect(checkChangelogNonEmpty(changelog)).toBeNull();
  });

  it("refuses an empty ## Unreleased section", () => {
    const msg = checkChangelogNonEmpty(makeChangelog({ unreleased: "" }));
    expect(msg).toMatch(/^refusing: /);
    expect(msg).toContain("`## Unreleased` section is empty");
  });

  it("refuses when the ## Unreleased heading is absent entirely", () => {
    expect(checkChangelogNonEmpty("# Changelog\n\n## 0.1.0\n\n- old\n")).toMatch(/^refusing: /);
  });
});

describe("releaseBranchName (PR-mode branch derivation)", () => {
  it("derives release/<version> for stable and prerelease versions", () => {
    expect(releaseBranchName("0.9.0")).toBe("release/0.9.0");
    expect(releaseBranchName("1.0.0-rc.1")).toBe("release/1.0.0-rc.1");
  });
});

describe("dryRunLines (Pi bundle regeneration, issue #119)", () => {
  const makePlan = (version: string): PreparePlan => ({
    version,
    tag: `v${version}`,
    isPrerelease: false,
    changelog: makeChangelog({ unreleased: "### Added\n\n- thing" }),
    sectionBody: "### Added\n\n- thing",
    locations: [{ file: "packages/core/src/version.ts", version: "0.15.0", canonical: true }],
  });

  it("advertises regenerating the Pi bundle in the same order the real flow runs it", () => {
    const lines = dryRunLines(makePlan("0.15.1"));
    const piIdx = lines.findIndex((l) => /adapters\/pi\/.*regenerate/.test(l));
    const changelogIdx = lines.findIndex((l) => l.startsWith("  CHANGELOG.md:"));
    const branchIdx = lines.findIndex((l) => l.startsWith("  branch:"));

    expect(piIdx, "dry-run should mention regenerating adapters/pi").toBeGreaterThanOrEqual(0);
    // main() regenerates the bundle (§3.2b) BEFORE rolling the changelog (§3.3)
    // and creating the branch/commit — the preview must match that order.
    expect(piIdx).toBeLessThan(changelogIdx);
    expect(changelogIdx).toBeLessThan(branchIdx);
    // The bundle version tracks the bump target, and the step names the generator to run.
    expect(lines[piIdx]).toContain("0.15.1");
    expect(lines[piIdx]).toContain("scripts/build-pi-bundle.ts");
  });
});

describe("guard messages are distinct (REQ-PREP-07)", () => {
  it("each failing guard emits a different refusing: line", () => {
    const messages = [
      checkValidVersion("nope"),
      checkVersionForward("0.2.0", "0.2.0"),
      checkChangelogNonEmpty(makeChangelog({ unreleased: "" })),
    ];
    expect(messages.every((m) => m?.startsWith("refusing: "))).toBe(true);
    expect(new Set(messages).size).toBe(messages.length);
  });
});
