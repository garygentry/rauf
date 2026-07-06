import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { defaultBacklogPaths, type BacklogPaths } from "./backlog-root.js";
import {
  appendEvent,
  readEvents,
  rotateEventsLog,
  watchEvents,
  eventAltitude,
  type EventAltitude,
} from "./events-log.js";
import { ErrorCodes } from "./errors.js";
import { EVENTS_SCHEMA_VERSION, type PersistedEvent } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;
let paths: BacklogPaths;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-events-test-"));
  paths = defaultBacklogPaths(tmpDir);
  fs.mkdirSync(paths.stateDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a minimal valid PersistedEvent (loop_started) at a given seq. */
function event(seq: number, overrides: Partial<PersistedEvent> = {}): PersistedEvent {
  return {
    type: "loop_started",
    timestamp: new Date(seq * 1000).toISOString(),
    projectPath: tmpDir,
    maxIterations: 10,
    seq,
    schemaVersion: EVENTS_SCHEMA_VERSION,
    ...overrides,
  } as PersistedEvent;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── appendEvent + readEvents ─────────────────────────────────────

describe("appendEvent / readEvents", () => {
  it("appends one PersistedEvent per line and reads them back", () => {
    expect(appendEvent(paths, event(0)).ok).toBe(true);
    expect(appendEvent(paths, event(1)).ok).toBe(true);

    const lines = fs.readFileSync(paths.eventsLog, "utf-8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);

    const read = readEvents(paths);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value).toHaveLength(2);
      expect(read.value.map((e) => e.seq)).toEqual([0, 1]);
    }
  });

  it("returns records in seq / append order", () => {
    for (let i = 0; i < 5; i++) appendEvent(paths, event(i));
    const read = readEvents(paths);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it("never throws and rejects an out-of-sandbox path with PATH_VIOLATION", () => {
    const escaped: BacklogPaths = {
      ...paths,
      eventsLog: path.join(tmpDir, "..", "escape.ndjson"),
    };
    const result = appendEvent(escaped, event(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCodes.PATH_VIOLATION);
    expect(fs.existsSync(escaped.eventsLog)).toBe(false);
  });

  it("returns ok([]) when the file is missing", () => {
    const read = readEvents(paths);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toEqual([]);
  });

  it("tolerates a torn trailing line", () => {
    appendEvent(paths, event(0));
    appendEvent(paths, event(1));
    // Append a partial JSON line with no trailing newline (simulating a torn write).
    fs.appendFileSync(paths.eventsLog, '{"type":"loop_started","seq":2');

    const read = readEvents(paths);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value).toHaveLength(2);
      expect(read.value.map((e) => e.seq)).toEqual([0, 1]);
    }
  });
});

// ─── rotateEventsLog ──────────────────────────────────────────────

describe("rotateEventsLog", () => {
  it("moves events.ndjson to archive/{ts}-events.ndjson and leaves a fresh (absent) file", () => {
    appendEvent(paths, event(0));
    appendEvent(paths, event(1));

    const result = rotateEventsLog(paths);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(paths.eventsLog)).toBe(false);

    const archived = fs.readdirSync(paths.archive);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatch(/^\d{8}-\d{6}-events\.ndjson$/);

    // The archived content is the prior run's records.
    const archivedContent = fs
      .readFileSync(path.join(paths.archive, archived[0]!), "utf-8")
      .trimEnd()
      .split("\n");
    expect(archivedContent).toHaveLength(2);
  });

  it("is a no-op ok on first run (no events.ndjson)", () => {
    const result = rotateEventsLog(paths);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(paths.eventsLog)).toBe(false);
    expect(fs.existsSync(paths.archive)).toBe(false);
  });

  it("truncate-on-fail: leaves events.ndjson empty and returns err(IO_ERROR) when archiving fails", () => {
    appendEvent(paths, event(0));
    appendEvent(paths, event(1));
    expect(fs.statSync(paths.eventsLog).size).toBeGreaterThan(0);

    // ensureDir succeeds (archive/ exists) but the rename INTO it fails: make the
    // archive dir read-only so renameSync hits EACCES (the truncate-on-fail path).
    fs.mkdirSync(paths.archive, { recursive: true });
    fs.chmodSync(paths.archive, 0o555);

    try {
      const result = rotateEventsLog(paths);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCodes.IO_ERROR);

      // The file is truncated to empty so the next run starts clean.
      expect(fs.existsSync(paths.eventsLog)).toBe(true);
      expect(fs.statSync(paths.eventsLog).size).toBe(0);
    } finally {
      fs.chmodSync(paths.archive, 0o755);
    }
  });

  it("rejects an out-of-sandbox source path with PATH_VIOLATION", () => {
    const escaped: BacklogPaths = {
      ...paths,
      eventsLog: path.join(tmpDir, "..", "escape.ndjson"),
    };
    fs.writeFileSync(escaped.eventsLog, "x\n");
    try {
      const result = rotateEventsLog(escaped);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCodes.PATH_VIOLATION);
    } finally {
      fs.rmSync(escaped.eventsLog, { force: true });
    }
  });
});

// ─── watchEvents ──────────────────────────────────────────────────

describe("watchEvents", () => {
  it("returns a bare cleanup function", () => {
    fs.writeFileSync(paths.eventsLog, "");
    const cleanup = watchEvents(paths, () => {});
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("tails newly appended records via byte-offset re-read", async () => {
    // Seed an existing record so the watcher initializes its offset past it.
    appendEvent(paths, event(0));

    const received: PersistedEvent[] = [];
    const cleanup = watchEvents(paths, (records) => received.push(...records));

    await wait(50);
    appendEvent(paths, event(1));
    appendEvent(paths, event(2));

    // Poll for delivery (fs.watch is async + platform-dependent).
    for (let i = 0; i < 40 && received.length < 2; i++) await wait(25);
    cleanup();

    expect(received.map((e) => e.seq).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("does not emit a partial trailing line until it completes", async () => {
    fs.writeFileSync(paths.eventsLog, "");
    const received: PersistedEvent[] = [];
    const cleanup = watchEvents(paths, (records) => received.push(...records));

    await wait(50);
    // Write a partial line (no newline) — must not be emitted.
    fs.appendFileSync(paths.eventsLog, '{"type":"loop_started","seq":0');
    await wait(100);
    expect(received).toHaveLength(0);

    // Complete the line.
    fs.appendFileSync(
      paths.eventsLog,
      `,"timestamp":"${new Date().toISOString()}","projectPath":"${tmpDir}","maxIterations":10,"schemaVersion":"${EVENTS_SCHEMA_VERSION}"}\n`,
    );
    for (let i = 0; i < 40 && received.length < 1; i++) await wait(25);
    cleanup();

    expect(received).toHaveLength(1);
    expect(received[0]!.seq).toBe(0);
  });
});

// ─── eventAltitude ────────────────────────────────────────────────

describe("eventAltitude", () => {
  // Exhaustive table over all 24 LoopEvent types (schemas.ts LoopEventSchema).
  const table: Array<[PersistedEvent["type"], EventAltitude]> = [
    // FIREHOSE (5)
    ["iteration_start", "firehose"],
    ["llm_spawned", "firehose"],
    ["llm_exited", "firehose"],
    ["llm_tool_activity", "firehose"],
    ["llm_token_update", "firehose"],
    // ITEM (19)
    ["loop_started", "item"],
    ["item_selected", "item"],
    ["signal_parsed", "item"],
    ["item_completed", "item"],
    ["item_blocked", "item"],
    ["item_retried", "item"],
    ["needs_human", "item"],
    ["loop_paused", "item"],
    ["usage_limit_hit", "item"],
    ["usage_limit_cleared", "item"],
    ["sleep_start", "item"],
    ["sleep_end", "item"],
    ["loop_completed", "item"],
    ["loop_error", "item"],
    ["loop_cancelled", "item"],
    ["review_started", "item"],
    ["review_completed", "item"],
    ["review_failed", "item"],
    ["llm_stuck_warning", "item"],
  ];

  it("classifies all 24 LoopEvent types per the spec table", () => {
    expect(table).toHaveLength(24);
    expect(table.filter(([, a]) => a === "firehose")).toHaveLength(5);
    expect(table.filter(([, a]) => a === "item")).toHaveLength(19);
    for (const [type, expected] of table) {
      const ev = {
        type,
        seq: 0,
        schemaVersion: EVENTS_SCHEMA_VERSION,
      } as unknown as PersistedEvent;
      expect(eventAltitude(ev)).toBe(expected);
    }
  });

  it('returns "firehose" for an unrecognized runtime type and does not throw', () => {
    const bogus = { type: "totally_unknown_event", seq: 99 } as unknown as PersistedEvent;
    expect(() => eventAltitude(bogus)).not.toThrow();
    expect(eventAltitude(bogus)).toBe("firehose");
  });
});
