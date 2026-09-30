import type { DerivedStatus, PersistedEvent } from "@rauf/core";

// Maps each PersistedEvent to a short label + salient detail. The switch
// is exhaustive over the discriminated union — the `never`-typed default
// makes typecheck fail if a LoopEvent member is ever added without a
// branch here. An unknown future `type` (forward-stable envelope) still
// renders generically at runtime rather than crashing.
/**
 * A short suffix noting a captured stdout/stderr diagnostic tail (#74), when
 * either is present. Keeps the event feed row terse — the full tail lives in
 * rauf.log, not inline here.
 */
function diagnosticTailNote(stdoutTail?: string, stderrTail?: string): string {
  return stdoutTail || stderrTail ? " (diagnostic tail captured — see rauf.log)" : "";
}

export function describeEvent(e: PersistedEvent): { label: string; detail: string } {
  switch (e.type) {
    case "loop_started":
      return {
        label: "Loop started",
        detail: `max ${e.maxIterations} iterations${e.model ? ` · ${e.model}` : ""}`,
      };
    case "iteration_start":
      return { label: "Iteration", detail: `${e.iteration} / ${e.maxIterations}` };
    case "item_selected":
      return { label: "Item selected", detail: `#${e.itemId} · P${e.priority} — ${e.title}` };
    case "llm_spawned":
      return {
        label: "Agent spawned",
        detail: `#${e.itemId} · ${e.provider}${e.model ? ` ${e.model}` : ""}`,
      };
    case "llm_exited":
      return {
        label: "Agent exited",
        detail: `#${e.itemId} · exit ${e.exitCode}${e.timedOut ? " (timed out)" : ""} · ${Math.round(e.durationMs / 1000)}s`,
      };
    case "signal_parsed":
      return {
        label: "Signal",
        detail: `#${e.itemId} · ${e.signal}${e.reason ? ` — ${e.reason}` : ""}`,
      };
    case "item_completed":
      return { label: "Item completed", detail: `#${e.itemId} — ${e.title}` };
    case "item_blocked":
      return {
        label: "Item blocked",
        detail: `#${e.itemId} — ${e.reason}${diagnosticTailNote(e.stdoutTail, e.stderrTail)}`,
      };
    case "item_retried":
      return {
        label: "Item retried",
        detail: `#${e.itemId} · attempt ${e.attempt}/${e.maxRetries}${diagnosticTailNote(e.stdoutTail, e.stderrTail)}`,
      };
    case "needs_human":
      return { label: "Needs human", detail: `#${e.itemId} — ${e.reason}` };
    case "loop_paused":
      return { label: "Loop paused", detail: `#${e.itemId} · ${e.reason}` };
    case "usage_limit_hit":
      return {
        label: "Usage limit hit",
        detail:
          `${e.limitType} · ${Math.round(e.utilization * 100)}%` +
          // A banner the usage API did not confirm (#146) — mirrors the CLI event view.
          (e.reason === "usage_api_disagreement"
            ? ` — banner unconfirmed by usage API ×${e.consecutiveDisagreements ?? "?"}`
            : ""),
      };
    case "usage_limit_cleared":
      return { label: "Usage limit cleared", detail: e.limitType };
    case "sleep_start":
      return { label: "Sleep", detail: `until ${e.sleepUntil} — ${e.reason}` };
    case "sleep_end":
      return { label: "Sleep ended", detail: "" };
    case "loop_completed":
      return {
        label: "Loop completed",
        detail: `${e.completedCount} done · ${e.blockedCount} blocked${
          e.needsHumanCount != null ? ` · ${e.needsHumanCount} needs human` : ""
        }`,
      };
    case "loop_error":
      return { label: "Loop error", detail: e.error };
    case "loop_cancelled":
      return { label: "Loop cancelled", detail: "" };
    case "review_started":
      return { label: "Review started", detail: `${e.completedItemIds.length} items` };
    case "review_completed":
      return { label: "Review completed", detail: `${e.itemsCreated} created — ${e.summary}` };
    case "review_failed":
      return { label: "Review failed", detail: e.reason };
    case "llm_tool_activity":
      return { label: "Tool", detail: `#${e.itemId} · ${e.toolName} (${e.phase})` };
    case "llm_token_update":
      return {
        label: "Tokens",
        detail: `#${e.itemId} · ${e.inputTokens} in / ${e.outputTokens} out`,
      };
    case "llm_stuck_warning":
      return {
        label: "Stuck warning",
        detail:
          `#${e.itemId} · silent ${Math.round(e.silentMs / 1000)}s` +
          (e.currentTool != null
            ? ` · ${e.currentTool} running ${Math.round((e.toolRunningMs ?? e.silentMs) / 1000)}s`
            : ""),
      };
    default:
      return describeUnknownEvent(e);
  }
}

// Exhaustiveness guard: `e` is `never` when every LoopEvent member above
// is handled. A forward/unknown event still renders by its raw `type`.
function describeUnknownEvent(e: never): { label: string; detail: string } {
  const fallback = e as { type?: unknown };
  return {
    label: typeof fallback.type === "string" ? fallback.type : "event",
    detail: "",
  };
}

/** How many pending-review item ids the notice lists before eliding the rest. */
const REVIEW_IDS_SHOWN = 5;

/**
 * The status page's pending-review notice (#146), or null when no review is
 * pending. A pending review means the run is not done even when every item is
 * (decision-table row 8); `rauf resume` re-runs exactly that review.
 */
export function reviewPendingNotice(
  status: Pick<DerivedStatus, "reviewPending" | "reviewItemIds">,
): string | null {
  if (status.reviewPending !== true) return null;
  const ids = status.reviewItemIds ?? [];
  const shown = ids.slice(0, REVIEW_IDS_SHOWN).map((id) => `#${id}`);
  if (ids.length > REVIEW_IDS_SHOWN) shown.push(`+${ids.length - REVIEW_IDS_SHOWN} more`);
  const scope =
    ids.length === 0
      ? ""
      : ` over ${ids.length} item${ids.length === 1 ? "" : "s"} (${shown.join(", ")})`;
  return `The review pass${scope} did not finish — run \`rauf resume\` from the CLI to re-run it.`;
}
