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
 * Scans Claude's stdout for exit signals on the last non-empty line.
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
  const lastLine = getLastNonEmptyLine(stdout);
  if (!lastLine) {
    return { signal: "none" };
  }

  if (lastLine === "RALPH_DONE") {
    return { signal: "done" };
  }

  if (lastLine.startsWith("RALPH_BLOCKED:")) {
    const reason = lastLine.slice("RALPH_BLOCKED:".length);
    return { signal: "blocked", reason };
  }

  if (lastLine.startsWith("RALPH_NEEDS_HUMAN:")) {
    const reason = lastLine.slice("RALPH_NEEDS_HUMAN:".length);
    return { signal: "needs_human", reason };
  }

  if (lastLine.startsWith("RALPH_REVIEW:")) {
    const jsonStr = lastLine.slice("RALPH_REVIEW:".length);
    try {
      const parsed = JSON.parse(jsonStr);
      const result = ReviewPayloadSchema.safeParse(parsed);
      if (result.success) {
        return { signal: "review", reviewPayload: result.data };
      }
    } catch {
      // Malformed JSON — fall through to none
    }
    return { signal: "none" };
  }

  return { signal: "none" };
}

function getLastNonEmptyLine(text: string): string | undefined {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}
