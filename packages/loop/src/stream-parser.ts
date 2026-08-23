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
//     A `tool_result` can go missing (malformed or unrecognized line), so open calls
//     are also reconciled at structural boundaries: the model only continues after it
//     has its results, so a NEW assistant message in the same scope (top level, or the
//     same `parent_tool_use_id` for a Task/subagent) closes every call left open by an
//     EARLIER message in that scope (`reason: "reconciled"`). A call's own result also
//     closes any calls nested under it, and the final `result` event closes the rest.
//   - Raw Anthropic streaming format (used by the test-sandbox mocks): `tool_start` on
//     `content_block_start`, `tool_end` on `content_block_stop`. That stream carries no
//     tool results, so the end marks the end of the tool_use block, not of execution.
//   - {@link StreamParser.finish} closes whatever is still open when the process exits
//     (timeout, kill, crash, truncated stdout) with `reason: "aborted"`, so every
//     `tool_start` gets a matching `tool_end`.

// ─── Types ──────────────────────────────────────────────────────

export type StreamEventType =
  | "tool_start"
  | "tool_end"
  | "token_update"
  | "message_stop"
  | "api_retry"
  | "stream_activity";

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
  /**
   * The enclosing tool call (Claude `parent_tool_use_id`) when this call was made by a
   * Task/subagent; absent at top level.
   */
  parentToolUseId?: string;
}

/**
 * Why a tool_end was synthesized rather than observed: `reconciled` = the stream moved
 * past the call without delivering its result; `aborted` = the agent process exited
 * with the call still open. Absent for a normal end.
 */
export type ToolEndReason = "reconciled" | "aborted";

export interface ToolEndEvent {
  type: "tool_end";
  blockIndex: number;
  /** Same id as the matching {@link ToolStartEvent.toolUseId}, when known. */
  toolUseId?: string;
  reason?: ToolEndReason;
}

export interface TokenUpdateEvent {
  type: "token_update";
  inputTokens: number;
  outputTokens: number;
  /** Set when the usage came from a Task/subagent message (Claude `parent_tool_use_id`). */
  parentToolUseId?: string;
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface ApiRetryEvent {
  type: "api_retry";
}

/**
 * Stream output that proves the agent is alive but maps to no other event: a
 * `tool_result` for a call whose start was never seen (lost or out of order). Resets
 * the silence clock; `parentToolUseId` marks the enclosing Task as having an active
 * subagent (#141).
 */
export interface StreamActivityEvent {
  type: "stream_activity";
  parentToolUseId?: string;
}

export type AgentStreamEvent =
  | ToolStartEvent
  | ToolEndEvent
  | TokenUpdateEvent
  | MessageStopEvent
  | ApiRetryEvent
  | StreamActivityEvent;

/** @deprecated Use AgentStreamEvent. */
export type ClaudeStreamEvent = AgentStreamEvent;

// ─── Parser ─────────────────────────────────────────────────────

export class StreamParser {
  private readonly onEvent: (event: AgentStreamEvent) => void;
  /** Maps content block index → true if the block is a tool_use block */
  private toolBlocks = new Map<number, boolean>();
  /**
   * Claude CLI tool calls that have started (assistant `tool_use` block) but whose
   * `tool_result` has not arrived yet, keyed by tool_use id. `parent` is the
   * `parent_tool_use_id` scope (null = top level); `messageId` is the assistant
   * message that issued the call.
   */
  private openToolUses = new Map<
    string,
    { blockIndex: number; parent: string | null; messageId: string | undefined }
  >();
  /** Accumulated text fragments from text_delta events */
  private textBuffer: string[] = [];
  /** Latest known token counts */
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(onEvent: (event: AgentStreamEvent) => void) {
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

  /**
   * The agent process has exited: end every tool call still open with
   * `reason: "aborted"` so start/end telemetry stays balanced. Idempotent. Adapters
   * call this on every exit path (normal, error, timeout/kill, truncated stdout).
   */
  finish(): void {
    for (const id of [...this.openToolUses.keys()]) this.closeToolUse(id, "aborted");
    for (const [index, isTool] of this.toolBlocks) {
      if (isTool) this.onEvent({ type: "tool_end", blockIndex: index, reason: "aborted" });
    }
    this.toolBlocks.clear();
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

    const parent = typeof obj.parent_tool_use_id === "string" ? obj.parent_tool_use_id : null;
    const messageId = typeof message.id === "string" ? message.id : undefined;
    // A new message in this scope means the model has the results of every call an
    // earlier message in the same scope made — close any whose result we missed. The
    // CLI emits one assistant event per content block with the same message id, so
    // parallel calls from one message are untouched. Without an id we can't tell a new
    // message from the next block of the same one, so nothing is reconciled.
    if (messageId !== undefined) {
      for (const [id, open] of [...this.openToolUses]) {
        if (open.parent === parent && open.messageId !== messageId) {
          this.closeToolUse(id, "reconciled");
        }
      }
    }

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
          ...(parent !== null ? { parentToolUseId: parent } : {}),
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
        this.openToolUses.set(toolUseId, { blockIndex: i, parent, messageId });
        this.onEvent({
          type: "tool_start",
          toolName,
          blockIndex: i,
          toolUseId,
          ...(parent !== null ? { parentToolUseId: parent } : {}),
        });
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

    const parent = typeof obj.parent_tool_use_id === "string" ? obj.parent_tool_use_id : null;
    for (const raw of content) {
      const block = raw as Record<string, unknown> | undefined;
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      if (this.openToolUses.has(block.tool_use_id)) {
        this.closeToolUse(block.tool_use_id);
      } else {
        // A result for a call whose start we never saw is still output: don't drop it,
        // or a live subagent would look like a quiet Task.
        this.onEvent({
          type: "stream_activity",
          ...(parent !== null ? { parentToolUseId: parent } : {}),
        });
      }
    }
  }

  /**
   * End one open CLI tool call, first reconciling any calls nested under it (a
   * finished Task has no running subagent tools). No-op for an unknown id.
   */
  private closeToolUse(toolUseId: string, reason?: ToolEndReason): void {
    const open = this.openToolUses.get(toolUseId);
    if (!open) return;
    this.openToolUses.delete(toolUseId);
    for (const [childId, child] of [...this.openToolUses]) {
      if (child.parent === toolUseId) this.closeToolUse(childId, reason ?? "reconciled");
    }
    this.onEvent({
      type: "tool_end",
      blockIndex: open.blockIndex,
      toolUseId,
      ...(reason ? { reason } : {}),
    });
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

    // The session is over: any call still open lost its result.
    for (const id of [...this.openToolUses.keys()]) this.closeToolUse(id, "reconciled");
    this.onEvent({ type: "message_stop" });
  }
}
