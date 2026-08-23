import type { Result } from "@rauf/core";
import { ok } from "@rauf/core";

import { spawnProcessGroup, GRACE_PERIOD_MS } from "./process-group.js";
import { StreamParser, type AgentStreamEvent } from "./stream-parser.js";

// Re-exported for backwards compatibility; the canonical definition lives in process-group.ts.
export { GRACE_PERIOD_MS };

export interface SpawnClaudeOptions {
  sessionTimeoutMinutes: number;
  model?: string;
  signal?: AbortSignal;
  outputFormat?: "text" | "stream-json";
  onStreamEvent?: (event: AgentStreamEvent) => void;
  /**
   * Environment variable overrides for the child process. When provided, these
   * are merged over the parent `process.env`. When omitted, the child inherits
   * the parent environment unchanged (default behavior).
   */
  env?: Record<string, string>;
}

export interface SpawnClaudeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  reconstructedText?: string;
}

/**
 * Spawns `claude -p` as a child process with the prompt piped via stdin.
 *
 * Always passes `--dangerously-skip-permissions` flag (required for headless
 * autonomous operation).
 *
 * When `outputFormat` is `"stream-json"`, pipes stdout through a line splitter
 * into StreamParser and fires `onStreamEvent` callbacks in real time. The
 * `reconstructedText` field on the result contains the same text that
 * `--output-format text` would have produced.
 *
 * Implements configurable timeout: SIGTERM → 30s grace → SIGKILL.
 * Supports external cancellation via AbortController signal.
 *
 * All process plumbing (detached group spawn, timeout/kill escalation, abort
 * handling, EPIPE-tolerant stdin) is delegated to `spawnProcessGroup`.
 */
export async function spawnClaude(
  prompt: string,
  options: SpawnClaudeOptions,
): Promise<Result<SpawnClaudeResult>> {
  const format = options.outputFormat ?? "text";
  const args = ["-p", "--dangerously-skip-permissions", "--output-format", format];

  if (format === "stream-json") {
    args.push("--verbose");
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  // Stream-json mode: line splitter + parser
  let parser: StreamParser | undefined;
  let lineBuf = "";

  if (format === "stream-json") {
    parser = new StreamParser((event) => {
      if (options.onStreamEvent) {
        try {
          options.onStreamEvent(event);
        } catch {
          // Stream parse callbacks must never crash the loop
        }
      }
    });
  }

  const timeoutMs = options.sessionTimeoutMinutes * 60 * 1000;

  const res = await spawnProcessGroup("claude", args, {
    timeoutMs,
    signal: options.signal,
    ...(options.env ? { env: options.env } : {}),
    stdin: prompt,
    ...(parser
      ? {
          onStdout: (chunk: Buffer) => {
            lineBuf += chunk.toString("utf-8");
            const lines = lineBuf.split("\n");
            lineBuf = lines.pop()!; // keep incomplete trailing line
            for (const line of lines) {
              if (line.trim()) {
                parser!.feed(line);
              }
            }
          },
        }
      : {}),
  });

  if (!res.ok) return res;

  // Flush any remaining partial line in stream-json mode
  if (parser && lineBuf.trim()) {
    parser.feed(lineBuf);
    lineBuf = "";
  }

  const { exitCode, stdout, stderr, timedOut, durationMs } = res.value;
  const result: SpawnClaudeResult = {
    exitCode,
    stdout,
    stderr,
    timedOut,
    durationMs,
  };

  if (parser) {
    result.reconstructedText = parser.getReconstructedText();
  }

  return ok(result);
}
