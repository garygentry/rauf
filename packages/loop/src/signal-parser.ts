/** Signal types that can be parsed from Claude's stdout */
export type SignalType = "done" | "blocked" | "needs_human" | "none";

/** Result of parsing Claude's stdout for exit signals */
export interface ParsedSignal {
  signal: SignalType;
  reason?: string;
}

/**
 * Scans Claude's stdout for exit signals on the last non-empty line.
 *
 * Recognizes:
 * - RALPH_DONE → { signal: 'done' }
 * - RALPH_BLOCKED:<reason> → { signal: 'blocked', reason }
 * - RALPH_NEEDS_HUMAN:<reason> → { signal: 'needs_human', reason }
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
