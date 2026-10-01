/**
 * Pi wiring for rauf-loop-supervisor: the four tools (launch / status / wait /
 * stop), the launch guard, live status, and the session lifecycle hooks. Every
 * side effect (file watch, clock, schema builder) is injected, so the whole
 * extension runs in tests against a fake pi; index.ts supplies the real ones.
 *
 * pi surface (0.84): registerTool, on("session_start" | "session_shutdown" |
 * "tool_call" | "tool_result"), sendMessage(msg, { triggerTurn }), appendEntry,
 * exec, and ctx.ui.notify / setStatus / setWidget (guarded by ctx.hasUI).
 * rauf's `--detached` loop is server-owned and outlives the session, so shutdown
 * tears down watchers only — never the runner.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { classifyBashCommand, classifySubagentCall } from "./guard.js";
import { clearMirror, discoverMirrors, readMirror, writeMirror } from "./registry.js";
import { LoopSupervisor, type TaskHandle } from "./supervisor.js";
import { NdjsonTailer } from "./tailer.js";
import type { LiveSnapshot, RaufEvent, SupervisorHost, SupervisorTask } from "./types.js";

/** Session entry type for task identity (read back on session_start). */
export const TASK_ENTRY_TYPE = "rauf-loop-task";
/** feature-forge's legacy entry type, still read on reattach. */
export const LEGACY_TASK_ENTRY_TYPE = "forge-loop-task";
/** Custom message type for per-item cards (no model turn). */
export const CARD_MESSAGE_TYPE = "rauf-loop-progress";
/** Custom message type for wakes (exceptions and loop endings). */
export const WAKE_MESSAGE_TYPE = "rauf-loop";
/** Footer status / widget key prefix. */
export const STATUS_KEY = "rauf-loop";

/** Loop states in which the loop is still doing (or about to resume) work. */
const LIVE_STATES = new Set(["RUNNING", "REVIEWING", "SLEEPING_LIMIT"]);

export interface WatchHandle {
  close(): void;
}

/** The typebox-like builder the tools' parameter schemas are made with (pi
 *  provides `typebox` at runtime; tests pass a plain-object fake). */
export interface SchemaBuilder {
  Object(props: Record<string, unknown>): unknown;
  String(opts?: Record<string, unknown>): unknown;
  Number(opts?: Record<string, unknown>): unknown;
  Boolean(opts?: Record<string, unknown>): unknown;
  Optional(schema: unknown): unknown;
}

export interface Deps {
  /** Watch `filePath` for changes (real: fs.watch on its directory + backstop). */
  watch(filePath: string, onChange: () => void): WatchHandle;
  now(): string;
  Type: SchemaBuilder;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface PiLike {
  registerTool(def: unknown): void;
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  sendMessage(
    message: { customType: string; content: string; display?: boolean; details?: unknown },
    options?: { triggerTurn?: boolean },
  ): void;
  appendEntry(customType: string, data?: unknown): void;
  exec?(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ): Promise<ExecResult>;
}

interface UiLike {
  notify?(message: string, level?: "info" | "warning" | "error"): void;
  setStatus?(key: string, text: string | undefined): void;
  setWidget?(key: string, lines: string[] | undefined): void;
}
interface CtxLike {
  cwd?: string;
  hasUI?: boolean;
  ui?: UiLike;
  sessionManager?: {
    getEntries?(): Array<{ type?: string; customType?: string; data?: unknown }>;
  };
}

/** Where a loop lives, resolved from tool params / a bash command line. */
export interface LoopTarget {
  projectPath: string;
  /** `--backlog` value relative to projectPath, or undefined for the default root. */
  backlogDir?: string;
  stateDir: string;
  eventsFile: string;
}

export function resolveTarget(cwd: string, root?: string, backlogDir?: string): LoopTarget {
  const projectPath = resolve(cwd, root ?? ".");
  const backlogAbs = backlogDir ? resolve(projectPath, backlogDir) : join(projectPath, ".rauf");
  const stateDir = basename(backlogAbs) === ".rauf" ? backlogAbs : join(backlogAbs, ".rauf");
  const rel = backlogDir ? relative(projectPath, backlogAbs) || "." : undefined;
  return { projectPath, backlogDir: rel, stateDir, eventsFile: join(stateDir, "events.ndjson") };
}

/** The log's current end (last seq) and inode — the pre-launch cursor. Events
 *  already there belong to a previous run and must not be reported as new. */
export function currentCursor(eventsFile: string): { lastSeq: number; eventsIno?: number } {
  try {
    const st = statSync(eventsFile);
    const lines = readFileSync(eventsFile, "utf8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const rec = JSON.parse(lines[i]!) as { seq?: unknown };
        if (typeof rec.seq === "number") return { lastSeq: rec.seq, eventsIno: st.ino };
      } catch {
        /* torn/odd line */
      }
    }
    return { lastSeq: -1, eventsIno: st.ino };
  } catch {
    return { lastSeq: -1 };
  }
}

function countBacklog(target: LoopTarget): number | undefined {
  const backlogRoot =
    basename(target.stateDir) === ".rauf" ? join(target.stateDir, "..") : target.stateDir;
  for (const file of [join(backlogRoot, "backlog.json"), join(target.stateDir, "backlog.json")]) {
    try {
      if (!existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { items?: unknown[] };
      if (Array.isArray(parsed.items)) return parsed.items.length;
    } catch {
      /* unreadable → no total */
    }
  }
  return undefined;
}

function textResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

function targetArgs(t: { projectPath: string; backlogDir?: string }): string[] {
  return t.backlogDir ? [t.projectPath, "--backlog", t.backlogDir] : [t.projectPath];
}

/** The footer line for a live loop: `● 7/26 · on 008 · healthy`. */
export function footerText(s: LiveSnapshot): string {
  const progress = s.total !== undefined ? `${s.done}/${s.total}` : `${s.done} done`;
  const parts = [`● ${progress}`];
  if (s.currentItem) parts.push(`on ${s.currentItem}`);
  parts.push(s.health);
  return parts.join(" · ");
}

/** Whether a `rauf status --json` payload says the loop has stopped working. */
export function statusSaysEnded(json: unknown): { ended: boolean; loopState?: string } {
  const s = json as {
    loopState?: unknown;
    lock?: { present?: boolean; alive?: boolean; stale?: boolean };
  };
  if (!s || typeof s.loopState !== "string") return { ended: false };
  const lockAlive = Boolean(s.lock?.present && s.lock.alive);
  if (LIVE_STATES.has(s.loopState)) {
    return { ended: Boolean(s.lock?.present && s.lock.stale), loopState: s.loopState };
  }
  return { ended: !lockAlive, loopState: s.loopState };
}

export function createExtension(pi: PiLike, deps: Deps) {
  const { Type } = deps;
  const watchers = new Map<string, { handle: TaskHandle; watch: WatchHandle }>();
  /** bash tool calls that launch a detached loop, keyed by toolCallId, awaiting their result. */
  const pendingLaunches = new Map<
    string,
    { target: LoopTarget; cursor: ReturnType<typeof currentCursor> }
  >();
  let ctxRef: CtxLike | null = null;
  let lastCwd = process.cwd();

  const ui = (): UiLike | null => (ctxRef?.hasUI && ctxRef.ui ? ctxRef.ui : null);
  const keyFor = (task: SupervisorTask) => `${STATUS_KEY}:${task.backlogDir ?? ".rauf"}`;

  const host: SupervisorHost = {
    card(text, evt) {
      try {
        // triggerTurn:false — the card is saved and shown, and reaches the model
        // on its next turn, but never starts one (zero model cost per item).
        pi.sendMessage(
          { customType: CARD_MESSAGE_TYPE, content: text, display: true, details: evt },
          { triggerTurn: false },
        );
      } catch {
        /* sendMessage unavailable */
      }
    },
    wake(text, evt, level) {
      try {
        pi.sendMessage(
          {
            customType: WAKE_MESSAGE_TYPE,
            content: text,
            display: true,
            details: evt ?? undefined,
          },
          { triggerTurn: true },
        );
      } catch {
        /* sendMessage unavailable */
      }
      try {
        ui()?.notify?.(text, level);
      } catch {
        /* headless */
      }
    },
    status(task, snapshot) {
      const u = ui();
      if (!u) return;
      try {
        u.setStatus?.(keyFor(task), snapshot ? footerText(snapshot) : undefined);
        u.setWidget?.(
          keyFor(task),
          snapshot && snapshot.recentCards.length > 0
            ? [`rauf loop (${task.backlogDir ?? ".rauf"})`, ...snapshot.recentCards]
            : undefined,
        );
      } catch {
        /* UI gone */
      }
    },
    persist(task) {
      try {
        pi.appendEntry(TASK_ENTRY_TYPE, task);
      } catch {
        /* best-effort */
      }
      writeMirror(task);
    },
    checkEnded(task) {
      void queryStatus(task).then((res) => {
        if (!res?.json) return;
        const verdict = statusSaysEnded(res.json);
        if (verdict.ended) {
          supervisor.end(task.stateDir, verdict.loopState ?? "ended");
          stopWatch(task.stateDir);
        }
      });
    },
  };

  const supervisor = new LoopSupervisor(host);

  function rememberCtx(ctx: unknown): CtxLike {
    const c = (ctx ?? {}) as CtxLike;
    if (c.ui || c.hasUI !== undefined) ctxRef = c;
    if (c.cwd) lastCwd = c.cwd;
    return c;
  }

  async function queryStatus(task: {
    projectPath?: string;
    backlogDir?: string;
  }): Promise<{ json: unknown; raw: ExecResult } | null> {
    if (!pi.exec) return null;
    const projectPath = task.projectPath ?? lastCwd;
    try {
      // `status` exits non-zero for most states (6 = running); the JSON on
      // stdout is the answer regardless.
      const raw = await pi.exec(
        "rauf",
        ["status", ...targetArgs({ projectPath, backlogDir: task.backlogDir }), "--json"],
        {
          cwd: projectPath,
          timeout: 15000,
        },
      );
      try {
        return { json: JSON.parse(raw.stdout), raw };
      } catch {
        return { json: null, raw };
      }
    } catch {
      return null;
    }
  }

  function startWatch(task: SupervisorTask, opts: { reattach?: boolean } = {}): void {
    if (watchers.has(task.stateDir)) return;
    const handle = supervisor.attach(
      task,
      (onRecord, onRotate) =>
        new NdjsonTailer(task.eventsFile, onRecord, undefined, onRotate, task.eventsIno),
      opts,
    );
    const pump = () => {
      handle.poll();
      if (supervisor.progress(task.stateDir)?.closed) stopWatch(task.stateDir);
    };
    const watch = deps.watch(task.eventsFile, pump);
    watchers.set(task.stateDir, { handle, watch });
    handle.poll();
    if (opts.reattach) supervisor.endReplay(task.stateDir);
    const p = supervisor.progress(task.stateDir);
    if (p?.closed) stopWatch(task.stateDir);
    else if (p) host.status(task, p);
  }

  function stopWatch(stateDir: string): void {
    const w = watchers.get(stateDir);
    if (!w) return;
    try {
      w.watch.close();
    } catch {
      /* ignore */
    }
    w.handle.close();
    watchers.delete(stateDir);
  }

  /** Start supervising a loop that is being launched now (tool or bash). */
  function superviseLaunch(
    target: LoopTarget,
    cursor: ReturnType<typeof currentCursor>,
  ): SupervisorTask {
    const task: SupervisorTask = {
      projectPath: target.projectPath,
      backlogDir: target.backlogDir,
      stateDir: target.stateDir,
      eventsFile: target.eventsFile,
      eventsIno: cursor.eventsIno,
      launchedAt: deps.now(),
      total: countBacklog(target),
      lastSeq: cursor.lastSeq,
      closed: false,
    };
    host.persist(task);
    startWatch(task);
    return task;
  }

  /** The supervised task a tool call refers to: explicit target, or the only one. */
  function pickTarget(cwd: string, p: { root?: string; backlogDir?: string }): LoopTarget | null {
    if (p.root || p.backlogDir) return resolveTarget(cwd, p.root, p.backlogDir);
    const only = [...watchers.keys()];
    if (only.length !== 1) return null;
    const task = supervisor.task(only[0]!);
    if (!task) return null;
    return {
      projectPath: task.projectPath ?? cwd,
      backlogDir: task.backlogDir,
      stateDir: task.stateDir,
      eventsFile: task.eventsFile,
    };
  }

  const targetParams = {
    root: Type.Optional(
      Type.String({ description: "Project root containing .rauf.json. Default: the session cwd." }),
    ),
    backlogDir: Type.Optional(
      Type.String({
        description:
          "Backlog directory passed as --backlog (e.g. specs/auth). Omit for the project's default .rauf root.",
      }),
    ),
  };

  // ---- Tools -------------------------------------------------------------

  pi.registerTool({
    name: "rauf_loop_launch",
    label: "Launch rauf loop",
    description:
      "Start a rauf autonomous coding loop DETACHED and supervise it. The loop runs in rauf's server " +
      "and outlives this session; this tool returns as soon as it has started. Each completed backlog " +
      "item is then posted as a one-line card (no model turn), and this session is woken on " +
      "needs-human, blocked, stuck, review failure, loop errors and completion. Always use this to " +
      "run a rauf loop on Pi — never run `rauf loop run` in the foreground, with nohup/&, or in a subagent.",
    promptSnippet:
      "Run a rauf loop without blocking the session; get a card per item and a wake on exceptions.",
    parameters: Type.Object({
      ...targetParams,
      iterations: Type.Optional(Type.Number({ description: "Max iterations (--iterations)." })),
      agent: Type.Optional(
        Type.String({ description: "Coding agent id (--agent), e.g. pi, claude-cli, codex." }),
      ),
      model: Type.Optional(
        Type.String({ description: "Model override (--model); 'none' ignores item pins." }),
      ),
      review: Type.Optional(
        Type.Boolean({ description: "Run the review pass after the loop (--review)." }),
      ),
    }),
    async execute(
      _id: string,
      params: unknown,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: unknown,
    ) {
      const p = params as {
        root?: string;
        backlogDir?: string;
        iterations?: number;
        agent?: string;
        model?: string;
        review?: boolean;
      };
      const c = rememberCtx(ctx);
      const target = resolveTarget(c.cwd ?? lastCwd, p.root, p.backlogDir);
      if (supervisor.isActive(target.stateDir)) {
        return textResult(
          `A rauf loop is already supervised for ${target.stateDir}. Use rauf_loop_status to check it, or rauf_loop_stop first.`,
          { launched: false, stateDir: target.stateDir },
        );
      }
      if (!pi.exec)
        return textResult("Cannot launch: this pi has no exec API.", { launched: false });

      const args = ["loop", "run", ...targetArgs(target), "--detached"];
      if (typeof p.iterations === "number") args.push("--iterations", String(p.iterations));
      if (p.agent) args.push("--agent", p.agent);
      if (p.model) args.push("--model", p.model);
      if (p.review) args.push("--review");

      // Cursor BEFORE the launch: the new run rotates the log, and anything
      // already in it belongs to a previous run.
      const cursor = currentCursor(target.eventsFile);
      let res: ExecResult;
      try {
        res = await pi.exec("rauf", args, { cwd: target.projectPath, timeout: 120000 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return textResult(`Failed to run rauf: ${msg}`, { launched: false, error: msg });
      }
      if (res.code !== 0) {
        const out = (res.stderr || res.stdout).trim();
        return textResult(
          `rauf refused to start the loop (exit ${res.code}). Nothing is running.\n${out}\n` +
            "Fix the cause (e.g. a dirty tree or protected branch: see drive-rauf-loop §0) and launch again.",
          { launched: false, exitCode: res.code, output: out },
        );
      }
      superviseLaunch(target, cursor);
      return textResult(
        `Launched \`rauf ${args.join(" ")}\` (detached) and now supervising ${target.eventsFile}. ` +
          "Each completed item arrives as a card; this session is woken on exceptions and at the end. " +
          "You can end your turn now — do NOT poll, sleep, or wait in the foreground.",
        { launched: true, stateDir: target.stateDir, eventsFile: target.eventsFile },
      );
    },
  });

  pi.registerTool({
    name: "rauf_loop_status",
    label: "rauf loop status",
    description:
      "Authoritative status of a rauf loop (`rauf status <root> --backlog <dir> --json`): loop state, " +
      "items done/total, current item, health and lock. Use it to confirm a launch, and before acting " +
      "on any card or wake — decisions come from this, not from the cards.",
    parameters: Type.Object(targetParams),
    async execute(
      _id: string,
      params: unknown,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: unknown,
    ) {
      const p = params as { root?: string; backlogDir?: string };
      const c = rememberCtx(ctx);
      const target = pickTarget(c.cwd ?? lastCwd, p);
      if (!target) {
        return textResult(
          watchers.size > 1
            ? "Several loops are supervised; pass root/backlogDir to pick one."
            : "No loop is supervised in this session; pass root/backlogDir to query one.",
          { ok: false },
        );
      }
      const res = await queryStatus(target);
      const live = supervisor.progress(target.stateDir);
      if (!res?.json) {
        const out = res ? (res.raw.stderr || res.raw.stdout).trim() : "rauf could not be run";
        return textResult(`Could not read rauf status: ${out}`, { ok: false });
      }
      const s = res.json as {
        loopState?: string;
        currentItem?: string | null;
        backlogSummary?: { done?: number; total?: number; blocked?: number; needsHuman?: number };
        health?: { stuckWarning?: boolean } | null;
      };
      const b = s.backlogSummary ?? {};
      const parts = [
        `${s.loopState ?? "?"}`,
        `${b.done ?? "?"}/${b.total ?? "?"} done`,
        b.blocked ? `${b.blocked} blocked` : null,
        b.needsHuman ? `${b.needsHuman} needs human` : null,
        s.currentItem ? `on ${s.currentItem}` : null,
        s.health?.stuckWarning ? "stuck warning" : null,
        live
          ? live.closed
            ? "supervision finished"
            : "supervised"
          : "not supervised by this session",
      ].filter(Boolean);
      return textResult(`rauf loop: ${parts.join(" · ")}\n${JSON.stringify(res.json)}`, {
        ok: true,
        status: res.json,
        supervised: Boolean(live && !live.closed),
      });
    },
  });

  pi.registerTool({
    name: "rauf_loop_wait",
    label: "Wait for rauf loop event",
    description:
      "Block (bounded) until the next significant event of a rauf loop and return its card " +
      "(`rauf loop wait --json`). Only for an on-demand check; a loop started with rauf_loop_launch " +
      "already reports itself, so you don't need to call this in a loop.",
    parameters: Type.Object({
      ...targetParams,
      timeoutSeconds: Type.Optional(
        Type.Number({ description: "Max seconds to wait (default 60, max 240)." }),
      ),
    }),
    async execute(
      _id: string,
      params: unknown,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: unknown,
    ) {
      const p = params as { root?: string; backlogDir?: string; timeoutSeconds?: number };
      const c = rememberCtx(ctx);
      const target = pickTarget(c.cwd ?? lastCwd, p) ?? resolveTarget(c.cwd ?? lastCwd);
      if (!pi.exec) return textResult("Cannot wait: this pi has no exec API.", { ok: false });
      const secs = Math.max(1, Math.min(240, Math.round(p.timeoutSeconds ?? 60)));
      let res: ExecResult;
      try {
        res = await pi.exec(
          "rauf",
          ["loop", "wait", ...targetArgs(target), "--json", "--timeout", `${secs}s`],
          {
            cwd: target.projectPath,
            timeout: (secs + 30) * 1000,
          },
        );
      } catch (e) {
        return textResult(`rauf loop wait failed: ${e instanceof Error ? e.message : String(e)}`, {
          ok: false,
        });
      }
      try {
        const r = JSON.parse(res.stdout) as {
          card?: string | null;
          timedOut?: boolean;
          terminal?: boolean;
          loopState?: string;
        };
        const text =
          r.card ??
          (r.timedOut ? `No significant event in ${secs}s (${r.loopState ?? "?"}).` : "No event.");
        return textResult(text, { ok: true, exitCode: res.code, result: r });
      } catch {
        return textResult(
          `rauf loop wait exited ${res.code}: ${(res.stderr || res.stdout).trim()}`,
          { ok: false },
        );
      }
    },
  });

  pi.registerTool({
    name: "rauf_loop_stop",
    label: "Stop rauf loop",
    description:
      "Stop a rauf loop (`rauf loop stop`) and stop supervising it. This deliberately ends the run — " +
      "unlike ending the session, which leaves a detached loop running. Use only when the user wants " +
      "the loop to actually stop.",
    parameters: Type.Object(targetParams),
    async execute(
      _id: string,
      params: unknown,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: unknown,
    ) {
      const p = params as { root?: string; backlogDir?: string };
      const c = rememberCtx(ctx);
      // Never a blind stop: with nothing supervised and no explicit target,
      // `rauf loop stop` could end a loop this session knows nothing about.
      const target = pickTarget(c.cwd ?? lastCwd, p);
      if (!target) {
        return textResult(
          "No loop is supervised in this session and no root/backlogDir was given — nothing stopped. " +
            "(Ending the session leaves a detached loop running by design.)",
          { stopped: false },
        );
      }
      let line = "";
      if (pi.exec) {
        try {
          const res = await pi.exec("rauf", ["loop", "stop", ...targetArgs(target)], {
            cwd: target.projectPath,
            timeout: 30000,
          });
          line =
            res.code === 0
              ? "Runner stop requested."
              : `rauf loop stop exited ${res.code}: ${(res.stderr || res.stdout).trim()}`;
        } catch (e) {
          line = `Could not run rauf loop stop: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      const task = supervisor.task(target.stateDir);
      stopWatch(target.stateDir);
      supervisor.detach(target.stateDir);
      clearMirror(target.stateDir);
      if (task) host.status(task, null);
      return textResult(`Stopped supervising ${target.stateDir}. ${line}`, {
        stopped: true,
        stateDir: target.stateDir,
      });
    },
  });

  // ---- Launch guard ------------------------------------------------------

  pi.on("tool_call", (event: unknown, ctx: unknown) => {
    rememberCtx(ctx);
    const e = event as {
      toolName?: string;
      toolCallId?: string;
      input?: { command?: string } & Record<string, unknown>;
    };
    if (!e?.toolName) return undefined;
    if (e.toolName === "bash") {
      const v = classifyBashCommand(e.input?.command);
      if (v.kind === "block") return { block: true, reason: v.reason };
      if (v.kind === "detached-launch" && e.toolCallId) {
        const target = resolveTarget(((ctx ?? {}) as CtxLike).cwd ?? lastCwd, v.root, v.backlog);
        if (!supervisor.isActive(target.stateDir)) {
          pendingLaunches.set(e.toolCallId, { target, cursor: currentCursor(target.eventsFile) });
        }
      }
      return undefined;
    }
    const v = classifySubagentCall(e.toolName, e.input);
    if (v.kind === "block") return { block: true, reason: v.reason };
    return undefined;
  });

  // A bash `--detached` launch that succeeded is supervised as if launched by the tool.
  pi.on("tool_result", (event: unknown) => {
    const e = event as { toolCallId?: string; isError?: boolean };
    if (!e?.toolCallId) return undefined;
    const pending = pendingLaunches.get(e.toolCallId);
    if (!pending) return undefined;
    pendingLaunches.delete(e.toolCallId);
    if (!e.isError && !supervisor.isActive(pending.target.stateDir)) {
      superviseLaunch(pending.target, pending.cursor);
    }
    return undefined;
  });

  // ---- Lifecycle ---------------------------------------------------------

  // Reattach on every session start (startup / reload / resume / fork) to any
  // loop this or a previous session launched, without duplicate reports.
  pi.on("session_start", (_event: unknown, ctx: unknown) => {
    const c = rememberCtx(ctx);
    const seen = new Set<string>();
    const consider = (task: SupervisorTask | null) => {
      if (
        !task ||
        !isAbsolute(task.stateDir) ||
        seen.has(task.stateDir) ||
        watchers.has(task.stateDir)
      )
        return;
      seen.add(task.stateDir);
      const fresh = readMirror(task.stateDir) ?? task;
      if (fresh.closed) return;
      startWatch({ ...fresh, projectPath: fresh.projectPath ?? c.cwd }, { reattach: true });
    };
    for (const entry of c.sessionManager?.getEntries?.() ?? []) {
      if (
        entry?.type === "custom" &&
        (entry.customType === TASK_ENTRY_TYPE || entry.customType === LEGACY_TASK_ENTRY_TYPE)
      ) {
        consider(entry.data as SupervisorTask);
      }
    }
    // A brand-new session file has no entries: find mirrors on disk too.
    for (const task of discoverMirrors(c.cwd ?? lastCwd)) consider(task);
  });

  // Close watchers, keep the detached runner and the mirror (next session reattaches).
  pi.on("session_shutdown", () => {
    for (const stateDir of [...watchers.keys()]) stopWatch(stateDir);
  });

  return { supervisor, watchers, startWatch, stopWatch, host };
}

export type { RaufEvent };
