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
    for (const id of ["gemini", "copilot", "cursor"]) {
      expect(getPresetConfig(id), `missing preset ${id}`).toBeDefined();
    }
  });
});
