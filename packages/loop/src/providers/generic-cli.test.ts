import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorCodes, ok } from "@rauf/core";
import type { ProcessGroupResult } from "../process-group.js";

// Mock the shared process-group helper before importing the module under test.
vi.mock("../process-group.js", () => ({
  spawnProcessGroup: vi.fn(),
}));

import { spawnProcessGroup } from "../process-group.js";
import { GENERIC_AGENT_ID } from "../constants.js";
import { configToCliAgentConfig, createGenericCliProvider } from "./generic-cli.js";
import { CliAgent } from "./cli-agent.js";

const mockSpawn = vi.mocked(spawnProcessGroup);

const PG_OK: ProcessGroupResult = {
  exitCode: 0,
  stdout: "RAUF_DONE",
  stderr: "",
  timedOut: false,
  durationMs: 10,
};

describe("configToCliAgentConfig", () => {
  it("normalizes a valid record with static buildArgs, modelFlag-from-template, and default displayName", () => {
    const res = configToCliAgentConfig("my-agent", {
      binary: "my-bin",
      args: ["run", "--headless"],
      promptDelivery: "arg",
      nonInteractive: ["--auto-approve"],
      modelFlagTemplate: "--model",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.value;
    expect(c.id).toBe("my-agent");
    expect(c.displayName).toBe("my-agent"); // defaulted from id
    expect(c.binary).toBe("my-bin");
    expect(c.promptDelivery).toBe("arg");
    expect(c.nonInteractive).toEqual(["--auto-approve"]);
    expect(c.buildArgs({})).toEqual(["run", "--headless"]);
    expect(c.modelFlag?.("gpt-5")).toEqual(["--model", "gpt-5"]);
    expect(c.parsesStream).toBeUndefined();
  });

  it("uses raw.displayName when supplied", () => {
    const res = configToCliAgentConfig("x", { binary: "b", displayName: "My Agent" });
    expect(res.ok && res.value.displayName).toBe("My Agent");
  });

  it("applies defaults: args [], promptDelivery 'stdin', nonInteractive []", () => {
    const res = configToCliAgentConfig("x", { binary: "b" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.buildArgs({})).toEqual([]);
    expect(res.value.promptDelivery).toBe("stdin");
    expect(res.value.nonInteractive).toEqual([]);
    expect(res.value.modelFlag).toBeUndefined();
    expect(res.value.env).toBeUndefined();
  });

  it("carries optional env when present", () => {
    const res = configToCliAgentConfig("x", { binary: "b", env: { TOKEN: "abc" } });
    expect(res.ok && res.value.env).toEqual({ TOKEN: "abc" });
  });

  it("rejects a missing binary with err(VALIDATION_ERROR)", () => {
    const res = configToCliAgentConfig("x", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("rejects an empty binary with err(VALIDATION_ERROR)", () => {
    const res = configToCliAgentConfig("x", { binary: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("rejects an invalid promptDelivery with err(VALIDATION_ERROR)", () => {
    const res = configToCliAgentConfig("x", { binary: "b", promptDelivery: "socket" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe("createGenericCliProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockResolvedValue(ok(PG_OK));
  });

  it("builds a CliAgent from a valid providerConfig and honors binary/args/promptDelivery", async () => {
    const provider = createGenericCliProvider({
      binary: "my-agent",
      args: ["run"],
      promptDelivery: "stdin",
      nonInteractive: ["--auto-approve"],
    });

    expect(provider).toBeInstanceOf(CliAgent);
    expect(provider.id).toBe(GENERIC_AGENT_ID);

    await provider.execute("the prompt", { timeoutMinutes: 1 });

    const [cmd, args, opts] = mockSpawn.mock.calls[0]!;
    expect(cmd).toBe("my-agent");
    expect(args).toEqual(["run", "--auto-approve"]);
    expect(opts.stdin).toBe("the prompt"); // stdin delivery, prompt not in argv
  });

  it("throws on a malformed providerConfig (missing binary)", () => {
    expect(() => createGenericCliProvider({})).toThrow(/binary/);
  });

  it("throws when invoked with no config", () => {
    expect(() => createGenericCliProvider(undefined)).toThrow();
  });
});

describe("named-config path (ToolConfig.providers entry)", () => {
  it("builds a CliAgent whose binary equals the config's binary", () => {
    const raw = { binary: "vendor-cli", args: ["chat"], modelFlagTemplate: "-m" };
    const parsed = configToCliAgentConfig("vendor", raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const agent = new CliAgent(parsed.value);
    expect(agent.id).toBe("vendor");
    // the config carries its own binary so the descriptor would PATH-probe it normally
    expect(parsed.value.binary).toBe("vendor-cli");
  });
});
