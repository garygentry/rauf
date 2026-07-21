import { CliAgent } from "./cli-agent.js";
import type { CliAgentConfig } from "./cli-agent.js";
import { registerAgent } from "./registry.js";

/**
 * Shipped named preset adapters (`03-cli-agent-engine-and-presets.md §6`).
 *
 * Each preset is plain {@link CliAgentConfig} data over the {@link CliAgent} engine — no new
 * orchestration code (REQ-SCALE-01). All run in plain-text mode (`parsesStream` omitted).
 *
 * OQ-2 verification status (real-CLI checked 2026-06-27; a wrong flag is a one-line config fix
 * here, never an engine change):
 *  - `copilot` (@github/copilot 1.0.65) — VERIFIED end-to-end: `copilot --allow-all-tools` with
 *    the prompt on stdin runs headlessly and emits the agent's text on stdout (real run exited 0
 *    with the expected sentinel). All three CLIs auto-detect a non-TTY stdin and go headless, so
 *    the engine's stdin/arg delivery is enough — no explicit `-p/--prompt` is needed for copilot
 *    or gemini.
 *  - `gemini` (@google/gemini-cli 0.49.0) — argv VERIFIED to reach headless execution: `gemini
 *    --yolo` with the prompt on stdin parses, enters non-interactive mode, and consumes the
 *    prompt (run reached the auth wall — `GEMINI_API_KEY` not set in this env). Completion +
 *    stdout capture remains unconfirmed until run with a real key; flags themselves are correct.
 *  - `cursor` (cursor-agent 2026.06.26) — `--print` is the headless trigger ("Print responses to
 *    console for scripts/non-interactive use"); WITHOUT it cursor-agent would not emit parseable
 *    output. Added below and argv-verified (reaches the auth wall, not an "unknown option"
 *    error). `--force` stays as the auto-approve flag. End-to-end completion unconfirmed until
 *    run with `cursor-agent login` / `CURSOR_API_KEY`.
 *  - `pi` (Pi 0.80.10) — VERIFIED end-to-end for the sentinel shape: `pi -p --approve
 *    --no-session --no-tools "Reply with exactly RAUF_DONE"` exits 0 and prints exactly
 *    `RAUF_DONE`. The production preset intentionally omits `--no-tools` so loop iterations can
 *    edit files.
 *
 * None of the presets exhibit the codex failure mode (argv rejection / interactive hang). Validated
 * against the real binaries, not docs or literal-asserting unit tests (the blind spot that shipped
 * the broken codex loop in 0.9.0). Re-verify gemini/cursor end-to-end when credentials are present.
 *
 * NOTE: `codex` is NOT a generic preset — it has a dedicated, telemetry-capable adapter
 * ({@link ./codex-cli.ts}, `CodexCliProvider`) that also builds the correct current argv
 * (`--ask-for-approval` is a top-level flag that current Codex rejects after `exec`).
 */
export const PRESET_CONFIGS: readonly CliAgentConfig[] = [
  {
    id: "gemini",
    displayName: "Gemini CLI",
    binary: "gemini",
    promptDelivery: "stdin",
    buildArgs: () => [],
    nonInteractive: ["--yolo"],
    modelFlag: (m) => ["-m", m],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    binary: "copilot",
    promptDelivery: "stdin",
    buildArgs: () => [],
    nonInteractive: ["--allow-all-tools"],
    modelFlag: (m) => ["--model", m],
  },
  {
    id: "cursor",
    displayName: "Cursor Agent CLI",
    // NOTE: the binary ("cursor-agent") deliberately differs from the agent id ("cursor").
    binary: "cursor-agent",
    promptDelivery: "arg",
    buildArgs: () => [],
    // `--print` is the headless/non-interactive trigger (prints responses to stdout for scripts);
    // `--force` auto-approves tool calls. Verified against cursor-agent 2026.06.26 (2026-06-27).
    nonInteractive: ["--print", "--force"],
    modelFlag: (m) => ["--model", m],
  },
  {
    id: "pi",
    displayName: "Pi",
    binary: "pi",
    promptDelivery: "arg",
    // `-p` is the print-mode trigger. Keep `--no-tools` out of the production preset: loop
    // iterations need tools to edit files. Sentinel-only real smoke may add --no-tools externally.
    buildArgs: () => ["-p"],
    nonInteractive: ["--approve", "--no-session"],
    modelFlag: (m) => ["--model", m],
  },
];

/** Look up a shipped preset config by agent id. */
export function getPresetConfig(id: string): CliAgentConfig | undefined {
  return PRESET_CONFIGS.find((c) => c.id === id);
}

// Register each preset descriptor so it enumerates (getAgentDescriptors) and probes its real
// binary on PATH via the default detect (registerAgent with binaryName = config.binary).
for (const config of PRESET_CONFIGS) {
  registerAgent({
    id: config.id,
    displayName: config.displayName,
    binaryName: config.binary,
    factory: () => new CliAgent(config),
  });
}
