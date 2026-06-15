import { describe, expect, it } from "vitest";

import { STATE_LABELS, getStateLabel, type StateTone } from "./state-labels.js";
import { LoopStateEnumSchema, type LoopStateEnum } from "./schemas.js";

const VALID_TONES: StateTone[] = ["neutral", "info", "success", "warning", "danger"];

describe("STATE_LABELS", () => {
  it("has an entry for every LoopStateEnum value (totality)", () => {
    for (const state of LoopStateEnumSchema.options) {
      const entry = STATE_LABELS[state];
      expect(entry, `missing STATE_LABELS entry for ${state}`).toBeDefined();
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      // The human label must never be the SCREAMING_SNAKE machine form (REQ-VOCAB-06).
      expect(entry.label).not.toBe(state);
      expect(VALID_TONES).toContain(entry.tone);
    }
  });

  it("has exactly the 12 derived states (no extras)", () => {
    expect(Object.keys(STATE_LABELS).sort()).toEqual([...LoopStateEnumSchema.options].sort());
  });

  // Pin the tone for EVERY state, not just the new/renamed ones, so an accidental tone
  // change on an existing state (e.g. ERROR danger→warning) is caught (CANON §4.3, tech-spec §3.5).
  it.each<[LoopStateEnum, StateTone]>([
    ["IDLE", "neutral"],
    ["RUNNING", "info"],
    ["PAUSED", "info"],
    ["COMPLETE", "success"],
    ["PAUSED_HUMAN", "warning"],
    ["LIMIT_REACHED", "warning"],
    ["ERROR", "danger"],
    ["NOT_INSTALLED", "neutral"],
    ["SLEEPING_LIMIT", "warning"],
    ["WEEKLY_LIMIT", "warning"],
    ["REVIEWING", "info"],
    ["PAUSED_USAGE_LIMIT", "warning"],
  ])("pins tone %s → %s", (state, tone) => {
    expect(STATE_LABELS[state].tone).toBe(tone);
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
