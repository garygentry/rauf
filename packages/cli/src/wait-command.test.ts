import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { acquireLock, resolveBacklogPaths, type BacklogPaths } from "@rauf/core";

import {
  handleLoopWait,
  parseWaitDuration,
  waitExitCode,
  waitForSignificantEvent,
  WaitExitCode,
  type WaitResult,
} from "./wait-command.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

let tmpDir: string;
let raufDir: string;
let paths: BacklogPaths;
let stdoutSpy: { mockRestore: () => void };
let written: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-wait-"));
  raufDir = path.join(tmpDir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });
  fs.writeFileSync(
    path.join(raufDir, "backlog.json"),
    JSON.stringify({
      project: "t",
      description: "t",
      items: [
        {
          id: "001",
          title: "One",
          status: "done",
          priority: 1,
          type: "feature",
          description: "d",
          acceptanceCriteria: ["a"],
        },
        {
          id: "002",
          title: "Two",
          status: "pending",
          priority: 2,
          type: "feature",
          description: "d",
          acceptanceCriteria: ["a"],
        },
      ],
    }),
  );
  const p = resolveBacklogPaths(tmpDir, raufDir);
  if (!p.ok) throw new Error(p.error.message);
  paths = p.value;
  configureOutput({ noColor: true, quiet: true, json: false });
  written = "";
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    written += String(chunk);
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeState(status: "running" | "complete" | "idle"): void {
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(raufDir, "state.json"),
    JSON.stringify({
      status,
      startedAt: now,
      updatedAt: now,
      iteration: 1,
      maxIterations: 5,
      currentItem: status === "running" ? "002" : null,
      lastSignal: "clean",
      completedItems: [],
      blockedItems: [],
      error: null,
      pid: null,
    }),
  );
}

/** A live loop: running state + a lock held by this (live) process. */
function liveLoop(): void {
  writeState("running");
  const r = acquireLock(paths);
  if (!r.ok) throw new Error(r.error.message);
}

type Rec = Record<string, unknown> & { type: string };

/** Write a run's log: records get dense seqs; the first record's timestamp is the run id. */
function writeRun(runStart: string, records: Rec[]): void {
  const lines = records.map((r, seq) =>
    JSON.stringify({
      timestamp: seq === 0 ? runStart : new Date(Date.parse(runStart) + seq * 1000).toISOString(),
      projectPath: tmpDir,
      seq,
      schemaVersion: "1",
      ...r,
    }),
  );
  fs.writeFileSync(paths.eventsLog, lines.map((l) => l + "\n").join(""));
}

function appendRecord(seq: number, rec: Rec): void {
  fs.appendFileSync(
    paths.eventsLog,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      projectPath: tmpDir,
      seq,
      schemaVersion: "1",
      ...rec,
    }) + "\n",
  );
}

const RUN_A = "2026-10-01T10:00:00.000Z";
const RUN_B = "2026-10-01T11:00:00.000Z";
const started: Rec = { type: "loop_started", maxIterations: 5 };
const selected = (id: string): Rec => ({
  type: "item_selected",
  itemId: id,
  title: id,
  priority: 1,
});
const tokens = (id: string): Rec => ({
  type: "llm_token_update",
  itemId: id,
  inputTokens: 1,
  outputTokens: 1,
});
const completed = (id: string, extra: Record<string, unknown> = {}): Rec => ({
  type: "item_completed",
  itemId: id,
  title: `Title ${id}`,
  ...extra,
});

const fast = { timeoutMs: 300, pollMs: 20 };

describe("parseWaitDuration", () => {
  it.each([
    ["240", 240_000],
    ["90s", 90_000],
    ["4m", 240_000],
    ["1h", 3_600_000],
    ["500ms", 500],
    ["1.5s", 1500],
  ])("%s → %d", (text, ms) => {
    expect(parseWaitDuration(text)).toBe(ms);
  });

  it("rejects junk", () => {
    expect(parseWaitDuration("soon")).toBeNull();
    expect(parseWaitDuration("-5")).toBeNull();
    expect(parseWaitDuration("5d")).toBeNull();
  });
});

describe("waitForSignificantEvent", () => {
  it("returns the first significant event past the cursor, skipping the firehose", async () => {
    liveLoop();
    writeRun(RUN_A, [
      started,
      selected("001"),
      tokens("001"),
      completed("001", { summary: "did it" }),
    ]);

    const r = await waitForSignificantEvent(paths, { ...fast, sinceSeq: 0 });

    expect(r.event?.type).toBe("item_completed");
    expect(r.event?.seq).toBe(3);
    expect(r.card).toBe("[1/2] ✓ 001 Title 001 — did it");
    expect(r.nextSeq).toBe(4);
    expect(r.runId).toBe(RUN_A);
    expect(r.terminal).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(r.loopState).toBe("RUNNING");
    expect(waitExitCode(r)).toBe(WaitExitCode.EVENT);
  });

  it("times out (exit 10) when nothing significant arrives and the loop is live", async () => {
    liveLoop();
    writeRun(RUN_A, [started, selected("001"), tokens("001")]);

    const t0 = Date.now();
    const r = await waitForSignificantEvent(paths, { ...fast, sinceSeq: 0 });

    expect(Date.now() - t0).toBeGreaterThanOrEqual(fast.timeoutMs - 20);
    expect(r.event).toBeNull();
    expect(r.card).toBeNull();
    expect(r.timedOut).toBe(true);
    // The cursor advances past the firehose it already scanned.
    expect(r.nextSeq).toBe(3);
    expect(waitExitCode(r)).toBe(WaitExitCode.TIMEOUT);
  });

  it("defaults to new events only: an old event is not returned without --since-seq", async () => {
    liveLoop();
    writeRun(RUN_A, [started, completed("001")]);
    const r = await waitForSignificantEvent(paths, fast);
    expect(r.timedOut).toBe(true);
    expect(r.nextSeq).toBe(2);
  });

  it("returns an event appended while waiting", async () => {
    liveLoop();
    writeRun(RUN_A, [started, selected("002")]);
    setTimeout(() => appendRecord(2, completed("002")), 60);

    const r = await waitForSignificantEvent(paths, { timeoutMs: 2000, pollMs: 20 });

    expect(r.event?.type).toBe("item_completed");
    expect(r.nextSeq).toBe(3);
  });

  it("returns immediately with exit 11 when the loop has already ended", async () => {
    writeState("complete");
    writeRun(RUN_A, [
      started,
      completed("001"),
      { type: "loop_completed", completedCount: 1, blockedCount: 0 },
    ]);

    const t0 = Date.now();
    const r = await waitForSignificantEvent(paths, { timeoutMs: 5000, pollMs: 20 });

    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.event).toBeNull();
    expect(r.terminal).toBe(true);
    expect(r.card).toBe("■ loop ended — COMPLETE · 1/2 done");
    expect(waitExitCode(r)).toBe(WaitExitCode.TERMINAL);
  });

  it("drains unseen events of an ended run before reporting terminal (never a 0 that hides it)", async () => {
    writeState("complete");
    writeRun(RUN_A, [
      started,
      completed("001"),
      { type: "loop_completed", completedCount: 1, blockedCount: 0 },
    ]);

    const first = await waitForSignificantEvent(paths, { ...fast, sinceSeq: 0 });
    expect(first.event?.type).toBe("item_completed");
    expect(first.terminal).toBe(false);
    expect(first.loopState).toBe("COMPLETE");

    const second = await waitForSignificantEvent(paths, {
      ...fast,
      sinceSeq: first.nextSeq,
      runId: first.runId!,
    });
    expect(second.event?.type).toBe("loop_completed");
    expect(second.terminal).toBe(true);
    expect(waitExitCode(second)).toBe(WaitExitCode.TERMINAL);
  });

  it("treats a live lock as live even when state.json still reads ended (launch race)", async () => {
    writeState("complete");
    const lock = acquireLock(paths);
    expect(lock.ok).toBe(true);
    writeRun(RUN_A, [started]);

    const r = await waitForSignificantEvent(paths, fast);
    expect(r.terminal).toBe(false);
    expect(r.timedOut).toBe(true);
  });

  it("neither loses nor duplicates events across repeated calls", async () => {
    liveLoop();
    writeRun(RUN_A, [
      started,
      selected("001"),
      tokens("001"),
      completed("001"),
      selected("002"),
      { type: "item_blocked", itemId: "002", reason: "no db" },
      tokens("003"),
      { type: "needs_human", itemId: "003", reason: "which API?" },
    ]);

    const seen: number[] = [];
    let cursor = { sinceSeq: 0, runId: undefined as string | undefined };
    let r: WaitResult;
    do {
      r = await waitForSignificantEvent(paths, { ...fast, ...cursor });
      if (r.event) seen.push(r.event.seq);
      cursor = { sinceSeq: r.nextSeq, runId: r.runId ?? undefined };
    } while (!r.timedOut);

    expect(seen).toEqual([3, 5, 7]);
  });

  it("replays a new run from seq 0 when --run-id no longer matches (rotation between calls)", async () => {
    liveLoop();
    writeRun(RUN_A, [started, completed("001"), selected("002"), tokens("002"), tokens("002")]);
    const first = await waitForSignificantEvent(paths, { ...fast, sinceSeq: 0 });
    expect(first.event?.seq).toBe(1);

    // A new run rotates the log; it is already past the old cursor's seq.
    writeRun(RUN_B, [started, selected("002"), completed("002")]);
    const second = await waitForSignificantEvent(paths, {
      ...fast,
      sinceSeq: 5,
      runId: first.runId!,
    });

    expect(second.runChanged).toBe(true);
    expect(second.runId).toBe(RUN_B);
    expect(second.event?.type).toBe("item_completed");
    expect(second.event?.seq).toBe(2);
  });

  it("without --run-id, a cursor past the end of the log is treated as a rotation", async () => {
    liveLoop();
    writeRun(RUN_B, [started, completed("002")]);
    const r = await waitForSignificantEvent(paths, { ...fast, sinceSeq: 9 });
    expect(r.runChanged).toBe(true);
    expect(r.event?.seq).toBe(1);
  });

  it("catches a rotation that happens during the call", async () => {
    liveLoop();
    writeRun(RUN_A, [started, completed("001"), selected("002")]);
    setTimeout(() => writeRun(RUN_B, [started, completed("002")]), 60);

    const r = await waitForSignificantEvent(paths, { timeoutMs: 2000, pollMs: 20 });

    expect(r.runChanged).toBe(true);
    expect(r.runId).toBe(RUN_B);
    expect(r.event?.seq).toBe(1);
  });
});

function ctx(args: string[], flags: Record<string, string | true>, json = false): CommandContext {
  return {
    args,
    flags: new Map(Object.entries(flags)),
    globalFlags: { json, quiet: true, noColor: true, root: null },
    rawArgv: [],
  };
}

describe("handleLoopWait", () => {
  it("prints the JSON result shape and exits 0 on an event", async () => {
    liveLoop();
    writeRun(RUN_A, [started, completed("001")]);

    const code = await handleLoopWait(
      ctx([tmpDir], { "since-seq": "0", timeout: "1s", interval: "0.02" }, true),
    );

    expect(code).toBe(WaitExitCode.EVENT);
    const out = JSON.parse(written.trim()) as WaitResult;
    expect(Object.keys(out).sort()).toEqual(
      [
        "card",
        "event",
        "loopState",
        "nextSeq",
        "progress",
        "runChanged",
        "runId",
        "terminal",
        "timedOut",
      ].sort(),
    );
    expect(out.card).toBe("[1/2] ✓ 001 Title 001");
    expect(out.nextSeq).toBe(2);
  });

  it("prints the card and the next cursor in human mode; exit 10 on timeout", async () => {
    liveLoop();
    writeRun(RUN_A, [started]);

    const code = await handleLoopWait(ctx([tmpDir], { timeout: "100ms", interval: "0.02" }));

    expect(code).toBe(WaitExitCode.TIMEOUT);
    expect(written).toContain("no new events");
    expect(written).toContain(`next: --since-seq 1 --run-id ${RUN_A}`);
  });

  it("rejects a bad --since-seq or --timeout with exit 2", async () => {
    liveLoop();
    vi.spyOn(process.stderr, "write").mockImplementation(
      (() => true) as typeof process.stderr.write,
    );
    expect(await handleLoopWait(ctx([tmpDir], { "since-seq": "-1" }))).toBe(WaitExitCode.USAGE);
    expect(await handleLoopWait(ctx([tmpDir], { "since-seq": "abc" }))).toBe(WaitExitCode.USAGE);
    expect(await handleLoopWait(ctx([tmpDir], { timeout: "soon" }))).toBe(WaitExitCode.USAGE);
    expect(await handleLoopWait(ctx([], {}, true))).toBe(WaitExitCode.USAGE);
  });

  it("runs --notify-cmd with the card on an exception, not on a routine completion", async () => {
    liveLoop();
    const out = path.join(tmpDir, "notified.txt");
    const cmd = `printf '%s|%s' "$RAUF_EVENT_TYPE" "$RAUF_CARD" >> "${out}"`;
    writeRun(RUN_A, [
      started,
      completed("001"),
      { type: "item_blocked", itemId: "002", reason: "no db" },
    ]);

    expect(
      await handleLoopWait(ctx([tmpDir], { "since-seq": "0", timeout: "1s", "notify-cmd": cmd })),
    ).toBe(WaitExitCode.EVENT);
    expect(fs.existsSync(out)).toBe(false);

    expect(
      await handleLoopWait(ctx([tmpDir], { "since-seq": "2", timeout: "1s", "notify-cmd": cmd })),
    ).toBe(WaitExitCode.EVENT);
    expect(fs.readFileSync(out, "utf-8")).toBe("item_blocked|[1/2] ✗ 002 blocked — no db");
  });
});
