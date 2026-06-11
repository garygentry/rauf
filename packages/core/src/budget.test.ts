import { describe, it, expect } from "vitest";

import {
  computeMaxIterations,
  formatBudgetMath,
  resolveMaxIterations,
  formatMaxIterationsSource,
  DEFAULT_RETRY_HEADROOM,
  MIN_MAX_ITERATIONS,
} from "./budget.js";
import type { Backlog, BacklogItem, BacklogItemStatus } from "./schemas.js";

function makeItem(
  id: string,
  status: BacklogItemStatus,
  estimatedIterations?: number,
): BacklogItem {
  return {
    id,
    type: "feature",
    priority: 1,
    title: `Item ${id}`,
    description: "",
    acceptanceCriteria: [],
    status,
    ...(estimatedIterations !== undefined ? { estimatedIterations } : {}),
  };
}

function makeBacklog(items: BacklogItem[]): Backlog {
  return {
    schemaVersion: "1",
    project: "test",
    description: "test backlog",
    items,
  };
}

describe("computeMaxIterations", () => {
  it("returns a zero cap for an empty backlog (no floor applied)", () => {
    const result = computeMaxIterations(makeBacklog([]));
    expect(result).toEqual({ cap: 0, pending: 0, avgIters: 0, needed: 0 });
  });

  it("returns a zero cap when there are no pending items", () => {
    const result = computeMaxIterations(
      makeBacklog([makeItem("001", "done"), makeItem("002", "blocked")]),
    );
    expect(result.cap).toBe(0);
    expect(result.pending).toBe(0);
  });

  it("floors the cap at 20 when pending items exist but the estimate is small", () => {
    // ceil(1 × 1 × 1.5) + 5 = 2 + 5 = 7 → floored to 20
    const result = computeMaxIterations(makeBacklog([makeItem("001", "pending")]));
    expect(result.pending).toBe(1);
    expect(result.avgIters).toBe(1);
    expect(result.needed).toBe(Math.ceil(1 * 1 * 1.5) + DEFAULT_RETRY_HEADROOM);
    expect(result.cap).toBe(MIN_MAX_ITERATIONS);
  });

  it("counts only pending items and defaults missing estimatedIterations to 1", () => {
    const result = computeMaxIterations(
      makeBacklog([
        makeItem("001", "pending"), // est 1 (default)
        makeItem("002", "pending", 3),
        makeItem("003", "in_progress", 10), // ignored
        makeItem("004", "done", 10), // ignored
      ]),
    );
    expect(result.pending).toBe(2);
    expect(result.avgIters).toBe(2); // (1 + 3) / 2
    // ceil(2 * 2 * 1.5) + 5 = 11 → floored to 20
    expect(result.needed).toBe(11);
    expect(result.cap).toBe(MIN_MAX_ITERATIONS);
  });

  it("rises above the floor for a large all-pending backlog", () => {
    // 30 pending × 2 iter × 1.5 + 5 = 95
    const items = Array.from({ length: 30 }, (_, i) =>
      makeItem(String(i).padStart(3, "0"), "pending", 2),
    );
    const result = computeMaxIterations(makeBacklog(items));
    expect(result.pending).toBe(30);
    expect(result.avgIters).toBe(2);
    expect(result.needed).toBe(95);
    expect(result.cap).toBe(95);
  });

  it("respects custom safety and retryHeadroom options", () => {
    const result = computeMaxIterations(
      makeBacklog([makeItem("001", "pending", 4), makeItem("002", "pending", 4)]),
      { safety: 2, retryHeadroom: 10 },
    );
    expect(result.avgIters).toBe(4);
    // ceil(2 * 4 * 2) + 10 = 26
    expect(result.needed).toBe(26);
    expect(result.cap).toBe(26);
  });

  it("uses Math.ceil on the scaled estimate", () => {
    // 3 pending, est (1,1,2) avg 1.333; ceil(3 * 1.333 * 1.5) = ceil(6) = 6; +5 = 11
    const result = computeMaxIterations(
      makeBacklog([
        makeItem("001", "pending"),
        makeItem("002", "pending"),
        makeItem("003", "pending", 2),
      ]),
    );
    expect(result.pending).toBe(3);
    expect(result.needed).toBe(11);
  });
});

describe("formatBudgetMath", () => {
  it("renders the budget math one-liner with a trimmed average", () => {
    const estimate = computeMaxIterations(
      makeBacklog([makeItem("001", "pending"), makeItem("002", "pending", 3)]),
    );
    expect(formatBudgetMath(estimate)).toBe(
      "2 pending × ~2 iter = ~11 needed; cap 20 (1.5× headroom)",
    );
  });

  it("keeps one decimal place for non-integer averages", () => {
    const estimate = computeMaxIterations(
      makeBacklog([
        makeItem("001", "pending"),
        makeItem("002", "pending"),
        makeItem("003", "pending", 2),
      ]),
    );
    expect(formatBudgetMath(estimate)).toContain("~1.3 iter");
  });
});

describe("resolveMaxIterations", () => {
  const backlog = makeBacklog([makeItem("001", "pending"), makeItem("002", "pending")]);

  it("prefers the explicit flag over .rauf.json and the computed cap", () => {
    const resolved = resolveMaxIterations({
      flag: 7,
      markerMaxIterations: 100,
      backlog,
    });
    expect(resolved).toEqual({ value: 7, source: "flag" });
  });

  it("uses .rauf.json options.maxIterations when no flag is given", () => {
    const resolved = resolveMaxIterations({
      flag: null,
      markerMaxIterations: 100,
      backlog,
    });
    expect(resolved).toEqual({ value: 100, source: ".rauf.json" });
  });

  it("computes from the backlog when neither flag nor marker is set", () => {
    const resolved = resolveMaxIterations({
      flag: null,
      markerMaxIterations: null,
      backlog,
    });
    expect(resolved.source).toBe("computed");
    expect(resolved.value).toBe(MIN_MAX_ITERATIONS);
    expect(resolved.estimate).toBeDefined();
    expect(resolved.estimate?.pending).toBe(2);
  });

  it("falls back to the flat default (computed) when there is no pending work", () => {
    const resolved = resolveMaxIterations({
      flag: null,
      markerMaxIterations: null,
      backlog: makeBacklog([makeItem("001", "done")]),
      fallback: 20,
    });
    expect(resolved).toEqual({ value: 20, source: "computed" });
    expect(resolved.estimate).toBeUndefined();
  });

  it("falls back to the default when nothing is provided", () => {
    const resolved = resolveMaxIterations({});
    expect(resolved).toEqual({ value: MIN_MAX_ITERATIONS, source: "computed" });
  });
});

describe("formatMaxIterationsSource", () => {
  it("renders the resolved value and its source", () => {
    expect(formatMaxIterationsSource({ value: 42, source: "flag" })).toBe(
      "maxIterations=42 (flag)",
    );
    expect(formatMaxIterationsSource({ value: 100, source: ".rauf.json" })).toBe(
      "maxIterations=100 (.rauf.json)",
    );
    expect(formatMaxIterationsSource({ value: 20, source: "computed" })).toBe(
      "maxIterations=20 (computed)",
    );
  });
});
