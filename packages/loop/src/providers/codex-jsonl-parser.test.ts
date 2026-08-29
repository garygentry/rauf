import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CodexStreamParser } from "./codex-jsonl-parser.js";
import type { AgentStreamEvent } from "../stream-parser.js";

const FIXTURES = join(import.meta.dirname, "__fixtures__");

function run(fixture: string): { events: AgentStreamEvent[]; text: string } {
  const events: AgentStreamEvent[] = [];
  const parser = new CodexStreamParser((e) => events.push(e));
  const jsonl = readFileSync(join(FIXTURES, fixture), "utf-8");
  for (const line of jsonl.split("\n")) if (line.trim()) parser.feed(line);
  return { events, text: parser.getReconstructedText() };
}

describe("CodexStreamParser", () => {
  it("reconstructs the agent_message text and emits a token_update from a simple run", () => {
    const { events, text } = run("codex-exec-simple.jsonl");
    expect(text).toBe("RAUF_DONE");
    const tokens = events.filter((e) => e.type === "token_update");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "token_update", inputTokens: 11331, outputTokens: 7 });
    // No tool items in the simple run.
    expect(events.some((e) => e.type === "tool_start")).toBe(false);
  });

  it("maps command_execution items to paired tool_start/tool_end and reconstructs final text", () => {
    const { events, text } = run("codex-exec-command.jsonl");
    expect(text).toBe("RAUF_DONE");

    const starts = events.filter((e) => e.type === "tool_start");
    const ends = events.filter((e) => e.type === "tool_end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]).toMatchObject({ type: "tool_start", toolName: "command_execution" });
    // start and end share the same synthetic blockIndex (paired by item id).
    expect((starts[0] as { blockIndex: number }).blockIndex).toBe(
      (ends[0] as { blockIndex: number }).blockIndex,
    );

    const tokens = events.filter((e) => e.type === "token_update");
    expect(tokens.at(-1)).toMatchObject({ inputTokens: 22770, outputTokens: 54 });
  });

  it("ignores malformed / non-JSON lines without throwing", () => {
    const events: AgentStreamEvent[] = [];
    const parser = new CodexStreamParser((e) => events.push(e));
    expect(() => {
      parser.feed("not json at all");
      parser.feed("");
      parser.feed('{"type":"thread.started"}');
      parser.feed('{"no":"type"}');
    }).not.toThrow();
    expect(events).toHaveLength(0);
  });

  it("pairs a tool item that only appears on completion (no started event)", () => {
    const events: AgentStreamEvent[] = [];
    const parser = new CodexStreamParser((e) => events.push(e));
    parser.feed(
      '{"type":"item.completed","item":{"id":"x","type":"mcp_tool_call","status":"completed"}}',
    );
    expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end"]);
  });
});
