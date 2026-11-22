import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { ok } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnProcessGroup } from "../process-group.js";
import { classifyCopilotFailure } from "./copilot-failure-classifier.js";
import { CopilotJsonlParser } from "./copilot-jsonl-parser.js";
import { probeBinaryOnPath, registerAgent } from "./registry.js";
import type {
  ExecuteOptions,
  ExecutionResult,
  LLMProvider,
  ProviderFailureClassification,
} from "./types.js";

export const COPILOT_AGENT_ID = "copilot";
const COPILOT_BINARY = "copilot";
const PROMPT_DIRECTORY_PREFIX = ".rauf-copilot-prompt-";
const PROMPT_FILENAME = "prompt.md";

const COPILOT_FLAGS = [
  "--no-auto-update",
  "--output-format",
  "json",
  "--stream",
  "on",
  "--allow-tool=read",
  "--allow-tool=write",
  "--allow-tool=shell",
  "--deny-tool=shell(git commit:*)",
  "--deny-tool=shell(git push:*)",
  "--no-ask-user",
  "--no-remote-export",
  "--no-custom-instructions",
  "--disable-builtin-mcps",
] as const;

/**
 * Copilot CLI 1.0.114 removed `--no-remote` and now rejects it at argument parsing
 * (`error: --no-remote was removed. Use /remote off in a session…`, exit 1), so passing
 * it unconditionally fails every spawn. Older CLIs (1.0.78+) still accept it and it
 * keeps a loop iteration from being exposed for remote control, so rauf passes it only
 * when the CLI about to run parses it: `copilot --no-auto-update --no-remote --help`
 * exits 0 without a removal/unknown-option complaint. Probed on EVERY iteration with
 * that iteration's cwd and environment (~0.2 s), so a CLI that changes version mid-run,
 * or a PATH override that selects another binary, is seen. A probe that cannot run
 * (spawn error, timeout, abort) omits the flag: a rejected flag fails every iteration,
 * while an omitted one only forgoes an opt-out the newer CLI no longer offers.
 */
const NO_REMOTE_PROBE_TIMEOUT_MS = 15_000;
const NO_REMOTE_REJECTED = /was removed|unknown option|unexpected argument/i;

export interface NoRemoteProbeOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export function probeNoRemoteSupport(
  binary: string = COPILOT_BINARY,
  options: NoRemoteProbeOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    // A holder, not a `let`: finish() can run on the early-return paths before the timer exists.
    const pending: { timer?: ReturnType<typeof setTimeout> } = {};
    let stderr = "";
    const finish = (supported: boolean): void => {
      if (settled) return;
      settled = true;
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(supported);
    };
    let child: ReturnType<typeof spawn>;
    const onAbort = (): void => {
      child?.kill("SIGKILL");
      finish(false);
    };
    if (options.signal?.aborted) return finish(false);
    try {
      child = spawn(binary, ["--no-auto-update", "--no-remote", "--help"], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      return finish(false);
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    pending.timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, NO_REMOTE_PROBE_TIMEOUT_MS);
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf-8");
    });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && !NO_REMOTE_REJECTED.test(stderr)));
  });
}

export interface CopilotCliProviderOptions {
  /** Whether the CLI about to run accepts `--no-remote` (default: probed per iteration). */
  supportsNoRemote?: (options: NoRemoteProbeOptions) => Promise<boolean>;
}

export class CopilotCliProvider implements LLMProvider {
  readonly id = COPILOT_AGENT_ID;
  readonly displayName = "GitHub Copilot CLI";
  readonly #supportsNoRemote: (options: NoRemoteProbeOptions) => Promise<boolean>;

  constructor(options: CopilotCliProviderOptions = {}) {
    this.#supportsNoRemote =
      options.supportsNoRemote ?? ((probe) => probeNoRemoteSupport(COPILOT_BINARY, probe));
  }

  async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>> {
    const cwd = process.cwd();
    const promptDirectory = await mkdtemp(join(cwd, PROMPT_DIRECTORY_PREFIX));
    const promptPath = join(promptDirectory, PROMPT_FILENAME);

    try {
      await writeFile(promptPath, prompt, { encoding: "utf-8", mode: 0o600 });
      const promptReference = relative(cwd, promptPath);
      const bootstrap = `Read the complete instructions from ${promptReference}, follow them, and do not modify that file.`;
      const flags: string[] = [...COPILOT_FLAGS.slice(1)];
      const env = sanitizedEnvironment(options.env);
      if (await this.#supportsNoRemote({ cwd, env, signal: options.signal })) {
        flags.splice(flags.indexOf("--no-remote-export"), 0, "--no-remote");
      }
      const argv = ["--no-auto-update", "-C", cwd, ...flags];
      if (options.model) argv.push("--model", options.model);
      argv.push("--prompt", bootstrap);

      const parser = new CopilotJsonlParser((event) => options.onStreamEvent?.(event));
      let result: Awaited<ReturnType<typeof spawnProcessGroup>>;
      try {
        result = await spawnProcessGroup(COPILOT_BINARY, argv, {
          cwd,
          env,
          replaceEnv: true,
          timeoutMs: options.timeoutMinutes * 60 * 1000,
          signal: options.signal,
          onStdout: (chunk) => parser.feed(chunk.toString("utf-8")),
        });
      } finally {
        // #141: on every exit path (normal, spawn error, timeout/kill, throw) flush a
        // trailing partial record and close still-open tool calls.
        parser.finish();
      }
      if (!result.ok) return result;

      return ok({
        ...result.value,
        reconstructedText: parser.getReconstructedText(),
      });
    } finally {
      await rm(promptDirectory, { recursive: true, force: true });
    }
  }

  validateCredentials(): Result<void> {
    // CLI 1.0.78 exposes no safe, non-mutating auth-status command. Authentication
    // remains unknown until execute() returns a classified startup failure.
    return ok(undefined);
  }

  classifyFailure(result: ExecutionResult): ProviderFailureClassification {
    return classifyCopilotFailure(result);
  }
}

function sanitizedEnvironment(overrides?: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value === undefined) continue;
    if (name.startsWith("COPILOT_") && name !== "COPILOT_HOME" && name !== "COPILOT_GITHUB_TOKEN") {
      continue;
    }
    environment[name] = value;
  }
  return environment;
}

registerAgent({
  id: COPILOT_AGENT_ID,
  displayName: "GitHub Copilot CLI",
  binaryName: COPILOT_BINARY,
  factory: () => new CopilotCliProvider(),
  // PATH presence is observable without spawning; authenticated readiness is
  // deliberately reported as unknown by probeBinaryOnPath.
  detect: () => probeBinaryOnPath(COPILOT_BINARY),
});
