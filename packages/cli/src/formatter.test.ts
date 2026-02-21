import { describe, it, expect, beforeEach } from "vitest";
import {
  configureOutput,
  c,
  stripAnsi,
  renderTable,
  isQuiet,
  isJsonMode,
  detectColorSupport,
  symbols,
} from "./formatter.js";
import type { TableColumn } from "./formatter.js";

describe("configureOutput", () => {
  beforeEach(() => {
    // Reset to defaults
    configureOutput({ noColor: false, quiet: false, json: false });
    delete process.env["NO_COLOR"];
  });

  it("sets quiet mode", () => {
    configureOutput({ quiet: true });
    expect(isQuiet()).toBe(true);
  });

  it("sets json mode", () => {
    configureOutput({ json: true });
    expect(isJsonMode()).toBe(true);
  });

  it("sets NO_COLOR env when noColor is true", () => {
    configureOutput({ noColor: true });
    expect(process.env["NO_COLOR"]).toBe("1");
  });
});

describe("color helpers", () => {
  beforeEach(() => {
    configureOutput({ noColor: false, quiet: false, json: false });
    delete process.env["NO_COLOR"];
  });

  it("returns original text through color functions when enabled", () => {
    // Note: picocolors may not apply ANSI in non-TTY (test) environments.
    // We test that our wrapper delegates correctly by verifying:
    // 1. With noColor=false, the function returns a string containing the input
    // 2. stripAnsi of the result equals the original
    configureOutput({ noColor: false });
    const colored = c.red("error");
    expect(stripAnsi(colored)).toBe("error");
    expect(colored).toContain("error");
  });

  it("returns plain text when noColor", () => {
    configureOutput({ noColor: true });
    expect(c.red("error")).toBe("error");
    expect(c.green("ok")).toBe("ok");
    expect(c.bold("title")).toBe("title");
    expect(c.dim("note")).toBe("note");
    expect(c.cyan("cmd")).toBe("cmd");
  });

  it("provides all expected color functions", () => {
    configureOutput({ noColor: true });
    expect(c.red("x")).toBe("x");
    expect(c.green("x")).toBe("x");
    expect(c.yellow("x")).toBe("x");
    expect(c.blue("x")).toBe("x");
    expect(c.cyan("x")).toBe("x");
    expect(c.magenta("x")).toBe("x");
    expect(c.gray("x")).toBe("x");
    expect(c.dim("x")).toBe("x");
    expect(c.bold("x")).toBe("x");
    expect(c.underline("x")).toBe("x");
  });
});

describe("symbols", () => {
  it("provides unicode indicators", () => {
    expect(symbols.success).toBe("\u2713");
    expect(symbols.warning).toBe("\u26A0");
    expect(symbols.error).toBe("\u2717");
    expect(symbols.bullet).toBe("\u25CF");
    expect(symbols.arrow).toBe("\u2192");
  });
});

describe("stripAnsi", () => {
  it("strips ANSI escape codes", () => {
    expect(stripAnsi("\x1b[31merror\x1b[39m")).toBe("error");
  });

  it("handles nested ANSI codes", () => {
    expect(stripAnsi("\x1b[1m\x1b[31mbold red\x1b[39m\x1b[22m")).toBe(
      "bold red",
    );
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("renderTable", () => {
  const basicColumns: TableColumn[] = [
    { header: "ID", key: "id" },
    { header: "Name", key: "name" },
    { header: "Status", key: "status" },
  ];

  beforeEach(() => {
    configureOutput({ noColor: true, quiet: false, json: false });
  });

  it("renders empty table with no rows", () => {
    const result = renderTable(basicColumns, []);
    const lines = result.split("\n");
    expect(lines.length).toBe(2); // header + separator
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Status");
  });

  it("returns empty string for no columns", () => {
    expect(renderTable([], [])).toBe("");
  });

  it("aligns columns correctly", () => {
    const rows = [
      { id: "001", name: "Short", status: "done" },
      { id: "002", name: "Longer name here", status: "pending" },
    ];
    const result = renderTable(basicColumns, rows);
    const lines = result.split("\n");
    expect(lines.length).toBe(4); // header + separator + 2 data rows

    // All lines should have consistent column positions
    // The separator line uses ─ characters
    expect(lines[1]).toMatch(/^[─\s]+$/);

    // Check alignment: first column (ID) should have consistent width
    // "ID" is 2 chars, "001" is 3 chars → column width is 3
    const headerParts = lines[0]!.split(/\s{2,}/);
    expect(headerParts[0]!.trim()).toBe("ID");
  });

  it("handles missing values gracefully", () => {
    const rows = [{ id: "001", name: "Test" }]; // missing 'status'
    const result = renderTable(basicColumns, rows);
    expect(result).toContain("001");
    expect(result).toContain("Test");
  });

  it("truncates long values when width specified", () => {
    const columns: TableColumn[] = [
      { header: "ID", key: "id" },
      { header: "Title", key: "title", width: 10 },
    ];
    const rows = [{ id: "001", title: "A very long title that exceeds width" }];
    const result = renderTable(columns, rows);
    // Should contain ellipsis for truncated value
    expect(result).toContain("\u2026");
  });

  it("supports right-aligned columns", () => {
    const columns: TableColumn[] = [
      { header: "Name", key: "name" },
      { header: "Count", key: "count", align: "right" },
    ];
    const rows = [
      { name: "foo", count: "5" },
      { name: "bar", count: "123" },
    ];
    const result = renderTable(columns, rows);
    const lines = result.split("\n");

    // In right-aligned columns, shorter values have leading spaces
    // Find the data line with "5" — it should have more leading space than "123"
    const line5 = lines.find((l) => l.includes("foo"))!;
    const line123 = lines.find((l) => l.includes("bar"))!;

    // The count column for "5" should be right-padded differently
    const countIdx5 = line5.lastIndexOf("5");
    const countIdx123 = line123.lastIndexOf("3");
    // Both should end at roughly the same position (right-aligned)
    expect(Math.abs(countIdx5 - countIdx123)).toBeLessThanOrEqual(1);
  });

  it("renders separator with correct widths", () => {
    const columns: TableColumn[] = [
      { header: "ID", key: "id" },
      { header: "Title", key: "title" },
    ];
    const rows = [{ id: "001", title: "Test" }];
    const result = renderTable(columns, rows);
    const lines = result.split("\n");
    const sep = lines[1]!;

    // Separator uses ─ (U+2500) characters
    expect(sep).toMatch(/─/);
    // Should not contain any alphabetic characters
    expect(sep).not.toMatch(/[a-zA-Z]/);
  });

  it("handles single column table", () => {
    const columns: TableColumn[] = [{ header: "Name", key: "name" }];
    const rows = [{ name: "alpha" }, { name: "beta" }];
    const result = renderTable(columns, rows);
    const lines = result.split("\n");
    expect(lines.length).toBe(4);
  });

  it("handles values with same length as header", () => {
    const columns: TableColumn[] = [{ header: "Status", key: "status" }];
    const rows = [{ status: "done" }, { status: "active" }];
    const result = renderTable(columns, rows);
    expect(result).toContain("done");
    expect(result).toContain("active");
    expect(result).toContain("Status");
  });
});

describe("detectColorSupport", () => {
  it("returns false when NO_COLOR env is set", () => {
    const prev = process.env["NO_COLOR"];
    process.env["NO_COLOR"] = "1";
    expect(detectColorSupport()).toBe(false);
    if (prev === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = prev;
    }
  });
});
