import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "../stream-parser.js";
import { CopilotJsonlParser } from "./copilot-jsonl-parser.js";

const FIXTURE = join(import.meta.dirname, "__fixtures__", "copilot-cli-1.0.78.jsonl");

describe("CopilotJsonlParser", () => {
  it("reconstructs only assistant content and flushes an unterminated final record", () => {
    const events: AgentStreamEvent[] = [];
    const parser = new CopilotJsonlParser((event) => events.push(event));
    const jsonl = readFileSync(FIXTURE, "utf-8").trimEnd();

    for (let offset = 0; offset < jsonl.length; offset += 17) {
      parser.feed(jsonl.slice(offset, offset + 17));
    }
    parser.finish();

    expect(parser.getReconstructedText()).toBe(
      "Working on the requested change.\nRAUF_NEEDS_HUMAN:region required",
    );
    expect(parser.getRawOutput()).toBe(jsonl);
    expect(events).toEqual([
      { type: "tool_start", toolName: "bash", blockIndex: 0 },
      { type: "tool_end", blockIndex: 0 },
    ]);
  });

  it("ignores malformed shapes, unmatched completions, and unknown records", () => {
    const events: AgentStreamEvent[] = [];
    const parser = new CopilotJsonlParser((event) => events.push(event));
    parser.feed(
      [
        "not-json",
        '{"type":"assistant.message","data":{"content":42}}',
        '{"type":"tool.execution_start","data":{"toolCallId":1,"toolName":"bash"}}',
        '{"type":"tool.execution_complete","data":{"toolCallId":"missing"}}',
        '{"type":"unknown","data":{"content":"RAUF_DONE"}}',
        "",
      ].join("\n"),
    );
    parser.finish();

    expect(parser.getReconstructedText()).toBe("");
    expect(events).toEqual([]);
  });

  it("keeps callback failures non-fatal and continues reconstructing text", () => {
    const parser = new CopilotJsonlParser(() => {
      throw new Error("callback boom");
    });

    expect(() => {
      parser.feed(
        [
          '{"type":"tool.execution_start","data":{"toolCallId":"tool-1","toolName":"bash"}}',
          '{"type":"tool.execution_complete","data":{"toolCallId":"tool-1"}}',
          '{"type":"assistant.message","data":{"content":"RAUF_DONE"}}',
          "",
        ].join("\n"),
      );
      parser.finish();
    }).not.toThrow();
    expect(parser.getReconstructedText()).toBe("RAUF_DONE");
  });
});
