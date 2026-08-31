import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err, ErrorCodes } from "@rauf/core";
import type { ProcessGroupResult } from "../process-group.js";

// Mock the shared process-group helper before importing the module under test.
vi.mock("../process-group.js", () => ({
  spawnProcessGroup: vi.fn(),
}));

// Mock fs so file-delivery write/unlink are observable and controllable.
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { spawnProcessGroup } from "../process-group.js";
import { writeFile, unlink } from "node:fs/promises";
import { CliAgent, type CliAgentConfig } from "./cli-agent.js";

const mockSpawn = vi.mocked(spawnProcessGroup);
const mockWriteFile = vi.mocked(writeFile);
const mockUnlink = vi.mocked(unlink);

const PG_OK: ProcessGroupResult = {
  exitCode: 0,
  stdout: "RAUF_DONE",
  stderr: "",
  timedOut: false,
  durationMs: 1234,
};

function baseConfig(overrides: Partial<CliAgentConfig> = {}): CliAgentConfig {
  return {
    id: "codex",
    displayName: "OpenAI Codex (CLI)",
    binary: "codex",
    promptDelivery: "arg",
    buildArgs: () => ["exec"],
    nonInteractive: ["--full-auto"],
    modelFlag: (m) => ["--model", m],
    ...overrides,
  };
}

describe("CliAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockResolvedValue(ok(PG_OK));
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  it("exposes id/displayName from config and omits checkUsage and dispose", () => {
    const agent = new CliAgent(baseConfig());
    expect(agent.id).toBe("codex");
    expect(agent.displayName).toBe("OpenAI Codex (CLI)");
    expect((agent as { checkUsage?: unknown }).checkUsage).toBeUndefined();
    expect((agent as { dispose?: unknown }).dispose).toBeUndefined();
  });

  it("validateCredentials returns ok(undefined) without spawning", () => {
    const agent = new CliAgent(baseConfig());
    const res = agent.validateCredentials();
    expect(res.ok).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  describe("argv assembly", () => {
    it("orders buildArgs → nonInteractive → modelFlag, then appends prompt last for 'arg'", async () => {
      const agent = new CliAgent(baseConfig());
      await agent.execute("the prompt", { timeoutMinutes: 30, model: "gpt-5" });

      const [cmd, args] = mockSpawn.mock.calls[0]!;
      expect(cmd).toBe("codex");
      expect(args).toEqual(["exec", "--full-auto", "--model", "gpt-5", "the prompt"]);
    });

    it("omits the model flag when no model is resolved", async () => {
      const agent = new CliAgent(baseConfig());
      await agent.execute("p", { timeoutMinutes: 1 });

      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual(["exec", "--full-auto", "p"]);
    });

    it("omits the model flag when config has no modelFlag even if a model is resolved", async () => {
      const agent = new CliAgent(baseConfig({ modelFlag: undefined }));
      await agent.execute("p", { timeoutMinutes: 1, model: "gpt-5" });

      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual(["exec", "--full-auto", "p"]);
    });

    it("always includes nonInteractive flags", async () => {
      const agent = new CliAgent(baseConfig({ nonInteractive: ["--yolo", "--no-confirm"] }));
      await agent.execute("p", { timeoutMinutes: 1 });

      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toContain("--yolo");
      expect(args).toContain("--no-confirm");
    });
  });

  describe("prompt delivery", () => {
    it("'stdin' passes the prompt as stdin and does not append it to argv", async () => {
      const agent = new CliAgent(
        baseConfig({ promptDelivery: "stdin", buildArgs: () => [], modelFlag: undefined }),
      );
      await agent.execute("piped prompt", { timeoutMinutes: 1 });

      const [, args, opts] = mockSpawn.mock.calls[0]!;
      expect(opts.stdin).toBe("piped prompt");
      expect(args).not.toContain("piped prompt");
    });

    it("'stdin' delivers a large prompt (exceeding typical OS argv limits) via stdin, never argv", async () => {
      // Regression for GH #90: a Pi-style preset passed the entire prompt as one argv element,
      // which fails with E2BIG on large aggregated prompts (e.g. the post-loop review prompt).
      // Sized well past typical per-argument limits (ARG_MAX is commonly ~128KB-2MB, but a single
      // argv element can trip much smaller effective limits first).
      const largePrompt = "x".repeat(500_000);
      const agent = new CliAgent(
        baseConfig({ promptDelivery: "stdin", buildArgs: () => [], modelFlag: undefined }),
      );
      await agent.execute(largePrompt, { timeoutMinutes: 1 });

      const [, args, opts] = mockSpawn.mock.calls[0]!;
      expect(opts.stdin).toBe(largePrompt);
      expect(args).not.toContain(largePrompt);
      expect(args.join(" ")).not.toContain(largePrompt);
    });

    it("'arg' passes no stdin and appends the prompt", async () => {
      const agent = new CliAgent(baseConfig());
      await agent.execute("arg prompt", { timeoutMinutes: 1 });

      const [, args, opts] = mockSpawn.mock.calls[0]!;
      expect(opts.stdin).toBeUndefined();
      expect(args[args.length - 1]).toBe("arg prompt");
    });

    it("'file' writes a temp file inside cwd, passes its path via ctx.promptFile, no stdin, and unlinks", async () => {
      const agent = new CliAgent(
        baseConfig({
          promptDelivery: "file",
          buildArgs: (ctx) => ["--prompt-file", ctx.promptFile!],
          modelFlag: undefined,
        }),
      );
      await agent.execute("file prompt", { timeoutMinutes: 1 });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writtenPath = mockWriteFile.mock.calls[0]![0] as string;
      // Temp file lives inside the sandbox cwd (ROOT_DIRECTORY).
      expect(writtenPath.startsWith(process.cwd())).toBe(true);

      const [, args, opts] = mockSpawn.mock.calls[0]!;
      expect(args).toContain("--prompt-file");
      expect(args).toContain(writtenPath);
      expect(opts.stdin).toBeUndefined();

      expect(mockUnlink).toHaveBeenCalledWith(writtenPath);
    });

    it("'file' delivery unlinks the temp file even when spawn fails", async () => {
      mockSpawn.mockResolvedValue(err({ code: ErrorCodes.FILE_NOT_FOUND, message: "boom" }));
      const agent = new CliAgent(
        baseConfig({
          promptDelivery: "file",
          buildArgs: (ctx) => ["--prompt-file", ctx.promptFile!],
          modelFlag: undefined,
        }),
      );
      const res = await agent.execute("file prompt", { timeoutMinutes: 1 });

      expect(res.ok).toBe(false);
      expect(mockUnlink).toHaveBeenCalledTimes(1);
    });

    it("'file' write failure returns err(IO_ERROR) before spawning", async () => {
      mockWriteFile.mockRejectedValue(new Error("disk full"));
      const agent = new CliAgent(
        baseConfig({ promptDelivery: "file", buildArgs: () => [], modelFlag: undefined }),
      );
      const res = await agent.execute("p", { timeoutMinutes: 1 });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe(ErrorCodes.IO_ERROR);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe("option forwarding & env merge", () => {
    it("forwards timeoutMs and signal", async () => {
      const signal = AbortSignal.timeout(60000);
      const agent = new CliAgent(baseConfig());
      await agent.execute("p", { timeoutMinutes: 5, signal });

      const [, , opts] = mockSpawn.mock.calls[0]!;
      expect(opts.timeoutMs).toBe(5 * 60 * 1000);
      expect(opts.signal).toBe(signal);
    });

    it("merges options.env OVER config.env", async () => {
      const agent = new CliAgent(baseConfig({ env: { A: "1", B: "2" } }));
      await agent.execute("p", { timeoutMinutes: 1, env: { B: "override", C: "3" } });

      const [, , opts] = mockSpawn.mock.calls[0]!;
      expect(opts.env).toEqual({ A: "1", B: "override", C: "3" });
    });

    it("leaves env undefined when neither config.env nor options.env is set", async () => {
      const agent = new CliAgent(baseConfig());
      await agent.execute("p", { timeoutMinutes: 1 });

      const [, , opts] = mockSpawn.mock.calls[0]!;
      expect(opts.env).toBeUndefined();
    });
  });

  describe("result assembly", () => {
    it("returns plain-text result with telemetry fields unset", async () => {
      const agent = new CliAgent(baseConfig());
      const res = await agent.execute("p", { timeoutMinutes: 1 });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.stdout).toBe("RAUF_DONE");
        expect(res.value.exitCode).toBe(0);
        expect(res.value.reconstructedText).toBeUndefined();
        expect(res.value.parsedSignal).toBeUndefined();
        expect(res.value.progressEvents).toBeUndefined();
      }
    });

    it("returns nonzero exit as ok-data, not an error", async () => {
      mockSpawn.mockResolvedValue(ok({ ...PG_OK, exitCode: 7, stdout: "fail" }));
      const agent = new CliAgent(baseConfig());
      const res = await agent.execute("p", { timeoutMinutes: 1 });

      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.exitCode).toBe(7);
    });

    it("returns timedOut as ok-data, not an error", async () => {
      mockSpawn.mockResolvedValue(ok({ ...PG_OK, timedOut: true }));
      const agent = new CliAgent(baseConfig());
      const res = await agent.execute("p", { timeoutMinutes: 1 });

      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.timedOut).toBe(true);
    });

    it("propagates spawn failure as err(FILE_NOT_FOUND)", async () => {
      mockSpawn.mockResolvedValue(
        err({ code: ErrorCodes.FILE_NOT_FOUND, message: "Failed to spawn codex" }),
      );
      const agent = new CliAgent(baseConfig());
      const res = await agent.execute("p", { timeoutMinutes: 1 });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    });
  });
});
