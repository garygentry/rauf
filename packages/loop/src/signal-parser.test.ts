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

    it("returns none when signal-like text is not on last line", () => {
      const stdout = "RALPH_DONE\nSome other output after";
      expect(parseSignal(stdout)).toEqual({ signal: "none" });
    });

    it("returns none for partial signal match", () => {
      expect(parseSignal("RALPH_DON")).toEqual({ signal: "none" });
    });

    it("returns none for RALPH_DONE with extra text (not a signal)", () => {
      expect(parseSignal("RALPH_DONE extra text")).toEqual({ signal: "none" });
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
