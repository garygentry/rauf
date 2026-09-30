import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUCK_THRESHOLD_MS,
  DEFAULT_TOOL_STUCK_THRESHOLD_MS,
  StuckDetector,
} from "./stuck-detector.js";

const MIN = 60_000;
const DEFAULTS = {
  stuckThresholdMs: DEFAULT_STUCK_THRESHOLD_MS,
  toolStuckThresholdMs: DEFAULT_TOOL_STUCK_THRESHOLD_MS,
};

const start = (toolName: string, toolUseId?: string, blockIndex = 0) => ({
  type: "tool_start" as const,
  toolName,
  blockIndex,
  ...(toolUseId !== undefined ? { toolUseId } : {}),
});
const end = (toolUseId?: string, blockIndex = 0) => ({
  type: "tool_end" as const,
  blockIndex,
  ...(toolUseId !== undefined ? { toolUseId } : {}),
});

describe("StuckDetector (#141)", () => {
  it("defaults: 5 minutes of LLM silence, 30 minutes with a tool in flight", () => {
    expect(DEFAULT_STUCK_THRESHOLD_MS).toBe(5 * MIN);
    expect(DEFAULT_TOOL_STUCK_THRESHOLD_MS).toBe(30 * MIN);
  });

  it("warns at 5 minutes of silence with no tool in flight, as before", () => {
    const d = new StuckDetector(DEFAULTS, 0);
    expect(d.check(5 * MIN - 1)).toBeNull();
    expect(d.check(5 * MIN)).toEqual({ silentMs: 5 * MIN, currentTool: null, toolRunningMs: null });
  });

  it("does not warn at 5 minutes while a long tool call is in flight", () => {
    const d = new StuckDetector(DEFAULTS, 0);
    d.recordActivity(1_000);
    d.toolStarted(start("Bash", "toolu_1"), 1_000);
    expect(d.check(1_000 + 5 * MIN)).toBeNull();
    expect(d.check(1_000 + 29 * MIN)).toBeNull();
  });

  it("still warns once the tool ceiling passes, naming the tool and its runtime", () => {
    const d = new StuckDetector(DEFAULTS, 0);
    d.recordActivity(1_000);
    d.toolStarted(start("Bash", "toolu_1"), 1_000);
    expect(d.check(1_000 + 30 * MIN)).toEqual({
      silentMs: 30 * MIN,
      currentTool: "Bash",
      toolRunningMs: 30 * MIN,
    });
  });

  it("reports toolRunningMs from the tool's start even when later activity reset the silence clock", () => {
    const d = new StuckDetector({ stuckThresholdMs: 100, toolStuckThresholdMs: 1_000 }, 0);
    d.toolStarted(start("Task", "t"), 0);
    d.recordActivity(500); // e.g. a nested event, tool still running
    const w = d.check(1_500);
    expect(w).toEqual({ silentMs: 1_000, currentTool: "Task", toolRunningMs: 1_500 });
  });

  it("returns to the normal threshold once the tool ends", () => {
    const d = new StuckDetector(DEFAULTS, 0);
    d.toolStarted(start("Bash", "toolu_1"), 0);
    d.recordActivity(10 * MIN);
    expect(d.toolEnded(end("toolu_1"))).toBe("Bash");
    expect(d.currentTool()).toBeNull();
    expect(d.check(15 * MIN)).toMatchObject({ currentTool: null, silentMs: 5 * MIN });
  });

  it("fires at most once per silence episode and re-arms on activity", () => {
    const d = new StuckDetector({ stuckThresholdMs: 100, toolStuckThresholdMs: 100 }, 0);
    expect(d.check(100)).not.toBeNull();
    expect(d.check(500)).toBeNull();
    d.recordActivity(600);
    expect(d.check(650)).toBeNull();
    expect(d.check(700)).not.toBeNull();
  });

  it("honors configured thresholds", () => {
    const d = new StuckDetector({ stuckThresholdMs: 2 * MIN, toolStuckThresholdMs: 10 * MIN }, 0);
    expect(d.check(2 * MIN)).not.toBeNull();

    const t = new StuckDetector({ stuckThresholdMs: 2 * MIN, toolStuckThresholdMs: 10 * MIN }, 0);
    t.toolStarted(start("Bash", "a"), 0);
    expect(t.check(9 * MIN)).toBeNull();
    expect(t.check(10 * MIN)).toMatchObject({ currentTool: "Bash" });
  });

  it("never lets a tool in flight warn earlier than plain silence", () => {
    const d = new StuckDetector({ stuckThresholdMs: 10 * MIN, toolStuckThresholdMs: 1 * MIN }, 0);
    d.toolStarted(start("Bash", "a"), 0);
    expect(d.check(5 * MIN)).toBeNull();
    expect(d.check(10 * MIN)).not.toBeNull();
  });

  it("tracks parallel tools: currentTool is the most recent one still running", () => {
    const d = new StuckDetector(DEFAULTS, 0);
    d.toolStarted(start("Bash", "a"), 0);
    d.toolStarted(start("Read", "b"), 10);
    expect(d.currentTool()?.toolName).toBe("Read");
    d.toolEnded(end("b"));
    expect(d.currentTool()).toEqual({ toolName: "Bash", startedAt: 0 });
    d.toolEnded(end("a"));
    expect(d.currentTool()).toBeNull();
  });

  it("pairs by blockIndex when the provider gives no tool id, and ignores unmatched ends", () => {
    const d = new StuckDetector(DEFAULTS, 0);
    d.toolStarted(start("Edit", undefined, 3), 0);
    expect(d.toolEnded(end(undefined, 9))).toBeUndefined();
    expect(d.currentTool()?.toolName).toBe("Edit");
    expect(d.toolEnded(end(undefined, 3))).toBe("Edit");
    expect(d.currentTool()).toBeNull();
  });

  it("polls at most once a minute, sooner for short thresholds", () => {
    expect(StuckDetector.checkIntervalMs(DEFAULTS)).toBe(MIN);
    expect(
      StuckDetector.checkIntervalMs({ stuckThresholdMs: 200, toolStuckThresholdMs: 900 }),
    ).toBe(200);
    expect(StuckDetector.checkIntervalMs({ stuckThresholdMs: 1, toolStuckThresholdMs: 1 })).toBe(
      50,
    );
  });
});
