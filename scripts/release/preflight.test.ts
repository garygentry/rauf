/**
 * Tests for the preflight drift guard + prerelease classification
 * (specs/release-automation/07-testing-strategy.md §2.3).
 *
 * Imports only the pure detectDrift (plus lib helpers), so nothing here
 * needs the Actions env (GITHUB_REF_NAME / GITHUB_OUTPUT). Location sets are
 * built via makeRepoFixture + readVersionLocations rather than hand-rolled.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanupRepoFixtures, makeRepoFixture } from "./__fixtures__";
import { isPrerelease, readVersionLocations } from "./lib";
import { detectDrift } from "./preflight";

afterEach(() => {
  cleanupRepoFixtures();
});

describe("detectDrift", () => {
  it("returns null when the tag and all seven locations agree", () => {
    const repo = makeRepoFixture("0.3.0");
    const locations = readVersionLocations(repo);
    expect(detectDrift("0.3.0", locations)).toBeNull();
  });

  it("returns null for an agreeing prerelease version", () => {
    const repo = makeRepoFixture("0.3.0-rc.1");
    const locations = readVersionLocations(repo);
    expect(detectDrift("0.3.0-rc.1", locations)).toBeNull();
  });

  it("names the tag mismatch when tag != version.ts", () => {
    const repo = makeRepoFixture("0.2.0");
    const locations = readVersionLocations(repo);
    const msg = detectDrift("0.3.0", locations);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/^drift: /);
    expect(msg).toContain("v0.3.0");
    expect(msg).toContain("version.ts");
    expect(msg).toContain("0.2.0");
  });

  it("names the offending file when one package.json != canonical", () => {
    const repo = makeRepoFixture({ "*": "0.3.0", "packages/docs/package.json": "0.1.0" });
    const locations = readVersionLocations(repo);
    const msg = detectDrift("0.3.0", locations);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/^drift: /);
    expect(msg).toContain("packages/docs/package.json");
    expect(msg).toContain("0.1.0");
    expect(msg).toContain("0.3.0");
  });
});

describe("prerelease classification (drives the is_prerelease output)", () => {
  it("classifies a prerelease tag version as prerelease", () => {
    expect(isPrerelease("0.3.0-rc.1")).toBe(true);
  });

  it("classifies a stable tag version as stable", () => {
    expect(isPrerelease("0.3.0")).toBe(false);
  });
});
