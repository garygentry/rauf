const SIGNAL_TOKENS = ["RAUF_DONE", "RAUF_BLOCKED", "RAUF_NEEDS_HUMAN", "RAUF_REVIEW"] as const;

/** Replace literal RAUF_* terminal tokens with a visually similar but non-matchable form. */
export function redactSignalTokens(text: string): string {
  let result = text;
  for (const token of SIGNAL_TOKENS) {
    result = result.replaceAll(token, token.replace("_", "·"));
  }
  return result;
}

/**
 * Neutralize RAUF_* signal tokens that appear inline (sharing a line with other
 * text) so they cannot be mis-parsed as a real completion signal, while leaving a
 * genuine standalone final-line signal intact.
 *
 * parseSignal matches whole-line signals (the trimmed line is exactly a token, or
 * starts with `<token>:`), so line-awareness is the correct discriminator: a token
 * sharing its line with other text is never a real signal and is defused; a line
 * whose trimmed content IS the signal is preserved untouched.
 */
export function neutralizeForDetection(text: string): string {
  let fence: { marker: "`" | "~"; length: number } | undefined;

  return text
    .split("\n")
    .map((line) => {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      const insideFence = fence !== undefined;
      if (fenceMatch) {
        const markerRun = fenceMatch[1]!;
        const marker = markerRun[0] as "`" | "~";
        if (!fence) {
          fence = { marker, length: markerRun.length };
        } else if (
          marker === fence.marker &&
          markerRun.length >= fence.length &&
          line.slice(fenceMatch[0].length).trim().length === 0
        ) {
          fence = undefined;
        }
      }

      const trimmed = line.trim();
      const isSignalLine = SIGNAL_TOKENS.some(
        (token) => trimmed === token || trimmed.startsWith(`${token}:`),
      );
      if (!insideFence && !fenceMatch && isSignalLine) return line;

      let result = line;
      for (const token of SIGNAL_TOKENS) {
        result = result.replaceAll(token, token.replace("_", "·"));
      }
      return result;
    })
    .join("\n");
}
