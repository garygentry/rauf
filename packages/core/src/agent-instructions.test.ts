import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  mergeManagedSection,
  extractManagedBlock,
  removeManagedSection,
  AGENTS_MD_FILENAME,
  AGENTS_MD_SENTINEL_START,
  AGENTS_MD_SENTINEL_END,
} from "./agent-instructions.js";

let tmpDir: string;

const BLOCK = ["## Autonomous Loop (Rauf)", "", "Host-agnostic loop rules."].join("\n");
const DIFFERENT_BLOCK = ["## Autonomous Loop (Rauf) v2", "", "Updated rules."].join("\n");

const S = AGENTS_MD_SENTINEL_START;
const E = AGENTS_MD_SENTINEL_END;

function agentsPath() {
  return path.join(tmpDir, AGENTS_MD_FILENAME);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-agents-md-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("mergeManagedSection — create (file absent)", () => {
  it("creates AGENTS.md with the managed block wrapped in sentinels", () => {
    const result = mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, BLOCK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe("created");

    const content = fs.readFileSync(agentsPath(), "utf-8");
    expect(content).toContain(S);
    expect(content).toContain(E);
    expect(content).toContain("Host-agnostic loop rules.");
  });
});

describe("mergeManagedSection — append (file exists, no sentinels)", () => {
  it("preserves existing user content and appends the managed block", () => {
    fs.writeFileSync(agentsPath(), "# My Project\n\nExisting notes.\n");
    const result = mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, BLOCK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe("merged");

    const content = fs.readFileSync(agentsPath(), "utf-8");
    expect(content).toContain("Existing notes.");
    expect(content).toContain(S);
    expect(content).toContain("Host-agnostic loop rules.");
  });
});

describe("mergeManagedSection — idempotency", () => {
  it("skips when the managed block already matches", () => {
    mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, BLOCK);
    const result = mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, BLOCK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe("skipped");
  });

  it("updates only the bounded block, preserving surrounding user content", () => {
    fs.writeFileSync(agentsPath(), "# My Project\n\nExisting notes.\n");
    mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, BLOCK);
    const result = mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, DIFFERENT_BLOCK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe("updated");

    const content = fs.readFileSync(agentsPath(), "utf-8");
    expect(content).toContain("Existing notes.");
    expect(content).toContain("Updated rules.");
    expect(content).not.toContain("Host-agnostic loop rules.");
  });
});

describe("extractManagedBlock", () => {
  it("strips the sentinels and returns the inner block", () => {
    const addon = `${S}\n${BLOCK}\n${E}\n`;
    expect(extractManagedBlock(addon, S, E)).toBe(BLOCK);
  });

  it("returns the whole trimmed content when sentinels are absent", () => {
    expect(extractManagedBlock(`  ${BLOCK}  `, S, E)).toBe(BLOCK);
  });
});

describe("removeManagedSection", () => {
  it("removes the managed block but keeps surrounding user content", () => {
    fs.writeFileSync(agentsPath(), "# My Project\n\nExisting notes.\n");
    mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, BLOCK);
    removeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E);

    const content = fs.readFileSync(agentsPath(), "utf-8");
    expect(content).toContain("Existing notes.");
    expect(content).not.toContain(S);
    expect(content).not.toContain("Host-agnostic loop rules.");
  });

  it("deletes the file entirely when only the managed block remained", () => {
    mergeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E, BLOCK);
    removeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E);
    expect(fs.existsSync(agentsPath())).toBe(false);
  });

  it("is a no-op when the file does not exist", () => {
    expect(() => removeManagedSection(tmpDir, AGENTS_MD_FILENAME, S, E)).not.toThrow();
  });
});
