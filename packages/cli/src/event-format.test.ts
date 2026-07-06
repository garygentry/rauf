import { describe, it, expect, beforeAll } from "vitest";

import { configureOutput } from "./formatter.js";
import { formatEvent, formatFollowHeader } from "./event-format.js";
import type { DerivedStatus, PersistedEvent } from "@rauf/core";

// Render without ANSI so assertions read on plain text.
beforeAll(() => {
  configureOutput({ noColor: true });
});

const base = { timestamp: "2026-06-27T00:00:00.000Z", projectPath: "/p", schemaVersion: "1" };

function ev(partial: Record<string, unknown>): PersistedEvent {
  return { ...base, ...partial } as PersistedEvent;
}

describe("formatEvent", () => {
  it("surfaces the item title on item_selected (not just the type)", () => {
    const out = formatEvent(
      ev({
        seq: 2,
        type: "item_selected",
        itemId: "001",
        title: "Add the vault seam",
        priority: 1,
      }),
    );
    expect(out).toContain("#2");
    expect(out).toContain("item selected");
    expect(out).toContain("[001]");
    expect(out).toContain("Add the vault seam");
    expect(out).toContain("p1");
  });

  it("renders the signal and reason on signal_parsed", () => {
    const out = formatEvent(
      ev({
        seq: 5,
        type: "signal_parsed",
        itemId: "003",
        signal: "blocked",
        reason: "missing dep",
      }),
    );
    expect(out).toContain("blocked");
    expect(out).toContain("missing dep");
  });

  it("compacts tokens and shows the item on llm_token_update", () => {
    const out = formatEvent(
      ev({
        seq: 4,
        type: "llm_token_update",
        itemId: "001",
        inputTokens: 18379,
        outputTokens: 942,
      }),
    );
    expect(out).toContain("18.4k");
    expect(out).toContain("942");
  });

  it("shows the tool name and direction on llm_tool_activity", () => {
    const out = formatEvent(
      ev({ seq: 6, type: "llm_tool_activity", itemId: "001", toolName: "Read", phase: "start" }),
    );
    expect(out).toContain("Read");
  });

  it("formats duration and exit code on llm_exited", () => {
    const out = formatEvent(
      ev({
        seq: 9,
        type: "llm_exited",
        itemId: "001",
        provider: "claude-cli",
        exitCode: 0,
        timedOut: false,
        durationMs: 173362,
      }),
    );
    expect(out).toContain("exit 0");
    expect(out).toContain("2m 53s");
  });

  it("summarizes counts on loop_completed", () => {
    const out = formatEvent(
      ev({
        seq: 99,
        type: "loop_completed",
        completedCount: 12,
        blockedCount: 0,
        needsHumanCount: 0,
      }),
    );
    expect(out).toContain("12 done");
    expect(out).toContain("0 blocked");
  });

  it("clips an overly long review summary to one line", () => {
    const long = "x".repeat(200);
    const out = formatEvent(
      ev({ seq: 7, type: "review_completed", itemsCreated: 1, summary: long }),
    );
    expect(out).toContain("…");
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThan(160);
  });
});

function status(partial: Partial<DerivedStatus>): DerivedStatus {
  return {
    statusSchemaVersion: "1",
    loopState: "RUNNING",
    stateSource: "state.json",
    iteration: 1,
    maxIterations: 12,
    currentItem: null,
    lastSignal: null,
    startedAt: null,
    elapsed: null,
    backlogSummary: {
      pending: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
      total: 0,
    },
    health: null,
    ...partial,
  } as DerivedStatus;
}

describe("formatFollowHeader", () => {
  it("renders done/blocked/on-item with all segments present", () => {
    const out = formatFollowHeader(
      status({
        loopState: "RUNNING",
        currentItem: "auth-007",
        backlogSummary: { pending: 7, inProgress: 1, blocked: 1, done: 4, total: 12 },
      }),
      { color: false },
    );
    expect(out).toContain("4/12 done · 1 blocked · on auth-007");
  });

  it("elides the blocked segment when blocked === 0 and on-item when currentItem === null", () => {
    const out = formatFollowHeader(
      status({
        loopState: "RUNNING",
        currentItem: null,
        backlogSummary: { pending: 8, inProgress: 0, blocked: 0, done: 4, total: 12 },
      }),
      { color: false },
    );
    expect(out).toContain("4/12 done");
    expect(out).not.toContain("blocked");
    expect(out).not.toContain(" on ");
  });

  it("carries state in a text label and emits no ANSI when color is off (REQ-A11Y-01)", () => {
    const blocked = formatFollowHeader(
      status({
        loopState: "RUNNING",
        backlogSummary: { pending: 0, inProgress: 0, blocked: 2, done: 4, total: 12 },
      }),
      { color: false },
    );
    expect(blocked).toContain("blocked");
    // eslint-disable-next-line no-control-regex
    expect(blocked).not.toMatch(/\[/);

    const needsHuman = formatFollowHeader(status({ loopState: "PAUSED_HUMAN" }), { color: false });
    expect(needsHuman).toContain("needs-human");

    const healthy = formatFollowHeader(status({ loopState: "RUNNING" }), { color: false });
    expect(healthy).toContain("healthy");
  });
});
