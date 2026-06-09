import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { validateBacklog } from "./backlog-validate.js";
import { defaultBacklogPaths, DEFAULT_ROOT_DIR } from "./backlog-root.js";
import type { BacklogPaths } from "./backlog-root.js";
import { ErrorCodes } from "./errors.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;
let paths: BacklogPaths;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-validate-"));
  fs.mkdirSync(path.join(tmpDir, DEFAULT_ROOT_DIR));
  paths = defaultBacklogPaths(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a raw backlog.json (may be intentionally schema-invalid). */
function writeRaw(obj: unknown): void {
  fs.writeFileSync(paths.backlog, JSON.stringify(obj, null, 2));
}

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "001",
    type: "feature",
    priority: 1,
    title: "An item",
    description: "desc",
    acceptanceCriteria: ["verify passes"],
    status: "pending",
    completedAt: null,
    ...overrides,
  };
}

function backlog(items: Record<string, unknown>[]): Record<string, unknown> {
  return { project: "p", description: "d", items };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("validateBacklog", () => {
  it("passes a valid backlog (in_progress / bugfix)", () => {
    writeRaw(backlog([item({ id: "001", status: "in_progress", type: "bugfix" })]));
    const result = validateBacklog(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.findings.filter((f) => f.severity === "error")).toHaveLength(0);
    }
  });

  it("rejects rauf-invalid status (status:'complete') with an error finding", () => {
    // The old Python validator passed this with only a warning (exit 0).
    writeRaw(backlog([item({ status: "complete" })]));
    const result = validateBacklog(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(result.value.findings.some((f) => f.severity === "error")).toBe(true);
    }
  });

  it("rejects an unknown type (type:'docs')", () => {
    writeRaw(backlog([item({ type: "docs" })]));
    const result = validateBacklog(paths);
    expect(result.ok && result.value.valid).toBe(false);
  });

  it("flags duplicate item IDs", () => {
    writeRaw(backlog([item({ id: "001" }), item({ id: "001" })]));
    const result = validateBacklog(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(result.value.findings.some((f) => f.code === "DUPLICATE_ID")).toBe(true);
    }
  });

  it("flags a dependsOn reference that does not resolve", () => {
    writeRaw(backlog([item({ id: "001", dependsOn: ["999"] })]));
    const result = validateBacklog(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(result.value.findings.some((f) => f.code === "MISSING_DEPENDENCY")).toBe(true);
    }
  });

  it("detects a dependency cycle", () => {
    writeRaw(
      backlog([item({ id: "001", dependsOn: ["002"] }), item({ id: "002", dependsOn: ["001"] })]),
    );
    const result = validateBacklog(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(result.value.findings.some((f) => f.code === "DEPENDENCY_CYCLE")).toBe(true);
    }
  });

  it("warns (does not fail) on empty acceptanceCriteria", () => {
    writeRaw(backlog([item({ acceptanceCriteria: [] })]));
    const result = validateBacklog(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true); // warning only
      expect(
        result.value.findings.some((f) => f.code === "EMPTY_AC" && f.severity === "warning"),
      ).toBe(true);
    }
  });

  it("skips specReferences existence when no specsDir given", () => {
    writeRaw(backlog([item({ specReferences: ["nope/missing.md"] })]));
    const result = validateBacklog(paths);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.findings.some((f) => f.code === "MISSING_SPEC")).toBe(false);
    }
  });

  it("flags a missing specReference when specsDir is provided", () => {
    writeRaw(backlog([item({ specReferences: ["missing.md"] })]));
    const result = validateBacklog(paths, { specsDir: tmpDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(result.value.findings.some((f) => f.code === "MISSING_SPEC")).toBe(true);
    }
  });

  it("passes when the specReference exists under specsDir", () => {
    fs.writeFileSync(path.join(tmpDir, "present.md"), "# spec\n");
    writeRaw(backlog([item({ specReferences: ["present.md"] })]));
    const result = validateBacklog(paths, { specsDir: tmpDir });
    expect(result.ok && result.value.valid).toBe(true);
  });

  it("returns INVALID_JSON for a malformed file (usage/IO error, not a finding)", () => {
    fs.writeFileSync(paths.backlog, "{ not json");
    const result = validateBacklog(paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_JSON);
    }
  });

  it("returns FILE_NOT_FOUND when backlog.json is absent", () => {
    fs.rmSync(paths.backlog, { force: true });
    const result = validateBacklog(paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    }
  });
});
