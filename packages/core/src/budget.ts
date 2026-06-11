// ─── Budget Module ───────────────────────────────────────────────
//
// Derive a right-sized iteration cap from the backlog instead of a flat
// default. When `--iterations` is omitted, the loop budget should reflect
// how much pending work exists and how many iterations each item is
// estimated to take, with headroom for retries.

import type { Backlog } from "./schemas.js";

// ─── Constants ───────────────────────────────────────────────────

/** Multiplier applied to the raw estimate to leave room for slop. */
export const DEFAULT_SAFETY_FACTOR = 1.5;

/** Flat number of extra iterations added on top of the scaled estimate. */
export const DEFAULT_RETRY_HEADROOM = 5;

/** Floor for the cap whenever there is pending work. */
export const MIN_MAX_ITERATIONS = 20;

// ─── Types ───────────────────────────────────────────────────────

export interface ComputeMaxIterationsOptions {
  /** Multiplier on the raw estimate (default {@link DEFAULT_SAFETY_FACTOR}). */
  safety?: number;
  /** Flat iterations added for retries (default {@link DEFAULT_RETRY_HEADROOM}). */
  retryHeadroom?: number;
}

export interface MaxIterationsEstimate {
  /** The derived iteration cap (floored at {@link MIN_MAX_ITERATIONS} when pending > 0). */
  cap: number;
  /** Number of items with status `pending`. */
  pending: number;
  /** Average `estimatedIterations` across pending items (default 1 per item). */
  avgIters: number;
  /** Raw estimate before the floor: ceil(pending * avgIters * safety) + retryHeadroom. */
  needed: number;
}

// ─── computeMaxIterations ────────────────────────────────────────

/**
 * Derive an iteration cap from the backlog's pending work.
 *
 * cap = max(MIN_MAX_ITERATIONS, ceil(pending * avgEstimatedIterations * safety) + retryHeadroom)
 *
 * - `avgEstimatedIterations` is the mean of each pending item's
 *   `estimatedIterations` (missing/invalid defaults to 1).
 * - When there are no pending items, the cap is 0 (nothing to budget for) and
 *   the floor does not apply.
 */
export function computeMaxIterations(
  backlog: Backlog,
  opts?: ComputeMaxIterationsOptions,
): MaxIterationsEstimate {
  const safety = opts?.safety ?? DEFAULT_SAFETY_FACTOR;
  const retryHeadroom = opts?.retryHeadroom ?? DEFAULT_RETRY_HEADROOM;

  const pendingItems = backlog.items.filter((item) => item.status === "pending");
  const pending = pendingItems.length;

  if (pending === 0) {
    return { cap: 0, pending: 0, avgIters: 0, needed: 0 };
  }

  const totalEstimated = pendingItems.reduce(
    (sum, item) => sum + (item.estimatedIterations ?? 1),
    0,
  );
  const avgIters = totalEstimated / pending;

  const needed = Math.ceil(pending * avgIters * safety) + retryHeadroom;
  const cap = Math.max(MIN_MAX_ITERATIONS, needed);

  return { cap, pending, avgIters, needed };
}

/**
 * Format the budget math as a one-line, human-readable summary, e.g.
 * `3 pending × ~1.3 iter = ~11 needed; cap 20 (1.5× headroom)`.
 */
export function formatBudgetMath(
  estimate: MaxIterationsEstimate,
  safety: number = DEFAULT_SAFETY_FACTOR,
): string {
  const avg = estimate.avgIters.toFixed(1).replace(/\.0$/, "");
  return `${estimate.pending} pending × ~${avg} iter = ~${estimate.needed} needed; cap ${estimate.cap} (${safety}× headroom)`;
}

// ─── resolveMaxIterations ────────────────────────────────────────

/** Where a resolved maxIterations value came from (for startup logging). */
export type MaxIterationsSource = "flag" | ".rauf.json" | "computed";

export interface ResolveMaxIterationsInputs {
  /** Explicit `--iterations` flag (or request body) value; null/undefined when omitted. */
  flag?: number | null;
  /** `options.maxIterations` from `.rauf.json`; null/undefined when no marker. */
  markerMaxIterations?: number | null;
  /** Backlog used to compute a budget-sized cap when neither above is set. */
  backlog?: Backlog | null;
  /** Flat fallback when nothing else resolves (default {@link MIN_MAX_ITERATIONS}). */
  fallback?: number;
}

export interface ResolvedMaxIterations {
  /** The resolved iteration cap. */
  value: number;
  /** Which source the value came from. */
  source: MaxIterationsSource;
  /**
   * The backlog estimate, populated ONLY when `source === "computed"` and there
   * was pending work — callers log the budget math (item 010) just in that case.
   */
  estimate?: MaxIterationsEstimate;
}

/**
 * Resolve maxIterations by a single, logged precedence:
 *
 *   explicit flag  >  `.rauf.json` options.maxIterations  >  computeMaxIterations(backlog)
 *
 * When the computed path yields no pending work, the flat `fallback` is used
 * (still reported as `computed`). Pure — callers read the files and do the
 * logging so this stays trivially unit-testable.
 */
export function resolveMaxIterations(inputs: ResolveMaxIterationsInputs): ResolvedMaxIterations {
  const { flag, markerMaxIterations, backlog, fallback = MIN_MAX_ITERATIONS } = inputs;

  if (flag !== null && flag !== undefined) {
    return { value: flag, source: "flag" };
  }

  if (markerMaxIterations !== null && markerMaxIterations !== undefined) {
    return { value: markerMaxIterations, source: ".rauf.json" };
  }

  if (backlog) {
    const estimate = computeMaxIterations(backlog);
    if (estimate.pending > 0) {
      return { value: estimate.cap, source: "computed", estimate };
    }
  }

  return { value: fallback, source: "computed" };
}

/** Format the resolved value + source for a startup log line. */
export function formatMaxIterationsSource(resolved: ResolvedMaxIterations): string {
  return `maxIterations=${resolved.value} (${resolved.source})`;
}
