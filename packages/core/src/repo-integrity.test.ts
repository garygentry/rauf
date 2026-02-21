import { describe, expect, it } from "vitest";
import { lstatSync, readlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("repo integrity", () => {
  it("ralph.sh at repo root is a symlink to artifacts/variants/backlog-json/ralph.sh", () => {
    const rootScript = resolve(REPO_ROOT, "ralph.sh");
    const canonicalScript = resolve(
      REPO_ROOT,
      "artifacts/variants/backlog-json/ralph.sh",
    );

    // Canonical file must exist as a regular file
    expect(existsSync(canonicalScript), "canonical ralph.sh must exist").toBe(
      true,
    );
    const canonicalStat = lstatSync(canonicalScript);
    expect(
      canonicalStat.isFile(),
      "canonical ralph.sh must be a regular file",
    ).toBe(true);

    // Root ralph.sh must be a symlink
    const rootStat = lstatSync(rootScript);
    expect(rootStat.isSymbolicLink(), "root ralph.sh must be a symlink").toBe(
      true,
    );

    // Symlink must point to the canonical location
    const target = readlinkSync(rootScript);
    expect(target).toBe("artifacts/variants/backlog-json/ralph.sh");
  });
});
