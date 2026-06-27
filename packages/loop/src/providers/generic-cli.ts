import { ok, err, ErrorCodes } from "@rauf/core";
import type { Result } from "@rauf/core";

import { GENERIC_AGENT_ID } from "../constants.js";
import { CliAgent } from "./cli-agent.js";
import type { CliAgentConfig, PromptDelivery } from "./cli-agent.js";
import { registerAgent, probeBinaryOnPath } from "./registry.js";
import type { ProviderFactory, DetectionResult } from "./types.js";

const PROMPT_DELIVERIES: readonly PromptDelivery[] = ["stdin", "arg", "file"];

/**
 * Normalize an untyped config record (marker `providerConfig` or a `ToolConfig.providers[id]`
 * entry) into a validated {@link CliAgentConfig} (`03-cli-agent-engine-and-presets.md §7.3`).
 * Returns a {@link Result} so a malformed entry is an expected error, not a throw (§8).
 *
 * Defaults: `args` → `[]` (static `buildArgs`), `promptDelivery` → `"stdin"`, `nonInteractive` →
 * `[]`. `modelFlag` is built from an optional `modelFlagTemplate` string (omitted when absent, so
 * the agent uses its default model, REQ-MODEL-02). `parsesStream` is never set to anything but
 * false/omitted (plain-text only, REQ-OBS-02).
 */
export function configToCliAgentConfig(
  id: string,
  raw: Record<string, unknown>,
): Result<CliAgentConfig> {
  const binary = raw.binary;
  if (typeof binary !== "string" || binary.length === 0) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `generic agent "${id}" config is missing a non-empty "binary" field`,
    });
  }

  const promptDelivery = (raw.promptDelivery ?? "stdin") as PromptDelivery;
  if (!PROMPT_DELIVERIES.includes(promptDelivery)) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `generic agent "${id}" has invalid promptDelivery "${String(
        raw.promptDelivery,
      )}" (expected one of stdin, arg, file)`,
    });
  }

  const args = Array.isArray(raw.args) ? (raw.args as string[]) : [];
  const nonInteractive = Array.isArray(raw.nonInteractive) ? (raw.nonInteractive as string[]) : [];
  const mft = typeof raw.modelFlagTemplate === "string" ? raw.modelFlagTemplate : undefined;
  const env =
    raw.env && typeof raw.env === "object" ? (raw.env as Record<string, string>) : undefined;

  return ok({
    id,
    displayName: typeof raw.displayName === "string" ? raw.displayName : id,
    binary,
    buildArgs: () => [...args],
    promptDelivery,
    nonInteractive,
    ...(mft ? { modelFlag: (m: string) => [mft, m] } : {}),
    ...(env ? { env } : {}),
  });
}

/**
 * Factory for the reserved `generic-cli` adapter (id === {@link GENERIC_AGENT_ID}). Builds a
 * {@link CliAgent} from the per-run marker `providerConfig` record. A malformed config throws
 * (the inherited `createProvider` contract, `registry.ts`); the runner's per-iteration resolve
 * wraps that throw (`05-runner-wiring.md §8`).
 */
export const createGenericCliProvider: ProviderFactory = (config) => {
  const parsed = configToCliAgentConfig(GENERIC_AGENT_ID, config ?? {});
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return new CliAgent(parsed.value);
};

/**
 * Custom availability probe for the reserved `generic-cli` descriptor
 * (`03-cli-agent-engine-and-presets.md §7.2`). With no `providerConfig` the binary is unknown
 * until run time, so it reports available/configurable rather than failing enumeration. When a
 * `providerConfig` carrying a `binary` is supplied, it PATH-probes that binary.
 */
export async function detectGenericCli(config?: Record<string, unknown>): Promise<DetectionResult> {
  // Enumeration path (no providerConfig, e.g. `rauf agents`): the binary is unknown until a
  // per-run config is supplied, so report configurable rather than failing discovery.
  if (config === undefined) {
    return {
      available: true,
      detail: "configurable; binary resolved from providerConfig at run time",
    };
  }
  // Preflight path: a providerConfig IS supplied. Validate the WHOLE config (binary present +
  // valid promptDelivery/args/…) so a missing binary or malformed option fails setup before any
  // loop state/backlog mutation, instead of throwing later from createProvider (P1 review).
  const parsed = configToCliAgentConfig(GENERIC_AGENT_ID, config);
  if (!parsed.ok) {
    return { available: false, detail: parsed.error.message };
  }
  return probeBinaryOnPath(parsed.value.binary);
}

// Register the reserved generic-cli descriptor with NO binaryName (its binary is unknown until
// the per-run providerConfig is read) and the custom detect above.
registerAgent({
  id: GENERIC_AGENT_ID,
  displayName: "Generic CLI agent (configurable)",
  factory: createGenericCliProvider,
  detect: (config) => detectGenericCli(config),
});
