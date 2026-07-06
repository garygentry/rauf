// ─── follow Command Handler ──────────────────────────────────────
//
// The single canonical live-view verb. `follow` is file-based primary: it
// replays the CURRENT run's events.ndjson (via readEvents) then fs.watch-tails
// new records (via watchEvents), polling deriveStatus only for terminal
// detection. It reads files for ANY loop regardless of who started it, which is
// what collapses the in-process/server asymmetry for this observer.

import {
  deriveStatus,
  eventAltitude,
  readEvents,
  watchEvents,
  resolveBacklogPaths,
  resolveTarget,
  getStateLabel,
  type ActiveLoopEntry,
  type BacklogPaths,
  type PersistedEvent,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, info, print, error, outputJson, detectColorSupport } from "./formatter.js";
import { formatEvent, formatFollowHeader } from "./event-format.js";

/** Terminal loop states — the loop is no longer active. */
const TERMINAL_LOOP_STATES: ReadonlySet<string> = new Set([
  "IDLE",
  "COMPLETE",
  "ITERATIONS_COMPLETE",
  "ERROR",
  "PAUSED",
  "PAUSED_HUMAN",
  "LIMIT_REACHED",
  "WEEKLY_LIMIT",
]);

const DEFAULT_POLL_SECONDS = 2;

/**
 * Render one PersistedEvent according to the active mode (04 §4.2):
 *  - json:    raw NDJSON line — EVERY event, never classified (REQ-CMD-03).
 *  - verbose: formatted line   — EVERY event (today's behavior).
 *  - default: formatted line   — ONLY item-altitude events (REQ-CMD-02).
 *
 * The `--json` branch is FIRST and returns before any classification — a
 * structural guarantee that the altitude filter never touches the machine
 * surface (the prime directive).
 */
function emitEvent(ev: PersistedEvent, opts: { json: boolean; verbose: boolean }): void {
  if (opts.json) {
    // One PersistedEvent (NDJSON) per line — replay and tail emit identically.
    process.stdout.write(JSON.stringify(ev) + "\n");
    return;
  }
  if (!opts.verbose && eventAltitude(ev) !== "item") return; // altitude filter
  print(formatEvent(ev));
}

export async function handleFollow(ctx: CommandContext): Promise<number> {
  const json = ctx.globalFlags.json;
  const verbose = ctx.flags.get("verbose") === true;
  const intervalSeconds = extractNumberFlag(ctx.flags, "interval") ?? DEFAULT_POLL_SECONDS;
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const isTTY = Boolean(process.stdout.isTTY);

  // Delegate targeting to the context-aware resolver (03-target-resolution.md §7):
  // [path] is optional on a TTY (cwd default / pick list); a missing/ambiguous
  // target in machine context (--json or non-TTY) is a structured hard error.
  const res = resolveTarget({
    pathArg: ctx.args[0],
    backlogFlag: backlogFlag ?? undefined,
    isMachineContext: json || !isTTY,
    isTTY,
  });
  if (!res.ok) {
    if (json) outputJson({ error: res.error });
    else error(res.error.message);
    return ExitCode.USAGE;
  }
  if (res.value.kind === "ambiguous") {
    // Several live loops on a TTY — render the pick list (machine ctx never
    // reaches here; branch 2 already errored). Item-level rendering is owned by 04.
    renderCandidateList(res.value.candidates);
    return ExitCode.SUCCESS;
  }

  const pathsResult = resolveBacklogPaths(res.value.root, res.value.backlogDir);
  if (!pathsResult.ok) {
    if (json) outputJson({ error: pathsResult.error });
    else error(pathsResult.error.message);
    return ExitCode.ERROR;
  }

  return followEvents(pathsResult.value, { json, verbose, intervalSeconds });
}

/** Render the ambiguous-target pick list (TTY only; 04 owns richer rendering). */
function renderCandidateList(candidates: ActiveLoopEntry[]): void {
  print(c.bold("Multiple live loops found — re-run with <root> --backlog <dir>:"));
  for (const e of candidates) {
    print(`  ${c.cyan(e.backlogRoot)} — ${e.status} ${c.dim(`(PID ${e.pid})`)}`);
  }
}

/** Replay-then-tail engine: readEvents (current run) then watchEvents (live tail). */
async function followEvents(
  paths: BacklogPaths,
  opts: { json: boolean; verbose: boolean; intervalSeconds: number },
): Promise<number> {
  // The sticky progress header is a human-only affordance for the default
  // (item-level) feed — never under --json (machine surface) or --verbose
  // (the firehose has no header, 04 §4.1).
  const headerEnabled = !opts.json && !opts.verbose;
  const color = detectColorSupport();
  const printHeader = () => {
    if (!headerEnabled) return;
    const st = deriveStatus(paths);
    if (st.ok) print(formatFollowHeader(st.value, { color }));
  };

  // 1. REPLAY — current run only: readEvents reads paths.eventsLog, which the
  //    runner rotated at start(); it never stitches the prior archived log.
  const replay = readEvents(paths); // Result<PersistedEvent[]>; absent file → ok([])
  if (replay.ok) {
    for (const ev of replay.value) emitEvent(ev, opts); // ordered by seq
  }
  // Header once after replay (04 §4.3).
  printHeader();

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
          for (const ev of records) emitEvent(ev, opts);
          // Reprint the sticky header after an item-milestone batch (04 §4.3).
          if (headerEnabled && records.some((ev) => eventAltitude(ev) === "item")) {
            printHeader();
          }
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
      if (headerEnabled && !TERMINAL_LOOP_STATES.has(st.value.loopState)) {
        // Sticky header — reprinted (no cursor addressing) so it stays near the
        // scroll tail on each non-terminal poll tick (04 §4.3).
        print(formatFollowHeader(st.value, { color }));
      }
      if (TERMINAL_LOOP_STATES.has(st.value.loopState)) {
        if (!opts.json) {
          print("");
          // Friendly label (e.g. "Iterations Complete") with the machine value
          // in parens, so the end line reads cleanly without losing the wire form.
          info(`Loop ended — ${getStateLabel(st.value.loopState).label} (${st.value.loopState}).`);
        }
        finish(st.value.loopState === "ERROR" ? ExitCode.ERROR : ExitCode.SUCCESS);
      }
    }, opts.intervalSeconds * 1000);
  });
}
