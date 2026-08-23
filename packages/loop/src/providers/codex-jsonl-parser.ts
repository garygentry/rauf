// ─── Codex JSONL Stream Parser ──────────────────────────────────
//
// Parses the `codex exec --json` JSON Lines event stream (one JSON object per
// line on stdout) into the same {@link AgentStreamEvent}s the runner already
// consumes (`tool_start` / `tool_end` / `token_update`), and reconstructs the
// final agent text so signal parsing (RAUF_DONE etc.) works under `--agent codex`
// — the JSONL stdout is NOT the bare final message.
//
// Schema captured from real `codex exec --json` output (codex-cli 0.141.0, see
// __fixtures__/codex-exec-*.jsonl):
//   {"type":"thread.started","thread_id":"…"}
//   {"type":"turn.started"}
//   {"type":"item.started","item":{"id":"item_0","type":"command_execution",…}}
//   {"type":"item.completed","item":{"id":"item_0","type":"command_execution",…}}
//   {"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"…"}}
//   {"type":"turn.completed","usage":{"input_tokens":…,"output_tokens":…,…}}
//
// Deliberately structurally aligned with {@link StreamParser} (the Claude parser):
// same callback shape, same reconstructed-text accessor, malformed lines ignored.

import type { AgentStreamEvent } from "../stream-parser.js";

/** Codex `item.type`s that represent a tool/command activity (→ tool_start/tool_end). */
const TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "mcp_tool_call",
  "web_search",
  "file_change",
  "patch_apply",
]);

export class CodexStreamParser {
  private readonly onEvent: (event: AgentStreamEvent) => void;
  /** Maps Codex item id → the synthetic blockIndex used in tool_start/tool_end. */
  private toolBlocks = new Map<string, number>();
  private nextBlockIndex = 0;
  /** Accumulated agent_message text fragments (the reconstructed final output). */
  private textBuffer: string[] = [];
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(onEvent: (event: AgentStreamEvent) => void) {
    this.onEvent = onEvent;
  }

  /** Feed a single JSONL line. Malformed JSON / unknown shapes are silently ignored. */
  feed(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return; // malformed JSON — ignore (defensive: codex may print non-JSON noise)
    }

    const type = obj.type as string | undefined;
    if (!type) return;

    switch (type) {
      case "item.started":
        this.handleItem(obj, "started");
        break;
      case "item.completed":
        this.handleItem(obj, "completed");
        break;
      case "turn.completed":
        this.handleTurnCompleted(obj);
        break;
      // thread.started / turn.started / error / turn.failed carry no telemetry we map.
    }
  }

  /** Returns the reconstructed agent text (joined agent_message fragments). */
  getReconstructedText(): string {
    return this.textBuffer.join("\n");
  }

  private handleItem(obj: Record<string, unknown>, phase: "started" | "completed"): void {
    const item = obj.item as Record<string, unknown> | undefined;
    if (!item) return;
    const itemType = item.type as string | undefined;
    const id = typeof item.id === "string" ? item.id : undefined;

    if (itemType === "agent_message") {
      // Final text only lands on completion (the item is atomic).
      if (phase === "completed" && typeof item.text === "string" && item.text.length > 0) {
        this.textBuffer.push(item.text);
      }
      return;
    }

    if (itemType && TOOL_ITEM_TYPES.has(itemType) && id) {
      if (phase === "started") {
        const blockIndex = this.nextBlockIndex++;
        this.toolBlocks.set(id, blockIndex);
        this.onEvent({ type: "tool_start", toolName: itemType, blockIndex });
      } else {
        // completed: pair with the started index (fall back to a fresh index if we
        // never saw the start — e.g. an atomic tool item emitted only on completion).
        let blockIndex = this.toolBlocks.get(id);
        if (blockIndex === undefined) {
          blockIndex = this.nextBlockIndex++;
          this.onEvent({ type: "tool_start", toolName: itemType, blockIndex });
        }
        this.toolBlocks.delete(id);
        this.onEvent({ type: "tool_end", blockIndex });
      }
    }
  }

  private handleTurnCompleted(obj: Record<string, unknown>): void {
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (!usage) return;
    const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    if (input > 0) this.inputTokens = input;
    if (output > 0) this.outputTokens = output;
    if (input > 0 || output > 0) {
      this.onEvent({
        type: "token_update",
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
      });
    }
  }
}
