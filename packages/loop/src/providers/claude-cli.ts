import { ok, err, ErrorCodes, readClaudeOAuthToken } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnClaude } from "../claude-process.js";
import { checkUsageLimit } from "../usage-checker.js";
import { probeBinaryOnPath, registerAgent } from "./registry.js";
import type {
  LLMProvider,
  ExecuteOptions,
  ExecutionResult,
  UsageLimitResult,
  DetectionResult,
} from "./types.js";

class ClaudeCliProvider implements LLMProvider {
  readonly id = "claude-cli" as const;
  readonly displayName = "Claude Code (CLI)";

  async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>> {
    const result = await spawnClaude(prompt, {
      sessionTimeoutMinutes: options.timeoutMinutes,
      model: options.model,
      signal: options.signal,
      outputFormat: options.outputFormat,
      onStreamEvent: options.onStreamEvent,
      // Forward the runner's childEnv (review-hook suppression + child-session
      // overrides) — without this, routing through execute would drop it (SC-2).
      ...(options.env ? { env: options.env } : {}),
    });

    if (!result.ok) {
      return result;
    }

    const { exitCode, stdout, stderr, timedOut, durationMs, reconstructedText } = result.value;
    return ok({ stdout, stderr, exitCode, timedOut, durationMs, reconstructedText });
  }

  validateCredentials(): Result<void> {
    const tokenResult = readClaudeOAuthToken();
    if (!tokenResult.ok) {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Claude credentials not available: ${tokenResult.error.message}`,
      });
    }
    return ok(undefined);
  }

  async checkUsage(): Promise<UsageLimitResult> {
    const tokenResult = readClaudeOAuthToken();
    if (!tokenResult.ok) {
      return { limited: false };
    }
    return checkUsageLimit(tokenResult.value);
  }
}

export function createClaudeCliProvider(): LLMProvider {
  return new ClaudeCliProvider();
}

/**
 * Availability probe for claude-cli. Overrides the default PATH probe: claude availability is
 * gated on its OAuth credential being readable, not on the `claude` binary being on PATH — this
 * preserves today's pre-loop credential semantics (REQ-USAGE-01, SC-2). Reuses the exact
 * credential check `createClaudeCliProvider().validateCredentials()`. Never throws.
 */
async function detectClaudeCli(): Promise<DetectionResult> {
  const binary = await probeBinaryOnPath("claude");
  if (!binary.binaryAvailable) return binary;

  const provider = createClaudeCliProvider();
  const result = provider.validateCredentials();
  if (result.ok) {
    return {
      available: true,
      binaryAvailable: true,
      authenticated: true,
      detail: "claude found in PATH; Claude OAuth credentials present",
    };
  }
  return {
    available: false,
    binaryAvailable: true,
    authenticated: false,
    detail: result.error.message,
  };
}

// Register as the default agent (migrated from registerProvider — behavior preserved).
registerAgent({
  id: "claude-cli",
  displayName: "Claude Code (CLI)",
  binaryName: "claude",
  factory: createClaudeCliProvider,
  detect: detectClaudeCli,
});
