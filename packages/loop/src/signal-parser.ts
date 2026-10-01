import {
  ReviewPayloadSchema,
  SUMMARY_MARKER,
  sanitizeSummary,
  type ReviewPayload,
} from "@rauf/core";

/** Signal types that can be parsed from Claude's stdout */
export type SignalType = "done" | "blocked" | "needs_human" | "review" | "none";

/** Result of parsing Claude's stdout for exit signals */
export interface ParsedSignal {
  signal: SignalType;
  reason?: string;
  reviewPayload?: ReviewPayload;
  /**
   * The agent's optional one-line item summary (#153): a `RAUF_SUMMARY: <text>`
   * line that is the nearest non-blank line BEFORE a `RAUF_DONE`. Sanitized
   * (single line, no control chars, length-capped). Only ever set on `done`;
   * absent when the line is missing, misplaced, or empty once cleaned.
   */
  summary?: string;
}

/**
 * Scans Claude's stdout for exit signals, searching backwards from the end.
 *
 * Claude may output text after the signal (e.g., commit messages, summaries),
 * so we scan all lines from the end looking for the first signal match.
 *
 * Recognizes:
 * - RAUF_DONE → { signal: 'done' }
 * - RAUF_BLOCKED:<reason> → { signal: 'blocked', reason }
 * - RAUF_NEEDS_HUMAN:<reason> → { signal: 'needs_human', reason }
 * - RAUF_REVIEW:{json} → { signal: 'review', reviewPayload }
 *
 * A `done` signal also picks up an optional `RAUF_SUMMARY:<text>` from the
 * nearest non-blank line above it (see ParsedSignal.summary).
 *
 * Returns { signal: 'none' } if no recognized signal found.
 */
export function parseSignal(stdout: string): ParsedSignal {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;

    const result = matchSignal(trimmed);
    if (result) {
      if (result.signal === "done") {
        const summary = summaryAbove(lines, i);
        if (summary !== undefined) result.summary = summary;
      }
      return result;
    }
  }

  return { signal: "none" };
}

/**
 * The sanitized `RAUF_SUMMARY:` text on the nearest non-blank line above
 * `signalIndex`, or undefined. Strictly adjacent (blank lines aside), so a
 * summary quoted earlier in the transcript is never picked up.
 */
function summaryAbove(lines: string[], signalIndex: number): string | undefined {
  for (let j = signalIndex - 1; j >= 0; j--) {
    const trimmed = lines[j]!.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith(SUMMARY_MARKER)) return undefined;
    return sanitizeSummary(trimmed.slice(SUMMARY_MARKER.length));
  }
  return undefined;
}

function matchSignal(line: string): ParsedSignal | null {
  if (line === "RAUF_DONE") {
    return { signal: "done" };
  }

  if (line.startsWith("RAUF_BLOCKED:")) {
    const reason = line.slice("RAUF_BLOCKED:".length);
    return { signal: "blocked", reason };
  }

  if (line.startsWith("RAUF_NEEDS_HUMAN:")) {
    const reason = line.slice("RAUF_NEEDS_HUMAN:".length);
    return { signal: "needs_human", reason };
  }

  if (line.startsWith("RAUF_REVIEW:")) {
    const jsonStr = line.slice("RAUF_REVIEW:".length);
    try {
      const parsed = JSON.parse(jsonStr);
      const result = ReviewPayloadSchema.safeParse(parsed);
      if (result.success) {
        return { signal: "review", reviewPayload: result.data };
      }
    } catch {
      // Malformed JSON — not a valid review signal
    }
  }

  return null;
}
