// ─── Stuck Detector ─────────────────────────────────────────────
//
// Tracks per-iteration stream activity and the set of tool calls still in
// flight, and decides when to raise `llm_stuck_warning` (#141).
//
// A foreground tool call (e.g. a Bash verification gate) emits no stream events
// between its `tool_start` and `tool_end`, so silence alone is not a hang while a
// tool is running. With a tool in flight the detector uses a separate, much longer
// ceiling, so a genuinely hung tool is still surfaced — just not at the
// normal LLM-silence threshold.
//
// Pure: every method takes an explicit `now` (ms since epoch) so the thresholds
// are testable without timers.

import type { ToolEndEvent, ToolStartEvent } from "./stream-parser.js";

/** Default LLM-silence threshold with no tool in flight (`.rauf.json` `options.stuckThresholdMs`). */
export const DEFAULT_STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Default silence ceiling while a tool call is in flight
 * (`.rauf.json` `options.toolStuckThresholdMs`).
 *
 * 30 minutes: Claude Code's Bash tool caps a foreground call at 10 minutes by
 * default, so a healthy Claude tool call never gets near it, while it still
 * covers raised Bash timeouts and providers with no per-call cap (Codex
 * `command_execution`). It is half the default 60-minute session timeout, so a
 * truly hung tool is surfaced with time left to act before the session is killed.
 */
export const DEFAULT_TOOL_STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export interface StuckThresholds {
  /** Silence (ms) with no tool in flight before warning. */
  stuckThresholdMs: number;
  /** Silence (ms) with a tool in flight before warning. */
  toolStuckThresholdMs: number;
}

/** Payload fields of `llm_stuck_warning` (beyond `itemId`). */
export interface StuckWarning {
  /** Ms since the last stream event. */
  silentMs: number;
  /** Name of the tool call in flight, or null when the LLM itself went silent. */
  currentTool: string | null;
  /** Ms since `currentTool` started, or null when no tool is in flight. */
  toolRunningMs: number | null;
}

interface InFlightTool {
  toolName: string;
  startedAt: number;
}

/** Pairing key for a tool_start/tool_end: the provider's call id, else the block index. */
function toolKey(event: ToolStartEvent | ToolEndEvent): string {
  return event.toolUseId !== undefined ? `id:${event.toolUseId}` : `block:${event.blockIndex}`;
}

export class StuckDetector {
  private readonly stuckThresholdMs: number;
  private readonly toolStuckThresholdMs: number;
  private readonly inFlight = new Map<string, InFlightTool>();
  private lastActivityAt: number;
  private warned = false;

  constructor(thresholds: StuckThresholds, now: number) {
    this.stuckThresholdMs = thresholds.stuckThresholdMs;
    // A tool in flight must never warn EARLIER than plain LLM silence would.
    this.toolStuckThresholdMs = Math.max(
      thresholds.toolStuckThresholdMs,
      thresholds.stuckThresholdMs,
    );
    this.lastActivityAt = now;
  }

  /** How often the caller should poll {@link check}: at most once a minute, sooner for short thresholds. */
  static checkIntervalMs(thresholds: StuckThresholds): number {
    return Math.max(50, Math.min(60_000, thresholds.stuckThresholdMs));
  }

  /** Any stream event: resets the silence clock and re-arms the warning. */
  recordActivity(now: number): void {
    this.lastActivityAt = now;
    this.warned = false;
  }

  toolStarted(event: ToolStartEvent, now: number): void {
    const key = toolKey(event);
    // Re-insert so a restarted key becomes the most recent tool.
    this.inFlight.delete(key);
    this.inFlight.set(key, { toolName: event.toolName, startedAt: now });
  }

  /** Returns the ended tool's name, or undefined when no matching start was seen. */
  toolEnded(event: ToolEndEvent): string | undefined {
    const key = toolKey(event);
    const tool = this.inFlight.get(key);
    this.inFlight.delete(key);
    return tool?.toolName;
  }

  /** The most recently started tool still in flight, or null. */
  currentTool(): { toolName: string; startedAt: number } | null {
    let latest: InFlightTool | null = null;
    for (const tool of this.inFlight.values()) latest = tool;
    return latest;
  }

  /**
   * Returns a warning the first time silence crosses the applicable threshold
   * (tool ceiling while a tool is in flight, else the LLM-silence threshold);
   * null otherwise. Fires at most once per silence episode.
   */
  check(now: number): StuckWarning | null {
    if (this.warned) return null;
    const silentMs = Math.max(0, now - this.lastActivityAt);
    const tool = this.currentTool();
    const threshold = tool ? this.toolStuckThresholdMs : this.stuckThresholdMs;
    if (silentMs < threshold) return null;
    this.warned = true;
    return {
      silentMs,
      currentTool: tool?.toolName ?? null,
      toolRunningMs: tool ? Math.max(0, now - tool.startedAt) : null,
    };
  }
}
