export { TypedEventEmitter } from "./events.js";
export { parseSignal } from "./signal-parser.js";
export type { ParsedSignal, SignalType } from "./signal-parser.js";
export { gitCommit } from "./git-commit.js";
export type { GitCommitSuccess } from "./git-commit.js";
export { checkLoopPreconditions } from "./git-status.js";
export { buildPrompt, buildReviewPrompt } from "./prompt-builder.js";
export { checkUsageLimit, interruptibleSleep } from "./usage-checker.js";
export type { UsageLimitResult } from "./usage-checker.js";
export { spawnClaude } from "./claude-process.js";
export type { SpawnClaudeOptions, SpawnClaudeResult } from "./claude-process.js";
export { resolveChildEnv, REVIEW_HOOK_SUPPRESSION_ENV } from "./review-hooks.js";
export type { ChildEnvOptions } from "./review-hooks.js";
export { StreamParser } from "./stream-parser.js";
export type { ClaudeStreamEvent, StreamEventType } from "./stream-parser.js";
export { LoopRunner } from "./runner.js";
export type { LoopResult } from "./runner.js";
export type { LoopEvent, LoopStartOptions } from "@rauf/core";

// Provider system
export {
  registerProvider,
  createProvider,
  getAvailableProviders,
  clearProviders,
} from "./providers/index.js";
export type {
  ProviderId,
  LLMProvider,
  ExecuteOptions,
  ExecutionResult,
  ProviderProgressEvent,
  UsageLimitResult as ProviderUsageLimitResult,
  ProviderFactory,
  ProgressCallback,
} from "./providers/index.js";
