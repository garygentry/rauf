/**
 * Heuristic detector for text shaped like a Codex sandbox denial (issues #84, #95). Codex's
 * default `--sandbox workspace-write` policy blocks network access and restricts subprocess
 * spawning; when that happens the failure text looks environmental (DNS/connectivity errors,
 * `EPERM` on `spawnSync`) even though the host itself is unrestricted. Modeled directly on the
 * `hasUsageLimitInText` pattern-list precedent in `exit-classifier.ts`: case-insensitive
 * substring matching, no parsing.
 */
const SANDBOX_DENIAL_PATTERNS = [
  "could not resolve host",
  "enotfound",
  "enetunreach",
  "etimedout",
  "network is unreachable",
  "eperm",
  "operation not permitted",
];

/** Returns true when the given text contains a known sandbox-denial-shaped phrase. */
export function hasSandboxDenialSignature(text: string): boolean {
  const lower = text.toLowerCase();
  return SANDBOX_DENIAL_PATTERNS.some((pattern) => lower.includes(pattern));
}

const HINT =
  "Note: this may be caused by Codex's sandbox policy (default --sandbox workspace-write " +
  "restricts network access and subprocess spawning), not a real defect. Configure the codex " +
  'providerConfig ("networkAccess", "sandboxMode") to relax it, or select another configured ' +
  "agent (--agent generic-cli / claude-cli) for this project. " +
  "See docs/architecture/rauf-agent-cli-adapters/guides/adding-an-agent.md.";

/**
 * Appends the sandbox-denial hint to `reason` when `combinedOutput` matches a known denial
 * signature; otherwise returns `reason` unchanged. Callers gate this to the `codex` provider —
 * the hint would be misleading for a provider with no such sandbox.
 */
export function annotateCodexSandboxHint(reason: string, combinedOutput: string): string {
  if (!hasSandboxDenialSignature(combinedOutput)) return reason;
  return `${reason}\n\n${HINT}`;
}
