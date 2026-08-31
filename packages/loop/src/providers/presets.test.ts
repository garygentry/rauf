import { describe, it, expect } from "vitest";

import { getPresetConfig, PRESET_CONFIGS } from "./presets.js";

describe("preset configs", () => {
  // codex is no longer a generic preset — it has a dedicated adapter (CodexCliProvider) with the
  // corrected current argv and JSONL telemetry. See codex-cli.test.ts for its invocation asserts.
  it("does not register codex as a generic preset", () => {
    expect(getPresetConfig("codex")).toBeUndefined();
    expect(PRESET_CONFIGS.some((c) => c.id === "codex")).toBe(false);
  });

  it("still ships the other CLI presets", () => {
    for (const id of ["gemini", "copilot", "cursor", "pi"]) {
      expect(getPresetConfig(id), `missing preset ${id}`).toBeDefined();
    }
  });

  // Real-CLI-verified argv (2026-06-27 and Pi on 2026-07-23) — see the OQ-2 verification block
  // in presets.ts. These literals were checked against the actual binaries (copilot 1.0.65,
  // gemini 0.49.0, cursor-agent 2026.06.26, pi 0.81.1), not just docs, to avoid the codex-class
  // "literal asserts stay green while the real CLI rejects the argv" blind spot.
  it("gemini: --yolo on stdin, -m <model> (headless via non-TTY stdin)", () => {
    const c = getPresetConfig("gemini")!;
    expect(c.binary).toBe("gemini");
    expect(c.promptDelivery).toBe("stdin");
    expect(c.nonInteractive).toEqual(["--yolo"]);
    expect(c.modelFlag?.("gemini-2.5-pro")).toEqual(["-m", "gemini-2.5-pro"]);
  });

  it("copilot: --allow-all-tools on stdin, --model <model> (VERIFIED end-to-end)", () => {
    const c = getPresetConfig("copilot")!;
    expect(c.binary).toBe("copilot");
    expect(c.promptDelivery).toBe("stdin");
    expect(c.nonInteractive).toEqual(["--allow-all-tools"]);
    expect(c.modelFlag?.("gpt-5.4")).toEqual(["--model", "gpt-5.4"]);
  });

  it("cursor: --print (headless trigger) + --force, prompt as arg, --model <model>", () => {
    const c = getPresetConfig("cursor")!;
    expect(c.binary).toBe("cursor-agent");
    expect(c.promptDelivery).toBe("arg");
    // --print MUST be present — without it cursor-agent emits no parseable stdout.
    expect(c.nonInteractive).toEqual(["--print", "--force"]);
    expect(c.modelFlag?.("sonnet-4.6")).toEqual(["--model", "sonnet-4.6"]);
  });

  it("pi: -p print mode + --approve --no-session, prompt via stdin, --model <model>", () => {
    const c = getPresetConfig("pi")!;
    expect(c.binary).toBe("pi");
    expect(c.promptDelivery).toBe("stdin");
    expect(c.buildArgs({})).toEqual(["-p"]);
    expect(c.nonInteractive).toEqual(["--approve", "--no-session"]);
    expect(c.nonInteractive).not.toContain("--no-tools");
    expect(c.modelFlag?.("sonnet-4.6")).toEqual(["--model", "sonnet-4.6"]);
  });
});
