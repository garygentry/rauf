import { afterEach, describe, expect, it } from "vitest";

import type { LLMProvider } from "./types.js";
import {
  clearProviders,
  createProvider,
  getAvailableProviders,
  registerProvider,
} from "./registry.js";

function createMockProvider(id: string, displayName: string): LLMProvider {
  return {
    id,
    displayName,
    async execute() {
      return {
        ok: true as const,
        value: {
          stdout: "RAUF_DONE",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 100,
        },
      };
    },
    validateCredentials() {
      return { ok: true as const, value: undefined };
    },
  };
}

describe("provider registry", () => {
  afterEach(() => {
    clearProviders();
  });

  describe("registerProvider", () => {
    it("stores a factory by ID", () => {
      registerProvider("test-provider", () => createMockProvider("test-provider", "Test"));
      expect(getAvailableProviders()).toContain("test-provider");
    });

    it("overwrites an existing registration", () => {
      registerProvider("test", () => createMockProvider("test", "First"));
      registerProvider("test", () => createMockProvider("test", "Second"));

      const provider = createProvider("test");
      expect(provider.displayName).toBe("Second");
    });
  });

  describe("createProvider", () => {
    it("creates a provider instance from a registered factory", () => {
      registerProvider("mock-cli", () => createMockProvider("mock-cli", "Mock CLI"));

      const provider = createProvider("mock-cli");
      expect(provider.id).toBe("mock-cli");
      expect(provider.displayName).toBe("Mock CLI");
    });

    it("passes config to the factory", () => {
      let receivedConfig: Record<string, unknown> | undefined;
      registerProvider("configurable", (config) => {
        receivedConfig = config;
        return createMockProvider("configurable", "Configurable");
      });

      createProvider("configurable", { binary: "/usr/bin/agent", timeout: 30 });
      expect(receivedConfig).toEqual({ binary: "/usr/bin/agent", timeout: 30 });
    });

    it("throws for an unknown provider ID", () => {
      expect(() => createProvider("nonexistent")).toThrow(
        'Unknown provider "nonexistent". Available providers: (none)',
      );
    });

    it("includes available providers in error message", () => {
      registerProvider("alpha", () => createMockProvider("alpha", "Alpha"));
      registerProvider("beta", () => createMockProvider("beta", "Beta"));

      expect(() => createProvider("gamma")).toThrow(
        'Unknown provider "gamma". Available providers: alpha, beta',
      );
    });
  });

  describe("getAvailableProviders", () => {
    it("returns empty array when no providers registered", () => {
      expect(getAvailableProviders()).toEqual([]);
    });

    it("returns all registered provider IDs", () => {
      registerProvider("provider-a", () => createMockProvider("provider-a", "A"));
      registerProvider("provider-b", () => createMockProvider("provider-b", "B"));
      registerProvider("provider-c", () => createMockProvider("provider-c", "C"));

      const ids = getAvailableProviders();
      expect(ids).toHaveLength(3);
      expect(ids).toContain("provider-a");
      expect(ids).toContain("provider-b");
      expect(ids).toContain("provider-c");
    });
  });

  describe("clearProviders", () => {
    it("removes all registered providers", () => {
      registerProvider("temp", () => createMockProvider("temp", "Temp"));
      expect(getAvailableProviders()).toHaveLength(1);

      clearProviders();
      expect(getAvailableProviders()).toHaveLength(0);
    });
  });

  describe("LLMProvider interface", () => {
    it("supports optional checkUsage method", async () => {
      const provider = createMockProvider("test", "Test");
      expect(provider.checkUsage).toBeUndefined();
    });

    it("supports optional dispose method", async () => {
      const provider = createMockProvider("test", "Test");
      expect(provider.dispose).toBeUndefined();
    });

    it("execute returns a Result with ExecutionResult", async () => {
      const provider = createMockProvider("test", "Test");
      const result = await provider.execute("test prompt", {
        timeoutMinutes: 60,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stdout).toBe("RAUF_DONE");
        expect(result.value.stderr).toBe("");
        expect(result.value.exitCode).toBe(0);
        expect(result.value.timedOut).toBe(false);
        expect(result.value.durationMs).toBe(100);
      }
    });

    it("validateCredentials returns a Result", () => {
      const provider = createMockProvider("test", "Test");
      const result = provider.validateCredentials();
      expect(result.ok).toBe(true);
    });
  });
});
