import { describe, expect, it } from "vitest";

import { parseSignal } from "./signal-parser.js";

describe("parseSignal", () => {
  describe("RALPH_DONE", () => {
    it("returns done when RALPH_DONE is the only line", () => {
      expect(parseSignal("RALPH_DONE")).toEqual({ signal: "done" });
    });

    it("returns done when RALPH_DONE is the last non-empty line", () => {
      const stdout = "Some output\nMore output\nRALPH_DONE\n";
      expect(parseSignal(stdout)).toEqual({ signal: "done" });
    });

    it("returns done when RALPH_DONE is followed by whitespace lines", () => {
      const stdout = "Output here\nRALPH_DONE\n  \n\n";
      expect(parseSignal(stdout)).toEqual({ signal: "done" });
    });
  });

  describe("RALPH_BLOCKED", () => {
    it("returns blocked with reason", () => {
      expect(parseSignal("RALPH_BLOCKED:missing dependency")).toEqual({
        signal: "blocked",
        reason: "missing dependency",
      });
    });

    it("returns blocked when on last non-empty line of multi-line output", () => {
      const stdout = "Working on task...\nDid some stuff\nRALPH_BLOCKED:unclear requirement\n";
      expect(parseSignal(stdout)).toEqual({
        signal: "blocked",
        reason: "unclear requirement",
      });
    });

    it("returns blocked with empty reason when colon has no text after it", () => {
      expect(parseSignal("RALPH_BLOCKED:")).toEqual({
        signal: "blocked",
        reason: "",
      });
    });

    it("preserves colons in reason text", () => {
      expect(parseSignal("RALPH_BLOCKED:error: file not found: foo.ts")).toEqual({
        signal: "blocked",
        reason: "error: file not found: foo.ts",
      });
    });
  });

  describe("RALPH_NEEDS_HUMAN", () => {
    it("returns needs_human with reason", () => {
      expect(parseSignal("RALPH_NEEDS_HUMAN:need API key")).toEqual({
        signal: "needs_human",
        reason: "need API key",
      });
    });

    it("returns needs_human when on last non-empty line", () => {
      const stdout = "Some work done\nRALPH_NEEDS_HUMAN:design decision needed\n";
      expect(parseSignal(stdout)).toEqual({
        signal: "needs_human",
        reason: "design decision needed",
      });
    });

    it("returns needs_human with empty reason", () => {
      expect(parseSignal("RALPH_NEEDS_HUMAN:")).toEqual({
        signal: "needs_human",
        reason: "",
      });
    });

    it("preserves colons in reason text", () => {
      expect(parseSignal("RALPH_NEEDS_HUMAN:choose: option A or option B")).toEqual({
        signal: "needs_human",
        reason: "choose: option A or option B",
      });
    });
  });

  describe("no signal (none)", () => {
    it("returns none for empty string", () => {
      expect(parseSignal("")).toEqual({ signal: "none" });
    });

    it("returns none for whitespace-only input", () => {
      expect(parseSignal("   \n  \n\n  ")).toEqual({ signal: "none" });
    });

    it("returns none when no recognized signal on last line", () => {
      expect(parseSignal("Task completed successfully")).toEqual({
        signal: "none",
      });
    });

    it("returns none for multi-line output without signal", () => {
      const stdout = "Line 1\nLine 2\nLine 3\n";
      expect(parseSignal(stdout)).toEqual({ signal: "none" });
    });

    it("returns done when RALPH_DONE is followed by non-signal text", () => {
      const stdout = "RALPH_DONE\nSome other output after";
      expect(parseSignal(stdout)).toEqual({ signal: "done" });
    });

    it("returns none for partial signal match", () => {
      expect(parseSignal("RALPH_DON")).toEqual({ signal: "none" });
    });

    it("returns none for RALPH_DONE with extra text (not a signal)", () => {
      expect(parseSignal("RALPH_DONE extra text")).toEqual({ signal: "none" });
    });
  });

  describe("RALPH_REVIEW", () => {
    it("returns review with valid JSON payload", () => {
      const payload = JSON.stringify({
        items: [
          {
            type: "bug",
            priority: 2,
            title: "Fix: missing validation",
            description: "The input is not validated",
            acceptanceCriteria: ["Input validation added"],
          },
        ],
        summary: "Found 1 issue",
      });
      const result = parseSignal(`RALPH_REVIEW:${payload}`);
      expect(result.signal).toBe("review");
      expect(result.reviewPayload).toBeDefined();
      expect(result.reviewPayload!.items).toHaveLength(1);
      expect(result.reviewPayload!.items[0]!.title).toBe("Fix: missing validation");
      expect(result.reviewPayload!.summary).toBe("Found 1 issue");
    });

    it("returns review with multiple items", () => {
      const payload = JSON.stringify({
        items: [
          {
            type: "bug",
            priority: 1,
            title: "Fix A",
            description: "Desc A",
            acceptanceCriteria: ["AC A"],
          },
          {
            type: "chore",
            priority: 3,
            title: "Fix B",
            description: "Desc B",
            acceptanceCriteria: ["AC B"],
          },
        ],
        summary: "Found 2 issues",
      });
      const result = parseSignal(`RALPH_REVIEW:${payload}`);
      expect(result.signal).toBe("review");
      expect(result.reviewPayload!.items).toHaveLength(2);
    });

    it("returns none for malformed JSON", () => {
      expect(parseSignal("RALPH_REVIEW:{invalid json}")).toEqual({ signal: "none" });
    });

    it("returns none for valid JSON but invalid schema (missing required fields)", () => {
      const payload = JSON.stringify({ items: [], summary: "empty" });
      // items must have at least 1 item
      expect(parseSignal(`RALPH_REVIEW:${payload}`)).toEqual({ signal: "none" });
    });

    it("returns none for valid JSON but missing summary", () => {
      const payload = JSON.stringify({
        items: [
          { type: "bug", priority: 2, title: "Fix", description: "d", acceptanceCriteria: ["ac"] },
        ],
      });
      expect(parseSignal(`RALPH_REVIEW:${payload}`)).toEqual({ signal: "none" });
    });

    it("returns none for empty items array", () => {
      const payload = JSON.stringify({ items: [], summary: "none" });
      expect(parseSignal(`RALPH_REVIEW:${payload}`)).toEqual({ signal: "none" });
    });

    it("returns review when on last non-empty line of multi-line output", () => {
      const payload = JSON.stringify({
        items: [
          { type: "bug", priority: 2, title: "Fix", description: "d", acceptanceCriteria: ["ac"] },
        ],
        summary: "1 issue",
      });
      const stdout = `Some review output\nAnalyzing...\nRALPH_REVIEW:${payload}\n`;
      const result = parseSignal(stdout);
      expect(result.signal).toBe("review");
      expect(result.reviewPayload!.items).toHaveLength(1);
    });
  });

  describe("signal followed by trailing text (multi-turn)", () => {
    it("finds RALPH_DONE when followed by commit message", () => {
      const stdout = [
        "Reading backlog...",
        "Implementing changes...",
        "All verification passes.",
        "",
        "RALPH_DONE",
        "",
        "Committed as [ralph] 001: Scaffold packages/ai",
      ].join("\n");
      expect(parseSignal(stdout)).toEqual({ signal: "done" });
    });

    it("finds RALPH_BLOCKED when followed by summary text", () => {
      const stdout = [
        "Analyzing task...",
        "RALPH_BLOCKED:missing API key configuration",
        "I was unable to complete the task because the API key is not set.",
      ].join("\n");
      expect(parseSignal(stdout)).toEqual({
        signal: "blocked",
        reason: "missing API key configuration",
      });
    });

    it("finds RALPH_NEEDS_HUMAN when followed by explanation", () => {
      const stdout = [
        "Found the issue.",
        "RALPH_NEEDS_HUMAN:design decision needed",
        "Please decide between option A and option B.",
      ].join("\n");
      expect(parseSignal(stdout)).toEqual({
        signal: "needs_human",
        reason: "design decision needed",
      });
    });

    it("finds signal among many trailing lines", () => {
      const stdout = [
        "Working...",
        "RALPH_DONE",
        "Successfully committed.",
        "Updated progress.md",
        "Cleaning up temporary files.",
        "",
      ].join("\n");
      expect(parseSignal(stdout)).toEqual({ signal: "done" });
    });
  });

  describe("edge cases", () => {
    it("handles signal with leading/trailing whitespace on the line", () => {
      expect(parseSignal("  RALPH_DONE  ")).toEqual({ signal: "done" });
    });

    it("handles Windows-style line endings", () => {
      const stdout = "Output\r\nRALPH_DONE\r\n";
      expect(parseSignal(stdout)).toEqual({ signal: "done" });
    });

    it("handles very long output with signal at end", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      lines.push("RALPH_BLOCKED:too many errors");
      lines.push("");
      expect(parseSignal(lines.join("\n"))).toEqual({
        signal: "blocked",
        reason: "too many errors",
      });
    });
  });
});
