// ─── Stream Parser ──────────────────────────────────────────────
//
// Parses Claude CLI NDJSON stream (--output-format stream-json) line
// by line, emitting typed events for tool use, token counts, and
// message lifecycle. Also reconstructs the plain text output so
// signal parsing (RAUF_DONE etc.) continues to work.
//
// Tool boundaries (#141):
//   - CLI format: `tool_start` on the assistant `tool_use` block, `tool_end` on the
//     `user` event carrying the matching `tool_result` — i.e. the real execution
//     window, so a long foreground Bash call reads as "in flight" until it returns.
//   - Raw Anthropic streaming format (used by the test-sandbox mocks): `tool_start` on
//     `content_block_start`, `tool_end` on `content_block_stop`. That stream carries no
//     tool results, so the end marks the end of the tool_use block, not of execution.

// ─── Types ──────────────────────────────────────────────────────

export type StreamEventType =
  | "tool_start"
  | "tool_end"
  | "token_update"
  | "message_stop"
  | "api_retry";

export interface ToolStartEvent {
  type: "tool_start";
  toolName: string;
  blockIndex: number;
  /**
   * Provider-assigned id of the tool call (Claude `tool_use.id`, Codex `item.id`), when
   * known. The runner pairs `tool_start`/`tool_end` by this id (falling back to
   * `blockIndex`) to track which tool calls are still in flight (#141).
   */
  toolUseId?: string;
}

export interface ToolEndEvent {
  type: "tool_end";
  blockIndex: number;
  /** Same id as the matching {@link ToolStartEvent.toolUseId}, when known. */
  toolUseId?: string;
}

export interface TokenUpdateEvent {
  type: "token_update";
  inputTokens: number;
  outputTokens: number;
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface ApiRetryEvent {
  type: "api_retry";
}

export type ClaudeStreamEvent =
  | ToolStartEvent
  | ToolEndEvent
  | TokenUpdateEvent
  | MessageStopEvent
  | ApiRetryEvent;

// ─── Parser ─────────────────────────────────────────────────────

export class StreamParser {
  private readonly onEvent: (event: ClaudeStreamEvent) => void;
  /** Maps content block index → true if the block is a tool_use block */
  private toolBlocks = new Map<number, boolean>();
  /**
   * Claude CLI tool calls that have started (assistant `tool_use` block) but whose
   * `tool_result` has not arrived yet: tool_use id → blockIndex of the tool_start.
   */
  private openToolUses = new Map<string, number>();
  /** Accumulated text fragments from text_delta events */
  private textBuffer: string[] = [];
  /** Latest known token counts */
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(onEvent: (event: ClaudeStreamEvent) => void) {
    this.onEvent = onEvent;
  }

  /** Feed a single NDJSON line. Malformed JSON is silently ignored. */
  feed(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return; // silently ignore malformed JSON
    }

    const type = obj.type as string | undefined;
    if (!type) return;

    switch (type) {
      // ── Anthropic streaming API format ──
      case "message_start":
        this.handleMessageStart(obj);
        break;
      case "content_block_start":
        this.handleContentBlockStart(obj);
        break;
      case "content_block_delta":
        this.handleContentBlockDelta(obj);
        break;
      case "content_block_stop":
        this.handleContentBlockStop(obj);
        break;
      case "message_delta":
        this.handleMessageDelta(obj);
        break;
      case "message_stop":
        this.onEvent({ type: "message_stop" });
        break;
      // ── Claude CLI stream-json format ──
      case "assistant":
        this.handleCliAssistant(obj);
        break;
      case "user":
        this.handleCliUser(obj);
        break;
      case "result":
        this.handleCliResult(obj);
        break;
    }
  }

  /** Returns the full text assembled from text_delta events. */
  getReconstructedText(): string {
    return this.textBuffer.join("");
  }

  // ─── Internal handlers ──────────────────────────────────────────

  private handleMessageStart(obj: Record<string, unknown>): void {
    const message = obj.message as Record<string, unknown> | undefined;
    if (!message) return;
    const usage = message.usage as Record<string, unknown> | undefined;
    if (!usage) return;
    const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    if (inputTokens > 0) {
      this.inputTokens = inputTokens;
      this.onEvent({
        type: "token_update",
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
      });
    }
  }

  private handleContentBlockStart(obj: Record<string, unknown>): void {
    const index = typeof obj.index === "number" ? obj.index : -1;
    const contentBlock = obj.content_block as Record<string, unknown> | undefined;
    if (!contentBlock) return;

    const blockType = contentBlock.type as string | undefined;
    if (blockType === "tool_use") {
      this.toolBlocks.set(index, true);
      const toolName = typeof contentBlock.name === "string" ? contentBlock.name : "unknown";
      this.onEvent({ type: "tool_start", toolName, blockIndex: index });
    } else {
      this.toolBlocks.set(index, false);
    }
  }

  private handleContentBlockDelta(obj: Record<string, unknown>): void {
    const delta = obj.delta as Record<string, unknown> | undefined;
    if (!delta) return;

    if (delta.type === "text_delta" && typeof delta.text === "string") {
      this.textBuffer.push(delta.text);
    }
  }

  private handleContentBlockStop(obj: Record<string, unknown>): void {
    const index = typeof obj.index === "number" ? obj.index : -1;
    if (this.toolBlocks.get(index)) {
      this.onEvent({ type: "tool_end", blockIndex: index });
    }
    this.toolBlocks.delete(index);
  }

  private handleMessageDelta(obj: Record<string, unknown>): void {
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (!usage) return;
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    if (outputTokens > 0) {
      this.outputTokens = outputTokens;
      this.onEvent({
        type: "token_update",
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
      });
    }
  }

  // ─── Claude CLI format handlers ────────────────────────────────

  /**
   * Handle CLI "assistant" event: extract text/tool_use from message content,
   * and token counts from usage.
   */
  private handleCliAssistant(obj: Record<string, unknown>): void {
    const message = obj.message as Record<string, unknown> | undefined;
    if (!message) return;

    // Extract token counts
    const usage = message.usage as Record<string, unknown> | undefined;
    if (usage) {
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

    // Extract content blocks (text + tool_use)
    const content = message.content as unknown[] | undefined;
    if (!Array.isArray(content)) return;

    for (let i = 0; i < content.length; i++) {
      const block = content[i] as Record<string, unknown> | undefined;
      if (!block) continue;

      if (block.type === "text" && typeof block.text === "string") {
        this.textBuffer.push(block.text);
      } else if (block.type === "tool_use") {
        const toolName = typeof block.name === "string" ? block.name : "unknown";
        const toolUseId = typeof block.id === "string" ? block.id : undefined;
        if (toolUseId === undefined) {
          // No id to pair a later tool_result with — report it as instantaneous
          // rather than leaving it open for the rest of the session.
          this.onEvent({ type: "tool_start", toolName, blockIndex: i });
          this.onEvent({ type: "tool_end", blockIndex: i });
          continue;
        }
        // #141: the tool only STARTS here — the CLI executes it after this event, and
        // it stays in flight until the matching `tool_result` arrives on a `user` event.
        this.openToolUses.set(toolUseId, i);
        this.onEvent({ type: "tool_start", toolName, blockIndex: i, toolUseId });
      }
    }
  }

  /**
   * Handle CLI "user" event: a `tool_result` block ends the tool call whose
   * `tool_use.id` it names (#141).
   */
  private handleCliUser(obj: Record<string, unknown>): void {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;

    for (const raw of content) {
      const block = raw as Record<string, unknown> | undefined;
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const blockIndex = this.openToolUses.get(block.tool_use_id);
      if (blockIndex === undefined) continue;
      this.openToolUses.delete(block.tool_use_id);
      this.onEvent({ type: "tool_end", blockIndex, toolUseId: block.tool_use_id });
    }
  }

  /** End every still-open CLI tool call (the session finished without their results). */
  private closeOpenToolUses(): void {
    for (const [toolUseId, blockIndex] of this.openToolUses) {
      this.onEvent({ type: "tool_end", blockIndex, toolUseId });
    }
    this.openToolUses.clear();
  }

  /**
   * Handle CLI "result" event: extract final text and total usage.
   * The result event's `result` field contains the final text output.
   */
  private handleCliResult(obj: Record<string, unknown>): void {
    // Extract final text — use as reconstructed text if we haven't captured any yet
    if (typeof obj.result === "string" && this.textBuffer.length === 0) {
      this.textBuffer.push(obj.result);
    }

    // Extract total usage
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (usage) {
      const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      if (input > 0) this.inputTokens = input;
      if (output > 0) this.outputTokens = output;
      this.onEvent({
        type: "token_update",
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
      });
    }

    this.closeOpenToolUses();
    this.onEvent({ type: "message_stop" });
  }
}
