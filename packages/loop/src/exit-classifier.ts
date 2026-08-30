import type { ParsedSignal } from "./signal-parser.js";
import { matchesAnyPattern } from "./text-pattern-match.js";

/** Usage limit patterns detected in claude output (case-insensitive substring match). */
const USAGE_LIMIT_PATTERNS = [
  "usage limit",
  "rate limit",
  "claude ai usage limit",
  "too many requests",
  "session limit",
];

/**
 * Returns true when the given text contains any known usage-limit banner phrase.
 * Matching is case-insensitive substring matching.
 */
export function hasUsageLimitInText(text: string): boolean {
  return matchesAnyPattern(text, USAGE_LIMIT_PATTERNS);
}

/** Classification of a finished claude spawn. */
export type ExitClass =
  | "done"
  | "blocked"
  | "needs_human"
  | "usage_limited"
  | "timeout"
  | "infra_error"
  | "genuine_retry";

/**
 * A non-zero exit faster than this (with no usage-limit banner and no timeout)
 * is treated as an infrastructure error rather than a genuine work attempt.
 */
export const INFRA_FAST_MS = 10_000;

/** The finished-spawn shape consumed by {@link classifyExit}. */
export interface ExitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  reconstructedText?: string;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Classifies a finished claude spawn into an {@link ExitClass}.
 *
 * Precedence:
 * 1. An explicit done/blocked/needs_human signal wins outright.
 * 2. A usage-limit banner in the reconstructed stream (or stdout) or stderr →
 *    usage_limited. This is checked BEFORE timeout/infra so a fast usage-limit
 *    death is never mistaken for an infra error or genuine retry.
 * 3. timedOut → timeout.
 * 4. A fast (< INFRA_FAST_MS) non-zero exit → infra_error.
 * 5. Otherwise → genuine_retry.
 */
export function classifyExit(result: ExitResult, signal: ParsedSignal): ExitClass {
  if (signal.signal === "done") return "done";
  if (signal.signal === "blocked") return "blocked";
  if (signal.signal === "needs_human") return "needs_human";

  const signalText =
    result.reconstructedText && result.reconstructedText.length > 0
      ? result.reconstructedText
      : result.stdout;
  if (hasUsageLimitInText(signalText) || hasUsageLimitInText(result.stderr)) {
    return "usage_limited";
  }

  if (result.timedOut) return "timeout";

  if (result.exitCode !== 0 && result.durationMs < INFRA_FAST_MS) {
    return "infra_error";
  }

  return "genuine_retry";
}
