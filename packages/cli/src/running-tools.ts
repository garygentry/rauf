// ─── Running Tools ──────────────────────────────────────────────
//
// Tracks the tool calls in flight from `llm_tool_activity` events for the live
// status line (#141). With parallel or nested calls, one call ending must not
// hide another that is still running: the line shows the most recently started
// call that has not ended yet.

export class RunningTools {
  /** Insertion-ordered: the last entry is the most recently started call. */
  private readonly tools = new Map<string, string>();
  private anonymousSeq = 0;

  /** Record a call starting. Calls without an id get a synthetic key. */
  start(toolName: string, toolUseId?: string): void {
    const key = toolUseId !== undefined ? `id:${toolUseId}` : `anon:${this.anonymousSeq++}`;
    this.tools.delete(key);
    this.tools.set(key, toolName);
  }

  /**
   * Record a call ending. Paired by id when the event has one; otherwise ends the
   * most recent id-less call with the same name (or any id-less call for "unknown").
   */
  end(toolName: string, toolUseId?: string): void {
    if (toolUseId !== undefined) {
      this.tools.delete(`id:${toolUseId}`);
      return;
    }
    const anonymous = [...this.tools].filter(([key]) => key.startsWith("anon:"));
    const match = anonymous
      .reverse()
      .find(([, name]) => toolName === "unknown" || name === toolName);
    if (match) this.tools.delete(match[0]);
  }

  /** The most recently started call still running, or null. */
  current(): string | null {
    let latest: string | null = null;
    for (const name of this.tools.values()) latest = name;
    return latest;
  }

  clear(): void {
    this.tools.clear();
  }
}
