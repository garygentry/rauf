import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  mergeClaudeMd,
  extractRalphBlock,
  CLAUDE_MD_FILENAME,
  CLAUDE_MD_SENTINEL_START,
  CLAUDE_MD_SENTINEL_END,
} from "./claude-md.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

const SAMPLE_RALPH_BLOCK = [
  "## Autonomous Loop (Ralph)",
  "",
  "When running as a ralph loop iteration, follow these rules:",
  "",
  "1. Read `.ralph/RALPH.md` for instructions",
  "2. Read `.ralph/backlog.json` for the current task",
].join("\n");

const DIFFERENT_RALPH_BLOCK = [
  "## Autonomous Loop (Ralph) v2",
  "",
  "Updated instructions for the ralph loop.",
].join("\n");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-claude-md-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Scenario 1: Non-existent CLAUDE.md ─────────────────────────

describe("mergeClaudeMd — scenario 1: create", () => {
  it("creates CLAUDE.md with ralph section when file does not exist", () => {
    const result = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.action).toBe("created");
    expect(result.value.filePath).toBe(path.join(tmpDir, CLAUDE_MD_FILENAME));

    const content = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");
    expect(content).toContain(CLAUDE_MD_SENTINEL_START);
    expect(content).toContain(CLAUDE_MD_SENTINEL_END);
    expect(content).toContain("## Autonomous Loop (Ralph)");
  });

  it("created file has correct sentinel structure", () => {
    mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    const content = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");

    // Should be: sentinel_start\n<content>\nsentinel_end\n
    const expected =
      CLAUDE_MD_SENTINEL_START + "\n" + SAMPLE_RALPH_BLOCK + "\n" + CLAUDE_MD_SENTINEL_END + "\n";
    expect(content).toBe(expected);
  });
});

// ─── Scenario 2: Existing without sentinels ─────────────────────

describe("mergeClaudeMd — scenario 2: append", () => {
  it("appends ralph block to existing CLAUDE.md without sentinels", () => {
    const existingContent = "# My Project\n\nExisting instructions here.\n";
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    const result = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.action).toBe("merged");
  });

  it("preserves existing content when appending", () => {
    const existingContent = "# My Project\n\nExisting instructions here.\n";
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    const content = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");
    expect(content).toContain("# My Project");
    expect(content).toContain("Existing instructions here.");
    expect(content).toContain(CLAUDE_MD_SENTINEL_START);
    expect(content).toContain(CLAUDE_MD_SENTINEL_END);
    expect(content).toContain("## Autonomous Loop (Ralph)");
  });

  it("existing content comes before ralph block", () => {
    const existingContent = "# My Project\n";
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    const content = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");
    const projectIdx = content.indexOf("# My Project");
    const sentinelIdx = content.indexOf(CLAUDE_MD_SENTINEL_START);
    expect(projectIdx).toBeLessThan(sentinelIdx);
  });
});

// ─── Scenario 3: Sentinels exist, content matches ───────────────

describe("mergeClaudeMd — scenario 3: skip", () => {
  it("skips when sentinels exist and content matches exactly", () => {
    const existingContent = [
      "# My Project",
      "",
      CLAUDE_MD_SENTINEL_START,
      SAMPLE_RALPH_BLOCK,
      CLAUDE_MD_SENTINEL_END,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    const result = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.action).toBe("skipped");
  });

  it("does not modify file when skipping", () => {
    const existingContent = [
      "# My Project",
      "",
      CLAUDE_MD_SENTINEL_START,
      SAMPLE_RALPH_BLOCK,
      CLAUDE_MD_SENTINEL_END,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);
    const contentAfter = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");

    expect(contentAfter).toBe(existingContent);
  });

  it("skip handles whitespace normalization", () => {
    // Existing has extra whitespace around the block content
    const existingContent = [
      "# My Project",
      "",
      CLAUDE_MD_SENTINEL_START,
      "",
      SAMPLE_RALPH_BLOCK,
      "",
      CLAUDE_MD_SENTINEL_END,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    const result = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.action).toBe("skipped");
  });
});

// ─── Scenario 4: Sentinels exist, content differs ───────────────

describe("mergeClaudeMd — scenario 4: replace", () => {
  it("replaces bounded block when content differs", () => {
    const existingContent = [
      "# My Project",
      "",
      CLAUDE_MD_SENTINEL_START,
      "old ralph content",
      CLAUDE_MD_SENTINEL_END,
      "",
      "## Other Section",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    const result = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.action).toBe("updated");
  });

  it("preserves content outside sentinels when replacing", () => {
    const existingContent = [
      "# My Project",
      "",
      "Custom instructions above.",
      "",
      CLAUDE_MD_SENTINEL_START,
      "old ralph content",
      CLAUDE_MD_SENTINEL_END,
      "",
      "## Other Section",
      "",
      "Custom instructions below.",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    const content = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");

    // Content outside sentinels preserved
    expect(content).toContain("# My Project");
    expect(content).toContain("Custom instructions above.");
    expect(content).toContain("## Other Section");
    expect(content).toContain("Custom instructions below.");

    // Old content replaced
    expect(content).not.toContain("old ralph content");

    // New content present
    expect(content).toContain("## Autonomous Loop (Ralph)");
    expect(content).toContain("Read `.ralph/RALPH.md` for instructions");
  });

  it("replaces with different content versions correctly", () => {
    const existingContent = [
      CLAUDE_MD_SENTINEL_START,
      SAMPLE_RALPH_BLOCK,
      CLAUDE_MD_SENTINEL_END,
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    const result = mergeClaudeMd(tmpDir, DIFFERENT_RALPH_BLOCK);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.action).toBe("updated");

    const content = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");
    expect(content).toContain("## Autonomous Loop (Ralph) v2");
    expect(content).toContain("Updated instructions for the ralph loop.");
    expect(content).not.toContain("Read `.ralph/RALPH.md` for instructions");
  });
});

// ─── Content preservation (cross-cutting) ───────────────────────

describe("mergeClaudeMd — content preservation", () => {
  it("preserves complex multi-section CLAUDE.md", () => {
    const existingContent = [
      "# My Application",
      "",
      "## Build Commands",
      "```bash",
      "npm run build",
      "npm test",
      "```",
      "",
      "## Coding Standards",
      "",
      "- Use TypeScript strict mode",
      "- No any types",
      "",
      CLAUDE_MD_SENTINEL_START,
      "old ralph section",
      CLAUDE_MD_SENTINEL_END,
      "",
      "## Security",
      "",
      "- Never commit secrets",
      "- Validate all inputs",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existingContent);

    mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);

    const content = fs.readFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "utf-8");

    // All sections preserved
    expect(content).toContain("# My Application");
    expect(content).toContain("## Build Commands");
    expect(content).toContain("npm run build");
    expect(content).toContain("## Coding Standards");
    expect(content).toContain("- Use TypeScript strict mode");
    expect(content).toContain("## Security");
    expect(content).toContain("- Never commit secrets");

    // Ralph section updated
    expect(content).toContain("## Autonomous Loop (Ralph)");
    expect(content).not.toContain("old ralph section");
  });

  it("idempotent: create then merge again results in skip", () => {
    // First call: create
    const r1 = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value.action).toBe("created");

    // Second call: skip (same content)
    const r2 = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.action).toBe("skipped");
  });

  it("idempotent: append then merge again results in skip", () => {
    // Set up existing file without sentinels
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), "# Existing\n");

    // First call: merge (append)
    const r1 = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value.action).toBe("merged");

    // Second call: skip (sentinels now exist, content matches)
    const r2 = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.action).toBe("skipped");
  });

  it("idempotent: replace then merge again results in skip", () => {
    // Set up existing file with old sentinel content
    const existing = [CLAUDE_MD_SENTINEL_START, "old content", CLAUDE_MD_SENTINEL_END].join("\n");
    fs.writeFileSync(path.join(tmpDir, CLAUDE_MD_FILENAME), existing);

    // First call: update (replace)
    const r1 = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value.action).toBe("updated");

    // Second call: skip
    const r2 = mergeClaudeMd(tmpDir, SAMPLE_RALPH_BLOCK);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.action).toBe("skipped");
  });
});

// ─── extractRalphBlock ───────────────────────────────────────────

describe("extractRalphBlock", () => {
  it("extracts content between sentinels", () => {
    const addon = [
      CLAUDE_MD_SENTINEL_START,
      "## Ralph Section",
      "",
      "Some instructions.",
      CLAUDE_MD_SENTINEL_END,
    ].join("\n");

    const block = extractRalphBlock(addon);
    expect(block).toBe("## Ralph Section\n\nSome instructions.");
  });

  it("trims whitespace from extracted content", () => {
    const addon = [
      CLAUDE_MD_SENTINEL_START,
      "",
      "  content with spaces  ",
      "",
      CLAUDE_MD_SENTINEL_END,
    ].join("\n");

    const block = extractRalphBlock(addon);
    expect(block).toBe("content with spaces");
  });

  it("returns trimmed full content when no sentinels present", () => {
    const content = "  just raw content  ";
    expect(extractRalphBlock(content)).toBe("just raw content");
  });

  it("works with the real CLAUDE_ADDON.md format", () => {
    const addon = [
      CLAUDE_MD_SENTINEL_START,
      "## Autonomous Loop (Ralph)",
      "",
      "When running as a ralph loop iteration, follow these rules:",
      CLAUDE_MD_SENTINEL_END,
    ].join("\n");

    const block = extractRalphBlock(addon);
    expect(block).toContain("## Autonomous Loop (Ralph)");
    expect(block).not.toContain(CLAUDE_MD_SENTINEL_START);
    expect(block).not.toContain(CLAUDE_MD_SENTINEL_END);
  });
});

// ─── Error handling ──────────────────────────────────────────────

describe("mergeClaudeMd — error handling", () => {
  it("returns error for non-existent project directory", () => {
    const result = mergeClaudeMd(path.join(tmpDir, "nonexistent-project"), SAMPLE_RALPH_BLOCK);

    expect(result.ok).toBe(false);
  });
});
