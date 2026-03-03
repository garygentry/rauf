import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "./events.js";
import type { LoopEvent } from "@ralph/core";

function makeBaseFields(projectPath = "/test/project") {
  return { timestamp: new Date().toISOString(), projectPath };
}

describe("TypedEventEmitter", () => {
  it("emits and receives a loop_started event", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    const event: Extract<LoopEvent, { type: "loop_started" }> = {
      ...makeBaseFields(),
      type: "loop_started",
      maxIterations: 10,
    };

    emitter.on("loop_started", listener);
    emitter.emit("loop_started", event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("emits and receives an item_selected event with correct payload", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    const event: Extract<LoopEvent, { type: "item_selected" }> = {
      ...makeBaseFields(),
      type: "item_selected",
      itemId: "001",
      title: "Test item",
      priority: 1,
    };

    emitter.on("item_selected", listener);
    emitter.emit("item_selected", event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0].itemId).toBe("001");
    expect(listener.mock.calls[0]![0].title).toBe("Test item");
  });

  it("does not invoke listener for a different event type", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();

    emitter.on("loop_started", listener);
    emitter.emit("loop_completed", {
      ...makeBaseFields(),
      type: "loop_completed",
      completedCount: 1,
      blockedCount: 0,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("removes listener with off()", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();

    emitter.on("loop_error", listener);
    emitter.off("loop_error", listener);
    emitter.emit("loop_error", {
      ...makeBaseFields(),
      type: "loop_error",
      error: "something failed",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("once() listener fires only once", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    const event: Extract<LoopEvent, { type: "iteration_start" }> = {
      ...makeBaseFields(),
      type: "iteration_start",
      iteration: 1,
      maxIterations: 5,
    };

    emitter.once("iteration_start", listener);
    emitter.emit("iteration_start", event);
    emitter.emit("iteration_start", { ...event, iteration: 2 });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("supports multiple listeners for the same event type", () => {
    const emitter = new TypedEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const event: Extract<LoopEvent, { type: "sleep_end" }> = {
      ...makeBaseFields(),
      type: "sleep_end",
    };

    emitter.on("sleep_end", listener1);
    emitter.on("sleep_end", listener2);
    emitter.emit("sleep_end", event);

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it("handles all 17 event types", () => {
    const emitter = new TypedEventEmitter();
    const received: string[] = [];

    const events: LoopEvent[] = [
      { ...makeBaseFields(), type: "loop_started", maxIterations: 10 },
      {
        ...makeBaseFields(),
        type: "iteration_start",
        iteration: 1,
        maxIterations: 10,
      },
      {
        ...makeBaseFields(),
        type: "item_selected",
        itemId: "001",
        title: "t",
        priority: 1,
      },
      {
        ...makeBaseFields(),
        type: "llm_spawned",
        itemId: "001",
        provider: "claude-cli",
        timeoutMinutes: 30,
      },
      {
        ...makeBaseFields(),
        type: "llm_exited",
        itemId: "001",
        provider: "claude-cli",
        exitCode: 0,
        timedOut: false,
        durationMs: 1000,
      },
      {
        ...makeBaseFields(),
        type: "signal_parsed",
        itemId: "001",
        signal: "done",
      },
      {
        ...makeBaseFields(),
        type: "item_completed",
        itemId: "001",
        title: "t",
      },
      {
        ...makeBaseFields(),
        type: "item_blocked",
        itemId: "001",
        reason: "blocked",
      },
      {
        ...makeBaseFields(),
        type: "item_retried",
        itemId: "001",
        attempt: 1,
        maxRetries: 3,
      },
      {
        ...makeBaseFields(),
        type: "needs_human",
        itemId: "001",
        reason: "need decision",
      },
      {
        ...makeBaseFields(),
        type: "usage_limit_hit",
        limitType: "5h",
        utilization: 100,
      },
      {
        ...makeBaseFields(),
        type: "usage_limit_cleared",
        limitType: "5h",
      },
      {
        ...makeBaseFields(),
        type: "sleep_start",
        sleepUntil: new Date().toISOString(),
        reason: "rate limit",
      },
      { ...makeBaseFields(), type: "sleep_end" },
      {
        ...makeBaseFields(),
        type: "loop_completed",
        completedCount: 5,
        blockedCount: 1,
      },
      { ...makeBaseFields(), type: "loop_error", error: "test error" },
      { ...makeBaseFields(), type: "loop_cancelled" },
    ];

    for (const event of events) {
      emitter.on(event.type, (e) => {
        received.push(e.type);
      });
    }

    for (const event of events) {
      emitter.emit(event.type, event as never);
    }

    expect(received).toHaveLength(17);
    expect(new Set(received).size).toBe(17);
  });

  it("emit returns true when listeners exist, false otherwise", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();

    emitter.on("loop_cancelled", listener);

    const withListener = emitter.emit("loop_cancelled", {
      ...makeBaseFields(),
      type: "loop_cancelled",
    });
    const withoutListener = emitter.emit("loop_error", {
      ...makeBaseFields(),
      type: "loop_error",
      error: "no listener",
    });

    expect(withListener).toBe(true);
    expect(withoutListener).toBe(false);
  });
});
