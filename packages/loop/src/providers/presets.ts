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
 *    output. `--force` stays as the auto-approve flag. End-to-end completion unconfirmed until
 *    run with `cursor-agent login` / `CURSOR_API_KEY`.
 *    CAVEAT — `promptDelivery: "file"`, not `"stdin"` (GH #108): cursor-agent's own docs
 *    (cursor.com/docs/cli/headless) show the prompt passed as a positional argv argument, and
 *    their piped-stdin examples use stdin as additional context ALONGSIDE an argv `-p "..."`
 *    string, not as a full prompt replacement — unlike gemini/copilot/pi above, nothing confirms
 *    cursor-agent reads a whole prompt from stdin alone. A large aggregated prompt (e.g. the
 *    post-loop review prompt) as a single argv element can still exceed the OS per-argument limit
 *    and fail with E2BIG (the same bug GH #90 fixed for `pi`), so the real prompt is written to a
 *    sandboxed temp file and a short positional indirection instruction pointing at it is passed
 *    instead — mirroring the handoff-file pattern used by the `cursor-agent` adapter in the
 *    `pi-subagents` package, which deliberately avoids stdin for this CLI for the same reason.
 *  - `pi` (Pi 0.81.1) — VERIFIED end-to-end. Both the sentinel shape (`pi -p --approve
 *    --no-session --no-tools "Reply with exactly RAUF_DONE"` exits 0, prints exactly `RAUF_DONE`)
 *    AND the production shape with tools enabled (`pi -p --approve --no-session "Create a file …
 *    then reply RAUF_DONE"` writes the file and exits 0) were run against the real binary. The
 *    production preset intentionally omits `--no-tools` so loop iterations can edit files.
 *    CAVEAT — `--model <value>` is a FUZZY pattern that Pi resolves across ALL configured
 *    providers, not a literal id: a bare name like `sonnet-4.6` can silently route to whichever
 *    provider matches (observed: `github-copilot`) and fail on missing credentials rather than
 *    erroring on an unknown model. Forward a provider-qualified pattern (`openai-codex/gpt-5.4`)
 *    for deterministic selection, or run Claude-authored backlogs with `--agent pi --no-model` so
 *    Claude-only aliases are never forwarded to Pi.
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
    // "file" (not "arg" or "stdin"): avoids the E2BIG exposure of "arg" (GH #108) without
    // depending on cursor-agent's unconfirmed stdin support — see the CAVEAT above. The real
    // prompt is written to a sandboxed temp file by the engine; this positional argument is just
    // a short pointer at it.
    promptDelivery: "file",
    buildArgs: (ctx) => [
      `Read the complete task instructions from the file at ${ctx.promptFile} and follow them completely.`,
    ],
    // `--print` is the headless/non-interactive trigger (prints responses to stdout for scripts);
    // `--force` auto-approves tool calls. Verified against cursor-agent 2026.06.26 (2026-06-27).
    nonInteractive: ["--print", "--force"],
    modelFlag: (m) => ["--model", m],
  },
  {
    id: "pi",
    displayName: "Pi",
    binary: "pi",
    // stdin (not "arg"): a large aggregated prompt (e.g. the post-loop review prompt) as a single
    // argv element can exceed the OS per-argument limit and fail with E2BIG before Pi even starts
    // (GH #90). Pi, like gemini/copilot above, auto-detects non-TTY stdin and goes headless in
    // print mode, so this is a pure config change — no engine change required.
    promptDelivery: "stdin",
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
