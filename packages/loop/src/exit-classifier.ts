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

/**
 * Phrases that betray the "backgrounded verification, then yielded the turn to
 * await an async completion notification" failure mode (#125): the agent
 * finishes an item's work but defers its RAUF_* signal behind a notification
 * that never arrives in non-interactive (`-p`) mode, so the session exits
 * cleanly with no signal and the whole item is retried.
 *
 * This is a best-effort heuristic, NOT a classifier: it only annotates an
 * already-no-signal genuine_retry log line and never changes retry behavior, so
 * a miss or an occasional over-match is cheap. The phrases are deliberately
 * specific to the "defer the signal behind async test completion" action (not
 * generic tokens like "in the background", which would false-positive on
 * unrelated output — and note substring matching cannot exclude a negation).
 */
const DEFERRED_SIGNAL_PATTERNS = [
  "completion notification",
  "wait for the completion",
  "waiting for the completion",
  "await the completion",
  "wait for that completion",
  "notification of the test",
  "tests in the background",
  "test suite in the background",
  "before giving the final signal",
  "before emitting the final signal",
  "wait for the test suite",
  "waiting on the e2e",
];

/**
 * Returns true when the given text looks like the agent deferred its exit signal
 * behind a backgrounded command or an async completion notification (#125).
 * Case-insensitive substring matching.
 */
export function hasDeferredSignalSignature(text: string): boolean {
  return matchesAnyPattern(text, DEFERRED_SIGNAL_PATTERNS);
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
