import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import type { Result } from "@rauf/core";
import { ok, err, ErrorCodes } from "@rauf/core";

/** Grace period between SIGTERM and SIGKILL (moved from claude-process.ts). */
export const GRACE_PERIOD_MS = 30_000; // 30s between SIGTERM and SIGKILL

/** Options for {@link spawnProcessGroup}. */
export interface SpawnProcessGroupOptions {
  /** Hard timeout in milliseconds. On expiry: SIGTERM → GRACE_PERIOD_MS → SIGKILL on the group. */
  timeoutMs: number;
  /** External cancellation. On abort the process group receives SIGTERM. */
  signal?: AbortSignal;
  /**
   * Working directory for the spawned process. When omitted the child inherits the parent
   * process cwd (the runner's ROOT_DIRECTORY) — mirroring spawnClaude's inherited-cwd behavior.
   */
  cwd?: string;
  /** Env overrides merged over `process.env`; when omitted the child inherits the parent env. */
  env?: Record<string, string>;
  /** Use `env` as the complete child environment instead of merging it over `process.env`. */
  replaceEnv?: boolean;
  /** When set, written to the child's stdin then closed (EPIPE ignored). Omit for no stdin input. */
  stdin?: string;
  /**
   * Optional per-stdout-chunk hook (used by claude-process for stream parsing). Plain-text
   * consumers omit it and read only the final aggregated `stdout`.
   */
  onStdout?: (chunk: Buffer) => void;
}

/** Aggregated outcome of a spawned process group. */
export interface ProcessGroupResult {
  /** Process exit code (the close-event code, defaulting to 1 when null). */
  exitCode: number;
  /** Full captured stdout (UTF-8). */
  stdout: string;
  /** Full captured stderr (UTF-8). */
  stderr: string;
  /** True when the process was terminated by the timeout. */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/**
 * Sends a signal to a process tree. Uses negative PID to kill the
 * process group when the process was spawned with `detached: true`.
 */
export function killTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (proc.pid === undefined) return;
  try {
    // Kill the process group (negative pid)
    process.kill(-proc.pid, signal);
  } catch {
    // Process/group may have already exited
    try {
      proc.kill(signal);
    } catch {
      // Already dead
    }
  }
}

/**
 * Spawn `cmd args` as a detached process group, capture stdout/stderr, enforce a timeout with a
 * SIGTERM→grace→SIGKILL escalation on the whole group (negative PID), and honor an AbortSignal.
 * Resolves with `ok(ProcessGroupResult)` on any process exit (including nonzero / timeout), or
 * `err(FILE_NOT_FOUND)` when the binary cannot be spawned (ENOENT / synchronous spawn throw).
 * Never throws for expected errors.
 */
export async function spawnProcessGroup(
  cmd: string,
  args: string[],
  options: SpawnProcessGroupOptions,
): Promise<Result<ProcessGroupResult>> {
  const startTime = Date.now();

  let proc: ChildProcess;
  try {
    proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // Create process group for clean tree kills
      ...(options.cwd ? { cwd: options.cwd } : {}),
      // Only override env when explicit overrides are supplied; otherwise let
      // the child inherit the parent environment as-is (default behavior).
      ...(options.env
        ? { env: options.replaceEnv ? options.env : { ...process.env, ...options.env } }
        : {}),
    });
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to spawn ${cmd}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return new Promise<Result<ProcessGroupResult>>((resolve) => {
    let resolved = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timers: {
      timeout?: ReturnType<typeof setTimeout>;
      grace?: ReturnType<typeof setTimeout>;
    } = {};

    function finish(exitCode: number) {
      if (resolved) return;
      resolved = true;
      cleanup();

      const durationMs = Date.now() - startTime;
      resolve(
        ok({
          exitCode,
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          timedOut,
          durationMs,
        }),
      );
    }

    function cleanup() {
      if (timers.timeout !== undefined) clearTimeout(timers.timeout);
      if (timers.grace !== undefined) clearTimeout(timers.grace);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }

    function killGracefully() {
      timedOut = true;
      killTree(proc, "SIGTERM");
      timers.grace = setTimeout(() => {
        killTree(proc, "SIGKILL");
      }, GRACE_PERIOD_MS);
    }

    function onAbort() {
      if (resolved) return;
      killTree(proc, "SIGTERM");
    }

    // Handle spawn error (e.g., ENOENT when binary not found)
    proc.on("error", (e) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(
        err({
          code: ErrorCodes.FILE_NOT_FOUND,
          message: `Failed to spawn ${cmd}: ${e.message}`,
        }),
      );
    });

    // Capture stdout (and forward chunks to the optional hook)
    proc.stdout!.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (options.onStdout) {
        options.onStdout(chunk);
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Handle process exit
    proc.on("close", (code) => {
      finish(code ?? 1);
    });

    // Pipe stdin (when supplied) and close; ignore EPIPE if process exits early
    proc.stdin!.on("error", () => {
      // EPIPE is expected when process exits before reading all stdin
    });
    if (options.stdin !== undefined) {
      proc.stdin!.write(options.stdin);
    }
    proc.stdin!.end();

    // Set up timeout
    timers.timeout = setTimeout(() => {
      killGracefully();
    }, options.timeoutMs);

    // Set up abort signal listener
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort);
      }
    }
  });
}
