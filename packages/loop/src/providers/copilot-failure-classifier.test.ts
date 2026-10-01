import { describe, expect, it } from "vitest";

import type { ExitResult } from "../exit-classifier.js";
import { classifyCopilotFailure } from "./copilot-failure-classifier.js";

function makeResult(overrides: Partial<ExitResult> = {}): ExitResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1_000,
    ...overrides,
  };
}

describe("classifyCopilotFailure", () => {
  it.each([
    ["authentication", { stderr: "You are not logged in. Please sign in.", exitCode: 1 }],
    ["invalid_model", { stderr: "Model nonexistent is not supported", exitCode: 1 }],
    ["permission_denied", { stdout: '{"error":{"code":"denied"}}' }],
    ["limit_exhausted", { stderr: "Credit limit exhausted", exitCode: 1 }],
    ["infrastructure", { stderr: "socket closed", exitCode: 1 }],
  ] as const)("maps %s failures to the existing infra outcome", (kind, overrides) => {
    expect(classifyCopilotFailure(makeResult(overrides))).toEqual({
      kind,
      exitClass: "infra_error",
    });
  });

  it.each([
    [
      "tool output",
      '{"type":"tool.execution_complete","data":{"toolCallId":"1","result":{"content":"ls: /root: Permission denied"}}}',
    ],
    [
      "assistant text",
      '{"type":"assistant.message","data":{"content":"The API returned a rate limit error."}}',
    ],
  ])("ignores failure phrases in %s (agent work, not Copilot diagnostics)", (_label, line) => {
    expect(classifyCopilotFailure(makeResult({ stdout: `${line}\n` }))).toEqual({
      kind: "missing_signal",
      exitClass: "genuine_retry",
    });
  });

  it("ignores stderr warnings when Copilot exits 0", () => {
    expect(
      classifyCopilotFailure(makeResult({ stderr: "warning: rate limit approaching" })),
    ).toEqual({
      kind: "missing_signal",
      exitClass: "genuine_retry",
    });
  });

  it("treats a long non-zero exit without diagnostics as a genuine retry", () => {
    expect(
      classifyCopilotFailure(
        makeResult({ stderr: "socket closed", exitCode: 1, durationMs: 20 * 60_000 }),
      ),
    ).toEqual({ kind: "missing_signal", exitClass: "genuine_retry" });
  });

  it("maps timeout to the existing timeout outcome before inspecting diagnostics", () => {
    expect(
      classifyCopilotFailure(
        makeResult({ timedOut: true, stderr: "Authentication required", exitCode: 1 }),
      ),
    ).toEqual({ kind: "timeout", exitClass: "timeout" });
  });

  it("maps malformed-only JSONL to retry/defer", () => {
    expect(
      classifyCopilotFailure(makeResult({ stdout: "not-json\n{broken", exitCode: 1 })),
    ).toEqual({
      kind: "malformed_output",
      exitClass: "genuine_retry",
    });
  });

  it("maps valid JSONL without a completion signal to retry/defer", () => {
    expect(classifyCopilotFailure(makeResult({ stdout: '{"type":"session.start"}\n' }))).toEqual({
      kind: "missing_signal",
      exitClass: "genuine_retry",
    });
  });
});
