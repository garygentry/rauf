// loop-agent-selection charter contract (04-agent-selection.md).
//
// Two pure, total exports — `resolveAgentId` (§3.1) and `normalizeAgentAlias`
// (§3.2) — plus a re-export of the 00-core-definitions §6 constants so the
// charter surface is self-contained. This module has NO runtime imports from
// the runner, the registry, or node:child_process / node:fs.

export { DEFAULT_AGENT_ID, GENERIC_AGENT_ID } from "./constants.js";

import { DEFAULT_AGENT_ID } from "./constants.js";

/**
 * Resolve the single agent id that drives an iteration, collapsing the four
 * optional selection layers by precedence (REQ-SEL-02). Pure and **total**:
 * never throws, never does I/O — every input is a plain optional string and the
 * function always returns a non-empty agent id (falling through to
 * {@link DEFAULT_AGENT_ID} when nothing is set, REQ-SEL-03).
 *
 * Precedence (highest wins): itemProvider → runProvider → projectProvider →
 * globalProvider → DEFAULT_AGENT_ID. Validating that the returned id is a
 * *known* agent is the consumer's job (createProvider / detectAgent) — this
 * resolver does not know the registry.
 */
export function resolveAgentId(input: {
  /** BacklogItem.provider — per-item agent, highest precedence (REQ-SEL-04). */
  itemProvider?: string;
  /** LoopStartOptions.provider — set from `--agent` / detached server body. */
  runProvider?: string;
  /** Project `.rauf.json` → MarkerOptions.provider. */
  projectProvider?: string;
  /** Global `~/.rauf/config.json` → ToolConfig.defaultProvider. */
  globalProvider?: string;
}): string {
  // Treat empty/whitespace-only as "unset" so it does not shadow a real lower layer.
  const pick = (v?: string): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  return (
    pick(input.itemProvider) ??
    pick(input.runProvider) ??
    pick(input.projectProvider) ??
    pick(input.globalProvider) ??
    DEFAULT_AGENT_ID
  );
}

/**
 * Fold the user-facing `agent` input-alias key onto the canonical internal
 * `provider` key (REQ-SEL-01). Additive and non-breaking: the persisted key
 * stays `provider`; `agent` is accepted only as an authoring convenience and is
 * dropped from the returned object. MUST run BEFORE schema validation.
 *
 * Conflict rule: if BOTH keys are present, `provider` WINS, `onWarn` is called
 * once, and `agent` is discarded. Passes through untouched when no `agent` key.
 */
export function normalizeAgentAlias<T extends { provider?: string; agent?: string }>(
  raw: T,
  onWarn?: (message: string) => void,
): Omit<T, "agent"> & { provider?: string } {
  const { agent, ...rest } = raw;
  const out = rest as Omit<T, "agent"> & { provider?: string };

  if (agent === undefined) {
    return out; // no alias present — pass through untouched.
  }
  if (out.provider !== undefined) {
    // Both present: canonical `provider` wins; `agent` discarded with a warning.
    onWarn?.(
      `Both "provider" (${out.provider}) and the "agent" alias (${agent}) were set; ` +
        `"provider" wins and "agent" is ignored. Use "provider" as the canonical key.`,
    );
    return out;
  }
  // Only the alias present: fold `agent` → `provider`.
  out.provider = agent;
  return out;
}
