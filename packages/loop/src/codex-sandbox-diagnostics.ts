import { matchesAnyPattern } from "./text-pattern-match.js";

/**
 * Heuristic detector for text shaped like a Codex sandbox denial (issues #84, #95). Codex's
 * default `--sandbox workspace-write` policy blocks network access and restricts subprocess
 * spawning; when that happens the failure text looks environmental (DNS/connectivity errors,
 * `EPERM` on `spawnSync`) even though the host itself is unrestricted. Modeled directly on the
 * `hasUsageLimitInText` pattern-list precedent in `exit-classifier.ts`: case-insensitive
 * substring matching, no parsing.
 */
const NETWORK_DENIAL_PATTERNS = [
  "could not resolve host",
  "enotfound",
  "enetunreach",
  "etimedout",
  "network is unreachable",
];

/**
 * `EPERM`/"operation not permitted" alone is too generic to attribute to Codex's sandbox — a
 * locked file or a host ACL can produce the exact same text with no sandbox involved. Require it
 * to co-occur with subprocess-spawn context (`spawnSync`, matching the concrete evidence in
 * issue #84: `spawnSync node EPERM`, `spawnSync grep EPERM`) before treating it as a signature.
 */
function hasSpawnDenialSignature(lower: string): boolean {
  const spawnContext = lower.includes("spawnsync") || lower.includes("spawn ");
  const permissionDenied = lower.includes("eperm") || lower.includes("operation not permitted");
  return spawnContext && permissionDenied;
}

/** Returns true when the given text contains a known sandbox-denial-shaped phrase. */
export function hasSandboxDenialSignature(text: string): boolean {
  const lower = text.toLowerCase();
  return matchesAnyPattern(lower, NETWORK_DENIAL_PATTERNS) || hasSpawnDenialSignature(lower);
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
