import { describe, it, expect } from "vitest";
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
    expect(events).toEqual([{ type: "token_update", inputTokens: 1500, outputTokens: 0 }]);
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
        delta: { type: "text_delta", text: "Let me edit that file.\n\nRAUF_DONE" },
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

    expect(parser.getReconstructedText()).toBe("Let me edit that file.\n\nRAUF_DONE");

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
    expect(() => parser.feed(JSON.stringify({ type: "message_stop" }))).toThrow("callback boom");
  });

  // ── Claude CLI format tests ────────────────────────────────────

  describe("CLI stream-json format", () => {
    it("extracts text from assistant event", () => {
      const parser = new StreamParser(() => {});
      parser.feed(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello world!\n\nRAUF_DONE" }],
            usage: { input_tokens: 5000, output_tokens: 100 },
          },
        }),
      );

      expect(parser.getReconstructedText()).toBe("Hello world!\n\nRAUF_DONE");
    });

    it("extracts tool use from assistant event", () => {
      const events = collectEvents([
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Let me read that." },
              { type: "tool_use", name: "Read", id: "t1", input: {} },
              { type: "tool_use", name: "Edit", id: "t2", input: {} },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
      ]);

      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts).toHaveLength(2);
      expect(toolStarts[0]).toEqual({
        type: "tool_start",
        toolName: "Read",
        blockIndex: 1,
        toolUseId: "t1",
      });
      expect(toolStarts[1]).toEqual({
        type: "tool_start",
        toolName: "Edit",
        blockIndex: 2,
        toolUseId: "t2",
      });
    });

    // #141: the assistant tool_use block only STARTS the tool; the CLI runs it after
    // that event, so tool_end must wait for the matching tool_result.
    it("keeps a tool_use open until its tool_result arrives", () => {
      const events: ClaudeStreamEvent[] = [];
      const parser = new StreamParser((e) => events.push(e));
      parser.feed(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Bash", id: "toolu_a", input: {} },
              { type: "tool_use", name: "Read", id: "toolu_b", input: {} },
            ],
          },
        }),
      );
      expect(events.filter((e) => e.type === "tool_end")).toHaveLength(0);

      parser.feed(
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_b", content: "ok" }],
          },
        }),
      );
      expect(events.filter((e) => e.type === "tool_end")).toEqual([
        { type: "tool_end", blockIndex: 1, toolUseId: "toolu_b" },
      ]);

      parser.feed(
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "done" }],
          },
        }),
      );
      expect(events.filter((e) => e.type === "tool_end")).toEqual([
        { type: "tool_end", blockIndex: 1, toolUseId: "toolu_b" },
        { type: "tool_end", blockIndex: 0, toolUseId: "toolu_a" },
      ]);
    });

    it("ignores user events without tool results", () => {
      const events = collectEvents([
        JSON.stringify({ type: "user", message: { content: "plain text" } }),
      ]);
      expect(events).toHaveLength(0);
    });

    it("reports a tool_result for an unknown id as stream activity, keeping its parent (#141)", () => {
      const events = collectEvents([
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "never-started" }] },
        }),
        JSON.stringify({
          type: "user",
          parent_tool_use_id: "task_1",
          message: { content: [{ type: "tool_result", tool_use_id: "lost-child" }] },
        }),
      ]);
      expect(events).toEqual([
        { type: "stream_activity" },
        { type: "stream_activity", parentToolUseId: "task_1" },
      ]);
    });

    it("closes still-open tool calls when the result event ends the session", () => {
      const events = collectEvents([
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Bash", id: "toolu_x", input: {} }] },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "RAUF_DONE" }),
      ]);
      const types = events.map((e) => e.type);
      expect(types).toContain("tool_end");
      // The tool is closed before the session's message_stop.
      expect(types.indexOf("tool_end")).toBeLessThan(types.indexOf("message_stop"));
    });

    it("finish() closes every open call as aborted, once", () => {
      const events: ClaudeStreamEvent[] = [];
      const parser = new StreamParser((e) => events.push(e));
      parser.feed(
        JSON.stringify({
          type: "assistant",
          message: { id: "m", content: [{ type: "tool_use", name: "Bash", id: "a", input: {} }] },
        }),
      );
      parser.feed(
        JSON.stringify({
          type: "content_block_start",
          index: 4,
          content_block: { type: "tool_use", name: "Read" },
        }),
      );
      parser.finish();
      parser.finish();
      expect(events.filter((e) => e.type === "tool_end")).toEqual([
        { type: "tool_end", blockIndex: 0, toolUseId: "a", reason: "aborted" },
        { type: "tool_end", blockIndex: 4, reason: "aborted" },
      ]);
    });

    it("does not reconcile parallel calls from the same message (one event per block)", () => {
      const events = collectEvents(
        ["a", "b"].map((id) =>
          JSON.stringify({
            type: "assistant",
            message: { id: "same", content: [{ type: "tool_use", name: "Bash", id, input: {} }] },
          }),
        ),
      );
      expect(events.filter((e) => e.type === "tool_end")).toHaveLength(0);
    });

    it("tags nested (subagent) tool starts and token updates with parentToolUseId", () => {
      const events = collectEvents([
        JSON.stringify({
          type: "assistant",
          parent_tool_use_id: "task_1",
          message: {
            id: "s1",
            content: [{ type: "tool_use", name: "Grep", id: "g", input: {} }],
            usage: { input_tokens: 5, output_tokens: 1 },
          },
        }),
      ]);
      expect(events).toEqual([
        { type: "token_update", inputTokens: 5, outputTokens: 1, parentToolUseId: "task_1" },
        {
          type: "tool_start",
          toolName: "Grep",
          blockIndex: 0,
          toolUseId: "g",
          parentToolUseId: "task_1",
        },
      ]);
    });

    it("treats a tool_use with no id as instantaneous (nothing to pair a result with)", () => {
      const events = collectEvents([
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
        }),
      ]);
      expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end"]);
    });

    it("extracts tokens from assistant event", () => {
      const events = collectEvents([
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "hi" }],
            usage: { input_tokens: 2000, output_tokens: 50 },
          },
        }),
      ]);

      const tokenUpdates = events.filter((e) => e.type === "token_update");
      expect(tokenUpdates).toHaveLength(1);
      expect(tokenUpdates[0]).toEqual({
        type: "token_update",
        inputTokens: 2000,
        outputTokens: 50,
      });
    });

    it("extracts text from result event as fallback", () => {
      const parser = new StreamParser(() => {});
      // No assistant event first — result provides the text
      parser.feed(
        JSON.stringify({
          type: "result",
          result: "RAUF_DONE",
          usage: { input_tokens: 1000, output_tokens: 20 },
        }),
      );

      expect(parser.getReconstructedText()).toBe("RAUF_DONE");
    });

    it("does not overwrite text from assistant events with result", () => {
      const parser = new StreamParser(() => {});
      parser.feed(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Detailed work...\n\nRAUF_DONE" }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
      );
      parser.feed(
        JSON.stringify({
          type: "result",
          result: "RAUF_DONE",
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      );

      // Should keep the more detailed text from assistant, not the truncated result
      expect(parser.getReconstructedText()).toBe("Detailed work...\n\nRAUF_DONE");
    });

    it("emits message_stop from result event", () => {
      const events = collectEvents([
        JSON.stringify({
          type: "result",
          result: "done",
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
      ]);

      expect(events.some((e) => e.type === "message_stop")).toBe(true);
    });

    it("handles realistic CLI multi-turn stream", () => {
      const events: ClaudeStreamEvent[] = [];
      const parser = new StreamParser((e) => events.push(e));

      // System init event (ignored)
      parser.feed(JSON.stringify({ type: "system", subtype: "init" }));

      // Assistant turn with tool use
      parser.feed(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Let me scaffold the package." },
              { type: "tool_use", name: "Write", id: "t1", input: {} },
            ],
            usage: { input_tokens: 25000, output_tokens: 200 },
          },
        }),
      );

      // Final assistant turn with signal
      parser.feed(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "\n\nRAUF_DONE" }],
            usage: { input_tokens: 25000, output_tokens: 250 },
          },
        }),
      );

      // Result event
      parser.feed(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "RAUF_DONE",
          usage: { input_tokens: 25000, output_tokens: 250 },
        }),
      );

      expect(parser.getReconstructedText()).toBe("Let me scaffold the package.\n\nRAUF_DONE");

      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts).toHaveLength(1);
      expect(toolStarts[0]).toEqual({
        type: "tool_start",
        toolName: "Write",
        blockIndex: 1,
        toolUseId: "t1",
      });
    });
  });
});
