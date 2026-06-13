// ─── Loop Command Handlers ──────────────────────────────────────────
//
// Implements: rauf loop start/stop/run/review
//
// Smart routing:
//   start  → auto-starts server daemon if not running, POST to server API
//   stop   → POST to server API, error if server not running
//   run    → direct mode, creates LoopRunner in-process (no server)
//
// The live-view verb is the top-level `follow` command (follow-command.ts);
// the old `loop follow` / `loop watch` monitor verbs were removed (clean break).

import * as path from "node:path";

import {
  readToolConfig,
  LoopStartOptionsSchema,
  type LoopEvent,
  unblockItems,
  resolveBacklogRoot,
  resolveBacklogPaths,
  checkLock,
  forceClearLock,
  detectMigrationState,
  readBacklog,
  readMarkerFile,
  formatBudgetMath,
  resolveMaxIterations,
  formatMaxIterationsSource,
  ok,
  err,
  ErrorCodes,
  type BacklogPaths,
  type Result,
} from "@rauf/core";
import ports from "../../../config/ports.json";
import {
  LoopRunner,
  checkLoopPreconditions,
  execGit,
  gitCommit,
  RUNTIME_EXCLUDE_PATHSPECS,
} from "@rauf/loop";
import type { LoopResult } from "@rauf/loop";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag, extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, info, print, error, warn, success, outputJson, configureOutput } from "./formatter.js";
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

/**
 * Resolve maxIterations by precedence (flag > `.rauf.json` options.maxIterations
 * > computed-from-backlog) and log the resolved value plus its source. The
 * budget-math line (item 010) is only printed when the source is `computed`.
 */
function resolveLoopMaxIterations(
  projectPath: string,
  paths: BacklogPaths,
  flag: number | null,
): number {
  const markerResult = readMarkerFile(projectPath);
  const markerMaxIterations = markerResult.ok ? markerResult.value.options.maxIterations : null;
  const backlogResult = readBacklog(paths);
  const backlog = backlogResult.ok ? backlogResult.value : null;

  const resolved = resolveMaxIterations({
    flag,
    markerMaxIterations,
    backlog,
    fallback: DEFAULT_MAX_ITERATIONS,
  });

  if (resolved.source === "computed" && resolved.estimate) {
    info(c.dim(formatBudgetMath(resolved.estimate)));
  }
  info(c.dim(formatMaxIterationsSource(resolved)));
  return resolved.value;
}

/**
 * Switch to a fresh feature branch before the loop runs, in response to
 * `--create-branch <name>`. No-ops (switched:false) when already on that
 * branch. Fails cleanly if the branch already exists or git errors — e.g. so
 * `--create-branch` never silently runs the loop on the wrong branch.
 */
export async function createLoopBranch(
  projectPath: string,
  branchName: string,
): Promise<Result<{ switched: boolean }>> {
  let current = "";
  try {
    current = (await execGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    // Not a git repo (or no commits) — let `git switch -c` surface the error.
  }

  if (current === branchName) {
    return ok({ switched: false });
  }

  try {
    await execGit(projectPath, ["switch", "-c", branchName]);
    return ok({ switched: true });
  } catch (e) {
    return err({
      code: ErrorCodes.CONFLICT,
      message:
        `Could not create branch "${branchName}": ${e instanceof Error ? e.message : String(e)}. ` +
        "Pick a name that does not already exist, or `git switch` to it manually.",
    });
  }
}

/**
 * Commit a freshly-authored backlog before the loop runs, in response to
 * `--seed-backlog`. backlog.json is git-tracked (its status changes are
 * meaningful), so an uncommitted backlog would otherwise be swept into item
 * 001's loop commit when the loop marks the first item in_progress. Only
 * auto-commits when the ONLY dirty paths are this loop's backlog file(s) (+ the
 * loop runtime files gitCommit never stages) — if ANY other file is dirty,
 * including `.rauf/` bookkeeping like RAUF.md / progress.md / REVIEW.md, it
 * refuses and lists them, so unrelated work is never committed under the loop's
 * name. The dirty-check and gitCommit's staging share RUNTIME_EXCLUDE_PATHSPECS
 * so the seed commit can only ever contain the backlog. (item 028)
 */
export async function seedBacklog(
  projectPath: string,
  paths: BacklogPaths,
): Promise<Result<{ committed: boolean; commitHash: string }>> {
  // Decide whether any NON-backlog file is dirty: `git status --porcelain` over
  // everything EXCEPT the seed commit's intended content (this loop's backlog +
  // .bak) and the runtime files gitCommit itself never stages. The exclusion set
  // MUST mirror gitCommit's staging exclusions exactly — otherwise a dirty path
  // that the check skips but gitCommit WOULD stage (e.g. `.rauf/RAUF.md`,
  // `.rauf/progress.md`, `.rauf/REVIEW.md`) gets silently swept into the seed
  // commit. Excluding the whole `.rauf/` dir here would do exactly that, so we
  // reuse RUNTIME_EXCLUDE_PATHSPECS instead and let any other `.rauf/`
  // bookkeeping edit surface as "other dirty" → refuse. Non-empty output means
  // there is other work we must not sweep into the seed commit.
  const backlogRel = path.relative(projectPath, paths.backlog);
  const excludePathspecs = [
    ".",
    `:(exclude)${backlogRel}`,
    `:(exclude)${backlogRel}.bak`,
    ...RUNTIME_EXCLUDE_PATHSPECS,
  ];

  let otherDirty: string;
  try {
    otherDirty = (
      await execGit(projectPath, ["status", "--porcelain", "--", ...excludePathspecs])
    ).trim();
  } catch (e) {
    return err({
      code: ErrorCodes.CONFLICT,
      message: `Could not read git status: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (otherDirty !== "") {
    // Porcelain lines are `XY <path>` (slice past the 2-char status + space).
    const files = otherDirty
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter((f) => f.length > 0);
    return err({
      code: ErrorCodes.CONFLICT,
      message:
        "--seed-backlog only commits the backlog when nothing else is dirty, but these files have uncommitted changes:\n" +
        files.map((f) => `  ${f}`).join("\n") +
        "\nCommit or stash them first, then re-run.",
    });
  }

  // Only the backlog (+ pure runtime files) is dirty. gitCommit stages with the
  // same runtime excludes and uses the `[rauf] <id>: <title>` format — id "backlog"
  // + title "seed <project>" yields `[rauf] backlog: seed <project>`.
  const commitResult = await gitCommit(
    projectPath,
    "backlog",
    `seed ${path.basename(projectPath)}`,
  );
  if (!commitResult.ok) return commitResult;
  return ok({
    committed: commitResult.value.commitHash !== "",
    commitHash: commitResult.value.commitHash,
  });
}

/**
 * Copy-pasteable remediation printed when `checkLoopPreconditions` refuses,
 * replacing the old generic "commit or stash" hint. Surfaces the three ways to
 * reach a runnable state: create/switch a feature branch, seed the backlog
 * commit, or force past the checks.
 */
export function buildPreconditionRemediation(projectArg: string): string[] {
  const p = projectArg;
  return [
    "To reach a runnable state, run one of:",
    `  git switch -c <branch>                       ${c.dim("# move your work onto a feature branch")}`,
    `  rauf loop run ${p} --create-branch <branch>  ${c.dim("# or have rauf create & switch for you")}`,
    `  rauf loop run ${p} --seed-backlog            ${c.dim("# commit an otherwise-clean backlog first")}`,
    `  rauf loop run ${p} --force                   ${c.dim("# bypass these checks (last resort)")}`,
  ];
}

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

/** Check if the rauf server is running via state file */
function isServerRunning(): boolean {
  const state = readServerState();
  return state !== null && isProcessAlive(state.pid);
}

/**
 * Auto-start server daemon if not running. Returns true if server is ready.
 *
 * No-ops when a healthy server is already running: it never restarts a live
 * server (restarting would cancel every project's in-flight loop). Exported
 * for testing this contract.
 */
export async function ensureServerRunning(ctx: CommandContext): Promise<boolean> {
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
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  // Create & switch to a feature branch before starting (mirrors `loop run`).
  // The switch is a local git operation, so it happens CLI-side before the
  // server request — the server only sees the resulting branch.
  const createBranch = extractStringFlag(ctx.flags, "create-branch");
  if (createBranch !== null) {
    const branchResult = await createLoopBranch(projectPath, createBranch);
    if (!branchResult.ok) {
      error(branchResult.error.message);
      return ExitCode.USAGE;
    }
    if (branchResult.value.switched) {
      info(`Switched to new branch ${c.cyan(createBranch)}`);
    }
  }

  if (retryBlocked) {
    // Resolve paths for unblock operation
    const brResult = resolveBacklogRoot(projectPath, backlogFlag ?? undefined);
    if (brResult.ok) {
      const prResult = resolveBacklogPaths(projectPath, brResult.value);
      if (prResult.ok) {
        const ubResult = unblockItems(prResult.value);
        if (ubResult.ok && ubResult.value.unblockedCount > 0) {
          info(
            `Unblocked ${ubResult.value.unblockedCount} items: ${ubResult.value.unblockedIds.join(", ")}`,
          );
        }
      }
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
  const suppressIterationReview = extractBoolFlag(ctx.flags, "suppress-iteration-review");
  // Resolve maxIterations CLI-side (flag > .rauf.json > computed) and log the
  // source/budget math here — the server runs detached and can't write to this
  // terminal. The web route applies the same precedence for any value we don't
  // send. Skip resolution silently when paths can't be resolved (server default
  // applies).
  const brResult = resolveBacklogRoot(projectPath, backlogFlag ?? undefined);
  const prResult = brResult.ok ? resolveBacklogPaths(projectPath, brResult.value) : null;
  if (prResult && prResult.ok) {
    body.maxIterations = resolveLoopMaxIterations(projectPath, prResult.value, iterations);
  } else if (iterations !== null) {
    body.maxIterations = iterations;
  }
  if (retries !== null) body.maxRetries = retries;
  if (model !== null) body.model = model;
  if (timeout !== null) body.sessionTimeoutMinutes = timeout;
  if (backlogFlag !== null) body.backlogRoot = backlogFlag;
  if (suppressIterationReview) body.suppressIterationReview = true;

  try {
    const url = apiUrl(port, id, "start");
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Rauf-Request": "true",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      if (ctx.globalFlags.json) {
        const data = await resp.json();
        outputJson(data);
      } else {
        success(`Loop started for ${c.cyan(id)}`);
        info(
          c.dim(
            `Note: a ${c.cyan("rauf server stop")}/${c.cyan("restart")} interrupts this loop. ` +
              `Use ${c.cyan("rauf loop run")} for the unattended-safe (in-process) mode.`,
          ),
        );
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
        info(`Follow: ${c.cyan(`rauf follow ${ctx.args[0] ?? "."}`)}`);
      }
      return ExitCode.SUCCESS;
    }

    const errBody = (await resp.json().catch(() => ({ error: { message: resp.statusText } }))) as {
      error?: { message?: string };
    };
    const errMsg = errBody?.error?.message ?? resp.statusText;

    if (resp.status === 409) {
      error(`Loop already running for ${id}.`);
      info(`Use ${c.cyan("rauf loop stop")} to stop it first.`);
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
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  if (!isServerRunning()) {
    error("Server is not running.");
    info(
      `Start the server with ${c.cyan("rauf server start")} or use ${c.cyan("rauf loop start")} which auto-starts.`,
    );
    return ExitCode.ERROR;
  }

  try {
    const url = apiUrl(port, id, "stop");
    const stopBody: Record<string, unknown> = {};
    if (backlogFlag !== null) stopBody.backlogRoot = backlogFlag;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Rauf-Request": "true",
      },
      body: JSON.stringify(stopBody),
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

// ─── loop run terminal exit-code mapping ────────────────────────────

/**
 * Whether a resolved LoopResult represents a usage/iteration-limit terminal
 * (limit_reached / weekly_limit / paused_usage_limit). LoopResult carries this
 * via the `limitReached` flag the runner sets when it writes a terminal limit
 * state (00-core-definitions §2a / 03-exit-codes §3). If no limit signal is
 * reachable, this is simply false and the LIMIT branch is not taken.
 */
function isLimitTerminal(result: LoopResult): boolean {
  return result.limitReached === true;
}

/**
 * Map a terminal `loop run` LoopResult to the unified exit code
 * (00-core-definitions §2a). Pure over the resolved result. Order is
 * significant — needs-human → limit → blocked → clean; the first match wins.
 * The non-Result error path (the caller's catch) covers the ERROR(1) row.
 * RUNNING(6) is NEVER returned here — a finished run is not running.
 */
export function loopRunExitCode(result: LoopResult): ExitCode {
  const needsHuman = (result.needsHumanCount ?? 0) > 0 || result.pausedReason === "needs_human";
  if (needsHuman) {
    return ExitCode.NEEDS_HUMAN; // 3
  }
  if (isLimitTerminal(result)) {
    return ExitCode.LIMIT; // 4 — limit-reached / usage-paused / sleeping terminal
  }
  if (result.blockedCount > 0) {
    return ExitCode.BLOCKED; // 5 — terminal with blocked items
  }
  return ExitCode.SUCCESS; // 0 — clean: completed / idle / cancelled-graceful
}

// ─── handleLoopRun ──────────────────────────────────────────────────

export async function handleLoopRun(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");
  const force = extractBoolFlag(ctx.flags, "force");
  // `rauf resume` sets this: recovery rewrites bookkeeping so the tree is dirty
  // by construction, but branch protection must stay on (unlike --force).
  const allowDirty = extractBoolFlag(ctx.flags, "allow-dirty");

  // --ndjson: emit one JSON object per LoopEvent to stdout (plus a trailing
  // JSON result line) and suppress the human renderer + StatusLine so stdout is
  // a clean machine-readable stream. Forces no-color; diagnostic info/success
  // lines are suppressed (json mode) and errors/warnings still go to stderr.
  const ndjson = extractBoolFlag(ctx.flags, "ndjson");
  if (ndjson) {
    configureOutput({ noColor: true, json: true });
  }

  // Refuse to run a loop on an unmigrated legacy ralph project — its
  // RALPH.md would instruct Claude to emit RALPH_* signals the new parser
  // rejects. Migration is required first (decision #3).
  const migrationState = detectMigrationState(projectPath);
  if (
    migrationState.ok &&
    (migrationState.value === "legacy_ralph" || migrationState.value === "partial")
  ) {
    error(
      `This is a legacy ralph project. Run: ${c.cyan(`rauf migrate ${projectPath}`)} before running the loop.`,
    );
    return ExitCode.ERROR;
  }

  // Resolve backlog paths
  const backlogRootResult = resolveBacklogRoot(projectPath, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.ERROR;
  }
  const pathsResult = resolveBacklogPaths(projectPath, backlogRootResult.value);
  if (!pathsResult.ok) {
    error(pathsResult.error.message);
    return ExitCode.ERROR;
  }
  const paths = pathsResult.value;

  // Create & switch to a feature branch first (before the precondition check)
  // so `--create-branch feat/x` takes a project off a protected/dirty branch
  // and into a runnable state in one step.
  const createBranch = extractStringFlag(ctx.flags, "create-branch");
  if (createBranch !== null) {
    const branchResult = await createLoopBranch(projectPath, createBranch);
    if (!branchResult.ok) {
      error(branchResult.error.message);
      return ExitCode.USAGE;
    }
    if (branchResult.value.switched) {
      info(`Switched to new branch ${c.cyan(createBranch)}`);
    } else {
      info(`Already on branch ${c.cyan(createBranch)}`);
    }
  }

  // --seed-backlog: commit an otherwise-clean tree's backlog before the
  // precondition check, so a freshly-authored backlog isn't swept into item
  // 001's loop commit. Runs after any --create-branch switch so the seed commit
  // lands on the feature branch, not a protected one. Refuses (without
  // committing) if any non-backlog file is dirty.
  const seedBacklogFlag = extractBoolFlag(ctx.flags, "seed-backlog");
  if (seedBacklogFlag) {
    const seedResult = await seedBacklog(projectPath, paths);
    if (!seedResult.ok) {
      error(seedResult.error.message);
      return ExitCode.USAGE;
    }
    if (seedResult.value.committed) {
      info(`Seeded backlog: committed ${c.cyan(seedResult.value.commitHash || "(staged)")}`);
    } else {
      info("Backlog already committed — nothing to seed.");
    }
  }

  // Safety guard: refuse to run on the default branch, a detached HEAD, or a
  // dirty tree — the loop auto-commits with `git add -A`, so otherwise it could
  // sweep unrelated work into a loop commit. --force bypasses (and, below, also
  // force-clears any lock — there is currently no way to skip the guard alone).
  if (!force) {
    const preconditions = await checkLoopPreconditions(projectPath, { allowDirty });
    if (!preconditions.ok) {
      error(preconditions.error.message);
      for (const line of buildPreconditionRemediation(ctx.args[0] ?? ".")) {
        info(line);
      }
      return ExitCode.USAGE;
    }
  }

  // Handle --force: clear existing lock with warning
  if (force) {
    const lockStatus = checkLock(paths);
    if (lockStatus.ok && lockStatus.value.locked) {
      warn(
        `Force-clearing lock (PID ${lockStatus.value.pid}, started ${lockStatus.value.startedAt})`,
      );
      forceClearLock(paths);
    }
  }

  const iterationsFlag = extractNumberFlag(ctx.flags, "iterations");
  const iterations = resolveLoopMaxIterations(projectPath, paths, iterationsFlag);
  const retries = extractNumberFlag(ctx.flags, "retries") ?? DEFAULT_MAX_RETRIES;
  const model = extractStringFlag(ctx.flags, "model") ?? undefined;
  const timeout = extractNumberFlag(ctx.flags, "timeout") ?? DEFAULT_SESSION_TIMEOUT_MINUTES;
  const reviewOnly = extractBoolFlag(ctx.flags, "review-only");
  const review = extractBoolFlag(ctx.flags, "review") || reviewOnly;
  const retryBlocked = extractBoolFlag(ctx.flags, "retry-blocked");
  const suppressIterationReview = extractBoolFlag(ctx.flags, "suppress-iteration-review");
  // Opt-in: halt (state paused_human) on the first RAUF_NEEDS_HUMAN so a
  // supervising session can detect the pause and inject an answer (item 008).
  const pauseOnNeedsHuman = extractBoolFlag(ctx.flags, "pause-on-needs-human");

  if (retryBlocked) {
    const ubResult = unblockItems(paths);
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
    suppressIterationReview,
    pauseOnNeedsHuman,
    backlogRoot: backlogRootResult.value,
  });

  info(`Running loop directly for ${c.cyan(path.basename(projectPath))}`);
  info(
    c.dim(
      `iterations=${options.maxIterations}, retries=${options.maxRetries}, timeout=${options.sessionTimeoutMinutes}m${review ? ", review=on" : ""}${reviewOnly ? " (review-only)" : ""}${suppressIterationReview ? ", iteration-review=suppressed" : ""}`,
    ),
  );
  if (suppressIterationReview) {
    info(
      c.dim(
        "Per-iteration review hooks suppressed in child sessions — review the cumulative diff at the gate (e.g. `git diff main..HEAD`, a PR, or `rauf loop review`).",
      ),
    );
  }

  const runnerResult = LoopRunner.create(projectPath, options);
  if (!runnerResult.ok) {
    error(runnerResult.error.message);
    return ExitCode.ERROR;
  }
  const runner = runnerResult.value;

  const statusLine = new StatusLine({
    isTTY: ndjson ? false : (process.stdout.isTTY ?? false),
    quiet: ctx.globalFlags.quiet,
    json: ctx.globalFlags.json || ndjson,
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
    "loop_paused",
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
      // Machine-readable mode: one JSON object per event, no human renderer
      // and no StatusLine — keeps stdout a clean NDJSON stream.
      if (ndjson) {
        process.stdout.write(JSON.stringify(event) + "\n");
        return;
      }

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
      if (!ndjson) print("");
      info(
        c.yellow("Finishing current iteration... ") + c.dim("Press Ctrl+C again to force quit."),
      );
    } else {
      if (!ndjson) print("");
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

    if (ndjson) {
      // Trailing line: the final loop result as a single JSON object.
      process.stdout.write(JSON.stringify(result) + "\n");
    } else if (ctx.globalFlags.json) {
      outputJson(result);
    } else if (result.pausedReason === "needs_human") {
      print("");
      info(
        c.magenta(
          "Loop paused for human input. Resolve the question, then resume with " +
            c.cyan('rauf resume --answer <id> "<answer>"'),
        ),
      );
    } else {
      print("");
      if (result.cancelled && !result.gracefulStop) {
        info("Loop force-cancelled.");
      } else if (result.gracefulStop) {
        info("Loop stopped gracefully after completing iteration.");
      } else {
        let msg = `Loop finished: ${result.completedCount} completed, ${result.blockedCount} blocked`;
        if (result.needsHumanCount !== undefined && result.needsHumanCount > 0) {
          msg += `, ${result.needsHumanCount} needs human`;
        }
        if (result.reviewItemsCreated !== undefined && result.reviewItemsCreated > 0) {
          msg += `, ${result.reviewItemsCreated} review items created`;
        }
        if (result.reviewSummary) {
          msg += `\n  Review: ${result.reviewSummary}`;
        }
        success(msg);

        const needsHuman = result.needsHumanCount ?? 0;
        if (result.blockedCount > 0 || needsHuman > 0) {
          print("");
          info(
            needsHuman > 0
              ? "To retry blocked / needs-human items (after resolving them):"
              : "To retry blocked items:",
          );
          info(`  ${c.cyan("rauf backlog unblock .")}     ${c.dim("# then re-run")}`);
          info(`  ${c.cyan("rauf loop run . --retry-blocked")}  ${c.dim("# or in one step")}`);
        }
      }
    }

    // Map the terminal LoopResult to the unified exit code (00-core-definitions §2a).
    return loopRunExitCode(result);
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
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  // Resolve backlog paths
  const backlogRootResult = resolveBacklogRoot(projectPath, backlogFlag ?? undefined);
  if (!backlogRootResult.ok) {
    error(backlogRootResult.error.message);
    return ExitCode.ERROR;
  }

  const model = extractStringFlag(ctx.flags, "model") ?? undefined;
  const timeout = extractNumberFlag(ctx.flags, "timeout") ?? DEFAULT_SESSION_TIMEOUT_MINUTES;

  const options = LoopStartOptionsSchema.parse({
    maxIterations: 1,
    maxRetries: 1,
    model,
    sessionTimeoutMinutes: timeout,
    review: true,
    reviewOnly: true,
    backlogRoot: backlogRootResult.value,
  });

  info(`Running standalone review for ${c.cyan(path.basename(projectPath))}`);

  const runnerResult = LoopRunner.create(projectPath, options);
  if (!runnerResult.ok) {
    error(runnerResult.error.message);
    return ExitCode.ERROR;
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

    case "loop_paused":
      print(
        `${prefix} ${c.magenta("\u25A0")} ${c.magenta("Loop paused")} \u2014 needs human input on #${event.itemId}`,
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

    case "loop_completed": {
      const needsHuman = event.needsHumanCount ?? 0;
      print(
        `${prefix} ${c.green("\u25A0")} ${c.green("Loop completed")} \u2014 ${event.completedCount} done, ${event.blockedCount} blocked${needsHuman > 0 ? `, ${needsHuman} needs human` : ""}`,
      );
      if (event.blockedCount > 0 || needsHuman > 0) {
        print(
          `${prefix}   ${c.dim("Retry:")} ${c.cyan("rauf backlog unblock .")} ${c.dim("or")} ${c.cyan("rauf loop run . --retry-blocked")}`,
        );
      }
      break;
    }

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
