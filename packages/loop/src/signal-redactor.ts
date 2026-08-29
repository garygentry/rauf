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
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const isSignalLine = SIGNAL_TOKENS.some(
        (token) => trimmed === token || trimmed.startsWith(`${token}:`),
      );
      if (isSignalLine) return line;

      let result = line;
      for (const token of SIGNAL_TOKENS) {
        result = result.replaceAll(token, token.replace("_", "·"));
      }
      return result;
    })
    .join("\n");
}
