import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok } from "@rauf/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessGroupResult } from "../process-group.js";

// Mock the shared process-group helper so we can observe argv and drive onStdout.
vi.mock("../process-group.js", () => ({
  spawnProcessGroup: vi.fn(),
  GRACE_PERIOD_MS: 30000,
}));

import { spawnProcessGroup } from "../process-group.js";
import { CodexCliProvider } from "./codex-cli.js";
import type { ClaudeStreamEvent } from "../stream-parser.js";

const mockSpawn = vi.mocked(spawnProcessGroup);

const PG_OK: ProcessGroupResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  durationMs: 1,
};

describe("CodexCliProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockResolvedValue(ok(PG_OK));
  });

  it("identifies as the codex agent", () => {
    const p = new CodexCliProvider();
    expect(p.id).toBe("codex");
  });

  it("builds the corrected argv: --ask-for-approval BEFORE exec, --json in stream mode", async () => {
    const p = new CodexCliProvider();
    await p.execute("the prompt", {
      timeoutMinutes: 30,
      model: "gpt-5-codex",
      outputFormat: "stream-json",
    });

    const [cmd, args] = mockSpawn.mock.calls[0]!;
    expect(cmd).toBe("codex");
    expect(args).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5-codex",
      "the prompt",
    ]);
    // The broken (post-exec) approval placement must never reappear.
    const execIdx = (args as string[]).indexOf("exec");
    expect((args as string[]).indexOf("--ask-for-approval")).toBeLessThan(execIdx);
  });

  it("omits --json (plain mode) and --model when not requested", async () => {
    const p = new CodexCliProvider();
    await p.execute("p", { timeoutMinutes: 1 });

    const [, args] = mockSpawn.mock.calls[0]!;
    expect(args).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "workspace-write",
      "p",
    ]);
  });

  it("parses streamed JSONL into events and a reconstructed final message", async () => {
    const jsonl = readFileSync(
      join(import.meta.dirname, "__fixtures__", "codex-exec-command.jsonl"),
      "utf-8",
    );
    // Drive onStdout with the fixture (split mid-line to exercise the line buffer).
    mockSpawn.mockImplementation(async (_cmd, _args, opts) => {
      const mid = Math.floor(jsonl.length / 2);
      opts?.onStdout?.(Buffer.from(jsonl.slice(0, mid)));
      opts?.onStdout?.(Buffer.from(jsonl.slice(mid)));
      return ok(PG_OK);
    });

    const events: ClaudeStreamEvent[] = [];
    const p = new CodexCliProvider();
    const res = await p.execute("go", {
      timeoutMinutes: 1,
      outputFormat: "stream-json",
      onStreamEvent: (e) => events.push(e),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.reconstructedText).toBe("RAUF_DONE");
    expect(events.some((e) => e.type === "tool_start")).toBe(true);
    expect(events.some((e) => e.type === "token_update")).toBe(true);
  });
});
