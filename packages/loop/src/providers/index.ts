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

// Side-effect import: registers claude-cli as the default provider
import "./claude-cli.js";
