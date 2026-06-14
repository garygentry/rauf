import { describe, expect, it } from "vitest";

import { STATE_LABELS, getStateLabel, type StateTone } from "./state-labels.js";
import { LoopStateEnumSchema } from "./schemas.js";

const VALID_TONES: StateTone[] = ["neutral", "info", "success", "warning", "danger"];

describe("STATE_LABELS", () => {
  it("has an entry for every LoopStateEnum value (totality)", () => {
    for (const state of LoopStateEnumSchema.options) {
      const entry = STATE_LABELS[state];
      expect(entry, `missing STATE_LABELS entry for ${state}`).toBeDefined();
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(VALID_TONES).toContain(entry.tone);
    }
  });

  it("has exactly the 12 derived states (no extras)", () => {
    expect(Object.keys(STATE_LABELS).sort()).toEqual([...LoopStateEnumSchema.options].sort());
  });

  it("pins labels + tones for the new and renamed states (CANON §4.3)", () => {
    expect(STATE_LABELS.REVIEWING).toEqual({ label: "Reviewing", tone: "info" });
    expect(STATE_LABELS.PAUSED_USAGE_LIMIT).toEqual({
      label: "Usage Limit (Paused)",
      tone: "warning",
    });
    expect(STATE_LABELS.PAUSED_HUMAN).toEqual({ label: "Needs Human", tone: "warning" });
  });
});

describe("getStateLabel", () => {
  it("never returns undefined for any enum value", () => {
    for (const state of LoopStateEnumSchema.options) {
      const label = getStateLabel(state);
      expect(label).toBeDefined();
      expect(label).toEqual(STATE_LABELS[state]);
    }
  });
});
