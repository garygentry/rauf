// ─── Status, Log, and Progress Command Handlers ──────────────────
//
// CLI adapters for core status derivation and log reading.
// Each handler: parses flags → resolves paths → calls core → formats output.

import * as fs from "node:fs";
import * as path from "node:path";

import {
  deriveStatus,
  readLogTail,
  watchLog,
  readEvents,
  watchEvents,
  fileExists,
  resolveBacklogRoot,
  resolveBacklogPaths,
  resolveTarget,
  scanActiveRoots,
  detectMigrationState,
  listActiveLoops,
  surfaceInspectedStatus,
  surfaceInspectedDir,
  STATE_LABELS,
  type ActiveLoopEntry,
  type BacklogPaths,
  type DerivedStatus,
  type LoopStateEnum,
  type StateTone,
  type PersistedEvent,
  type InspectedStatusContext,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag, extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, info, print, error, warn, outputJson } from "./formatter.js";
import { formatEvent } from "./event-format.js";

// ─── handleStatus ─────────────────────────────────────────────────
//
// Print loop status summary for a project.
// Exit codes per the unified v0.5.0 scheme (00 §1 / 03-exit-codes): 0=success (idle/complete),
// 1=error, 2=usage, 3=needs-human, 4=limit, 5=blocked, 6=running (query-time, status only)

export async function handleStatus(ctx: CommandContext): Promise<number> {
  const all = extractBoolFlag(ctx.flags, "all");
  if (all) {
    // Machine-wide listing of every live loop via the reconciled registry (§9).
    // `--all` short-circuits BEFORE resolveTarget — it needs no single-root target.
    return handleStatusAll(ctx.globalFlags.json);
  }

  const follow = extractBoolFlag(ctx.flags, "follow"); // -f resolved in parser
  const interval = extractNumberFlag(ctx.flags, "interval") ?? 2;
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const json = ctx.globalFlags.json;

  // Context-aware targeting (03-target-resolution.md §5): [path] is optional on a
  // TTY (cwd default / single-loop / pick list); in machine context (--json or
  // non-TTY) a missing/ambiguous target is a structured hard error.
  const isTTY = Boolean(process.stdout.isTTY);
  const isMachineContext = json || !isTTY; // D5
  const res = resolveTarget({
    pathArg: ctx.args[0],
    backlogFlag: backlogFlag ?? undefined,
    isMachineContext,
    isTTY,
  });

  if (!res.ok) {
    // A `not_found` on the DEFAULT (no --backlog) path preserves the legacy /
    // empty-is-never-silent surfacing (SUCCESS); every other TargetError (and any
    // failure under --backlog) is a USAGE(2) resolution failure rendered per §4.
    if (res.error.code === "not_found" && !backlogFlag) {
      const projectRoot = ctx.args[0] ? path.resolve(ctx.args[0]) : process.cwd();
      return surfaceDefaultRoot(projectRoot, json);
    }
    if (json) outputJson({ error: res.error });
    else error(res.error.message);
    return ExitCode.USAGE;
  }

  if (res.value.kind === "ambiguous") {
    // Several live loops on a TTY — render the pick list (machine ctx never
    // reaches here; branch 2 already errored). Richer rendering is owned by 04.
    renderCandidateList(res.value.candidates);
    return ExitCode.SUCCESS;
  }

  const { root, backlogDir } = res.value;

  if (follow) {
    return handleStatusFollow(root, backlogDir, interval, json);
  }

  const pathsResult = resolveBacklogPaths(root, backlogDir);
  if (!pathsResult.ok) {
    if (json) outputJson({ error: pathsResult.error });
    else error(pathsResult.error.message);
    return ExitCode.ERROR;
  }

  const result = deriveStatus(pathsResult.value);
  if (!result.ok) {
    if (json) {
      outputJson({ error: result.error });
    } else {
      error(result.error.message);
      if (!backlogFlag) info(`Ensure rauf is installed. Run: ${c.cyan(`rauf install ${root}`)}`);
    }
    return ExitCode.ERROR;
  }

  const status = result.value;
  if (json) {
    outputJson(status);
    return statusExitCode(status.loopState, status);
  }

  printStatusSummary(status);
  if (status.stateSource === "none") {
    renderInspectedStatus(surfaceInspectedStatus(pathsResult.value, status), json);
  }

  // The default-view extras (non-default root footer + bare-status broadening) are
  // scoped to the DEFAULT root only; `--backlog <dir>` is a single-root view.
  if (!backlogFlag) {
    // Scan for active non-default roots.
    const activeRootsResult = scanActiveRoots(root);
    if (activeRootsResult.ok && activeRootsResult.value.length > 0) {
      const nonDefault = activeRootsResult.value.filter((r) => r.relativePath !== ".rauf");
      if (nonDefault.length > 0) {
        print("");
        print(c.bold("Active backlog roots:"));
        for (const r of nonDefault) {
          const itemLabel = r.currentItem ? ` (item ${r.currentItem})` : "";
          print(`  ${c.cyan(r.relativePath)} — ${r.loopState}${itemLabel}`);
        }
      }
    }

    // Bare-status cwd → --all broadening (REQ-SCOPE-03): fires ONLY on a TTY with
    // no explicit path and no --backlog. When the cwd backlog has no live loop but
    // >=1 loop is live elsewhere, additionally surface handleStatusAll. A live cwd
    // loop is the answer — do NOT broaden.
    if (isTTY && !ctx.args[0] && !isLoopLiveLocally(status)) {
      const live = listActiveLoops();
      if (live.ok && live.value.length >= 1) {
        return handleStatusAll(json);
      }
    }
  }

  return statusExitCode(status.loopState, status);
}

/**
 * Surface the default root when it has no usable backlog: tolerate a legacy ralph
 * project (warn to migrate), else render the empty-is-never-silent footer
 * (REQ-DISC-01/02). Extracted from the old default branch's not-found path so the
 * resolver's `not_found` composes with — does not replace — this surfacing (§5).
 */
function surfaceDefaultRoot(projectRoot: string, json: boolean): number {
  const legacy = detectMigrationState(projectRoot);
  if (legacy.ok && (legacy.value === "legacy_ralph" || legacy.value === "partial")) {
    if (json) {
      outputJson({ legacy: true, message: `Run 'rauf migrate ${projectRoot}' to migrate.` });
    } else {
      warn(`Legacy rauf project detected.`);
      info(`Run: ${c.cyan(`rauf migrate ${projectRoot}`)} to migrate it to rauf.`);
    }
    return ExitCode.ERROR;
  }
  const defaultRoot = path.join(projectRoot, ".rauf");
  renderInspectedStatus(surfaceInspectedDir(defaultRoot, true), json);
  return ExitCode.SUCCESS;
}

/** Render the ambiguous-target pick list (TTY only; 04 owns richer rendering). */
function renderCandidateList(candidates: ActiveLoopEntry[]): void {
  print(c.bold("Multiple live loops found — re-run with <root> --backlog <dir>:"));
  for (const e of candidates) {
    print(`  ${c.cyan(e.backlogRoot)} — ${e.status} ${c.dim(`(PID ${e.pid})`)}`);
  }
}

/**
 * A loop is live *locally* when it is actively running/reviewing or holds a live
 * lock. Used by the bare-status broadening (REQ-SCOPE-03) to decide whether the
 * cwd already answers the query or the machine-wide `--all` view should broaden.
 */
function isLoopLiveLocally(status: DerivedStatus): boolean {
  if (status.loopState === "RUNNING" || status.loopState === "REVIEWING") return true;
  return Boolean(status.lock && status.lock.present && status.lock.alive);
}

// ─── Empty-is-never-silent surfacing ─────────────────────────────
//
// Render the empty-is-never-silent footer (REQ-DISC-01/02). Names the inspected
// directory, then, if a loop is live in a DIFFERENT root, names that root and its
// (advisory) state. The cross-root DATA (registry read, reconciliation, self-heal,
// and the exclude-self filter) is the core `surfaceInspectedStatus` /
// `surfaceInspectedDir` data layer (item 008) — this is presentation only, so the
// filtering lives in exactly one place (no CLI/core drift).

function renderInspectedStatus(context: InspectedStatusContext, json: boolean): void {
  const { inspectedDir, empty, liveElsewhere } = context;

  if (json) {
    outputJson({
      inspected: inspectedDir,
      empty,
      liveElsewhere: liveElsewhere.map((e) => ({
        backlogRoot: e.backlogRoot,
        stateDir: e.stateDir,
        status: e.status,
        pid: e.pid,
      })),
    });
    return;
  }

  info(`No loop activity in ${c.cyan(inspectedDir)}.`); // (a) name the inspected directory
  if (liveElsewhere.length > 0) {
    // (b) surface live loops in other roots
    print("");
    print(c.bold("A loop is live in another backlog root:"));
    for (const e of liveElsewhere) {
      print(`  ${c.cyan(e.backlogRoot)} — ${e.status} ${c.dim(`(PID ${e.pid})`)}`);
    }
    info(
      `Re-run with ${c.cyan("--backlog <dir>")} to inspect it, or ${c.cyan("rauf status --all")} to list all.`,
    );
  }
}

// ─── status --all (machine-wide live loops) ──────────────────────
//
// List every backlog root with a live loop across the machine, reading the same
// reconciled registry (`listActiveLoops`), honoring --json. The registry status
// shown is advisory (REQ-OBS-02); the authoritative status for one root comes
// from `rauf status --backlog <root>`.

async function handleStatusAll(json: boolean): Promise<number> {
  const live = listActiveLoops();
  if (!live.ok) {
    if (json) outputJson({ error: live.error });
    else error(live.error.message);
    return ExitCode.ERROR;
  }

  if (json) {
    outputJson({ loops: live.value });
    return ExitCode.SUCCESS;
  }

  if (live.value.length === 0) {
    info("No live loops on this machine.");
    return ExitCode.SUCCESS;
  }

  print(c.bold("Live loops (machine-wide):"));
  for (const e of live.value) {
    const started = new Date(e.startedAt).toLocaleTimeString();
    print(`  ${c.cyan(e.backlogRoot)} — ${e.status} ${c.dim(`(PID ${e.pid}, since ${started})`)}`);
  }
  return ExitCode.SUCCESS;
}

// ─── handleLog ────────────────────────────────────────────────────
//
// Print the last N lines of rauf.log. With --follow, stream until Ctrl+C.

export async function handleLog(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf log <path> [--tail N] [--follow] [--json] [--backlog <dir>]");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const tailN = extractNumberFlag(ctx.flags, "tail") ?? 20;
  const follow = extractBoolFlag(ctx.flags, "follow");
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;

  if (follow) {
    return handleLogFollow(paths, tailN, ctx.globalFlags.json);
  }

  const result = readLogTail(paths, tailN);
  if (!result.ok) {
    if (ctx.globalFlags.json) {
      outputJson({ error: result.error });
    } else {
      error(result.error.message);
      info(`No log yet. Start the loop with: ${c.cyan("rauf loop run")}`);
    }
    return ExitCode.ERROR;
  }

  if (ctx.globalFlags.json) {
    outputJson(result.value); // string[] of rauf.log lines
    return ExitCode.SUCCESS;
  }

  if (result.value.length === 0) {
    info("No log entries found.");
    return ExitCode.SUCCESS;
  }

  for (const line of result.value) {
    print(line);
  }
  return ExitCode.SUCCESS;
}

// ─── handleProgress ───────────────────────────────────────────────
//
// Print the contents of .rauf/progress.md.

export async function handleProgress(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf progress <path>");
    return ExitCode.USAGE;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.USAGE;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;
  const progressPath = paths.progress;

  if (!fileExists(progressPath)) {
    if (ctx.globalFlags.json) {
      outputJson({ content: null });
    } else {
      info("No progress file found.");
    }
    return ExitCode.SUCCESS;
  }

  try {
    const content = fs.readFileSync(progressPath, "utf-8");
    if (ctx.globalFlags.json) {
      outputJson({ content });
    } else {
      print(content.trimEnd());
    }
    return ExitCode.SUCCESS;
  } catch (e) {
    error(`Failed to read progress file: ${e instanceof Error ? e.message : String(e)}`);
    info("Check that the progress file is readable and not corrupted.");
    return ExitCode.ERROR;
  }
}

// ─── Internal: log follow mode ───────────────────────────────────

async function handleLogFollow(
  paths: BacklogPaths,
  initialLines: number,
  json: boolean,
): Promise<number> {
  // Each emitted unit honors `json`:
  //   json=true  → one NDJSON object per line ({source:"log",line} | PersistedEvent)
  //   json=false → the formatted human line / event
  const emitLog = (line: string): void => {
    if (json) process.stdout.write(JSON.stringify({ source: "log", line }) + "\n");
    else print(line);
  };
  const emitEvent = (ev: PersistedEvent): void => {
    if (json) process.stdout.write(JSON.stringify(ev) + "\n");
    else print(formatEvent(ev));
  };

  // Replay: tail rauf.log + readEvents(paths) for events.ndjson (current run only).
  const tailResult = readLogTail(paths, initialLines);
  if (tailResult.ok && tailResult.value.length > 0) {
    for (const line of tailResult.value) emitLog(line);
  }
  const replayEvents = readEvents(paths);
  if (replayEvents.ok) {
    for (const ev of replayEvents.value) emitEvent(ev);
  }

  // Tail: watchLog for rauf.log + watchEvents for events.ndjson, interleaved.
  return new Promise<number>((resolve) => {
    let stopLog: (() => void) | null = null;
    let stopEvents: (() => void) | null = null;

    const stop = () => {
      if (stopLog) {
        stopLog();
        stopLog = null;
      }
      if (stopEvents) {
        stopEvents();
        stopEvents = null;
      }
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      resolve(ExitCode.SUCCESS);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    try {
      stopLog = watchLog(paths, (newLines) => {
        for (const line of newLines) emitLog(line);
      });
    } catch {
      // watchLog may throw if the log file doesn't exist yet — that's ok.
    }

    try {
      stopEvents = watchEvents(paths, (records) => {
        for (const ev of records) emitEvent(ev);
      });
    } catch {
      // events.ndjson may not exist yet — that's ok.
    }
  });
}

// ─── Status follow mode ─────────────────────────────────────────
//
// Poll deriveStatus on --interval; emit on CHANGE only. In --json mode this
// streams one DerivedStatus snapshot per change (NDJSON). Non-JSON follow is the
// screen-clearing re-render (the human display the old --watch printed; the verb
// changed, not the human presentation).

async function handleStatusFollow(
  root: string,
  backlogDir: string,
  intervalSeconds: number,
  json: boolean,
): Promise<number> {
  // The caller (handleStatus) has already resolved and sandbox-validated the
  // target, so the poll loop re-derives status per tick but never re-resolves the
  // root — resolveBacklogPaths(root, backlogDir) reconstructs the paths cheaply.
  return new Promise<number>((resolve) => {
    let running = true;
    let lastSerialized: string | null = null;

    const stop = () => {
      running = false;
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      resolve(ExitCode.SUCCESS);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    const tick = () => {
      if (!running) return;

      const pathsResult = resolveBacklogPaths(root, backlogDir);
      if (pathsResult.ok) {
        const result = deriveStatus(pathsResult.value);
        if (result.ok) {
          if (json) {
            // One DerivedStatus snapshot per CHANGE (NDJSON).
            const serialized = JSON.stringify(result.value);
            if (serialized !== lastSerialized) {
              lastSerialized = serialized;
              process.stdout.write(serialized + "\n");
            }
          } else {
            process.stdout.write("\x1b[2J\x1b[H");
            print(c.dim(`rauf status  (${new Date().toLocaleTimeString()})  Ctrl+C to stop`));
            print("");
            printStatusSummary(result.value);
          }
        }
      } else if (!json) {
        error(pathsResult.error.message);
      }

      if (running) setTimeout(tick, intervalSeconds * 1000);
    };

    tick();
  });
}

// ─── Status formatting ───────────────────────────────────────────

/**
 * Genuine blocks = items with status `blocked` minus the runner-deferred subset
 * (those the runtime gave up on, not an explicit agent block / needs-human).
 * Shared by the status summary and the BLOCKED(5) exit-code derivation so they
 * agree on what "blocked" means.
 */
export function genuineBlockedCount(summary: DerivedStatus["backlogSummary"]): number {
  const deferred = summary.deferred ?? 0;
  return Math.max(0, summary.blocked - deferred);
}

/**
 * Map the current LoopStateEnum to the unified exit code (00 §2b, v0.5.0).
 * `status` is the only command that may return RUNNING(6) (query-time state).
 *
 * BLOCKED(5) is *derived*, not a LoopStateEnum value: a clean terminal state
 * (IDLE / COMPLETE / PAUSED) with a genuine-blocked count > 0 returns BLOCKED(5)
 * instead of SUCCESS(0), so `status` and `loop run` agree on BLOCKED. The
 * derived status is consulted only for that carrier — pass it from the caller.
 */
export function statusExitCode(state: LoopStateEnum, derived?: DerivedStatus): number {
  switch (state) {
    case "RUNNING":
      return ExitCode.RUNNING; // 6
    case "PAUSED_HUMAN":
      return ExitCode.NEEDS_HUMAN; // 3
    case "REVIEWING": // a review pass is a running query-time state (preserves prior behavior)
      return ExitCode.RUNNING; // 6
    case "LIMIT_REACHED":
    case "SLEEPING_LIMIT":
    case "WEEKLY_LIMIT":
    case "PAUSED_USAGE_LIMIT": // a usage-limit pause is a LIMIT state (corrects today's silent 0)
      return ExitCode.LIMIT; // 4
    case "ERROR":
      return ExitCode.ERROR; // 1
    // ITERATIONS_COMPLETE (iteration budget reached) is a clean, user-chosen stop
    // — NOT a usage LIMIT(4). It joins the clean-terminal group below: SUCCESS(0),
    // or BLOCKED(5) if blocks remain.
    case "ITERATIONS_COMPLETE":
    case "IDLE":
    case "COMPLETE":
    case "PAUSED":
      // Clean terminal: BLOCKED(5) if there are genuine blocks, else SUCCESS(0).
      if (derived && genuineBlockedCount(derived.backlogSummary) > 0) {
        return ExitCode.BLOCKED; // 5
      }
      return ExitCode.SUCCESS; // 0
    case "NOT_INSTALLED":
      return ExitCode.SUCCESS; // 0
  }
}

/** Map a semantic tone to a terminal color wrapper (OQ-T1 terminal table, 02 §4.1). */
const TONE_COLOR: Record<StateTone, (s: string) => string> = {
  neutral: c.dim,
  info: c.cyan,
  success: c.green,
  warning: c.yellow,
  danger: c.red,
};

/**
 * Color a loop-state badge for the terminal. Reads the shared label map for the tone, then maps
 * tone → terminal color (02 §4.1). Total over LoopStateEnum via TONE_COLOR (Record<StateTone, …>);
 * NO `default:` branch (REQ-VOCAB-07 — no silent fallback). Prints the SCREAMING_SNAKE machine value.
 */
function colorLoopState(state: LoopStateEnum): string {
  const { tone } = STATE_LABELS[state];
  return TONE_COLOR[tone](state);
}

/** Format state source indicator */
function formatStateSource(source: DerivedStatus["stateSource"]): string {
  switch (source) {
    case "state.json":
      return "via state.json";
    case "log-parsing":
      return "via log parsing (fallback)";
    case "none":
      return "no data available";
  }
}

/** Print human-readable status summary */
function printStatusSummary(status: DerivedStatus): void {
  const sourceLabel = c.dim(`(${formatStateSource(status.stateSource)})`);
  print(`${c.bold("Loop State:")} ${colorLoopState(status.loopState)} ${sourceLabel}`);

  if (status.loopState === "SLEEPING_LIMIT") {
    if (status.sleepUntil) {
      const resetDate = new Date(status.sleepUntil);
      const timeStr = resetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const countdown = formatCountdown(status.sleepUntil);
      print(`${c.bold("Usage Limit:")} Claude's 5-hour window is active.`);
      print(`             The loop will resume at ${c.cyan(timeStr)} (${countdown}).`);
      print(`             Run ${c.dim("rauf loop stop")} to cancel the wait.`);
    } else {
      print(`${c.bold("Usage Limit:")} Claude's 5-hour window is active. Waiting for reset.`);
    }
  }

  if (status.loopState === "WEEKLY_LIMIT") {
    if (status.sleepUntil) {
      const resetDate = new Date(status.sleepUntil);
      const dateStr = resetDate.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      const timeStr = resetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      print(`${c.bold("Usage Limit:")} Weekly Claude cap reached.`);
      print(`             Restart the loop after ${c.cyan(`${dateStr} at ${timeStr}`)}.`);
    } else {
      print(
        `${c.bold("Usage Limit:")} Weekly Claude cap reached. Check https://claude.ai for reset time.`,
      );
    }
  }

  if (status.iteration !== null && status.maxIterations !== null) {
    print(`${c.bold("Iteration:")}  ${status.iteration} / ${status.maxIterations}`);
  }

  if (status.currentItem) {
    print(`${c.bold("Current:")}    ${status.currentItem}`);
  }

  if (status.elapsed !== null) {
    print(`${c.bold("Elapsed:")}    ${formatElapsed(status.elapsed)}`);
  }

  if (status.lastSignal) {
    print(`${c.bold("Last Signal:")} ${status.lastSignal}`);
  }

  print(`${c.bold("Lock:")}        ${formatLockLine(status.lock)}`);

  const s = status.backlogSummary;
  // `blocked` is the total; `deferred` is the runner-gave-up subset. The
  // remainder is the genuine blocks (explicit agent block / needs-human).
  const deferred = s.deferred ?? 0;
  const genuineBlocked = genuineBlockedCount(s);
  print("");
  print(c.bold("Backlog:"));
  print(`  Pending:     ${s.pending}`);
  print(`  In Progress: ${s.inProgress}`);
  print(`  Blocked:     ${genuineBlocked}`);
  print(`  Deferred:    ${deferred}`);
  print(`  Done:        ${s.done}`);
  print(`  Total:       ${s.total}`);
}

/** Format the lock liveness line — "PID 1234 (alive)", "PID 1234 (stale)", or "none". */
function formatLockLine(lock: DerivedStatus["lock"]): string {
  if (!lock || !lock.present) return c.dim("none");
  const who = lock.pid !== null ? `PID ${lock.pid}` : "present";
  if (lock.stale) return `${who} ${c.yellow("(stale)")}`;
  return `${who} ${c.green("(alive)")}`;
}

/** Format a countdown to an ISO timestamp as "in 4h 32m", "in 3d", etc. */
function formatCountdown(isoTimestamp: string): string {
  const resetMs = new Date(isoTimestamp).getTime();
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return "any moment now";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hrs < 24) return `in ${hrs}h ${mins}m`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d ${hrs % 24}h`;
}

/** Format elapsed seconds as a human-readable string */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}
