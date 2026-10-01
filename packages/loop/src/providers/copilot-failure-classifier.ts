import { INFRA_FAST_MS, type ExitResult } from "../exit-classifier.js";
import type { ProviderFailureClassification } from "./types.js";

export type CopilotFailureKind =
  | "authentication"
  | "invalid_model"
  | "permission_denied"
  | "limit_exhausted"
  | "timeout"
  | "infrastructure"
  | "malformed_output"
  | "missing_signal";

export interface CopilotFailureClassification extends ProviderFailureClassification {
  kind: CopilotFailureKind;
}

const AUTH_PATTERNS = [
  /not authenticated/i,
  /not logged in/i,
  /authentication (?:is )?required/i,
  /authenticate with github/i,
  /login (?:is )?required/i,
  /please (?:sign|log) in/i,
];
const INVALID_MODEL_PATTERNS = [
  /invalid model/i,
  /model .+ (?:is not available|is not supported|not found|unsupported)/i,
  /unknown model/i,
];
const PERMISSION_PATTERNS = [
  /permission denied/i,
  /permission_denied/i,
  /"code"\s*:\s*"denied"/i,
  /(?:tool|request|operation) (?:was )?denied/i,
  /not permitted/i,
];
const LIMIT_PATTERNS = [
  /(?:usage|rate|session|credit) limit/i,
  /credits? (?:are )?(?:exhausted|depleted)/i,
  /quota (?:is )?(?:exceeded|exhausted)/i,
  /too many requests/i,
];

export function classifyCopilotFailure(result: ExitResult): CopilotFailureClassification {
  if (result.timedOut) return { kind: "timeout", exitClass: "timeout" };

  // Only Copilot's OWN diagnostics are evidence of an infrastructure failure: its
  // stderr when it exits non-zero, and its in-band error records. Tool output
  // (`tool.execution_*` results) and assistant text are the agent's work — a test that
  // prints "Permission denied" or a grep hitting "rate limit" must not turn a
  // no-signal run into infra_error and trip the circuit breaker.
  const diagnostics = [
    ...(result.exitCode !== 0 && result.stderr ? [result.stderr] : []),
    ...copilotErrorRecords(result.stdout),
  ].join("\n");

  if (matchesAny(diagnostics, AUTH_PATTERNS)) {
    return { kind: "authentication", exitClass: "infra_error" };
  }
  if (matchesAny(diagnostics, INVALID_MODEL_PATTERNS)) {
    return { kind: "invalid_model", exitClass: "infra_error" };
  }
  if (matchesAny(diagnostics, PERMISSION_PATTERNS)) {
    return { kind: "permission_denied", exitClass: "infra_error" };
  }
  if (matchesAny(diagnostics, LIMIT_PATTERNS)) {
    return { kind: "limit_exhausted", exitClass: "infra_error" };
  }
  if (hasMalformedJsonl(result.stdout)) {
    return { kind: "malformed_output", exitClass: "genuine_retry" };
  }
  // Same fast-death rule as the shared classifyExit: only a quick non-zero exit is
  // environmental; a long attempt that dies without a signal is a genuine retry.
  if (result.exitCode !== 0 && result.durationMs < INFRA_FAST_MS) {
    return { kind: "infrastructure", exitClass: "infra_error" };
  }
  return { kind: "missing_signal", exitClass: "genuine_retry" };
}

/** Raw JSONL lines of Copilot's own error records (`error` / `*.error`, or a top-level `error`). */
function copilotErrorRecords(stdout: string): string[] {
  const records: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof record !== "object" || record === null) continue;
    const { type, error } = record as { type?: unknown; error?: unknown };
    const isErrorType = typeof type === "string" && (type === "error" || type.endsWith(".error"));
    if (isErrorType || (type === undefined && error !== undefined)) records.push(trimmed);
  }
  return records;
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasMalformedJsonl(stdout: string): boolean {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  return (
    lines.length > 0 &&
    lines.every((line) => {
      try {
        JSON.parse(line);
        return false;
      } catch {
        return true;
      }
    })
  );
}
