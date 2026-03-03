// ─── Server Management Command Handlers ──────────────────────────
//
// Implements: ralph server start/stop/restart/status/logs
//
// Server lifecycle:
//   --foreground: inherit stdio, block until exit (default in TTY)
//   --daemon:     spawn detached, write state to ~/.ralph/server.json,
//                 redirect stdio to ~/.ralph/server.log
//
// Process health:
//   State file check + process.kill(pid, 0) for liveness
//   Health endpoint ping for uptime/version/pid
//   Error file for daemon startup failure propagation

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as child_process from "node:child_process";

import { readToolConfig } from "@ralph/core";

import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractBoolFlag, extractNumberFlag } from "./parser.js";
import { c, info, print, error, outputJson } from "./formatter.js";

// ─── Constants ───────────────────────────────────────────────────

const RALPH_CONFIG_DIR = path.join(os.homedir(), ".ralph");
export const SERVER_STATE_FILE = path.join(RALPH_CONFIG_DIR, "server.json");
export const SERVER_LOG_FILE = path.join(RALPH_CONFIG_DIR, "server.log");
export const SERVER_ERROR_FILE = path.join(RALPH_CONFIG_DIR, "server.error");
const LEGACY_PID_FILE = path.join(RALPH_CONFIG_DIR, "server.pid");
const SIGTERM_TIMEOUT_MS = 5000;
const HEALTH_PING_TIMEOUT_MS = 2000;
const DAEMON_READY_TIMEOUT_MS = 10_000;
const DAEMON_READY_POLL_MS = 300;

// ─── Path resolution ─────────────────────────────────────────────

/**
 * Resolve the web server entry point relative to this file.
 * walks: packages/cli/src/ → packages/ → repo root → packages/web/src/server/index.ts
 *
 * In a compiled binary, this path won't exist on disk — use isCompiledBinary()
 * to determine which spawn strategy to use.
 */
export function resolveServerEntry(): string {
  const thisFile = new URL(import.meta.url).pathname;
  const cliSrc = path.dirname(thisFile); // packages/cli/src
  const cliPkg = path.dirname(cliSrc); // packages/cli
  const packages = path.dirname(cliPkg); // packages
  const repoRoot = path.dirname(packages); // repo root
  return path.join(repoRoot, "packages", "web", "src", "server", "index.ts");
}

/**
 * Detect whether we're running inside a compiled Bun binary.
 * In compiled mode, the monorepo source tree doesn't exist at the
 * path computed by resolveServerEntry(). The server is bundled into
 * the binary itself and started via --internal-server flag.
 */
export function isCompiledBinary(): boolean {
  try {
    return !fs.existsSync(resolveServerEntry());
  } catch {
    return true;
  }
}

/**
 * Get the command and args to spawn the server process.
 * - Dev mode: bun run packages/web/src/server/index.ts
 * - Compiled binary: re-invoke ourselves with --internal-server
 */
function getServerSpawnArgs(port: number | undefined): { cmd: string; args: string[] } {
  if (isCompiledBinary()) {
    const args = ["--internal-server"];
    if (port !== undefined) args.push("--port", String(port));
    return { cmd: process.execPath, args };
  }
  return { cmd: "bun", args: ["run", resolveServerEntry()] };
}

// ─── Server state file helpers ───────────────────────────────────

/** Structured server state persisted to ~/.ralph/server.json */
export interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
}

/** Read the server state file, or null if missing/malformed. Falls back to legacy server.pid. */
export function readServerState(): ServerState | null {
  // Try server.json first
  try {
    const content = fs.readFileSync(SERVER_STATE_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<ServerState>;
    if (typeof parsed.pid === "number" && typeof parsed.port === "number" && typeof parsed.startedAt === "string") {
      return { pid: parsed.pid, port: parsed.port, startedAt: parsed.startedAt };
    }
  } catch {
    // Fall through to legacy check
  }

  // Legacy fallback: read server.pid and construct state with config port
  try {
    const content = fs.readFileSync(LEGACY_PID_FILE, "utf-8").trim();
    const pid = parseInt(content, 10);
    if (!isNaN(pid)) {
      return { pid, port: getPort(), startedAt: new Date().toISOString() };
    }
  } catch {
    // No state available
  }

  return null;
}

/** Write server state atomically, creating ~/.ralph/ if needed. */
export function writeServerState(state: ServerState): void {
  fs.mkdirSync(RALPH_CONFIG_DIR, { recursive: true });
  const tmpFile = SERVER_STATE_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(state), "utf-8");
  fs.renameSync(tmpFile, SERVER_STATE_FILE);
}

/** Remove the server state file (and legacy PID file if present). */
export function removeServerState(): void {
  try {
    fs.unlinkSync(SERVER_STATE_FILE);
  } catch {
    // Already removed — fine.
  }
  try {
    fs.unlinkSync(LEGACY_PID_FILE);
  } catch {
    // Already removed — fine.
  }
}

// ─── Server error file helpers ───────────────────────────────────

/** Structured error written by the daemon on startup failure. */
export interface ServerStartError {
  code: "EADDRINUSE" | "UNKNOWN";
  message: string;
  port: number;
  timestamp: string;
}

/** Read the daemon error file, or null if missing/malformed. */
export function readServerError(): ServerStartError | null {
  try {
    const content = fs.readFileSync(SERVER_ERROR_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<ServerStartError>;
    if (typeof parsed.code === "string" && typeof parsed.message === "string") {
      return parsed as ServerStartError;
    }
  } catch {
    // Missing or malformed
  }
  return null;
}

/** Remove the daemon error file. */
export function removeServerError(): void {
  try {
    fs.unlinkSync(SERVER_ERROR_FILE);
  } catch {
    // Already removed — fine.
  }
}

// ─── Process helpers ─────────────────────────────────────────────

/**
 * Check if a process is alive by sending signal 0.
 * Signal 0 does nothing but validates that the process exists.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Millisecond sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Health endpoint ─────────────────────────────────────────────

interface HealthData {
  uptime: number;
  version: string;
  pid?: number;
}

/**
 * Attempt to ping the server's health endpoint.
 * Returns health data on success, null on any failure (timeout, refused, etc.).
 */
export async function pingHealthEndpoint(port: number): Promise<HealthData | null> {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_PING_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) return null;
      const body = (await resp.json()) as { data?: { uptime?: number; version?: string; pid?: number } };
      return {
        uptime: body.data?.uptime ?? 0,
        version: body.data?.version ?? "unknown",
        pid: body.data?.pid,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

// ─── Port resolution ─────────────────────────────────────────────

/** Get the configured server port (from tool config, default 5173). */
function getPort(): number {
  const configResult = readToolConfig();
  return configResult.ok ? configResult.value.port : 5173;
}

// ─── Daemon readiness polling ────────────────────────────────────

type DaemonReadyResult =
  | { status: "ready" }
  | { status: "eaddrinuse"; message: string; port: number }
  | { status: "crashed"; message: string }
  | { status: "timeout" };

/**
 * Poll for daemon readiness after spawn. Checks three conditions each cycle:
 * 1. Error file from daemon → startup failure (EADDRINUSE, etc.)
 * 2. Process died → crashed without writing error file
 * 3. Health endpoint responds → server is ready
 */
async function waitForDaemonReady(port: number, pid: number): Promise<DaemonReadyResult> {
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // 1. Check for error file
    const startError = readServerError();
    if (startError) {
      removeServerError();
      if (startError.code === "EADDRINUSE") {
        return { status: "eaddrinuse", message: startError.message, port: startError.port };
      }
      return { status: "crashed", message: startError.message };
    }

    // 2. Check if process died
    if (!isProcessAlive(pid)) {
      // Give a moment for error file to be written
      await sleep(100);
      const lateError = readServerError();
      if (lateError) {
        removeServerError();
        if (lateError.code === "EADDRINUSE") {
          return { status: "eaddrinuse", message: lateError.message, port: lateError.port };
        }
        return { status: "crashed", message: lateError.message };
      }
      return { status: "crashed", message: `Server process exited unexpectedly. Check ${SERVER_LOG_FILE}` };
    }

    // 3. Check health endpoint
    const health = await pingHealthEndpoint(port);
    if (health) {
      return { status: "ready" };
    }

    await sleep(DAEMON_READY_POLL_MS);
  }

  return { status: "timeout" };
}

// ─── Orphan detection helpers ────────────────────────────────────

/**
 * Kill a process by PID: SIGTERM → wait → SIGKILL if needed.
 * Returns true if the process was successfully killed.
 */
async function killProcess(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  const deadline = Date.now() + SIGTERM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(200);
  }

  // Force kill
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // May already be dead
  }
  await sleep(200);
  return !isProcessAlive(pid);
}

// ─── handleServerStart ───────────────────────────────────────────
//
// Start the ralph web server.
// --foreground (default in TTY): inherit stdio, block until process exits.
// --daemon: spawn detached, write state file, log to ~/.ralph/server.log.

export async function handleServerStart(ctx: CommandContext): Promise<number> {
  const foreground = extractBoolFlag(ctx.flags, "foreground");
  const daemon = extractBoolFlag(ctx.flags, "daemon");
  const portFlag = extractNumberFlag(ctx.flags, "port");
  const port = portFlag ?? getPort();

  // ── Check for existing server via state file ──────────────────
  const state = readServerState();
  if (state && isProcessAlive(state.pid)) {
    // PID is alive — verify it's actually our server via health probe
    const health = await pingHealthEndpoint(state.port);
    if (health) {
      // Genuinely running ralph server
      if (ctx.globalFlags.json) {
        outputJson({
          error: {
            code: "SERVER_ALREADY_RUNNING",
            message: `Server already running (PID ${state.pid})`,
          },
        });
      } else {
        error(`Server is already running (PID ${state.pid}).`);
        info(`Use ${c.cyan("ralph server stop")} to stop it first.`);
      }
      return ExitCode.CONFLICT;
    }
    // Health failed — PID reused by unrelated process. Clean up stale state.
    removeServerState();
  } else if (state) {
    // Stale state file (process is dead) — clean it up
    removeServerState();
  }

  // ── Check for orphaned ralph server on our target port ────────
  const portHealth = await pingHealthEndpoint(port);
  if (portHealth && portHealth.pid) {
    // Something is responding on our port with ralph health data — orphan
    if (!ctx.globalFlags.quiet) {
      info(`Detected orphaned ralph server (PID ${portHealth.pid}) on port ${port}. Cleaning up...`);
    }
    await killProcess(portHealth.pid);
    await sleep(500); // Wait for port release
  }

  // In dev mode, verify the server entry point exists
  if (!isCompiledBinary()) {
    const serverEntry = resolveServerEntry();
    if (!fs.existsSync(serverEntry)) {
      error(`Server entry point not found: ${serverEntry}`);
      info("Ensure the web package source is present or the binary is built.");
      return ExitCode.ERROR;
    }
  }

  // Choose mode: daemon beats foreground; non-TTY defaults to daemon
  const useDaemon = daemon || (!foreground && !process.stdout.isTTY);
  if (useDaemon) {
    return startDaemon(port, ctx);
  }
  return startForeground(port, ctx);
}

/** Start in foreground: spawn with inherited stdio, block until exit. */
function startForeground(port: number, ctx: CommandContext): number {
  if (!ctx.globalFlags.quiet) {
    print(`Starting Ralph server at ${c.cyan(`http://127.0.0.1:${port}`)}`);
    print(c.dim("Press Ctrl+C to stop."));
  }

  const { cmd, args } = getServerSpawnArgs(port);
  const result = child_process.spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env },
  });

  if (result.error) {
    error(`Failed to start server: ${result.error.message}`);
    return ExitCode.ERROR;
  }

  return (result.status ?? 0) === 0 ? ExitCode.SUCCESS : ExitCode.ERROR;
}

/** Start as daemon: spawn detached, redirect output to log file, write state, wait for readiness. */
async function startDaemon(port: number, ctx: CommandContext): Promise<number> {
  // Ensure ~/.ralph/ directory exists
  try {
    fs.mkdirSync(RALPH_CONFIG_DIR, { recursive: true });
  } catch (e) {
    error(`Failed to create config directory: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }

  // Clean up any stale error file before spawning
  removeServerError();

  // Open log file for appending (stdout + stderr both go here)
  let logFd: number;
  try {
    logFd = fs.openSync(SERVER_LOG_FILE, "a");
  } catch (e) {
    error(`Failed to open log file: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }

  // Spawn detached child — stdio uses the log fd
  const { cmd, args } = getServerSpawnArgs(port);
  const child = child_process.spawn(cmd, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });

  // Allow parent process to exit independently
  child.unref();

  // Close the fd in the parent (child keeps its own reference)
  fs.closeSync(logFd);

  if (child.pid === undefined) {
    error("Failed to start server daemon (no PID assigned).");
    return ExitCode.ERROR;
  }

  // Write server state immediately
  writeServerState({
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
  });

  // Wait for daemon to become ready
  const result = await waitForDaemonReady(port, child.pid);

  switch (result.status) {
    case "ready":
      if (ctx.globalFlags.json) {
        outputJson({
          running: true,
          pid: child.pid,
          port,
          url: `http://127.0.0.1:${port}`,
          logFile: SERVER_LOG_FILE,
        });
      } else {
        print(`${c.green("\u2713")} Ralph server started (PID ${child.pid})`);
        print(`  URL:  ${c.cyan(`http://127.0.0.1:${port}`)}`);
        print(`  Log:  ${SERVER_LOG_FILE}`);
        print(`  PID:  ${child.pid}`);
        print(`  Stop: ${c.cyan("ralph server stop")}`);
      }
      return ExitCode.SUCCESS;

    case "eaddrinuse":
      removeServerState();
      if (ctx.globalFlags.json) {
        outputJson({
          error: {
            code: "EADDRINUSE",
            message: `Port ${result.port} is already in use`,
          },
        });
      } else {
        error(`Port ${result.port} is already in use.`);
        print("  Options:");
        print("    1. Stop the other process");
        print(`    2. Use a different port: ${c.cyan(`ralph server start --port <N>`)}`);
        print(`    3. Update default port:  ${c.cyan("ralph config set port <N>")}`);
      }
      return ExitCode.ERROR;

    case "crashed":
      removeServerState();
      if (ctx.globalFlags.json) {
        outputJson({
          error: {
            code: "CRASHED",
            message: result.message,
          },
        });
      } else {
        error(`Server failed to start: ${result.message}`);
        info(`Check logs: ${c.cyan(`ralph server logs`)}`);
      }
      return ExitCode.ERROR;

    case "timeout":
      // Server may still be starting up — leave state file, warn user
      if (ctx.globalFlags.json) {
        outputJson({
          error: {
            code: "TIMEOUT",
            message: "Server started but health endpoint not responding within timeout",
          },
        });
      } else {
        error("Server started but health endpoint not responding within timeout.");
        info(`Check logs: ${c.cyan(`ralph server logs`)}`);
      }
      return ExitCode.ERROR;
  }
}

// ─── handleServerStop ────────────────────────────────────────────
//
// Stop the running server.
// Reads state from ~/.ralph/server.json, sends SIGTERM,
// waits up to 5s, then SIGKILL if still alive.

export async function handleServerStop(ctx: CommandContext): Promise<number> {
  const state = readServerState();

  // No state file, or process is already dead
  if (state === null || !isProcessAlive(state.pid)) {
    if (state !== null) {
      removeServerState(); // Clean up stale file
    }
    if (ctx.globalFlags.json) {
      outputJson({ running: false, message: "No server running" });
    } else {
      info("No server is currently running.");
    }
    return ExitCode.SUCCESS;
  }

  // Send SIGTERM for graceful shutdown
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (e) {
    error(`Failed to send SIGTERM to PID ${state.pid}: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }

  // Wait up to SIGTERM_TIMEOUT_MS for process to exit
  const deadline = Date.now() + SIGTERM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(state.pid)) break;
    await sleep(200);
  }

  // Force kill if graceful shutdown didn't work
  if (isProcessAlive(state.pid)) {
    try {
      process.kill(state.pid, "SIGKILL");
    } catch {
      // May already be dead
    }
    await sleep(200);
  }

  removeServerState();

  if (ctx.globalFlags.json) {
    outputJson({ running: false, pid: state.pid, message: "Server stopped" });
  } else {
    print(`${c.green("\u2713")} Server stopped (PID ${state.pid}).`);
  }

  return ExitCode.SUCCESS;
}

// ─── handleServerRestart ─────────────────────────────────────────
//
// Stop the server (if running), then start it again.

export async function handleServerRestart(ctx: CommandContext): Promise<number> {
  // Stop quietly so restart output is clean
  const quietCtx: CommandContext = {
    ...ctx,
    globalFlags: { ...ctx.globalFlags, quiet: true },
  };
  const stopCode = await handleServerStop(quietCtx);
  if (stopCode !== ExitCode.SUCCESS) {
    return stopCode;
  }
  return handleServerStart(ctx);
}

// ─── handleServerStatus ──────────────────────────────────────────
//
// Report whether the server is running: PID, port, uptime.

export async function handleServerStatus(ctx: CommandContext): Promise<number> {
  const state = readServerState();
  const port = state?.port ?? getPort();
  const pid = state?.pid ?? null;
  const alive = pid !== null && isProcessAlive(pid);

  // Clean up stale state file if process is dead
  if (state !== null && !alive) {
    removeServerState();
  }

  if (!alive) {
    if (ctx.globalFlags.json) {
      outputJson({ running: false, port });
    } else {
      print(`${c.red("\u25CF")} Server is ${c.bold("stopped")}`);
      print(`  Port: ${port}`);
      print(`  Start: ${c.cyan("ralph server start")}`);
    }
    return ExitCode.SUCCESS;
  }

  // Server is alive — try health endpoint for uptime/version
  const health = await pingHealthEndpoint(port);

  if (ctx.globalFlags.json) {
    outputJson({
      running: true,
      pid,
      port,
      url: `http://127.0.0.1:${port}`,
      uptime: health?.uptime ?? null,
      version: health?.version ?? null,
    });
    return ExitCode.SUCCESS;
  }

  print(`${c.green("\u25CF")} Server is ${c.bold("running")}`);
  print(`  PID:  ${pid}`);
  print(`  Port: ${port}`);
  print(`  URL:  ${c.cyan(`http://127.0.0.1:${port}`)}`);
  if (health !== null) {
    print(`  Uptime: ${formatUptime(health.uptime)}`);
    print(`  Version: ${health.version}`);
  }

  return ExitCode.SUCCESS;
}

// ─── handleServerLogs ────────────────────────────────────────────
//
// Show last N lines of ~/.ralph/server.log.

export async function handleServerLogs(ctx: CommandContext): Promise<number> {
  const tailN = extractNumberFlag(ctx.flags, "tail") ?? 50;

  if (!fs.existsSync(SERVER_LOG_FILE)) {
    if (ctx.globalFlags.json) {
      outputJson({ lines: [] });
    } else {
      info("No server log file found.");
      info(`Start the server with ${c.cyan("ralph server start --daemon")} to create a log.`);
    }
    return ExitCode.SUCCESS;
  }

  try {
    const content = fs.readFileSync(SERVER_LOG_FILE, "utf-8");
    const allLines = content.split("\n").filter((l) => l.length > 0);
    const tail = allLines.slice(-tailN);

    if (ctx.globalFlags.json) {
      outputJson({ lines: tail });
    } else {
      if (tail.length === 0) {
        info("Server log is empty.");
      } else {
        for (const line of tail) {
          print(line);
        }
      }
    }
    return ExitCode.SUCCESS;
  } catch (e) {
    error(`Failed to read server log: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }
}

// ─── Formatting helpers ──────────────────────────────────────────

/** Format uptime in seconds as a human-readable string. */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}
