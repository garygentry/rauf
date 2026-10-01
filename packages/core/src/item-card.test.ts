import { describe, expect, it } from "vitest";

import {
  ITEM_SUMMARY_MAX_LEN,
  formatCardDuration,
  formatItemCard,
  formatLoopEndedCard,
  formatSupervisionCard,
  isRunEndingEvent,
  isSignificantEvent,
  sanitizeSummary,
} from "./item-card.js";
import { PersistedEventSchema, type PersistedEvent } from "./schemas.js";

const T0 = "2026-10-01T10:00:00.000Z";

function ev<T extends PersistedEvent["type"]>(
  type: T,
  fields: Record<string, unknown> = {},
): Extract<PersistedEvent, { type: T }> {
  // Parse through the real schema so a fixture can never drift from it.
  return PersistedEventSchema.parse({
    type,
    timestamp: T0,
    projectPath: "/p",
    seq: 0,
    schemaVersion: "1",
    ...fields,
  }) as Extract<PersistedEvent, { type: T }>;
}

describe("sanitizeSummary", () => {
  it("collapses whitespace and strips control characters and ANSI escapes", () => {
    expect(sanitizeSummary("  a\n\tb \u001b[31mred\u001b[0m\u0007 c  ")).toBe("a b red c");
  });

  it("returns undefined for null, empty, or whitespace-only text", () => {
    expect(sanitizeSummary(undefined)).toBeUndefined();
    expect(sanitizeSummary(null)).toBeUndefined();
    expect(sanitizeSummary(" \n\t ")).toBeUndefined();
  });

  it("caps at ITEM_SUMMARY_MAX_LEN code points with an ellipsis", () => {
    const out = sanitizeSummary("é".repeat(500))!;
    expect(Array.from(out)).toHaveLength(ITEM_SUMMARY_MAX_LEN);
    expect(out.endsWith("…")).toBe(true);
    expect(sanitizeSummary("short")).toBe("short");
  });

  it("never splits a surrogate pair", () => {
    const out = sanitizeSummary("😀".repeat(200), 10)!;
    expect(Array.from(out)).toEqual([...Array(9).fill("😀"), "…"]);
  });
});

describe("formatCardDuration", () => {
  it.each([
    [0, "0s"],
    [42_000, "42s"],
    [6 * 60_000 + 20_000, "6m"],
    [65 * 60_000, "1h 5m"],
    [120 * 60_000, "2h"],
  ])("%d ms → %s", (ms, out) => {
    expect(formatCardDuration(ms)).toBe(out);
  });
});

describe("formatItemCard", () => {
  it("renders every field", () => {
    const card = formatItemCard(
      ev("item_completed", {
        itemId: "008",
        title: "Add login form",
        summary: "wired the form to /api/login",
        commitSha: "abc1234def5678",
        filesChanged: 5,
        durationMs: 6 * 60_000,
        attempt: 1,
        doneCount: 7,
        totalCount: 26,
      }),
    );
    expect(card).toBe(
      "[7/26] ✓ 008 Add login form — wired the form to /api/login · abc1234 · 5 files · 6m",
    );
  });

  it("falls back to id + title when every optional field is missing (old runner record)", () => {
    expect(formatItemCard(ev("item_completed", { itemId: "008", title: "Add login form" }))).toBe(
      "✓ 008 Add login form",
    );
  });

  it("uses caller progress only when the event carries none", () => {
    const bare = ev("item_completed", { itemId: "1", title: "T" });
    expect(formatItemCard(bare, { done: 3, total: 9 })).toBe("[3/9] ✓ 1 T");
    const own = ev("item_completed", { itemId: "1", title: "T", doneCount: 2, totalCount: 9 });
    expect(formatItemCard(own, { done: 3, total: 9 })).toBe("[2/9] ✓ 1 T");
  });

  it("notes a retried attempt and singular file count", () => {
    const card = formatItemCard(
      ev("item_completed", { itemId: "2", title: "T", filesChanged: 1, attempt: 3 }),
    );
    expect(card).toBe("✓ 2 T · 1 file · attempt 3");
  });

  it("sanitizes a hostile summary and title", () => {
    const card = formatItemCard(
      ev("item_completed", { itemId: "2", title: "multi\nline", summary: "x\u001b[2Jy" }),
    );
    expect(card).toBe("✓ 2 multi line — x y");
  });
});

describe("isSignificantEvent / isRunEndingEvent", () => {
  it("flags outcomes, exceptions and endings; not the firehose", () => {
    expect(isSignificantEvent(ev("item_completed", { itemId: "1", title: "t" }))).toBe(true);
    expect(isSignificantEvent(ev("item_blocked", { itemId: "1", reason: "r" }))).toBe(true);
    expect(isSignificantEvent(ev("needs_human", { itemId: "1", reason: "r" }))).toBe(true);
    expect(isSignificantEvent(ev("loop_error", { error: "e" }))).toBe(true);
    expect(isSignificantEvent(ev("loop_cancelled"))).toBe(true);
    expect(isSignificantEvent(ev("item_selected", { itemId: "1", title: "t", priority: 1 }))).toBe(
      false,
    );
    expect(
      isSignificantEvent(ev("llm_token_update", { itemId: "1", inputTokens: 1, outputTokens: 1 })),
    ).toBe(false);
  });

  it("counts only long sleeps and weekly limits", () => {
    const short = ev("sleep_start", { sleepUntil: "2026-10-01T10:05:00.000Z", reason: "backoff" });
    const long = ev("sleep_start", { sleepUntil: "2026-10-01T14:00:00.000Z", reason: "5h limit" });
    expect(isSignificantEvent(short)).toBe(false);
    expect(isSignificantEvent(long)).toBe(true);
    expect(isSignificantEvent(ev("usage_limit_hit", { limitType: "5h", utilization: 1 }))).toBe(
      false,
    );
    expect(isSignificantEvent(ev("usage_limit_hit", { limitType: "7d", utilization: 1 }))).toBe(
      true,
    );
  });

  it("treats only loop_completed / loop_cancelled as run-ending", () => {
    expect(isRunEndingEvent(ev("loop_completed", { completedCount: 1, blockedCount: 0 }))).toBe(
      true,
    );
    expect(isRunEndingEvent(ev("loop_cancelled"))).toBe(true);
    expect(isRunEndingEvent(ev("loop_error", { error: "e" }))).toBe(false);
  });
});

describe("formatSupervisionCard", () => {
  const p = { done: 7, total: 26 };

  it("renders exception and ending cards", () => {
    expect(formatSupervisionCard(ev("item_blocked", { itemId: "9", reason: "no db" }), p)).toBe(
      "[7/26] ✗ 9 blocked — no db",
    );
    expect(formatSupervisionCard(ev("needs_human", { itemId: "9", reason: "which API?" }))).toBe(
      "? 9 needs human — which API?",
    );
    expect(
      formatSupervisionCard(
        ev("llm_stuck_warning", {
          itemId: "9",
          silentMs: 12 * 60_000,
          currentTool: "Bash",
          toolRunningMs: 11 * 60_000,
        }),
      ),
    ).toBe("⚠ 9 stuck — silent 12m (Bash running 11m)");
    expect(
      formatSupervisionCard(
        ev("loop_completed", { completedCount: 25, blockedCount: 1, needsHumanCount: 0 }),
      ),
    ).toBe("■ loop completed — 25 done · 1 blocked");
    expect(formatSupervisionCard(ev("loop_paused", { reason: "needs_human", itemId: "9" }))).toBe(
      "■ loop paused — 9 needs human",
    );
    expect(
      formatSupervisionCard(
        ev("sleep_start", { sleepUntil: "2026-10-01T14:00:00.000Z", reason: "5h limit" }),
      ),
    ).toBe("⏸ sleeping until 2026-10-01T14:00:00.000Z (4h) — 5h limit");
  });

  it("prints usage utilization as the percentage it already is", () => {
    expect(
      formatSupervisionCard(ev("usage_limit_hit", { limitType: "7d", utilization: 100 })),
    ).toBe("⏸ usage limit (7d, 100%)");
  });

  it("delegates item_completed to formatItemCard", () => {
    const done = ev("item_completed", { itemId: "1", title: "T", summary: "s" });
    expect(formatSupervisionCard(done, p)).toBe(formatItemCard(done, p));
  });

  it("renders the loop-ended card", () => {
    expect(formatLoopEndedCard("COMPLETE", { done: 25, total: 26 })).toBe(
      "■ loop ended — COMPLETE · 25/26 done",
    );
    expect(formatLoopEndedCard("IDLE")).toBe("■ loop ended — IDLE");
  });
});
