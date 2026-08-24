import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LLMProvider } from "./types.js";
import {
  clearProviders,
  createProvider,
  getAvailableProviders,
  registerProvider,
  registerAgent,
  getAgentDescriptors,
  listAgents,
  detectAgent,
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

const originalPath = process.env.PATH;

describe("provider registry", () => {
  afterEach(() => {
    clearProviders();
    process.env.PATH = originalPath;
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

  describe("registerAgent + descriptors", () => {
    it("populates both factory and descriptor maps", () => {
      registerAgent({
        id: "codex",
        displayName: "OpenAI Codex (CLI)",
        binaryName: "codex",
        factory: () => createMockProvider("codex", "OpenAI Codex (CLI)"),
      });

      expect(getAvailableProviders()).toContain("codex");
      const descriptors = getAgentDescriptors();
      expect(descriptors.map((d) => d.id)).toContain("codex");
      const codex = descriptors.find((d) => d.id === "codex");
      expect(codex?.displayName).toBe("OpenAI Codex (CLI)");
      expect(codex?.binaryName).toBe("codex");
      // createProvider works via the factory written by registerAgent
      expect(createProvider("codex").id).toBe("codex");
    });

    it("last write wins per id", () => {
      registerAgent({
        id: "dup",
        displayName: "First",
        binaryName: "first",
        factory: () => createMockProvider("dup", "First"),
      });
      registerAgent({
        id: "dup",
        displayName: "Second",
        binaryName: "second",
        factory: () => createMockProvider("dup", "Second"),
      });

      const descriptors = getAgentDescriptors();
      const matches = descriptors.filter((d) => d.id === "dup");
      expect(matches).toHaveLength(1);
      expect(matches[0]?.displayName).toBe("Second");
      expect(matches[0]?.binaryName).toBe("second");
    });

    it("registerProvider synthesizes a descriptor (back-compat)", () => {
      registerProvider("legacy", () => createMockProvider("legacy", "Legacy"));

      const descriptors = getAgentDescriptors();
      const legacy = descriptors.find((d) => d.id === "legacy");
      expect(legacy).toBeDefined();
      expect(legacy?.displayName).toBe("legacy");
      expect(legacy?.binaryName).toBe("legacy");
      expect(legacy?.detect).toBeUndefined();
    });

    it("registerAgent overwrites a synthesized descriptor for the same id", () => {
      registerProvider("foo", () => createMockProvider("foo", "foo"));
      registerAgent({
        id: "foo",
        displayName: "Friendly Foo",
        binaryName: "foo-bin",
        factory: () => createMockProvider("foo", "Friendly Foo"),
      });

      const foo = getAgentDescriptors().find((d) => d.id === "foo");
      expect(foo?.displayName).toBe("Friendly Foo");
      expect(foo?.binaryName).toBe("foo-bin");
    });

    it("getAgentDescriptors is synchronous, in registration order, with no available field", () => {
      registerProvider("a", () => createMockProvider("a", "A"));
      registerProvider("b", () => createMockProvider("b", "B"));
      registerProvider("c", () => createMockProvider("c", "C"));

      const descriptors = getAgentDescriptors();
      expect(descriptors.map((d) => d.id)).toEqual(["a", "b", "c"]);
      for (const d of descriptors) {
        expect(d).not.toHaveProperty("available");
      }
    });

    it("descriptor id set equals getAvailableProviders", () => {
      registerProvider("p1", () => createMockProvider("p1", "P1"));
      registerAgent({
        id: "p2",
        displayName: "P2",
        binaryName: "p2",
        factory: () => createMockProvider("p2", "P2"),
      });

      const descriptorIds = getAgentDescriptors()
        .map((d) => d.id)
        .sort();
      const providerIds = [...getAvailableProviders()].sort();
      expect(descriptorIds).toEqual(providerIds);
    });

    it("clearProviders clears both maps", () => {
      registerAgent({
        id: "temp",
        displayName: "Temp",
        binaryName: "temp",
        factory: () => createMockProvider("temp", "Temp"),
      });
      expect(getAgentDescriptors()).toHaveLength(1);
      expect(getAvailableProviders()).toHaveLength(1);

      clearProviders();
      expect(getAgentDescriptors()).toHaveLength(0);
      expect(getAvailableProviders()).toHaveLength(0);
    });
  });

  describe("detectAgent", () => {
    it("resolves available when the binary is found on PATH (X_OK)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "rauf-probe-"));
      try {
        const binPath = join(dir, "mybin");
        writeFileSync(binPath, "#!/bin/sh\n");
        chmodSync(binPath, 0o755);
        process.env.PATH = dir;

        registerAgent({
          id: "mybin-agent",
          displayName: "My Bin",
          binaryName: "mybin",
          factory: () => createMockProvider("mybin-agent", "My Bin"),
        });

        const result = await detectAgent("mybin-agent");
        expect(result.available).toBe(true);
        expect(result.binaryAvailable).toBe(true);
        expect(result.authenticated).toBeNull();
        expect(result.detail).toBe(`found at ${binPath}; authentication not checked`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("resolves not-found when the binary is absent from PATH", async () => {
      const dir = mkdtempSync(join(tmpdir(), "rauf-probe-"));
      try {
        process.env.PATH = dir;
        registerAgent({
          id: "ghost-agent",
          displayName: "Ghost",
          binaryName: "ghost-binary-xyz",
          factory: () => createMockProvider("ghost-agent", "Ghost"),
        });

        const result = await detectAgent("ghost-agent");
        expect(result.available).toBe(false);
        expect(result.binaryAvailable).toBe(false);
        expect(result.authenticated).toBeNull();
        expect(result.detail).toBe('binary "ghost-binary-xyz" not found on PATH');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("uses a descriptor's detect override (claude-style credential check)", async () => {
      registerAgent({
        id: "cred-agent",
        displayName: "Cred",
        binaryName: "cred",
        factory: () => createMockProvider("cred-agent", "Cred"),
        detect: async () => ({ available: true, detail: "credentials present" }),
      });

      const result = await detectAgent("cred-agent");
      expect(result.available).toBe(true);
      expect(result.detail).toBe("credentials present");
    });

    it("never throws when a detect override throws", async () => {
      registerAgent({
        id: "boom-agent",
        displayName: "Boom",
        binaryName: "boom",
        factory: () => createMockProvider("boom-agent", "Boom"),
        detect: async () => {
          throw new Error("detector exploded");
        },
      });

      const result = await detectAgent("boom-agent");
      expect(result.available).toBe(false);
      expect(result.detail).toBe("detector exploded");
    });

    it("resolves (does not throw) for an unknown id with a supported-agents list", async () => {
      registerProvider("known", () => createMockProvider("known", "Known"));

      const result = await detectAgent("nope");
      expect(result.available).toBe(false);
      expect(result.detail).toBe('Unknown agent "nope". Supported agents: known.');
    });
  });

  describe("listAgents", () => {
    it("returns AgentAvailability rows with availability resolved", async () => {
      const dir = mkdtempSync(join(tmpdir(), "rauf-probe-"));
      try {
        const binPath = join(dir, "present");
        writeFileSync(binPath, "#!/bin/sh\n");
        chmodSync(binPath, 0o755);
        process.env.PATH = dir;

        registerAgent({
          id: "present-agent",
          displayName: "Present",
          binaryName: "present",
          factory: () => createMockProvider("present-agent", "Present"),
        });
        registerAgent({
          id: "absent-agent",
          displayName: "Absent",
          binaryName: "absent-xyz",
          factory: () => createMockProvider("absent-agent", "Absent"),
        });

        const rows = await listAgents();
        expect(rows.map((r) => r.id)).toEqual(["present-agent", "absent-agent"]);
        const present = rows.find((r) => r.id === "present-agent");
        const absent = rows.find((r) => r.id === "absent-agent");
        expect(present?.available).toBe(true);
        expect(present?.binaryAvailable).toBe(true);
        expect(present?.authenticated).toBeNull();
        expect(present?.binaryName).toBe("present");
        expect(absent?.available).toBe(false);
        expect(absent?.binaryAvailable).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("never rejects even when a detector throws", async () => {
      registerAgent({
        id: "throwing",
        displayName: "Throwing",
        binaryName: "throwing",
        factory: () => createMockProvider("throwing", "Throwing"),
        detect: async () => {
          throw new Error("nope");
        },
      });

      const rows = await listAgents();
      const row = rows.find((r) => r.id === "throwing");
      expect(row?.available).toBe(false);
      expect(row?.detail).toBe("nope");
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
