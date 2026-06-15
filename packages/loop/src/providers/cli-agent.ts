import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";

import { ok, err, ErrorCodes } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnProcessGroup } from "../process-group.js";
import type { LLMProvider, ExecuteOptions, ExecutionResult } from "./types.js";

/**
 * How the prompt is delivered to the agent's CLI (`00-core-definitions.md §3.2`):
 * - `"stdin"` — piped to the child's stdin.
 * - `"arg"` — appended as the final argv element.
 * - `"file"` — written to a temp file inside the sandbox cwd, its path placed in argv.
 */
export type PromptDelivery = "stdin" | "arg" | "file";

/** Context handed to {@link CliAgentConfig.buildArgs} (`00-core-definitions.md §3.2`). */
export interface BuildArgsContext {
  /** Resolved model string, if any (the runner already resolved precedence). */
  model?: string;
  /** Absolute path to the temp prompt file — set only for `promptDelivery === "file"`. */
  promptFile?: string;
}

/**
 * Declarative invocation contract for one CLI coding agent (`00-core-definitions.md §3.2`).
 * Plain data consumed by {@link CliAgent}; carries no orchestration code (REQ-SCALE-01).
 */
export interface CliAgentConfig {
  /** Stable agent id (= the provider id, e.g. "codex"). */
  id: string;
  /** Human-readable name for help/discovery. */
  displayName: string;
  /** Executable name or path to spawn. */
  binary: string;
  /** Subcommand/positional args (no prompt, no model flags — the engine adds those). */
  buildArgs(ctx: BuildArgsContext): string[];
  /** How the prompt reaches the agent. */
  promptDelivery: PromptDelivery;
  /** Flags that force auto-approve / non-interactive operation; always appended (REQ-EXEC-01). */
  nonInteractive: string[];
  /** Translates a resolved model string into argv flags. Omitted ⇒ agent uses its default model. */
  modelFlag?(model: string): string[];
  /** Static env overrides merged over `process.env` (and under `options.env`). */
  env?: Record<string, string>;
  /** Always false/omitted: CliAgent is plain-text only, never stream-parsed (REQ-OBS-02). */
  parsesStream?: false;
}

/** Best-effort unlink that never throws (`03-cli-agent-engine-and-presets.md §4.3`). */
async function unlinkBestEffort(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch {
    // Swallow cleanup failures — never fail the iteration over a leftover temp file.
  }
}

/**
 * Write the prompt to a collision-resistant temp file INSIDE the sandbox working directory
 * (cwd === ROOT_DIRECTORY) so it never escapes rauf's path-sandboxing (REQ-SEC-01).
 */
async function writePromptToSandboxTempFile(prompt: string): Promise<Result<string>> {
  const name = `.rauf-prompt-${process.pid}-${Math.random().toString(36).slice(2)}.txt`;
  const file = path.resolve(process.cwd(), name);
  try {
    await writeFile(file, prompt, "utf-8");
    return ok(file);
  } catch (e) {
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `Failed to write prompt temp file ${file}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }
}

/**
 * Config-driven CLI coding-agent adapter (REQ-ADP-02, tech-spec §3.4, OQ-3).
 *
 * One engine backs every non-claude CLI agent: the named presets
 * (`codex`/`gemini`/`copilot`/`cursor`, see {@link ./presets.ts}) and the configurable
 * `generic-cli` adapter ({@link ./generic-cli.ts}). All invocation specifics come from the
 * supplied {@link CliAgentConfig}; this class contains no agent-specific knowledge (REQ-SCALE-01).
 *
 * The agent is always driven in plain-text mode (no stream parsing): the returned
 * {@link ExecutionResult} leaves `reconstructedText`, `parsedSignal`, and `progressEvents` unset,
 * so token/tool telemetry is gracefully absent without error (REQ-OBS-02, REQ-SIG-02).
 *
 * Deliberately implements ONLY `id`, `displayName`, `execute`, and `validateCredentials` — no
 * `checkUsage` (load-bearing: the runner gates all Anthropic usage handling on `checkUsage` being
 * defined, REQ-USAGE-02) and no `dispose` (nothing persistent to release).
 */
export class CliAgent implements LLMProvider {
  /** Stable agent id (= the `provider` value, e.g. "codex"). From `config.id`. */
  readonly id: string;
  /** Human-readable name for help/discovery. From `config.displayName`. */
  readonly displayName: string;

  /** @param config Declarative invocation contract (`00-core-definitions.md §3.2`). */
  constructor(private readonly config: CliAgentConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
  }

  async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>> {
    const delivery = this.config.promptDelivery;

    let promptFile: string | undefined;
    if (delivery === "file") {
      const written = await writePromptToSandboxTempFile(prompt);
      if (!written.ok) return written; // temp-file write failure -> err(IO_ERROR)
      promptFile = written.value;
    }

    try {
      const ctx: BuildArgsContext = { model: options.model, promptFile };
      const argv = [
        ...this.config.buildArgs(ctx),
        ...this.config.nonInteractive,
        ...(options.model && this.config.modelFlag ? this.config.modelFlag(options.model) : []),
      ];
      if (delivery === "arg") argv.push(prompt);

      const res = await spawnProcessGroup(this.config.binary, argv, {
        timeoutMs: options.timeoutMinutes * 60 * 1000,
        signal: options.signal,
        // Runner-supplied child env (options.env) is merged OVER the adapter's static config.env
        // so the runner's childEnv reaches every agent uniformly (00 §7, 05 §3.1).
        env: this.config.env || options.env ? { ...this.config.env, ...options.env } : undefined,
        stdin: delivery === "stdin" ? prompt : undefined,
      });
      if (!res.ok) return res; // spawn failure -> err(FILE_NOT_FOUND)

      const { exitCode, stdout, stderr, timedOut, durationMs } = res.value;
      // reconstructedText / parsedSignal / progressEvents intentionally UNSET (plain-text path).
      return ok({ stdout, stderr, exitCode, timedOut, durationMs });
    } finally {
      if (promptFile) await unlinkBestEffort(promptFile);
    }
  }

  validateCredentials(): Result<void> {
    // Availability/PATH is verified pre-loop by the registry's descriptor detect probe
    // (02-agent-registry-and-detection.md). A bare CliAgent has no credentials to validate.
    return ok(undefined);
  }

  // NOTE: no `checkUsage` — intentional (REQ-USAGE-02). No `dispose` — nothing to release.
}
