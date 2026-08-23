import { describe, it, expect } from "vitest";
import { redactSignalTokens, neutralizeForDetection } from "./signal-redactor.js";
import { parseSignal } from "./signal-parser.js";

describe("redactSignalTokens", () => {
  it("redacts RAUF_DONE so the literal token is no longer present", () => {
    const input = "The agent said RAUF_DONE as part of its reasoning.";
    const result = redactSignalTokens(input);
    expect(result).not.toContain("RAUF_DONE");
    expect(result).toContain("RAUF·DONE");
  });

  it("redacts RAUF_BLOCKED", () => {
    const input = "Mentioned RAUF_BLOCKED in prose.";
    const result = redactSignalTokens(input);
    expect(result).not.toContain("RAUF_BLOCKED");
    expect(result).toContain("RAUF·BLOCKED");
  });

  it("redacts RAUF_NEEDS_HUMAN", () => {
    const input = "The text says RAUF_NEEDS_HUMAN somewhere.";
    const result = redactSignalTokens(input);
    expect(result).not.toContain("RAUF_NEEDS_HUMAN");
    expect(result).toContain("RAUF·NEEDS_HUMAN");
  });

  it("redacts all three tokens when they appear together", () => {
    const input = "RAUF_DONE RAUF_BLOCKED RAUF_NEEDS_HUMAN in one line";
    const result = redactSignalTokens(input);
    expect(result).not.toMatch(/RAUF_DONE|RAUF_BLOCKED|RAUF_NEEDS_HUMAN/);
    expect(result).toContain("RAUF·DONE");
    expect(result).toContain("RAUF·BLOCKED");
    expect(result).toContain("RAUF·NEEDS_HUMAN");
  });

  it("redacts multiple occurrences of the same token", () => {
    const input = "RAUF_DONE and also RAUF_DONE again";
    const result = redactSignalTokens(input);
    expect(result).not.toContain("RAUF_DONE");
  });

  it("leaves text without tokens unchanged", () => {
    const input = "No terminal tokens here, just prose.";
    expect(redactSignalTokens(input)).toBe(input);
  });

  it("preserves surrounding text while redacting the token", () => {
    const input = "prefix RAUF_DONE suffix";
    const result = redactSignalTokens(input);
    expect(result).toBe("prefix RAUF·DONE suffix");
  });
});

describe("neutralizeForDetection", () => {
  it("neutralizes an inline token so parseSignal returns 'none'", () => {
    const input = "prefix RAUF_DONE suffix";
    const result = neutralizeForDetection(input);
    expect(result).not.toContain("RAUF_DONE");
    expect(parseSignal(result).signal).toBe("none");
  });

  it("neutralizes a quoted token in a comment so parseSignal returns 'none'", () => {
    const input = '// the agent printed "RAUF_DONE" in a comment';
    const result = neutralizeForDetection(input);
    expect(result).not.toContain("RAUF_DONE");
    expect(parseSignal(result).signal).toBe("none");
  });

  it("neutralizes standalone tokens inside fenced quoted prose", () => {
    const input = ["Example output:", "```text", "RAUF_DONE", "```"].join("\n");
    const result = neutralizeForDetection(input);

    expect(result).not.toContain("RAUF_DONE");
    expect(parseSignal(result)).toEqual({ signal: "none" });
  });

  it("preserves a genuine signal after fenced quoted prose closes", () => {
    const input = ["```text", "RAUF_BLOCKED:example", "```", "RAUF_DONE"].join("\n");
    const result = neutralizeForDetection(input);

    expect(result).not.toContain("RAUF_BLOCKED");
    expect(parseSignal(result)).toEqual({ signal: "done" });
  });

  it("does not treat a marker with trailing text as a closing fence", () => {
    const input = ["```text", "```not closed", "RAUF_DONE", "```"].join("\n");
    const result = neutralizeForDetection(input);

    expect(result).not.toContain("RAUF_DONE");
    expect(parseSignal(result)).toEqual({ signal: "none" });
  });

  it("preserves a standalone final-line RAUF_DONE", () => {
    const input = "did the work\nRAUF_DONE";
    const result = neutralizeForDetection(input);
    expect(parseSignal(result).signal).toBe("done");
  });

  it("preserves a standalone final-line RAUF_BLOCKED:reason", () => {
    const input = "could not proceed\nRAUF_BLOCKED:missing dependency";
    const result = neutralizeForDetection(input);
    const parsed = parseSignal(result);
    expect(parsed.signal).toBe("blocked");
    expect(parsed.reason).toBe("missing dependency");
  });

  it("preserves a standalone final-line RAUF_NEEDS_HUMAN:reason", () => {
    const input = "need a key\nRAUF_NEEDS_HUMAN:need an API key";
    const result = neutralizeForDetection(input);
    const parsed = parseSignal(result);
    expect(parsed.signal).toBe("needs_human");
    expect(parsed.reason).toBe("need an API key");
  });

  it("preserves a standalone final-line RAUF_REVIEW:{json}", () => {
    const payload = JSON.stringify({
      items: [
        { type: "bug", priority: 2, title: "Fix", description: "d", acceptanceCriteria: ["ac"] },
      ],
      summary: "1 issue",
    });
    const input = `review done\nRAUF_REVIEW:${payload}`;
    const result = neutralizeForDetection(input);
    expect(parseSignal(result).signal).toBe("review");
  });

  it("neutralizes an inline RAUF_REVIEW (proves the token set widened)", () => {
    const input = "the agent mentioned RAUF_REVIEW in its prose";
    const result = neutralizeForDetection(input);
    expect(result).not.toContain("RAUF_REVIEW");
    expect(parseSignal(result).signal).toBe("none");
  });

  it("neutralizes multiple inline tokens on one line", () => {
    const input = "saw RAUF_DONE and RAUF_BLOCKED and RAUF_REVIEW inline";
    const result = neutralizeForDetection(input);
    expect(result).not.toMatch(/RAUF_DONE|RAUF_BLOCKED|RAUF_REVIEW/);
    expect(parseSignal(result).signal).toBe("none");
  });

  it("neutralizes inline occurrences while preserving the genuine final-line signal", () => {
    const input = "I will print RAUF_DONE when finished\nRAUF_DONE";
    const result = neutralizeForDetection(input);
    const lines = result.split("\n");
    expect(lines[0]).not.toContain("RAUF_DONE");
    expect(lines[1]).toBe("RAUF_DONE");
    expect(parseSignal(result).signal).toBe("done");
  });

  it("preserves the last valid signal when earlier signal lines are present", () => {
    const input = ["RAUF_BLOCKED:earlier outcome", "work continued", "RAUF_DONE"].join("\n");
    const result = neutralizeForDetection(input);

    expect(parseSignal(result)).toEqual({ signal: "done" });
  });

  it("leaves text without tokens unchanged", () => {
    const input = "no tokens here\njust prose";
    expect(neutralizeForDetection(input)).toBe(input);
  });
});
