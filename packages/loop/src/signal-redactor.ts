const SIGNAL_TOKENS = ["RAUF_DONE", "RAUF_BLOCKED", "RAUF_NEEDS_HUMAN"] as const;

/** Replace literal RAUF_* terminal tokens with a visually similar but non-matchable form. */
export function redactSignalTokens(text: string): string {
  let result = text;
  for (const token of SIGNAL_TOKENS) {
    result = result.replaceAll(token, token.replace("_", "·"));
  }
  return result;
}
