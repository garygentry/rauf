/**
 * Tests for the release-notes composition
 * (specs/release-automation/07-testing-strategy.md §2.3).
 *
 * Imports only the pure composeNotes, so nothing here needs git or the
 * release-workflow env (TAG / VERSION). The `--match 'v*'` exclusion of
 * pre-rauf-rename is exercised by passing prevTag = null for the
 * first-release case.
 */

import { describe, expect, it } from "vitest";
import { composeNotes } from "./build-notes";

const SECTION = "### Added\n- Release automation pipeline";
const SLUG = "garygentry/rauf";

describe("composeNotes", () => {
  it("appends the Full Changelog compare link when a prior tag exists", () => {
    const notes = composeNotes(SECTION, "v0.2.0", "v0.3.0", SLUG);
    expect(notes).toBe(
      `${SECTION}\n\n**Full Changelog**: https://github.com/${SLUG}/compare/v0.2.0...v0.3.0\n`,
    );
  });

  it("omits the compare line entirely on a first release (prevTag null)", () => {
    const notes = composeNotes(SECTION, null, "v0.3.0", SLUG);
    expect(notes).toBe(SECTION);
    expect(notes).not.toContain("Full Changelog");
    expect(notes).not.toContain("/compare/");
  });
});
