// ─── hook Command Handlers ───────────────────────────────────────
//
// `rauf hook codex-stop` (#156): a Codex Stop hook that keeps a Codex session
// supervising a rauf loop it started. Codex (0.147) cannot wake the model when
// a background process prints or exits, so once a turn ends a running loop goes
// unwatched. This hook runs when the session tries to end its turn: if the
// session is supervising a loop that is still running, it blocks the stop and
// tells the model to run the next `rauf loop wait`.
//
// "Supervising" = a marker at `<stateDir>/supervisors/<session_id>.json`,
// written by `rauf loop wait` / `rauf loop run --detached` when they run with
// `$CODEX_THREAD_ID` set (Codex sets it in every shell command; it equals the
// hook's `session_id`). No marker → the hook allows the stop, so installing it
// is harmless for sessions that never touch rauf.
//
// Contract (Codex `stop.command.input` / `.output`): JSON on stdin with
// `session_id`, `cwd`, `stop_hook_active`; to block, print
// `{"decision":"block","reason":"…"}`; to allow, print nothing. The hook always
// exits 0 — a broken hook must never wedge a session.

import * as path from "node:path";

import {
  deriveStatus,
  findSupervisorMarkers,
  resolveBacklogPaths,
  supervisorMarkerPath,
  writeSupervisorMarker,
  clearSupervisorMarker,
  type SupervisorMarker,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { error } from "./formatter.js";
import { loopEnded } from "./wait-command.js";

/**
 * Stops the hook may block in a row without the session running `loop wait`
 * in between. A session that keeps waiting is held as long as the loop runs;
 * one that ignores the hook this many times is let go (runaway guard).
 */
export const MAX_BLOCKS_WITHOUT_WAIT = 3;

/** The hooks.json snippet that wires the hook into Codex. */
export const CODEX_STOP_HOOK_CONFIG = {
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "rauf hook codex-stop", timeout: 30 }] }],
  },
};

/** The subset of Codex's Stop-hook input this hook reads. */
export interface CodexStopInput {
  session_id?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/** What the hook decided: block (with the model-facing reason) or allow. */
export type CodexStopDecision =
  | { decision: "block"; reason: string }
  | { decision: "allow"; systemMessage?: string };

function quoteArg(arg: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The `loop wait` command line that resumes supervision from a marker's cursor. */
export function waitCommandFor(m: SupervisorMarker): string {
  const backlog = path.relative(m.projectPath, m.backlogRoot) || ".rauf";
  const parts = [
    "rauf loop wait",
    quoteArg(m.projectPath),
    "--backlog",
    quoteArg(backlog),
    "--since-seq",
    String(m.nextSeq),
  ];
  if (m.runId !== null) parts.push("--run-id", quoteArg(m.runId));
  parts.push("--timeout 240s");
  return parts.join(" ");
}

/**
 * Decide a Codex Stop for `input`. Reads markers and derived status; writes
 * only this session's markers (the block counter, or removal once the loop has
 * ended). Never throws.
 */
export function decideCodexStop(input: CodexStopInput): CodexStopDecision {
  const sessionId = input.session_id;
  if (!sessionId) return { decision: "allow" };
  const cwd = input.cwd || process.cwd();

  const live: { marker: SupervisorMarker; summary: string }[] = [];
  const sleeping: string[] = [];
  for (const marker of findSupervisorMarkers(cwd, sessionId)) {
    const p = resolveBacklogPaths(marker.projectPath, marker.backlogRoot);
    if (!p.ok) continue;
    const st = deriveStatus(p.value);
    if (!st.ok) continue;
    if (loopEnded(st.value)) {
      // Ended (complete, paused for a human, errored, …): nothing to hold the
      // session for. Drop the marker so later stops don't re-check it.
      clearSupervisorMarker(marker.stateDir, sessionId);
      continue;
    }
    const s = st.value.backlogSummary;
    if (st.value.loopState === "SLEEPING_LIMIT") {
      // Asleep until a usage limit resets (hours): holding the session open
      // would only burn turns on empty waits. Let it go; the loop resumes alone.
      const until = st.value.sleepUntil ? ` until ${st.value.sleepUntil}` : "";
      sleeping.push(
        `${path.relative(marker.projectPath, marker.backlogRoot) || ".rauf"} is sleeping on a usage limit${until} (${s.done}/${s.total} done)`,
      );
      continue;
    }
    live.push({ marker, summary: `${st.value.loopState} · ${s.done}/${s.total} done` });
  }
  if (live.length === 0) {
    return sleeping.length > 0
      ? { decision: "allow", systemMessage: `rauf: ${sleeping.join("; ")}.` }
      : { decision: "allow" };
  }

  const first = live[0]!;
  if (first.marker.blocksSinceWait >= MAX_BLOCKS_WITHOUT_WAIT) {
    return {
      decision: "allow",
      systemMessage:
        `rauf: a supervised loop is still running (${first.summary}), but the session ended its turn ` +
        `${MAX_BLOCKS_WITHOUT_WAIT} times without running \`rauf loop wait\`, so the stop hook let it go. ` +
        `Resume with: ${waitCommandFor(first.marker)}`,
    };
  }
  for (const { marker } of live) {
    writeSupervisorMarker({ ...marker, blocksSinceWait: marker.blocksSinceWait + 1 });
  }

  const backlog = path.relative(first.marker.projectPath, first.marker.backlogRoot) || ".rauf";
  const more =
    live.length > 1
      ? ` (${live.length - 1} more supervised loop(s) are also running — wait on each in turn.)`
      : "";
  const reason =
    `A rauf loop you are supervising is still running (${backlog}: ${first.summary}).${more} ` +
    `Do not end your turn yet. Run \`${waitCommandFor(first.marker)}\`, report the card it prints, ` +
    `and repeat with the cursor it returns until it exits 11 (loop ended); on an exception card, ` +
    `read \`rauf status ${quoteArg(first.marker.projectPath)} --backlog ${quoteArg(backlog)} --json\` ` +
    `and decide. If the user asked you to stop supervising, delete ` +
    `${supervisorMarkerPath(first.marker.stateDir, sessionId)} and end the turn.`;
  return { decision: "block", reason };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

/** `rauf hook codex-stop [--print-config]`. Always exits 0 when run as a hook. */
export async function handleHookCodexStop(ctx: CommandContext): Promise<number> {
  if (ctx.flags.has("print-config")) {
    process.stdout.write(JSON.stringify(CODEX_STOP_HOOK_CONFIG, null, 2) + "\n");
    return 0;
  }
  if (process.stdin.isTTY) {
    error(
      "rauf hook codex-stop reads Codex's Stop-hook JSON on stdin; run it from Codex's hooks.json " +
        "(see --print-config), not by hand.",
    );
    return 2;
  }
  let input: CodexStopInput;
  try {
    input = JSON.parse(await readStdin()) as CodexStopInput;
  } catch {
    return 0; // unreadable input: never block a session on a hook bug
  }
  const decision = decideCodexStop(input);
  if (decision.decision === "block") {
    process.stdout.write(JSON.stringify({ decision: "block", reason: decision.reason }) + "\n");
  } else if (decision.systemMessage) {
    process.stdout.write(JSON.stringify({ systemMessage: decision.systemMessage }) + "\n");
  }
  return 0;
}
