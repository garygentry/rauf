import { ok, err, ErrorCodes } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnProcessGroup } from "../process-group.js";
import type { ClaudeStreamEvent } from "../stream-parser.js";
import { CodexStreamParser } from "./codex-jsonl-parser.js";
import { registerAgent, probeBinaryOnPath } from "./registry.js";
import type { LLMProvider, ExecuteOptions, ExecutionResult, DetectionResult } from "./types.js";

export const CODEX_AGENT_ID = "codex";
const CODEX_BINARY = "codex";

const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
export type CodexSandboxMode = (typeof SANDBOX_MODES)[number];

/**
 * Typed `providerConfig` surface for the `codex` agent (issues #93/#94). All fields are
 * optional; an absent/empty config preserves today's behavior EXCEPT for `networkAccess`,
 * whose default flipped to `true` (issue #93 — network-dependent loop work must work out of
 * the box, matching claude-cli's unconditional `--dangerously-skip-permissions` trust posture).
 */
export interface CodexProviderConfig {
  /** `--sandbox <mode>`. Default `"workspace-write"` (unchanged file-confinement default). */
  sandboxMode?: CodexSandboxMode;
  /**
   * Appends `-c sandbox_workspace_write.network_access=true` when the effective sandbox is
   * `"workspace-write"`. Default `true`. Set `false` to restore the pre-fix fully-restricted
   * behavior. Ignored for `"read-only"` (can't write at all) and `"danger-full-access"`
   * (network is already unrestricted).
   */
  networkAccess?: boolean;
  /** `--ask-for-approval <policy>`. Default `"never"`. */
  approvalPolicy?: string;
  /** Appended verbatim before `--model`/the trailing stdin marker, for flags this config doesn't model. */
  extraArgs?: string[];
}

/**
 * Validate an untyped `providerConfig` record into a {@link CodexProviderConfig} (mirrors
 * `configToCliAgentConfig` in `generic-cli.ts`: an expected `Result` error, never a throw, so a
 * malformed config is reported as VALIDATION_ERROR by the caller rather than crashing).
 */
export function parseCodexProviderConfig(
  raw?: Record<string, unknown>,
): Result<CodexProviderConfig> {
  if (!raw) return ok({});

  let sandboxMode: CodexSandboxMode | undefined;
  if (raw.sandboxMode !== undefined) {
    if (
      typeof raw.sandboxMode !== "string" ||
      !SANDBOX_MODES.includes(raw.sandboxMode as CodexSandboxMode)
    ) {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `codex provider config has invalid "sandboxMode" ${JSON.stringify(
          raw.sandboxMode,
        )} (expected one of ${SANDBOX_MODES.join(", ")})`,
      });
    }
    sandboxMode = raw.sandboxMode as CodexSandboxMode;
  }

  let networkAccess: boolean | undefined;
  if (raw.networkAccess !== undefined) {
    if (typeof raw.networkAccess !== "boolean") {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `codex provider config has invalid "networkAccess" ${JSON.stringify(
          raw.networkAccess,
        )} (expected a boolean)`,
      });
    }
    networkAccess = raw.networkAccess;
  }

  let approvalPolicy: string | undefined;
  if (raw.approvalPolicy !== undefined) {
    if (typeof raw.approvalPolicy !== "string" || raw.approvalPolicy.length === 0) {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `codex provider config has invalid "approvalPolicy" ${JSON.stringify(
          raw.approvalPolicy,
        )} (expected a non-empty string)`,
      });
    }
    approvalPolicy = raw.approvalPolicy;
  }

  let extraArgs: string[] | undefined;
  if (raw.extraArgs !== undefined) {
    if (!Array.isArray(raw.extraArgs) || raw.extraArgs.some((a) => typeof a !== "string")) {
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `codex provider config has invalid "extraArgs" (expected an array of strings)`,
      });
    }
    extraArgs = raw.extraArgs as string[];
  }

  return ok({
    ...(sandboxMode !== undefined ? { sandboxMode } : {}),
    ...(networkAccess !== undefined ? { networkAccess } : {}),
    ...(approvalPolicy !== undefined ? { approvalPolicy } : {}),
    ...(extraArgs !== undefined ? { extraArgs } : {}),
  });
}

/**
 * Dedicated Codex adapter (REQ-OBS-02 future-Codex note; supersedes the generic `CliAgent`
 * preset for `codex`). Two reasons it is its own provider rather than a {@link CliAgentConfig}:
 *
 * 1. **Correct argv.** Current Codex CLI (0.141.x) rejects `--ask-for-approval` AFTER the `exec`
 *    subcommand — it is a TOP-LEVEL flag — so the previous preset argv
 *    (`codex exec … --ask-for-approval never`) fails to parse (exit 2) and the loop never spawns.
 *    This provider builds `codex --ask-for-approval <policy> exec [--json] --sandbox <mode>
 *    [-c sandbox_workspace_write.network_access=true] [...extraArgs] [--model <m>] -` and
 *    delivers the prompt on stdin. Stdin avoids the per-argument OS limit that rejects large
 *    backlog/spec prompts with `E2BIG` before Codex can start. Sandbox/approval/network are
 *    configurable via {@link CodexProviderConfig} (issues #93/#94); network access defaults to
 *    ON so network-dependent loop work (installs, lockfiles, fetches) works out of the box,
 *    matching claude-cli's unconditional trust posture.
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

  constructor(private readonly config: CodexProviderConfig = {}) {}

  /** Build the argv. Global flags (`--ask-for-approval`) MUST precede the `exec` subcommand. */
  private buildArgv(options: ExecuteOptions): string[] {
    const stream = options.outputFormat === "stream-json";
    const sandboxMode = this.config.sandboxMode ?? "workspace-write";
    const networkAccess = this.config.networkAccess ?? true;
    const approvalPolicy = this.config.approvalPolicy ?? "never";

    const argv = ["--ask-for-approval", approvalPolicy, "exec"];
    if (stream) argv.push("--json");
    argv.push("--sandbox", sandboxMode);
    // The network-access override only applies to workspace-write: read-only can't write
    // regardless, and danger-full-access already has unrestricted network.
    if (sandboxMode === "workspace-write" && networkAccess) {
      argv.push("-c", "sandbox_workspace_write.network_access=true");
    }
    if (this.config.extraArgs) argv.push(...this.config.extraArgs);
    if (options.model) argv.push("--model", options.model);
    argv.push("-"); // explicit stdin prompt; never place unbounded prompt text in argv
    return argv;
  }

  async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>> {
    const stream = options.outputFormat === "stream-json";
    const argv = this.buildArgv(options);

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
      // Codex accepts `-` as the explicit stdin prompt. This avoids argv's per-argument size limit.
      stdin: prompt,
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

/**
 * Detect override (issue #94): with no config (enumeration, e.g. `rauf agents`), behave exactly
 * like the default PATH probe. With a `providerConfig` supplied (preflight before any loop
 * state/backlog mutation), validate it FIRST — mirrors `detectGenericCli`'s validate-before-run-
 * time pattern — so a malformed codex config fails setup with a clear message instead of
 * throwing later from `createProvider` mid-iteration.
 */
export async function detectCodexCli(config?: Record<string, unknown>): Promise<DetectionResult> {
  if (config !== undefined) {
    const parsed = parseCodexProviderConfig(config);
    if (!parsed.ok) return { available: false, detail: parsed.error.message };
  }
  return probeBinaryOnPath(CODEX_BINARY);
}

// Register codex as its own descriptor (default PATH probe of the `codex` binary). This OVERRIDES
// any earlier generic-preset registration for the same id (registry: last write wins), so codex is
// always driven through this telemetry-capable adapter.
registerAgent({
  id: CODEX_AGENT_ID,
  displayName: "Codex CLI",
  binaryName: CODEX_BINARY,
  factory: (config) => {
    const parsed = parseCodexProviderConfig(config);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return new CodexCliProvider(parsed.value);
  },
  detect: (config) => detectCodexCli(config),
});
