import type { ExitResult } from "../exit-classifier.js";
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

  const output = [result.reconstructedText, result.stdout, result.stderr]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  if (matchesAny(output, AUTH_PATTERNS)) {
    return { kind: "authentication", exitClass: "infra_error" };
  }
  if (matchesAny(output, INVALID_MODEL_PATTERNS)) {
    return { kind: "invalid_model", exitClass: "infra_error" };
  }
  if (matchesAny(output, PERMISSION_PATTERNS)) {
    return { kind: "permission_denied", exitClass: "infra_error" };
  }
  if (matchesAny(output, LIMIT_PATTERNS)) {
    return { kind: "limit_exhausted", exitClass: "infra_error" };
  }
  if (hasMalformedJsonl(result.stdout)) {
    return { kind: "malformed_output", exitClass: "genuine_retry" };
  }
  if (result.exitCode !== 0) {
    return { kind: "infrastructure", exitClass: "infra_error" };
  }
  return { kind: "missing_signal", exitClass: "genuine_retry" };
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
