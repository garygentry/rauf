/**
 * Shared case-insensitive substring-list matcher, used by both the usage-limit banner detector
 * (`exit-classifier.ts`) and the codex sandbox-denial detector (`codex-sandbox-diagnostics.ts`)
 * so the matching strategy lives in exactly one place.
 */
export function matchesAnyPattern(text: string, patterns: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}
