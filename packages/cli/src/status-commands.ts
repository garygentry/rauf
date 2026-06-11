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
  fileExists,
  resolveBacklogRoot,
  resolveBacklogPaths,
  scanActiveRoots,
  detectMigrationState,
  type BacklogPaths,
  type DerivedStatus,
  type LoopStateEnum,
} from "@rauf/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag, extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, info, print, error, warn, outputJson } from "./formatter.js";

// ─── handleStatus ─────────────────────────────────────────────────
//
// Print loop status summary for a project.
// Exit codes per spec: 0=idle/complete, 1=running, 2=blocked/needs_human, 3=limit_reached

export async function handleStatus(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf status <path> [--watch] [--interval N]");
    return ExitCode.INVALID_ARGS;
  }

  const watch = extractBoolFlag(ctx.flags, "watch");
  const interval = extractNumberFlag(ctx.flags, "interval") ?? 2;
  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  if (watch) {
    // Pass backlogFlag to watch mode
    return handleStatusWatch(resolved, interval, backlogFlag ?? undefined);
  }

  if (backlogFlag) {
    // Show status for specific root only
    const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag);
    if (!backlogRootResult.ok) {
      error(backlogRootResult.error.message);
      return ExitCode.INVALID_ARGS;
    }
    const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
    if (!pathsResult.ok) {
      error(pathsResult.error.message);
      return ExitCode.ERROR;
    }

    const result = deriveStatus(pathsResult.value);
    if (!result.ok) {
      if (ctx.globalFlags.json) {
        outputJson({ error: result.error });
      } else {
        error(result.error.message);
      }
      return ExitCode.ERROR;
    }

    if (ctx.globalFlags.json) {
      outputJson(result.value);
      return statusExitCode(result.value.loopState);
    }

    printStatusSummary(result.value);
    return statusExitCode(result.value.loopState);
  } else {
    // Default root + list active non-default roots
    const defaultRoot = path.join(resolved, ".rauf");
    const defaultPathsResult = resolveBacklogPaths(resolved, defaultRoot);

    // Tolerate legacy ralph projects: warn to migrate rather than implying "not installed".
    if (!defaultPathsResult.ok) {
      const legacy = detectMigrationState(resolved);
      if (legacy.ok && (legacy.value === "legacy_ralph" || legacy.value === "partial")) {
        if (ctx.globalFlags.json) {
          outputJson({ legacy: true, message: `Run 'rauf migrate ${resolved}' to migrate.` });
        } else {
          warn(`Legacy rauf project detected.`);
          info(`Run: ${c.cyan(`rauf migrate ${resolved}`)} to migrate it to rauf.`);
        }
        return ExitCode.ERROR;
      }
    }

    if (defaultPathsResult.ok) {
      const result = deriveStatus(defaultPathsResult.value);
      if (!result.ok) {
        if (ctx.globalFlags.json) {
          outputJson({ error: result.error });
        } else {
          error(result.error.message);
          info(`Ensure rauf is installed. Run: ${c.cyan(`rauf install ${resolved}`)}`);
        }
        return ExitCode.ERROR;
      }

      const status = result.value;
      if (ctx.globalFlags.json) {
        outputJson(status);
        return statusExitCode(status.loopState);
      }

      printStatusSummary(status);
    }

    // Scan for active non-default roots
    const activeRootsResult = scanActiveRoots(resolved);
    if (activeRootsResult.ok && activeRootsResult.value.length > 0) {
      const nonDefault = activeRootsResult.value.filter((r) => r.relativePath !== ".rauf");
      if (nonDefault.length > 0) {
        print("");
        print(c.bold("Active backlog roots:"));
        for (const root of nonDefault) {
          const stateLabel = root.loopState;
          const itemLabel = root.currentItem ? ` (item ${root.currentItem})` : "";
          print(`  ${c.cyan(root.relativePath)} — ${stateLabel}${itemLabel}`);
        }
      }
    }

    if (defaultPathsResult.ok) {
      const result = deriveStatus(defaultPathsResult.value);
      if (result.ok) return statusExitCode(result.value.loopState);
    }
    return ExitCode.SUCCESS;
  }
}

// ─── handleLog ────────────────────────────────────────────────────
//
// Print the last N lines of rauf.log. With --follow, stream until Ctrl+C.

export async function handleLog(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf log <path> [--tail N] [--follow]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const tailN = extractNumberFlag(ctx.flags, "tail") ?? 20;
  const follow = extractBoolFlag(ctx.flags, "follow");
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.INVALID_ARGS;
  }
  const pathsResult = resolveBacklogPaths(resolved, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;

  if (follow) {
    return handleLogFollow(paths, tailN);
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
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  const backlogRootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.INVALID_ARGS;
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

async function handleLogFollow(paths: BacklogPaths, initialLines: number): Promise<number> {
  // Show existing tail first
  const tailResult = readLogTail(paths, initialLines);
  if (tailResult.ok && tailResult.value.length > 0) {
    for (const line of tailResult.value) {
      print(line);
    }
  }

  // Stream new lines as they appear
  return new Promise<number>((resolve) => {
    let cleanup: (() => void) | null = null;

    const stop = () => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      resolve(ExitCode.SUCCESS);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    try {
      cleanup = watchLog(paths, (newLines) => {
        for (const line of newLines) {
          print(line);
        }
      });
    } catch {
      // watchLog may throw if the log file doesn't exist yet — that's ok
      // Just wait until interrupted
    }

    // If the process is not interactive (e.g. no TTY and no watch possible),
    // we still resolve on signal only
  });
}

// ─── Status watch mode ──────────────────────────────────────────

async function handleStatusWatch(
  projectPath: string,
  intervalSeconds: number,
  backlogFlag?: string,
): Promise<number> {
  return new Promise<number>((resolve) => {
    let running = true;

    const stop = () => {
      running = false;
      resolve(ExitCode.SUCCESS);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    const tick = () => {
      if (!running) return;

      // Clear screen and move cursor to top-left
      process.stdout.write("\x1b[2J\x1b[H");

      const now = new Date().toLocaleTimeString();
      print(c.dim(`rauf status  (${now})  Ctrl+C to stop`));
      print("");

      // Resolve paths for the target backlog root
      const rootResult = resolveBacklogRoot(projectPath, backlogFlag);
      if (!rootResult.ok) {
        error(rootResult.error.message);
        if (running) setTimeout(tick, intervalSeconds * 1000);
        return;
      }
      const pathsResult = resolveBacklogPaths(projectPath, rootResult.value);
      if (!pathsResult.ok) {
        error(pathsResult.error.message);
        if (running) setTimeout(tick, intervalSeconds * 1000);
        return;
      }

      const result = deriveStatus(pathsResult.value);
      if (!result.ok) {
        error(result.error.message);
      } else {
        printStatusSummary(result.value);
      }

      if (running) {
        setTimeout(tick, intervalSeconds * 1000);
      }
    };

    tick();
  });
}

// ─── Status formatting ───────────────────────────────────────────

/** Map LoopStateEnum to the status-specific exit code */
function statusExitCode(state: LoopStateEnum): number {
  switch (state) {
    case "RUNNING":
      return 1;
    case "PAUSED_HUMAN":
      return 2;
    case "LIMIT_REACHED":
      return 3;
    default:
      // IDLE, COMPLETE, PAUSED, ERROR, NOT_INSTALLED → 0
      return 0;
  }
}

/** Color a loop state badge */
function colorLoopState(state: LoopStateEnum): string {
  switch (state) {
    case "RUNNING":
      return c.green(state);
    case "PAUSED_HUMAN":
      return c.magenta(state);
    case "LIMIT_REACHED":
      return c.yellow(state);
    case "ERROR":
      return c.red(state);
    case "COMPLETE":
      return c.cyan(state);
    case "PAUSED":
      return c.yellow(state);
    case "NOT_INSTALLED":
      return c.dim(state);
    case "SLEEPING_LIMIT":
      return c.blue(state);
    case "WEEKLY_LIMIT":
      return c.red(state);
    default:
      return c.dim(state);
  }
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
  const genuineBlocked = Math.max(0, s.blocked - deferred);
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
