import { describe, it, expect } from "vitest";
import type { PersistedEvent } from "@rauf/core";
import { canResume, describeEvent, reviewPendingNotice } from "./status-helpers";

const envelope = {
  timestamp: "2026-09-30T12:00:00.000Z",
  projectPath: "/tmp/p",
  seq: 7,
  schemaVersion: "1",
};

describe("describeEvent — usage_limit_hit (#146)", () => {
  it("renders a plain usage-limit hit without a disagreement suffix", () => {
    const e: PersistedEvent = {
      ...envelope,
      type: "usage_limit_hit",
      limitType: "5h",
      utilization: 0.97,
    };
    expect(describeEvent(e)).toEqual({ label: "Usage limit hit", detail: "5h · 97%" });
  });

  it("renders a usage-API disagreement with its consecutive count", () => {
    const e: PersistedEvent = {
      ...envelope,
      type: "usage_limit_hit",
      limitType: "5h",
      utilization: 0.4,
      reason: "usage_api_disagreement",
      consecutiveDisagreements: 3,
    };
    expect(describeEvent(e).detail).toBe("5h · 40% — banner unconfirmed by usage API ×3");
  });

  it("falls back to ? when the disagreement count is absent", () => {
    const e: PersistedEvent = {
      ...envelope,
      type: "usage_limit_hit",
      limitType: "7d",
      utilization: 0,
      reason: "usage_api_disagreement",
    };
    expect(describeEvent(e).detail).toBe("7d · 0% — banner unconfirmed by usage API ×?");
  });
});

describe("reviewPendingNotice (#146)", () => {
  it("returns null when no review is pending", () => {
    expect(reviewPendingNotice({})).toBeNull();
    expect(reviewPendingNotice({ reviewPending: false, reviewItemIds: ["a"] })).toBeNull();
  });

  it("names the pending review's items and the resume remedy", () => {
    expect(reviewPendingNotice({ reviewPending: true, reviewItemIds: ["001", "002"] })).toBe(
      "The review pass over 2 items (#001, #002) did not finish — Resume (or `rauf resume`) re-runs it.",
    );
    expect(reviewPendingNotice({ reviewPending: true, reviewItemIds: ["001"] })).toContain(
      "over 1 item (#001)",
    );
  });

  it("omits the scope when reviewItemIds is empty or absent", () => {
    const expected = "The review pass did not finish — Resume (or `rauf resume`) re-runs it.";
    expect(reviewPendingNotice({ reviewPending: true, reviewItemIds: [] })).toBe(expected);
    expect(reviewPendingNotice({ reviewPending: true })).toBe(expected);
  });

  it("elides ids beyond the first five", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    expect(reviewPendingNotice({ reviewPending: true, reviewItemIds: ids })).toContain(
      "over 7 items (#a, #b, #c, #d, #e, +2 more)",
    );
  });
});

describe("canResume — Resume button enablement", () => {
  const summary = (total: number, done: number) => ({
    pending: total - done,
    inProgress: 0,
    blocked: 0,
    deferred: 0,
    done,
    total,
  });

  it("needs a resumable state and non-done work when no review is pending", () => {
    expect(canResume({ loopState: "PAUSED", backlogSummary: summary(3, 1) })).toBe(true);
    expect(canResume({ loopState: "PAUSED", backlogSummary: summary(3, 3) })).toBe(false);
    expect(canResume({ loopState: "COMPLETE", backlogSummary: summary(3, 1) })).toBe(false);
    expect(canResume({ loopState: "RUNNING", backlogSummary: summary(3, 1) })).toBe(false);
  });

  it("is enabled for a pending review even when every item is done (#146)", () => {
    for (const loopState of [
      "COMPLETE",
      "IDLE",
      "PAUSED",
      "PAUSED_USAGE_LIMIT",
      "ERROR",
    ] as const) {
      expect(canResume({ loopState, backlogSummary: summary(2, 2), reviewPending: true })).toBe(
        true,
      );
    }
  });

  it("stays disabled for a pending review while a live loop owns the root", () => {
    // Every live/owned state, incl. a review sleeping out a usage limit (#149).
    for (const loopState of ["RUNNING", "REVIEWING", "SLEEPING_LIMIT", "STARTING"]) {
      expect(
        canResume({
          loopState: loopState as never,
          backlogSummary: summary(2, 2),
          reviewPending: true,
        }),
      ).toBe(false);
    }
  });

  it("stays disabled for a pending review while a live process holds the lock", () => {
    const lock = { present: true, pid: 42, startedAt: null, alive: true, stale: false };
    expect(
      canResume({ loopState: "IDLE", backlogSummary: summary(2, 2), reviewPending: true, lock }),
    ).toBe(false);
    // A stale lock is cleared by resume, so it does not block.
    expect(
      canResume({
        loopState: "PAUSED",
        backlogSummary: summary(2, 2),
        reviewPending: true,
        lock: { ...lock, alive: false, stale: true },
      }),
    ).toBe(true);
  });

  it("is enabled for a pending review at WEEKLY_LIMIT (the runner exited, lock released)", () => {
    expect(
      canResume({ loopState: "WEEKLY_LIMIT", backlogSummary: summary(2, 2), reviewPending: true }),
    ).toBe(true);
  });
});
