import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { ok } from "@rauf/core";
import type { Result } from "@rauf/core";

import { spawnProcessGroup } from "../process-group.js";
import { CopilotJsonlParser } from "./copilot-jsonl-parser.js";
import type { ExecuteOptions, ExecutionResult, LLMProvider } from "./types.js";

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
  "--no-remote",
  "--no-remote-export",
  "--no-custom-instructions",
  "--disable-builtin-mcps",
] as const;

export class CopilotCliProvider implements LLMProvider {
  readonly id = COPILOT_AGENT_ID;
  readonly displayName = "GitHub Copilot CLI";

  async execute(prompt: string, options: ExecuteOptions): Promise<Result<ExecutionResult>> {
    const cwd = process.cwd();
    const promptDirectory = await mkdtemp(join(cwd, PROMPT_DIRECTORY_PREFIX));
    const promptPath = join(promptDirectory, PROMPT_FILENAME);

    try {
      await writeFile(promptPath, prompt, { encoding: "utf-8", mode: 0o600 });
      const promptReference = relative(cwd, promptPath);
      const bootstrap = `Read the complete instructions from ${promptReference}, follow them, and do not modify that file.`;
      const argv = ["--no-auto-update", "-C", cwd, ...COPILOT_FLAGS.slice(1)];
      if (options.model) argv.push("--model", options.model);
      argv.push("--prompt", bootstrap);

      const parser = new CopilotJsonlParser((event) => options.onStreamEvent?.(event));
      const result = await spawnProcessGroup(COPILOT_BINARY, argv, {
        cwd,
        env: sanitizedEnvironment(options.env),
        replaceEnv: true,
        timeoutMs: options.timeoutMinutes * 60 * 1000,
        signal: options.signal,
        onStdout: (chunk) => parser.feed(chunk.toString("utf-8")),
      });
      if (!result.ok) return result;

      parser.finish();
      return ok({
        ...result.value,
        reconstructedText: parser.getReconstructedText(),
      });
    } finally {
      await rm(promptDirectory, { recursive: true, force: true });
    }
  }

  validateCredentials(): Result<void> {
    return ok(undefined);
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
