import type { Result } from "@rauf/core";
import type { ExitClass } from "../exit-classifier.js";
import type { ParsedSignal } from "../signal-parser.js";
import type { AgentStreamEvent } from "../stream-parser.js";

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

  /** Classify a no-signal process result using provider-specific diagnostics. */
  classifyFailure?(result: ExecutionResult): ProviderFailureClassification;

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
  onStreamEvent?: (event: AgentStreamEvent) => void;
  /**
   * Environment overrides for the agent's child process, merged over `process.env`. The runner
   * passes its resolved `childEnv` here so review-hook suppression and other child-session env
   * reach every adapter uniformly. `ClaudeCliProvider.execute` forwards it to `spawnClaude`
   * (`SpawnClaudeOptions.env`); `CliAgent.execute` merges it OVER `CliAgentConfig.env`
   * (`03-cli-agent-engine-and-presets.md §4.5`). Omitted ⇒ child inherits the parent env unchanged.
   */
  env?: Record<string, string>;
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

export interface ProviderFailureClassification {
  kind: string;
  exitClass: Extract<ExitClass, "timeout" | "infra_error" | "genuine_retry">;
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

/**
 * Charter contract name (epic `agent-agnostic`) for the abstraction that drives one
 * coding-agent CLI through a single loop iteration: spawn the process, deliver the prompt,
 * consume output, and report a resolved outcome. Structurally identical to {@link LLMProvider};
 * the internal vocabulary stays `provider`/`LLMProvider`, the exported/contract vocabulary is
 * `agent`/`AgentAdapter`. (REQ-ADP-01, REQ-SEL-01, tech-spec §3.1.)
 */
export type AgentAdapter = LLMProvider;

/** Result of probing whether an agent's CLI is available on the current machine. */
export interface DetectionResult {
  /** True when the agent's CLI can be invoked (e.g. its binary resolves on PATH). */
  available: boolean;
  /** Whether the configured executable is present. Undefined only for legacy custom detectors. */
  binaryAvailable?: boolean;
  /** Authenticated readiness: null when no safe, non-mutating auth probe exists. */
  authenticated?: boolean | null;
  /**
   * Human-readable detail for discovery output and fail-fast remediation messages
   * (e.g. "found at /usr/local/bin/codex", or "binary 'codex' not found on PATH").
   */
  detail?: string;
}

/**
 * Registry entry describing one selectable agent (REQ-ADP-05). Enumerable for help/discovery
 * (REQ-DISC-01/02) and probeable for availability (REQ-DET-01) without constructing a provider
 * or reading run config.
 */
export interface AgentDescriptor {
  /** Stable agent id (registry key, equals the provider id, e.g. "claude-cli", "codex"). */
  id: string;
  /** Human-readable name for help/discovery (e.g. "Claude Code (CLI)"). */
  displayName: string;
  /**
   * Executable resolved on PATH for the default detector. Omitted ONLY for the reserved
   * `generic-cli` descriptor, whose binary is unknown until its `providerConfig` is read
   * (tech-spec §3.4); such descriptors MUST supply a custom `detect` (tech-spec §3.5).
   */
  binaryName?: string;
  /** Factory that constructs the provider instance (reused {@link ProviderFactory}). */
  factory: ProviderFactory;
  /**
   * Availability probe. Defaults to a PATH resolution of `binaryName` (no agent subprocess —
   * a stat-style `which`, consistent with CLAUDE.md "status reads files, not subprocesses").
   * `claude-cli` overrides this with its credential check; `generic-cli` overrides it to
   * resolve and validate the binary from the supplied `providerConfig`. The optional `config`
   * is the per-run `providerConfig` record, passed by callers that can preflight a configured
   * agent (e.g. the runner for `generic-cli`); enumeration callers pass nothing.
   */
  detect?: (config?: Record<string, unknown>) => Promise<DetectionResult>;
}
