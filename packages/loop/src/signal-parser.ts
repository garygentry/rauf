import { ReviewPayloadSchema, type ReviewPayload } from "@ralph/core";

/** Signal types that can be parsed from Claude's stdout */
export type SignalType = "done" | "blocked" | "needs_human" | "review" | "none";

/** Result of parsing Claude's stdout for exit signals */
export interface ParsedSignal {
  signal: SignalType;
  reason?: string;
  reviewPayload?: ReviewPayload;
}

/**
 * Scans Claude's stdout for exit signals, searching backwards from the end.
 *
 * Claude may output text after the signal (e.g., commit messages, summaries),
 * so we scan all lines from the end looking for the first signal match.
 *
 * Recognizes:
 * - RALPH_DONE → { signal: 'done' }
 * - RALPH_BLOCKED:<reason> → { signal: 'blocked', reason }
 * - RALPH_NEEDS_HUMAN:<reason> → { signal: 'needs_human', reason }
 * - RALPH_REVIEW:{json} → { signal: 'review', reviewPayload }
 *
 * Returns { signal: 'none' } if no recognized signal found.
 */
export function parseSignal(stdout: string): ParsedSignal {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;

    const result = matchSignal(trimmed);
    if (result) return result;
  }

  return { signal: "none" };
}

function matchSignal(line: string): ParsedSignal | null {
  if (line === "RALPH_DONE") {
    return { signal: "done" };
  }

  if (line.startsWith("RALPH_BLOCKED:")) {
    const reason = line.slice("RALPH_BLOCKED:".length);
    return { signal: "blocked", reason };
  }

  if (line.startsWith("RALPH_NEEDS_HUMAN:")) {
    const reason = line.slice("RALPH_NEEDS_HUMAN:".length);
    return { signal: "needs_human", reason };
  }

  if (line.startsWith("RALPH_REVIEW:")) {
    const jsonStr = line.slice("RALPH_REVIEW:".length);
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
