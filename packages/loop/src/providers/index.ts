export type {
  ProviderId,
  LLMProvider,
  ExecuteOptions,
  ExecutionResult,
  ProviderProgressEvent,
  UsageLimitResult,
  ProviderFactory,
  ProgressCallback,
} from "./types.js";

export {
  registerProvider,
  createProvider,
  getAvailableProviders,
  clearProviders,
} from "./registry.js";

export { createClaudeCliProvider } from "./claude-cli.js";

// Side-effect import: registers claude-cli as the default provider
import "./claude-cli.js";
