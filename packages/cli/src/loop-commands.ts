// ─── Loop Command Handlers ──────────────────────────────────────────
//
// Implements: ralph loop start/stop/follow/run
//
// Smart routing:
//   start  → auto-starts server daemon if not running, POST to server API
//   stop   → POST to server API, error if server not running
//   follow → SSE stream from server, format events for terminal
//   run    → direct mode, creates LoopRunner in-process (no server)

import * as fs from "node:fs";
import * as path from "node:path";

import {
  readToolConfig,
  LoopStartOptionsSchema,
  readIterationStatus,
  type LoopEvent,
  type IterationStatus,
  deriveStatus,
  readLogTail,
  watchLog,
  unblockItems,
  defaultBacklogPaths,
} from "@ralph/core";
import ports from "../../../config/ports.json";
import { LoopRunner } from "@ralph/loop";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag, extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, info, print, error, success, outputJson } from "./formatter.js";
import { StatusLine } from "./status-line.js";
import {
  readServerState,
  isProcessAlive,
  pingHealthEndpoint,
  handleServerStart,
} from "./server-commands.js";

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;

// ─── Helpers ────────────────────────────────────────────────────────

/** Resolve the project path from the first positional arg (default: cwd) */
function resolveProjectPath(ctx: CommandContext): string {
  const target = ctx.args[0] ?? ".";
  return path.resolve(target);
}

/** Derive the project ID (directory basename) for API calls */
function projectId(projectPath: string): string {
  return path.basename(projectPath);
}

/** Get the server port — prefer actual port from state file, fall back to config. */
function getPort(): number {
  const state = readServerState();
  if (state) return state.port;
  const configResult = readToolConfig();
  return configResult.ok ? configResult.value.port : ports.serverPort;
}

/** Build an API URL for loop endpoints */
function apiUrl(port: number, id: string, endpoint: string): string {
  return `http://127.0.0.1:${port}/api/projects/${encodeURIComponent(id)}/loop/${endpoint}`;
}

/** Check if the ralph server is running via state file */
function isServerRunning(): boolean {
  const state = readServerState();
  return state !== null && isProcessAlive(state.pid);
}

/** Auto-start server daemon if not running. Returns true if server is ready. */
async function ensureServerRunning(ctx: CommandContext): Promise<boolean> {
  if (isServerRunning()) {
    // Verify health endpoint actually responds
    const port = getPort();
    const health = await pingHealthEndpoint(port);
    if (health) return true;
  }

  info("Server not running. Starting daemon...");

  // Create synthetic context to start server as daemon, quietly
  const startCtx: CommandContext = {
    args: [],
    flags: new Map<string, string | true>([["daemon", true as const]]),
    globalFlags: { ...ctx.globalFlags, quiet: true },
    rawArgv: [],
  };

  // startDaemon now waits for readiness before returning
  const code = await handleServerStart(startCtx);
  if (code !== ExitCode.SUCCESS) {
    error("Failed to start server daemon.");
    return false;
  }

  const port = getPort();
  info(`Server started on port ${port}.`);
  return true;
}

// ─── handleLoopStart ────────────────────────────────────────────────

export async function handleLoopStart(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);
  const id = projectId(projectPath);
  const follow = extractBoolFlag(ctx.flags, "follow");
  const retryBlocked = extractBoolFlag(ctx.flags, "retry-blocked");

  if (retryBlocked) {
    const ubResult = unblockItems(defaultBacklogPaths(projectPath));
    if (ubResult.ok && ubResult.value.unblockedCount > 0) {
      info(
        `Unblocked ${ubResult.value.unblockedCount} items: ${ubResult.value.unblockedIds.join(", ")}`,
      );
    }
  }

  // Auto-start server if not running
  const running = await ensureServerRunning(ctx);
  if (!running) return ExitCode.ERROR;

  const port = getPort();

  // Build request body from flags
  const body: Record<string, unknown> = {};
  const iterations = extractNumberFlag(ctx.flags, "iterations");
  const retries = extractNumberFlag(ctx.flags, "retries");
  const model = extractStringFlag(ctx.flags, "model");
  const timeout = extractNumberFlag(ctx.flags, "timeout");
  if (iterations !== null) body.maxIterations = iterations;
  if (retries !== null) body.maxRetries = retries;
  if (model !== null) body.model = model;
  if (timeout !== null) body.sessionTimeoutMinutes = timeout;

  try {
    const url = apiUrl(port, id, "start");
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ralph-Request": "true",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      if (ctx.globalFlags.json) {
        const data = await resp.json();
        outputJson(data);
      } else {
        success(`Loop started for ${c.cyan(id)}`);
      }

      if (follow) {
        const eventsUrl = apiUrl(port, id, "events");
        info(c.dim("Following loop events... Press Ctrl+C to stop."));
        const statusLine = new StatusLine({
          isTTY: process.stdout.isTTY ?? false,
          quiet: ctx.globalFlags.quiet,
          json: ctx.globalFlags.json,
          noColor: ctx.globalFlags.noColor,
        });
        return streamEventsUntilDone(eventsUrl, statusLine);
      }

      if (!ctx.globalFlags.json) {
        info(`Follow: ${c.cyan(`ralph loop follow ${ctx.args[0] ?? "."}`)}`);
      }
      return ExitCode.SUCCESS;
    }

    const errBody = (await resp.json().catch(() => ({ error: { message: resp.statusText } }))) as {
      error?: { message?: string };
    };
    const errMsg = errBody?.error?.message ?? resp.statusText;

    if (resp.status === 409) {
      error(`Loop already running for ${id}.`);
      info(`Use ${c.cyan("ralph loop stop")} to stop it first.`);
    } else {
      error(`Failed to start loop: ${errMsg}`);
    }
    return ExitCode.ERROR;
  } catch (e) {
    error(`Failed to connect to server: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }
}

// ─── handleLoopStop ─────────────────────────────────────────────────

export async function handleLoopStop(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);
  const id = projectId(projectPath);
  const port = getPort();

  if (!isServerRunning()) {
    error("Server is not running.");
    info(
      `Start the server with ${c.cyan("ralph server start")} or use ${c.cyan("ralph loop start")} which auto-starts.`,
    );
    return ExitCode.ERROR;
  }

  try {
    const url = apiUrl(port, id, "stop");
    const resp = await fetch(url, {
      method: "POST",
      headers: { "X-Ralph-Request": "true" },
    });

    if (resp.ok) {
      if (ctx.globalFlags.json) {
        const data = await resp.json();
        outputJson(data);
      } else {
        success(`Loop stopped for ${c.cyan(id)}`);
      }
      return ExitCode.SUCCESS;
    }

    const errBody = (await resp.json().catch(() => ({ error: { message: resp.statusText } }))) as {
      error?: { message?: string };
    };
    const errMsg = errBody?.error?.message ?? resp.statusText;

    if (resp.status === 404) {
      error(`No active loop for ${id}.`);
    } else {
      error(`Failed to stop loop: ${errMsg}`);
    }
    return ExitCode.ERROR;
  } catch (e) {
    error(`Failed to connect to server: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }
}

// ─── Shared SSE streaming ───────────────────────────────────────────

const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "loop_completed",
  "loop_error",
  "loop_cancelled",
]);

/**
 * Connect to a loop's SSE endpoint, format and print events, and
 * auto-disconnect when a terminal event is received.
 * Returns the exit code.
 */
async function streamEventsUntilDone(url: string, sl?: StatusLine): Promise<number> {
  let currentItemId = "";
  let currentItemTitle = "";

  return new Promise<number>((resolve) => {
    const controller = new AbortController();
    let resolved = false;

    const finish = (code: number) => {
      if (resolved) return;
      resolved = true;
      sl?.stop();
      controller.abort();
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      resolve(code);
    };

    const stop = () => {
      sl?.stop();
      finish(ExitCode.SUCCESS);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    connectSSE(url, controller.signal, (event) => {
      sl?.pause();
      formatAndPrintEvent(event);

      if (sl) {
        switch (event.type) {
          case "item_selected":
            currentItemId = event.itemId;
            currentItemTitle = event.title;
            break;
          case "llm_spawned":
            sl.start(`Claude working on #${currentItemId}: ${currentItemTitle}`);
            break;
          case "llm_exited":
            sl.stop();
            break;
          case "sleep_start":
            sl.startCountdown("Rate limited — resumes in", new Date(event.sleepUntil));
            break;
          case "sleep_end":
            sl.stop();
            break;
          case "review_started":
            sl.start("Review pass running");
            break;
          case "review_completed":
          case "review_failed":
            sl.stop();
            break;
          default:
            sl.resume();
        }
      }

      if (TERMINAL_EVENT_TYPES.has(event.type)) {
        finish(event.type === "loop_error" ? ExitCode.ERROR : ExitCode.SUCCESS);
      }
    })
      .then(() => finish(ExitCode.SUCCESS))
      .catch((e) => {
        if (controller.signal.aborted) {
          finish(ExitCode.SUCCESS);
          return;
        }
        error(`SSE connection failed: ${e instanceof Error ? e.message : String(e)}`);
        finish(ExitCode.ERROR);
      });
  });
}

// ─── followDirectMode ───────────────────────────────────────────────

/** Terminal states that indicate the loop is no longer active */
const TERMINAL_LOOP_STATES: ReadonlySet<string> = new Set([
  "IDLE",
  "COMPLETE",
  "ERROR",
  "PAUSED",
  "PAUSED_HUMAN",
  "LIMIT_REACHED",
  "WEEKLY_LIMIT",
]);

const DIRECT_MODE_POLL_MS = 2000;

/**
 * Follow loop output in direct mode by tailing .ralph/ralph.log
 * and polling deriveStatus() to detect when the loop stops.
 */
async function followDirectMode(projectPath: string): Promise<number> {
  const id = projectId(projectPath);

  // Check if a loop is currently active
  const statusResult = deriveStatus(defaultBacklogPaths(projectPath));
  if (!statusResult.ok) {
    error(`Failed to read project status: ${statusResult.error.message}`);
    return ExitCode.ERROR;
  }

  const { loopState } = statusResult.value;
  if (loopState !== "RUNNING" && loopState !== "SLEEPING_LIMIT") {
    error(`No active loop for ${c.cyan(id)} (state: ${loopState}).`);
    info(`Start a loop with ${c.cyan("ralph loop run .")} or ${c.cyan("ralph loop start .")}`);
    return ExitCode.ERROR;
  }

  // Print recent log lines for context
  const tailResult = readLogTail(defaultBacklogPaths(projectPath), 20);
  if (tailResult.ok && tailResult.value.length > 0) {
    info(c.dim("─── recent log ───"));
    for (const line of tailResult.value) {
      print(c.dim(line));
    }
    info(c.dim("─── live tail ────"));
  }

  info(`Following loop output for ${c.cyan(id)}...`);
  info(c.dim("Press Ctrl+C to stop."));

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

    // Try to start watching the log file
    const tryStartWatcher = () => {
      if (watcherActive) return;
      try {
        stopWatcher = watchLog(defaultBacklogPaths(projectPath), (lines) => {
          for (const line of lines) {
            print(line);
          }
        });
        watcherActive = true;
      } catch {
        // Log file doesn't exist yet — will retry on next poll
      }
    };

    tryStartWatcher();

    // Poll deriveStatus to detect terminal states
    pollTimer = setInterval(() => {
      // Retry watcher setup if it hasn't started yet
      if (!watcherActive) tryStartWatcher();

      const result = deriveStatus(defaultBacklogPaths(projectPath));
      if (!result.ok) return;

      if (TERMINAL_LOOP_STATES.has(result.value.loopState)) {
        print("");
        info(`Loop ended (${result.value.loopState}).`);
        finish(result.value.loopState === "ERROR" ? ExitCode.ERROR : ExitCode.SUCCESS);
      }
    }, DIRECT_MODE_POLL_MS);
  });
}

// ─── handleLoopFollow ───────────────────────────────────────────────

export async function handleLoopFollow(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);
  const id = projectId(projectPath);

  // Server mode: existing SSE streaming behavior
  if (isServerRunning()) {
    const port = getPort();
    const url = apiUrl(port, id, "events");

    info(`Following loop events for ${c.cyan(id)}...`);
    info(c.dim("Press Ctrl+C to stop."));

    const statusLine = new StatusLine({
      isTTY: process.stdout.isTTY ?? false,
      quiet: ctx.globalFlags.quiet,
      json: ctx.globalFlags.json,
      noColor: ctx.globalFlags.noColor,
    });

    return streamEventsUntilDone(url, statusLine);
  }

  // Direct mode: tail ralph.log
  return followDirectMode(projectPath);
}

/** Connect to an SSE endpoint, parse events, and invoke callback for each LoopEvent */
async function connectSSE(
  url: string,
  signal: AbortSignal,
  onEvent: (event: LoopEvent) => void,
): Promise<void> {
  const resp = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal,
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  if (!resp.body) {
    throw new Error("No response body");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        currentData = line.slice(6);
      } else if (line === "" && currentData) {
        if (currentEvent === "loop_event") {
          try {
            const parsed = JSON.parse(currentData) as LoopEvent;
            onEvent(parsed);
          } catch {
            // Invalid JSON — skip
          }
        }
        currentEvent = "";
        currentData = "";
      }
    }
  }
}

// ─── handleLoopRun ──────────────────────────────────────────────────

export async function handleLoopRun(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);

  const iterations = extractNumberFlag(ctx.flags, "iterations") ?? DEFAULT_MAX_ITERATIONS;
  const retries = extractNumberFlag(ctx.flags, "retries") ?? DEFAULT_MAX_RETRIES;
  const model = extractStringFlag(ctx.flags, "model") ?? undefined;
  const timeout = extractNumberFlag(ctx.flags, "timeout") ?? DEFAULT_SESSION_TIMEOUT_MINUTES;
  const reviewOnly = extractBoolFlag(ctx.flags, "review-only");
  const review = extractBoolFlag(ctx.flags, "review") || reviewOnly;
  const retryBlocked = extractBoolFlag(ctx.flags, "retry-blocked");

  if (retryBlocked) {
    const ubResult = unblockItems(defaultBacklogPaths(projectPath));
    if (ubResult.ok && ubResult.value.unblockedCount > 0) {
      info(
        `Unblocked ${ubResult.value.unblockedCount} items: ${ubResult.value.unblockedIds.join(", ")}`,
      );
    }
  }

  const options = LoopStartOptionsSchema.parse({
    maxIterations: iterations,
    maxRetries: retries,
    model,
    sessionTimeoutMinutes: timeout,
    review,
    reviewOnly,
  });

  info(`Running loop directly for ${c.cyan(path.basename(projectPath))}`);
  info(
    c.dim(
      `iterations=${options.maxIterations}, retries=${options.maxRetries}, timeout=${options.sessionTimeoutMinutes}m${review ? ", review=on" : ""}${reviewOnly ? " (review-only)" : ""}`,
    ),
  );

  const runnerResult = LoopRunner.create(projectPath, options);
  if (!runnerResult.ok) {
    error(runnerResult.error.message);
    return 1;
  }
  const runner = runnerResult.value;

  const statusLine = new StatusLine({
    isTTY: process.stdout.isTTY ?? false,
    quiet: ctx.globalFlags.quiet,
    json: ctx.globalFlags.json,
    noColor: ctx.globalFlags.noColor,
  });

  // Track current item and tool state for status line
  let currentItemId = "";
  let currentItemTitle = "";
  let currentToolName: string | null = null;
  let tokenSummary = "";

  // Subscribe to all events for terminal output
  const eventTypes: LoopEvent["type"][] = [
    "loop_started",
    "iteration_start",
    "item_selected",
    "llm_spawned",
    "llm_exited",
    "signal_parsed",
    "item_completed",
    "item_blocked",
    "item_retried",
    "needs_human",
    "usage_limit_hit",
    "usage_limit_cleared",
    "sleep_start",
    "sleep_end",
    "loop_completed",
    "loop_error",
    "loop_cancelled",
    "review_started",
    "review_completed",
    "review_failed",
    "llm_tool_activity",
    "llm_token_update",
    "llm_stuck_warning",
  ];
  for (const eventType of eventTypes) {
    runner.on(eventType, (event: LoopEvent) => {
      // For streaming events, update the detail line without pausing
      switch (event.type) {
        case "llm_tool_activity": {
          if (event.phase === "start") {
            currentToolName = event.toolName;
            const detail = tokenSummary
              ? `\u2192 ${event.toolName}  (${tokenSummary})`
              : `\u2192 ${event.toolName}`;
            statusLine.setDetail(detail);
          } else {
            currentToolName = null;
            if (tokenSummary) {
              statusLine.setDetail(`(${tokenSummary})`);
            } else {
              statusLine.setDetail(null);
            }
          }
          return;
        }
        case "llm_token_update": {
          const inK = (event.inputTokens / 1000).toFixed(1);
          const outK = (event.outputTokens / 1000).toFixed(1);
          tokenSummary = `${inK}k in / ${outK}k out`;
          if (currentToolName) {
            statusLine.setDetail(`\u2192 ${currentToolName}  (${tokenSummary})`);
          } else {
            statusLine.setDetail(`(${tokenSummary})`);
          }
          return;
        }
        case "llm_stuck_warning": {
          const mins = Math.round(event.silentMs / 60000);
          statusLine.setDetail(`\x1b[33m\u26A0 No activity for ${mins}m\x1b[0m`);
          return;
        }
      }

      statusLine.pause();
      formatAndPrintEvent(event);

      switch (event.type) {
        case "item_selected":
          currentItemId = event.itemId;
          currentItemTitle = event.title;
          currentToolName = null;
          tokenSummary = "";
          break;
        case "llm_spawned":
          statusLine.start(`Claude working on #${currentItemId}: ${currentItemTitle}`);
          break;
        case "llm_exited":
          statusLine.stop();
          currentToolName = null;
          tokenSummary = "";
          break;
        case "sleep_start":
          statusLine.startCountdown("Rate limited — resumes in", new Date(event.sleepUntil));
          break;
        case "sleep_end":
          statusLine.stop();
          break;
        case "review_started":
          statusLine.start("Review pass running");
          break;
        case "review_completed":
        case "review_failed":
          statusLine.stop();
          break;
        default:
          statusLine.resume();
      }
    });
  }

  // Two-stage cancel: first Ctrl+C = graceful stop, second = force quit
  let sigintCount = 0;

  const onSigint = () => {
    sigintCount++;
    statusLine.stop();
    if (sigintCount === 1) {
      runner.requestGracefulStop();
      print("");
      info(
        c.yellow("Finishing current iteration... ") + c.dim("Press Ctrl+C again to force quit."),
      );
    } else {
      print("");
      info(c.red("Force quitting..."));
      runner.cancel();
    }
  };

  const onSigterm = () => {
    statusLine.stop();
    runner.cancel();
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    const result = await runner.start();

    if (ctx.globalFlags.json) {
      outputJson(result);
    } else {
      print("");
      if (result.cancelled && !result.gracefulStop) {
        info("Loop force-cancelled.");
      } else if (result.gracefulStop) {
        info("Loop stopped gracefully after completing iteration.");
      } else {
        let msg = `Loop finished: ${result.completedCount} completed, ${result.blockedCount} blocked`;
        if (result.reviewItemsCreated !== undefined && result.reviewItemsCreated > 0) {
          msg += `, ${result.reviewItemsCreated} review items created`;
        }
        if (result.reviewSummary) {
          msg += `\n  Review: ${result.reviewSummary}`;
        }
        success(msg);

        if (result.blockedCount > 0) {
          print("");
          info("To retry blocked items:");
          info(`  ${c.cyan("ralph backlog unblock .")}     ${c.dim("# then re-run")}`);
          info(`  ${c.cyan("ralph loop run . --retry-blocked")}  ${c.dim("# or in one step")}`);
        }
      }
    }

    return ExitCode.SUCCESS;
  } catch (e) {
    error(`Loop failed: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  } finally {
    statusLine.stop();
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

// ─── handleLoopReview ────────────────────────────────────────────────

export async function handleLoopReview(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);

  const model = extractStringFlag(ctx.flags, "model") ?? undefined;
  const timeout = extractNumberFlag(ctx.flags, "timeout") ?? DEFAULT_SESSION_TIMEOUT_MINUTES;

  const options = LoopStartOptionsSchema.parse({
    maxIterations: 1,
    maxRetries: 1,
    model,
    sessionTimeoutMinutes: timeout,
    review: true,
    reviewOnly: true,
  });

  info(`Running standalone review for ${c.cyan(path.basename(projectPath))}`);

  const runnerResult = LoopRunner.create(projectPath, options);
  if (!runnerResult.ok) {
    error(runnerResult.error.message);
    return 1;
  }
  const runner = runnerResult.value;

  // Subscribe to review events
  const eventTypes: LoopEvent["type"][] = ["review_started", "review_completed", "review_failed"];
  for (const eventType of eventTypes) {
    runner.on(eventType, (event: LoopEvent) => {
      formatAndPrintEvent(event);
    });
  }

  // Two-stage cancel: first Ctrl+C = graceful stop, second = force quit
  let sigintCount = 0;

  const onSigint = () => {
    sigintCount++;
    if (sigintCount === 1) {
      runner.requestGracefulStop();
      print("");
      info(
        c.yellow("Finishing current iteration... ") + c.dim("Press Ctrl+C again to force quit."),
      );
    } else {
      print("");
      info(c.red("Force quitting..."));
      runner.cancel();
    }
  };

  const onSigterm = () => runner.cancel();

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    const result = await runner.startReviewOnly();

    if (ctx.globalFlags.json) {
      outputJson(result);
    } else {
      print("");
      if (result.reviewItemsCreated && result.reviewItemsCreated > 0) {
        success(`Review created ${result.reviewItemsCreated} items`);
        if (result.reviewSummary) {
          info(`Summary: ${result.reviewSummary}`);
        }
      } else {
        success("Review complete — no issues found");
      }
    }

    return ExitCode.SUCCESS;
  } catch (e) {
    error(`Review failed: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

// ─── Event Formatting ───────────────────────────────────────────────

/** Format and print a LoopEvent for terminal output with colors and icons */
export function formatAndPrintEvent(event: LoopEvent): void {
  const time = formatTime(event.timestamp);
  const prefix = c.dim(time);

  switch (event.type) {
    case "loop_started":
      print(
        `${prefix} ${c.green("\u25B6")} ${c.bold("Loop started")} (max ${event.maxIterations} iterations${event.model ? `, model: ${event.model}` : ""})`,
      );
      break;

    case "iteration_start":
      print(
        `${prefix} ${c.cyan("\u2192")} ${c.bold(`Iteration ${event.iteration}/${event.maxIterations}`)}`,
      );
      break;

    case "item_selected":
      print(
        `${prefix} ${c.blue("\u25CF")} Selected ${c.bold(`#${event.itemId}`)} ${event.title} ${c.dim(`(P${event.priority})`)}`,
      );
      break;

    case "llm_spawned":
      print(
        `${prefix} ${c.magenta("\u25C6")} ${event.provider} spawned${event.model ? ` (${event.model})` : ""} ${c.dim(`timeout: ${event.timeoutMinutes}m`)}`,
      );
      break;

    case "llm_exited": {
      const duration = Math.round(event.durationMs / 1000);
      const icon = event.exitCode === 0 ? c.green("\u25C7") : c.yellow("\u25C7");
      const timedOutLabel = event.timedOut ? c.red(" TIMED OUT") : "";
      print(
        `${prefix} ${icon} ${event.provider} exited (code=${event.exitCode}, ${duration}s)${timedOutLabel}`,
      );
      break;
    }

    case "signal_parsed": {
      const signalColor =
        event.signal === "done"
          ? c.green
          : event.signal === "blocked"
            ? c.red
            : event.signal === "needs_human"
              ? c.magenta
              : c.yellow;
      print(
        `${prefix}   Signal: ${signalColor(event.signal)}${event.reason ? ` \u2014 ${event.reason}` : ""}`,
      );
      break;
    }

    case "item_completed":
      print(
        `${prefix} ${c.green("\u2713")} ${c.green(`Completed #${event.itemId}`)} ${event.title}`,
      );
      break;

    case "item_blocked":
      print(`${prefix} ${c.red("\u2717")} ${c.red(`Blocked #${event.itemId}`)} ${event.reason}`);
      break;

    case "item_retried":
      print(
        `${prefix} ${c.yellow("\u21BB")} Retry #${event.itemId} (${event.attempt}/${event.maxRetries})`,
      );
      break;

    case "needs_human":
      print(
        `${prefix} ${c.magenta("\u26A0")} ${c.magenta(`Needs human #${event.itemId}`)} ${event.reason}`,
      );
      break;

    case "usage_limit_hit":
      print(
        `${prefix} ${c.yellow("\u26A0")} ${c.yellow("Usage limit hit")} (${event.limitType}, ${event.utilization}%)`,
      );
      break;

    case "usage_limit_cleared":
      print(`${prefix} ${c.green("\u2713")} Usage limit cleared (${event.limitType})`);
      break;

    case "sleep_start":
      print(
        `${prefix} ${c.blue("\u25C6")} ${c.blue("Sleeping")} until ${event.sleepUntil} \u2014 ${event.reason}`,
      );
      break;

    case "sleep_end":
      print(`${prefix} ${c.green("\u25B6")} Woke from sleep`);
      break;

    case "loop_completed":
      print(
        `${prefix} ${c.green("\u25A0")} ${c.green("Loop completed")} \u2014 ${event.completedCount} done, ${event.blockedCount} blocked`,
      );
      if (event.blockedCount > 0) {
        print(
          `${prefix}   ${c.dim("Retry:")} ${c.cyan("ralph backlog unblock .")} ${c.dim("or")} ${c.cyan("ralph loop run . --retry-blocked")}`,
        );
      }
      break;

    case "loop_error":
      print(`${prefix} ${c.red("\u2717")} ${c.red("Loop error:")} ${event.error}`);
      break;

    case "loop_cancelled":
      print(`${prefix} ${c.yellow("\u25A0")} ${c.yellow("Loop cancelled")}`);
      break;

    case "review_started":
      print(
        `${prefix} ${c.cyan("\u25C6")} ${c.bold("Review pass started")} (${event.completedItemIds.length} items to review)`,
      );
      break;

    case "review_completed":
      if (event.itemsCreated > 0) {
        print(
          `${prefix} ${c.yellow("\u25C6")} ${c.yellow("Review found issues")} \u2014 ${event.itemsCreated} fix items created`,
        );
        print(`${prefix}   ${c.dim(event.summary)}`);
      } else {
        print(`${prefix} ${c.green("\u25C6")} ${c.green("Review passed")} \u2014 no issues found`);
      }
      break;

    case "review_failed":
      print(`${prefix} ${c.red("\u25C6")} ${c.red("Review failed:")} ${event.reason}`);
      break;
  }
}

// ─── handleLoopWatch ─────────────────────────────────────────────

export async function handleLoopWatch(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);
  const jsonOutput = ctx.globalFlags.json;
  const statusFile = path.resolve(projectPath, ".ralph", "iteration-status.json");

  // Initial read
  const initial = readIterationStatus(defaultBacklogPaths(projectPath));
  if (!initial) {
    if (jsonOutput) {
      outputJson({ status: "no_iteration" });
    } else {
      info("No active iteration. Waiting for iteration-status.json...");
    }
  } else {
    renderWatchOutput(initial, jsonOutput);
  }

  return new Promise<number>((resolve) => {
    let resolved = false;
    let watcher: fs.FSWatcher | undefined;

    const finish = (code: number) => {
      if (resolved) return;
      resolved = true;
      watcher?.close();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      resolve(code);
    };

    const onSignal = () => finish(ExitCode.SUCCESS);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const ralphDir = path.resolve(projectPath, ".ralph");

    try {
      watcher = fs.watch(ralphDir, (eventType, filename) => {
        if (filename !== "iteration-status.json") return;

        const status = readIterationStatus(defaultBacklogPaths(projectPath));
        if (status) {
          renderWatchOutput(status, jsonOutput);
        } else {
          // File was deleted — iteration ended
          if (jsonOutput) {
            outputJson({ status: "iteration_ended" });
          } else {
            print("");
            info("Iteration ended (status file removed).");
          }
          finish(ExitCode.SUCCESS);
        }
      });

      watcher.on("error", () => {
        error("Watch error on .ralph directory");
        finish(ExitCode.ERROR);
      });
    } catch (e) {
      error(`Cannot watch directory: ${e instanceof Error ? e.message : String(e)}`);
      finish(ExitCode.ERROR);
    }
  });
}

function renderWatchOutput(status: IterationStatus, json: boolean): void {
  if (json) {
    outputJson(status);
    return;
  }

  const elapsed = formatElapsedWatch(status.startedAt);
  const lastAgo = formatAgo(status.lastActivityAt);
  const inK = (status.tokens.input / 1000).toFixed(1);
  const outK = (status.tokens.output / 1000).toFixed(1);
  const toolLine = status.currentTool
    ? `${c.cyan("\u2192")} ${status.currentTool}`
    : c.dim("(idle)");
  const stuckLine = status.stuckWarning ? `  ${c.yellow("\u26A0 Possibly stuck")}` : "";

  // Clear screen and render
  process.stdout.write("\x1b[2J\x1b[H");
  print(`${c.bold("Item")} #${status.itemId}`);
  print(`${c.bold("Phase:")} tool_use ${toolLine}${stuckLine}`);
  print(`${c.bold("Tokens:")} ${c.cyan(`${inK}k`)} in / ${c.cyan(`${outK}k`)} out`);
  print(`${c.bold("Active for")} ${elapsed} | ${c.bold("Last activity:")} ${lastAgo}`);
  if (status.recentTools.length > 0) {
    print(`${c.bold("Recent:")} ${c.dim(status.recentTools.join(", "))}`);
  }
}

function formatElapsedWatch(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

function formatAgo(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

/** Format ISO timestamp to HH:MM:SS */
function formatTime(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return isoTimestamp;
  }
}
