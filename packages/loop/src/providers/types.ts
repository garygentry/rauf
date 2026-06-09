import type { Result } from "@rauf/core";
import type { ParsedSignal } from "../signal-parser.js";
import type { ClaudeStreamEvent } from "../stream-parser.js";

/** Uniquely identifies a provider */
export type ProviderId = string;

/** Callback for streaming progress events */
export type ProgressCallback = (event: ProviderProgressEvent) => void;

/** LLM provider adapter interface */
export interface LLMProvider {
  /** Unique identifier (e.g., "claude-cli", "generic-cli") */
  readonly id: ProviderId;

  /** Human-readable name for UI/logs (e.g., "Claude Code (CLI)") */
  readonly displayName: string;

  /**
   * Execute a single loop iteration with the given prompt.
   * CLI providers spawn a subprocess; SDK providers call an API.
   */
  execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>>;

  /** Check provider-specific usage/rate limits. Optional — return undefined if unsupported. */
  checkUsage?(): Promise<UsageLimitResult>;

  /** Validate that required credentials exist and are readable. Called before the loop starts. */
  validateCredentials(): Result<void>;

  /** Provider-specific cleanup (kill orphaned processes, close connections). */
  dispose?(): Promise<void>;
}

export interface ExecuteOptions {
  model?: string;
  timeoutMinutes: number;
  signal?: AbortSignal;
  /** Callback for streaming progress (SDK providers only) */
  onProgress?: ProgressCallback;
  /** Output format for CLI providers */
  outputFormat?: "text" | "stream-json";
  /** Callback for real-time stream events (CLI providers with stream-json) */
  onStreamEvent?: (event: ClaudeStreamEvent) => void;
}

export interface ExecutionResult {
  /** Raw text output for signal parsing */
  stdout: string;
  /** Raw error output */
  stderr: string;
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Whether the execution was terminated by timeout */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Structured signal if provider can extract directly (SDK providers) */
  parsedSignal?: ParsedSignal;
  /** Streaming events collected during execution (SDK providers) */
  progressEvents?: ProviderProgressEvent[];
  /** Reconstructed text output (set when outputFormat is stream-json) */
  reconstructedText?: string;
}

export interface ProviderProgressEvent {
  type: "tool_use" | "thinking" | "text" | "error";
  timestamp: string;
  detail: string;
}

/** Normalized usage/rate limit result across providers */
export interface UsageLimitResult {
  limited: boolean;
  limitType?: string;
  utilization?: number;
  retryAfter?: number;
  resetsAt?: string;
}

/** Factory function that creates an LLMProvider instance */
export type ProviderFactory = (config?: Record<string, unknown>) => LLMProvider;
