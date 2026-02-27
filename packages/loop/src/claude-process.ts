import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import type { Result } from "@ralph/core";
import { ok, err, ErrorCodes } from "@ralph/core";

const GRACE_PERIOD_MS = 30_000; // 30s between SIGTERM and SIGKILL

export interface SpawnClaudeOptions {
  sessionTimeoutMinutes: number;
  model?: string;
  signal?: AbortSignal;
}

export interface SpawnClaudeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Sends a signal to a process tree. Uses negative PID to kill the
 * process group when the process was spawned with `detached: true`.
 */
function killTree(proc: ChildProcess, signal: NodeJS.Signals): void {
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
 * Spawns `claude -p` as a child process with the prompt piped via stdin.
 *
 * Always passes `--dangerously-skip-permissions` and `--output-format text`
 * flags (required for headless autonomous operation).
 *
 * Implements configurable timeout: SIGTERM → 30s grace → SIGKILL.
 * Supports external cancellation via AbortController signal.
 */
export async function spawnClaude(
  prompt: string,
  options: SpawnClaudeOptions,
): Promise<Result<SpawnClaudeResult>> {
  const args = ["-p", "--dangerously-skip-permissions", "--output-format", "text"];

  if (options.model) {
    args.push("--model", options.model);
  }

  const timeoutMs = options.sessionTimeoutMinutes * 60 * 1000;
  const startTime = Date.now();

  let proc: ChildProcess;
  try {
    proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // Create process group for clean tree kills
    });
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Failed to spawn claude: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return new Promise<Result<SpawnClaudeResult>>((resolve) => {
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

    // Handle spawn error (e.g., ENOENT when claude binary not found)
    proc.on("error", (e) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(
        err({
          code: ErrorCodes.FILE_NOT_FOUND,
          message: `Failed to spawn claude: ${e.message}`,
        }),
      );
    });

    // Capture stdout and stderr
    proc.stdout!.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Handle process exit
    proc.on("close", (code) => {
      finish(code ?? 1);
    });

    // Pipe prompt to stdin and close; ignore EPIPE if process exits early
    proc.stdin!.on("error", () => {
      // EPIPE is expected when process exits before reading all stdin
    });
    proc.stdin!.write(prompt);
    proc.stdin!.end();

    // Set up timeout
    timers.timeout = setTimeout(() => {
      killGracefully();
    }, timeoutMs);

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
