import { ok, err, ErrorCodes, readClaudeOAuthToken } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnClaude } from "../claude-process.js";
import { checkUsageLimit } from "../usage-checker.js";
import { registerProvider } from "./registry.js";
import type { LLMProvider, ExecuteOptions, ExecutionResult, UsageLimitResult } from "./types.js";

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

// Register as the default provider
registerProvider("claude-cli", createClaudeCliProvider);
