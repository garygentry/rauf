// ─── loop wait Command Handler ───────────────────────────────────
//
// `rauf loop wait` (#152): block until the next SIGNIFICANT loop event past a
// cursor, or until a timeout, then print one card and exit. It is the bounded
// counterpart of `follow` (which never exits) for supervisors that cannot be
// woken by a background process — they call it in a loop, passing back the
// returned cursor each time:
//
//   rauf loop wait <root> --backlog <dir> --since-seq <nextSeq> --run-id <runId>
//
// Like `follow` it reads files only (events.ndjson + the derived status), so it
// works for any loop regardless of who started it. It is narration only: the
// decision surface stays `rauf status --json` (loop-observability spec 05).
//
// Cursor: `--since-seq N` returns the first significant event with seq >= N.
// Without it, the wait starts at the end of the current log (new events only).
// Run identity: each run restarts events.ndjson at seq 0, so a bare seq is
// ambiguous across runs. The run id (the timestamp of the run's first event)
// disambiguates: when the current run's id differs from `--run-id` (or from the
// id seen when this call started), the new run is replayed from seq 0 instead
// of being skipped. Without `--run-id`, a cursor past the end of the log is
// also treated as a run change (the log was rotated and is shorter now).

import { spawnSync } from "node:child_process";

import {
  deriveStatus,
  readEvents,
  recordSupervision,
  clearSupervisorMarker,
  supervisorIdFromEnv,
  resolveBacklogPaths,
  resolveTarget,
  formatSupervisionCard,
  formatLoopEndedCard,
  isSignificantEvent,
  isRunEndingEvent,
  type BacklogPaths,
  type CardProgress,
  type DerivedStatus,
  type LoopStateEnum,
  type PersistedEvent,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, print, error, warn } from "./formatter.js";

/**
 * `loop wait` exit codes. 0/1/2 keep their unified `ExitCode` meaning (spelled
 * as literals: commands.ts imports this module, so reading `ExitCode` here at
 * module load would hit the import cycle); 10 and 11 are specific to this verb.
 * A terminal outcome is never reported as 0.
 */
export const WaitExitCode = {
  /** A significant event was returned; the loop may still be running. */
  EVENT: 0,
  ERROR: 1,
  USAGE: 2,
  /** No significant event before the timeout; the loop is still live. */
  TIMEOUT: 10,
  /** The loop has ended and the caller is caught up (with or without a final event). */
  TERMINAL: 11,
} as const;

/** Default and documented wait window — fits one Codex exec yield (300s) with margin. */
export const DEFAULT_WAIT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_MS = 1_000;
const NOTIFY_TIMEOUT_MS = 10_000;

/** Loop states in which the loop is still doing (or about to resume) work. */
const LIVE_LOOP_STATES: ReadonlySet<LoopStateEnum> = new Set([
  "RUNNING",
  "REVIEWING",
  "SLEEPING_LIMIT",
]);

export interface WaitOptions {
  sinceSeq?: number;
  runId?: string;
  timeoutMs: number;
  pollMs: number;
}

/** The result of one wait — also the `--json` output shape. */
export interface WaitResult {
  /** The significant event returned, or null on timeout / already-ended. */
  event: PersistedEvent | null;
  /** The one-line card for `event` (or for the ended loop); null on timeout. */
  card: string | null;
  /** Pass back as `--since-seq` on the next call. */
  nextSeq: number;
  /** Pass back as `--run-id`; null while the run has written no event yet. */
  runId: string | null;
  /** True when the run changed since the caller's cursor and was replayed from seq 0. */
  runChanged: boolean;
  /** Derived loop state at return time (`status --json`'s `loopState`). */
  loopState: LoopStateEnum | null;
  /** Backlog progress at return time. */
  progress: CardProgress | null;
  /** The loop has ended and the caller is caught up (exit 11). */
  terminal: boolean;
  /** No significant event arrived before the timeout (exit 10). */
  timedOut: boolean;
}

/** Parse "240", "240s", "4m", "1h", "500ms" → ms. Bare numbers are seconds. */
export function parseWaitDuration(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return Math.round(n * factor);
}

/** The run id: the timestamp of the current log's first record (null when empty). */
function runIdOf(events: PersistedEvent[]): string | null {
  return events[0]?.timestamp ?? null;
}

function readCurrentEvents(paths: BacklogPaths): PersistedEvent[] {
  const r = readEvents(paths);
  return r.ok ? r.value : [];
}

/**
 * The cursor a supervisor should start from right now: the end of the current
 * log plus its run id. A run that starts after this (rotating the log) has a
 * different run id, so `loop wait` replays it from seq 0 — nothing between a
 * launch and the first wait is lost.
 */
export function currentWaitCursor(paths: BacklogPaths): { nextSeq: number; runId: string | null } {
  const events = readCurrentEvents(paths);
  return {
    nextSeq: events.length > 0 ? events[events.length - 1]!.seq + 1 : 0,
    runId: runIdOf(events),
  };
}

/**
 * Keep this session's supervisor marker current (#156): the cursor for its
 * next wait, or removed once the loop has ended. Only when the session is
 * identifiable (`$RAUF_SUPERVISOR_ID` / `$CODEX_THREAD_ID`); best-effort.
 */
export function updateSupervision(paths: BacklogPaths, result: WaitResult): void {
  const id = supervisorIdFromEnv();
  if (id === null) return;
  if (result.terminal) clearSupervisorMarker(paths.stateDir, id);
  else recordSupervision(paths, id, { nextSeq: result.nextSeq, runId: result.runId });
}

/** The loop is no longer doing work: not in a live state and no live lock holder. */
export function loopEnded(st: DerivedStatus): boolean {
  if (LIVE_LOOP_STATES.has(st.loopState)) {
    // A live state with a stale lock is a dead runner (crash) — ended.
    return Boolean(st.lock?.present && st.lock.stale);
  }
  // Not in a live state, but a live lock holder means a run is starting or
  // finishing (state.json lags the lock at both ends) — not ended yet.
  return !(st.lock?.present && st.lock.alive);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wait for the next significant event past the cursor. Pure file reads on each
 * poll tick; resolves with a WaitResult (never rejects).
 */
export async function waitForSignificantEvent(
  paths: BacklogPaths,
  opts: WaitOptions,
): Promise<WaitResult> {
  const deadline = Date.now() + opts.timeoutMs;

  // Pin the caller's cursor + run identity from the first read.
  const first = readCurrentEvents(paths);
  const firstRunId = runIdOf(first);
  const endOfLog = first.length > 0 ? first[first.length - 1]!.seq + 1 : 0;
  const baseRunId = opts.runId ?? firstRunId;
  let baseCursor = opts.sinceSeq ?? endOfLog;
  let initialRunChange = false;
  if (opts.runId === undefined && opts.sinceSeq !== undefined && opts.sinceSeq > endOfLog) {
    // A cursor past the end of the log: the log was rotated since the caller
    // read it. Replay the (new) current run from the start.
    baseCursor = 0;
    initialRunChange = true;
  }

  const status = (): { st: DerivedStatus | null; progress: CardProgress | null } => {
    const r = deriveStatus(paths);
    if (!r.ok) return { st: null, progress: null };
    const s = r.value.backlogSummary;
    return { st: r.value, progress: { done: s.done, total: s.total } };
  };

  let events = first;
  for (;;) {
    const runId = runIdOf(events);
    const runChanged = initialRunChange || runId !== baseRunId;
    const cursor = runChanged ? 0 : baseCursor;

    const pending = events.filter((ev) => ev.seq >= cursor && isSignificantEvent(ev));
    const lastSeq = events.length > 0 ? events[events.length - 1]!.seq + 1 : 0;

    if (pending.length > 0) {
      const ev = pending[0]!;
      const { st, progress } = status();
      const terminal =
        isRunEndingEvent(ev) || (pending.length === 1 && st !== null && loopEnded(st));
      return {
        event: ev,
        card: formatSupervisionCard(ev, progress ?? undefined),
        nextSeq: ev.seq + 1,
        runId,
        runChanged,
        loopState: st?.loopState ?? null,
        progress,
        terminal,
        timedOut: false,
      };
    }

    const nextSeq = Math.max(cursor, lastSeq);
    const { st, progress } = status();
    if (st !== null && loopEnded(st)) {
      // Settle: the runner appends its final events around the state flip, so
      // re-read once before declaring the caller caught up.
      const settled = readCurrentEvents(paths);
      if (settled.length !== events.length || runIdOf(settled) !== runId) {
        events = settled;
        continue;
      }
      return {
        event: null,
        card: formatLoopEndedCard(st.loopState, progress ?? undefined),
        nextSeq,
        runId,
        runChanged,
        loopState: st.loopState,
        progress,
        terminal: true,
        timedOut: false,
      };
    }

    if (Date.now() >= deadline) {
      return {
        event: null,
        card: null,
        nextSeq,
        runId,
        runChanged,
        loopState: st?.loopState ?? null,
        progress,
        terminal: false,
        timedOut: true,
      };
    }

    await sleep(Math.max(0, Math.min(opts.pollMs, deadline - Date.now())));
    events = readCurrentEvents(paths);
  }
}

/** Exit code for a WaitResult. */
export function waitExitCode(result: WaitResult): number {
  if (result.terminal) return WaitExitCode.TERMINAL;
  if (result.timedOut) return WaitExitCode.TIMEOUT;
  return WaitExitCode.EVENT;
}

/**
 * Run `--notify-cmd` for an exception or terminal result (not for a routine
 * item_completed, not for a timeout). The command runs through the shell with
 * the card in `RAUF_CARD` (plus `RAUF_EVENT_TYPE` and `RAUF_LOOP_STATE`); its
 * output is discarded so `--json` stdout stays clean. Best-effort: a failure
 * only warns on stderr.
 */
export function runNotifyCommand(cmd: string, result: WaitResult): void {
  const exceptional =
    result.terminal || (result.event !== null && result.event.type !== "item_completed");
  if (!exceptional || result.card === null) return;
  const r = spawnSync(cmd, {
    shell: true,
    stdio: "ignore",
    timeout: NOTIFY_TIMEOUT_MS,
    env: {
      ...process.env,
      RAUF_CARD: result.card,
      RAUF_EVENT_TYPE: result.event?.type ?? "loop_ended",
      RAUF_LOOP_STATE: result.loopState ?? "",
    },
  });
  if (r.error || r.status !== 0) {
    warn(`--notify-cmd failed: ${r.error?.message ?? `exit ${r.status}`}`);
  }
}

export async function handleLoopWait(ctx: CommandContext): Promise<number> {
  const json = ctx.globalFlags.json;
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const sinceRaw = extractStringFlag(ctx.flags, "since-seq");
  const runIdFlag = extractStringFlag(ctx.flags, "run-id");
  const timeoutRaw = extractStringFlag(ctx.flags, "timeout");
  const intervalSeconds = extractNumberFlag(ctx.flags, "interval");
  const notifyCmd = extractStringFlag(ctx.flags, "notify-cmd");

  const usage = (message: string): number => {
    if (json) process.stdout.write(JSON.stringify({ error: { code: "USAGE", message } }) + "\n");
    else error(message);
    return WaitExitCode.USAGE;
  };

  let sinceSeq: number | undefined;
  if (sinceRaw !== null) {
    if (!/^\d+$/.test(sinceRaw)) return usage(`--since-seq must be a non-negative integer.`);
    sinceSeq = Number(sinceRaw);
  }
  let timeoutMs = DEFAULT_WAIT_TIMEOUT_MS;
  if (timeoutRaw !== null) {
    const parsed = parseWaitDuration(timeoutRaw);
    if (parsed === null) return usage(`--timeout must be a duration like 240, 240s, 4m or 500ms.`);
    timeoutMs = parsed;
  }
  if (intervalSeconds !== null && !(intervalSeconds > 0)) {
    return usage(`--interval must be a positive number of seconds.`);
  }

  const isTTY = Boolean(process.stdout.isTTY);
  const res = resolveTarget({
    pathArg: ctx.args[0],
    backlogFlag: backlogFlag ?? undefined,
    isMachineContext: json || !isTTY,
    isTTY,
  });
  if (!res.ok) return usage(res.error.message);
  if (res.value.kind === "ambiguous") {
    return usage("Multiple live loops found — pass <root> --backlog <dir>.");
  }
  const pathsResult = resolveBacklogPaths(res.value.root, res.value.backlogDir);
  if (!pathsResult.ok) {
    if (json) process.stdout.write(JSON.stringify({ error: pathsResult.error }) + "\n");
    else error(pathsResult.error.message);
    return WaitExitCode.ERROR;
  }

  const result = await waitForSignificantEvent(pathsResult.value, {
    sinceSeq,
    runId: runIdFlag ?? undefined,
    timeoutMs,
    pollMs: intervalSeconds !== null ? intervalSeconds * 1000 : DEFAULT_POLL_MS,
  });

  if (notifyCmd) runNotifyCommand(notifyCmd, result);
  updateSupervision(pathsResult.value, result);

  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    if (result.card !== null) {
      print(result.card);
    } else {
      const progress = result.progress
        ? ` · ${result.progress.done}/${result.progress.total} done`
        : "";
      print(
        `… no new events in ${Math.round(timeoutMs / 1000)}s — ${result.loopState ?? "unknown"}${progress}`,
      );
    }
    if (!result.terminal) {
      const runArg = result.runId !== null ? ` --run-id ${result.runId}` : "";
      print(c.dim(`next: --since-seq ${result.nextSeq}${runArg}`));
    }
  }
  return waitExitCode(result);
}
