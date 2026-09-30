import { describe, expect, it } from "vitest";

import { StreamParser, type ClaudeStreamEvent } from "./stream-parser.js";
import {
  DEFAULT_STUCK_THRESHOLD_MS,
  DEFAULT_TOOL_STUCK_THRESHOLD_MS,
  StuckDetector,
  type StuckThresholds,
} from "./stuck-detector.js";

const MIN = 60_000;
const DEFAULTS: StuckThresholds = {
  stuckThresholdMs: DEFAULT_STUCK_THRESHOLD_MS,
  toolStuckThresholdMs: DEFAULT_TOOL_STUCK_THRESHOLD_MS,
};

/**
 * Drives a detector from real Claude CLI stream-json lines through the real
 * StreamParser, with a controllable clock — the same wiring the runner uses.
 */
function harness(thresholds: StuckThresholds = DEFAULTS) {
  let now = 0;
  const detector = new StuckDetector(thresholds, now);
  const events: ClaudeStreamEvent[] = [];
  const parser = new StreamParser((e) => {
    events.push(e);
    detector.onEvent(e, now);
  });
  return {
    detector,
    events,
    parser,
    at(ms: number) {
      now = ms;
      return this;
    },
    feed(obj: unknown) {
      parser.feed(JSON.stringify(obj));
      return this;
    },
    check(ms: number) {
      return detector.check(ms);
    },
  };
}

const usage = { input_tokens: 100, output_tokens: 10 };
const toolUse = (msgId: string, id: string, name: string, parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { id: msgId, content: [{ type: "tool_use", id, name, input: {} }], usage },
});
const text = (msgId: string, t: string, parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { id: msgId, content: [{ type: "text", text: t }], usage },
});
const result = (id: string, parent: string | null = null) => ({
  type: "user",
  parent_tool_use_id: parent,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
});

describe("StuckDetector (#141)", () => {
  it("defaults: 5 minutes of silence, 30-minute ceiling for a quiet tool in flight", () => {
    expect(DEFAULT_STUCK_THRESHOLD_MS).toBe(5 * MIN);
    expect(DEFAULT_TOOL_STUCK_THRESHOLD_MS).toBe(30 * MIN);
  });

  it("warns at 5 minutes of silence with no tool in flight, as before", () => {
    const h = harness().at(0).feed(text("m1", "thinking"));
    expect(h.check(5 * MIN - 1)).toBeNull();
    expect(h.check(5 * MIN)).toEqual({ silentMs: 5 * MIN, currentTool: null, toolRunningMs: null });
  });

  it("does not warn at 5 minutes while a quiet tool call is in flight", () => {
    const h = harness()
      .at(1_000)
      .feed(toolUse("m1", "toolu_1", "Bash"));
    expect(h.check(1_000 + 5 * MIN)).toBeNull();
    expect(h.check(1_000 + 29 * MIN)).toBeNull();
  });

  it("warns once the quiet tool has run for the ceiling, naming it", () => {
    const h = harness()
      .at(1_000)
      .feed(toolUse("m1", "toolu_1", "Bash"));
    expect(h.check(1_000 + 30 * MIN)).toEqual({
      silentMs: 30 * MIN,
      currentTool: "Bash",
      toolRunningMs: 30 * MIN,
    });
  });

  it("measures the ceiling from the tool's start: later activity does not extend it", () => {
    // A sibling call finishing at 28 min resets the silence clock but not the ceiling:
    // the warning fires as soon as there have been 5 min of silence past the ceiling.
    const h = harness()
      .at(0)
      .feed({
        type: "assistant",
        message: {
          id: "m1",
          content: [
            { type: "tool_use", id: "long", name: "Bash", input: {} },
            { type: "tool_use", id: "quick", name: "Read", input: {} },
          ],
          usage,
        },
      })
      .at(28 * MIN)
      .feed(result("quick"));
    expect(h.check(30 * MIN)).toBeNull(); // past the ceiling, but only 2 min silent
    expect(h.check(33 * MIN)).toEqual({
      silentMs: 5 * MIN,
      currentTool: "Bash",
      toolRunningMs: 33 * MIN,
    });
  });

  it("a lost tool_result then a model hang warns at 5 minutes (reconciled at the next message)", () => {
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "toolu_lost", "Bash"))
      // …its tool_result line never arrives (malformed / unrecognized)…
      .at(2 * MIN)
      .feed(text("m2", "Now let me think about the next step"));
    // The new top-level message closed the lost call, so the model is on its own.
    expect(h.events).toContainEqual({
      type: "tool_end",
      blockIndex: 0,
      toolUseId: "toolu_lost",
      reason: "reconciled",
    });
    expect(h.detector.currentTool()).toBeNull();
    expect(h.check(2 * MIN + 5 * MIN)).toEqual({
      silentMs: 5 * MIN,
      currentTool: null,
      toolRunningMs: null,
    });
  });

  it("parallel calls: one ending keeps the other quiet tool in flight", () => {
    // The CLI emits each tool_use block as its own assistant event (same message id,
    // usage on each), so the calls' starts interleave with token updates.
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "gate", "Bash"))
      .at(1_000)
      .feed(toolUse("m1", "ls", "Bash"))
      .at(3_000)
      .feed(result("ls"));
    expect(h.detector.currentTool()?.toolName).toBe("Bash");
    expect(h.check(3_000 + 10 * MIN)).toBeNull();
    expect(h.check(30 * MIN)).toMatchObject({ currentTool: "Bash", toolRunningMs: 30 * MIN });
  });

  it("nested Task: a quiet nested tool gets the ceiling; a silent subagent gets 5 minutes", () => {
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "task", "Task"))
      .at(1_000)
      .feed(text("s1", "Subagent starting", "task"))
      .at(2_000)
      .feed(toolUse("s1", "nested_bash", "Bash", "task"));
    // The quiet nested Bash explains the silence.
    expect(h.check(2_000 + 10 * MIN)).toBeNull();

    h.at(4 * MIN).feed(result("nested_bash", "task"));
    // Nested Bash is done; the Task has a live subagent, so it is a model, not a quiet
    // tool: its silence is a model hang at the normal threshold.
    expect(h.detector.currentTool()?.toolName).toBe("Task");
    expect(h.check(4 * MIN + 5 * MIN)).toEqual({
      silentMs: 5 * MIN,
      currentTool: null,
      toolRunningMs: null,
    });
  });

  it("nested Task: a lost nested result is reconciled by the subagent's next message", () => {
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "task", "Task"))
      .feed(toolUse("s1", "nested", "Grep", "task"))
      .at(MIN)
      .feed(text("s2", "moving on", "task"));
    expect(h.events).toContainEqual({
      type: "tool_end",
      blockIndex: 0,
      toolUseId: "nested",
      reason: "reconciled",
    });
    // Only the (model-driven) Task is left; a subagent hang warns at 5 minutes.
    expect(h.check(MIN + 5 * MIN)).toMatchObject({ currentTool: null });
  });

  it("nested Task: a result for a nested call whose start was lost still marks the subagent live", () => {
    // Reproduction (round-2 review): Task starts, the nested tool's assistant/start line
    // is lost, but its tool_result arrives with parent_tool_use_id; the subagent hangs.
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "task", "Task"))
      .at(2 * MIN)
      .feed(result("lost_child", "task"));
    expect(h.events.at(-1)).toEqual({ type: "stream_activity", parentToolUseId: "task" });
    // The result reset the silence clock…
    expect(h.check(2 * MIN + 5 * MIN - 1)).toBeNull();
    // …and the Task is a live subagent, not a quiet tool: the hang warns at 5 minutes.
    expect(h.check(2 * MIN + 5 * MIN)).toEqual({
      silentMs: 5 * MIN,
      currentTool: null,
      toolRunningMs: null,
    });
  });

  it("a top-level result for an unknown call is activity only; a quiet tool keeps its ceiling", () => {
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "gate", "Bash"))
      .at(3 * MIN)
      .feed(result("unknown_call")); // no parent_tool_use_id
    expect(h.events.at(-1)).toEqual({ type: "stream_activity" });
    // Resets the silence clock, but marks nothing: the quiet Bash still holds the
    // warning off until its ceiling (from its own start).
    expect(h.check(3 * MIN + 5 * MIN)).toBeNull();
    expect(h.check(30 * MIN)).toEqual({
      silentMs: 27 * MIN,
      currentTool: "Bash",
      toolRunningMs: 30 * MIN,
    });
    // With nothing in flight, the same line alone just resets the 5-minute clock.
    const idle = harness().at(0).feed(text("m1", "x")).at(MIN).feed(result("unknown_call"));
    expect(idle.check(MIN + 5 * MIN - 1)).toBeNull();
    expect(idle.check(MIN + 5 * MIN)).toMatchObject({ currentTool: null, silentMs: 5 * MIN });
  });

  it("the Task's own result reconciles anything still open under it", () => {
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "task", "Task"))
      .feed(toolUse("s1", "nested", "Bash", "task"))
      .feed(result("task"));
    const ends = h.events.filter((e) => e.type === "tool_end");
    expect(ends).toEqual([
      { type: "tool_end", blockIndex: 0, toolUseId: "nested", reason: "reconciled" },
      { type: "tool_end", blockIndex: 0, toolUseId: "task" },
    ]);
    expect(h.detector.currentTool()).toBeNull();
  });

  it("a nested message does not reconcile top-level calls (scoped by parent_tool_use_id)", () => {
    const h = harness()
      .at(0)
      .feed(toolUse("m1", "task", "Task"))
      .feed(text("s1", "sub", "task"))
      .feed(text("s2", "sub again", "task"));
    expect(h.events.some((e) => e.type === "tool_end")).toBe(false);
    expect(h.detector.currentTool()?.toolName).toBe("Task");
  });

  it("fires at most once per silence episode and re-arms on activity", () => {
    const h = harness({ stuckThresholdMs: 100, toolStuckThresholdMs: 100 })
      .at(0)
      .feed(text("m1", "x"));
    expect(h.check(100)).not.toBeNull();
    expect(h.check(500)).toBeNull();
    h.at(600).feed(text("m2", "y"));
    expect(h.check(650)).toBeNull();
    expect(h.check(700)).not.toBeNull();
  });

  it("honors configured thresholds", () => {
    const cfg = { stuckThresholdMs: 2 * MIN, toolStuckThresholdMs: 10 * MIN };
    expect(
      harness(cfg)
        .at(0)
        .feed(text("m1", "x"))
        .check(2 * MIN),
    ).not.toBeNull();
    const t = harness(cfg)
      .at(0)
      .feed(toolUse("m1", "a", "Bash"));
    expect(t.check(9 * MIN)).toBeNull();
    expect(t.check(10 * MIN)).toMatchObject({ currentTool: "Bash" });
  });

  it("never warns earlier than plain silence would, whatever the tool ceiling", () => {
    const h = harness({ stuckThresholdMs: 10 * MIN, toolStuckThresholdMs: MIN })
      .at(0)
      .feed(toolUse("m1", "a", "Bash"));
    expect(h.check(5 * MIN)).toBeNull();
    expect(h.check(10 * MIN)).not.toBeNull();
  });

  it("pairs by blockIndex when the provider gives no id, and ignores unmatched ends", () => {
    const d = new StuckDetector(DEFAULTS, 0);
    d.onEvent({ type: "tool_start", toolName: "Edit", blockIndex: 3 }, 0);
    expect(d.onEvent({ type: "tool_end", blockIndex: 9 }, 1)).toBeUndefined();
    expect(d.currentTool()?.toolName).toBe("Edit");
    expect(d.onEvent({ type: "tool_end", blockIndex: 3 }, 2)).toBe("Edit");
    expect(d.currentTool()).toBeNull();
  });

  it("polls at most every 30 s (under the 60 s freshness window), sooner for short thresholds", () => {
    expect(StuckDetector.checkIntervalMs(DEFAULTS)).toBe(30_000);
    expect(
      StuckDetector.checkIntervalMs({ stuckThresholdMs: 200, toolStuckThresholdMs: 900 }),
    ).toBe(200);
    expect(StuckDetector.checkIntervalMs({ stuckThresholdMs: 1, toolStuckThresholdMs: 1 })).toBe(
      50,
    );
  });
});
