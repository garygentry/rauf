export type {
  ProviderId,
  LLMProvider,
  ExecuteOptions,
  ExecutionResult,
  ProviderProgressEvent,
  UsageLimitResult,
  ProviderFactory,
  ProgressCallback,
  AgentAdapter,
  AgentDescriptor,
  DetectionResult,
} from "./types.js";

export {
  registerProvider,
  createProvider,
  getAvailableProviders,
  clearProviders,
  registerAgent,
  getAgentDescriptors,
  listAgents,
  detectAgent,
} from "./registry.js";
export type { AgentAvailability } from "./registry.js";

export { CliAgent } from "./cli-agent.js";
export type { PromptDelivery, BuildArgsContext, CliAgentConfig } from "./cli-agent.js";

export { createClaudeCliProvider } from "./claude-cli.js";

export { PRESET_CONFIGS, getPresetConfig } from "./presets.js";

export { createGenericCliProvider, configToCliAgentConfig } from "./generic-cli.js";

export { CodexCliProvider, CODEX_AGENT_ID } from "./codex-cli.js";

// Side-effect import: registers claude-cli as the default provider
import "./claude-cli.js";
// Side-effect import: registers the shipped presets (gemini/copilot/cursor)
import "./presets.js";
// Side-effect import: registers the dedicated codex adapter (overrides any preset for "codex")
import "./codex-cli.js";
// Side-effect import: registers the reserved generic-cli adapter
import "./generic-cli.js";
