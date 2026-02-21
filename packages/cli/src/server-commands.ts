// ─── Server Management Command Handlers ──────────────────────────
//
// Implements: ralph server start/stop/restart/status/logs
//
// Server lifecycle:
//   --foreground: inherit stdio, block until exit (default in TTY)
//   --daemon:     spawn detached, write PID to ~/.ralph/server.pid,
//                 redirect stdio to ~/.ralph/server.log
//
// Process health:
//   PID file check + process.kill(pid, 0) for liveness
//   Optional health endpoint ping for uptime/version

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
export const SERVER_PID_FILE = path.join(RALPH_CONFIG_DIR, "server.pid");
export const SERVER_LOG_FILE = path.join(RALPH_CONFIG_DIR, "server.log");
const SIGTERM_TIMEOUT_MS = 5000;
const HEALTH_PING_TIMEOUT_MS = 2000;

// ─── Path resolution ─────────────────────────────────────────────

/**
 * Resolve the web server entry point relative to this file.
 * walks: packages/cli/src/ → packages/ → repo root → packages/web/src/server/index.ts
 */
export function resolveServerEntry(): string {
  const thisFile = new URL(import.meta.url).pathname;
  const cliSrc = path.dirname(thisFile);      // packages/cli/src
  const cliPkg = path.dirname(cliSrc);        // packages/cli
  const packages = path.dirname(cliPkg);      // packages
  const repoRoot = path.dirname(packages);    // repo root
  return path.join(repoRoot, "packages", "web", "src", "server", "index.ts");
}

// ─── PID file helpers ─────────────────────────────────────────────

/** Read the stored PID, or null if file missing/invalid. */
export function readPidFile(): number | null {
  try {
    const content = fs.readFileSync(SERVER_PID_FILE, "utf-8").trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** Write a PID to the server PID file, creating ~/.ralph/ if needed. */
export function writePidFile(pid: number): void {
  fs.mkdirSync(RALPH_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SERVER_PID_FILE, String(pid), "utf-8");
}

/** Remove the server PID file (silently ignore if already gone). */
export function removePidFile(): void {
  try {
    fs.unlinkSync(SERVER_PID_FILE);
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
      const body = (await resp.json()) as { data?: { uptime?: number; version?: string } };
      return {
        uptime: body.data?.uptime ?? 0,
        version: body.data?.version ?? "unknown",
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

// ─── handleServerStart ───────────────────────────────────────────
//
// Start the ralph web server.
// --foreground (default in TTY): inherit stdio, block until process exits.
// --daemon: spawn detached, write PID file, log to ~/.ralph/server.log.

export async function handleServerStart(ctx: CommandContext): Promise<number> {
  const foreground = extractBoolFlag(ctx.flags, "foreground");
  const daemon = extractBoolFlag(ctx.flags, "daemon");
  const portFlag = extractNumberFlag(ctx.flags, "port");
  const port = portFlag ?? getPort();

  // Check for an existing running server
  const existingPid = readPidFile();
  if (existingPid !== null && isProcessAlive(existingPid)) {
    if (ctx.globalFlags.json) {
      outputJson({
        error: {
          code: "SERVER_ALREADY_RUNNING",
          message: `Server already running (PID ${existingPid})`,
        },
      });
    } else {
      error(`Server is already running (PID ${existingPid}).`);
      info(`Use ${c.cyan("ralph server stop")} to stop it first.`);
    }
    return ExitCode.CONFLICT;
  }

  // Stale PID file (process is dead) — clean it up
  if (existingPid !== null) {
    removePidFile();
  }

  // Verify server entry point exists
  const serverEntry = resolveServerEntry();
  if (!fs.existsSync(serverEntry)) {
    error(`Server entry point not found: ${serverEntry}`);
    info("Ensure the web package source is present or the binary is built.");
    return ExitCode.ERROR;
  }

  // Choose mode: daemon beats foreground; non-TTY defaults to daemon
  const useDaemon = daemon || (!foreground && !process.stdout.isTTY);
  if (useDaemon) {
    return startDaemon(serverEntry, port, ctx);
  }
  return startForeground(serverEntry, port, ctx);
}

/** Start in foreground: spawn bun with inherited stdio, block until exit. */
function startForeground(serverEntry: string, port: number, ctx: CommandContext): number {
  if (!ctx.globalFlags.quiet) {
    print(`Starting Ralph server at ${c.cyan(`http://127.0.0.1:${port}`)}`);
    print(c.dim("Press Ctrl+C to stop."));
  }

  const result = child_process.spawnSync("bun", ["run", serverEntry], {
    stdio: "inherit",
    env: { ...process.env },
  });

  if (result.error) {
    error(`Failed to start server: ${result.error.message}`);
    return ExitCode.ERROR;
  }

  return (result.status ?? 0) === 0 ? ExitCode.SUCCESS : ExitCode.ERROR;
}

/** Start as daemon: spawn detached, redirect output to log file, write PID. */
function startDaemon(serverEntry: string, port: number, ctx: CommandContext): number {
  // Ensure ~/.ralph/ directory exists
  try {
    fs.mkdirSync(RALPH_CONFIG_DIR, { recursive: true });
  } catch (e) {
    error(`Failed to create config directory: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }

  // Open log file for appending (stdout + stderr both go here)
  let logFd: number;
  try {
    logFd = fs.openSync(SERVER_LOG_FILE, "a");
  } catch (e) {
    error(`Failed to open log file: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }

  // Spawn detached child — stdio uses the log fd
  const child = child_process.spawn("bun", ["run", serverEntry], {
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

  writePidFile(child.pid);

  if (ctx.globalFlags.json) {
    outputJson({
      running: true,
      pid: child.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      logFile: SERVER_LOG_FILE,
    });
  } else {
    print(`${c.green("✓")} Ralph server started (PID ${child.pid})`);
    print(`  URL:  ${c.cyan(`http://127.0.0.1:${port}`)}`);
    print(`  Log:  ${SERVER_LOG_FILE}`);
    print(`  PID:  ${child.pid}`);
    print(`  Stop: ${c.cyan("ralph server stop")}`);
  }

  return ExitCode.SUCCESS;
}

// ─── handleServerStop ────────────────────────────────────────────
//
// Stop the running server.
// Reads PID from ~/.ralph/server.pid, sends SIGTERM,
// waits up to 5s, then SIGKILL if still alive.

export async function handleServerStop(ctx: CommandContext): Promise<number> {
  const pid = readPidFile();

  // No PID file, or process is already dead
  if (pid === null || !isProcessAlive(pid)) {
    if (pid !== null) {
      removePidFile(); // Clean up stale file
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
    process.kill(pid, "SIGTERM");
  } catch (e) {
    error(`Failed to send SIGTERM to PID ${pid}: ${e instanceof Error ? e.message : String(e)}`);
    return ExitCode.ERROR;
  }

  // Wait up to SIGTERM_TIMEOUT_MS for process to exit
  const deadline = Date.now() + SIGTERM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) break;
    await sleep(200);
  }

  // Force kill if graceful shutdown didn't work
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // May already be dead
    }
    await sleep(200);
  }

  removePidFile();

  if (ctx.globalFlags.json) {
    outputJson({ running: false, pid, message: "Server stopped" });
  } else {
    print(`${c.green("✓")} Server stopped (PID ${pid}).`);
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
  const port = getPort();
  const pid = readPidFile();
  const alive = pid !== null && isProcessAlive(pid);

  // Clean up stale PID file if process is dead
  if (pid !== null && !alive) {
    removePidFile();
  }

  if (!alive) {
    if (ctx.globalFlags.json) {
      outputJson({ running: false, port });
    } else {
      print(`${c.red("●")} Server is ${c.bold("stopped")}`);
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

  print(`${c.green("●")} Server is ${c.bold("running")}`);
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
