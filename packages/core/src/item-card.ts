// ─── Supervision Cards ───────────────────────────────────────────
//
// One deterministic, plain-text line per significant loop event — the "card" a
// supervising agent posts as a loop progresses (#152/#153). Every host renders
// the SAME line from the SAME event: `rauf loop wait` prints it, `rauf follow`
// embeds it in its item_completed line, and the Pi extension posts it as a
// message. So this module is pure (no I/O, no color, no clock reads) and its
// output depends only on its arguments.
//
// Cards are narration, never a decision surface: `rauf status --json` stays the
// one place a supervisor decides what to do next (loop-observability spec 05).

import type { PersistedEvent, LoopEvent } from "./schemas.js";

/** Cap on an agent-written `RAUF_SUMMARY:` line, after sanitizing. */
export const ITEM_SUMMARY_MAX_LEN = 120;

/** Iteration-contract marker for the optional one-line item summary. */
export const SUMMARY_MARKER = "RAUF_SUMMARY:";

/**
 * A sleep at least this long is significant to a supervisor (a 5h usage-limit
 * sleep is; a few minutes of backoff is not).
 */
export const LONG_SLEEP_MS = 15 * 60 * 1000;

type CardEvent = LoopEvent | PersistedEvent;
type ItemCompletedEvent = Extract<CardEvent, { type: "item_completed" }>;

/** `[done/total]` progress shown as a card prefix when known. */
export interface CardProgress {
  done: number;
  total: number;
}

// ─── Summary sanitizing ─────────────────────────────────────────

// C0/C1 control characters and DEL, plus ANSI CSI/OSC escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?)/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Normalize free text to one safe display line: strip ANSI escapes and control
 * characters (newlines included), collapse whitespace, trim, and cap at `max`
 * characters (an ellipsis marks a cut). Returns `undefined` for text that is
 * empty once cleaned, so callers can omit the field rather than store "".
 */
export function sanitizeSummary(
  text: string | undefined | null,
  max: number = ITEM_SUMMARY_MAX_LEN,
): string | undefined {
  if (text == null) return undefined;
  const cleaned = text
    .replace(ANSI_SEQUENCE, " ")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return undefined;
  const chars = Array.from(cleaned); // code points, so a cut never splits a surrogate pair
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : cleaned;
}

// ─── Significance ───────────────────────────────────────────────

/**
 * Whether a supervisor should be told about this event (#152): item outcomes,
 * exceptions, long sleeps and loop endings. Pure; the firehose (spawn/exit,
 * tool/token activity) and routine milestones (item_selected, short sleeps,
 * review start/finish) are not significant.
 */
export function isSignificantEvent(ev: CardEvent): boolean {
  switch (ev.type) {
    case "item_completed":
    case "item_blocked":
    case "needs_human":
    case "llm_stuck_warning":
    case "review_failed":
    case "loop_completed":
    case "loop_error":
    case "loop_cancelled":
    case "loop_paused":
      return true;
    case "usage_limit_hit":
      // A 5h hit is followed by a sleep_start whose length decides; a weekly
      // limit always stops work for a long time.
      return ev.limitType === "7d";
    case "sleep_start":
      return sleepLengthMs(ev) >= LONG_SLEEP_MS;
    default:
      return false;
  }
}

/**
 * Event types emitted only as a run ends: once one is seen, the run is over even
 * if `state.json` has not caught up yet. (`loop_error` and `loop_paused` are not
 * here — `loop_error` can be followed by more iterations, so terminal-ness for
 * those comes from the derived status.)
 */
export function isRunEndingEvent(ev: CardEvent): boolean {
  return ev.type === "loop_completed" || ev.type === "loop_cancelled";
}

function sleepLengthMs(ev: Extract<CardEvent, { type: "sleep_start" }>): number {
  const until = Date.parse(ev.sleepUntil);
  const at = Date.parse(ev.timestamp);
  if (Number.isNaN(until) || Number.isNaN(at)) return 0;
  return until - at;
}

// ─── Formatting helpers ─────────────────────────────────────────

/** Compact a duration: "42s", "6m", "1h 5m". Minutes are rounded, not truncated. */
export function formatCardDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function clip(text: string, max = 100): string {
  return sanitizeSummary(text, max) ?? "";
}

function prefix(progress: CardProgress | undefined): string {
  return progress ? `[${progress.done}/${progress.total}] ` : "";
}

function progressOf(ev: ItemCompletedEvent): CardProgress | undefined {
  return ev.doneCount != null && ev.totalCount != null
    ? { done: ev.doneCount, total: ev.totalCount }
    : undefined;
}

// ─── formatItemCard ─────────────────────────────────────────────

/**
 * The per-item completion card:
 *
 *   `[7/26] ✓ 008 Add login form — wired the form to /api/login · abc1234 · 5 files · 6m`
 *
 * Every segment but `✓ <id> <title>` is optional and omitted when the event
 * lacks it: the `[done/total]` prefix (the event's own `doneCount`/`totalCount`
 * — progress at completion time — else `progress`), the summary, the 7-char sha, the file count, the
 * duration, and an `attempt N` note for a retried item.
 */
export function formatItemCard(ev: ItemCompletedEvent, progress?: CardProgress): string {
  const head = `${prefix(progressOf(ev) ?? progress)}✓ ${ev.itemId} ${clip(ev.title)}`;
  const summary = sanitizeSummary(ev.summary);
  const tail: string[] = [];
  if (ev.commitSha) tail.push(ev.commitSha.slice(0, 7));
  if (ev.filesChanged != null) {
    tail.push(`${ev.filesChanged} file${ev.filesChanged === 1 ? "" : "s"}`);
  }
  if (ev.durationMs != null) tail.push(formatCardDuration(ev.durationMs));
  if (ev.attempt != null && ev.attempt > 1) tail.push(`attempt ${ev.attempt}`);
  return [summary ? `${head} — ${summary}` : head, ...tail].join(" · ");
}

// ─── formatSupervisionCard ──────────────────────────────────────

/**
 * The card for any event a supervisor is told about. `item_completed` renders
 * via {@link formatItemCard}; the rest get a one-line glyph + summary:
 *
 *   ✗ blocked · ? needs human · ⚠ stuck · ⏸ limit / sleep · ■ loop ended
 *
 * `progress` (when given) prefixes item-scoped cards with `[done/total]`.
 * Total over the event union: a non-significant event still renders (as its
 * raw type) rather than throwing, so a caller can never print nothing.
 */
export function formatSupervisionCard(ev: CardEvent, progress?: CardProgress): string {
  const p = prefix(progress);
  switch (ev.type) {
    case "item_completed":
      return formatItemCard(ev, progress);
    case "item_blocked":
      return `${p}✗ ${ev.itemId} blocked — ${clip(ev.reason)}`;
    case "needs_human":
      return `${p}? ${ev.itemId} needs human — ${clip(ev.reason)}`;
    case "llm_stuck_warning": {
      const tool =
        ev.currentTool != null
          ? ` (${ev.currentTool} running ${formatCardDuration(ev.toolRunningMs ?? ev.silentMs)})`
          : "";
      return `${p}⚠ ${ev.itemId} stuck — silent ${formatCardDuration(ev.silentMs)}${tool}`;
    }
    case "review_failed":
      return `${p}✗ review failed — ${clip(ev.reason)}`;
    case "usage_limit_hit":
      return `${p}⏸ usage limit (${ev.limitType}, ${Math.round(ev.utilization * 100)}%)`;
    case "sleep_start":
      return `${p}⏸ sleeping until ${ev.sleepUntil} (${formatCardDuration(sleepLengthMs(ev))}) — ${clip(ev.reason)}`;
    case "loop_completed": {
      const parts = [`${ev.completedCount} done`, `${ev.blockedCount} blocked`];
      if (ev.needsHumanCount) parts.push(`${ev.needsHumanCount} needs human`);
      return `${p}■ loop completed — ${parts.join(" · ")}`;
    }
    case "loop_error":
      return `${p}■ loop error — ${clip(ev.error)}`;
    case "loop_cancelled":
      return `${p}■ loop cancelled`;
    case "loop_paused":
      return `${p}■ loop paused — ${ev.itemId} needs human`;
    default:
      return `${p}${ev.type}`;
  }
}

/**
 * The card for a loop found already ended with no unseen event to narrate (a
 * `loop wait` that attaches after the run, or a run that died without a final
 * event): `■ loop ended — COMPLETE · 25/26 done`.
 */
export function formatLoopEndedCard(loopState: string, progress?: CardProgress): string {
  return `■ loop ended — ${loopState}${progress ? ` · ${progress.done}/${progress.total} done` : ""}`;
}
