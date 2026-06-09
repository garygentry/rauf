import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { renderTemplate, renderTemplateFile, updateSentinelBlock } from "./template.js";
import { ErrorCodes } from "./errors.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-template-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── renderTemplate ──────────────────────────────────────────────

describe("renderTemplate", () => {
  it("replaces a single variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("replaces multiple occurrences of the same variable", () => {
    expect(renderTemplate("{{x}} and {{x}} again", { x: "A" })).toBe("A and A again");
  });

  it("replaces multiple different variables", () => {
    const result = renderTemplate("{{greeting}} {{name}}, welcome to {{place}}!", {
      greeting: "Hello",
      name: "Alice",
      place: "Wonderland",
    });
    expect(result).toBe("Hello Alice, welcome to Wonderland!");
  });

  it("leaves unknown variables as-is", () => {
    expect(renderTemplate("{{known}} and {{unknown}}", { known: "yes" })).toBe(
      "yes and {{unknown}}",
    );
  });

  it("replaces null values with empty string", () => {
    expect(renderTemplate("before {{val}} after", { val: null })).toBe("before  after");
  });

  it("replaces undefined values with empty string", () => {
    expect(renderTemplate("before {{val}} after", { val: undefined })).toBe("before  after");
  });

  it("handles template with no variables", () => {
    expect(renderTemplate("no variables here", { x: "ignored" })).toBe("no variables here");
  });

  it("handles empty template", () => {
    expect(renderTemplate("", { x: "ignored" })).toBe("");
  });

  it("handles empty variables map", () => {
    expect(renderTemplate("{{a}} stays", {})).toBe("{{a}} stays");
  });

  it("replaces variable with empty string value", () => {
    expect(renderTemplate("before {{val}} after", { val: "" })).toBe("before  after");
  });

  it("handles variables adjacent to each other", () => {
    expect(renderTemplate("{{a}}{{b}}", { a: "X", b: "Y" })).toBe("XY");
  });

  it("handles multiline templates", () => {
    const template = "Line 1: {{a}}\nLine 2: {{b}}\nLine 3: {{a}}";
    expect(renderTemplate(template, { a: "X", b: "Y" })).toBe("Line 1: X\nLine 2: Y\nLine 3: X");
  });

  it("does not match malformed mustache syntax", () => {
    // Only matches {{word_chars}} — braces with spaces or special chars are not matched
    expect(renderTemplate("{{ spaced }}", { spaced: "nope" })).toBe("{{ spaced }}");
    expect(renderTemplate("{{{triple}}}", { triple: "val" })).toBe("{val}");
  });

  it("handles variable names with underscores and digits", () => {
    expect(renderTemplate("{{my_var_2}}", { my_var_2: "works" })).toBe("works");
  });
});

// ─── renderTemplateFile ──────────────────────────────────────────

describe("renderTemplateFile", () => {
  it("renders a template file and writes output", () => {
    const templatePath = path.join(tmpDir, "input.tmpl");
    const outputPath = path.join(tmpDir, "output.txt");

    fs.writeFileSync(templatePath, "Hello {{name}}, you have {{count}} items.");

    const result = renderTemplateFile(templatePath, outputPath, {
      name: "Bob",
      count: "5",
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("Hello Bob, you have 5 items.");
  });

  it("returns error for missing template file", () => {
    const result = renderTemplateFile(
      path.join(tmpDir, "nonexistent.tmpl"),
      path.join(tmpDir, "output.txt"),
      {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    }
  });

  it("leaves unknown variables as-is in output file", () => {
    const templatePath = path.join(tmpDir, "input.tmpl");
    const outputPath = path.join(tmpDir, "output.txt");

    fs.writeFileSync(templatePath, "{{known}} and {{unknown}}");

    const result = renderTemplateFile(templatePath, outputPath, {
      known: "yes",
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("yes and {{unknown}}");
  });

  it("writes atomically (no partial writes on error)", () => {
    const templatePath = path.join(tmpDir, "input.tmpl");
    const outputPath = path.join(tmpDir, "subdir", "nested", "output.txt");

    fs.writeFileSync(templatePath, "content");

    // Output dir doesn't exist — atomicWrite will fail
    const result = renderTemplateFile(templatePath, outputPath, {});

    expect(result.ok).toBe(false);
    // No .tmp file should be left behind (or the dir doesn't even exist)
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("handles null values in variables", () => {
    const templatePath = path.join(tmpDir, "input.tmpl");
    const outputPath = path.join(tmpDir, "output.txt");

    fs.writeFileSync(templatePath, "test: {{val}}");

    const result = renderTemplateFile(templatePath, outputPath, { val: null });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("test: ");
  });
});

// ─── updateSentinelBlock ─────────────────────────────────────────

describe("updateSentinelBlock", () => {
  const START = "<!-- rauf:start -->";
  const END = "<!-- rauf:end -->";

  it("replaces content between existing sentinels", () => {
    const content = [
      "User content above",
      START,
      "old ralph content",
      END,
      "User content below",
    ].join("\n");

    const result = updateSentinelBlock(content, START, END, "new ralph content");

    expect(result).toBe(
      ["User content above", START, "new ralph content", END, "User content below"].join("\n"),
    );
  });

  it("preserves content outside sentinels exactly", () => {
    const before = "# My Project\n\nCustom instructions here.\n\n";
    const after = "\n\n## Other Section\n\nMore custom content.\n";
    const content = before + START + "\nold content\n" + END + after;

    const result = updateSentinelBlock(content, START, END, "new content");

    expect(result).toBe(before + START + "\nnew content\n" + END + after);
  });

  it("appends block if sentinels not found", () => {
    const content = "Existing file content\n";

    const result = updateSentinelBlock(content, START, END, "ralph section");

    expect(result).toBe(
      "Existing file content\n\n" + START + "\n" + "ralph section\n" + END + "\n",
    );
  });

  it("appends block to empty file", () => {
    const result = updateSentinelBlock("", START, END, "ralph section");

    expect(result).toBe(START + "\n" + "ralph section\n" + END + "\n");
  });

  it("appends block if content has no trailing newline", () => {
    const content = "No trailing newline";

    const result = updateSentinelBlock(content, START, END, "new block");

    expect(result).toBe("No trailing newline\n\n" + START + "\n" + "new block\n" + END + "\n");
  });

  it("handles multiline block content", () => {
    const content = ["before", START, "old line 1", "old line 2", END, "after"].join("\n");

    const newBlock = "new line 1\nnew line 2\nnew line 3";
    const result = updateSentinelBlock(content, START, END, newBlock);

    expect(result).toBe(
      ["before", START, "new line 1", "new line 2", "new line 3", END, "after"].join("\n"),
    );
  });

  it("works with RAUF.md managed sentinels", () => {
    const managedStart = "<!-- rauf:managed:start -->";
    const managedEnd = "<!-- rauf:managed:end -->";

    const content = [
      "## Verification Commands",
      "",
      managedStart,
      "old managed content",
      managedEnd,
      "",
      "## Workflow",
    ].join("\n");

    const result = updateSentinelBlock(content, managedStart, managedEnd, "new managed content");

    expect(result).toBe(
      [
        "## Verification Commands",
        "",
        managedStart,
        "new managed content",
        managedEnd,
        "",
        "## Workflow",
      ].join("\n"),
    );
  });

  it("handles only start sentinel present (no end)", () => {
    const content = "before\n" + START + "\norphaned content\n";

    // Missing end sentinel — treat as not found, append full block
    const result = updateSentinelBlock(content, START, END, "new content");

    expect(result).toContain(START);
    expect(result).toContain(END);
    expect(result).toContain("new content");
    // Should have both opening sentinels (original orphaned one + new appended one)
  });

  it("handles only end sentinel present (no start)", () => {
    const content = "before\n" + END + "\nafter\n";

    const result = updateSentinelBlock(content, START, END, "new content");

    expect(result).toContain(START);
    expect(result).toContain(END);
    expect(result).toContain("new content");
  });

  it("handles sentinels in wrong order (end before start)", () => {
    const content = END + "\nstuff\n" + START + "\n";

    // End before start is treated as "not found" — append
    const result = updateSentinelBlock(content, START, END, "new content");

    expect(result).toContain("new content");
  });

  it("replaces empty content between sentinels", () => {
    const content = START + "\n" + END;

    const result = updateSentinelBlock(content, START, END, "filled in");

    expect(result).toBe(START + "\nfilled in\n" + END);
  });

  it("can clear content between sentinels", () => {
    const content = "before\n" + START + "\nstuff here\n" + END + "\nafter";

    const result = updateSentinelBlock(content, START, END, "");

    expect(result).toBe("before\n" + START + "\n\n" + END + "\nafter");
  });

  it("preserves trailing content after end sentinel", () => {
    const content = START + "\nold\n" + END + "\ntrailing content\nmore trailing";

    const result = updateSentinelBlock(content, START, END, "new");

    expect(result).toBe(START + "\nnew\n" + END + "\ntrailing content\nmore trailing");
  });
});
