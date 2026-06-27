import { CliAgent } from "./cli-agent.js";
import type { CliAgentConfig } from "./cli-agent.js";
import { registerAgent } from "./registry.js";

/**
 * Shipped named preset adapters (`03-cli-agent-engine-and-presets.md §6`).
 *
 * Each preset is plain {@link CliAgentConfig} data over the {@link CliAgent} engine — no new
 * orchestration code (REQ-SCALE-01). All run in plain-text mode (`parsesStream` omitted).
 *
 * ⚠️ WARNING (OQ-2): the `nonInteractive` and `modelFlag` literals below are best-known,
 * CORRECTABLE values — not verified against the real CLIs. A wrong flag is a one-line config
 * fix here, never an engine change. SC-1 proves the invocation MECHANISM via mock agents in the
 * sandbox (items 012/013), NOT the real flags. Update these literals when an agent's actual CLI
 * surface is confirmed.
 *
 * NOTE: `codex` is NOT a generic preset — it has a dedicated, telemetry-capable adapter
 * ({@link ./codex-cli.ts}, `CodexCliProvider`) that also builds the correct current argv
 * (`--ask-for-approval` is a top-level flag that current Codex rejects after `exec`).
 */
export const PRESET_CONFIGS: readonly CliAgentConfig[] = [
  {
    id: "gemini",
    displayName: "Gemini CLI",
    binary: "gemini",
    promptDelivery: "stdin",
    buildArgs: () => [],
    nonInteractive: ["--yolo"],
    modelFlag: (m) => ["-m", m],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    binary: "copilot",
    promptDelivery: "stdin",
    buildArgs: () => [],
    nonInteractive: ["--allow-all-tools"],
    modelFlag: (m) => ["--model", m],
  },
  {
    id: "cursor",
    displayName: "Cursor Agent CLI",
    // NOTE: the binary ("cursor-agent") deliberately differs from the agent id ("cursor").
    binary: "cursor-agent",
    promptDelivery: "arg",
    buildArgs: () => [],
    nonInteractive: ["--force"],
    modelFlag: (m) => ["--model", m],
  },
];

/** Look up a shipped preset config by agent id. */
export function getPresetConfig(id: string): CliAgentConfig | undefined {
  return PRESET_CONFIGS.find((c) => c.id === id);
}

// Register each preset descriptor so it enumerates (getAgentDescriptors) and probes its real
// binary on PATH via the default detect (registerAgent with binaryName = config.binary).
for (const config of PRESET_CONFIGS) {
  registerAgent({
    id: config.id,
    displayName: config.displayName,
    binaryName: config.binary,
    factory: () => new CliAgent(config),
  });
}
