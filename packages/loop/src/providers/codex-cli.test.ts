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
import { CodexCliProvider, parseCodexProviderConfig, detectCodexCli } from "./codex-cli.js";
import { createProvider } from "./registry.js";
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
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--model",
      "gpt-5-codex",
      "-",
    ]);
    const [, , spawnOptions] = mockSpawn.mock.calls[0]!;
    expect(spawnOptions?.stdin).toBe("the prompt");
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
      "-c",
      "sandbox_workspace_write.network_access=true",
      "-",
    ]);
    const [, , spawnOptions] = mockSpawn.mock.calls[0]!;
    expect(spawnOptions?.stdin).toBe("p");
  });

  it("keeps large prompts out of argv and delivers them on stdin", async () => {
    const prompt = "x".repeat(256 * 1024);
    const p = new CodexCliProvider();
    await p.execute(prompt, { timeoutMinutes: 1 });

    const [, args, spawnOptions] = mockSpawn.mock.calls[0]!;
    expect((args as string[]).includes(prompt)).toBe(false);
    expect(args.at(-1)).toBe("-");
    expect(spawnOptions?.stdin).toBe(prompt);
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

  describe("describeConfig (#84 item 3 — effective policy in run diagnostics)", () => {
    it("summarizes the default resolved policy", () => {
      expect(new CodexCliProvider().describeConfig()).toBe(
        "sandbox=workspace-write network=true approval=never",
      );
    });

    it("reflects overrides, omitting the network note for non-workspace-write sandboxes", () => {
      expect(new CodexCliProvider({ sandboxMode: "danger-full-access" }).describeConfig()).toBe(
        "sandbox=danger-full-access approval=never",
      );
      expect(new CodexCliProvider({ networkAccess: false }).describeConfig()).toBe(
        "sandbox=workspace-write network=false approval=never",
      );
      expect(new CodexCliProvider({ approvalPolicy: "on-failure" }).describeConfig()).toBe(
        "sandbox=workspace-write network=true approval=on-failure",
      );
    });

    it("includes extraArgs when configured", () => {
      expect(new CodexCliProvider({ extraArgs: ["--profile", "ci"] }).describeConfig()).toBe(
        'sandbox=workspace-write network=true approval=never extraArgs=["--profile","ci"]',
      );
    });
  });

  describe("config-driven argv overrides (#93, #94)", () => {
    it("omits the network-access override for sandboxMode read-only", async () => {
      const p = new CodexCliProvider({ sandboxMode: "read-only" });
      await p.execute("p", { timeoutMinutes: 1 });
      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual(["--ask-for-approval", "never", "exec", "--sandbox", "read-only", "-"]);
    });

    it("omits the network-access override for sandboxMode danger-full-access (already unrestricted)", async () => {
      const p = new CodexCliProvider({ sandboxMode: "danger-full-access" });
      await p.execute("p", { timeoutMinutes: 1 });
      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual([
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "danger-full-access",
        "-",
      ]);
    });

    it("omits the network-access override when networkAccess is explicitly false", async () => {
      const p = new CodexCliProvider({ networkAccess: false });
      await p.execute("p", { timeoutMinutes: 1 });
      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual([
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "workspace-write",
        "-",
      ]);
    });

    it("overrides the approval policy", async () => {
      const p = new CodexCliProvider({ approvalPolicy: "on-failure" });
      await p.execute("p", { timeoutMinutes: 1 });
      const [, args] = mockSpawn.mock.calls[0]!;
      expect((args as string[]).slice(0, 2)).toEqual(["--ask-for-approval", "on-failure"]);
    });

    it("appends extraArgs before --model and the trailing stdin marker", async () => {
      const p = new CodexCliProvider({ extraArgs: ["--profile", "ci"] });
      await p.execute("p", { timeoutMinutes: 1, model: "gpt-5-codex" });
      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual([
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "workspace-write",
        "-c",
        "sandbox_workspace_write.network_access=true",
        "--profile",
        "ci",
        "--model",
        "gpt-5-codex",
        "-",
      ]);
    });
  });

  describe("parseCodexProviderConfig", () => {
    it("defaults to an empty config for undefined/empty input", () => {
      expect(parseCodexProviderConfig(undefined)).toEqual(ok({}));
      expect(parseCodexProviderConfig({})).toEqual(ok({}));
    });

    it("rejects an invalid sandboxMode", () => {
      const res = parseCodexProviderConfig({ sandboxMode: "yolo" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.message).toMatch(/sandboxMode/);
    });

    it("rejects a non-boolean networkAccess", () => {
      const res = parseCodexProviderConfig({ networkAccess: "true" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.message).toMatch(/networkAccess/);
    });

    it("rejects a non-array extraArgs", () => {
      const res = parseCodexProviderConfig({ extraArgs: "--profile ci" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.message).toMatch(/extraArgs/);
    });

    it("accepts a fully-specified valid config", () => {
      const res = parseCodexProviderConfig({
        sandboxMode: "danger-full-access",
        networkAccess: false,
        approvalPolicy: "on-failure",
        extraArgs: ["--profile", "ci"],
      });
      expect(res).toEqual(
        ok({
          sandboxMode: "danger-full-access",
          networkAccess: false,
          approvalPolicy: "on-failure",
          extraArgs: ["--profile", "ci"],
        }),
      );
    });
  });

  describe("factory + detect wiring (#94)", () => {
    it("createProvider('codex', config) threads the config into the constructed provider", async () => {
      const provider = createProvider("codex", { sandboxMode: "read-only" });
      await provider.execute("p", { timeoutMinutes: 1 });
      const [, args] = mockSpawn.mock.calls[0]!;
      expect(args).toEqual(["--ask-for-approval", "never", "exec", "--sandbox", "read-only", "-"]);
    });

    it("createProvider('codex', config) throws on a malformed config", () => {
      expect(() => createProvider("codex", { sandboxMode: "yolo" })).toThrow(/sandboxMode/);
    });

    it("detectCodexCli with no config behaves like the default PATH probe", async () => {
      const result = await detectCodexCli(undefined);
      expect(typeof result.available).toBe("boolean");
    });

    it("detectCodexCli reports unavailable with a clear message for a malformed config", async () => {
      const result = await detectCodexCli({ networkAccess: "yes" });
      expect(result.available).toBe(false);
      expect(result.detail).toMatch(/networkAccess/);
    });
  });
});
