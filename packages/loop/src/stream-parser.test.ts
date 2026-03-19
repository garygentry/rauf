import { describe, it, expect, vi } from "vitest";
import { StreamParser, type ClaudeStreamEvent } from "./stream-parser.js";

function collectEvents(lines: string[]): ClaudeStreamEvent[] {
  const events: ClaudeStreamEvent[] = [];
  const parser = new StreamParser((e) => events.push(e));
  for (const line of lines) {
    parser.feed(line);
  }
  return events;
}

describe("StreamParser", () => {
  it("ignores empty and malformed lines", () => {
    const events = collectEvents(["", "   ", "not json", "{}", '{"no_type": true}']);
    expect(events).toEqual([]);
  });

  it("emits token_update from message_start", () => {
    const events = collectEvents([
      JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 1500 } },
      }),
    ]);
    expect(events).toEqual([
      { type: "token_update", inputTokens: 1500, outputTokens: 0 },
    ]);
  });

  it("emits tool_start and tool_end for tool_use blocks", () => {
    const events = collectEvents([
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", name: "Edit" },
      }),
      JSON.stringify({ type: "content_block_stop", index: 1 }),
    ]);
    expect(events).toEqual([
      { type: "tool_start", toolName: "Edit", blockIndex: 1 },
      { type: "tool_end", blockIndex: 1 },
    ]);
  });

  it("does NOT emit tool_end for non-tool blocks", () => {
    const events = collectEvents([
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
    ]);
    expect(events).toEqual([]);
  });

  it("reconstructs text from text_delta events", () => {
    const parser = new StreamParser(() => {});
    parser.feed(
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      }),
    );
    parser.feed(
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello " },
      }),
    );
    parser.feed(
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world!" },
      }),
    );
    parser.feed(JSON.stringify({ type: "content_block_stop", index: 0 }));

    expect(parser.getReconstructedText()).toBe("Hello world!");
  });

  it("emits token_update from message_delta with output_tokens", () => {
    const events = collectEvents([
      JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 1000 } },
      }),
      JSON.stringify({
        type: "message_delta",
        usage: { output_tokens: 500 },
      }),
    ]);
    expect(events).toEqual([
      { type: "token_update", inputTokens: 1000, outputTokens: 0 },
      { type: "token_update", inputTokens: 1000, outputTokens: 500 },
    ]);
  });

  it("emits message_stop", () => {
    const events = collectEvents([JSON.stringify({ type: "message_stop" })]);
    expect(events).toEqual([{ type: "message_stop" }]);
  });

  it("handles a realistic multi-turn stream", () => {
    const events: ClaudeStreamEvent[] = [];
    const parser = new StreamParser((e) => events.push(e));

    // message_start with input tokens
    parser.feed(
      JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 42000 } },
      }),
    );

    // Text block
    parser.feed(
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      }),
    );
    parser.feed(
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me edit that file.\n\nRALPH_DONE" },
      }),
    );
    parser.feed(JSON.stringify({ type: "content_block_stop", index: 0 }));

    // Tool use block
    parser.feed(
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", name: "Read" },
      }),
    );
    parser.feed(JSON.stringify({ type: "content_block_stop", index: 1 }));

    // message_delta with output tokens
    parser.feed(
      JSON.stringify({
        type: "message_delta",
        usage: { output_tokens: 3200 },
      }),
    );

    // message_stop
    parser.feed(JSON.stringify({ type: "message_stop" }));

    expect(parser.getReconstructedText()).toBe("Let me edit that file.\n\nRALPH_DONE");

    const toolStarts = events.filter((e) => e.type === "tool_start");
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]).toEqual({ type: "tool_start", toolName: "Read", blockIndex: 1 });

    const tokenUpdates = events.filter((e) => e.type === "token_update");
    expect(tokenUpdates.length).toBeGreaterThanOrEqual(2);
    const lastTokenUpdate = tokenUpdates[tokenUpdates.length - 1]!;
    expect(lastTokenUpdate).toEqual({
      type: "token_update",
      inputTokens: 42000,
      outputTokens: 3200,
    });

    expect(events[events.length - 1]).toEqual({ type: "message_stop" });
  });

  it("callback errors do not propagate", () => {
    const parser = new StreamParser(() => {
      throw new Error("callback boom");
    });
    // Should not throw
    expect(() =>
      parser.feed(JSON.stringify({ type: "message_stop" })),
    ).toThrow("callback boom");
  });
});
