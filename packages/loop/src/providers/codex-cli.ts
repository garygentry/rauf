import { ok } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnProcessGroup } from "../process-group.js";
import type { ClaudeStreamEvent } from "../stream-parser.js";
import { CodexStreamParser } from "./codex-jsonl-parser.js";
import { registerAgent, probeBinaryOnPath } from "./registry.js";
import type { LLMProvider, ExecuteOptions, ExecutionResult } from "./types.js";

export const CODEX_AGENT_ID = "codex";
const CODEX_BINARY = "codex";

/**
 * Dedicated Codex adapter (REQ-OBS-02 future-Codex note; supersedes the generic `CliAgent`
 * preset for `codex`). Two reasons it is its own provider rather than a {@link CliAgentConfig}:
 *
 * 1. **Correct argv.** Current Codex CLI (0.141.x) rejects `--ask-for-approval` AFTER the `exec`
 *    subcommand — it is a TOP-LEVEL flag — so the previous preset argv
 *    (`codex exec … --ask-for-approval never`) fails to parse (exit 2) and the loop never spawns.
 *    This provider builds `codex --ask-for-approval never exec [--json] --sandbox workspace-write
 *    [--model <m>] <prompt>`, validated end-to-end against codex 0.141.0.
 * 2. **JSONL telemetry.** In `stream-json` mode it adds `--json` and parses the JSON Lines event
 *    stream ({@link CodexStreamParser}) into the runner's `tool_start`/`tool_end`/`token_update`
 *    events and a reconstructed final message — telemetry the generic plain-text `CliAgent`
 *    cannot produce. Plain-text mode (no `--json`) is the graceful fallback.
 *
 * Deliberately omits `checkUsage` (codex has no Anthropic usage semantics — the runner's
 * non-`checkUsage` degradation path applies) and `dispose` (nothing persistent).
 */
export class CodexCliProvider implements LLMProvider {
  readonly id = CODEX_AGENT_ID;
  readonly displayName = "Codex CLI";

  /** Build the argv. Global flags (`--ask-for-approval`) MUST precede the `exec` subcommand. */
  private buildArgv(prompt: string, options: ExecuteOptions): string[] {
    const stream = options.outputFormat === "stream-json";
    const argv = ["--ask-for-approval", "never", "exec"];
    if (stream) argv.push("--json");
    argv.push("--sandbox", "workspace-write");
    if (options.model) argv.push("--model", options.model);
    argv.push(prompt); // prompt delivered as the trailing positional arg
    return argv;
  }

  async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>> {
    const stream = options.outputFormat === "stream-json";
    const argv = this.buildArgv(prompt, options);

    // stream-json: line-split stdout into the JSONL parser, firing onStreamEvent in real time.
    let parser: CodexStreamParser | undefined;
    let lineBuf = "";
    if (stream) {
      parser = new CodexStreamParser((event: ClaudeStreamEvent) => {
        if (options.onStreamEvent) {
          try {
            options.onStreamEvent(event);
          } catch {
            // Stream callbacks must never crash the loop.
          }
        }
      });
    }

    const res = await spawnProcessGroup(CODEX_BINARY, argv, {
      cwd: process.cwd(), // REQ-SEC-01: agent runs at the project root (sandbox boundary)
      timeoutMs: options.timeoutMinutes * 60 * 1000,
      signal: options.signal,
      ...(options.env ? { env: options.env } : {}),
      // Close stdin: `codex exec` otherwise blocks "Reading additional input from stdin…".
      stdin: "",
      ...(parser
        ? {
            onStdout: (chunk: Buffer) => {
              lineBuf += chunk.toString("utf-8");
              const lines = lineBuf.split("\n");
              lineBuf = lines.pop()!; // keep the incomplete trailing line
              for (const line of lines) {
                if (line.trim()) parser!.feed(line);
              }
            },
          }
        : {}),
    });
    if (!res.ok) return res; // spawn failure → err(FILE_NOT_FOUND)

    // Flush a trailing partial line.
    if (parser && lineBuf.trim()) parser.feed(lineBuf);

    const { exitCode, stdout, stderr, timedOut, durationMs } = res.value;
    if (parser) {
      // reconstructedText drives signal parsing — with --json, stdout is JSONL, not the bare
      // final message, so reconstruction from agent_message items is REQUIRED.
      return ok({
        stdout,
        stderr,
        exitCode,
        timedOut,
        durationMs,
        reconstructedText: parser.getReconstructedText(),
      });
    }
    return ok({ stdout, stderr, exitCode, timedOut, durationMs });
  }

  validateCredentials(): Result<void> {
    // PATH/availability is verified pre-loop by the registry descriptor's detect probe.
    return ok(undefined);
  }
}

// Register codex as its own descriptor (default PATH probe of the `codex` binary). This OVERRIDES
// any earlier generic-preset registration for the same id (registry: last write wins), so codex is
// always driven through this telemetry-capable adapter.
registerAgent({
  id: CODEX_AGENT_ID,
  displayName: "Codex CLI",
  binaryName: CODEX_BINARY,
  factory: () => new CodexCliProvider(),
  detect: () => probeBinaryOnPath(CODEX_BINARY),
});
