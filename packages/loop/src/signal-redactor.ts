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
  const lines = text.split("\n");
  const fenced = closedFenceLines(lines);

  return lines
    .map((line, index) => {
      const trimmed = line.trim();
      const isSignalLine = SIGNAL_TOKENS.some(
        (token) => trimmed === token || trimmed.startsWith(`${token}:`),
      );
      if (!fenced.has(index) && isSignalLine) return line;

      let result = line;
      for (const token of SIGNAL_TOKENS) {
        result = result.replaceAll(token, token.replace("_", "·"));
      }
      return result;
    })
    .join("\n");
}

/**
 * Indexes of lines inside (or delimiting) a CLOSED fenced code block. An opener with
 * no matching closer is ignored: multi-message agent text (e.g. Copilot's joined
 * `assistant.message`s) can carry a truncated fence, and treating it as running to
 * the end would neutralize the agent's genuine final signal line.
 */
function closedFenceLines(lines: readonly string[]): Set<number> {
  const fenced = new Set<number>();
  let open: { marker: string; length: number; start: number } | undefined;
  lines.forEach((line, index) => {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) return;
    const run = match[1]!;
    if (!open) {
      open = { marker: run[0]!, length: run.length, start: index };
    } else if (
      run[0] === open.marker &&
      run.length >= open.length &&
      line.slice(match[0].length).trim().length === 0
    ) {
      for (let i = open.start; i <= index; i++) fenced.add(i);
      open = undefined;
    }
  });
  return fenced;
}
