import type { AgentStreamEvent } from "../stream-parser.js";

export class CopilotJsonlParser {
  private buffer = "";
  private readonly rawBuffer: string[] = [];
  private readonly textBuffer: string[] = [];
  private readonly toolBlocks = new Map<string, number>();
  private nextBlockIndex = 0;

  constructor(private readonly onEvent: (event: AgentStreamEvent) => void) {}

  /** Feed an arbitrary stdout chunk. Complete JSONL records are handled immediately. */
  feed(chunk: string): void {
    this.rawBuffer.push(chunk);
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.handleLine(line);
  }

  /** Flush the final record when stdout closes without a trailing newline. */
  finish(): void {
    this.handleLine(this.buffer);
    this.buffer = "";
  }

  getReconstructedText(): string {
    return this.textBuffer.join("\n");
  }

  getRawOutput(): string {
    return this.rawBuffer.join("");
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    if (record.type === "assistant.message") {
      const data = asRecord(record.data);
      if (typeof data?.content === "string" && data.content.length > 0) {
        this.textBuffer.push(data.content);
      }
      return;
    }

    if (record.type === "tool.execution_start") {
      const data = asRecord(record.data);
      if (typeof data?.toolCallId !== "string" || typeof data.toolName !== "string") return;
      const blockIndex = this.nextBlockIndex++;
      this.toolBlocks.set(data.toolCallId, blockIndex);
      this.emit({ type: "tool_start", toolName: data.toolName, blockIndex });
      return;
    }

    if (record.type === "tool.execution_complete") {
      const data = asRecord(record.data);
      if (typeof data?.toolCallId !== "string") return;
      const blockIndex = this.toolBlocks.get(data.toolCallId);
      if (blockIndex === undefined) return;
      this.toolBlocks.delete(data.toolCallId);
      this.emit({ type: "tool_end", blockIndex });
    }
  }

  private emit(event: AgentStreamEvent): void {
    try {
      this.onEvent(event);
    } catch {
      // Consumer telemetry must not interrupt output reconstruction.
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
