import { describe, it, expect } from "vitest";
import { redactSignalTokens } from "./signal-redactor.js";

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
