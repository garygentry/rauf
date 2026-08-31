// @rauf/core — src/state-labels.ts  (shared label map; spec 02 §2 / CANON §4.3)
// NOTE: './schemas.js' is not shipped in this Pi reference bundle; the type(s) it provided are
// inlined below from their canonical @rauf/core definitions so this file stands alone.
type LoopStateEnum =
  | "IDLE"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETE"
  | "PAUSED_HUMAN"
  | "ITERATIONS_COMPLETE"
  | "LIMIT_REACHED"
  | "ERROR"
  | "NOT_INSTALLED"
  | "SLEEPING_LIMIT"
  | "WEEKLY_LIMIT"
  | "REVIEWING"
  | "PAUSED_USAGE_LIMIT";

/** Semantic severity category — surface-agnostic; each consumer maps it to its own palette. */
export type StateTone = "neutral" | "info" | "success" | "warning" | "danger";

/** One display entry per derived state. Carries NO color/CSS (REQ-ARCH-01). */
export interface StateLabel {
  /** Title-Case human label (REQ-VOCAB-06), normative per CANON §4.3. */
  label: string;
  /** Semantic tone the surface maps to a concrete color. */
  tone: StateTone;
}

/**
 * Single source of truth for the human display label + semantic tone of every derived loop state.
 *
 * Total over LoopStateEnum: TypeScript flags a missing key as a compile error
 * (Record<LoopStateEnum, StateLabel> requires every member). Consumed identically by the CLI
 * (tone → terminal color, see 02 §4) and both web pages (tone → CSS palette, see 02 §5).
 *
 * Labels are Title Case (CANON §4.3); the SCREAMING_SNAKE enum value remains the machine wire form
 * in --json / API responses (REQ-VOCAB-06) — this map governs human labels only.
 */
export const STATE_LABELS: Record<LoopStateEnum, StateLabel> = {
  IDLE: { label: "Idle", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  PAUSED: { label: "Paused", tone: "info" },
  COMPLETE: { label: "Complete", tone: "success" },
  PAUSED_HUMAN: { label: "Needs Human", tone: "warning" }, // REQ-VOCAB-05
  ITERATIONS_COMPLETE: { label: "Iterations Complete", tone: "success" },
  LIMIT_REACHED: { label: "Limit Reached", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
  NOT_INSTALLED: { label: "Not Installed", tone: "neutral" },
  SLEEPING_LIMIT: { label: "Sleeping (Limit)", tone: "warning" },
  WEEKLY_LIMIT: { label: "Weekly Limit", tone: "warning" },
  REVIEWING: { label: "Reviewing", tone: "info" }, // REQ-VOCAB-03 (new)
  PAUSED_USAGE_LIMIT: { label: "Usage Limit (Paused)", tone: "warning" }, // REQ-VOCAB-04 (new)
};

/**
 * Total accessor — never returns undefined (STATE_LABELS is total over the enum).
 * Consumers should use this rather than indexing STATE_LABELS directly, so the totality
 * invariant lives in one place.
 */
export function getStateLabel(state: LoopStateEnum): StateLabel {
  return STATE_LABELS[state];
}
