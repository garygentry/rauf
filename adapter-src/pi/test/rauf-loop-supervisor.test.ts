/**
 * Behavioural gate for the rauf-loop-supervisor Pi extension (rauf #154).
 * Ported from feature-forge's forge-loop-supervisor suite and extended. The
 * pure core (tailer, supervisor, guard) is driven directly; the pi-facing
 * wiring is driven with a fake pi and injected deps (no real processes, no
 * fs.watch timing).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyBashCommand,
  classifySubagentCall,
} from "../extensions/rauf-loop-supervisor/guard.js";
import { mirrorPath } from "../extensions/rauf-loop-supervisor/registry.js";
import { LoopSupervisor } from "../extensions/rauf-loop-supervisor/supervisor.js";
import { NdjsonTailer } from "../extensions/rauf-loop-supervisor/tailer.js";
import type {
  LiveSnapshot,
  RaufEvent,
  SupervisorHost,
  SupervisorTask,
} from "../extensions/rauf-loop-supervisor/types.js";
import {
  CARD_MESSAGE_TYPE,
  LEGACY_TASK_ENTRY_TYPE,
  TASK_ENTRY_TYPE,
  WAKE_MESSAGE_TYPE,
  createExtension,
  footerText,
  statusSaysEnded,
  type Deps,
  type ExecResult,
  type PiLike,
} from "../extensions/rauf-loop-supervisor/wiring.js";

const nl = (obj: object) => `${JSON.stringify(obj)}\n`;
let dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "rauf-pi-"));
  dirs.push(d);
  return d;
};
beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// ─── Tailer ──────────────────────────────────────────────────────

describe("NdjsonTailer", () => {
  it("reads only new complete lines and buffers a partial trailing line", () => {
    const file = join(tmp(), "events.ndjson");
    const got: RaufEvent[] = [];
    const t = new NdjsonTailer(file, (r) => got.push(r));
    t.poll(); // absent → no-op
    writeFileSync(file, nl({ type: "a", seq: 1 }) + '{"type":"b","seq":2');
    t.poll();
    expect(got.map((r) => r.seq)).toEqual([1]);
    appendFileSync(file, "}\n");
    t.poll();
    expect(got.map((r) => r.seq)).toEqual([1, 2]);
  });

  it("skips malformed records without stalling", () => {
    const file = join(tmp(), "events.ndjson");
    const got: RaufEvent[] = [];
    const errs: string[] = [];
    const t = new NdjsonTailer(
      file,
      (r) => got.push(r),
      (e) => errs.push(e),
    );
    writeFileSync(file, nl({ type: "a", seq: 1 }) + "not json\n" + nl({ type: "b", seq: 2 }));
    t.poll();
    expect(got.map((r) => r.seq)).toEqual([1, 2]);
    expect(errs).toHaveLength(1);
  });

  it("survives rotation by rename+recreate and signals onRotate", () => {
    const dir = tmp();
    const file = join(dir, "events.ndjson");
    const got: string[] = [];
    let rotations = 0;
    const t = new NdjsonTailer(
      file,
      (r) => got.push(r.type),
      undefined,
      () => rotations++,
    );
    writeFileSync(file, nl({ type: "run1a", seq: 0 }) + nl({ type: "run1b", seq: 1 }));
    t.poll();
    renameSync(file, join(dir, "archived.ndjson"));
    writeFileSync(
      file,
      nl({ type: "run2a", seq: 0 }) + nl({ type: "run2b", seq: 1 }) + nl({ type: "run2c", seq: 2 }),
    );
    t.poll();
    expect(rotations).toBe(1);
    expect(got).toEqual(["run1a", "run1b", "run2a", "run2b", "run2c"]);
  });

  it("a poll that lands between the archive rename and the new file still signals the rotation", () => {
    const dir = tmp();
    const file = join(dir, "events.ndjson");
    const got: string[] = [];
    let rotations = 0;
    const t = new NdjsonTailer(
      file,
      (r) => got.push(r.type),
      undefined,
      () => rotations++,
    );
    writeFileSync(file, nl({ type: "run1", seq: 0 }));
    t.poll();
    renameSync(file, join(dir, "archived.ndjson"));
    t.poll(); // the gap: no file yet
    writeFileSync(file, nl({ type: "run2", seq: 0 }));
    t.poll();
    expect(rotations).toBe(1);
    expect(got).toEqual(["run1", "run2"]);
  });

  it("a seeded inode detects a rotation that happened while away", () => {
    const file = join(tmp(), "events.ndjson");
    writeFileSync(file, nl({ type: "run2", seq: 0 }));
    let rotations = 0;
    const t = new NdjsonTailer(
      file,
      () => {},
      undefined,
      () => rotations++,
      statSync(file).ino + 1_000_000,
    );
    t.poll();
    expect(rotations).toBe(1);
  });

  it("decodes a multibyte character split across two reads", () => {
    const file = join(tmp(), "events.ndjson");
    const got: RaufEvent[] = [];
    const t = new NdjsonTailer(file, (r) => got.push(r));
    const buf = Buffer.from(nl({ type: "item_completed", title: "café", seq: 0 }), "utf8");
    const at = buf.indexOf(0xc3) + 1;
    writeFileSync(file, buf.subarray(0, at));
    t.poll();
    appendFileSync(file, buf.subarray(at));
    t.poll();
    expect(got[0]?.title).toBe("café");
  });
});

// ─── Supervisor ──────────────────────────────────────────────────

function recordingHost() {
  const cards: string[] = [];
  const wakes: { text: string; level: string }[] = [];
  const statuses: (LiveSnapshot | null)[] = [];
  const persisted: SupervisorTask[] = [];
  const checked: string[] = [];
  const host: SupervisorHost = {
    card: (text) => cards.push(text),
    wake: (text, _evt, level) => wakes.push({ text, level }),
    status: (_t, s) => statuses.push(s),
    persist: (t) => persisted.push({ ...t }),
    checkEnded: (t) => checked.push(t.stateDir),
  };
  return { host, cards, wakes, statuses, persisted, checked };
}

function manualReader() {
  let sink: ((r: RaufEvent) => void) | null = null;
  let rotate: (() => void) | null = null;
  return {
    make: (onRecord: (r: RaufEvent) => void, onRotate: () => void) => {
      sink = onRecord;
      rotate = onRotate;
      return { poll() {} };
    },
    feed: (r: RaufEvent) => sink!(r),
    rotate: () => rotate!(),
  };
}

const task = (over: Partial<SupervisorTask> = {}): SupervisorTask => ({
  backlogDir: "specs/auth",
  stateDir: "/s/auth/.rauf",
  eventsFile: "/s/auth/.rauf/events.ndjson",
  launchedAt: "t0",
  total: 3,
  lastSeq: -1,
  closed: false,
  ...over,
});

const completed = (id: string, seq: number, extra: Record<string, unknown> = {}): RaufEvent => ({
  type: "item_completed",
  itemId: id,
  title: `Title ${id}`,
  seq,
  ...extra,
});

describe("LoopSupervisor", () => {
  it("posts a card per completed item (no wake), wakes on exceptions, closes on the run's end", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task(), r.make);

    r.feed(
      completed("001", 0, {
        summary: "did it",
        commitSha: "abc1234ffff",
        doneCount: 1,
        totalCount: 3,
      }),
    );
    expect(h.cards).toEqual(["[1/3] ✓ 001 Title 001 — did it · abc1234"]);
    expect(h.wakes).toHaveLength(0);

    r.feed({ type: "needs_human", itemId: "002", reason: "api key", seq: 1 });
    expect(h.wakes).toHaveLength(1);
    expect(h.wakes[0]!.text).toContain("? 002 needs human — api key");
    expect(h.wakes[0]!.level).toBe("warning");

    r.feed({ type: "loop_completed", completedCount: 1, blockedCount: 0, seq: 2 });
    expect(h.wakes).toHaveLength(2);
    expect(h.wakes[1]!.text).toContain("■ loop completed — 1 done · 0 blocked");
    expect(h.wakes[1]!.text).toContain("close-out");
    expect(sup.progress(task().stateDir)?.closed).toBe(true);
    expect(h.statuses.at(-1)).toBeNull(); // footer cleared at the end
  });

  it("falls back to its own count and the launch total for old-runner events", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task(), r.make);
    r.feed({ type: "item_completed", itemId: "001", title: "A", seq: 0 });
    expect(h.cards).toEqual(["[1/3] ✓ 001 A"]);
  });

  it("ignores the firehose and short sleeps, but tracks the current item for the footer", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task(), r.make);
    r.feed({ type: "item_selected", itemId: "002", title: "B", priority: 1, seq: 0 });
    r.feed({ type: "llm_token_update", itemId: "002", seq: 1 });
    r.feed({
      type: "sleep_start",
      sleepUntil: "2026-10-01T10:01:00.000Z",
      reason: "backoff",
      timestamp: "2026-10-01T10:00:00.000Z",
      seq: 2,
    });
    expect(h.cards).toHaveLength(0);
    expect(h.wakes).toHaveLength(0);
    expect(sup.progress(task().stateDir)).toMatchObject({ currentItem: "002", health: "sleeping" });
    expect(h.persisted).toHaveLength(0); // nothing surfaced → nothing persisted
  });

  it("asks the host to check liveness after loop_error / loop_paused, and ends on request", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task(), r.make);
    r.feed({ type: "loop_error", error: "agent missing", seq: 0 });
    expect(h.checked).toEqual([task().stateDir]);
    sup.end(task().stateDir, "ERROR");
    expect(h.wakes.at(-1)!.text).toContain("■ loop ended — ERROR");
    expect(sup.progress(task().stateDir)?.closed).toBe(true);
  });

  it("dedup: replayed history rebuilds state silently; records past the cursor surface", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task({ lastSeq: 1 }), r.make);
    r.feed(completed("001", 0));
    r.feed({ type: "needs_human", itemId: "002", reason: "x", seq: 1 });
    expect(h.cards).toHaveLength(0);
    expect(h.wakes).toHaveLength(0);
    expect(sup.progress(task().stateDir)?.done).toBe(1);
    r.feed(completed("003", 2));
    expect(h.cards).toEqual(["[2/3] ✓ 003 Title 003"]);
  });

  it("rotation resets the cursor so a new run is surfaced, not swallowed", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task(), r.make);
    r.feed(completed("001", 0));
    r.feed(completed("002", 1));
    r.rotate();
    expect(sup.progress(task().stateDir)).toMatchObject({ done: 0, closed: false });
    r.feed(completed("003", 0));
    expect(h.cards.at(-1)).toBe("[1/3] ✓ 003 Title 003");
  });

  it("a second attach for the same stateDir does not create a duplicate reader", () => {
    const sup = new LoopSupervisor(recordingHost().host);
    let made = 0;
    const mk = () => {
      made++;
      return { poll() {} };
    };
    sup.attach(task(), mk);
    sup.attach(task(), mk);
    expect(made).toBe(1);
  });

  it("reattach: a run that ended while nobody watched is reported once, as stale", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task({ lastSeq: 0 }), r.make, { reattach: true });
    r.feed(completed("001", 0)); // seen before
    r.feed(completed("002", 1)); // unseen
    r.feed({ type: "item_blocked", itemId: "003", reason: "no db", seq: 2 });
    r.feed({
      type: "loop_completed",
      completedCount: 2,
      blockedCount: 1,
      seq: 3,
      timestamp: "2026-10-01T12:00:00.000Z",
    });
    sup.endReplay(task().stateDir);
    expect(h.cards).toHaveLength(0);
    expect(h.wakes).toHaveLength(1);
    expect(h.wakes[0]!.text).toContain(
      "finished at 2026-10-01T12:00:00.000Z while no session was attached",
    );
    expect(h.wakes[0]!.text).toContain("2 done · 1 blocked");
    expect(sup.progress(task().stateDir)?.closed).toBe(true);
    expect(h.persisted.at(-1)).toMatchObject({ lastSeq: 3, closed: true });
  });

  it("reattach: unseen events of a still-running loop surface normally", () => {
    const h = recordingHost();
    const sup = new LoopSupervisor(h.host);
    const r = manualReader();
    sup.attach(task({ lastSeq: 0 }), r.make, { reattach: true });
    r.feed(completed("001", 0));
    r.feed(completed("002", 1));
    expect(h.cards).toHaveLength(0); // held until endReplay
    sup.endReplay(task().stateDir);
    expect(h.cards).toEqual(["[2/3] ✓ 002 Title 002"]);
    expect(sup.progress(task().stateDir)?.closed).toBe(false);
  });
});

// ─── Guard ───────────────────────────────────────────────────────

describe("launch guard", () => {
  it.each([
    "rauf loop run .",
    "rauf loop run . --backlog specs/auth --iterations 5",
    "nohup rauf loop run . > loop.log 2>&1 &",
    "setsid rauf loop run .",
    "rauf loop run . &",
    "timeout 7200 rauf loop run .",
    "cd proj && FOO=1 rauf loop run . | tee out.log",
    "npx @garygentry/rauf loop run .",
    "/usr/local/bin/rauf-dev resume . --backlog specs/x",
    'rauf resume . --answer 003 "use stripe"',
  ])("blocks %s", (cmd) => {
    expect(classifyBashCommand(cmd).kind).toBe("block");
  });

  it.each([
    "rauf loop run --help",
    "rauf loop run . -h",
    'grep -rn "rauf loop run" docs/',
    "echo 'run rauf loop run . later'",
    "rauf status . --json",
    "rauf loop wait . --since-seq 3",
    "rauf follow .",
    "git commit -m 'rauf loop run docs'",
    "ls rauf/",
  ])("allows %s", (cmd) => {
    expect(classifyBashCommand(cmd).kind).toBe("allow");
  });

  it.each([
    "rauf loop run . --detached --follow",
    "rauf loop run . -d -f",
    "rauf loop run a --detached; rauf loop run b",
    "rauf loop run b; rauf loop run a -d",
  ])("blocks %s (a follow view or a foreground run alongside)", (cmd) => {
    expect(classifyBashCommand(cmd).kind).toBe("block");
  });

  it("reports a detached launch with its root and backlog (quoted values restored)", () => {
    expect(classifyBashCommand('rauf loop run "my proj" --backlog "specs/a b" --detached')).toEqual(
      {
        kind: "detached-launch",
        root: "my proj",
        backlog: "specs/a b",
      },
    );
    expect(classifyBashCommand("rauf loop run --backlog specs/x . -d")).toEqual({
      kind: "detached-launch",
      root: ".",
      backlog: "specs/x",
    });
  });

  it("blocks a subagent told to run or watch the loop, not unrelated subagents", () => {
    expect(
      classifySubagentCall("subagent", { task: "Run rauf loop run . and wait for it" }).kind,
    ).toBe("block");
    expect(
      classifySubagentCall("subagent", { task: "tail .rauf/events.ndjson until done" }).kind,
    ).toBe("block");
    expect(classifySubagentCall("subagent", { task: "Review src/auth.ts" }).kind).toBe("allow");
    expect(classifySubagentCall("bash", { command: "rauf loop run ." }).kind).toBe("allow"); // bash handled separately
  });
});

// ─── Wiring ──────────────────────────────────────────────────────

const fakeType = {
  Object: (props: Record<string, unknown>) => ({ type: "object", properties: props }),
  String: (o?: object) => ({ type: "string", ...o }),
  Number: (o?: object) => ({ type: "number", ...o }),
  Boolean: (o?: object) => ({ type: "boolean", ...o }),
  Optional: (s: unknown) => ({ optional: s }),
};

interface Tool {
  name: string;
  execute: (
    id: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: { text: string }[];
    details: Record<string, unknown>;
  }>;
}

function harness(cwd: string, execImpl?: (cmd: string, args: string[]) => ExecResult) {
  const tools = new Map<string, Tool>();
  const on = new Map<string, (e: unknown, c: unknown) => unknown>();
  const sent: { m: { customType: string; content: string }; o?: { triggerTurn?: boolean } }[] = [];
  const entries: { type: string; data: unknown }[] = [];
  const execCalls: { command: string; args: string[] }[] = [];
  const statusCalls: [string, string | undefined][] = [];
  const widgetCalls: [string, string[] | undefined][] = [];
  const notifies: { m: string; l?: string }[] = [];
  const pi: PiLike = {
    registerTool: (t) => tools.set((t as Tool).name, t as Tool),
    on: (e, handler) => on.set(e, handler),
    sendMessage: (m, o) => sent.push({ m, o }),
    appendEntry: (type, data) => entries.push({ type, data }),
    exec: async (command, args) => {
      execCalls.push({ command, args });
      return execImpl
        ? execImpl(command, args)
        : { stdout: '{"loopState":"RUNNING"}', stderr: "", code: 0 };
    },
  };
  const watches: { filePath: string; onChange: () => void; closed: boolean; close(): void }[] = [];
  const deps: Deps = {
    watch: (filePath, onChange) => {
      const w = {
        filePath,
        onChange,
        closed: false,
        close() {
          this.closed = true;
        },
      };
      watches.push(w);
      return w;
    },
    now: () => "2026-10-01T00:00:00.000Z",
    Type: fakeType,
  };
  const ctx = {
    cwd,
    hasUI: true,
    ui: {
      notify: (m: string, l?: string) => notifies.push({ m, l }),
      setStatus: (k: string, t: string | undefined) => statusCalls.push([k, t]),
      setWidget: (k: string, l: string[] | undefined) => widgetCalls.push([k, l]),
    },
    sessionManager: {
      getEntries: () => entries.map((e) => ({ type: "custom", customType: e.type, data: e.data })),
    },
  };
  const control = createExtension(pi, deps);
  const run = (name: string, params: object = {}) =>
    tools.get(name)!.execute("id", params, undefined, undefined, ctx);
  return {
    tools,
    on,
    sent,
    entries,
    execCalls,
    statusCalls,
    widgetCalls,
    notifies,
    watches,
    ctx,
    control,
    run,
  };
}

function project(): { cwd: string; stateDir: string; eventsFile: string } {
  const cwd = tmp();
  const stateDir = join(cwd, "specs/auth/.rauf");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(cwd, "specs/auth/backlog.json"), JSON.stringify({ items: [{}, {}, {}] }));
  return { cwd, stateDir, eventsFile: join(stateDir, "events.ndjson") };
}

describe("wiring: tools", () => {
  it("launch runs `rauf loop run <root> --backlog <dir> --detached` and starts one watcher", async () => {
    const { cwd } = project();
    const h = harness(cwd);
    const res = await h.run("rauf_loop_launch", {
      backlogDir: "specs/auth",
      iterations: 4,
      agent: "pi",
    });
    expect(res.details.launched).toBe(true);
    expect(h.execCalls[0]).toEqual({
      command: "rauf",
      args: [
        "loop",
        "run",
        cwd,
        "--backlog",
        "specs/auth",
        "--detached",
        "--iterations",
        "4",
        "--agent",
        "pi",
      ],
    });
    expect(h.watches).toHaveLength(1);
    expect(h.entries.some((e) => e.type === TASK_ENTRY_TYPE)).toBe(true);
    const again = await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    expect(again.details.launched).toBe(false);
    expect(h.execCalls).toHaveLength(1);
  });

  it("launch reports a refused start (non-zero exit) and supervises nothing", async () => {
    const { cwd } = project();
    const h = harness(cwd, () => ({ stdout: "", stderr: "Working tree is dirty", code: 2 }));
    const res = await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    expect(res.details.launched).toBe(false);
    expect(res.content[0]!.text).toContain("Working tree is dirty");
    expect(h.watches).toHaveLength(0);
  });

  it("events already in the log at launch (a previous run) are not reported", async () => {
    const { cwd, eventsFile } = project();
    writeFileSync(
      eventsFile,
      nl(completed("001", 0)) +
        nl({ type: "loop_completed", completedCount: 1, blockedCount: 0, seq: 1 }),
    );
    const h = harness(cwd);
    await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    h.watches[0]!.onChange();
    expect(h.sent).toHaveLength(0);
    // The new run rotates the log; its events are reported.
    renameSync(eventsFile, `${eventsFile}.old`);
    writeFileSync(
      eventsFile,
      nl({ type: "loop_started", maxIterations: 5, seq: 0 }) + nl(completed("002", 1)),
    );
    h.watches[0]!.onChange();
    expect(h.sent.map((s) => s.m.content)).toEqual(["[1/3] ✓ 002 Title 002"]);
  });

  it("a new run is reported even when a poll lands in the rotation gap", async () => {
    const { cwd, eventsFile } = project();
    const old = Array.from({ length: 10 }, (_, i) => nl({ type: "llm_token_update", seq: i })).join(
      "",
    );
    writeFileSync(eventsFile, old); // previous run, lastSeq 9
    const h = harness(cwd);
    await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    renameSync(eventsFile, `${eventsFile}.archived`);
    h.watches[0]!.onChange(); // the gap
    writeFileSync(
      eventsFile,
      nl({ type: "loop_started", maxIterations: 5, seq: 0 }) + nl(completed("001", 1)),
    );
    h.watches[0]!.onChange();
    expect(h.sent.map((m) => m.m.content)).toEqual(["[1/3] ✓ 001 Title 001"]);
  });

  it("cards are triggerTurn:false custom messages; wakes are triggerTurn:true; footer and widget follow", async () => {
    const { cwd, eventsFile } = project();
    const h = harness(cwd);
    await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    const tick = () => h.watches[0]!.onChange();

    writeFileSync(
      eventsFile,
      nl({ type: "item_selected", itemId: "001", title: "A", priority: 1, seq: 0 }),
    );
    tick();
    expect(h.statusCalls.at(-1)).toEqual(["rauf-loop:specs/auth", "● 0/3 · on 001 · healthy"]);

    appendFileSync(eventsFile, nl(completed("001", 1, { doneCount: 1, totalCount: 3 })));
    tick();
    expect(h.sent[0]).toMatchObject({
      m: { customType: CARD_MESSAGE_TYPE, content: "[1/3] ✓ 001 Title 001" },
      o: { triggerTurn: false },
    });
    expect(h.widgetCalls.at(-1)).toEqual([
      "rauf-loop:specs/auth",
      ["rauf loop (specs/auth)", "[1/3] ✓ 001 Title 001"],
    ]);

    appendFileSync(
      eventsFile,
      nl({ type: "item_blocked", itemId: "002", reason: "no db", seq: 2 }),
    );
    tick();
    expect(h.sent[1]).toMatchObject({
      m: { customType: WAKE_MESSAGE_TYPE },
      o: { triggerTurn: true },
    });
    expect(h.notifies.at(-1)?.l).toBe("warning");

    appendFileSync(
      eventsFile,
      nl({ type: "loop_completed", completedCount: 1, blockedCount: 1, seq: 3 }),
    );
    tick();
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]!.o?.triggerTurn).toBe(true);
    expect(h.statusCalls.at(-1)).toEqual(["rauf-loop:specs/auth", undefined]);
    expect(h.widgetCalls.at(-1)).toEqual(["rauf-loop:specs/auth", undefined]);
    expect(h.watches[0]!.closed).toBe(true);
    tick();
    expect(h.sent).toHaveLength(3); // no duplicate terminal wake
  });

  it("status queries `rauf status <root> --backlog <dir> --json` and reads non-zero exits", async () => {
    const { cwd } = project();
    const h = harness(cwd, (_c, args) =>
      args[0] === "status"
        ? {
            stdout: JSON.stringify({
              loopState: "RUNNING",
              backlogSummary: { done: 1, total: 3 },
              currentItem: "002",
            }),
            stderr: "",
            code: 6,
          }
        : { stdout: "", stderr: "", code: 0 },
    );
    await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    const res = await h.run("rauf_loop_status");
    expect(h.execCalls.at(-1)!.args).toEqual(["status", cwd, "--backlog", "specs/auth", "--json"]);
    expect(res.content[0]!.text).toContain("RUNNING · 1/3 done · on 002 · supervised");
  });

  it("stop is scoped to the backlog; it refuses a blind stop", async () => {
    const { cwd } = project();
    const h = harness(cwd);
    const blind = await h.run("rauf_loop_stop");
    expect(blind.details.stopped).toBe(false);
    expect(h.execCalls).toHaveLength(0);

    await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    const res = await h.run("rauf_loop_stop");
    expect(res.details.stopped).toBe(true);
    expect(h.execCalls.at(-1)!.args).toEqual(["loop", "stop", cwd, "--backlog", "specs/auth"]);
    expect(h.watches[0]!.closed).toBe(true);
  });

  it("wait runs a bounded `rauf loop wait --json` and returns the card", async () => {
    const { cwd } = project();
    const h = harness(cwd, () => ({
      stdout: JSON.stringify({ card: "[2/3] ✓ 002 B", timedOut: false, terminal: false }),
      stderr: "",
      code: 0,
    }));
    const res = await h.run("rauf_loop_wait", { backlogDir: "specs/auth", timeoutSeconds: 999 });
    expect(h.execCalls[0]!.args).toEqual([
      "loop",
      "wait",
      cwd,
      "--backlog",
      "specs/auth",
      "--json",
      "--timeout",
      "240s",
    ]);
    expect(res.content[0]!.text).toBe("[2/3] ✓ 002 B");
  });

  it("checkEnded: a loop_error that ended the run closes supervision via rauf status", async () => {
    const { cwd, eventsFile } = project();
    const h = harness(cwd, (_c, args) =>
      args[0] === "status"
        ? {
            stdout: JSON.stringify({
              loopState: "ERROR",
              lock: { present: false, alive: false, stale: false },
            }),
            stderr: "",
            code: 1,
          }
        : { stdout: "", stderr: "", code: 0 },
    );
    await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    writeFileSync(eventsFile, nl({ type: "loop_error", error: "boom", seq: 0 }));
    h.watches[0]!.onChange();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sent.at(-1)!.m.content).toContain("■ loop ended — ERROR");
    expect(h.watches[0]!.closed).toBe(true);
  });
});

describe("wiring: guard hooks", () => {
  it("tool_call blocks a foreground loop run and a babysitting subagent", () => {
    const h = harness(tmp());
    const call = h.on.get("tool_call")!;
    expect(
      call({ toolName: "bash", toolCallId: "1", input: { command: "rauf loop run ." } }, h.ctx),
    ).toMatchObject({
      block: true,
    });
    expect(
      call(
        {
          toolName: "subagent",
          toolCallId: "2",
          input: { task: "run rauf loop run . and report" },
        },
        h.ctx,
      ),
    ).toMatchObject({ block: true });
    expect(
      call(
        { toolName: "bash", toolCallId: "3", input: { command: "rauf status . --json" } },
        h.ctx,
      ),
    ).toBeUndefined();
  });

  it("a successful bash `--detached` launch is auto-attached; a failed one is not", () => {
    const { cwd } = project();
    const h = harness(cwd);
    const call = h.on.get("tool_call")!;
    const result = h.on.get("tool_result")!;
    const cmd = "rauf loop run . --backlog specs/auth --detached";

    call({ toolName: "bash", toolCallId: "a", input: { command: cmd } }, h.ctx);
    result({ toolCallId: "a", isError: true }, h.ctx);
    expect(h.watches).toHaveLength(0);

    call({ toolName: "bash", toolCallId: "b", input: { command: cmd } }, h.ctx);
    result({ toolCallId: "b", isError: false }, h.ctx);
    expect(h.watches).toHaveLength(1);
    expect(h.control.supervisor.isActive(join(cwd, "specs/auth/.rauf"))).toBe(true);
  });
});

describe("wiring: lifecycle", () => {
  it("session_shutdown closes watchers but never stops the runner", async () => {
    const { cwd } = project();
    const h = harness(cwd);
    await h.run("rauf_loop_launch", { backlogDir: "specs/auth" });
    const execs = h.execCalls.length;
    h.on.get("session_shutdown")!({}, {});
    expect(h.watches[0]!.closed).toBe(true);
    expect(h.execCalls).toHaveLength(execs);
  });

  it("a brand-new session reattaches from the disk mirror without re-reporting", () => {
    const { cwd, stateDir, eventsFile } = project();
    writeFileSync(eventsFile, nl(completed("001", 0)) + nl(completed("002", 1)));
    mkdirSync(join(stateDir, "supervisors"), { recursive: true });
    writeFileSync(
      mirrorPath(stateDir),
      JSON.stringify({
        projectPath: cwd,
        backlogDir: "specs/auth",
        stateDir,
        eventsFile,
        launchedAt: "t0",
        total: 3,
        lastSeq: 1,
        closed: false,
      }),
    );
    const h = harness(cwd);
    h.on.get("session_start")!({ reason: "startup" }, h.ctx);
    expect(h.watches).toHaveLength(1);
    expect(h.sent).toHaveLength(0);
    expect(h.control.supervisor.progress(stateDir)?.done).toBe(2);
    expect(h.statusCalls.at(-1)).toEqual(["rauf-loop:specs/auth", "● 2/3 · healthy"]);

    appendFileSync(
      eventsFile,
      nl({ type: "loop_completed", completedCount: 2, blockedCount: 0, seq: 2 }),
    );
    h.watches[0]!.onChange();
    expect(h.sent).toHaveLength(1);
  });

  it("picks up a legacy feature-forge mirror and session entry", () => {
    const { cwd, stateDir, eventsFile } = project();
    writeFileSync(eventsFile, nl(completed("001", 0)));
    writeFileSync(
      join(stateDir, ".forge-supervisor.json"),
      JSON.stringify({
        backlogDir: "specs/auth",
        stateDir,
        eventsFile,
        launchedAt: "t0",
        total: 3,
        lastSeq: 0,
        closed: false,
      }),
    );
    const h = harness(cwd);
    h.entries.push({
      type: LEGACY_TASK_ENTRY_TYPE,
      data: { backlogDir: "specs/auth", stateDir, eventsFile, lastSeq: 0, closed: false },
    });
    h.on.get("session_start")!({ reason: "resume" }, h.ctx);
    expect(h.watches).toHaveLength(1);
    expect(h.sent).toHaveLength(0);
    // Progress persisted to the new mirror location from now on.
    appendFileSync(eventsFile, nl(completed("002", 1)));
    h.watches[0]!.onChange();
    expect(existsSync(mirrorPath(stateDir))).toBe(true);
    expect(JSON.parse(readFileSync(mirrorPath(stateDir), "utf8")).lastSeq).toBe(1);
  });

  it("announces a run that finished while no session was attached, once", () => {
    const { cwd, stateDir, eventsFile } = project();
    writeFileSync(
      eventsFile,
      nl(completed("001", 0)) +
        nl(completed("002", 1)) +
        nl({
          type: "loop_completed",
          completedCount: 2,
          blockedCount: 0,
          seq: 2,
          timestamp: "2026-10-01T12:00:00.000Z",
        }),
    );
    mkdirSync(join(stateDir, "supervisors"), { recursive: true });
    writeFileSync(
      mirrorPath(stateDir),
      JSON.stringify({
        projectPath: cwd,
        backlogDir: "specs/auth",
        stateDir,
        eventsFile,
        launchedAt: "t0",
        total: 3,
        lastSeq: 0,
        closed: false,
      }),
    );
    const h = harness(cwd);
    h.on.get("session_start")!({ reason: "startup" }, h.ctx);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.m.content).toContain("while no session was attached");
    expect(h.sent[0]!.o?.triggerTurn).toBe(true);
    expect(h.watches[0]!.closed).toBe(true);

    // A later session sees the mirror as closed and stays quiet.
    const h2 = harness(cwd);
    h2.on.get("session_start")!({ reason: "startup" }, h2.ctx);
    expect(h2.watches).toHaveLength(0);
    expect(h2.sent).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("footerText and statusSaysEnded", () => {
    expect(
      footerText({ done: 7, total: 26, currentItem: "008", health: "healthy", recentCards: [] }),
    ).toBe("● 7/26 · on 008 · healthy");
    expect(footerText({ done: 2, health: "stuck", recentCards: [] })).toBe("● 2 done · stuck");
    expect(
      statusSaysEnded({ loopState: "RUNNING", lock: { present: true, alive: true } }).ended,
    ).toBe(false);
    expect(
      statusSaysEnded({ loopState: "COMPLETE", lock: { present: true, alive: true } }).ended,
    ).toBe(false);
    expect(statusSaysEnded({ loopState: "COMPLETE", lock: { present: false } }).ended).toBe(true);
    expect(
      statusSaysEnded({ loopState: "RUNNING", lock: { present: true, alive: false, stale: true } })
        .ended,
    ).toBe(true);
  });
});
