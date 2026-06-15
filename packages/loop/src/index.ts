export { TypedEventEmitter } from "./events.js";
export { parseSignal } from "./signal-parser.js";
export type { ParsedSignal, SignalType } from "./signal-parser.js";
export { gitCommit, RUNTIME_EXCLUDE_PATHSPECS } from "./git-commit.js";
export type { GitCommitSuccess } from "./git-commit.js";
export { execGit } from "./git-exec.js";
export { findItemCommit, isTreeClean } from "./git-reconcile.js";
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

// Recovery core (shared by `rauf reset` / `rauf resume` and the web routes)
export {
  detectInterruptedItems,
  reconcileAndRequeue,
  acquireRecoveryLock,
  releaseRecoveryLock,
  recoverInterruptedLoop,
} from "./recovery.js";
export type {
  KeptBlock,
  InterruptedItem,
  ReconcileSummary,
  RecoverySummary,
  AcquiredRecoveryLock,
} from "./recovery.js";

// Provider system
export {
  registerProvider,
  createProvider,
  getAvailableProviders,
  clearProviders,
  registerAgent,
  getAgentDescriptors,
  listAgents,
  detectAgent,
} from "./providers/index.js";
export type { AgentAvailability } from "./providers/index.js";
export { CliAgent } from "./providers/index.js";
export type { PromptDelivery, BuildArgsContext, CliAgentConfig } from "./providers/index.js";
export type {
  ProviderId,
  LLMProvider,
  ExecuteOptions,
  ExecutionResult,
  ProviderProgressEvent,
  UsageLimitResult as ProviderUsageLimitResult,
  ProviderFactory,
  ProgressCallback,
  AgentAdapter,
  AgentDescriptor,
  DetectionResult,
} from "./providers/index.js";
