import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err, ErrorCodes } from "@rauf/core";
import type { SpawnClaudeResult } from "../claude-process.js";
import type { UsageLimitResult as CheckerUsageLimitResult } from "../usage-checker.js";

// Mock dependencies before importing the module under test
vi.mock("../claude-process.js", () => ({
  spawnClaude: vi.fn(),
}));

vi.mock("../usage-checker.js", () => ({
  checkUsageLimit: vi.fn(),
}));

vi.mock("@rauf/core", async () => {
  const actual = await vi.importActual<typeof import("@rauf/core")>("@rauf/core");
  return {
    ...actual,
    readClaudeOAuthToken: vi.fn(),
  };
});

// Must import after mocks are set up
import { spawnClaude } from "../claude-process.js";
import { checkUsageLimit } from "../usage-checker.js";
import { readClaudeOAuthToken } from "@rauf/core";
import { createClaudeCliProvider } from "./claude-cli.js";
import { getAvailableProviders, createProvider } from "./registry.js";

const mockSpawnClaude = vi.mocked(spawnClaude);
const mockReadToken = vi.mocked(readClaudeOAuthToken);
const mockCheckUsage = vi.mocked(checkUsageLimit);

describe("ClaudeCliProvider", () => {
  const provider = createClaudeCliProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id and displayName", () => {
    expect(provider.id).toBe("claude-cli");
    expect(provider.displayName).toBe("Claude Code (CLI)");
  });

  describe("execute()", () => {
    it("delegates to spawnClaude with correct option mapping", async () => {
      const spawnResult: SpawnClaudeResult = {
        exitCode: 0,
        stdout: "RAUF_DONE",
        stderr: "",
        timedOut: false,
        durationMs: 5000,
      };
      mockSpawnClaude.mockResolvedValue(ok(spawnResult));

      const signal = AbortSignal.timeout(60000);
      await provider.execute("test prompt", {
        timeoutMinutes: 30,
        model: "opus",
        signal,
      });

      expect(mockSpawnClaude).toHaveBeenCalledWith("test prompt", {
        sessionTimeoutMinutes: 30,
        model: "opus",
        signal,
      });
    });

    it("maps spawnClaude result to ExecutionResult", async () => {
      const spawnResult: SpawnClaudeResult = {
        exitCode: 0,
        stdout: "output text",
        stderr: "some warnings",
        timedOut: false,
        durationMs: 12345,
      };
      mockSpawnClaude.mockResolvedValue(ok(spawnResult));

      const result = await provider.execute("prompt", { timeoutMinutes: 10 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          stdout: "output text",
          stderr: "some warnings",
          exitCode: 0,
          timedOut: false,
          durationMs: 12345,
        });
      }
    });

    it("maps timeout result correctly", async () => {
      const spawnResult: SpawnClaudeResult = {
        exitCode: 137,
        stdout: "",
        stderr: "",
        timedOut: true,
        durationMs: 600000,
      };
      mockSpawnClaude.mockResolvedValue(ok(spawnResult));

      const result = await provider.execute("prompt", { timeoutMinutes: 10 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timedOut).toBe(true);
        expect(result.value.exitCode).toBe(137);
      }
    });

    it("passes through spawnClaude errors", async () => {
      const spawnErr = err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: "Failed to spawn claude: ENOENT",
      });
      mockSpawnClaude.mockResolvedValue(spawnErr);

      const result = await provider.execute("prompt", { timeoutMinutes: 10 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
      }
    });

    it("passes model as undefined when not provided", async () => {
      mockSpawnClaude.mockResolvedValue(
        ok({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 0 }),
      );

      await provider.execute("prompt", { timeoutMinutes: 5 });

      expect(mockSpawnClaude).toHaveBeenCalledWith("prompt", {
        sessionTimeoutMinutes: 5,
        model: undefined,
        signal: undefined,
      });
    });
  });

  describe("validateCredentials()", () => {
    it("returns ok when token is readable", () => {
      mockReadToken.mockReturnValue(ok("valid-token"));

      const result = provider.validateCredentials();

      expect(result.ok).toBe(true);
      expect(mockReadToken).toHaveBeenCalled();
    });

    it("returns err when token is not readable", () => {
      mockReadToken.mockReturnValue(
        err({
          code: ErrorCodes.FILE_NOT_FOUND,
          message: "Claude credentials file not found",
        }),
      );

      const result = provider.validateCredentials();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
        expect(result.error.message).toContain("Claude credentials not available");
      }
    });
  });

  describe("registration", () => {
    it("is registered in the provider registry as claude-cli", () => {
      // The import of claude-cli.ts triggers side-effect registration
      expect(getAvailableProviders()).toContain("claude-cli");
    });

    it("can be created from the registry", () => {
      const registryProvider = createProvider("claude-cli");
      expect(registryProvider.id).toBe("claude-cli");
      expect(registryProvider.displayName).toBe("Claude Code (CLI)");
    });
  });

  describe("checkUsage()", () => {
    it("calls checkUsageLimit with token from readClaudeOAuthToken", async () => {
      mockReadToken.mockReturnValue(ok("test-token"));
      const usageResult: CheckerUsageLimitResult = { limited: false };
      mockCheckUsage.mockResolvedValue(usageResult);

      const result = await provider.checkUsage!();

      expect(mockReadToken).toHaveBeenCalled();
      expect(mockCheckUsage).toHaveBeenCalledWith("test-token");
      expect(result.limited).toBe(false);
    });

    it("maps limited usage result correctly", async () => {
      mockReadToken.mockReturnValue(ok("test-token"));
      const usageResult: CheckerUsageLimitResult = {
        limited: true,
        limitType: "5h",
        utilization: 100,
        retryAfter: 3600,
        resetsAt: "2026-03-18T12:00:00Z",
      };
      mockCheckUsage.mockResolvedValue(usageResult);

      const result = await provider.checkUsage!();

      expect(result.limited).toBe(true);
      expect(result.limitType).toBe("5h");
      expect(result.utilization).toBe(100);
      expect(result.retryAfter).toBe(3600);
      expect(result.resetsAt).toBe("2026-03-18T12:00:00Z");
    });

    it("returns { limited: false } when token reading fails (graceful degradation)", async () => {
      mockReadToken.mockReturnValue(
        err({
          code: ErrorCodes.FILE_NOT_FOUND,
          message: "Claude credentials file not found",
        }),
      );

      const result = await provider.checkUsage!();

      expect(result.limited).toBe(false);
      expect(mockCheckUsage).not.toHaveBeenCalled();
    });
  });
});
