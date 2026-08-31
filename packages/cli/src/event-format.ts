// ─── Rich Event Formatting ───────────────────────────────────────
//
// One canonical human renderer for a PersistedEvent, shared by `rauf follow`
// and `rauf log --follow`'s event branch. The events.ndjson records carry rich
// payloads (item titles, tool names, token counts, signals, durations, review
// summaries); this module surfaces that detail instead of the old `#seq type`
// reduction. The `--json` paths are unaffected — they emit the full record and
// never call this.

import type { DerivedStatus, PersistedEvent } from "@rauf/core";

import { c } from "./formatter.js";

/** Compact a duration in ms to "1.2s" / "3m 4s". */
function fmtDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

/** Compact a token count to "18.4k" / "942". */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Truncate long free-text (titles, reasons, summaries) for a single line. */
function clip(s: string, max = 80): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * A short suffix noting a captured stdout/stderr diagnostic tail (#74), when
 * either is present. Keeps the single-line event terse — the full tail lives
 * in rauf.log, not inline here.
 */
function tailNote(stdoutTail?: string, stderrTail?: string): string {
  return stdoutTail || stderrTail ? ` ${c.dim("(diagnostic tail captured — see rauf.log)")}` : "";
}

/**
 * Render a PersistedEvent as a single rich human line. Exhaustive over the
 * LoopEvent discriminated union — no silent fallback (REQ-VOCAB-07): an
 * unrecognized type still surfaces its raw type so nothing goes invisible.
 *
 * Shape: `#<seq> <BADGE> <detail>` — the badge is the human-facing event name,
 * the detail is the payload that was previously dropped.
 */
export function formatEvent(ev: PersistedEvent): string {
  const seq = c.dim(`#${ev.seq}`);
  const line = (badge: string, detail = ""): string =>
    detail ? `${seq} ${badge}  ${detail}` : `${seq} ${badge}`;
  const item = (id: string): string => c.dim(`[${id}]`);

  switch (ev.type) {
    case "loop_started":
      return line(
        c.bold(c.cyan("loop started")),
        `max ${ev.maxIterations} iterations${ev.model ? ` · ${c.dim(ev.model)}` : ""}`,
      );
    case "iteration_start":
      return line(c.bold(`iteration ${ev.iteration}/${ev.maxIterations}`));
    case "item_selected":
      return line(
        c.cyan("item selected"),
        `${item(ev.itemId)} ${clip(ev.title)} ${c.dim(`(p${ev.priority})`)}`,
      );
    case "llm_spawned":
      return line(
        c.magenta("llm spawned"),
        `${item(ev.itemId)} ${ev.provider}${ev.model ? ` ${c.dim(ev.model)}` : ""} ${c.dim(`(timeout ${ev.timeoutMinutes}m)`)}`,
      );
    case "llm_exited":
      return line(
        ev.exitCode === 0 && !ev.timedOut ? c.green("llm exited") : c.yellow("llm exited"),
        `${item(ev.itemId)} exit ${ev.exitCode}${ev.timedOut ? c.red(" (timed out)") : ""} ${c.dim(`in ${fmtDuration(ev.durationMs)}`)}`,
      );
    case "signal_parsed":
      return line(
        c.bold("signal"),
        `${item(ev.itemId)} ${c.bold(ev.signal)}${ev.reason ? ` ${c.dim(`— ${clip(ev.reason)}`)}` : ""}`,
      );
    case "item_completed":
      return line(c.green("item completed"), `${item(ev.itemId)} ${clip(ev.title)}`);
    case "item_blocked":
      return line(
        c.yellow("item blocked"),
        `${item(ev.itemId)} ${c.dim(clip(ev.reason))}${tailNote(ev.stdoutTail, ev.stderrTail)}`,
      );
    case "item_retried":
      return line(
        c.yellow("item retried"),
        `${item(ev.itemId)} attempt ${ev.attempt}/${ev.maxRetries}${tailNote(ev.stdoutTail, ev.stderrTail)}`,
      );
    case "needs_human":
      return line(c.yellow("needs human"), `${item(ev.itemId)} ${c.dim(clip(ev.reason))}`);
    case "loop_paused":
      return line(c.yellow("loop paused"), `${item(ev.itemId)} ${c.dim(ev.reason)}`);
    case "usage_limit_hit":
      return line(
        c.red("usage limit"),
        `${ev.limitType} ${c.dim(`(util ${Math.round(ev.utilization * 100)}%)`)}`,
      );
    case "usage_limit_cleared":
      return line(c.green("usage limit cleared"), ev.limitType);
    case "sleep_start":
      return line(c.dim("sleep start"), `until ${ev.sleepUntil} ${c.dim(`— ${ev.reason}`)}`);
    case "sleep_end":
      return line(c.dim("sleep end"));
    case "loop_completed":
      return line(
        c.bold(c.green("loop completed")),
        `${ev.completedCount} done · ${ev.blockedCount} blocked${
          ev.needsHumanCount != null ? ` · ${ev.needsHumanCount} needs-human` : ""
        }`,
      );
    case "loop_error":
      return line(c.red("loop error"), c.dim(clip(ev.error)));
    case "loop_cancelled":
      return line(c.yellow("loop cancelled"));
    case "review_started":
      return line(c.cyan("review started"), c.dim(`${ev.completedItemIds.length} items`));
    case "review_completed":
      return line(
        c.green("review completed"),
        `${ev.itemsCreated} item(s) created ${c.dim(`— ${clip(ev.summary)}`)}`,
      );
    case "review_failed":
      return line(
        c.red("review failed"),
        ev.stdoutTail || ev.stderrTail
          ? `${clip(ev.reason)} ${c.dim("(diagnostic tail captured — see rauf.log)")}`
          : c.dim(clip(ev.reason)),
      );
    case "llm_tool_activity": {
      // Tool-end records often carry a placeholder name ("unknown") — the runner
      // can't always pair the close back to a name. Show the name only when it's
      // meaningful so the end marker stays quiet rather than printing "unknown".
      const named = ev.toolName && ev.toolName !== "unknown";
      return line(
        c.dim(ev.phase === "start" ? "tool ▶" : "tool ◀"),
        named ? `${item(ev.itemId)} ${c.cyan(ev.toolName)}` : item(ev.itemId),
      );
    }
    case "llm_token_update":
      return line(
        c.dim("tokens"),
        `${item(ev.itemId)} ${c.dim(`in ${fmtTokens(ev.inputTokens)} · out ${fmtTokens(ev.outputTokens)}`)}`,
      );
    case "llm_stuck_warning":
      return line(
        c.yellow("stuck warning"),
        `${item(ev.itemId)} ${c.dim(`silent ${fmtDuration(ev.silentMs)}`)}`,
      );
    default: {
      // Exhaustiveness guard — if a new event type is added without a case here,
      // this still surfaces the raw type rather than rendering nothing.
      const unknown = ev as PersistedEvent;
      return `${c.dim(`#${unknown.seq}`)} ${c.dim(unknown.type)}`;
    }
  }
}

// ─── Sticky Progress Header (item-level `follow`) ────────────────
//
// The header re-rendered above the item-level `follow` feed (04 §4.3). It is
// sourced entirely from a DerivedStatus poll — the same poll `follow` already
// runs — so there is no new scan or data model (REQ-CMD-05). State is carried by
// a leading TEXT label, never by color alone (REQ-A11Y-01): color only
// re-emphasizes the already-present label.

/**
 * The state text label for the sticky header — always present, so state never
 * depends on color (REQ-A11Y-01). Reuses `getStateLabel`'s tone via the derived
 * loop state, folding in the needs-human / blocked distinction the raw
 * `loopState` does not carry.
 */
function deriveStateLabel(status: DerivedStatus): string {
  const summary = status.backlogSummary;
  if (status.loopState === "PAUSED_HUMAN" || (summary.needsHuman ?? 0) > 0) {
    return "needs-human";
  }
  switch (status.loopState) {
    case "COMPLETE":
    case "ITERATIONS_COMPLETE":
      return "complete";
    case "SLEEPING_LIMIT":
      return "sleeping";
    case "PAUSED":
    case "PAUSED_USAGE_LIMIT":
    case "LIMIT_REACHED":
    case "WEEKLY_LIMIT":
      return "paused";
    default:
      break;
  }
  if (status.loopState === "ERROR" || summary.blocked > 0) return "blocked";
  return "healthy";
}

/** Re-emphasize the (already-present) text label with color — never the sole carrier. */
function colorizeLabel(label: string, body: string): string {
  switch (label) {
    case "complete":
    case "healthy":
      return c.green(body);
    default:
      // needs-human / blocked / paused / sleeping — all warning-toned.
      return c.yellow(body);
  }
}

/**
 * Render the sticky progress header for the item-level `follow` feed
 * (REQ-CMD-02). Sourced from a DerivedStatus poll — no new scan (REQ-CMD-05).
 *
 * Shape (color-capable TTY): `healthy  4/12 done · 1 blocked · on auth-007`.
 * The `blocked` segment is omitted when 0; the `on <item>` segment is omitted
 * when `currentItem` is null. State is conveyed by the leading TEXT LABEL, never
 * by color alone (REQ-A11Y-01) — when `opts.color` is false the returned string
 * contains no ANSI escape sequences.
 *
 * @param status - The current DerivedStatus from the follow poll.
 * @param opts.color - Whether ANSI color is enabled (from detectColorSupport()).
 * @returns A single-line header string (no trailing newline).
 */
export function formatFollowHeader(status: DerivedStatus, opts: { color: boolean }): string {
  const s = status.backlogSummary;
  const parts: string[] = [`${s.done}/${s.total} done`];
  if (s.blocked > 0) parts.push(`${s.blocked} blocked`);
  if (status.currentItem) parts.push(`on ${status.currentItem}`);

  const label = deriveStateLabel(status);
  const body = `${label}  ${parts.join(" · ")}`;

  // Color is decorative only: it re-emphasizes the label, never replaces it.
  if (!opts.color) return body;
  return colorizeLabel(label, body);
}
