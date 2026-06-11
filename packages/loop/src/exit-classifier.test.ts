import { describe, it, expect } from "vitest";
import {
  classifyExit,
  hasUsageLimitInText,
  INFRA_FAST_MS,
  type ExitResult,
} from "./exit-classifier.js";
import type { ParsedSignal } from "./signal-parser.js";

/** The session-limit banner from the source incident. */
const INCIDENT_BANNER = "You've hit your session limit · resets 5:30pm";

const NONE: ParsedSignal = { signal: "none" };

/** Build an ExitResult with sensible defaults overridden per-test. */
function makeResult(overrides: Partial<ExitResult> = {}): ExitResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 60_000,
    ...overrides,
  };
}

describe("hasUsageLimitInText", () => {
  it("matches known patterns case-insensitively", () => {
    expect(hasUsageLimitInText("Claude AI usage limit reached")).toBe(true);
    expect(hasUsageLimitInText("RATE LIMIT exceeded")).toBe(true);
    expect(hasUsageLimitInText("HTTP 429: too many requests")).toBe(true);
    expect(hasUsageLimitInText(INCIDENT_BANNER)).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(hasUsageLimitInText("")).toBe(false);
    expect(hasUsageLimitInText("everything is fine")).toBe(false);
  });
});

describe("classifyExit", () => {
  it("returns the explicit signal class for done/blocked/needs_human", () => {
    expect(classifyExit(makeResult(), { signal: "done" })).toBe("done");
    expect(classifyExit(makeResult(), { signal: "blocked", reason: "x" })).toBe("blocked");
    expect(classifyExit(makeResult(), { signal: "needs_human", reason: "y" })).toBe("needs_human");
  });

  it("prefers an explicit signal even when a usage banner is present", () => {
    const result = makeResult({ reconstructedText: INCIDENT_BANNER, exitCode: 1 });
    expect(classifyExit(result, { signal: "done" })).toBe("done");
  });

  it("classifies a banner in stderr as usage_limited", () => {
    const result = makeResult({ stderr: "Claude AI usage limit", exitCode: 1 });
    expect(classifyExit(result, NONE)).toBe("usage_limited");
  });

  it("classifies a banner in stdout as usage_limited", () => {
    const result = makeResult({ stdout: "rate limit hit", exitCode: 1 });
    expect(classifyExit(result, NONE)).toBe("usage_limited");
  });

  it("classifies the incident banner present ONLY in reconstructedText as usage_limited (not genuine_retry)", () => {
    // Fast non-zero exit with the banner only in the reconstructed stream —
    // without scanning reconstructedText this would fall through to infra_error.
    const result = makeResult({
      reconstructedText: INCIDENT_BANNER,
      stdout: "",
      stderr: "",
      exitCode: 1,
      durationMs: 800,
    });
    expect(classifyExit(result, NONE)).toBe("usage_limited");
  });

  it("classifies a usage banner ahead of a timeout", () => {
    const result = makeResult({
      reconstructedText: INCIDENT_BANNER,
      timedOut: true,
    });
    expect(classifyExit(result, NONE)).toBe("usage_limited");
  });

  it("classifies a timed-out run as timeout", () => {
    const result = makeResult({ timedOut: true, exitCode: 1 });
    expect(classifyExit(result, NONE)).toBe("timeout");
  });

  it("classifies a fast non-zero exit with no banner as infra_error", () => {
    const result = makeResult({ exitCode: 1, durationMs: INFRA_FAST_MS - 1 });
    expect(classifyExit(result, NONE)).toBe("infra_error");
  });

  it("classifies a slow non-zero exit with no banner as genuine_retry", () => {
    const result = makeResult({ exitCode: 1, durationMs: INFRA_FAST_MS + 1 });
    expect(classifyExit(result, NONE)).toBe("genuine_retry");
  });

  it("classifies a clean long-running no-signal exit as genuine_retry", () => {
    const result = makeResult({ exitCode: 0, durationMs: 120_000 });
    expect(classifyExit(result, NONE)).toBe("genuine_retry");
  });

  it("treats a review signal as no explicit class (falls through to genuine_retry)", () => {
    const result = makeResult({ exitCode: 0 });
    expect(classifyExit(result, { signal: "review" })).toBe("genuine_retry");
  });
});

describe("INFRA_FAST_MS", () => {
  it("is exported as 10_000", () => {
    expect(INFRA_FAST_MS).toBe(10_000);
  });
});
