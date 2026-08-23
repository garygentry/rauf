import { access, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { err, ErrorCodes, ok } from "@rauf/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessGroupResult } from "../process-group.js";

vi.mock("../process-group.js", () => ({
  spawnProcessGroup: vi.fn(),
  GRACE_PERIOD_MS: 30000,
}));

import { spawnProcessGroup } from "../process-group.js";
import type { AgentStreamEvent } from "../stream-parser.js";
import { CopilotCliProvider } from "./copilot-cli.js";

const mockSpawn = vi.mocked(spawnProcessGroup);
const originalCwd = process.cwd();
const originalCopilotAgent = process.env.COPILOT_AGENT;

const PG_OK: ProcessGroupResult = {
  exitCode: 0,
  stdout: "raw stdout",
  stderr: "raw stderr",
  timedOut: false,
  durationMs: 7,
};

describe("CopilotCliProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockResolvedValue(ok(PG_OK));
    process.env.COPILOT_AGENT = "parent-session";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalCopilotAgent === undefined) delete process.env.COPILOT_AGENT;
    else process.env.COPILOT_AGENT = originalCopilotAgent;
  });

  it("uses the frozen argv, bounded prompt file, sanitized env, and forwarded controls", async () => {
    const prompt = "secret prompt ".repeat(32 * 1024);
    const signal = new AbortController().signal;
    let promptDirectory = "";

    mockSpawn.mockImplementation(async (_command, args) => {
      const bootstrap = args.at(-1)!;
      const match = bootstrap.match(/from (.+\/prompt\.md), follow/);
      expect(match).not.toBeNull();
      const promptPath = join(process.cwd(), match![1]!);
      promptDirectory = dirname(promptPath);
      expect(await readFile(promptPath, "utf-8")).toBe(prompt);
      return ok(PG_OK);
    });

    const provider = new CopilotCliProvider();
    const result = await provider.execute(prompt, {
      timeoutMinutes: 5,
      signal,
      model: "gpt-5",
      env: { COPILOT_DEBUG_NONCE: "remove-me", RAUF_CHILD: "1" },
    });

    expect(result.ok).toBe(true);
    const [command, args, spawnOptions] = mockSpawn.mock.calls[0]!;
    expect(command).toBe("copilot");
    expect(args).toEqual([
      "--no-auto-update",
      "-C",
      process.cwd(),
      "--output-format",
      "json",
      "--stream",
      "on",
      "--allow-tool=read",
      "--allow-tool=write",
      "--allow-tool=shell",
      "--deny-tool=shell(git commit:*)",
      "--deny-tool=shell(git push:*)",
      "--no-ask-user",
      "--no-remote",
      "--no-remote-export",
      "--no-custom-instructions",
      "--disable-builtin-mcps",
      "--model",
      "gpt-5",
      "--prompt",
      expect.stringMatching(
        /^Read the complete instructions from \.rauf-copilot-prompt-[^/]+\/prompt\.md,/,
      ),
    ]);
    expect(args.join(" ")).not.toContain(prompt);
    expect(spawnOptions).toMatchObject({
      cwd: process.cwd(),
      timeoutMs: 5 * 60 * 1000,
      signal,
      replaceEnv: true,
    });
    expect(spawnOptions?.env?.RAUF_CHILD).toBe("1");
    expect(spawnOptions?.env).not.toHaveProperty("COPILOT_AGENT");
    expect(spawnOptions?.env).not.toHaveProperty("COPILOT_DEBUG_NONCE");
    await expect(access(promptDirectory)).rejects.toThrow();
  });

  it("parses split JSONL, preserves process output, and omits an unspecified model", async () => {
    const jsonl = await readFile(
      join(import.meta.dirname, "__fixtures__", "copilot-cli-1.0.78.jsonl"),
      "utf-8",
    );
    mockSpawn.mockImplementation(async (_command, _args, spawnOptions) => {
      spawnOptions.onStdout?.(Buffer.from(jsonl.slice(0, 17)));
      spawnOptions.onStdout?.(Buffer.from(jsonl.slice(17)));
      return ok(PG_OK);
    });
    const events: AgentStreamEvent[] = [];

    const result = await new CopilotCliProvider().execute("go", {
      timeoutMinutes: 1,
      outputFormat: "stream-json",
      onStreamEvent: (event) => events.push(event),
    });

    expect(result).toEqual(
      ok({
        ...PG_OK,
        reconstructedText: "Working on the requested change.\nRAUF_NEEDS_HUMAN:region required",
      }),
    );
    expect(mockSpawn.mock.calls[0]![1]).not.toContain("--model");
    expect(events).toEqual([
      { type: "tool_start", toolName: "bash", blockIndex: 0 },
      { type: "tool_end", blockIndex: 0 },
    ]);
  });

  it("classifies captured failures without claiming a usage preflight", () => {
    const provider = new CopilotCliProvider();

    expect(provider.checkUsage).toBeUndefined();
    expect(
      provider.classifyFailure({
        ...PG_OK,
        exitCode: 1,
        stderr: "Model nonexistent is not supported",
      }),
    ).toEqual({ kind: "invalid_model", exitClass: "infra_error" });
  });

  it.each([
    ["timeout", ok({ ...PG_OK, timedOut: true, exitCode: 1 })],
    ["cancellation", ok({ ...PG_OK, exitCode: 1 })],
    ["spawn failure", err({ code: ErrorCodes.FILE_NOT_FOUND, message: "missing" })],
  ])("removes its prompt file after %s", async (_case, processResult) => {
    let promptDirectory = "";
    mockSpawn.mockImplementation(async (_command, args) => {
      const promptPath = args.at(-1)!.match(/from (.+\/prompt\.md), follow/)![1]!;
      promptDirectory = dirname(join(process.cwd(), promptPath));
      return processResult;
    });

    await new CopilotCliProvider().execute("go", { timeoutMinutes: 1 });

    expect(basename(promptDirectory)).toMatch(/^\.rauf-copilot-prompt-/);
    await expect(access(promptDirectory)).rejects.toThrow();
  });
});
