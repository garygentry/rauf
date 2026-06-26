import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok } from "@rauf/core";
import type { ProcessGroupResult } from "../process-group.js";

// Mock the shared process-group helper so we can observe the assembled argv.
vi.mock("../process-group.js", () => ({
  spawnProcessGroup: vi.fn(),
}));

import { spawnProcessGroup } from "../process-group.js";
import { CliAgent } from "./cli-agent.js";
import { getPresetConfig } from "./presets.js";

const mockSpawn = vi.mocked(spawnProcessGroup);

const PG_OK: ProcessGroupResult = {
  exitCode: 0,
  stdout: "RAUF_DONE",
  stderr: "",
  timedOut: false,
  durationMs: 1,
};

describe("preset configs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockResolvedValue(ok(PG_OK));
  });

  describe("codex", () => {
    it("uses `codex exec` with explicit sandbox/approval flags (no deprecated --full-auto)", async () => {
      const config = getPresetConfig("codex");
      expect(config).toBeDefined();
      // Guard against regressing to the deprecated automation flag.
      expect(config!.nonInteractive).not.toContain("--full-auto");

      const agent = new CliAgent(config!);
      await agent.execute("the prompt", { timeoutMinutes: 30, model: "gpt-5-codex" });

      const [cmd, args] = mockSpawn.mock.calls[0]!;
      expect(cmd).toBe("codex");
      expect(args).toEqual([
        "exec",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "--model",
        "gpt-5-codex",
        "the prompt",
      ]);
    });

    it("omits the --model flag when no model is resolved", async () => {
      const agent = new CliAgent(getPresetConfig("codex")!);
      await agent.execute("p", { timeoutMinutes: 1 });

      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual([
        "exec",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "p",
      ]);
    });
  });
});
