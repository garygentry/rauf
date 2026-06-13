// ─── follow Command Handler ──────────────────────────────────────
//
// The single canonical live-view verb. `follow` is file-based primary: it
// replays the CURRENT run's events.ndjson (via readEvents) then fs.watch-tails
// new records (via watchEvents), polling deriveStatus only for terminal
// detection. It reads files for ANY loop regardless of who started it, which is
// what collapses the in-process/server asymmetry for this observer.

import * as path from "node:path";

import {
  deriveStatus,
  readEvents,
  watchEvents,
  resolveBacklogRoot,
  resolveBacklogPaths,
  type BacklogPaths,
  type PersistedEvent,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, info, print, error } from "./formatter.js";

/** Terminal loop states — the loop is no longer active. */
const TERMINAL_LOOP_STATES: ReadonlySet<string> = new Set([
  "IDLE",
  "COMPLETE",
  "ERROR",
  "PAUSED",
  "PAUSED_HUMAN",
  "LIMIT_REACHED",
  "WEEKLY_LIMIT",
]);

const DEFAULT_POLL_SECONDS = 2;

/** Render a single PersistedEvent — NDJSON line in --json mode, formatted otherwise. */
function emitEvent(ev: PersistedEvent, json: boolean): void {
  if (json) {
    // One PersistedEvent (NDJSON) per line — replay and tail emit identically.
    process.stdout.write(JSON.stringify(ev) + "\n");
    return;
  }
  print(`${c.dim(`#${ev.seq}`)} ${c.cyan(ev.type)}`);
}

export async function handleFollow(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf follow [path] [--json] [--interval N] [--backlog <dir>]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const json = ctx.globalFlags.json;
  const intervalSeconds = extractNumberFlag(ctx.flags, "interval") ?? DEFAULT_POLL_SECONDS;
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  // --backlog is the single targeting spelling — same preamble as every read command.
  const rootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!rootResult.ok) {
    error(rootResult.error.message);
    return ExitCode.INVALID_ARGS;
  }
  const pathsResult = resolveBacklogPaths(resolved, rootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }

  return followEvents(pathsResult.value, { json, intervalSeconds });
}

/** Replay-then-tail engine: readEvents (current run) then watchEvents (live tail). */
async function followEvents(
  paths: BacklogPaths,
  opts: { json: boolean; intervalSeconds: number },
): Promise<number> {
  // 1. REPLAY — current run only: readEvents reads paths.eventsLog, which the
  //    runner rotated at start(); it never stitches the prior archived log.
  const replay = readEvents(paths); // Result<PersistedEvent[]>; absent file → ok([])
  if (replay.ok) {
    for (const ev of replay.value) emitEvent(ev, opts.json); // ordered by seq
  }

  return new Promise<number>((resolve) => {
    let resolved = false;
    let stopWatcher: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watcherActive = false;

    const finish = (code: number) => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      if (stopWatcher) stopWatcher();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      resolve(code);
    };
    const onSignal = () => finish(ExitCode.SUCCESS);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // 2. TAIL — watchEvents fires with newly-appended PersistedEvents, re-reading
    //    from the last byte offset on every fire (self-correcting against missed
    //    fs.watch events). It returns a BARE cleanup fn.
    const tryStartWatcher = () => {
      if (watcherActive) return;
      try {
        stopWatcher = watchEvents(paths, (records) => {
          for (const ev of records) emitEvent(ev, opts.json);
        });
        watcherActive = true;
      } catch {
        /* events.ndjson not present yet — retried on the next poll tick */
      }
    };
    tryStartWatcher();

    // 3. TERMINAL DETECTION + poll fallback: deriveStatus reads state.json
    //    (authoritative). The interval is both the fs.watch-unavailable fallback
    //    and a reconciliation safety-net for missed watch fires.
    pollTimer = setInterval(() => {
      if (!watcherActive) tryStartWatcher();
      const st = deriveStatus(paths);
      if (!st.ok) return;
      if (TERMINAL_LOOP_STATES.has(st.value.loopState)) {
        if (!opts.json) {
          print("");
          info(`Loop ended (${st.value.loopState}).`);
        }
        finish(st.value.loopState === "ERROR" ? ExitCode.ERROR : ExitCode.SUCCESS);
      }
    }, opts.intervalSeconds * 1000);
  });
}
