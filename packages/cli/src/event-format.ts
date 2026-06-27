// ─── Rich Event Formatting ───────────────────────────────────────
//
// One canonical human renderer for a PersistedEvent, shared by `rauf follow`
// and `rauf log --follow`'s event branch. The events.ndjson records carry rich
// payloads (item titles, tool names, token counts, signals, durations, review
// summaries); this module surfaces that detail instead of the old `#seq type`
// reduction. The `--json` paths are unaffected — they emit the full record and
// never call this.

import type { PersistedEvent } from "@rauf/core";

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
      return line(c.yellow("item blocked"), `${item(ev.itemId)} ${c.dim(clip(ev.reason))}`);
    case "item_retried":
      return line(
        c.yellow("item retried"),
        `${item(ev.itemId)} attempt ${ev.attempt}/${ev.maxRetries}`,
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
      return line(c.red("review failed"), c.dim(clip(ev.reason)));
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
