// ─── Stuck Detector ─────────────────────────────────────────────
//
// Tracks per-iteration stream activity and the set of tool calls still in
// flight, and decides when to raise `llm_stuck_warning` (#141).
//
// A foreground tool call (e.g. a Bash verification gate) emits no stream events
// between its `tool_start` and `tool_end`, so silence alone is not a hang while a
// tool is running. Exact semantics:
//
//   - A "quiet tool" is an in-flight tool with no nested activity. A Task/subagent
//     call whose subagent has emitted events is a model, not a quiet tool: only its
//     own in-flight children can be quiet tools.
//   - No quiet tool in flight: warn once the stream has been silent for
//     `stuckThresholdMs`.
//   - A quiet tool in flight: warn once the OLDEST quiet tool has been running for
//     `toolStuckThresholdMs` (measured from its start, so stream activity after it
//     started never extends the ceiling) AND the stream has been silent for
//     `stuckThresholdMs`. The ceiling bounds how long any single tool can hold off
//     the warning, including when its `tool_result` was lost and the parser could not
//     reconcile it.
//
// Pure: every method takes an explicit `now` (ms since epoch) so the thresholds
// are testable without timers.

import type { ClaudeStreamEvent, ToolEndEvent, ToolStartEvent } from "./stream-parser.js";

/** Default LLM-silence threshold with no tool in flight (`.rauf.json` `options.stuckThresholdMs`). */
export const DEFAULT_STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Default ceiling on a quiet in-flight tool's runtime before the warning may fire
 * (`.rauf.json` `options.toolStuckThresholdMs`).
 *
 * 30 minutes: Claude Code's Bash tool caps a foreground call at 10 minutes by
 * default, so a healthy Claude tool call never gets near it, while it still
 * covers raised Bash timeouts and providers with no per-call cap (Codex
 * `command_execution`). It is half the default 60-minute session timeout, so a
 * truly hung tool is surfaced with time left to act before the session is killed.
 */
export const DEFAULT_TOOL_STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/** Upper bound on the check (and in-flight heartbeat) interval: under the 60 s freshness window. */
const MAX_CHECK_INTERVAL_MS = 30_000;

export interface StuckThresholds {
  /** Stream silence (ms) before warning. Always required, tool or not. */
  stuckThresholdMs: number;
  /** Runtime (ms) a quiet in-flight tool may reach before the warning is allowed. */
  toolStuckThresholdMs: number;
}

/** Payload fields of `llm_stuck_warning` (beyond `itemId`). */
export interface StuckWarning {
  /** Ms since the last stream event. */
  silentMs: number;
  /**
   * The quiet in-flight tool the warning is about (the oldest one), or null when the
   * model itself went silent (no quiet tool in flight).
   */
  currentTool: string | null;
  /** Ms since `currentTool` started, or null when `currentTool` is null. */
  toolRunningMs: number | null;
}

interface InFlightTool {
  toolName: string;
  startedAt: number;
  /** A nested (subagent) event named this call as its parent. */
  hasNestedActivity: boolean;
}

/** Pairing key for a tool_start/tool_end: the provider's call id, else the block index. */
function toolKey(event: ToolStartEvent | ToolEndEvent): string {
  return event.toolUseId !== undefined ? `id:${event.toolUseId}` : `block:${event.blockIndex}`;
}

export class StuckDetector {
  private readonly stuckThresholdMs: number;
  private readonly toolStuckThresholdMs: number;
  private readonly inFlight = new Map<string, InFlightTool>();
  /** Last stream event of any kind. */
  private lastActivityAt: number;
  private warned = false;

  constructor(thresholds: StuckThresholds, now: number) {
    this.stuckThresholdMs = thresholds.stuckThresholdMs;
    // No clamp needed: stuckThresholdMs of silence is always required, and a tool's
    // runtime is never shorter than the current silence (its start is an event).
    this.toolStuckThresholdMs = thresholds.toolStuckThresholdMs;
    this.lastActivityAt = now;
  }

  /** How often the caller should poll {@link check}: at most every 30 s, sooner for short thresholds. */
  static checkIntervalMs(thresholds: StuckThresholds): number {
    return Math.max(50, Math.min(MAX_CHECK_INTERVAL_MS, thresholds.stuckThresholdMs));
  }

  /**
   * Feed one stream event: resets the silence clock, re-arms the warning, and
   * tracks tool boundaries. Returns the ended tool's name for a matched
   * `tool_end`, else undefined.
   */
  onEvent(event: ClaudeStreamEvent, now: number): string | undefined {
    this.lastActivityAt = now;
    this.warned = false;
    if ((event.type === "tool_start" || event.type === "token_update") && event.parentToolUseId) {
      const parent = this.inFlight.get(`id:${event.parentToolUseId}`);
      if (parent) parent.hasNestedActivity = true;
    }
    switch (event.type) {
      case "tool_start": {
        const key = toolKey(event);
        // Re-insert so a restarted key becomes the most recent tool.
        this.inFlight.delete(key);
        this.inFlight.set(key, {
          toolName: event.toolName,
          startedAt: now,
          hasNestedActivity: false,
        });
        return undefined;
      }
      case "tool_end": {
        const key = toolKey(event);
        const tool = this.inFlight.get(key);
        this.inFlight.delete(key);
        return tool?.toolName;
      }
      default:
        return undefined;
    }
  }

  /** The most recently started tool still in flight, or null. */
  currentTool(): { toolName: string; startedAt: number } | null {
    let latest: InFlightTool | null = null;
    for (const tool of this.inFlight.values()) latest = tool;
    return latest ? { toolName: latest.toolName, startedAt: latest.startedAt } : null;
  }

  /** The oldest in-flight tool with no nested activity (see file header), or null. */
  private oldestQuietTool(): InFlightTool | null {
    let oldest: InFlightTool | null = null;
    for (const tool of this.inFlight.values()) {
      if (!tool.hasNestedActivity && (oldest === null || tool.startedAt < oldest.startedAt)) {
        oldest = tool;
      }
    }
    return oldest;
  }

  /**
   * Returns a warning the first time the rules in the file header are met; null
   * otherwise. Fires at most once per silence episode.
   */
  check(now: number): StuckWarning | null {
    if (this.warned) return null;
    const silentMs = Math.max(0, now - this.lastActivityAt);
    if (silentMs < this.stuckThresholdMs) return null;
    const tool = this.oldestQuietTool();
    if (tool && now - tool.startedAt < this.toolStuckThresholdMs) return null;
    this.warned = true;
    return {
      silentMs,
      currentTool: tool?.toolName ?? null,
      toolRunningMs: tool ? Math.max(0, now - tool.startedAt) : null,
    };
  }
}
